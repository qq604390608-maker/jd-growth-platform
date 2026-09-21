#!/usr/bin/env node
/**
 * 文档卡（阶段4 接线 · M1 · **F-36 调度相位异常隔离用例** · 2026-09-21）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md` §四 · 期 2.3 / §三 **P1-1**（**到期轮询异常会饿死执行体**：
 *        `runDueDiscoveryCalls` 排在执行体之前且无 try/catch → 任一目标抛错（如无生效策略）→ 整个
 *        `scheduled` reject → 本 tick 所有 `active` 步永不执行，且**每分钟重演**）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-02（「**任务程序决定何时启动**」——调度不能因单点异常停摆）
 *   ｜ `../../docs/01-brd/BRD.md` §5.3（生产零写）
 *   ｜ `./index.js`（被测：`runTick` / `TICK_PHASES` / default export `scheduled`）
 *   ｜ `./tick-guard.js`（`TICK_QUOTA`：证明 work 相位走的是**真实**默认实现）
 *   ｜ `./schedule.js`（夹具：`createDiscoveryTask`）｜`./step-plan.js`（夹具：`planTaskSteps` / `listTaskSteps`）
 *   ｜ `../../db/migrations/0001_init.sql` + `../../db/seed/0001_mock.sql`（真实 DDL + 种子，载入内存库）
 * 职责：实测 ① 静态不变量（`scheduled` 是薄壳、顺序真源、零 `throw`、零外部调用、import 集合未变）；
 *       ② 相位隔离（任一相位抛错——含 async 拒绝——**只影响自己**，其余照跑）；
 *       ③ 失败如实回报（`phases.<相位>.{ok,why}` ＋ `onError`，**不静默吞错**）；
 *       ④ 失败相位的取值退化为**键齐的空形态**（下游按键读取不崩）；
 *       ⑤ 默认相位接线（不注入覆盖时走真实实现）与真实夹具端到端（**同 tick 流水线未被破坏**）。
 * 硬红线：本地内存库（`node:sqlite` 载真实 DDL + 种子），零外部调用、零生产写；
 *   F-36 是**纯控制流**改动（不新增 import、不改 schema、不改任何上游模块语义）。
 * 边界：`queue()` 的逐消息隔离**不在** F-36 范围（该路径真 Queues 未接，P1-4）；F-02 建任务语义归
 *   `test-ts20.mjs`，F-33 分派与 F-34 守卫归各自用例。
 * 反向清单：登记 `../README.md` 与 `./README.md`；被 CI `validate` 步骤复用。
 *
 * 用法：node server/task-runner/test-f36.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import runner, { runTick, TICK_PHASES } from "./index.js";
import { TICK_QUOTA } from "./tick-guard.js";
import { createDiscoveryTask } from "./schedule.js";
import { planTaskSteps, listTaskSteps } from "./step-plan.js";

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

const taskRow = (sqlite, task_id) => sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(task_id);
const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

/** 与库内 `started_at` 同形（`YYYY-MM-DD HH:MM`）。 */
function nowStampOf(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * 让到期轮询「无事可做」：把种子里既有 discovery 任务的 `started_at` 顶到「刚刚」，
 * 于是三目标的距离都 < 最小间隔 1440 分钟 → 本 tick 不新建任务（**只**验本用例自己造的夹具）。
 */
function muteDuePoll(sqlite) {
  sqlite.prepare("UPDATE task SET started_at = ? WHERE task_type = 'discovery'").run(nowStampOf());
}

/** 去注释后取源码：静态扫描必须先剥注释（散文里的英文关键字会被朴素正则误命中）。 */
function strippedSource(rel) {
  return readFileSync(new URL(rel, import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "");
}

/** 发现任务全链路所需的启用面（与 test-stage4 ② / test-f34 ⑦ 同款前置：4 个计划内工具 + ACT 恢复）。 */
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
function finish() {
  console.log(`\nVERIFY ${fails.length === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fails.length} 失败`);
  process.exit(fails.length === 0 ? 0 : 1);
}

/** 相位桩工厂：记录调用顺序，并按需抛出（同步 `throw` 与 async 拒绝都能造）。 */
function phasesOf(calls, { due, heal, work } = {}) {
  const mk = (name, impl) => async () => {
    calls.push(name);
    return impl ? impl() : {};
  };
  return { due: mk("due", due), heal: mk("heal", heal), work: mk("work", work) };
}

// ==================================================== ① 静态不变量
console.log("\n① 静态不变量 · 薄壳 / 顺序真源 / 零 throw / 零外部调用 / import 集合未变");
{
  assert(TICK_PHASES.length === 3 && TICK_PHASES.join(">") === "due>heal>work",
    `顺序真源＝due>heal>work（实测 ${TICK_PHASES.join(">")}）`);
  assert(new Set(TICK_PHASES).size === 3, "相位名唯一（无重复相位）");

  const SRC = strippedSource("./index.js");
  const sched = SRC.match(/async scheduled\([\s\S]*?\n  \},/);
  assert(!!sched, "能取到 `scheduled` 函数体");
  assert(/return runTick\(env\.DB\)/.test(sched[0]), "scheduled 是薄壳：唯一动作是委托 runTick");
  assert(!/(runDueDiscoveryCalls|runSelfHealScan|runPendingWork)\(/.test(sched[0]),
    "scheduled 不再直接连调三个相位实现（隔离逻辑收敛在 runTick，入口只留一行）");
  assert(!/await runDueDiscoveryCalls/.test(SRC), "旧的「裸 await 三连」写法已移除");

  assert(!/\bthrow\b/.test(SRC), "index.js 零 throw——相位错误一律经 phases 回报（不炸整轮、也不静默吞）");
  assert(!/\bfetch\s*\(/.test(SRC), "index.js 零外部调用（无 fetch——本地内存库用例的前提）");
  assert(/for \(const name of TICK_PHASES\)/.test(SRC), "三相位由 TICK_PHASES 驱动（顺序是数据、不是三行手抄）");
  assert(/runPhase\(fn\)/.test(SRC), "每个相位都经 runPhase 进入（隔离点唯一）");

  const got = [...SRC.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const want = ["./schedule.js", "./step-plan.js", "./executor.js", "./self-heal.js", "./research.js"];
  assert(got.length === want.length && got.every((s, i) => s === want[i]),
    `F-36 是纯控制流改动、未新增依赖（实测 import ${got.length} 条：${got.join(" / ")}）`);
  assert(typeof runner.scheduled === "function" && typeof runner.queue === "function",
    "default export 仍含 scheduled / queue（Worker 入口契约不变）");
}

// ==================================================== ② 相位隔离（P1-1 核心）
console.log("\n② 相位隔离 · 任一相位抛错只影响自己，其余照跑");
{
  // ②-1 首相位（due）抛错 —— 原实现下这里会饿死执行体
  const t1 = freshDb();
  const calls = [];
  const errs = [];
  const r1 = await runTick(t1.db, {
    ...phasesOf(calls, {
      due: () => { throw new Error("SENTINEL-DUE-SYNC"); },
      heal: () => ({ healed: ["T-99991"] }),
      work: () => ({ executed: [{ task_id: "T-1", step_no: 1, outcome: "done" }], finished: ["T-1"], timed_out: [], exhausted: false, quota: 5 }),
    }),
    onError: (p, why) => errs.push([p, why]),
  });
  assert(calls.join(">") === "due>heal>work", `三相位仍按 TICK_PHASES 顺序被调用（实测 ${calls.join(">")}）`);
  assert(r1.phases.due.ok === false && /SENTINEL-DUE-SYNC/.test(r1.phases.due.why),
    `due 相位失败被如实回报（why 逐字带原始信息：${String(r1.phases.due.why).slice(0, 40)}）`);
  assert(r1.phases.heal.ok === true && r1.phases.work.ok === true,
    "★ P1-1 核心：首相位抛错**未中断**其余相位（执行体不再被轮询异常饿死）");
  assert(r1.healed.length === 1 && r1.healed[0] === "T-99991", "失败相位不污染其它相位的取值（heal 取值照常透传）");
  assert(r1.executed.length === 1 && r1.executed[0].task_id === "T-1" && r1.quota === 5,
    "work 相位取值照常透传到顶层（既有键语义不变）");
  assert(errs.length === 1 && errs[0][0] === "due" && /SENTINEL-DUE-SYNC/.test(errs[0][1]),
    "onError 恰 1 次、指名失败相位、why 逐字（失败必留痕）");

  // ②-2 中间相位（heal）**async 拒绝** —— 断言 catch 覆盖 rejected promise，而非只覆盖同步 throw
  const t2 = freshDb();
  const calls2 = [];
  const r2 = await runTick(t2.db, {
    ...phasesOf(calls2, {
      due: () => ({ created: ["T-9"] }),
      heal: async () => { throw new Error("SENTINEL-HEAL-REJECT"); },
      work: () => ({ executed: [], finished: [], timed_out: [], exhausted: false, quota: 3 }),
    }),
    onError: () => {},
  });
  assert(r2.phases.heal.ok === false && /SENTINEL-HEAL-REJECT/.test(r2.phases.heal.why),
    "async 拒绝也被隔离（catch 覆盖 rejected promise，不只覆盖同步 throw）");
  assert(r2.phases.due.ok === true && r2.phases.work.ok === true, "中间相位失败时首尾两相位仍 ok");
  assert(Array.isArray(r2.healed) && r2.healed.length === 0, "失败相位的取值退化为空数组（键仍在，下游不崩）");
  assert(r2.quota === 3, "末相位取值不受中间相位失败影响（work 的 quota 仍为 3）");

  // ②-3 末相位（work）抛错 —— 顶层仍是「键齐的空形态」
  const t3 = freshDb();
  const r3 = await runTick(t3.db, {
    ...phasesOf([], {
      due: () => ({}),
      heal: () => ({ healed: ["T-99992"] }),
      work: () => { throw new Error("SENTINEL-WORK-SYNC"); },
    }),
    onError: () => {},
  });
  assert(r3.phases.work.ok === false && /SENTINEL-WORK-SYNC/.test(r3.phases.work.why), "末相位失败被如实回报");
  assert(r3.executed.length === 0 && r3.finished.length === 0 && r3.timed_out.length === 0
    && r3.exhausted === false && r3.quota === 0,
    "★ 失败相位返回**键齐的空形态**（executed/finished/timed_out/exhausted/quota 全在，下游按键读取不崩）");
  assert(r3.healed.length === 1 && r3.phases.due.ok === true && r3.phases.heal.ok === true,
    "末相位失败不影响前两相位（heal 真实取值仍透传）");

  // ②-4 三相位全失败 —— 不抛异常、三条 why 互不覆盖
  const t4 = freshDb();
  const r4 = await runTick(t4.db, {
    ...phasesOf([], {
      due: () => { throw new Error("E-DUE"); },
      heal: async () => { throw new Error("E-HEAL"); },
      work: () => { throw new Error("E-WORK"); },
    }),
    onError: () => {},
  });
  assert(r4.phases.due.ok === false && r4.phases.heal.ok === false && r4.phases.work.ok === false,
    "三相位全失败：scheduled 整体**不抛异常**、三键各自为 ok:false");
  const whys = [r4.phases.due.why, r4.phases.heal.why, r4.phases.work.why].join("|");
  assert(whys === "E-DUE|E-HEAL|E-WORK", `三条失败原因互不覆盖（实测 ${whys}）`);

  // ②-5 失败必留痕：onError 逐相位呼叫、顺序与相位序一致，成功相位不留痕
  const t5 = freshDb();
  const errs5 = [];
  await runTick(t5.db, {
    ...phasesOf([], {
      due: () => { throw new Error("E-DUE"); },
      heal: async () => { throw new Error("E-HEAL"); },
      work: () => ({ executed: [], finished: [], timed_out: [], exhausted: false, quota: 1 }),
    }),
    onError: (p, why) => errs5.push(`${p}:${why}`),
  });
  assert(errs5.join(" > ") === "due:E-DUE > heal:E-HEAL",
    `onError 逐相位呼叫且顺序与相位序一致（实测 ${errs5.join(" > ")}）`);

  // ②-6 未注入 onError 时的默认留痕（console.error，供 wrangler tail 观测）
  const t6 = freshDb();
  const buf = [];
  const origErr = console.error;
  console.error = (...a) => buf.push(a.map(String).join(" "));
  let r6;
  try {
    r6 = await runTick(t6.db, phasesOf([], { due: () => { throw new Error("SENTINEL-DEFAULT-LOG"); }, work: () => ({}) }));
  } finally {
    console.error = origErr;
  }
  assert(r6.phases.due.ok === false, "默认 onError 路径下相位仍被隔离（不抛到调用方）");
  assert(buf.some((l) => /SENTINEL-DEFAULT-LOG/.test(l)),
    "未注入 onError 时默认 console.error 留痕（供 wrangler tail 观测——不静默吞错）");
  assert(buf.length === 1, `默认留痕恰 1 条（只有失败相位留痕；实测 ${buf.length}）`);
}

// ==================================================== ③ 默认相位接线（不注入任何覆盖）
console.log("\n③ 默认相位接线 · runTick(db) 走真实实现（不注入覆盖时仍返回真实形态）");
{
  const { sqlite, db } = freshDb();
  muteDuePoll(sqlite); // 两个 active 目标刚跑过 → 本 tick 不新建（只验接线本身）
  const before = countRows(sqlite, "task");
  const r = await runTick(db, { onError: () => {} });
  const after = countRows(sqlite, "task");
  assert(TICK_PHASES.every((p) => r.phases[p] && r.phases[p].ok === true),
    `三相位全 ok（实测 ${TICK_PHASES.map((p) => `${p}=${r.phases[p].ok}`).join(" ")}）`);
  assert(r.quota === TICK_QUOTA,
    `work 走的是真实 runPendingWork（默认配额实测 ${r.quota} vs TICK_QUOTA ${TICK_QUOTA}）`);
  assert(Array.isArray(r.healed) && Array.isArray(r.executed) && Array.isArray(r.finished),
    "真实 heal/work 的取值落到顶层既有键（healed / executed / finished）");
  assert(after === before, `到期轮询在「刚跑过」时是个 no-op（任务行数 ${before} → ${after}，幂等）`);
  assert(r.executed.length === 0 && r.exhausted === false, "空库无 active 步 → 执行体 no-op 且未报耗尽配额");
}

// ==================================================== ④ 真实夹具端到端（默认相位）
console.log("\n④ 真实夹具端到端 · 默认相位跑一次 tick：到期轮询 → 自愈 → 执行体跑满五步");
{
  const { sqlite, db } = freshDb();
  enableDiscoveryTools(sqlite);
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-f36 ④", at: "2026-09-21 14:00" });
  const tid = created.task.task_id;
  muteDuePoll(sqlite); // 顶掉种子既有 discovery 的时点，使本 tick 只驱动本用例新建的任务
  const r = await runTick(db, { onError: (p, why) => console.log(`     [onError] ${p}: ${why}`) });
  assert(TICK_PHASES.every((p) => r.phases[p].ok === true), "三相位全 ok（含真实到期轮询与自愈）");
  assert(r.executed.length === 5, `执行体在一个 tick 内被真实驱动 5 步（实测 ${r.executed.length}）`);
  assert(r.timed_out.length === 0 && r.exhausted === false, "单任务整轮未被配额或超时拦下（默认配额＝单任务步数）");
  const t = taskRow(sqlite, tid);
  assert(t.task_status === "done" && t.progress_text === "5 / 5 步",
    `★ 一个 tick 内任务跑到 done（实测 ${t.task_status} / ${t.progress_text}）——同 tick 流水线未被隔离改动破坏`);
  const steps = await listTaskSteps(db, tid);
  assert(steps.length === 5 && steps.every((s) => s.step_state === "done"), "五步全 done");
  assert(countRows(sqlite, "opportunity") > 0, "真实产出仍在（相位隔离不介入业务语义）");
}

// ==================================================== ⑤ 不破既有（入口与分派）
console.log("\n⑤ 不破既有 · queue 分派路径未被本项改动");
{
  const { sqlite, db } = freshDb();
  await planTaskSteps(db, "T-1022", "discovery");
  const acked = [];
  const results = await runner.queue(
    { messages: [{ body: { task_id: "T-1022", step_no: 1 }, ack: () => acked.push(1) }] },
    { DB: db }, {},
  );
  assert(results.length === 1 && results[0].outcome === "done", "queue 仍按既有分派跑真实执行体（outcome=done）");
  assert(acked.length === 1, "消费后照旧 ack");
  assert(countRows(sqlite, "task_step") > 0, "步态仍被真实推进（queue 路径未受相位隔离影响）");
}

finish();
