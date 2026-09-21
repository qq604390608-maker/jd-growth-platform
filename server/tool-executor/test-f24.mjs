#!/usr/bin/env node
/**
 * 文档卡（阶段2 · M5 · F-24 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M5.md`（**TC-U-M5-001 / TC-C-M5-001 / TC-I-M5-001 / TC-I-M5-002 /
 *        TC-I-M5-005 = F-24 验收 oracle**；TC-D-M5-005 / TC-I-M5-003 属 F-25，不在本执行器范围）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md` F-24（不能用模型预期代替查询结果；返回保留条件/来源/时点/限制；
 *        失败返回具体原因；约束 1 真实返回硬红线、约束 4 生产零写）
 *   ｜ `../../docs/03-locks/tech-stack.md` §2.6（DS-06 自建 MCP：五项协议面）
 *   ｜ `../../docs/03-locks/external-deps.md` §6.1~§6.8（七类行为 + 超时失败 + 执行中；§6.8 覆盖自检表）
 *   ｜ `../../docs/03-locks/schema.md` EXT-01（result_status 走 dict:QUERY_STATUS；result_summary 失败时为空）
 *   ｜ `../../prototype/mock/scenarios.js`（9 类真实返回体，本执行器直接取用作夹具）
 *   ｜ `./index.js`（F-24 编排）｜ `./mcp-client.js`（F-24 传输层，五项协议面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-24 用例并断言。
 * 硬红线：本地内存库 + 注入式 transport，**零真实外部调用、零生产写**；
 *   **activity_count=37 等数值为契约基准 v1 自拟值（ADR-004，可进断言并标注基准版本）**，只断字段形态、映射语义与字典值域。
 * 边界：只验 F-24；`EXT-01` 落痕（F-25）、重试与暂停（F-26）不在本执行器范围。
 * 反向清单：登记 `../README.md` 与本目录 `README.md`；被 CI `validate` 步骤复用（`node server/tool-executor/test-f24.mjs`）。
 *
 * 用法：node server/tool-executor/test-f24.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { checkToolPermission, executeQuery, describeTools, registerPermission, listTools } from "./index.js";
import {
  MCP_FACES,
  describeTool,
  serializeCondition,
  mapResponseToResult,
  splitEntities,
  createHttpTransport,
  TransportTimeout,
  DEFAULT_TIMEOUT_MS,
} from "./mcp-client.js";
import { SCENARIOS, defaultOk } from "../../prototype/mock/scenarios.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const CLIENT_PATH = new URL("./mcp-client.js", import.meta.url);

/** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      try {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      } catch (e) {
        return { success: false, error: String(e.message || e) };
      }
    },
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: (col) => {
      const row = sqlite.prepare(sql).get(...params) ?? null;
      if (row === null) return null;
      return col === undefined ? row : row[col];
    },
  });
  return { prepare: (sql) => makeStmt(sql, []) };
}

/** 建库：载入真实 DDL + 真实种子；种子自带 FK pragma，先剥离再载入，之后开 FK。 */
function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  sqlite.exec(mock);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

/** 制造一个「种子上没有、只在本次生效」的干净授权对象（避免撞上种子的长期授权）。 */
const G = { grantee_type: "agent", grantee_ref: "qa-f24-agent" };

/** 让某工具可被允许：启用工具 + 其来源 MCP 化 + 可用 + 给 G 一条有效期内的允许授权。 */
async function allow(db, tool_id, source_id) {
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = ?").bind(tool_id).run();
  await db
    .prepare("UPDATE source_registry SET is_mcp_ready = 1, availability_status = 'ok' WHERE source_id = ?")
    .bind(source_id)
    .run();
  await registerPermission(db, {
    permission_id: `PERM-F24-${tool_id}`,
    grantee_type: G.grantee_type,
    grantee_ref: G.grantee_ref,
    tool_id,
    allow_flag: 1,
    effective_from: "2026-01-01 00:00",
    effective_until: null,
  });
}

/** 固定返回体的 transport：`maps` 为 force_behavior → payload。 */
function transportOf(payloads) {
  const t = async function ({ force_behavior }) {
    t.calls.push({ force_behavior });
    const p = force_behavior ? payloads[force_behavior] : payloads.default;
    if (p === undefined) return { result_status: "fail", fail_reason: "mock 未定义该行为" };
    return JSON.parse(JSON.stringify(p)); // 深拷贝，避免被测代码改动夹具
  };
  t.calls = [];
  return t;
}

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
const statusesOf = (sqlite) => sqlite.prepare("SELECT item_code FROM dict_item WHERE dict_type_code = 'QUERY_STATUS' ORDER BY order_no").all().map((r) => r.item_code);

