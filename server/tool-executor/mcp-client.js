/**
 * 文档卡（阶段2 · M5 工具执行程序 · F-24 自建 MCP 客户端 DS-06 · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：白盒原则｜双向引用｜术语口径「查询证据必须带来源、条件、时点、适用范围」）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md`（F-24 查询执行与真实返回：**不能用模型预期的内容代替查询结果**；
 *        返回保留查询条件/来源/时点/限制；失败返回具体原因；约束 1 真实返回硬红线、约束 4 生产环境零写）
 *   ｜ `../../docs/03-locks/tech-stack.md` §2.6（自建 MCP 客户端须自行实现**五项协议面**：工具描述格式 /
 *        调用与结果回传 / 超时 / 错误码映射 / 权限拒绝的返回形态；DS-06 与自建状态机保持单一状态源）
 *   ｜ `../../docs/03-locks/external-deps.md` §6（mock 契约：请求含 `tool_code` + `query_condition`；
 *        响应须能映射到 EXT-01 的 result_status/result_summary/returned_rows/fail_reason/retry_count/restricted_flag；
 *        七类行为 + 末尾两类「超时失败」「执行中」）+ §6.8 七类覆盖自检表
 *   ｜ `../../docs/03-locks/schema.md` EXT-01 `query_record`（`result_status` 走 `dict:QUERY_STATUS`=ok/fail/running；
 *        `result_summary` **失败时为空**；`query_condition` 须完整到可复现）、§11 字典
 *   ｜ `../../prototype/mock/scenarios.js`（9 类响应的真实返回体，本文件的映射对象）
 * 职责：**传输层**——把外部系统返回映射成 EXT-01 可直接落库的结果信封，并实现五项协议面。
 * 边界（严格只做 F-24 的传输面）：**本文件零 SQL、零写**（不碰 `EXT-01` 落痕＝F-25、不碰重试＝F-26、
 *   不碰权限判定＝F-23，权限判定由 `./index.js` 编排层调用并据此短路）。
 * 门禁：`external-deps.md` §7 的 T-01/T-02/T-05 与 `tech-stack.md` §8 TS-22 未关闭——
 *   工具描述格式与 `tool_code` 均为 **demo 占位**，`describeTool` 显式打 `contract: demo`；
 *   **返回体内所有数值都是外部真实返回值，不由本层生成，也不进断言**。
 *
 * 反向清单：被 `./index.js`（F-24 `executeQuery` 编排）引用；登记 `./README.md`；测试 `./test-f24.mjs`。
 */

// ---------------------------------------------------- 协议面 1：工具描述格式（demo）

/** 五项协议面清单（便于 Implement chaperone 与用例断言「五面齐备」）。 */
export const MCP_FACES = [
  "tool_description", // 协议面 1
  "call_and_return", // 协议面 2
  "timeout", // 协议面 3
  "error_mapping", // 协议面 4
  "permission_denied_shape", // 协议面 5
];

/** §6.1 的阈值口径：超过 30s 视为慢响应。 */
export const DEFAULT_TIMEOUT_MS = 30000;

/**
 * 协议面 1 —— 工具描述格式。
 * ⚠️ 结构为 demo（§7 T-01/T-02 与 TS-22 未关闭），真实契约到手前**不得据此外推**，故显式打 `contract: demo`。
 */
export function describeTool(tool, source = null) {
  return {
    name: tool.tool_code,
    description: tool.tool_purpose,
    inputSchema: {
      type: "object",
      properties: { query_condition: { type: "string", description: "查询条件，须完整到可复现" } },
      required: ["query_condition"],
    },
    _meta: {
      tool_id: tool.tool_id,
      source_id: tool.source_id,
      call_condition: tool.call_condition,
      availability_status: source ? source.availability_status : null,
      is_mcp_ready: source ? source.is_mcp_ready : null,
      contract: "demo（external-deps §7 T-01/T-02 与 tech-stack §8 TS-22 未关闭）",
    },
  };
}

// ---------------------------------------------------- 协议面 2 / 3：调用回传与超时

export class TransportTimeout extends Error {
  constructor(timeoutMs) {
    super(`调用超时：超过 ${timeoutMs} ms 未响应`);
    this.name = "TransportTimeout";
  }
}

/**
 * 协议面 2 + 3 —— HTTP 调用与结果回传、超时。
 * **只读约束**：只发 `POST`（查询语义），不提供 PUT/PATCH/DELETE 通道；写方法在本层**不可表达**。
 * 出现 `__transport_error` 表示传输层失败，交由协议面 4 统一映射，**绝不用模型预期补内容**。
 */
export function createHttpTransport({
  endpoint = process.env.MOCK_ENDPOINT || "http://127.0.0.1:8788/query",
  timeout_ms = DEFAULT_TIMEOUT_MS,
  fetchImpl = globalThis.fetch,
} = {}) {
  return async function httpTransport({ tool_code, query_condition, force_behavior }) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout_ms);
    try {
      const res = await fetchImpl(endpoint, {
        method: "POST", // 只读查询；本行是本传输层唯一的 HTTP 方法，无写通道
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tool_code,
          query_condition,
          ...(force_behavior ? { force_behavior } : {}),
        }),
        signal: ac.signal,
      });
      if (!res.ok) return { __transport_error: `HTTP ${res.status}` };
      return await res.json();
    } catch (e) {
      if (e && e.name === "AbortError") throw new TransportTimeout(timeout_ms);
      return { __transport_error: String((e && e.message) || e) };
    } finally {
      clearTimeout(timer);
    }
  };
}

