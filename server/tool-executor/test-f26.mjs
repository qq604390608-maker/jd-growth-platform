#!/usr/bin/env node
/**
 * 文档卡（阶段2 · M5 · F-26 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M5.md`（**TC-I-M5-004 = F-26 验收 oracle**：重试是代码逻辑不是 AI 决策
 *        （Queues `max_retries`，≤100）；持续失败 → 暂停受影响研究、保留已完成部分（`task_status=blocked`，
 *        见 M1 `TC-I-M1-004`）；实在卡死保留状态停止。**TC-I-M5-005 = 生产零写对照面**）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md` F-26（调用失败按配置限制重试；持续失败暂停受影响研究并保留已完成部分；
 *        验收要点：**重试是代码逻辑不是 AI 决策；实在卡死保留状态停止**）
 *   ｜ `../../docs/01-brd/BRD.md` §4 F-06 受阻矩阵（第 3 行 来源未接入或权限不足 / 第 4 行 查询或服务调用失败 /
 *        「达到运行限制或人工取消」→ **停止状态不自动重启**）+ 状态流
 *   ｜ `../../docs/03-locks/schema.md` PD-01 `task`（`task_status` 走 `dict:TASK_STATUS`、`done_part` 已完成部分、
 *        `is_auto_restart` 停止状态一律 0、`ended_at`）、PD-03 `task_block`（`block_id` PK 形如 `BL-001`、
 *        `block_reason_code` 走 `dict:BLOCK_REASON`、`resume_condition`、`is_resolved`）、CFG-04 `run_policy`（`retry_limit`）、
 *        EXT-01 `query_record`（`retry_count` 本次执行已重试次数）、§12 Q-10 / Q-11 / **Q-12**
 *   ｜ `../../docs/03-locks/tech-stack.md` **§4.2（Queues 重试最大 100 次 → 直接对应 CFG-04 `retry_limit`，值域 ≤100；
 *        超限进死信 → 写 `PD-03` 并置 `task_status=blocked`）**
 *   ｜ `../../docs/03-locks/external-deps.md` §6.1（**成功不算失败**，`retry_count` 仍记）/ §6.2（**403 = 受限返回，非失败**）/
 *        §6 末段（超时失败 → `call_failed`）/ §6.8
 *   ｜ `../../docs/04-plan/dev-plan.md` 阶段2（关键交付物：失败重试与受限返回，重试为代码逻辑、卡死保留状态停止，
 *        与 M1 F-06 共用状态机口径）
 *   ｜ `./index.js`（F-23/F-24/F-25 + **F-26 重试与编排**）｜ `./task-state.js`（**F-26 任务态写入面**）｜ `./mcp-client.js`（F-24 传输层）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-26 用例并断言。
 * 硬红线：本地内存库 + 注入式 transport，**零真实外部调用、零生产写**（写只写本地内存库的 `EXT-01` / `PD-01` / `PD-03`）；
 *   **数值以契约基准 v1（ADR-004）为准**，只断字段形态、映射语义、字典值域、重试次数与任务态跃迁。
 * 边界：只验 F-26；F-24 的九类行为映射与 F-25 的留痕不变量不在本执行器范围（各自的执行器已覆盖）。
 *   完整 Queues 重投递与任务状态机本体归 M1 F-06（阶段3）；本执行器只验「阻断口径」一致。
 * 反向清单：登记 `../README.md` 与本目录 `README.md`；被 CI `validate` 步骤复用（`node server/tool-executor/test-f26.mjs`）。
 *
 * 用法：node server/tool-executor/test-f26.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  getRunPolicy,
  retryLimitOf,
  executeQueryWithRetry,
  handleQueryFailure,
  runQueryWithRecovery,
  registerPermission,
  listQueryRecords,
  RETRY_LIMIT_MAX,
} from "./index.js";
import {
  getTask,
  nextBlockId,
  listTaskBlocks,
  recordBlock,
  setTaskStatus,
  appendDonePart,
  dictCodes,
} from "./task-state.js";
import { SCENARIOS, defaultOk } from "../../prototype/mock/scenarios.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const INDEX_SRC = new URL("./index.js", import.meta.url);
const STATE_SRC = new URL("./task-state.js", import.meta.url);

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

const G = { grantee_type: "agent", grantee_ref: "qa-f26-agent" };
const RUNNING = "T-1023"; // 种子：running，2 / 5 步，done_part 已有内容
const BLOCKED = "T-1020"; // 种子：blocked 且有未解除的 call_failed（BL-001）
const STOPPED = "T-1019"; // 种子：stopped
const DONE = "T-1021"; // 种子：done
const GOAL = "GOAL-2026Q3-01"; // 种子：有目标级策略 POL-Q3（retry_limit=3）
const AT = "2026-09-19 12:00:00";

/** 让某工具可被允许：启用工具 + 其来源 MCP 化 + 可用 + 给 G 一条有效期内的允许授权。 */
async function allow(db, tool_id, source_id) {
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = ?").bind(tool_id).run();
  await db
    .prepare("UPDATE source_registry SET is_mcp_ready = 1, availability_status = 'ok' WHERE source_id = ?")
    .bind(source_id)
    .run();
  await registerPermission(db, {
    permission_id: `PERM-F26-${tool_id}`,
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

/** 前 `failTimes` 次返回失败体，之后返回成功体——用于验「重试后成功，成功不算失败」。 */
function flakyTransport(failTimes, { ok, fail }) {
  const t = async function () {
    t.calls.push(1);
    const p = t.calls.length <= failTimes ? fail : ok;
    return JSON.parse(JSON.stringify(p));
  };
  t.calls = [];
  return t;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

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

// ==================================================== ① 值域不内联 + CFG-04 重试上限口径
console.log("① 值域不内联 + CFG-04 `retry_limit` 口径（tech-stack §4.2 ≤100）");
{
  const { db } = freshDb();
  const taskStatuses = await dictCodes(db, "TASK_STATUS");
  assert(taskStatuses.join("/") === "running/blocked/stopped/done", `task_status 值域取自 dict:TASK_STATUS（实测 ${taskStatuses.join("/")}）`);
  const blockReasons = await dictCodes(db, "BLOCK_REASON");
  assert(blockReasons.length === 6 && blockReasons.includes("call_failed") && blockReasons.includes("source_unavailable"),
    `受阻原因值域取自 dict:BLOCK_REASON（${blockReasons.length} 项，含 call_failed / source_unavailable）`);
  assert(RETRY_LIMIT_MAX === 100, `重试上限常量 = 100（tech-stack §4.2 Queues 最大重试，实测 ${RETRY_LIMIT_MAX}）`);

  const goalPolicy = await getRunPolicy(db, { goal_id: GOAL });
  assert(goalPolicy && goalPolicy.policy_id === "POL-Q3", `目标级策略优先（实测 ${goalPolicy && goalPolicy.policy_id}）`);
  const info = retryLimitOf(goalPolicy);
  assert(info.retry_limit === 3 && info.policy_source === "goal", `重试上限由策略决定 = ${info.retry_limit}（来源 ${info.policy_source}）`);
  assert(info.clamped === false, "策略值在平台上限内，不截断");

  const plat = await getRunPolicy(db, { goal_id: "GOAL-NOPE" });
  assert(plat && plat.policy_id === "POL-PLAT", `无目标级策略时回落平台级（实测 ${plat && plat.policy_id}）`);

  const none = retryLimitOf(null);
  assert(none.retry_limit === 0 && none.policy_source === "none" && /不假设默认重试次数/.test(none.note),
    "无生效策略 → 不重试，并显式说明（**不假设默认值**）");

  const over = retryLimitOf({ policy_id: "POL-X", policy_scope: "goal", retry_limit: 500 });
  assert(over.retry_limit === 100 && over.clamped === true && /超过平台上限 100/.test(over.note),
    "越界值截断到 100 并标注（不静默放过、也不改成别的数）");
  const zero = retryLimitOf({ policy_id: "POL-Y", policy_scope: "platform", retry_limit: 0 });
  assert(zero.retry_limit === 0 && zero.clamped === false, "retry_limit=0 → 不重试（合法配置，非异常）");
}

// ==================================================== ② 重试后成功：成功不算失败
console.log("\n② TC-I-M5-004 · 重试是**代码逻辑**：重试后成功 → 成功不算失败（external-deps §6.1）");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const cond = { biz: "超市", granularity: "天" };
  const t = flakyTransport(2, {
    ok: defaultOk("cdp.crowd.query", "CDP"),
    fail: SCENARIOS.timeout_fail("cdp.crowd.query"),
  });

  const exec = await executeQueryWithRetry(
    db,
    { tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: cond, at: AT, transport: t },
    { retry_limit: 3 },
  );
  assert(t.calls.length === 3, `重试次数由**代码**决定（实测调用 ${t.calls.length} 次，无任何模型参与）`);
  assert(exec.attempts.length === 3 && exec.retried === 2, `attempts=${exec.attempts.length} / retried=${exec.retried}`);
  assert(exec.outcome === "ok", `终局 outcome=${exec.outcome}`);
  assert(exec.envelope.result_status === "ok", "重试后成功 → result_status=ok");
  assert(exec.envelope.fail_reason === null, "**成功不算失败**：fail_reason 为空");
  assert(exec.envelope.retry_count === 2, `retry_count 记本层重试次数 = ${exec.envelope.retry_count}`);
  assert(exec.envelope.retry_count_source === "platform", "retry_count 来源显式标为 platform（重试是代码逻辑的留痕）");
  assert(exec.envelope.retry_limit === 3, "信封带上本次生效的重试上限，可回查");
  assert(exec.attempts[0].result_status === "fail" && exec.attempts[2].result_status === "ok",
    "逐次尝试的证据面留在 attempts[]（失败也留痕的完整面）");

  const before = countRows(sqlite, "query_record");
  const t2 = flakyTransport(2, {
    ok: defaultOk("cdp.crowd.query", "CDP"),
    fail: SCENARIOS.timeout_fail("cdp.crowd.query"),
  });
  const out = await runQueryWithRecovery(db, {
    tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: cond, at: AT, retry_limit: 3, transport: t2,
  });
  assert(t2.calls.length === 3 && out.retried === 2, `编排层同样按代码重试（实测重试 ${out.retried} 次 / 调用 ${t2.calls.length} 次）`);
  assert(out.persisted === true && countRows(sqlite, "query_record") === before + 1, "重试后成功仍落**一行** EXT-01（一次执行一行）");
  const rec = (await listQueryRecords(db, { task_id: RUNNING })).find((r) => r.query_id === out.query_id);
  assert(rec.result_status === "ok" && rec.retry_count === 2 && rec.restricted_flag === 0,
    "落库：ok + retry_count=2 + restricted_flag=0");
  assert(out.recovery.outcome === "none", "成功**不改任务态**（recovery.outcome=none）");
  const task = await getTask(db, RUNNING);
  assert(task.task_status === "running", `任务态保持 running（实测 ${task.task_status}）`);

  // upsteam 透传口径：本层未重试时沿用返回体值（§6.1 慢响应场景）
  const slow = await executeQueryWithRetry(
    db,
    { tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: cond, at: AT, transport: transportOf({ default: SCENARIOS.slow("cdp.crowd.query") }) },
    { retry_limit: 3 },
  );
  assert(slow.retried === 0 && slow.envelope.result_status === "ok", "慢响应已成功 → 本层不重试");
  assert(slow.envelope.retry_count === 2 && slow.envelope.retry_count_source === "upstream_passthrough",
    "本层未重试 → retry_count 沿用返回体透传值并显式标注来源（§6.1）");
}

// ==================================================== ③ 用尽 → 受阻（blocked）+ 保留已完成部分
console.log("\n③ TC-I-M5-004 · 持续失败 → 暂停受影响研究：写 PD-03 + task_status=blocked，保留已完成部分");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const beforeBlocks = countRows(sqlite, "task_block");
  const beforeQueries = countRows(sqlite, "query_record");
  const taskBefore = await getTask(db, RUNNING);
  const t = transportOf({ default: SCENARIOS.timeout_fail("cdp.crowd.query") });

  const out = await runQueryWithRecovery(db, {
    tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: "人群×行为", at: AT, transport: t,
  });
  assert(out.outcome === "exhausted", `终局 outcome=${out.outcome}`);
  assert(out.retried === 3 && t.calls.length === 4, `按 CFG-04 retry_limit=3 重试（实测重试 ${out.retried} 次 / 共调用 ${t.calls.length} 次）`);
  assert(out.envelope.retry_count === 3 && out.envelope.retry_count_source === "platform", "信封 retry_count=3（本层）");
  assert(/重试 3\/3/.test(String(out.envelope.fail_reason)), `失败原因带重试次数（实测「${out.envelope.fail_reason}」）`);

  assert(out.persisted === true && countRows(sqlite, "query_record") === beforeQueries + 1, "用尽仍落**一行** EXT-01（失败也留痕）");
  const rec = (await listQueryRecords(db, { task_id: RUNNING, result_status: "fail" })).find((r) => r.query_id === out.query_id);
  assert(rec && rec.fail_reason && rec.retry_count === 3, "落库：fail + fail_reason 非空 + retry_count=3（F-25 不变量仍成立）");

  assert(out.recovery.outcome === "blocked", `任务态处置 outcome=${out.recovery.outcome}`);
  assert(countRows(sqlite, "task_block") === beforeBlocks + 1, "新增一行 PD-03 受阻记录");
  const block = out.recovery.block;
  assert(/^BL-\d{3}$/.test(block.block_id) && block.block_id !== "BL-001" && block.block_id !== "BL-002",
    `block_id 形如 BL-001 且不与种子撞号（实测 ${block.block_id}）`);
  assert(block.block_reason_code === "call_failed", "受阻原因=call_failed（受阻矩阵第 4 行「查询或服务调用失败」）");
  assert(block.resume_condition === "服务恢复且满足任务继续条件", `继续条件对齐矩阵第 4 行（实测「${block.resume_condition}」）`);
  assert(block.is_resolved === 0, "新受阻未解除（等继续条件满足）");
  assert(/重试 3\/3/.test(block.block_note), "受阻说明保留失败原因与重试次数");

  const taskAfter = await getTask(db, RUNNING);
  assert(taskAfter.task_status === "blocked", `任务态 running → blocked（实测 ${taskAfter.task_status}）`);
  assert(taskAfter.is_auto_restart === 0, "is_auto_restart=0（schema PD-01：停止状态一律 0）");
  assert(String(taskAfter.done_part).includes(String(taskBefore.done_part)),
    "**保留已完成部分**：done_part 原有内容仍在（只追加、不覆盖）");
  assert(String(taskAfter.done_part).length > String(taskBefore.done_part).length, "并把本次失败事实追加进 done_part");
  assert(out.recovery.previous_task_status === "running", "处置结果带出改前状态，便于回查跃迁（白盒）");
}

// ==================================================== ④ 再失败 → 停止（stopped）；停止不自动重启
console.log("\n④ TC-I-M5-004 · **实在卡死保留状态停止**：同类受阻再犯 → stopped；停止状态不自动重启");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const t = transportOf({ default: SCENARIOS.timeout_fail("cdp.crowd.query") });
  const params = { tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: "人群×行为", at: AT, transport: t };

  const first = await runQueryWithRecovery(db, params);
  assert(first.recovery.outcome === "blocked" && first.recovery.had_open_same_reason === false,
    "第 1 次用尽：无同类未解除受阻 → blocked（受阻待恢复）");

  const second = await runQueryWithRecovery(db, params);
  assert(second.recovery.outcome === "stopped" && second.recovery.had_open_same_reason === true,
    "第 2 次用尽：已有未解除的同类受阻 → stopped（真卡死，保留状态停止）");
  assert(second.recovery.block.resume_condition === "持续失败后停止（保留已完成部分，不自动重启）",
    `停止记录的继续条件如实登记（实测「${second.recovery.block.resume_condition}」）`);
  const stopped = await getTask(db, RUNNING);
  assert(stopped.task_status === "stopped", `任务态 → stopped（实测 ${stopped.task_status}）`);
  assert(!!stopped.ended_at, "停止时写入 ended_at（任务结束时点）");
  assert(stopped.is_auto_restart === 0, "停止状态 is_auto_restart=0");
  const blocksOfTask = await listTaskBlocks(db, { task_id: RUNNING });
  const failRowsOfTask = await listQueryRecords(db, { task_id: RUNNING, result_status: "fail" });
  assert(blocksOfTask.length >= 2, `两次执行各留一条受阻记录（逐次留痕，不覆盖；实测 ${blocksOfTask.length} 条）`);
  assert(failRowsOfTask.length >= 2, `两次失败各留一行 EXT-01（失败也留痕；实测 ${failRowsOfTask.length} 行）`);

  const qBefore = countRows(sqlite, "query_record");
  const bBefore = countRows(sqlite, "task_block");
  await assertThrows(() => runQueryWithRecovery(db, params), "已停止任务再触发 → 前置守卫拒绝", "停止状态不自动重启");
  const stillStopped = await getTask(db, RUNNING);
  assert(stillStopped.task_status === "stopped", "被拒后任务态未被改动（停止状态不自动重启）");
  assert(countRows(sqlite, "query_record") === qBefore && countRows(sqlite, "task_block") === bBefore,
    "前置守卫**在写入之前**就拒绝：不留半截状态（EXT-01 / PD-03 行数均不变）");

  await assertThrows(() => runQueryWithRecovery(db, { ...params, task_id: DONE }),
    `已完成任务 ${DONE} 同样先被前置守卫拒（不进执行）`, "任务已完成");
  assert((await getTask(db, DONE)).task_status === "done", "已完成任务态未被改动");

  await assertThrows(() => setTaskStatus(db, STOPPED, "running"), `种子里已停止的 ${STOPPED} 不允许改回 running`, "停止状态不自动重启");
  await assertThrows(() => setTaskStatus(db, DONE, "blocked"), `已完成任务 ${DONE} 不允许改回受阻（不改写已结束的任务态）`, "任务已完成");

  const seedBlocked = await getTask(db, BLOCKED);
  assert(seedBlocked.task_status === "blocked", `种子 ${BLOCKED} 为受阻（已有未解除 BL-001 call_failed）`);
  const out = await runQueryWithRecovery(db, { ...params, task_id: BLOCKED });
  assert(out.recovery.outcome === "stopped" && out.recovery.had_open_same_reason === true,
    "已受阻且同类受阻未解除的任务再失败 → 直接 stopped（「持续失败」的可判定门槛）");
  const after = await getTask(db, BLOCKED);
  assert(after.task_status === "stopped", `实测 ${BLOCKED} → ${after.task_status}`);
}

// ==================================================== ⑤ 受限返回：不重试 + 落 source_unavailable 受阻
console.log("\n⑤ TC-I-M5-004 · **受限返回**（external-deps §6.2「非失败」）：不重试，但如实落受阻");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const t = transportOf({ default: SCENARIOS.restricted("cdp.behavior.agg") });

  const exec = await executeQueryWithRetry(
    db,
    { tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: "人群范围=超出授权", at: AT, transport: t },
    { retry_limit: 3 },
  );
  assert(exec.outcome === "restricted", `outcome=${exec.outcome}（受限，非失败）`);
  assert(t.calls.length === 1 && exec.retried === 0, `受限**不重试**（实测调用 ${t.calls.length} 次）——重试不改变权限`);
  assert(exec.envelope.restricted_flag === 1, "受限标记 restricted_flag=1");
  assert(exec.envelope.retry_count === 0, "受限分支 retry_count=0");

  const out = await runQueryWithRecovery(db, {
    tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: "人群范围=超出授权", at: AT, transport: t,
  });
  assert(out.persisted === true, "受限仍落一行 EXT-01（失败也留痕的对照面）");
  const rec = (await listQueryRecords(db, { task_id: RUNNING })).find((r) => r.query_id === out.query_id);
  assert(rec.restricted_flag === 1 && rec.retry_count === 0 && !!rec.fail_reason, "落库：restricted_flag=1 + retry_count=0 + 原因非空");
  assert(out.recovery.outcome === "blocked", "受限 → 任务受阻（矩阵第 3 行：记录接口不可用原因与受影响的研究内容）");
  assert(out.recovery.block.block_reason_code === "source_unavailable", "受阻原因=source_unavailable（矩阵第 3 行「来源未接入或权限不足」）");
  assert(out.recovery.block.resume_condition === "接入或权限问题解决", `继续条件对齐矩阵第 3 行（实测「${out.recovery.block.resume_condition}」）`);
  const task = await getTask(db, RUNNING);
  assert(task.task_status === "blocked", `任务态 → blocked（实测 ${task.task_status}）`);

  // 事前判定受限（F-23 判定链短路）：同形态、不重试、且无 source_id 可写 → 显式 persist_skip（Q-11），不静默丢
  const pre = await runQueryWithRecovery(db, {
    tool_code: "no.such.tool", ...G, task_id: RUNNING, query_condition: "任意", at: AT, retry_limit: 3,
  });
  assert(pre.outcome === "restricted" && pre.retried === 0 && pre.attempts.length === 1, "事前判定受限 → 同样不重试");
  assert(pre.envelope.transport_called === false, "事前判定受限 → 根本不发起外部调用（TC-I-M5-001 权限分支互斥）");
  assert(pre.persisted === false && pre.persist_skip && pre.persist_skip.reason_code === "tool_not_found",
    "无 source_id 可写 → persist_skip 显式标出（schema §12 Q-11 方向②），**不冒充已留痕**");
  const blockedAgain = await getTask(db, RUNNING);
  assert(blockedAgain.task_status === "stopped", "同类受限再犯 → 走同一「卡死」门槛 → stopped");
}