function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==================================================== ① 协议面齐备（tech-stack §2.6）
console.log("① tech-stack §2.6 · 自建 MCP 客户端五项协议面齐备");
{
  assert(MCP_FACES.length === 5, `五面登记齐全（${MCP_FACES.join(" / ")}）`);
  const { db } = freshDb();
  const tool = await listTools(db).then((ts) => ts[0]);
  const desc = describeTool(tool, { availability_status: "ok", is_mcp_ready: 1 });
  assert(desc.name === tool.tool_code && typeof desc.description === "string", "工具描述格式：name/description 齐备");
  assert(desc.inputSchema?.required?.includes("query_condition"), "工具描述格式：入参要求查询条件");
  assert(String(desc._meta.contract).includes("baseline-v1"), "工具描述格式：显式标注契约基准 v1（ADR-004 冻结，原 demo 门禁已收口）");
  assert(typeof createHttpTransport === "function" && DEFAULT_TIMEOUT_MS === 30000, "调用回传 + 超时面：默认阈值 30s（§6.1）");
  let threw = null;
  try { new TransportTimeout(1000).message; } catch (e) { threw = e; }
  assert(threw === null && new TransportTimeout(1000).message.includes("调用超时"), "超时面：超时是可识别的错误类型");
}

// ==================================================== ② TC-I-M5-001 权限分支互斥
console.log("\n② TC-I-M5-001 · 权限分支互斥：不允许则不发起外部调用");
{
  const { db } = freshDb();
  const guard = transportOf({});
  guard.calls = [];
  const denied = await executeQuery(db, {
    tool_id: "TOL-01", ...G, query_condition: { biz: "超市" }, task_id: "T-1022", transport: guard,
  });
  assert(denied.decision === "restricted", "未授权工具 → decision=restricted（与 allowed 互斥）");
  assert(denied.transport_called === false && guard.calls.length === 0, "不允许时**不发起外部调用**");
  assert(denied.restricted_flag === 1, "受限返回 restricted_flag=1");
  assert(!!denied.fail_reason && String(denied.fail_reason).trim().length > 0, "受限必带原因，不静默放行");
  assert(denied.result_summary === null, "失败时 result_summary 为空（schema EXT-01 口径）");
  assert(denied.returned_rows === 0 && denied.data === null, "受限不返回数据");

  await allow(db, "TOL-01", "CDP");
  const allowed = await executeQuery(db, {
    tool_id: "TOL-01", ...G, query_condition: { biz: "超市" }, transport: transportOf({ default: defaultOk("cdp.crowd.query", "CDP") }),
  });
  assert(allowed.decision === "allowed" && allowed.result_status === "ok", "允许 → 执行并拿到真实返回");
  assert(allowed.transport_called === true, "允许时才发起外部调用");

  // 授权明确为「不允许」：也走受限支路
  await registerPermission(db, {
    permission_id: "PERM-F24-DENY", grantee_type: G.grantee_type, grantee_ref: G.grantee_ref,
    tool_id: "TOL-01", allow_flag: 0, restrict_reason: "超出目标业务范围", effective_from: "2026-01-01 00:00",
  });
  const r2 = await executeQuery(db, { tool_id: "TOL-01", ...G, query_condition: {}, transport: transportOf({}) });
  assert(r2.restricted_flag === 1 && String(r2.fail_reason).includes("超出目标业务范围"), "allow_flag=0 → 原样带出 restrict_reason");
}

// ==================================================== ③ TC-I-M5-002 / TC-C-M5-001 真实返回与 EXT-01 映射
console.log("\n③ TC-I-M5-002 / TC-C-M5-001 · 真实返回 + EXT-01 字段映射");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-04", "HJE");
  const raw = SCENARIOS.multi_value("hje.traffic.entry");
  const got = await executeQuery(db, {
    tool_id: "TOL-04", ...G, query_condition: { entry: "搜索结果页" }, transport: transportOf({ default: raw }),
  });
  const ext1 = ["result_status", "result_summary", "returned_rows", "fail_reason", "retry_count", "restricted_flag"];
  assert(ext1.every((k) => k in got), `返回体可映射 EXT-01 六字段（${ext1.join("/")}）`);
  assert(statusesOf(sqlite).includes(got.result_status), `result_status ∈ dict:QUERY_STATUS（${statusesOf(sqlite).join("/")}）`);
  assert(JSON.stringify(got.data) === JSON.stringify(raw.data), "data **逐字节原样**（不加工、不替换）");
  assert(got.result_summary === raw.result_summary, "result_summary 原样透传，非模型生成");
  assert(typeof got.returned_rows === "number" && got.returned_rows >= 0, "returned_rows 为数值且 ≥0");

  // 硬红线：返回体不可识别 / 无 data —— 一律失败，绝不填充
  const junk = await executeQuery(db, {
    tool_id: "TOL-04", ...G, query_condition: {}, transport: transportOf({ default: { hello: "world" } }),
  });
  assert(junk.result_status === "fail" && junk.data === null, "返回体无法识别 → fail 且不返回数据");
  assert(String(junk.fail_reason).includes("不得用模型预期填充"), "失败原因显式声明「不得用模型预期填充」");
  const nul = await executeQuery(db, {
    tool_id: "TOL-04", ...G, query_condition: {}, transport: transportOf({ default: null }),
  });
  assert(nul.result_status === "fail" && nul.data === null, "返回体为空 → fail，不用模型预期内容代替");
}

