#!/usr/bin/env node
/**
 * 文档卡（阶段4 接线 · M1 · **F-34 单 tick 守卫用例** · 2026-09-21）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md` §四 · 期 2.1（F-34 验收：**步数配额 + 同 tick 去重 +
 *        单步超时，零 schema 变更**）＋ §三 P0-2（M3 步骤无独占 → 并发重跑 → 产出翻倍，93 条重复机会的成因）
 *   ｜ `../../docs/05-test-cases/test-M1.md` **TC-I-M1-001**（L5，「**任务程序决定何时启动**」）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-02 验收要点 ＋ CFG-04「频率 / 时长 / 调用限制」
 *   ｜ `../../docs/01-brd/BRD.md` §5.3（生产零写）
 *   ｜ `./tick-guard.js`（被测：`createTickGuard` / `withStepTimeout` / `TICK_QUOTA` / `STEP_TIMEOUT_MS`）
 *   ｜ `./executor.js`（被测：`runPendingWork` 的守卫接入）｜`./step-plan.js`（`TYPE_STEPS` 派生真源）
 *   ｜ `../tool-executor/index.js`（`DEFAULT_TIMEOUT_MS` 派生真源）｜`./schedule.js`（F-02 建发现任务夹具）
 *   ｜ `../../db/migrations/0001_init.sql` + `../../db/seed/0001_mock.sql`（真实 DDL + 种子，载入内存库）
 * 职责：验证 ① 静态（守卫零 SQL / 零数据库句柄 / import 恰好两处真源；`executor.js` 不复制第二份默认值；
 *   派生等式 `TICK_QUOTA`←`TYPE_STEPS`、`STEP_TIMEOUT_MS`←`DEFAULT_TIMEOUT_MS`）；② 守卫纯单元语义；
 *   ③ 单步超时（可注入 timer → **确定性**触发；未超时原样回传；超时后**迟到的拒绝不变成未处理拒绝**）；
 *   ④ 配额摊薄且**不丢步**；⑤ 大批次被摊到多个 tick（不跑完整批、仍幂等）；⑥ 步骤卡住 → 放弃 + **同 tick
 *   不重复占用**（去重兼作死循环闸）+ **不改任何状态**（不落 PD-03、不改 task_status、不落 done）+ 下个 tick 重试；
 *   ⑦ 默认参数下既有语义不变（一次驱动仍跑满单任务五步，TC-I-M1-001「任务程序决定何时启动」）。
 * 硬红线：仅本地内存库，零外部调用、零生产写；数值以契约基准 v1（ADR-004）为准（只断结构、语义与跃迁）。
 * 边界：真独占（并发 tick 同时选中同一步）不在本用例范围——2a 路线已如实登记该边界，见 `./tick-guard.js` 文档卡。
 * 反向清单：登记 `./README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f34.mjs`）。
 * 用法：node server/task-runner/test-f34.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import { createDiscoveryTask } from "./schedule.js";
import { runPendingWork } from "./executor.js";
import { listTaskSteps, TYPE_STEPS } from "./step-plan.js";
import { createTickGuard, withStepTimeout, STEP_TIMED_OUT, TICK_QUOTA, STEP_TIMEOUT_MS } from "./tick-guard.js";
import { DEFAULT_TIMEOUT_MS } from "../tool-executor/index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const GOAL = "GOAL-2026Q3-01";

function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      try {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes) } };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: () => sqlite.prepare(sql).get(...params) ?? null,
  });
  return { prepare: (sql) => makeStmt(sql, []) };
}

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  sqlite.exec(mock);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
const stepRow = (sqlite, task_id, step_no) =>
  sqlite.prepare("SELECT * FROM task_step WHERE task_id = ? AND step_no = ?").get(task_id, step_no);
const taskRow = (sqlite, task_id) => sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(task_id);
const blocksOf = (sqlite, task_id) =>
  sqlite.prepare("SELECT COUNT(*) c FROM task_block WHERE task_id = ?").get(task_id).c;

/** 去注释后取源码：静态扫描必须先剥注释（散文里的英文关键字会被朴素正则误命中）。 */
function strippedSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "");
}

