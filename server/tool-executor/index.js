/**
 * 文档卡（阶段2 · M5 工具执行程序 · F-23 工具注册与权限检查 · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径「查询证据必须带来源、条件、时点、适用范围」）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md`（F-23 验收要点：权限分支互斥——允许/不允许，不允许时保存原因并返回受限原因）
 *   ｜ `../../docs/03-locks/schema.md` CFG-02 `tool_registry`（L533-545：`tool_id` PK、`tool_code` UK、`source_id` FK→CFG-01、
 *        `is_enabled` 0/1）、CFG-03 `tool_permission`（L547-561：`tool_id` FK→CFG-02、`grantee_type` 走 `dict:GRANTEE_TYPE`、
 *        `allow_flag` 与不允许互斥、`restrict_reason` 不允许时填、`effective_from`/`effective_until`）、
 *        CFG-01 `source_registry`（L516-531：`is_mcp_ready`、`availability_status` 走 `dict:SOURCE_STATUS`）、
 *        CFG-04 `run_policy`（L563-577）、CFG-05 `gap_rule`（L579-591）、§11 字典枚举
 *   ｜ `../../docs/03-locks/external-deps.md` §5（12 工具 TOL-01~12 文档视图，与 CFG-02 同源；
 *        **TOL-12 是「不存在」而非「待接入」**；TOL-03/TOL-10 是「存在但能力不足」；TOL-11 降级）
 *   ｜ `../../docs/03-locks/tech-stack.md`（DS-06 自建 MCP 客户端；§2.6 协议面归 F-24）
 *   ｜ `../../db/migrations/0001_init.sql` L49-92（CFG-02/03/04/05 DDL）
 * 职责：F-23 —— CFG-02 工具注册（只读查询 + 登记接口）、CFG-03 按「任务/Agent × 工具」的授权登记，
 *   以及**每次调用前的权限判定**（判定链互斥、受限必带原因、不静默放行）。
 * 边界（严格只做 F-23）：不含 MCP 客户端与真实查询（F-24）、不含 `EXT-01 query_record` 落痕（F-25）、
 *   不含失败重试与暂停（F-26，与 M1 F-06 共用状态机）；本模块**不发起任何外部调用**。
 * 门禁状态：`external-deps.md` §7 的 T-01/T-02/T-05 未关闭——`tool_code` 为 demo 占位（`*` 后缀），
 *   **demo 值不进断言**；TS-10/TS-22 未决，本模块不锁死模型选型与 MCP 协议版本。
 *
 * 反向清单：被 `../api/index.js`（F-23 路由）与后续 `../agent-orchestrator`（调用前先查权限）引用；
 *   登记 `../README.md` 与本目录 `README.md`；测试 `./test-f23.mjs`。
 */

/** 判定链（互斥，依次短路）：每条拒绝都必带原因，允许也可能带「限制」提示。 */
export const REASON = {
  tool_not_found: "工具未登记",
  tool_disabled: "工具未启用（外部依赖未接入或该工具不存在）",
  source_not_mcp_ready: "来源系统未完成 MCP 化，不可被 Agent 调用",
  source_unauthorized: "来源系统未接入",
  no_permission: "无有效授权记录（授权对象与该工具无匹配，或已过有效期）",
  restricted: "授权记录明确为不允许",
};

/** 来源状态里「不阻断但须随结果说明的限制」（四要素之「限制」）。 */
export const SOURCE_LIMIT = {
  degraded: "来源系统降级，返回可能不完整（如实登记为限制，不视为失败）",
};

const nowStamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

// ------------------------------------------------------------------ CFG-02 工具注册