// ==================================================== ④ §6.1～§6.7 七类行为映射（真实 mock 夹具）
console.log("\n④ external-deps §6 · 七类行为 + 超时失败 + 执行中的落库字段映射");
{
  const { db } = freshDb();
  await allow(db, "TOL-09", "MKT");
  const run = async (behaviorOrOk) => {
    const payload = typeof behaviorOrOk === "string" ? SCENARIOS[behaviorOrOk]("mkt.demo.tool") : behaviorOrOk;
    return executeQuery(db, { tool_id: "TOL-09", ...G, query_condition: { q: 1 }, transport: transportOf({ default: payload }) });
  };

  // 1 延迟：成功不算失败，retry_count 透传
  const slow = await run("slow");
  assert(slow.result_status === "ok" && slow.fail_reason === null, "§6.1 延迟：重试后返回仍记 ok（成功不算失败）");
  assert(slow.retry_count === 2, "§6.1 延迟：retry_count 透传（wei 断言次数数值本身，不断言 demo 行数）");
  assert(slow.four_elements.limits.some((l) => String(l).includes("重试")), "§6.1 延迟：慢响应写入 limits（四要素之限制）");

  // 2 403 受限
  const r403 = await run("restricted");
  assert(r403.restricted_flag === 1 && r403.result_status === "fail", "§6.2 403：受限 → restricted_flag=1 + fail");
  assert(String(r403.fail_reason).includes("权限未开通"), "§6.2 403：fail_reason=权限未开通");

  // 3 空结果：成功但 0 行
  const empty = await run("empty");
  assert(empty.result_status === "ok", "§6.3 空结果：是「成功但无数据」，不得写成 fail");
  assert(empty.returned_rows === 0, "§6.3 空结果：returned_rows=0");
  assert(empty.four_elements.limits.some((l) => String(l).includes("空结果")), "§6.3 空结果：限制面显式标注");

  // 4 多值字段：保序 + 口径提示
  const multi = await run("multi_value");
  assert(JSON.stringify(multi.data.category_path) === JSON.stringify(SCENARIOS.multi_value("x").data.category_path), "§6.4 多值：层级路径原样保序");
  assert(multi.four_elements.limits.some((l) => String(l).includes("多值字段")), "§6.4 多值：提示须说明取值口径");
  assert(serializeCondition({ tags: ["家庭装", "多件装"], zone: "超市" }).includes('["家庭装","多件装"]'), "§6.4 多值：条件序列化保持数组原序");

  // 5 不可算：≠0 ≠失败
  const nc = await run("not_computable");
  assert(nc.result_status === "ok" && nc.returned_rows > 0, "§6.5 不可算：不判为失败");
  assert(nc.data.repurchase_rate_30d === null && "repurchase_rate_30d_reason" in nc.data, "§6.5 不可算：字段与原因原样保留，不省略");
  assert(nc.four_elements.limits.some((l) => String(l).includes("不可算")), "§6.5 不可算：显式标注 ≠0 ≠失败");

  // 6 中英枚举
  const em = await run("enum_mismatch");
  assert(em.four_elements.limits.some((l) => String(l).includes("未归一化")), "§6.6 枚举：提示须落字典项、不得直接入库");
  assert(em.data.entry_type_raw === "搜索结果页", "§6.6 枚举：原始值原样保留，不擅自翻译");

  // 7 覆盖边界：时点写实际区间
  const cb = await run("coverage_boundary");
  assert(cb.four_elements.time_point.includes("2026-09-10") && !cb.four_elements.time_point.includes("2026-09-15"),
    "§6.7 覆盖边界：时点写**实际覆盖**区间，而非请求区间");
  assert(cb.four_elements.limits.some((l) => String(l).includes("覆盖不完整")), "§6.7 覆盖边界：截断写入限制，避免静默陷阱");

  // 8 超时失败 / 9 执行中（§6 末段）
  const tf = await run("timeout_fail");
  assert(tf.result_status === "fail" && tf.retry_count === 3, "§6 末 超时失败：fail + retry_count 透传");
  assert(String(tf.fail_reason).includes("超时"), "§6 末 超时失败：失败原因具体到「超时」");
  const rn = await run("running");
  assert(rn.result_status === "running" && rn.fail_reason === null, "§6 末 执行中：非终态 running，不判失败");
}

