/**
 * 文档卡（阶段2 · M5 工具执行程序 · F-23 工具注册与权限检查 / **F-24 查询执行与真实返回（DS-06 编排层）**
 *   / **F-25 查询记录保存** / **F-26 失败重试与受限返回** · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径「查询证据必须带来源、条件、时点、适用范围」）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md`（F-23 验收要点：权限分支互斥——允许/不允许，不允许时保存原因并返回受限原因；
 *        **F-26 验收要点：重试是代码逻辑不是 AI 决策；实在卡死保留状态停止**；§4 约束 3 失败也留痕、约束 4 生产零写）
 *   ｜ `../../docs/03-locks/schema.md` EXT-01 `query_record`（L700-714：`query_id` PK 形如 `Q-90217`、
 *        `task_id` FK→PD-01、`source_id` FK→CFG-01、`query_condition` 须完整到可复现、`result_status` 走
 *        `dict:QUERY_STATUS`、`result_summary` **失败时为空**、`restricted_flag` 0/1、**`retry_count` 本次执行已重试次数**、
 *        `message_id` FK→PD-07）｜ PD-01 `task`（`task_status` 走 `dict:TASK_STATUS`、`done_part` 已完成部分、
 *        `retry_count` 本任务已重试次数、`is_auto_restart` 停止状态一律 0）｜ PD-03 `task_block`（`block_reason_code`
 *        走 `dict:BLOCK_REASON`、`resume_condition`、`is_resolved`）｜ CFG-04 `run_policy`（`retry_limit` 失败重试次数上限，
 *        达到即暂停受影响研究）**§12 Q-12**（卡死门槛待裁决）
 *   ｜ `../../docs/03-locks/external-deps.md` §5（12 工具 TOL-01~12 文档视图，与 CFG-02 同源；
 *        **TOL-12 是「不存在」而非「待接入」**；TOL-03/TOL-10 是「存在但能力不足」；TOL-11 降级）
 *   ｜ `../../docs/03-locks/tech-stack.md`（DS-06 自建 MCP 客户端；**§2.6 五项协议面落在 `./mcp-client.js`**；
 *        **§4.2 Queues 重试最大 100 次 → 直接对应 CFG-04 `retry_limit`（值域 ≤100）**，超限进死信 → 写 `PD-03` 并置
 *        `task_status=blocked`；§4.2 消费者墙钟 15 分钟）
 *   ｜ `../../docs/03-locks/external-deps.md` §6（mock 契约：请求含 `tool_code` + `query_condition`；响应须能映射到
 *        EXT-01 的 result_status/result_summary/returned_rows/fail_reason/retry_count/restricted_flag；七类行为 + 超时/执行中）
 *        §6.1（**成功不算失败**，`retry_count` 仍记）/ §6.2（**403 = 受限返回，非失败**）/ §6 末段（超时失败 → `call_failed`）
 *   ｜ `../../docs/01-brd/BRD.md` §4 F-06 **任务受阻处理矩阵 + 状态流**（F-26 与之共用状态机口径）
 *   ｜ `../../db/migrations/0001_init.sql` L49-92（CFG-02/03/04/05 DDL）
 * 职责：**F-23** —— CFG-02 工具注册（只读查询 + 登记接口）、CFG-03 按「任务/Agent × 工具」的授权登记，
 *   以及**每次调用前的权限判定**（判定链互斥、受限必带原因、不静默放行）。
 *   **F-24** —— `executeQuery` 编排层：**先判权限再决定要不要发外部请求**，允许才走传输层拿到真实返回，
 *   并把返回体（连同四要素）以 EXT-01 字段口径的信封返回；**只返回不落库**。
 *   **F-25** —— `EXT-01 query_record` 落痕：把每次**执行**的条件/来源/时点/结果或失败原因写成一行，
 *   **失败也留痕**、记录可回查；`result_status` 值域不内联，从 `dict:QUERY_STATUS` 读。
 *   **F-26** —— 失败**重试**（`executeQueryWithRetry`，上限取 `CFG-04 retry_limit`、封顶 100）与**受限返回**
 *   （受限不重试），以及持续失败后的**任务态处置**（`handleQueryFailure`：写 `PD-03` + 置 `PD-01.task_status`，
 *   保留 `done_part`；停止状态不自动重启）。
 * 边界：F-26 的一次「执行」＝**带重试的完整一次执行，落一行 `EXT-01`**（行内 `retry_count` 记本层重试次数，
 *   逐次尝试的证据面留在信封 `attempts[]`）；EXT-01 无承载「限制」的字段，四要素之「限制」仍在信封里
 *   （schema §12 **Q-10 方向②**）；`EXT-02 evidence` 提炼归 F-09；**任务调度/Queues 重投递与完整状态机归 M1 F-06（阶段3）**，
 *   本模块只按共用口径写任务态；传输、超时、错误码映射五项协议面在 `./mcp-client.js`，**那一个文件零 SQL、零写**。
 * 门禁状态：**已随 ADR-004（2026-09-21）收口为契约基准 v1**（`external-deps.md` v1.3 §7）——T-01/T-02/T-05
 *   自答回填，`tool_code` 由 demo 占位转正为基准 v1 自拟值（可进断言，断言文案标注基准版本）；
 *   **T-06 失败三形已定**（超时重试 / 403 受限不重试 / 空与不可算落 ok，`QUERY_STATUS` 不扩域），
 *   F-26 的 `TC-I-M5-004` 不再依赖「未关闭不设门禁」豁免；T-22（MCP 协议）＝DS-06 五面实现冻结
 *   （`mcp-client.js` `contract: baseline-v1`）；TS-10 已收口（Free 池 qwen3-30b 默认，选型锁死于
 *   `llm-client.js` 的 `MODELS`）；tech-stack TS-22（凭证）在基准 v1 下 mock 无凭证需求。
 *
 * 反向清单：被 `../api/index.js`（F-23 路由 / F-24 路由 / **F-25 路由** / **F-26 路由**）与后续 `../agent-orchestrator`
 *   （调用前先查权限；M3/M4 发起真实查询并落痕；失败/受限后消费任务态处置结果）引用；`./mcp-client.js`（F-24 传输层）
 *   被本文件引用；登记 `../README.md` 与本目录 `README.md`；测试 `./test-f23.mjs`、`./test-f24.mjs`、`./test-f25.mjs`、
 *   **`./test-f26.mjs`**。
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
import {
  BLOCK_REASON_CODE,
  TaskStateError,
  getTask,
  assertTaskRunnable,
  listTaskBlocks,
  recordBlock,
  setTaskStatus,
  appendDonePart,
} from "./task-state.js";
import { truncateForStorage } from "./text-limit.js";

// F-26 的任务态写入面（`PD-01`/`PD-03`）与只读回查：转出，便于路由与用例统一从本模块取用。
// 其中「改动已有行」的实现**只在 `./task-state.js`**，本文件因此不含改行 / 删行类 SQL（生产零写可静态验证）。
export {
  BLOCK_REASON_CODE,
  TaskStateError,
  dictCodes,
  getTask,
  assertTaskRunnable,
  nextBlockId,
  listTaskBlocks,
  recordBlock,
  setTaskStatus,
  appendDonePart,
} from "./task-state.js";

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
      // TS-16 应用层截断（tech-stack §8 已决 2026-09-21）：超 D1 单行上限风险的长文本在落库前一刻截断＋留痕标注；
      // 分析面（信封消费方）拿到的仍是全量原文，此处只防护存储面。
      truncateForStorage(envelope.result_summary ?? null),
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

// ================================================================== F-26 失败重试与受限返回

/**
 * 重试上限的硬上限：`tech-stack.md` §4.2「Queues 重试 最大 100 次 → 直接对应 `CFG-04 retry_limit`（值域 ≤100）」。
 * 库里若出现越界值，**截断到上限并显式标注**，不静默放过、也不擅自改成别的数。
 */
