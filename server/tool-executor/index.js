/**
 * 文档卡（阶段2 · M5 工具执行程序 · F-23 工具注册与权限检查 / **F-24 查询执行与真实返回（DS-06 编排层）** · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径「查询证据必须带来源、条件、时点、适用范围」）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md`（F-23 验收要点：权限分支互斥——允许/不允许，不允许时保存原因并返回受限原因）
 *   ｜ `../../docs/03-locks/schema.md` EXT-01 `query_record`（L700-714：`query_id` PK 形如 `Q-90217`、
 *        `task_id` FK→PD-01、`source_id` FK→CFG-01、`query_condition` 须完整到可复现、`result_status` 走
 *        `dict:QUERY_STATUS`、`result_summary` **失败时为空**、`restricted_flag` 0/1、`message_id` FK→PD-07）枚举
 *   ｜ `../../docs/03-locks/external-deps.md` §5（12 工具 TOL-01~12 文档视图，与 CFG-02 同源；
 *        **TOL-12 是「不存在」而非「待接入」**；TOL-03/TOL-10 是「存在但能力不足」；TOL-11 降级）
 *   ｜ `../../docs/03-locks/tech-stack.md`（DS-06 自建 MCP 客户端；**§2.6 五项协议面落在 `./mcp-client.js`**）
 *   ｜ `../../docs/03-locks/external-deps.md` §6（mock 契约：请求含 `tool_code` + `query_condition`；响应须能映射到
 *        EXT-01 的 result_status/result_summary/returned_rows/fail_reason/retry_count/restricted_flag；七类行为 + 超时/执行中）
 *   ｜ `../../db/migrations/0001_init.sql` L49-92（CFG-02/03/04/05 DDL）
 * 职责：**F-23** —— CFG-02 工具注册（只读查询 + 登记接口）、CFG-03 按「任务/Agent × 工具」的授权登记，
 *   以及**每次调用前的权限判定**（判定链互斥、受限必带原因、不静默放行）。
 *   **F-24** —— `executeQuery` 编排层：**先判权限再决定要不要发外部请求**，允许才走传输层拿到真实返回，
 *   并把返回体（连同四要素）以 EXT-01 字段口径的信封返回；**只返回不落库**。
 *   **F-25** —— `EXT-01 query_record` 落痕：把每次**执行**的条件/来源/时点/结果或失败原因写成一行，
 *   **失败也留痕**、记录可回查；`result_status` 值域不内联，从 `dict:QUERY_STATUS` 读。
 * 边界：F-25 不含失败重试与暂停（＝F-26，与 M1 F-06 共用状态机）；EXT-01 无承载「限制」的字段，
 *   四要素之「限制」仍在信封里（schema §12 **Q-10 方向②**）；`EXT-02 evidence` 提炼归 F-09；
 *   传输、超时、错误码映射五项协议面在 `./mcp-client.js`，**那一个文件零 SQL、零写**。
 * 门禁状态：`external-deps.md` §7 的 T-01/T-02/T-05 未关闭——`tool_code` 为 demo 占位（`*` 后缀），
 *   **demo 值不进断言**；TS-10/TS-22 未决，本模块不锁死模型选型与 MCP 协议版本。
 *
 * 反向清单：被 `../api/index.js`（F-23 路由 / F-24 路由 / **F-25 路由**）与后续 `../agent-orchestrator`
 *   （调用前先查权限；M3/M4 发起真实查询并落痕）引用；`./mcp-client.js`（F-24 传输层）被本文件引用；
 *   登记 `../README.md` 与本目录 `README.md`；测试 `./test-f23.mjs`、`./test-f24.mjs`、**`./test-f25.mjs`**。
 */

import {
  MCP_FACES,
  DEFAULT_TIMEOUT_MS,
  TransportTimeout,
  describeTool,
  createHttpTransport,
  serializeCondition,
  mapResponseToResult,
} from "./mcp-client.js";

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

// ================================================================== F-24 查询执行与真实返回