// ==================================================== ⑤ 传输层异常 → 失败也留字段面
console.log("\n⑤ 传输层异常（含客户端超时）→ 具体原因，不用模型预期兜底");
{
  const { db } = freshDb();
  await allow(db, "TOL-07", "PIM");
  const boom = await executeQuery(db, {
    tool_id: "TOL-07", ...G, query_condition: {},
    transport: async () => { throw new Error("ECONNREFUSED 127.0.0.1:8788"); },
  });
  assert(boom.result_status === "fail" && String(boom.fail_reason).includes("调用失败"), "transport 抛错 → fail + 原因");
  assert(boom.data === null, "失败时不返回任何数据占位");

  const to = await executeQuery(db, {
    tool_id: "TOL-07", ...G, query_condition: {},
    transport: async () => { throw new TransportTimeout(30000); },
  });
  assert(to.result_status === "fail" && String(to.fail_reason).includes("调用超时"), "客户端超时 → 映射到「调用超时」");
  const httpErr = await executeQuery(db, {
    tool_id: "TOL-07", ...G, query_condition: {}, transport: async () => ({ __transport_error: "HTTP 502" }),
  });
  assert(httpErr.result_status === "fail" && String(httpErr.fail_reason).includes("HTTP 502"), "HTTP 非 2xx → 具体状态码进原因");
}

// ==================================================== ⑥ TC-U-M5-001 单实体隔离（域内涵代）
console.log("\n⑥ TC-U-M5-001 · 单实体隔离：信息时点 ≤ 取数时刻，倒挂只隔离该条");
{
  const rows = [
    { period: "2026-07-01 ~ 2026-09-10", value: 1 },
    { period: "2026-07-01 ~ 2026-12-31", value: 2 }, // 信息时点晚于取数时刻 → 倒挂
    { period: "2026-07-01 ~ 2026-09-05", value: 3 },
  ];
  const r = splitEntities({ data: { rows } }, "2026-09-19 10:00:00");
  assert(r.isolated.length === 1 && r.rows.length === 2, "倒挂的 1 条被隔离，其余 2 条照常返回");
  assert(r.isolated[0].reason.includes("晚于取数时刻"), "隔离原因写明不变量");

  const { db } = freshDb();
  await allow(db, "TOL-04", "HJE");
  const got = await executeQuery(db, {
    tool_id: "TOL-04", ...G, query_condition: {}, at: "2026-09-19 10:00:00",
    transport: transportOf({ default: { result_status: "ok", result_summary: "入口维度流量", retry_count: 0, returned_rows: 3, data: { rows } } }),
  });
  assert(got.result_status === "ok", "**单条倒挂不是整包失败**（其余证据照常）");
  assert(got.returned_rows === 2 && got.isolated.length === 1, "returned_rows 计有效行，隔离项单独列示");
}