export const RETRY_LIMIT_MAX = 100;

/** 重试/终局分类（`executeQueryWithRetry` 的 `outcome`）。 */
export const RETRY_OUTCOME = { ok: "ok", running: "running", restricted: "restricted", exhausted: "exhausted" };

/** 失效判定：受限返回（事前判定受限 `decision=restricted`，或来源返回 403 后 `restricted_flag=1`）。 */
const isRestrictedEnvelope = (env) => Boolean(env && (env.decision === "restricted" || env.restricted_flag === 1));

// ---------------------------------------------------------------- CFG-04 运行策略

/**
 * 取生效运行策略（`CFG-04`）：**先目标级、后平台级**，各取 `is_active=1` 的第一条（按 `policy_id` 稳定排序）。
 * 都取不到则返回 `null`——重试上限此时按「不重试」处理，并由返回值显式说明（`policy_source='none'`），不假设默认值。
 */
export async function getRunPolicy(db, { goal_id = null } = {}) {
  if (goal_id) {
    const scoped = await db
      .prepare(
        `SELECT * FROM run_policy
         WHERE policy_scope = 'goal' AND goal_id = ? AND is_active = 1
         ORDER BY policy_id LIMIT 1`,
      )
      .bind(goal_id)
      .first();
    if (scoped) return scoped;
  }
  return db
    .prepare(
      `SELECT * FROM run_policy
       WHERE policy_scope = 'platform' AND goal_id IS NULL AND is_active = 1
       ORDER BY policy_id LIMIT 1`,
    )
    .first();
}

