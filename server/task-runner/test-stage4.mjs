#!/usr/bin/env node
/**
 * 文档卡（阶段4 接线 · M1 · 发现任务步骤执行体用例 · 2026-09-21）
 * 上游：`../../docs/04-plan/dev-plan.md`（M3 F-14~F-16 编排 × M1 F-02 调度回路的接线验收）
 *   ｜ `../../docs/05-test-cases/test-M1.md`（TC-I-M1-006 逐跃迁留痕；TC-U-M1-002 写入侧从严）
 *   ｜ `./executor.js`（被测本体）｜ `./index.js`（scheduled 顺带驱动 + queue consumer 路由）
 *   ｜ `../../db/migrations/0001_init.sql` + `../../db/seed/0001_mock.sql`（真实 DDL + 种子，载入内存库）
 *   ｜ `../agent-orchestrator/verification.js`（F-15 真实查询经注入 transport——**不 mock 业务语义**，只替网络层）
 * 职责：验证①静态零删行/改表；②ok 路径全链路（5 步全 done、任务 done、EXT-01/EXT-02/MD-06 落库量）；③
 *   查询全失败路径（任务仍 done、零机会、失败原因进 done_part、**无 PD-03**——失败不否定结论且隔离）；④
 *   重复驱动幂等（无 active 步骤时 no-op，机会不重复）；⑤ 结构受阻（快照版本缺失 → PD-03 + blocked）；
 *   ⑥ queue consumer 路由（discovery→执行体；其他类型→占位）。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义与跃迁）。
 * 反向清单：登记 `./README.md`；被 CI validate 步骤复用（`node server/task-runner/test-stage4.mjs`）。
 * 用法：node server/task-runner/test-stage4.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import runner from "./index.js";
import { createDiscoveryTask, delegateToAgent } from "./schedule.js";
import { runDiscoveryStep, runPendingDiscoveryWork } from "./executor.js";
import { listTaskBlocks } from "./step-plan.js";

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
const taskRow = (sqlite, task_id) => sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(task_id);
const stepRow = (sqlite, task_id, step_no) =>
  sqlite.prepare("SELECT * FROM task_step WHERE task_id = ? AND step_no = ?").get(task_id, step_no);

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
  elapsed_ms: 500,
  retry_count: 0,
  restricted_flag: 0,
  result_status: "ok",
  result_summary: `契约基准 v1 自拟返回（${toolCode}）：观察到与目标口径相关的分层差异`,
  returned_rows: 3,
  fail_reason: null,
  data: { rows: [{ v: 1 }, { v: 2 }, { v: 3 }] },
});
const throwingTransport = () => {
  const t = async function () {
    t.calls.push(1);
    throw new Error("ECONNREFUSED 127.0.0.1:8788（注入 transport 模拟端点不可达）");
  };
  t.calls = [];
  return t;
};

// ==================================================== ① 静态：执行体零删行 / 零改表
console.log("① 静态扫描 · executor.js 零 DELETE/DROP/ALTER/TRUNCATE（去注释后）");
{
  const src = readFileSync(new URL("./executor.js", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/[^\n]*$/gm, "");
  const banned = ["DELETE", "DROP", "ALTER", "TRUNCATE"];
  const hits = banned.filter((w) => new RegExp(`\\b${w}\\b`).test(src));
  assert(hits.length === 0, `零删行/改表类语句（实测命中 ${hits.length ? hits.join(",") : "0"}）`);
  assert(!/\bUPDATE\b/.test(src), "本体零 UPDATE（改行只落在 step-plan/task-state 单一写入面）");
}

// ==================================================== ② 全链路 ok 路径
console.log("② ok 路径全链路 · 5 步全 done → 任务 done → EXT-01/EXT-02/MD-06 逐层落库");
const GOAL = "GOAL-2026Q3-01";
let TASK;
{
  const { sqlite, db } = freshDb();
  // 前置：启用计划内 4 个工具（TOL-01/04/09/11）——种子 is_enabled=0 是旧外部门禁时代的闸门，
  // ADR-004 冻结契约基准后已具备启用条件；远程库的启用走 D1 数据更新（登记 go-live）。
  sqlite.exec("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id IN ('TOL-01','TOL-04','TOL-09','TOL-11')");
  // 前置 2：ACT 在种子中 availability_status='degraded'（T-07 临时态）——F-23 会判受限、F-26 会处置任务受阻；
  // 全链路用例模拟「ACT 已恢复」：置回 ok（远程库同样以数据更新方式恢复，登记 go-live）。
  sqlite.exec("UPDATE source_registry SET availability_status = 'ok', is_mcp_ready = 1 WHERE source_id = 'ACT'");
  const before = {
    opp: countRows(sqlite, "opportunity"),
    ev: countRows(sqlite, "evidence"),
    qr: countRows(sqlite, "query_record"),
  };
  const created = await createDiscoveryTask(db, {
    goal_id: GOAL,
    trigger_basis: "test-stage4 ② 全链路",
    at: "2026-09-21 10:00",
  });
  TASK = created.task.task_id;
  assert(stepRow(sqlite, TASK, 1).step_state === "active", "建任务即投递：步 1 = active（其余 pending）");

  const tr = transportOf((toolCode) => okBody(toolCode));
  const r = await runPendingDiscoveryWork(db, { transport: tr, at: "2026-09-21 10:01" });
  assert(r.executed.length === 5, `驱动执行 5 步（实测 ${r.executed.length}）`);
  assert(r.executed.every((e) => e.outcome === "done"), "五步全部 outcome=done");
  assert(r.finished.includes(TASK), "任务进入 finished");

  const t = taskRow(sqlite, TASK);
  assert(t.task_status === "done", `任务落 done（实测 ${t.task_status}）`);
  assert(t.progress_text === "5 / 5 步", `进度串 5 / 5 步（实测「${t.progress_text}」）`);
  assert(!!t.ended_at, "done 带 ended_at");
  for (const no of [1, 2, 3, 4, 5]) {
    assert(stepRow(sqlite, TASK, no).step_state === "done", `步 ${no} = done`);
  }
  assert(countRows(sqlite, "query_record") === before.qr + 4,
    `EXT-01 落痕 4 行（CDP/HJE/MKT/ACT 各一，实测 ${countRows(sqlite, "query_record") - before.qr}）`);
  assert(tr.calls.length === 4, `transport 恰被调 4 次（实测 ${tr.calls.length}）`);

  const evAfter = countRows(sqlite, "evidence") - before.ev;
  const oppAfter = countRows(sqlite, "opportunity") - before.opp;
  assert(evAfter === 4, `EXT-02 证据落库 4 行（四要素齐：适用范围＝查询声明范围，实测 ${evAfter}）`);
  assert(oppAfter === 4, `MD-06 机会 4 个（每条真实返回逐条判定，实测 ${oppAfter}）`);
  const opp = sqlite.prepare("SELECT producing_task_id, goal_id, goal_version_no, unknown_item FROM opportunity ORDER BY opportunity_id DESC LIMIT 1").get();
  assert(opp.producing_task_id === TASK, `机会归属产出任务（实测 ${opp.producing_task_id}）`);
  assert(opp.goal_id === GOAL && Number(opp.goal_version_no) === created.task.goal_version_no, "六要素·对应目标与版本快照一致");
  assert(typeof opp.unknown_item === "string" && opp.unknown_item.trim() !== "", "unknown_item 已评估（Agent 路径非空串，ADR-003）");
  const donePart = t.done_part || "";
  for (const mark of ["① 载入目标与时间窗", "② 规划采集范围", "③ 采集入口与流量", "④ 识别与聚合线索", "⑤ 生成机会候选", "任务完成"]) {
    assert(donePart.includes(mark), `done_part 含「${mark}」`);
  }
}

// ==================================================== ③ 查询全失败路径（尊重 F-26 处置语义）
console.log("③ 全失败路径 · 查询不可达 → M5 处置任务 blocked、真实原因留痕、机会为零");
{
  const { sqlite, db } = freshDb();
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-stage4 ③", at: "2026-09-21 11:00" });
  const tid = created.task.task_id;
  const beforeOpp = countRows(sqlite, "opportunity");
  const r = await runPendingDiscoveryWork(db, { transport: throwingTransport(), at: "2026-09-21 11:01" });
  assert(r.executed.length === 3 && r.executed.every((e) => e.outcome === "done"),
    `步 1~3 执行（步 3 内查询失败触发 F-26 处置即停手，实测执行 ${r.executed.length} 步）`);
  assert(r.finished.length === 0, "任务未完成（受阻不是完成）");
  const t = taskRow(sqlite, tid);
  assert(t.task_status === "blocked", `任务 blocked（F-26 持续失败处置；实测 ${t.task_status}）`);
  assert(countRows(sqlite, "opportunity") === beforeOpp, "零机会（依据不足不硬凑）");
  const failReason = sqlite.prepare("SELECT fail_reason FROM query_record WHERE task_id = ? AND result_status != 'ok' LIMIT 1").get(tid).fail_reason;
  assert(typeof failReason === "string" && t.done_part.includes(failReason),
    `done_part 含真实失败原因（EXT-01 fail_reason 回查一致：${String(failReason).slice(0, 50)}…）`);
  const blocks = await listTaskBlocks(db, { task_id: tid });
  assert(["call_failed", "source_unavailable"].includes(blocks[0]?.block_reason_code),
    `PD-03 留痕 1 行（reason=传输失败映射，实测 ${blocks.length} 行/${blocks[0]?.block_reason_code}）`);
  const failQr = sqlite.prepare("SELECT COUNT(*) c FROM query_record WHERE result_status != 'ok'").get().c;
  assert(failQr >= 1, `失败查询也留痕 EXT-01（实测 ${failQr} 行非 ok）`);
  const steps = ["pending", "active"];
  const s4 = stepRow(sqlite, tid, 4);
  assert(steps.includes(s4.step_state), `步 4 未再执行（${s4.step_state}，等待恢复）`);
}

// ==================================================== ④ 幂等：重复驱动 no-op
console.log("④ 幂等 · 无 active 步骤时重复驱动是 no-op");
{
  const { sqlite, db } = freshDb();
  sqlite.exec("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id IN ('TOL-01','TOL-04','TOL-09','TOL-11')");
  sqlite.exec("UPDATE source_registry SET availability_status = 'ok', is_mcp_ready = 1 WHERE source_id = 'ACT'");
  await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-stage4 ④", at: "2026-09-21 12:00" });
  await runPendingDiscoveryWork(db, { transport: transportOf((c) => okBody(c)), at: "2026-09-21 12:01" });
  const oppAfter1 = countRows(sqlite, "opportunity");
  const evAfter1 = countRows(sqlite, "evidence");
  const r2 = await runPendingDiscoveryWork(db, { transport: transportOf((c) => okBody(c)), at: "2026-09-21 12:02" });
  assert(r2.executed.length === 0, `第二次驱动 executed 0（实测 ${r2.executed.length}）`);
  assert(countRows(sqlite, "opportunity") === oppAfter1 && countRows(sqlite, "evidence") === evAfter1,
    `机会/证据零新增（实测 ${countRows(sqlite, "opportunity")}/${countRows(sqlite, "evidence")}）`);
}

// ==================================================== ⑤ 结构受阻：快照版本缺失 → PD-03 + blocked
console.log("⑤ 结构受阻 · 目标快照版本缺失 → 步骤 blocked + PD-03 留痕 + 任务 blocked");
{
  const { sqlite, db } = freshDb();
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-stage4 ⑤", at: "2026-09-21 13:00" });
  const tid = created.task.task_id;
  sqlite.prepare("UPDATE task SET goal_version_no = 99 WHERE task_id = ?").run(tid);
  const r = await runDiscoveryStep(db, tid, 1, { at: "2026-09-21 13:01" });
  assert(r.outcome === "blocked" && r.reason === "target_unclear", `outcome=blocked、reason=target_unclear（实测 ${r.outcome}/${r.reason}）`);
  assert(stepRow(sqlite, tid, 1).step_state === "blocked", "步 1 = blocked");
  const t = taskRow(sqlite, tid);
  assert(t.task_status === "blocked", `任务 blocked（实测 ${t.task_status}）`);
  const blocks = await listTaskBlocks(db, { task_id: tid });
  assert(blocks.length === 1 && blocks[0].block_reason_code === "target_unclear",
    `PD-03 留痕 1 行 target_unclear（实测 ${blocks.length}）`);
}

// ==================================================== ⑥ queue consumer 路由
console.log("⑥ queue consumer · discovery 消息走执行体、其余类型走占位");
{
  const { sqlite, db } = freshDb();
  const created = await createDiscoveryTask(db, { goal_id: GOAL, trigger_basis: "test-stage4 ⑥", at: "2026-09-21 14:00" });
  const tid = created.task.task_id;
  const acked = [];
  const batch = { messages: [{ body: { task_id: tid, step_no: 1 }, ack() { acked.push(1); } }] };
  const results = await runner.queue(batch, { DB: db });
  assert(acked.length === 1, "消息被 ack");
  assert(results[0].outcome === "done" && results[0].step_no === 1, "discovery 消息 → 真实执行体（步 1 done）");
  assert(stepRow(sqlite, tid, 1).step_state === "done", "步 1 落 done");

  const r2 = await delegateToAgent(db, { task_id: tid, step_no: 1 });
  assert(r2.delegated === true, "delegateToAgent 占位仍可用于其他类型（契约不删）");

  // goal_check 类消息（种子 T-xxxx 行取一个真实 goal_check 任务）→ 占位
  const gc = sqlite.prepare("SELECT task_id FROM task WHERE task_type = 'goal_check' LIMIT 1").get();
  if (gc) {
    const results2 = await runner.queue(
      { messages: [{ body: { task_id: gc.task_id, step_no: 1 }, ack() {} }] },
      { DB: db },
    );
    assert(results2[0].delegated === true && !results2[0].outcome, "非 discovery 消息 → 契约占位（不误入发现执行体）");
  }
}

finish();