/** 登记工具（CFG-02）。`source_id` 不存在由库级 FK 拒绝，不在应用层复制口径。 */
export async function registerTool(db, tool) {
  const r = await db
    .prepare(
      `INSERT INTO tool_registry
       (tool_id, tool_code, tool_name, source_id, tool_purpose, call_condition, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      tool.tool_id,
      tool.tool_code,
      tool.tool_name,
      tool.source_id,
      tool.tool_purpose,
      tool.call_condition,
      tool.is_enabled == null ? 0 : tool.is_enabled,
    )
    .run();
  // 真机 D1 的 run() 遇约束冲突会抛；本地适配层返回 success:false——两种形态都当失败，绝不静默成功
  if (r && r.success === false) throw new Error(r.error || "tool_registry 插入失败");
  return getTool(db, tool.tool_id);
}

export async function getTool(db, tool_id) {
  return db.prepare("SELECT * FROM tool_registry WHERE tool_id = ?").bind(tool_id).first();
}

export async function getToolByCode(db, tool_code) {
  return db.prepare("SELECT * FROM tool_registry WHERE tool_code = ?").bind(tool_code).first();
}

/** 列出工具；`source_id` / `is_enabled` 可筛。排序稳定（tool_id），便于断言与展示。 */
export async function listTools(db, { source_id, is_enabled } = {}) {
  const where = [];
  const args = [];
  if (source_id !== undefined) { where.push("source_id = ?"); args.push(source_id); }
  if (is_enabled !== undefined) { where.push("is_enabled = ?"); args.push(is_enabled); }
  const sql = `SELECT * FROM tool_registry ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY tool_id`;
  return (await db.prepare(sql).bind(...args).all()).results;
}

// ------------------------------------------------------------------ CFG-03 授权登记

export async function registerPermission(db, perm) {
  const r = await db
    .prepare(
      `INSERT INTO tool_permission
       (permission_id, grantee_type, grantee_ref, tool_id, allow_flag, restrict_reason, effective_from, effective_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      perm.permission_id,
      perm.grantee_type,
      perm.grantee_ref,
      perm.tool_id,
      perm.allow_flag,
      perm.restrict_reason ?? null,
      perm.effective_from ?? nowStamp(),
      perm.effective_until ?? null,
    )
    .run();
  if (r && r.success === false) throw new Error(r.error || "tool_permission 插入失败");
  return db.prepare("SELECT * FROM tool_permission WHERE permission_id = ?").bind(perm.permission_id).first();
}

export async function listPermissions(db, { tool_id, grantee_type, grantee_ref } = {}) {
  const where = [];
  const args = [];
  if (tool_id !== undefined) { where.push("tool_id = ?"); args.push(tool_id); }
  if (grantee_type !== undefined) { where.push("grantee_type = ?"); args.push(grantee_type); }
  if (grantee_ref !== undefined) { where.push("grantee_ref = ?"); args.push(grantee_ref); }
  const sql = `SELECT * FROM tool_permission ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY permission_id`;
  return (await db.prepare(sql).bind(...args).all()).results;
}

/**
 * 权限判定（F-23 核心）。入参：`tool_id` 或 `tool_code` 二选一，加授权对象 `grantee_type` / `grantee_ref`。
 * 返回 `{ allowed, decision, reason_code, restrict_reason, limits, tool, source, matched_permission }`。
 * `decision` ∈ `allowed` / `restricted`，**二者互斥**；受限时 `restrict_reason` 必不为空（不静默放行）。
 * `limits` 承载「不阻断但须说明的限制」（如来源降级），供 F-24 落四要素之「限制」。
 */
export async function checkToolPermission(db, { tool_id, tool_code, grantee_type, grantee_ref, at } = {}) {
  const when = at || nowStamp();
  const tool = tool_id
    ? await getTool(db, tool_id)
    : tool_code
      ? await getToolByCode(db, tool_code)
      : null;

  const deny = (reason_code, extra = {}) => ({
    allowed: false,
    decision: "restricted",
    reason_code,
    restrict_reason: REASON[reason_code],
    limits: [],
    tool: tool ?? null,
    source: null,
    matched_permission: null,
    checked_at: when,
    ...extra,
  });

  if (!tool) return deny("tool_not_found");
  if (!tool.is_enabled) return deny("tool_disabled");

  const source = await db
    .prepare("SELECT * FROM source_registry WHERE source_id = ?")
    .bind(tool.source_id)
    .first();
  if (!source) return deny("source_unauthorized", { restrict_reason: "工具的来源系统未登记" });
  if (!source.is_mcp_ready) return deny("source_not_mcp_ready");
  if (source.availability_status === "unauthorized") return deny("source_unauthorized");

  const limits = [];
  if (SOURCE_LIMIT[source.availability_status]) limits.push(SOURCE_LIMIT[source.availability_status]);

  const perms = await db
    .prepare(
      `SELECT * FROM tool_permission
       WHERE tool_id = ? AND grantee_type = ? AND grantee_ref = ?
         AND effective_from <= ?
         AND (effective_until IS NULL OR effective_until >= ?)
       ORDER BY permission_id`,
    )
    .bind(tool.tool_id, grantee_type, grantee_ref, when, when)
    .all();
  const rows = perms.results || [];
  if (rows.length === 0) return deny("no_permission", { source, limits });

  // allow_flag 与「不允许」互斥：只要命中一条 0，即受限并原样带出原因
  const denied = rows.find((r) => !r.allow_flag);
  if (denied) {
    return {
      allowed: false,
      decision: "restricted",
      reason_code: "restricted",
      restrict_reason: denied.restrict_reason || REASON.restricted,
      limits,
      tool,
      source,
      matched_permission: denied,
      checked_at: when,
    };
  }

  const granted = rows[0];
  return {
    allowed: true,
    decision: "allowed",
    reason_code: null,
    restrict_reason: null,
    limits,
    tool,
    source,
    matched_permission: granted,
    checked_at: when,
  };
}

/**
 * 批量判定：一次请求常要多个工具。逐条独立判定，**单条受限不影响其它条**（实体级隔离，非整包失败）。
 * 返回 `{ allowed: [...], restricted: [...], limits }`。
 */
export async function checkToolPermissions(db, { tools = [], grantee_type, grantee_ref, at } = {}) {
  const out = { allowed: [], restricted: [], limits: [] };
  for (const t of tools) {
    const r = await checkToolPermission(db, { ...t, grantee_type, grantee_ref, at });
    (r.allowed ? out.allowed : out.restricted).push(r);
    for (const l of r.limits) if (!out.limits.includes(l)) out.limits.push(l);
  }
  return out;
}