/** 由策略行算本次重试上限：`{ retry_limit, policy_id, policy_source, clamped, note? }`。 */
export function retryLimitOf(policy) {
  if (!policy) {
    return {
      retry_limit: 0,
      policy_id: null,
      policy_source: "none",
      clamped: false,
      note: "无生效运行策略（CFG-04）：本次不重试——**不假设默认重试次数**",
    };
  }
  const raw = Number(policy.retry_limit);
  const safe = Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : 0;
  const clamped = safe > RETRY_LIMIT_MAX;
  return {
    retry_limit: clamped ? RETRY_LIMIT_MAX : safe,
    policy_id: policy.policy_id,
    policy_source: policy.policy_scope,
    clamped,
    ...(clamped
      ? { note: `retry_limit ${safe} 超过平台上限 ${RETRY_LIMIT_MAX}（tech-stack §4.2 Queues 最大重试），按上限截断并标注` }
      : {}),
  };
}

// ---------------------------------------------------------------- PD-01/PD-03 任务态写入面
// 受阻留痕（插 `task_block`）与任务态处置（改 `task`）**单独落在 `./task-state.js`**——与 `mcp-client.js` 同理由：
// 让写入面可静态验证，本文件因此**不含改行 / 删行类 SQL**（`test-f23.mjs` 的生产零写断言逐字不动）。

// ---------------------------------------------------------------- 重试（代码逻辑，非 AI 决策）

/**
 * F-26 核心之一：**按配置上限重试**（`BRD` F-26「重试是代码逻辑不是 AI 决策」；上限取 `CFG-04 retry_limit`，
 * 受 `tech-stack` §4.2 平台上限 ≤100 约束）。`params` 与 `executeQuery`（F-24）同形，逐次透传。
 *
 * 重试判定（确定性，互斥）：
 * - `result_status='ok'` → 成功，**成功不算失败**（`external-deps` §6.1）；
 * - `result_status='running'` → 非终态，不视为失败、不重试；
 * - **受限返回**（事前判定 `decision=restricted` 或来源返回 403 后 `restricted_flag=1`）→ **不重试**
 *   （重试不改变权限，`external-deps` §6.2「受限返回，非失败」）；
 * - `result_status='fail'` 且非受限 → 在 `retry_limit` 内重试，用尽即 `outcome='exhausted'`。
 *
 * `retry_count` 的取值口径（显式标注，不隐式）：**本层真的重试过**（`retried>0`）→ 写本层重试次数、
 * `retry_count_source='platform'`（这才是「重试是代码逻辑」的留痕）；本层未重试 → 沿用返回体透传值
 * 并标 `upstream_passthrough`（`external-deps` §6.1 慢响应场景）；两者皆无 → `none`。
 */