// ==================================================== ⑥ 写入面静态验证（生产零写可被证明）
console.log("\n⑥ TC-I-M5-005 · 生产零写：写入面可被静态验证");
{
  const indexRaw = readFileSync(INDEX_SRC, "utf8");
  const stateRaw = readFileSync(STATE_SRC, "utf8");
  const state = stripComments(stateRaw);

  assert(!/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(indexRaw),
    "index.js 仍不含改行/删行类 SQL（**test-f23.mjs 断言逐字不动**，实测通过）");
  assert(!/\bfetch\s*\(|\bhttps?:\/\//.test(state), "task-state.js 不含任何外部 HTTP 调用");

  const targets = [...state.matchAll(/UPDATE\s+([a-z_]+)/gi)].map((m) => m[1].toLowerCase());
  assert(targets.length > 0 && targets.every((t) => t === "task"),
    `task-state.js 的改行语句只落在 PD-01 task（实测 ${[...new Set(targets)].join(" / ")}）`);
  const chunks = state.split(/UPDATE\s+task\b/).slice(1);
  assert(chunks.length === 2 && chunks.every((c) => c.slice(0, 300).includes("WHERE task_id = ?")),
    `每条 task 改行都按主键定位（${chunks.length} 条，均带 WHERE task_id = ?，**禁全表更新**）`);
  assert(!/\b(DELETE|DROP|ALTER|TRUNCATE)\b/.test(state), "task-state.js 无删行 / 改结构语句（只新增与按期更新）");
}

// ==================================================== ⑦ 运行期零写与「失败不否定结论」
console.log("\n⑦ TC-I-M5-005 · 运行期零写 + 失败不否定结论（不动 EXT-02 / MD-07）");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const watch = ["tool_registry", "tool_permission", "source_registry", "evidence", "research"];
  const before = Object.fromEntries(watch.map((t) => [t, countRows(sqlite, t)]));
  const otherTasksBefore = sqlite.prepare(`SELECT task_id, task_status, done_part FROM task WHERE task_id <> ? ORDER BY task_id`).all(RUNNING);

  const out = await runQueryWithRecovery(db, {
    tool_id: "TOL-01", ...G, task_id: RUNNING, query_condition: "人群×行为", at: AT,
    transport: transportOf({ default: SCENARIOS.timeout_fail("cdp.crowd.query") }),
  });
  assert(out.recovery.outcome === "blocked", "本次执行以受阻收口");

  for (const t of watch) {
    assert(countRows(sqlite, t) === before[t], `配置/研究侧表未被改动：${t} 仍 ${before[t]} 行`);
  }
  const otherTasksAfter = sqlite.prepare(`SELECT task_id, task_status, done_part FROM task WHERE task_id <> ? ORDER BY task_id`).all(RUNNING);
  assert(JSON.stringify(otherTasksAfter) === JSON.stringify(otherTasksBefore),
    "除目标任务外，其余任务行**逐字未变**（write 面按主键圈定）");
  const changed = sqlite.prepare("SELECT task_status FROM task WHERE task_id = ?").get(RUNNING);
  assert(changed.task_status === "blocked", "只有目标任务的状态被改（读写面收窄）");

  // 回查入口
  const open = await listTaskBlocks(db, { task_id: RUNNING, is_resolved: 0 });
  assert(open.length === 1 && open[0].block_id === out.recovery.block.block_id, "受阻记录可按任务 + 未解除回查");
  assert((await nextBlockId(db)) !== open[0].block_id, `下一个受阻号继续递增（${await nextBlockId(db)}）`);

  const fragment = "重复片段不应二次追加";
  await appendDonePart(db, RUNNING, fragment);
  const once = (await getTask(db, RUNNING)).done_part;
  await appendDonePart(db, RUNNING, fragment);
  assert((await getTask(db, RUNNING)).done_part === once, "appendDonePart 幂等：同一片段不重复追加");
}

// ==================================================== ⑧ 非法入参一律拒（值域与必填）
console.log("\n⑧ 值域不内联落到写入面：非法受阻原因 / 非法任务态 / 缺归属 一律拒");
{
  const { db } = freshDb();
  await assertThrows(
    () => recordBlock(db, { task_id: RUNNING, block_reason_code: "nope", block_note: "x", resume_condition: "y", blocked_at: AT }),
    "受阻原因不在 dict:BLOCK_REASON → 拒（值域从库读，不内联）", "不在 dict:BLOCK_REASON 值域内",
  );
  await assertThrows(() => setTaskStatus(db, RUNNING, "weird"), "任务态不在 dict:TASK_STATUS → 拒", "不在 dict:TASK_STATUS 值域内");
  await assertThrows(() => recordBlock(db, { block_reason_code: "call_failed", block_note: "x", resume_condition: "y" }),
    "缺 task_id → 拒（受阻记录须归属真实任务）", "task_id 必填");
  await assertThrows(() => handleQueryFailure(db, { envelope: { result_status: "fail", fail_reason: "x" } }),
    "handleQueryFailure 缺 task_id → 拒", "task_id 必填");
  await assertThrows(() => setTaskStatus(db, "T-NOPE", "blocked"), "任务不存在 → 拒", "任务不存在");
  const bad = await recordBlock(db, { task_id: RUNNING, block_reason_code: "call_failed", block_note: "x", resume_condition: "y", blocked_at: AT });
  assert(bad.block_reason_code === "call_failed" && bad.is_resolved === 0, "合法受阻原因可落（is_resolved 默认 0）");
  await assertThrows(() => setTaskStatus(db, "T-NOPE", "blocked"), "再次确认：任务不存在不产生任何写入", "任务不存在");
  const task = await getTask(db, RUNNING);
  assert(task.task_status === "running", "上一例失败未污染目标任务的态（无部分写入）");
}

finish();