/** 发现任务全链路所需的启用面（与 test-stage4 ② 同款前置：4 个计划内工具 + ACT 恢复）。 */
function enableDiscoveryTools(sqlite) {
  sqlite.exec("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id IN ('TOL-01','TOL-04','TOL-09','TOL-11')");
  sqlite.exec("UPDATE source_registry SET availability_status = 'ok', is_mcp_ready = 1 WHERE source_id = 'ACT'");
}

let pass = 0;
const fails = [];
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fails.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}
async function assertThrows(fn, msg, needle) {
  try {
    await fn();
    assert(false, `${msg}（实测未抛错）`);
  } catch (e) {
    const ok = !needle || String(e.message).includes(needle);
    assert(ok, `${msg}（实测：${String(e.message).slice(0, 70)}）`);
  }
}
function finish() {
  console.log(`\nVERIFY ${fails.length === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fails.length} 失败`);
  process.exit(fails.length === 0 ? 0 : 1);
}

function transportOf(payloadFn) {
  const t = async function ({ tool_code } = {}) {
    t.calls.push(tool_code);
    return payloadFn(tool_code);
  };
  t.calls = [];
  return t;
}
const okBody = (toolCode) => ({
  tool_code: toolCode,
  status: "ok",
  elapsed_ms: 420,
  retry_count: 0,
  restricted_flag: 0,
  result_status: "ok",
  result_summary: `契约基准 v1 自拟返回（${toolCode}）：观察到与目标口径相关的分层差异`,
  returned_rows: 3,
  fail_reason: null,
  data: { rows: [{ v: 1 }, { v: 2 }, { v: 3 }] },
});
/** 「卡住」的传输层：返回**永不 settle** 的 Promise——模拟端点无响应（步骤会一直等下去）。 */
function stuckTransport() {
  const t = async function () {
    t.calls.push(1);
    return new Promise(() => {});
  };
  t.calls = [];
  return t;
}