export async function executeQueryWithRetry(db, params = {}, { retry_limit, sleep, onAttempt } = {}) {
  let limit;
  let policyInfo;
  if (retry_limit === undefined) {
    const task = params.task_id ? await getTask(db, params.task_id) : null;
    const policy = await getRunPolicy(db, { goal_id: task ? task.goal_id : null });
    policyInfo = retryLimitOf(policy);
    limit = policyInfo.retry_limit;
  } else {
    const n = Math.floor(Number(retry_limit));
    limit = Number.isFinite(n) && n > 0 ? Math.min(n, RETRY_LIMIT_MAX) : 0;
    policyInfo = {
      retry_limit: limit,
      policy_id: null,
      policy_source: "explicit",
      clamped: Number.isFinite(n) && n > RETRY_LIMIT_MAX,
    };
  }

  const attempts = [];
  let envelope = null;
  let retried = 0;
  for (let i = 0; i <= limit; i++) {
    envelope = await executeQuery(db, params);
    const att = {
      attempt: i + 1,
      result_status: envelope.result_status,
      decision: envelope.decision ?? null,
      restricted_flag: envelope.restricted_flag ?? 0,
      fail_reason: envelope.fail_reason ?? null,
      transport_called: envelope.transport_called !== false,
    };
    attempts.push(att);
    if (onAttempt) await onAttempt(att, envelope);
    if (!(envelope.result_status === "fail" && !isRestrictedEnvelope(envelope))) break; // 非「可重试失败」即止
    if (i === limit) break; // 用尽
    retried = i + 1;
    if (sleep) await sleep(retried);
  }

  const restricted = isRestrictedEnvelope(envelope);
  const outcome = restricted
    ? RETRY_OUTCOME.restricted
    : envelope.result_status === "ok"
      ? RETRY_OUTCOME.ok
      : envelope.result_status === "running"
        ? RETRY_OUTCOME.running
        : RETRY_OUTCOME.exhausted;

  const upstream = Number.isInteger(envelope.retry_count) ? envelope.retry_count : 0;
  envelope.retry_count = retried > 0 ? retried : upstream;
  envelope.retry_count_source = retried > 0 ? "platform" : upstream > 0 ? "upstream_passthrough" : "none";
  envelope.retry_limit = limit;
  envelope.retry_policy = policyInfo;
  envelope.attempts = attempts;

  // 用尽仍失败：把重试次数写进原因，便于回查（对齐种子 BL-001「接口超时，重试 3/3」的表述方式）
  if (outcome === RETRY_OUTCOME.exhausted && retried > 0) {
    const base = String(envelope.fail_reason ?? "").trim();
    envelope.fail_reason = base ? `${base}（重试 ${retried}/${limit}）` : `调用失败（重试 ${retried}/${limit} 后仍失败）`;
  }

  return { envelope, attempts, retried, retry_limit: limit, retry_policy: policyInfo, outcome };
}

/**
 * F-26 核心之二：**失败/受限后的任务态处置**（与 M1 F-06 共用状态机口径）。
 *
 * - 受阻原因按 BRD F-06 受阻矩阵取：失败 → `call_failed`（第 4 行）；受限 → `source_unavailable`（第 3 行）。
 * - 任务态判定（**schema §12 Q-12**，BRD 未给可判定门槛，本实现取此确定性规则）：
 *   该任务**已有未解除的同类受阻记录** → `stopped`（真卡死，保留已完成部分停止，不自动重启）；
 *   否则 → `blocked`（持续失败暂停受影响研究，记为受阻，满足继续条件可继续）。
 * - 同时**保留已完成部分**（`PD-01.done_part` 只追加、不覆盖），并把受阻/停止事实写进 `PD-03`。
 */