/**
 * 协议面 1 对外的工具描述：按 CFG-02 逐条生成（demo 结构，见 `mcp-client.js` 文档卡）。
 * `source_id` / `is_enabled` 可筛，便于 M3/M4 只看到自己能用的工具。
 */
export async function describeTools(db, { source_id, is_enabled, grantee_type, grantee_ref } = {}) {
  const tools = await listTools(db, { source_id, is_enabled });
  const out = [];
  for (const tool of tools) {
    const source = await db
      .prepare("SELECT * FROM source_registry WHERE source_id = ?")
      .bind(tool.source_id)
      .first();
    const entry = { description: describeTool(tool, source), tool, source };
    if (grantee_type && grantee_ref) {
      entry.permission = await checkToolPermission(db, { tool_id: tool.tool_id, grantee_type, grantee_ref });
    }
    out.push(entry);
  }
  return out;
}

/**
 * F-24 编排：`tool_id` 或 `tool_code` 二选一（与 F-23 判定同入参形态），加授权对象与查询条件。
 * 顺序：**先判权限 → 允许才发请求**（`TC-I-M5-001` 权限分支互斥，不允许则根本不调外部接口）。
 *
 * 返回信封字段与 `EXT-01 query_record` 同名同义（`result_status` / `result_summary` / `returned_rows` /
 * `fail_reason` / `retry_count` / `restricted_flag`），但 **`persisted: false`——落痕是 F-25 的事**，
 * 本函数不写库；`four_elements` 承载证据四要素（条件 / 来源 / 时点 / 限制）。
 *
 * `transport` 可注入（测试用）；不注入时用 `createHttpTransport`（HTTP POST，只读，默认打本机 mock server）。
 */
export async function executeQuery(db, {
  tool_id,
  tool_code,
  grantee_type,
  grantee_ref,
  query_condition,
  task_id = null,
  at,
  transport,
  timeout_ms = DEFAULT_TIMEOUT_MS,
  force_behavior,
} = {}) {
  const queried_at = at || nowStamp();
  const perm = await checkToolPermission(db, { tool_id, tool_code, grantee_type, grantee_ref, at: queried_at });
  const condition = serializeCondition(query_condition);
  const ctx = {
    task_id,
    tool: perm.tool,
    source: perm.source,
    query_condition: condition,
    queried_at,
    permission_limits: perm.limits || [],
  };

  // 协议面 5：权限拒绝形态——不允许时**不发起外部调用**，原样返回受限原因（不静默放行）
  if (!perm.allowed) {
    return {
      ...mapResponseToResult(
        { result_status: "restricted", reason_text: perm.restrict_reason, tool_code: perm.tool?.tool_code ?? tool_code ?? null },
        ctx,
      ),
      decision: perm.decision,
      reason_code: perm.reason_code,
      transport_called: false,
    };
  }

  const call = transport || createHttpTransport({ timeout_ms });
  let payload;
  try {
    payload = await call({
      tool_code: perm.tool.tool_code,
      query_condition: condition,
      ...(force_behavior ? { force_behavior } : {}),
    });
  } catch (e) {
    // 传输层异常也映射成「失败 + 具体原因」，失败也留痕的字段面由 F-25 落库时承接
    const errPayload = {
      result_status: "fail",
      fail_reason: e instanceof TransportTimeout ? e.message : `调用失败：${String((e && e.message) || e)}`,
    };
    return { ...mapResponseToResult(errPayload, ctx), decision: "allowed", reason_code: null, transport_called: true };
  }
  return { ...mapResponseToResult(payload, ctx), decision: "allowed", reason_code: null, transport_called: true };
}

export { MCP_FACES, DEFAULT_TIMEOUT_MS, TransportTimeout, describeTool, createHttpTransport, serializeCondition };

// ================================================================== F-25 查询记录保存（EXT-01 落痕）

/**
 * 本次**留痕不了**的显式标记，用于「不静默丢留痕」：跑到 EXT-01 门前缺必填项时抛出并可被 `recordQuery` 捕获。
 * 与「拉不到数据」无关——只表示**这条执行在库里无处落**（见 schema §12 Q-11）。
 */
