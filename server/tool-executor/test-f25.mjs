#!/usr/bin/env node
/**
 * 文档卡（阶段2 · M5 · F-25 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M5.md`（**TC-D-M5-005 / TC-I-M5-003 = F-25 验收 oracle**）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md` F-25（每次执行把条件/来源/时点/结果或失败原因写入任务记录；
 *        验收要点：**失败也留痕；记录可回查**；§4 约束 3「失败也留痕，运行失败不作为否定 HVA 的依据」）
 *   ｜ `../../docs/03-locks/schema.md` EXT-01 `query_record`（L700-714：`query_id` PK 形如 `Q-90217`、
 *        `task_id` FK→PD-01、`source_id` FK→CFG-01、`query_condition` 须完整到可复现、
 *        `result_status` 走 `dict:QUERY_STATUS`、`result_summary` **失败时为空**、`restricted_flag` 0/1、
 *        `message_id` FK→PD-07）、§12 Q-10（EXT-01 不承载「限制」）
 *   ｜ `../../docs/03-locks/external-deps.md` §6（mock 契约七类行为 + 超时失败 + 执行中）
 *   ｜ `./index.js`（F-23 权限判定 / F-24 编排 / **F-25 落痕**）｜ `./mcp-client.js`（F-24 传输层）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-25 用例并断言。
 * 硬红线：本地内存库 + 注入式 transport，**零真实外部调用、零生产写**（写只写本地内存库的 EXT-01）；
 *   **数值以契约基准 v1（ADR-004）为准**，只断字段形态、映射语义、字典值域与留痕完整性。
 * 边界：只验 F-25；失败重试与暂停（F-26）不在本执行器范围。
 * 反向清单：登记 `../README.md` 与本目录 `README.md`；被 CI `validate` 步骤复用（`node server/tool-executor/test-f25.mjs`）。
 *
 * 用法：node server/tool-executor/test-f25.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  checkToolPermission,
  executeQuery,
  registerPermission,
  PersistSkip,
  queryStatusDict,
  nextQueryId,
  saveQueryRecord,
  getQueryRecord,
  listQueryRecords,
  readbackQuery,
  recordQuery,
} from "./index.js";
import { mapResponseToResult } from "./mcp-client.js";
import { SCENARIOS, defaultOk } from "../../prototype/mock/scenarios.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);

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

const G = { grantee_type: "agent", grantee_ref: "qa-f25-agent" };
const TASK = "T-1022";

/** 让某工具可被允许：启用工具 + 其来源 MCP 化 + 可用 + 给 G 一条有效期内的允许授权。 */
async function allow(db, tool_id, source_id) {
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = ?").bind(tool_id).run();
  await db
    .prepare("UPDATE source_registry SET is_mcp_ready = 1, availability_status = 'ok' WHERE source_id = ?")
    .bind(source_id)
    .run();
  await registerPermission(db, {
    permission_id: `PERM-F25-${tool_id}`,
    grantee_type: G.grantee_type,
    grantee_ref: G.grantee_ref,
    tool_id,
    allow_flag: 1,
    effective_from: "2026-01-01 00:00",
    effective_until: null,
  });
}