export async function handleQueryFailure(db, { task_id, envelope, retry_limit, at, done_fragment } = {}) {
  if (!task_id) throw new TaskStateError("handleQueryFailure：task_id 必填（任务态处置须归属真实任务）", { reason_code: "missing_task" });
  const when = at || nowStamp();
  const restricted = isRestrictedEnvelope(envelope);
  const block_reason_code = restricted ? BLOCK_REASON_CODE.source_unavailable : BLOCK_REASON_CODE.call_failed;
  const retried = Number.isInteger(envelope.retry_count) ? envelope.retry_count : 0;
  const limit = Number.isInteger(retry_limit) ? retry_limit : retried;
  const reasonText = String(envelope.fail_reason ?? "").trim() || "未给出具体原因";

  const openBlocks = await listTaskBlocks(db, { task_id, is_resolved: 0 });
  const had_open_same_reason = openBlocks.some((b) => b.block_reason_code === block_reason_code);
  const task_status = had_open_same_reason ? "stopped" : "blocked";
  const before = await getTask(db, task_id); // 改前态：用于回查「状态跃迁」这条白盒事实

  const block_note = restricted
    ? `接口不可用（受限返回）：${reasonText} —— 受影响的研究内容已保留`
    : `查询或服务调用失败：${reasonText}（重试 ${retried}/${limit}）—— 已完成部分保留`;
  const resume_condition = had_open_same_reason
    ? "持续失败后停止（保留已完成部分，不自动重启）"
    : restricted
      ? "接入或权限问题解决"
      : "服务恢复且满足任务继续条件";

  const block = await recordBlock(db, {
    task_id,
    block_reason_code,
    block_note,
    resume_condition,
    blocked_at: when,
    is_resolved: 0,
  });
  const task = await setTaskStatus(db, task_id, task_status, { ended_at: task_status === "stopped" ? when : null });
  const after = await appendDonePart(
    db,
    task_id,
    done_fragment ?? `${when} ${block_note}`,
  );

  return {
    outcome: task_status,
    block_reason_code,
    block,
    task: after,
    had_open_same_reason,
    blocked_at: when,
    resume_condition,
    previous_task_status: before ? before.task_status : null,
  };
}

/**
 * F-26 一步编排：**重试执行（F-24+重试） → 留痕（F-25） → 失败/受限处置任务态（F-26）**。
 * 返回 `{ envelope, attempts, retried, retry_limit, outcome, persisted, query_id, record, persist_skip, recovery }`。
 *
 * 边界（白盒）：任务态**只在失败 / 受限时**才动；成功与执行中一律不改任务态（`recovery.outcome='none'`）。
 * 失败本身**不作为否定研究结论的依据**——本函数只写 `PD-01/PD-03/EXT-01`，**不碰 `EXT-02 evidence` 与 `MD-07 research`**。
 */
export async function runQueryWithRecovery(db, params = {}) {
  const {
    task_id = null,
    source_id = null,
    message_id = null,
    query_id = null,
    created_at = null,
    retry_limit,
    ...rest
  } = params;

  const exec = await (async () => {
    // 前置守卫：已停止 / 已完成的任务**根本不进入执行**——避免「先执行、后拒写」留下半截状态
    if (task_id) await assertTaskRunnable(db, task_id);
    return executeQueryWithRetry(db, { ...rest, task_id }, { retry_limit });
  })();

  // 1) 留痕（F-25）：无论终局都落一行；无处落痕时显式标 persist_skip，不静默丢
  let ledger;
  if (!task_id) {
    ledger = { persisted: false, query_id: null, record: null, persist_skip: { reason_code: "missing_task", message: "runQueryWithRecovery：task_id 必填（EXT-01 每条查询须归属真实任务）" } };
  } else {
    try {
      const record = await saveQueryRecord(db, exec.envelope, { task_id, source_id, message_id, query_id, created_at });
      ledger = { persisted: true, query_id: record.query_id, record, persist_skip: null };
    } catch (e) {
      if (!(e instanceof PersistSkip)) throw e; // 其余错误（FK 拒绝 / 值域不合）如实上抛
      ledger = { persisted: false, query_id: null, record: null, persist_skip: { reason_code: e.reason_code || "no_source", message: e.message } };
    }
  }

  // 2) 任务态处置：只有「用尽仍失败」与「受限返回」才动任务态
  let recovery;
  if (exec.outcome === RETRY_OUTCOME.exhausted || exec.outcome === RETRY_OUTCOME.restricted) {
    recovery = task_id
      ? await handleQueryFailure(db, { task_id, envelope: exec.envelope, retry_limit: exec.retry_limit, at: exec.envelope.queried_at })
      : { outcome: "skipped", reason_code: "missing_task", message: "无 task_id：仅返回执行结果，不做任务态处置" };
  } else {
    recovery = {
      outcome: "none",
      reason_code: null,
      message: `${exec.outcome}：不改任务态（成功 / 执行中不判失败）`,
    };
  }

  return { ...exec, ...ledger, recovery };
}

/** 受限返回对外的统一说明（路由用于 403 文案；与 `external-deps` §6.2「受限返回，非失败」同口径）。 */
export const RESTRICTED_NOTE = "受限返回：返回了受限说明而非数据（非失败；重试不改变权限）";