export class PersistSkip extends Error {
  constructor(message, { reason_code = null } = {}) {
    super(message);
    this.name = "PersistSkip";
    this.reason_code = reason_code;
  }
}

/** `result_status` 的值域取自 `dict:QUERY_STATUS`，不在本文件内联复制（schema 是真源）。 */
export async function queryStatusDict(db) {
  const rows = await db
    .prepare("SELECT item_code FROM dict_item WHERE dict_type_code = 'QUERY_STATUS' ORDER BY order_no")
    .all();
  return (rows.results || []).map((r) => r.item_code);
}

/** 下一个 `query_id`：沿用 `Q-` + 5 位数字形（PK 形如 `Q-90217`），取库内已用最大值 +1，确定性可复现。 */
export async function nextQueryId(db) {
  const rows = (await db.prepare("SELECT query_id FROM query_record").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = /^Q-(\d+)$/.exec(String(r.query_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `Q-${String(max + 1).padStart(5, "0")}`;
}

/** 落痕前的不变量校验（缺一项就抛，绝不留「回查不出有用信息」的行）。 */
function assertRecordable(envelope, statuses) {
  if (!statuses.includes(envelope.result_status)) {
    throw new Error(
      `result_status '${String(envelope.result_status)}' 不在 dict:QUERY_STATUS 值域内（${statuses.join(" / ")}）`,
    );
  }
  if (!String(envelope.query_condition ?? "").trim()) {
    throw new Error("query_condition 为空：记录无法复现，不允许落 EXT-01");
  }
  if (envelope.result_status === "fail" && !String(envelope.fail_reason ?? "").trim()) {
    // PRD-M5 约束 3「失败也留痕」＋ EXT-01 `fail_reason` 口径：失败不带原因＝留了等于没留
    throw new Error("失败必须带具体原因（fail_reason 为空的失败不允许落 EXT-01）");
  }
  const rows = envelope.returned_rows;
  if (rows !== null && rows !== undefined && (!Number.isInteger(rows) || rows < 0)) {
    throw new Error(`returned_rows 须为 ≥0 的整数或空（实测 ${String(rows)}）`);
  }
}

/**
 * F-25 核心：把 F-24 的结果信封**落成一行 `EXT-01`**（成功 / 失败 / 执行中 / 受限**都落**）。
 * 入参：`envelope`（`executeQuery` 的返回值）+ `opts.{ task_id, source_id, message_id, query_id, created_at }`。
 * `source_id` 优先取信封（工具已登记时必有）；信封没有时用 `opts.source_id` 兜底（本次冲着哪个来源去的）；
 * **两者都没有 → 抛 `PersistSkip`**（工具/来源根本未登记，`EXT-01.source_id` 为 NOT NULL FK，无处落）。
 * FK（`task_id` / `source_id` / `message_id`）一律交给库级拒绝，不在应用层复制口径。
 */
export async function saveQueryRecord(db, envelope, opts = {}) {
  if (!envelope || typeof envelope !== "object") throw new Error("saveQueryRecord：缺少 F-24 结果信封");

  const statuses = await queryStatusDict(db);
  assertRecordable(envelope, statuses);

  const task_id = opts.task_id ?? envelope.task_id ?? null;
  if (!task_id) throw new Error("saveQueryRecord：task_id 必填（EXT-01 每条查询须归属真实任务）");

  const source_id = envelope.source_id ?? opts.source_id ?? null;
  if (!source_id) {
    throw new PersistSkip(
      `工具/来源未登记（reason_code=${String(envelope.reason_code ?? "unknown")}）：` +
        "EXT-01.source_id 为 NOT NULL 外键，本次执行无处落痕（schema §12 Q-11）",
      { reason_code: envelope.reason_code || "no_source" },
    );
  }

  const query_id = opts.query_id || (await nextQueryId(db));
  const r = await db
    .prepare(
      `INSERT INTO query_record
       (query_id, task_id, source_id, query_condition, queried_at, result_status, result_summary,
        returned_rows, fail_reason, retry_count, restricted_flag, message_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      query_id,
      task_id,
      source_id,
      envelope.query_condition,
      envelope.queried_at,
      envelope.result_status,
      envelope.result_summary ?? null,
      envelope.returned_rows ?? null,
      envelope.fail_reason ?? null,
      Number.isInteger(envelope.retry_count) ? envelope.retry_count : 0,
      envelope.restricted_flag ? 1 : 0,
      opts.message_id ?? null,
      opts.created_at || nowStamp(),
    )
    .run();
  if (r && r.success === false) throw new Error(r.error || "query_record 插入失败");
  return getQueryRecord(db, query_id);
}

/** 回查单条（`TC-I-M5-003` 的可回查面）。 */
export async function getQueryRecord(db, query_id) {
  return db.prepare("SELECT * FROM query_record WHERE query_id = ?").bind(query_id).first();
}

/** 列表回查：按 `task_id` / `source_id` / `result_status` / `message_id` 过滤，排序稳定（`query_id` DESC）。 */
export async function listQueryRecords(db, { task_id, source_id, result_status, message_id } = {}) {
  const where = [];
  const args = [];
  if (task_id !== undefined) { where.push("task_id = ?"); args.push(task_id); }
  if (source_id !== undefined) { where.push("source_id = ?"); args.push(source_id); }
  if (result_status !== undefined) { where.push("result_status = ?"); args.push(result_status); }
  if (message_id !== undefined) { where.push("message_id = ?"); args.push(message_id); }
  const sql = `SELECT * FROM query_record ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY query_id DESC`;
  return (await db.prepare(sql).bind(...args).all()).results;
}

/**
 * 回查并派生证据四要素的前三样（条件 / 来源 / 时点）。
 * **「限制」不在库里**（`EXT-01` 无承载字段，schema §12 Q-10 方向②），故此处显式给出 `limits_not_persisted`。
 */
export async function readbackQuery(db, query_id) {
  const record = await getQueryRecord(db, query_id);
  if (!record) return null;
  return {
    record,
    four_elements: {
      condition: record.query_condition,
      source: record.source_id,
      time_point: record.queried_at,
    },
    limits_not_persisted: true,
    persist_note: "EXT-01 无「限制」承载字段（schema §12 Q-10 方向②），限制仍存在于 F-24 返回信封",
  };
}

/**
 * F-25 一步编排：**执行 + 落痕**。`params` 透传给 `executeQuery`，额外接受落痕所需的归属信息。
 * 返回 `{ envelope, persisted, query_id, record, persist_skip }`：
 * - `persisted=true` —— 已落一行 EXT-01（**无论成功还是失败**，含受限与执行中）；
 * - `persisted=false` —— 显式带 `persist_skip.reason_code` 说明**为什么没落**（不静默丢失留痕）。
 */
export async function recordQuery(db, params = {}) {
  const { task_id = null, source_id = null, message_id = null, query_id = null, created_at = null, ...rest } = params;
  // task_id 同时交给执行层：信封里也要带归属任务，否则回查时「哪次查询属于哪个任务」会断链
  const envelope = await executeQuery(db, { ...rest, task_id });

  const skip = (reason_code, message) => ({
    envelope,
    persisted: false,
    query_id: null,
    record: null,
    persist_skip: { reason_code, message },
  });

  if (!task_id) return skip("missing_task", "recordQuery：task_id 必填（EXT-01 每条查询须归属真实任务）");
  try {
    const record = await saveQueryRecord(db, envelope, { task_id, source_id, message_id, query_id, created_at });
    return { envelope, persisted: true, query_id: record.query_id, record, persist_skip: null };
  } catch (e) {
    if (e instanceof PersistSkip) return skip(e.reason_code || "no_source", e.message);
    throw e; // 其余错误（FK 拒绝 / 值域不合）如实上抛，不吞成「没落痕」
  }
}