/** 固定返回体的 transport：`payloads` 为 force_behavior → payload。 */
function transportOf(payloads) {
  const t = async function ({ force_behavior }) {
    t.calls.push({ force_behavior });
    const p = force_behavior ? payloads[force_behavior] : payloads.default;
    if (p === undefined) return { result_status: "fail", fail_reason: "mock 未定义该行为" };
    return JSON.parse(JSON.stringify(p));
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
async function assertThrows(fn, label, match = null) {
  try {
    await fn();
    fail++; console.log(`  ✗ ${label}（未抛错）`);
  } catch (e) {
    const ok = !match || String(e.message).includes(match);
    if (ok) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}（错误信息不含「${match}」：${String(e.message)}）`); }
  }
}
const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==================================================== ① 值域不内联 + query_id 形制
console.log("① EXT-01 主键形制与值域来源（schema §0.4 第 1 条 / §11 字典）");
{
  const { sqlite, db } = freshDb();
  const statuses = await queryStatusDict(db);
  assert(statuses.join("/") === "ok/fail/running", `result_status 值域取自 dict:QUERY_STATUS（实测 ${statuses.join("/")}）`);
  const next = await nextQueryId(db);
  assert(/^Q-\d{5}$/.test(next), `query_id 形如 Q-90217（实测 ${next}）`);
  const maxSeed = sqlite.prepare("SELECT MAX(query_id) m FROM query_record").get().m;
  assert(Number(next.slice(2)) === Number(String(maxSeed).slice(2)) + 1, `接种子最大值递增（${maxSeed} → ${next}）`);
  await saveQueryRecord(db, mapResponseToResult(defaultOk("cdp.crowd.query", "CDP"),
    { task_id: TASK, source: { source_id: "CDP" }, query_condition: "{}", queried_at: "2026-09-19 09:00:00" }),
    { task_id: TASK });
  assert(Number((await nextQueryId(db)).slice(2)) === Number(next.slice(2)) + 1, "落一行后再取号继续递增，不撞号");
}

// ==================================================== ② TC-D-M5-005 task_id / source_id 外键
console.log("\n② TC-D-M5-005 · EXT-01：task_id / source_id 不存在 → FK 失败");
{
  const { db } = freshDb();
  const env = mapResponseToResult(defaultOk("cdp.crowd.query", "CDP"),
    { task_id: TASK, source: { source_id: "CDP" }, query_condition: "{}", queried_at: "2026-09-19 09:00:00" });

  await assertThrows(
    () => saveQueryRecord(db, env, { task_id: "T-NOPE" }),
    "task_id 不存在 → 库级 FK 拒绝", "FOREIGN KEY",
  );
  await assertThrows(
    () => saveQueryRecord(db, { ...env, source_id: "SRC-NOPE" }, { task_id: TASK }),
    "source_id 不存在 → 库级 FK 拒绝", "FOREIGN KEY",
  );
  const ok = await saveQueryRecord(db, env, { task_id: TASK });
  assert(ok && ok.query_id, `真实任务 + 真实来源可落（${ok.query_id}）`);
  await assertThrows(
    () => saveQueryRecord(db, env, { task_id: TASK, message_id: "MSG-NOPE" }),
    "message_id 不存在 → FK 拒绝（追问触发链可回认）", "FOREIGN KEY",
  );
  const withMsg = await saveQueryRecord(db, env, { task_id: TASK, message_id: "MSG-001" });
  assert(withMsg.message_id === "MSG-001", "真实追问消息可落（message_id FK→PD-07）");
}

// ==================================================== ③ TC-I-M5-003 成功也落、字段齐全、原样保留
console.log("\n③ TC-I-M5-003 · 执行落库：条件 / 来源 / 时点 / 结果（成功分支）");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const before = countRows(sqlite, "query_record");
  const cond = { biz: "超市", granularity: "天" };
  const r = await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: cond, at: "2026-09-19 10:00:00",
    transport: transportOf({ default: defaultOk("cdp.crowd.query", "CDP") }),
  });
  assert(r.persisted === true && !!r.query_id, `recordQuery 落痕成功（${r.query_id}）`);
  assert(countRows(sqlite, "query_record") === before + 1, "恰好新增一行（不重复落）");

  const rec = await getQueryRecord(db, r.query_id);
  assert(rec.task_id === TASK, "落痕归属真实任务");
  assert(rec.source_id === "CDP", "落痕锚定来源系统（四要素之「来源」）");
  assert(String(rec.query_condition).includes("超市"), "查询条件完整落库且可复现（四要素之「条件」）");
  assert(rec.queried_at === "2026-09-19 10:00:00", "取数时点落库（四要素之「时点」）");
  assert(rec.result_status === "ok" && rec.result_summary === r.envelope.result_summary,
    "结果摘要原样落库（**不用模型预期替代真实返回**）");
  assert(rec.created_at && rec.created_at !== rec.queried_at ? true : !!rec.created_at, "created_at 入库时点已写");
  assert(rec.restricted_flag === 0 && rec.retry_count === 0, "允许分支：restricted_flag=0 / retry_count=0");
  assert(rec.result_summary === null || !String(rec.result_summary).includes("预期"), "结果里没有模型预期字样");
}

// ==================================================== ④ TC-I-M5-003 失败也留痕（含受限 / 执行中 / 超时）
console.log("\n④ TC-I-M5-003 · **失败也留痕**：失败 / 受限 / 执行中 / 超时 四类逐一验证");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  await allow(db, "TOL-02", "CDP");
  const before = countRows(sqlite, "query_record");
  const beforeFail = (await listQueryRecords(db, { task_id: TASK, result_status: "fail" })).length;

  // 4.1 外部返回失败
  const failEnv = await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "人群×行为", at: "2026-09-19 11:00:00",
    transport: transportOf({ default: SCENARIOS.timeout_fail("cdp.crowd.query") }),
  });
  assert(failEnv.persisted === true, "外部返回失败 → **仍然落痕**");
  assert(failEnv.record.result_status === "fail", "result_status=fail 如实登记");
  assert(!!failEnv.record.fail_reason, `失败原因落库（可回查）：${String(failEnv.record.fail_reason).slice(0, 24)}…`);
  assert(failEnv.record.result_summary === null, "失败时 result_summary 为空（EXT-01 口径）");

  // 4.2 权限受限（外部系统拒答 / F-23 事前判定）
  const restricted = await recordQuery(db, {
    tool_id: "TOL-02", ...G, task_id: TASK, query_condition: "受限条件", at: "2026-09-19 11:05:00",
    transport: transportOf({ default: SCENARIOS.restricted("cdp.crowd.insight") }),
  });
  assert(restricted.persisted === true, "受限返回 → 仍然落痕");
  assert(restricted.record.restricted_flag === 1, "restricted_flag=1 如实登记");
  assert(restricted.record.result_status === "fail" && !!restricted.record.fail_reason, "受限按失败态登记且带具体原因");

  // 4.3 执行中（非终态，不等于失败）
  const running = await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "长跑查询", at: "2026-09-19 11:10:00",
    transport: transportOf({ default: SCENARIOS.running("cdp.crowd.query") }),
  });
  assert(running.persisted === true, "执行中 → 仍然落痕");
  assert(running.record.result_status === "running", "running 如实登记（非终态不判失败）");
  assert(running.record.fail_reason === null, "running 的 fail_reason 为空（未被误判失败）");

  // 4.4 传输层超时
  const timeout = await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "超时查询", at: "2026-09-19 11:15:00",
    transport: async () => { throw new Error("模拟网络异常"); },
  });
  assert(timeout.persisted === true, "传输层异常 → 仍然落痕");
  assert(timeout.record.result_status === "fail" && String(timeout.record.fail_reason).includes("调用失败"),
    "异常原因落库，不留无原因的失败");

  // 4.5 F-23 事前判定不允许：不落租（无执行），但必须显式说明为什么没落
  const deniedTool = await recordQuery(db, {
    tool_id: "TOL-99", ...G, task_id: TASK, query_condition: "未登记工具", at: "2026-09-19 11:20:00",
    transport: transportOf({ default: defaultOk() }),
  });
  assert(deniedTool.persisted === false, "工具未登记（未发生执行）→ 不冒充一次查询留痕");
  assert(deniedTool.persist_skip?.reason_code === "tool_not_found",
    "未留痕有显式理由码（reason_code=tool_not_found），不静默丢");

  assert(countRows(sqlite, "query_record") === before + 4,
    `四次**真实执行**各落一行（实测 +${countRows(sqlite, "query_record") - before}）`);
  const fails = await listQueryRecords(db, { task_id: TASK, result_status: "fail" });
  assert(fails.length === beforeFail + 3,
    `失败（含受限）逐条可回查：基线 ${beforeFail} → 实测 ${fails.length}（本次 +3）`);
  assert(fails.every((r) => !!r.fail_reason), "回查到的失败记录**每一条都带原因**（无原因失败不留痕）");
}

// ==================================================== ⑤ 留痕不变量： falsifiable dots
console.log("\n⑤ 留痕不变量：失败无原因 / 空条件 / 值域外 / 无 task 一律拒落");
{
  const { db } = freshDb();
  const statuses = await queryStatusDict(db);
  const base = mapResponseToResult(defaultOk("cdp.crowd.query", "CDP"),
    { task_id: TASK, source: { source_id: "CDP" }, query_condition: "{}", queried_at: "2026-09-19 12:00:00" });

  await assertThrows(
    () => saveQueryRecord(db, { ...base, result_status: "fail", fail_reason: null, result_summary: null }, { task_id: TASK }),
    "失败但无 fail_reason → 拒落（失败也留痕 ≠ 留了等于没留）", "失败必须带具体原因",
  );
  await assertThrows(
    () => saveQueryRecord(db, { ...base, query_condition: "   " }, { task_id: TASK }),
    "查询条件为空 → 拒落（记录不可复现）", "无法复现",
  );
  await assertThrows(
    () => saveQueryRecord(db, { ...base, result_status: "done" }, { task_id: TASK }),
    `result_status 不在 dict:QUERY_STATUS（${statuses.join("/")}）→ 拒落`, "dict:QUERY_STATUS",
  );
  await assertThrows(
    () => saveQueryRecord(db, { ...base, returned_rows: -1 }, { task_id: TASK }),
    "returned_rows < 0 → 拒落", "≥0",
  );
  await assertThrows(
    () => saveQueryRecord(db, { ...base, task_id: null }, {}),
    "缺 task_id → 拒落（每条查询须归属真实任务）", "task_id 必填",
  );
  try {
    await saveQueryRecord(db, { ...base, source_id: null, reason_code: "tool_not_found" }, { task_id: TASK });
    fail++; console.log("  ✗ 无 source_id → 抛 PersistSkip");
  } catch (e) {
    assert(e instanceof PersistSkip && e.reason_code === "tool_not_found", "无 source_id → 抛 PersistSkip 并带理由码（Q-11）");
  }
}

// ==================================================== ⑥ 回查（TC-I-M5-003「记录可回查」）
console.log("\n⑥ 记录可回查 + 四要素派生 + Q-10「限制」不入库");
{
  const { db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const baseTaskRows = (await listQueryRecords(db, { task_id: TASK })).length;
  const a = await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "乳品新客", at: "2026-09-19 13:00:00",
    transport: transportOf({ default: defaultOk("cdp.crowd.query", "CDP") }),
  });
  const b = await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "乳品新客", at: "2026-09-19 13:05:00",
    transport: transportOf({ default: SCENARIOS.timeout_fail("cdp.crowd.query") }),
  });
  const rb = await readbackQuery(db, a.query_id);
  assert(rb && rb.record.query_id === a.query_id, "按 query_id 回查到该行");
  assert(rb.four_elements.condition.includes("乳品新客") && rb.four_elements.source === "CDP" &&
    rb.four_elements.time_point === "2026-09-19 13:00:00", "回查派生四要素：条件 / 来源 / 时点齐全");
  assert(rb.limits_not_persisted === true, "「限制」不入库（Q-10 方向②），回查显式标出");
  const byTask = await listQueryRecords(db, { task_id: TASK });
  assert(byTask.length === baseTaskRows + 2,
    `按任务回查：种子基线 ${baseTaskRows} 行 + 本次落 ${byTask.length - baseTaskRows} 行`);
  assert(byTask[0].query_id > byTask[1].query_id, "列表排序稳定（query_id DESC）");
  const byFail = await listQueryRecords(db, { task_id: TASK, result_status: "fail" });
  assert(byFail.length === 1 && byFail[0].query_id === b.query_id, "按任务 + 状态复合回查命中失败那条");
  const missing = await readbackQuery(db, "Q-00000");
  assert(missing === null, "回查不存在的 query_id 返回 null（不伪造记录）");
}

// ==================================================== ⑦ 生产零写（BRD §5.3 硬红线 / TC-I-M5-005）
console.log("\n⑦ TC-I-M5-005 · 生产零写：落痕只写本地库 EXT-01，传输层仍零 SQL 零写");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  let called = 0;
  await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "零写验证", at: "2026-09-19 14:00:00",
    transport: async () => { called++; return JSON.parse(JSON.stringify(SCENARIOS.empty)); },
  });
  assert(called === 1, "外部调用仍只有一次查询（POST），未因落痕重复调用");
  const touched = ["tool_registry", "tool_permission", "source_registry"].map((t) => `${t}:${countRows(sqlite, t)}`);
  const before = countRows(sqlite, "query_record");
  await recordQuery(db, {
    tool_id: "TOL-01", ...G, task_id: TASK, query_condition: "零写验证2", at: "2026-09-19 14:05:00",
    transport: transportOf({ default: SCENARIOS.empty("cdp.crowd.query") }),
  });
  assert(countRows(sqlite, "query_record") === before + 1, "第二次执行再落一行（每次执行各一行，非覆盖）");
  const after = ["tool_registry", "tool_permission", "source_registry"].map((t) => `${t}:${countRows(sqlite, t)}`);
  assert(touched.join("|") === after.join("|"), `配置表未被落痕流程改动（${touched.join(" / ")}）`);
  const permAgain = await checkToolPermission(db, { tool_id: "TOL-01", ...G, at: "2026-09-19 14:10:00" });
  assert(permAgain.allowed === true, "落痕不影响权限判定结果（读写分离）");
}

finish();
