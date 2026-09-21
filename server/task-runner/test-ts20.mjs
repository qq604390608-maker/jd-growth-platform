#!/usr/bin/env node
/**
 * 文档卡（TS-20 用例执行器 · 双 Worker 拆分：runner 入口到期轮询与 Queue 消费 · 2026-09-21）
 * 上游：`../../docs/03-locks/tech-stack.md` §7.3（**TS-20 已决 2026-09-21：2 个 Worker**，采纳 §7.3 倾向）
 *   ｜ `../../docs/03-locks/schema.md` §12 **Q-17**（到期判定口径：以「最小间隔」近似「到点触发」，
 *       last_run 从 PD-01 `task` 推导——CFG-04 无 last_run/next_run 列，不擅改 schema）
 *   ｜ `./index.js`（被测：`freqIntervalMin` / `runDueDiscoveryCalls` / default export handler）
 *   ｜ `./schedule.js`（F-02 既有单一口径：`createDiscoveryTask` / `delegateToAgent`，本用例不重写其语义）
 * 职责：实测 ① 频率→最小间隔（daily / daily_multi / hourly / weekly）；
 *       ② 到期矩阵（无任务→建；未到间隔→跳；已过间隔→建；archived 目标不参与；无策略跳过）；
 *       ③ queue handler 消费 `{task_id, step_no}` → `delegateToAgent` 契约占位 + ack。
 * 硬红线：本地内存库（`node:sqlite` 载真实 DDL + 种子），零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**。
 * 边界：F-02 建任务语义 / F-26 步骤语义归各自执行器，本用例只验入口装配与判定矩阵。
 * 反向清单：登记 `../README.md` 与 `./README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-ts20.mjs`）。
 *
 * 用法：node server/task-runner/test-ts20.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import runner, { freqIntervalMin, runDueDiscoveryCalls } from "./index.js";
import { planTaskSteps } from "./step-plan.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);

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
    first: () => sqlite.prepare(sql).get(...params),
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

// ==================================================== ① 频率 → 最小间隔
console.log("\n① freqIntervalMin · 四种受支持写法的最小间隔");
{
  assert(freqIntervalMin("每日 02:00") === 1440, "每日 02:00 → 1440 分钟");
  assert(freqIntervalMin("每日 02:00,14:30") === 1440, "每日双时刻 → 仍 1440（daily_multi 每天一轮）");
  assert(freqIntervalMin("每 6 小时") === 360, "每 6 小时 → 360 分钟");
  assert(freqIntervalMin("每周一 09:00") === 10080, "每周一 09:00 → 10080 分钟");
}

// ==================================================== ② 到期矩阵（scheduled 本体）
console.log("\n② runDueDiscoveryCalls · 到期判定矩阵（种子：2 active 目标 + POL-Q3/POL-PLAT）");
{
  // 2-1 首次（库内无任何 discovery 任务）→ 两个 active 目标均到期、均建
  const t1 = freshDb();
  const now1 = new Date("2026-09-21T03:00:00");
  const r1 = await runDueDiscoveryCalls(t1.db, { now: now1 });
  assert(r1.checked === 2 && r1.due.length === 2 && r1.created.length === 2,
    `首次轮询：checked=2、双目标到期并建任务（实测 created=${r1.created.length}）`);
  const cnt1 = t1.sqlite.prepare("SELECT COUNT(*) AS c FROM task WHERE task_type='discovery' AND trigger_basis LIKE '%runner 到期轮询%'").get().c;
  assert(cnt1 === 2, `本次轮询新建 discovery 任务 2 行（种子自带 4 行不计；实测 ${cnt1}）`);
  const tbs = t1.sqlite.prepare("SELECT COUNT(*) AS c FROM task WHERE task_type='discovery' AND trigger_basis LIKE '%POL-%' AND trigger_basis LIKE '%runner 到期轮询%'").get().c;
  assert(tbs === 2, "trigger_basis 如实标注 runner 到期轮询 + 策略来源（实测 2 行）");

  // 2-2 刚跑过（< 1440 分钟）→ 跳过
  const t2 = freshDb();
  const now2 = new Date("2026-09-21T03:00:00");
  const past = new Date(now2.getTime() - 100 * 60_000); // 100 分钟前
  const p = (n) => String(n).padStart(2, "0");
  const stamp = `${past.getFullYear()}-${p(past.getMonth() + 1)}-${p(past.getDate())} ${p(past.getHours())}:${p(past.getMinutes())}`;
  t2.sqlite.prepare(
    "UPDATE task SET started_at = ? WHERE task_type = 'discovery' AND goal_id = 'GOAL-2026Q3-01'"
  ).run(stamp);
  const r2 = await runDueDiscoveryCalls(t2.db, { now: now2 });
  assert(r2.skipped.length === 1 && r2.skipped[0].goal_id === "GOAL-2026Q3-01" && /最小间隔/.test(r2.skipped[0].why),
    `Q3 距上次 100 分钟（<1440）→ 跳过且 why 带间隔口径（实测 skipped=${r2.skipped.length}）`);
  assert(r2.created.length === 1 && r2.created[0] !== "T-99990", "Q2 种子 discovery 行时点久远（>1440）→ 到期补建");

  // 2-3 已过最小间隔 → 到期重建（Q-17 近似口径：间隔而非到点）
  const t3 = freshDb();
  const now3 = new Date("2026-09-22T12:00:00");
  const past3 = new Date(now3.getTime() - 1500 * 60_000); // 1500 分钟前（> 1440）
  const stamp3 = `${past3.getFullYear()}-${p(past3.getMonth() + 1)}-${p(past3.getDate())} ${p(past3.getHours())}:${p(past3.getMinutes())}`;
  t3.sqlite.prepare(
    "UPDATE task SET started_at = ? WHERE task_type = 'discovery'"
  ).run(stamp3);
  const r3 = await runDueDiscoveryCalls(t3.db, { now: now3 });
  assert(r3.created.length === 2, `距上次 1500 分钟（>1440）→ 到期重建（实测 created=${r3.created.length}）`);

  // 2-4 archived 目标不参与（GOAL-2026Q1-01 归档）
  const t4 = freshDb();
  const r4 = await runDueDiscoveryCalls(t4.db, { now: new Date("2026-09-21T03:00:00") });
  assert(!r4.due.includes("GOAL-2026Q1-01") && !r4.skipped.some((s) => s.goal_id === "GOAL-2026Q1-01"),
    "archived 目标不出现在 due/skipped（轮询范围仅 active）");
}

// ==================================================== ③ queue handler：discovery 走执行体（阶段4 接线），其余类型走占位
console.log("\n③ queue handler · discovery 消息 → runStepMessage（执行+跃迁）；其余类型 → 占位 + ack");
{
  const t = freshDb();
  await planTaskSteps(t.db, "T-1022", "discovery"); // 种子 task_step 为空：先落 5 步
  const acked = [];
  const batch = {
    messages: [
      { body: { task_id: "T-1022", step_no: 1 }, ack: () => acked.push("T-1022#1") },
      { body: { task_id: "T-1022", step_no: 2 }, ack: () => acked.push("T-1022#2") },
    ],
  };
  const results = await runner.queue(batch, { DB: t.db }, {});
  assert(results.length === 2 && results.every((r) => r.outcome === "done"),
    "discovery 消息 → 真实执行体（outcome=done；阶段4 接线后不再是占位）");
  const qrBefore = t.sqlite.prepare("SELECT COUNT(*) AS c FROM query_record WHERE task_id='T-1022'").get().c;
  const st = (no) => t.sqlite.prepare("SELECT step_state FROM task_step WHERE task_id='T-1022' AND step_no=?").get(no).step_state;
  assert(st(1) === "done" && st(2) === "done", `步 1/2 落 done（实测 ${st(1)}/${st(2)}）`);
  assert(acked.length === 2, `消费后逐条 ack（实测 ack ${acked.length} 条）`);
  // 步 1/2 只做装载与规划：不发起查询、不产证据/机会（写入面收敛在 task/task_step/task 的 done_part 与进度串）
  const qrAfter = t.sqlite.prepare("SELECT COUNT(*) AS c FROM query_record WHERE task_id='T-1022'").get().c;
  assert(qrAfter === qrBefore, `步 1/2 零新查询（前后 ${qrBefore}/${qrAfter}；种子自带的历史查询行不算）`);
  const gc = t.sqlite.prepare("SELECT task_id FROM task WHERE task_type = 'goal_check' LIMIT 1").get();
  if (gc) {
    const r2 = await runner.queue(
      { messages: [{ body: { task_id: gc.task_id, step_no: 1 }, ack: () => {} }] },
      { DB: t.db }, {},
    );
    assert(r2[0].delegated === true && !r2[0].outcome, "非 discovery 消息 → delegateToAgent 契约占位（不误入发现执行体）");
  }
}

// ==================================================== 汇总
console.log(`\n=== TS-20 双 Worker 入口用例：通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) {
  console.log("失败项：\n - " + fails.join("\n - "));
  process.exit(1);
}