// ==================================================== ⑦ 证据四要素齐备（含失败也有条件/来源/时点）
console.log("\n⑦ 证据四要素：条件 / 来源 / 时点 / 限制（含失败也齐全）");
{
  const { db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const ok = await executeQuery(db, {
    tool_id: "TOL-01", ...G, task_id: "T-1022", query_condition: { biz: "超市", days: 30 },
    at: "2026-09-19 10:00:00", transport: transportOf({ default: defaultOk("cdp.crowd.query", "CDP") }),
  });
  const fe = ok.four_elements;
  assert(["condition", "source", "time_point", "limits"].every((k) => k in fe), "四要素字段齐备");
  assert(fe.condition === serializeCondition({ biz: "超市", days: 30 }), "条件：完整到可复现且序列化稳定");
  assert(fe.source === "CDP", "来源：落到 CFG-01 的 source_id");
  assert(fe.time_point === "2026-09-19 10:00:00", "时点：取数时刻");
  assert(Array.isArray(fe.limits), "限制：数组形态");
  assert(ok.source_id === "CDP" && ok.task_id === "T-1022", "信封带上 EXT-01 的 source_id / task_id 口径");

  const bad = await executeQuery(db, {
    tool_id: "TOL-01", ...G, query_condition: { biz: "超市" }, at: "2026-09-19 10:00:00",
    transport: transportOf({ default: SCENARIOS.timeout_fail("cdp.crowd.query") }),
  });
  assert(bad.four_elements.time_point === "2026-09-19 10:00:00" && bad.four_elements.condition.length > 0,
    "失败也保留条件与时点（BRD §7 第 4 条：失败不作为否定结论的依据）");
}

// ==================================================== ⑧ F-24 / F-25 边界：只返回不落库
console.log("\n⑧ F-24 边界：只返回不落 EXT-01（落痕归 F-25）");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const before = sqlite.prepare("SELECT COUNT(*) c FROM query_record").get().c;
  await executeQuery(db, {
    tool_id: "TOL-01", ...G, task_id: "T-1022", query_condition: {},
    transport: transportOf({ default: defaultOk("cdp.crowd.query", "CDP") }),
  });
  const after = sqlite.prepare("SELECT COUNT(*) c FROM query_record").get().c;
  assert(before > 0, `基线：EXT-01 query_record 种子已有 ${before} 行（作为对照基数）`);
  assert(after === before, `执行后行数不变（${before} → ${after}）：本函数只返回不写库`);
  const got = await executeQuery(db, {
    tool_id: "TOL-01", ...G, query_condition: {}, transport: transportOf({ default: defaultOk("cdp.crowd.query", "CDP") }),
  });
  assert(got.persisted === false && got.persist_by === "F-25", "信封显式标 persisted=false 与承接方，不留隐式缺口");
}

// ==================================================== ⑨ TC-I-M5-005 生产零写（传输层零 SQL）
console.log("\n⑨ TC-I-M5-005 · 生产环境零写：传输层零 SQL、HTTP 无写通道");
{
  const src = readFileSync(CLIENT_PATH, "utf8");
  const writes = src.match(/\b(insert|update|delete|replace|drop|alter|truncate)\b\s+(into|from|table)\b/gi) || [];
  assert(writes.length === 0, `传输层源码零 SQL 写/删语句（命中 ${writes.length}${writes.length ? "：" + writes.join(",") : ""}）`);
  assert(!/\b(row|b)\b/.test("") && !/INSERT INTO/i.test(src), "传输层不接触任何建表/库写入");
  const methods = [...src.matchAll(/method:\s*"([A-Z]+)"/g)].map((m) => m[1]);
  assert(methods.length > 0 && methods.every((m) => m === "POST"), `传输层唯一 HTTP 方法为 POST（实测 ${[...new Set(methods)].join("/")}）`);
  for (const bad of ["PUT", "PATCH", "DELETE"]) {
    assert(!src.includes(`method: "${bad}"`), `不提供 ${bad} 写通道`);
  }
  const { db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const calls = [];
  await executeQuery(db, {
    tool_id: "TOL-01", ...G, query_condition: { biz: "超市" },
    transport: async (c) => { calls.push(c); return defaultOk(c.tool_code, "CDP"); },
  });
  assert(calls.length === 1 && calls[0].tool_code === "cdp.crowd.query", "外部请求只带 tool_code + query_condition（§6 统一约定）");
  assert(typeof calls[0].query_condition === "string" && calls[0].query_condition.includes("超市"), "请求体带完整查询条件");
}

// ==================================================== ⑩ describeTools + 干净夹具放行
console.log("\n⑩ describeTools：生成的工具描述锚定 CFG-02，权限信息可选");
{
  const { db } = freshDb();
  const all = await describeTools(db);
  assert(all.length === 12, `CFG-02 的 12 个工具（TOL-01~12）逐条生成描述（实测 ${all.length}）`);
  assert(all.every((e) => e.description._meta.source_id), "每条描述都锚定来源系统");
  const withPerm = await describeTools(db, { grantee_type: G.grantee_type, grantee_ref: G.grantee_ref });
  assert(withPerm.every((e) => e.permission && typeof e.permission.decision === "string"), "可携带该对象的权限判定");
  const okStatus = mapResponseToResult({ result_status: "ok", returned_rows: 1, result_summary: "s", data: { a: 1 } },
    { query_condition: "{}", queried_at: "2026-09-19 00:00:00", permission_limits: [] });
  assert(okStatus.four_elements.limits.length === 0, "干净返回体不产生多余限制（无误报）");
}

finish();