// ==================================================== ① 静态：守卫零 SQL、真源不复制
console.log("① 静态扫描 · 守卫零 SQL / 零数据库句柄；配额与超时各只有一份定义");
{
  const guard = strippedSource("./tick-guard.js");
  const banned = ["SELECT", "INSERT", "UPDATE", "DELETE", "DROP", "ALTER", "TRUNCATE", "CREATE", "REPLACE"];
  const hits = banned.filter((w) => new RegExp(`\\b${w}\\b`).test(guard));
  assert(hits.length === 0, `守卫零 SQL（实测命中 ${hits.length ? hits.join(",") : "0"}）`);
  assert(!/\.prepare\s*\(/.test(guard), "守卫不接触数据库句柄（零 prepare 调用）");
  assert(!/\bdb\b/.test(guard), "守卫签名里没有数据库入参（纯计算件）");

  const specs = [...guard.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(specs.length === 2 && specs.includes("./step-plan.js") && specs.includes("../tool-executor/index.js"),
    `守卫 import 恰好 2 条、均为派生真源（实测 ${specs.join(" , ")}）`);

  const ex = strippedSource("./executor.js");
  assert(/from\s+"\.\/tick-guard\.js"/.test(ex), "executor.js 从 ./tick-guard.js 取守卫（单一真源）");
  assert(!/(const|let|var)\s+(TICK_QUOTA|STEP_TIMEOUT_MS)\s*=/.test(ex), "executor.js 不复制配额/超时的第二份定义");

  const maxSteps = Math.max(...Object.values(TYPE_STEPS).map((steps) => steps.length));
  assert(TICK_QUOTA === maxSteps, `配额派生自 TYPE_STEPS 的最大步数（实测 ${TICK_QUOTA} vs ${maxSteps}）`);
  assert(STEP_TIMEOUT_MS === DEFAULT_TIMEOUT_MS * 2, `单步超时派生自传输层超时 ×2（实测 ${STEP_TIMEOUT_MS} vs ${DEFAULT_TIMEOUT_MS * 2}）`);
  assert(STEP_TIMEOUT_MS > DEFAULT_TIMEOUT_MS,
    `单步超时大于传输层超时（${STEP_TIMEOUT_MS} > ${DEFAULT_TIMEOUT_MS}）——否则会误杀传输层本可完成的步骤`);
  assert(TICK_QUOTA >= maxSteps, `配额 ≥ 单任务最大步数（单任务不被切得过碎；实测 ${TICK_QUOTA} ≥ ${maxSteps}）`);
  assert(TICK_QUOTA < 12 * 5, `配额小于一批 12 任务 × 5 步 = 60 步（否则「摊薄批次」失效；实测 ${TICK_QUOTA}）`);
}

// ==================================================== ② 守卫纯单元语义
console.log("\n② 守卫本体 · 配额计数 / 去重位 / 入参严数值化");
{
  const g = createTickGuard({ quota: 2, timeoutMs: 50 });
  assert(g.quota === 2 && g.hasCapacity() && g.executed === 0, "初始有配额、已执行 0");
  const r1 = await g.runStep("T-1", 1, () => "ok");
  assert(r1 === "ok" && g.executed === 1, "一步执行成功并占 1 个配额");
  assert(g.isDuplicate("T-1", 1) && !g.isDuplicate("T-1", 2), "去重位只标记**已执行过**的 (task, step)");
  await g.runStep("T-1", 2, () => "ok");
  assert(!g.hasCapacity() && g.executed === 2, `配额用尽（实测 executed=${g.executed}）`);
  assert(g.timed_out.length === 0, "正常路径零超时记账");

  await assertThrows(() => createTickGuard({ quota: 0 }), "配额非正整数即报错（不静默取默认）", "配额");
  await assertThrows(() => createTickGuard({ quota: "" }), "配额空串即报错（严数值化，不把 '' 当 0）", "配额");
  await assertThrows(() => createTickGuard({ timeoutMs: 0 }), "超时非正数即报错", "超时");
  await assertThrows(() => withStepTimeout("不是函数"), "work 非函数即报错", "work");
}

// ==================================================== ③ 单步超时（可注入 timer → 确定性）
console.log("\n③ 单步超时 · 放弃等待（不取消）、未超时原样回传、迟到拒绝不变成未处理拒绝");
{
  const g = createTickGuard({ quota: 3, timeoutMs: 5 });
  const r = await g.runStep("T-9", 1, () => new Promise(() => {}));
  assert(r === STEP_TIMED_OUT, "永不 settle 的步骤 → 超时哨兵（本步不挂死）");
  assert(g.executed === 1 && g.timed_out.length === 1 && g.timed_out[0].step_no === 1,
    `超时记入 timed_out 且占 1 个配额（实测 ${JSON.stringify(g.timed_out)}）`);

  let fired = 0;
  const injected = await withStepTimeout(() => new Promise(() => {}), {
    timeoutMs: 1,
    timer: (cb) => { fired += 1; cb(); return 7; },
    clear: () => {},
  });
  assert(injected === STEP_TIMED_OUT && fired === 1, `可注入 timer → 超时分支确定性触发（实测 fired=${fired}）`);

  const fast = await withStepTimeout(async () => "立刻返回", { timeoutMs: 10_000 });
  assert(fast === "立刻返回", "未超时则原样回传结果（超时是兜底，不改正常路径）");

  const unhandled = [];
  const onUnhandled = (e) => unhandled.push(e);
  process.on("unhandledRejection", onUnhandled);
  const late = await withStepTimeout(
    () => new Promise((_, rej) => setTimeout(() => rej(new Error("超时之后才失败")), 3)),
    { timeoutMs: 1 },
  );
  await new Promise((r2) => setTimeout(r2, 25)); // 留出「迟到拒绝」的传播窗口
  process.off("unhandledRejection", onUnhandled);
  assert(late === STEP_TIMED_OUT, "超时先到时返回哨兵（不把迟到的失败当成本步结果）");
  assert(unhandled.length === 0, `放弃等待后底层拒绝不变成未处理拒绝（实测 ${unhandled.length} 条）`);
}

// ==================================================== ④ 配额：摊薄节奏、不丢步
console.log("\n④ 配额=1 · 一次驱动只推进 1 步（exhausted），连续驱动跑满五步不丢步");
{
  const { sqlite, db } = freshDb();
  enableDiscoveryTools(sqlite);
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-f34 ④ 配额", at: "2026-09-21 10:00" });
  const tid = created.task.task_id;
  const tr = transportOf((c) => okBody(c));

  const r1 = await runPendingWork(db, { transport: tr, at: "2026-09-21 10:01", quota: 1 });
  assert(r1.executed.length === 1 && r1.exhausted === true,
    `配额=1 → 一次驱动只跑 1 步且标记 exhausted（实测 ${r1.executed.length} 步 / exhausted=${r1.exhausted}）`);
  assert(r1.quota === 1, "返回体回带本次配额（可观测）");
  assert(taskRow(sqlite, tid).progress_text === "1 / 5 步", `进度 1 / 5 步（实测「${taskRow(sqlite, tid).progress_text}」）`);
  assert(taskRow(sqlite, tid).task_status === "running", "任务仍 running（配额用尽不是失败、不改状态）");
  assert(stepRow(sqlite, tid, 2).step_state === "active", "步 2 已置 active（跃迁仍由执行层统一负责）");

  let stepped = r1.executed.length;
  for (let i = 0; i < 4; i += 1) {
    const r = await runPendingWork(db, { transport: tr, at: "2026-09-21 10:02", quota: 1 });
    stepped += r.executed.length;
  }
  assert(stepped === 5, `五次驱动共 5 步（实测 ${stepped}）——配额只摊薄节奏，不丢步`);
  assert(taskRow(sqlite, tid).task_status === "done" && taskRow(sqlite, tid).progress_text === "5 / 5 步",
    `跑满 done（实测 ${taskRow(sqlite, tid).task_status} / ${taskRow(sqlite, tid).progress_text}）`);
  assert((await listTaskSteps(db, tid)).every((s) => s.step_state === "done"), "五步全 done");
}

// ==================================================== ⑤ 大批次被摊到多个 tick
console.log("\n⑤ 两个任务（10 步）· 配额=2 → 一次驱动只跑 2 步，多次驱动跑满；全完成后仍幂等");
{
  const { sqlite, db } = freshDb();
  enableDiscoveryTools(sqlite);
  const a = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-f34 ⑤ A", at: "2026-09-21 11:00" });
  const b = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-f34 ⑤ B", at: "2026-09-21 11:00" });
  const tr = transportOf((c) => okBody(c));

  let drives = 0;
  let stepped = 0;
  for (let i = 0; i < 12; i += 1) {
    const r = await runPendingWork(db, { transport: tr, at: "2026-09-21 11:01", quota: 2 });
    drives += 1;
    stepped += r.executed.length;
    if (r.executed.length === 0) break;
  }
  assert(stepped === 10, `两任务共 10 步全部执行（实测 ${stepped}）`);
  assert(drives >= 5, `10 步被摊到 ≥5 次驱动（配额 2；实测 ${drives} 次 = 至少 5 个 tick）`);
  for (const t of [a, b]) {
    assert(taskRow(sqlite, t.task.task_id).task_status === "done", `${t.task.task_id} 跑满 done`);
  }
  const r = await runPendingWork(db, { transport: tr, at: "2026-09-21 11:09", quota: 2 });
  assert(r.executed.length === 0, "全部完成后再次驱动是 no-op（守卫不破坏既有幂等）");
}

// ==================================================== ⑥ 步骤卡住：放弃 + 同 tick 不重复占用 + 不改状态
console.log("\n⑥ 步骤卡住 · 单步超时放弃、本 tick 只占一次（去重兼作死循环闸）、零状态改动、下个 tick 重试");
{
  const { sqlite, db } = freshDb();
  enableDiscoveryTools(sqlite);
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-f34 ⑥ 卡住", at: "2026-09-21 12:00" });
  const tid = created.task.task_id;
  const tr = stuckTransport();

  const r = await runPendingWork(db, { transport: tr, at: "2026-09-21 12:01", step_timeout_ms: 5 });
  assert(r.executed.length === 2 && r.executed.every((e) => e.outcome === "done"),
    `步 1/2 正常完成（实测 ${r.executed.length} 步）`);
  assert(r.timed_out.length === 1 && r.timed_out[0].step_no === 3,
    `步 3 卡住被放弃、且**本 tick 只占用一次**（实测 timed_out=${JSON.stringify(r.timed_out)}）`);
  assert(r.exhausted === false && r.quota === TICK_QUOTA, "本轮由「去重」而非配额终止（配额未用尽）");

  assert(stepRow(sqlite, tid, 3).step_state === "active", "超时**不改步态**：步 3 仍 active（等下个 tick 重试）");
  assert(taskRow(sqlite, tid).task_status === "running", "任务仍 running（超时不是失败）");
  assert(taskRow(sqlite, tid).ended_at === null, "ended_at 仍为空（进行中）");
  assert(blocksOf(sqlite, tid) === 0, `零 PD-03（超时不落受阻；实测 ${blocksOf(sqlite, tid)} 行）`);
  assert(taskRow(sqlite, tid).progress_text === "2 / 5 步", `进度停 2 / 5 步（实测「${taskRow(sqlite, tid).progress_text}」）`);

  const r2 = await runPendingWork(db, { transport: tr, at: "2026-09-21 12:02", step_timeout_ms: 5 });
  assert(r2.timed_out.length === 1 && r2.timed_out[0].step_no === 3,
    "下个 tick 仍会重试该步（未被永久跳过、也不留下半截状态）");
  assert(r2.executed.length === 0, "除该步外无可推进步骤（步 4/5 仍 pending）");
  assert(stepRow(sqlite, tid, 4).step_state === "pending" && stepRow(sqlite, tid, 5).step_state === "pending",
    "后续步骤未被越级推进");
}

// ==================================================== ⑦ 默认参数不破既有语义
console.log("\n⑦ 默认配置 · 一次驱动仍跑满单任务五步（TC-I-M1-001「任务程序决定何时启动」不受影响）");
{
  const { sqlite, db } = freshDb();
  enableDiscoveryTools(sqlite);
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-f34 ⑦ 默认", at: "2026-09-21 13:00" });
  const tid = created.task.task_id;
  const r = await runPendingWork(db, { transport: transportOf((c) => okBody(c)), at: "2026-09-21 13:01" });
  assert(r.quota === TICK_QUOTA, `默认配额取自单一真源（实测 ${r.quota} vs ${TICK_QUOTA}）`);
  assert(r.executed.length === 5,
    `默认配置下一次驱动仍跑满五步（实测 ${r.executed.length}）——既有 oracle 与线上行为不变`);
  assert(r.timed_out.length === 0 && r.exhausted === false, "默认路径零超时、未提前耗尽配额");
  const t = taskRow(sqlite, tid);
  assert(t.task_status === "done" && t.progress_text === "5 / 5 步", `任务 done（实测 ${t.task_status} / ${t.progress_text}）`);
  assert(!!t.ended_at, "done 带 ended_at");
  assert(countRows(sqlite, "opportunity") > 0, "真实返回逐条判定仍产出机会（守卫不介入业务语义）");
}

finish();