// ---------------------------------------------------- 查询条件归一化（须完整到可复现）

/** 稳定序列化：对象键排序，**数组保持原序**（§6.4 多值字段须保序）。 */
export function serializeCondition(condition) {
  if (condition == null) return "";
  if (typeof condition === "string") return condition;
  const seen = new WeakSet();
  const walk = (v) => {
    if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
    if (Array.isArray(v)) return `[${v.map(walk).join(",")}]`;
    if (seen.has(v)) throw new Error("查询条件存在循环引用，无法序列化");
    seen.add(v);
    const body = Object.keys(v)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${walk(v[k])}`)
      .join(",");
    return `{${body}}`;
  };
  return walk(condition);
}

// ---------------------------------------------------- 四要素之「限制」萃取

/**
 * 从真实返回体萃取「限制」（evidence 四要素之一）。只做**确定性的形态识别**，不改返回值本身。
 * 每类限制均回指 external-deps §6 的具体条款，便于回查。
 */
export function collectLimits(payload) {
  const limits = [];
  if (!payload || typeof payload !== "object") return limits;
  if (Array.isArray(payload.warnings)) {
    for (const w of payload.warnings) limits.push(String(w)); // §6.1 慢响应：成功不算失败的对照说明
  }
  const d = payload.data;
  if (d && typeof d === "object" && !Array.isArray(d)) {
    const cov = d.coverage;
    if (cov && (cov.actual !== cov.requested || Number(cov.truncated_days) > 0)) {
      limits.push(
        `覆盖不完整：请求 ${cov.requested ?? "-"}，实际 ${cov.actual ?? "-"}（截尾 ${cov.truncated_days ?? "未知"} 天）`,
      ); // §6.7
    }
    // 排除结果集本身（rows/items 是行集合，不是「一个字段多个值」）
    const RESULT_SET_KEYS = new Set(["rows", "items", "list", "records", "results"]);
    const multi = Object.keys(d).filter((k) => Array.isArray(d[k]) && !RESULT_SET_KEYS.has(k));
    if (multi.length) limits.push(`多值字段 ${multi.join(" / ")} 须说明取值口径`); // §6.4
    const notComputable = new Set();
    for (const k of Object.keys(d)) {
      if (/_reason$/.test(k)) notComputable.add(k);
      if (d[k] === null && /(rate|ratio|index|score)$/.test(k)) notComputable.add(k);
    }
    if (notComputable.size) limits.push(`字段不可算（≠ 0 ≠ 失败）：${[...notComputable].join(" / ")}`); // §6.5
    const rawEnum = Object.keys(d).filter((k) => /_raw$/.test(k));
    if (rawEnum.length) limits.push(`外部枚举未归一化：${rawEnum.join(" / ")}（须落字典项，不得直接入库）`); // §6.6
  }
  if (payload.returned_rows === 0) limits.push("空结果：查到了但返回 0 行（成功但无数据，**非失败**）"); // §6.3
  return limits;
}

// ---------------------------------------------------- 实体级隔离（TC-U-M5-001 域内形态）

const ROW_TIME_KEYS = ["period", "time_point", "info_time_point", "stat_date", "date", "queried_at"];

/** 从一行里取「信息时点」的末端日期；支持 `A ~ B` 区间与单值，返回 `YYYY-MM-DD` 或 null。 */
export function rowTimePoint(row) {
  if (!row || typeof row !== "object") return null;
  for (const k of ROW_TIME_KEYS) {
    const v = row[k];
    if (typeof v !== "string") continue;
    const tail = v.includes("~") ? v.split("~").pop() : v;
    const m = String(tail).trim().match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  }
  return null;
}

/**
 * 实体级隔离：**单条不变量被破坏时只隔离该条，不使整包查询失败**（其余证据照常）。
 * 域内不变量＝「信息时点 ≤ 取数时刻」（对应 TC-U-M5-001；原用例的价格约束属交易域，本平台无该字段）。
 */
export function splitEntities(payload, queriedAt) {
  const qDay = String(queriedAt || "").slice(0, 10);
  const rows = payload && payload.data && Array.isArray(payload.data.rows) ? payload.data.rows : null;
  if (!rows || !qDay) return { rows: null, isolated: [] };
  const kept = [];
  const isolated = [];
  rows.forEach((row, i) => {
    const tp = rowTimePoint(row);
    if (tp && tp > qDay) {
      isolated.push({ index: i, reason: `信息时点 ${tp} 晚于取数时刻 ${qDay}（单实体隔离）`, row });
    } else {
      kept.push(row);
    }
  });
  return { rows: kept, isolated };
}

// ---------------------------------------------------- 协议面 4：错误码映射

const NO_SUBSTITUTE_NOTE = "不得用模型预期填充";

function baseEnvelope(ctx) {
  return {
    task_id: ctx.task_id ?? null,
    source_id: ctx.source ? ctx.source.source_id : null,
    query_condition: ctx.query_condition,
    queried_at: ctx.queried_at,
    tool: ctx.tool
      ? { tool_id: ctx.tool.tool_id, tool_code: ctx.tool.tool_code, tool_purpose: ctx.tool.tool_purpose }
      : null,
    source: ctx.source
      ? {
          source_id: ctx.source.source_id,
          availability_status: ctx.source.availability_status,
          is_mcp_ready: ctx.source.is_mcp_ready,
        }
      : null,
    persisted: false, // F-24 只返回，EXT-01 落痕归 F-25
    persist_by: "F-25",
  };
}

/** 失败／拒答形态的公共收口：`result_summary` 依 schema 规定为空，原因一律进 `fail_reason`。 */
function notOk(env, { result_status, fail_reason, restricted_flag, retry_count, payload }) {
  return {
    ...env,
    result_status,
    result_summary: null, // schema EXT-01：`result_summary` 失败时为空
    returned_rows: 0,
    fail_reason,
    retry_count: Number.isInteger(retry_count) ? retry_count : 0,
    restricted_flag: restricted_flag ? 1 : 0,
    data: null,
    isolated: [],
    raw_response: payload ?? null,
    four_elements: {}, // 由调用方补齐
  };
}

/**
 * 协议面 4 —— 错误码/状态映射。把外部返回体映射成 EXT-01 字段口径的信封。
 * 硬红线：`data` 一律**原样透传**，`result_summary` 也原样透传；本函数不生成任何业务结论。
 */
export function mapResponseToResult(payload, ctx = {}) {
  const env = baseEnvelope(ctx);
  const permissionLimits = ctx.permission_limits || [];
  const withElements = (r, extra = {}) => ({
    ...r,
    four_elements: {
      condition: env.query_condition ?? "",
      source: env.source_id ?? "",
      time_point: extra.time_point || env.queried_at,
      limits: [...permissionLimits, ...(extra.limits || [])],
    },
  });

  if (!payload || typeof payload !== "object") {
    return withElements(
      notOk(env, {
        result_status: "fail",
        fail_reason: `返回体为空或不可解析（${NO_SUBSTITUTE_NOTE}）`,
        payload,
      }),
    );
  }
  if (payload.__transport_error) {
    return withElements(
      notOk(env, {
        result_status: "fail",
        fail_reason: `调用失败：${payload.__transport_error}（${NO_SUBSTITUTE_NOTE}）`,
        payload,
      }),
    );
  }

  const status = payload.result_status ?? payload.status ?? null;
  const limits = collectLimits(payload);
  const coverageActual =
    payload.data && payload.data.coverage && payload.data.coverage.actual ? payload.data.coverage.actual : null;
  // §6.7：时点写**实际覆盖区间**，不写请求区间
  const timePoint = String(coverageActual || env.queried_at);

  // 协议面 5 —— 权限拒绝形态（由外部系统拒绝时出现，与 F-23 事前判定同形态）
  if (status === "restricted") {
    return withElements(
      notOk(env, {
        result_status: "fail",
        fail_reason: payload.fail_reason || payload.reason_text || "权限未开通",
        restricted_flag: 1,
        retry_count: payload.retry_count,
        payload,
      }),
      { time_point: env.queried_at },
    );
  }
  if (status === "fail") {
    return withElements(
      notOk(env, {
        result_status: "fail",
        fail_reason: payload.fail_reason || "外部返回失败（未给出具体原因）",
        restricted_flag: payload.restricted_flag ? 1 : 0,
        retry_count: payload.retry_count,
        payload,
      }),
      { time_point: env.queried_at },
    );
  }
  if (status === "running") {
    return withElements(
      notOk(env, {
        result_status: "running",
        fail_reason: null,
        retry_count: payload.retry_count,
        payload,
      }),
      { time_point: env.queried_at },
    );
  }
  if (status !== "ok") {
    return withElements(
      notOk(env, {
        result_status: "fail",
        fail_reason: `返回体状态无法识别（${String(status)}，${NO_SUBSTITUTE_NOTE}）`,
        payload,
      }),
    );
  }

  // ok 分支：仍可能带「限制」「截断」「隔离」，但**成功不算失败**
  const split = splitEntities(payload, env.queried_at);
  let data = payload.data ?? null;
  if (split.rows) data = { ...payload.data, rows: split.rows };
  const returned =
    Number.isInteger(payload.returned_rows) && !split.rows
      ? payload.returned_rows
      : split.rows
        ? split.rows.length
        : 0;
  return withElements(
    {
      ...env,
      result_status: "ok",
      result_summary: payload.result_summary ?? null,
      returned_rows: returned,
      fail_reason: null,
      retry_count: Number.isInteger(payload.retry_count) ? payload.retry_count : 0,
      restricted_flag: payload.restricted_flag ? 1 : 0,
      data,
      isolated: split.isolated,
      raw_response: payload,
    },
    { time_point: timePoint, limits },
  );
}
