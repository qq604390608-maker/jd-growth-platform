#!/usr/bin/env node
/**
 * 文档卡（阶段3 · M1 · F-06 用例执行器 · 2026-09-19）
 * 上游：../../docs/05-test-cases/test-M1.md（**TC-U-M1-002**（L1·F-06：retry_limit 封顶 100 显式报错）｜
 *        **TC-D-M1-005**（L3·F-06：PD-03 `task_block.task_id='T-NOPE'` → FK 反例）｜
 *        **TC-I-M1-004**（L5·F-06：持续失败→blocked 不自动重启；研究内容与运行状态分别记录；已完成部分保留；失败不否定 HVA）｜
 *        **TC-I-M1-006**（L5·F-01/F-06：状态跃迁可查；消息只带 task_id+step_no，上下文现读））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-06（任务受阻处理矩阵 + 状态流）｜ ../../docs/02-prd/PRD-M1-平台任务程序.md F-06
 *   ｜ ../../docs/03-locks/schema.md PD-01 task、PD-03 task_block、CFG-04 run_policy（retry_limit≤100）
 *   ｜ ../../docs/03-locks/tech-stack.md §4.2（Queues max_retries≤100）
 *   ｜ ./recovery.js（F-06 本体，复用 F-26 task-state.js 写入面）｜ ../tool-executor/task-state.js（F-26 写入面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-06 用例并断言。
 * 硬红线：本地内存库，**零真实外部调用、零生产写**（写只写本地内存库的 PD-01 / PD-03）；
 *   **数值以契约基准 v1（ADR-004）为准**，只断字段形态、映射语义、字典值域、状态跃迁与「失败不否定结论」不变量。
 * 边界：只验 F-06；F-26 阻断口径一致性由 test-f26.mjs 覆盖（本执行器仅复用其写入面并校验 FK 反例）。
 * 反向清单：登记 ./README.md 与本目录 README.md；被 CI `validate` 步骤复用（`node server/task-runner/test-f06.mjs`）。
 *
 * 用法：node server/task-runner/test-f06.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  capRetryLimit,
  recordTaskBlock,
  stopTask,
  resumeTask,
  rebuildActiveStepOnResume,
  handleTaskFailure,
  BLOCK_REASON,
  BLOCK_REASON_CODE,
} from "./recovery.js";
import {
  getTask,
  recordBlock,
  setTaskStatus,
  listTaskBlocks,
  TaskStateError,
} from "../tool-executor/task-state.js";
import {
  createTask,
  planTaskSteps,
  advanceStep,
  listTaskSteps,
  linkTaskObject,
} from "./step-plan.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const RECOVERY_SRC = new URL("./recovery.js", import.meta.url);

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

const RUNNING = "T-1023"; // 种子：running，done_part 已有内容
const STOPPED = "T-1019"; // 种子：stopped
const DONE = "T-1021"; // 种子：done
const AT = "2026-09-19 12:00:00";
const FRAG = "已补查的乳品渠道结构（F-06 测试）";

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

// ==================================================== ① 值域不内联 + capRetryLimit 封顶（TC-U-M1-002）
console.log("① TC-U-M1-002 · `retry_limit` 封顶 100，超限**显式报错**而非静默截断");
{
  assert(BLOCK_REASON.call_failed === "call_failed" && BLOCK_REASON.limit_or_cancel === "limit_or_cancel",
    "BLOCK_REASON 六类受阻原因语义映射存在（target_unclear/no_data_returned/source_unavailable/call_failed/limit_or_cancel/insufficient_basis）");
  assert(BLOCK_REASON_CODE.call_failed === "call_failed" && BLOCK_REASON_CODE.source_unavailable === "source_unavailable",
    "重导出 F-26 BLOCK_REASON_CODE（call_failed / source_unavailable）可用");

  assert(capRetryLimit(100) === 100, "retry_limit=100 → 不报错（恰为平台上限）");
  assert(capRetryLimit(99) === 99, "retry_limit=99 → 通过");
  assert(capRetryLimit(0) === 0, "retry_limit=0 → 合法（不重试）");
  await assertThrows(() => capRetryLimit(150), "retry_limit=150 → 显式报错（不静默截断）", "超过平台硬上限 100");
  await assertThrows(() => capRetryLimit(101), "retry_limit=101 → 显式报错", "超过平台硬上限 100");
  await assertThrows(() => capRetryLimit(-1), "retry_limit=-1 → 报错（非 ≥0 整数）", "须为 ≥0 整数");
  await assertThrows(() => capRetryLimit(3.5), "retry_limit=3.5 → 报错（非整数）", "须为 ≥0 整数");
  await assertThrows(() => capRetryLimit("x"), "retry_limit='x' → 报错（非整数）", "须为 ≥0 整数");
}

// ==================================================== ② PD-03 FK 反例（TC-D-M1-005）
console.log("\n② TC-D-M1-005 · PD-03 `task_block.task_id='T-NOPE'` → FK 反例");
{
  const { db } = freshDb();
  await assertThrows(
    () => recordBlock(db, { task_id: "T-NOPE", block_reason_code: "call_failed", block_note: "x", resume_condition: "y", blocked_at: AT }),
    "PD-03 受阻记录写不存在的任务 → FK 失败（库级约束）", "FOREIGN KEY",
  );
  const { db: db2 } = freshDb();
  await assertThrows(
    () => recordTaskBlock(db2, { task_id: "T-NOPE", block_reason_code: "call_failed", done_part_fragment: "y" }),
    "recordTaskBlock 对不存在的任务 → 前置守卫「任务不存在」拒（应用层早于 FK）", "任务不存在",
  );
}

// ==================================================== ③ 受阻处理：blocked + 保留已完成部分 + 研究/状态分别记录（TC-I-M1-004）
console.log("\n③ TC-I-M1-004 · 任务执行受阻 → 置 blocked、保留已完成部分、研究内容与运行状态分别记录、失败不否定 HVA");
{
  const { sqlite, db } = freshDb();
  const taskBefore = await getTask(db, RUNNING);
  assert(taskBefore.task_status === "running", `前置：${RUNNING} 为 running（实测 ${taskBefore.task_status}）`);
  const researchBefore = countRows(sqlite, "research");
  const evidenceBefore = countRows(sqlite, "evidence");
  const stepsBefore = countRows(sqlite, "task_step");
  const blocksBefore = countRows(sqlite, "task_block");

  const out = await recordTaskBlock(db, {
    task_id: RUNNING,
    block_reason_code: BLOCK_REASON.call_failed,
    block_note: "CDP 行为明细查询失败（接口超时）",
    resume_condition: "等待 CDP 接口恢复",
    done_part_fragment: FRAG,
  });
  assert(out.task.task_status === "blocked", `任务态 running → blocked（实测 ${out.task.task_status}）`);
  assert(out.block.block_reason_code === "call_failed", "受阻原因=call_failed（受阻矩阵第 4 行「查询或服务调用失败」）");
  assert(out.block.is_resolved === 0, "新受阻未解除（等继续条件满足）");
  assert(String(out.task.done_part).includes(FRAG), "已完成部分已追加新片段");
  assert(String(out.task.done_part).includes(String(taskBefore.done_part)), "**保留已完成部分**：原 done_part 内容仍在（只追加、不覆盖）");

  // 研究内容与运行状态分别记录：F-06 只动 PD-01/PD-03，绝不碰 PD-02/MD-07/EXT-02
  assert(countRows(sqlite, "research") === researchBefore, `research 表行数不变（${researchBefore}→${countRows(sqlite, "research")}；失败不否定 HVA）`);
  assert(countRows(sqlite, "evidence") === evidenceBefore, `evidence 表行数不变（${evidenceBefore}→${countRows(sqlite, "evidence")}；失败不污染依据）`);
  assert(countRows(sqlite, "task_step") === stepsBefore, `task_step（研究内容/步骤结果）行数不变（${stepsBefore}→${countRows(sqlite, "task_step")}；与运行状态分别记录）`);
  assert(countRows(sqlite, "task_block") === blocksBefore + 1, `新增一行 PD-03 受阻记录（${blocksBefore}→${countRows(sqlite, "task_block")}）`);

  // 状态跃迁可查（TC-I-M1-006）：改后状态直读 PD-01
  const reread = await getTask(db, RUNNING);
  assert(reread.task_status === "blocked", "状态跃迁可查：改后读 PD-01 即见 blocked（白盒事实）");
  const blocks = await listTaskBlocks(db, { task_id: RUNNING, is_resolved: 0 });
  assert(blocks.length === 1 && blocks[0].block_id === out.block.block_id, "受阻记录可按任务 + 未解除回查");
}

// ==================================================== ④ 处理调用失败便捷编排（handleTaskFailure）
console.log("\n④ handleTaskFailure · 处理调用失败的便捷编排（call_failed）");
{
  const { db } = freshDb();
  const out = await handleTaskFailure(db, { task_id: RUNNING, done_part_fragment: "失败前已完成的预处理" });
  assert(out.task.task_status === "blocked" && out.block.block_reason_code === "call_failed", "默认原因=call_failed，态=blocked");
}

// ==================================================== ⑤ 恢复：blocked → running（状态流「检查继续条件满足 → 恢复原任务」）
console.log("\n⑤ TC-I-M1-006 · 恢复：blocked → running，状态跃迁可查");
{
  const { sqlite, db } = freshDb();
  await recordTaskBlock(db, { task_id: RUNNING, block_reason_code: BLOCK_REASON.call_failed, done_part_fragment: FRAG });
  // 脏态夹具（F-37）：受阻有两个写入方——F-26 对 `blocked` 留空、执行体 `catch` 落时刻。
  // 这里造出后者的同形脏态（线上 T-0026 即此形），再 resume，验证「进行中为空」被恢复。
  const DIRTY = "2026-09-21 16:00";
  sqlite.prepare("UPDATE task SET ended_at = ? WHERE task_id = ?").run(DIRTY, RUNNING);
  assert((await getTask(db, RUNNING)).ended_at === DIRTY, "前置：造出「blocked + ended_at 非空」同形脏态（执行体 catch 口径）");

  const res = await resumeTask(db, { task_id: RUNNING });
  assert(res.task.task_status === "running", `任务态 blocked → running（实测 ${res.task.task_status}）`);
  assert(res.task.ended_at === null, `恢复后 ended_at 清空（锁定列口径「任务结束时点；进行中为空」；实测 ${String(res.task.ended_at)}）`);
  // 受阻记录为追加式历史缺口日志，恢复不改写它（仍留作审计）
  const blocks = await listTaskBlocks(db, { task_id: RUNNING, is_resolved: 0 });
  assert(blocks.length === 1, "恢复后受阻记录仍在（历史缺口日志，不抹除）");

  // 反例（不误伤）：**清空只发生在 resume 这一处**——未显式声明清空的跃迁仍走 `COALESCE(?, ended_at)` 保留旧值，
  // 否则 `done` / `stopped` 落下的结束时点会被后续普通跃迁抹掉。
  const other = freshDb();
  await recordTaskBlock(other.db, { task_id: RUNNING, block_reason_code: BLOCK_REASON.call_failed });
  other.sqlite.prepare("UPDATE task SET ended_at = ? WHERE task_id = ?").run(DIRTY, RUNNING);
  const kept = await setTaskStatus(other.db, RUNNING, "running");
  assert(kept.ended_at === DIRTY, "反例：未显式声明清空时沿用 COALESCE 保留旧值（清空只发生在 resume 一处）");
}

// ==================================================== ⑥ 停止：达到运行限制或人工取消 → stopped，停止状态不自动重启
console.log("\n⑥ TC-I-M1-004 · 停止状态不自动重启：stopTask → stopped；后续任何状态变更均被守卫拒绝");
{
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "task_block");
  const out = await stopTask(db, { task_id: RUNNING, done_part_fragment: "停止前已形成的范围说明" });
  assert(out.task.task_status === "stopped", `任务态 → stopped（实测 ${out.task.task_status}）`);
  assert(!!out.task.ended_at, "停止时写入 ended_at（任务结束时点）");
  assert(out.task.is_auto_restart === 0, "停止状态 is_auto_restart=0（schema PD-01：停止状态一律 0）");
  assert(out.block.block_reason_code === "limit_or_cancel", "停止记录原因=limit_or_cancel（受阻矩阵「达到运行限制或人工取消」）");
  assert(countRows(sqlite, "task_block") === before + 1, "停止同样留一行 PD-03（逐次留痕）");
  assert(String(out.task.done_part).includes("停止前已形成的范围说明"), "停止同样保留已完成部分");

  // 停止状态不自动重启：前置守卫与状态变更守卫双重拒绝
  await assertThrows(() => resumeTask(db, { task_id: RUNNING }), "已停止任务 resumeTask → 拒（仅 blocked 可恢复）", "仅 blocked 任务可恢复");
  await assertThrows(() => recordTaskBlock(db, { task_id: RUNNING, block_reason_code: BLOCK_REASON.call_failed }),
    "已停止任务 recordTaskBlock → 前置守卫拒", "停止状态不自动重启");
  await assertThrows(() => setTaskStatus(db, RUNNING, "running"), "已停止任务 setTaskStatus→running → 拒（停止不自动重启）", "停止状态不自动重启");
}

// ==================================================== ⑦ 已完成任务不可改写（done 为终态）
console.log("\n⑦ 已完成任务不可改写：done 为终态，不接受新执行 / 恢复");
{
  const { db } = freshDb();
  await assertThrows(() => recordTaskBlock(db, { task_id: DONE, block_reason_code: BLOCK_REASON.call_failed }),
    `已完成任务 ${DONE} recordTaskBlock → 前置守卫拒`, "任务已完成");
  await assertThrows(() => stopTask(db, { task_id: DONE }), `已完成任务 ${DONE} stopTask → 前置守卫拒`, "任务已完成");
  await assertThrows(() => resumeTask(db, { task_id: DONE }), `已完成任务 ${DONE} resumeTask → 拒（非 blocked）`, "仅 blocked 任务可恢复");
}

// ==================================================== ⑧ done_part 幂等追加（保留已完成部分，不重复追加）
console.log("\n⑧ done_part 只追加、不覆盖、幂等（同一片段不二次追加）");
{
  const { db } = freshDb();
  await recordTaskBlock(db, { task_id: RUNNING, block_reason_code: BLOCK_REASON.call_failed, done_part_fragment: FRAG });
  const once = (await getTask(db, RUNNING)).done_part;
  await recordTaskBlock(db, { task_id: RUNNING, block_reason_code: BLOCK_REASON.call_failed, done_part_fragment: FRAG });
  assert((await getTask(db, RUNNING)).done_part === once, "同一片段二次写入 → done_part 不重复追加（幂等）");
}

// ==================================================== ⑨ 运行失败不作为否定 HVA 的依据（静态：本文件不写 MD-07/EXT-02）
console.log("\n⑨ TC-I-M1-004 · 失败不否定 HVA：F-06 静态不触碰 MD-07 research / EXT-02 evidence 写面");
{
  const raw = readFileSync(RECOVERY_SRC, "utf8");
  const src = stripComments(raw);
  assert(!/from\s+["']\.\.\/shared-context/.test(src), "recovery.js 不 import shared-context（不写 MD-07 research / EXT-02 evidence）");
  assert(!/createResearch|createEvidence|addExternalValidation/.test(src), "recovery.js 不引用任何研究/证据写函数");
  assert(!/\b(fetch|https?:\/\/)\b/.test(src), "recovery.js 不含任何外部 HTTP 调用");
}

// ==================================================== ⑩ 写入面静态验证（生产零写可被证明）
console.log("\n⑩ 生产零写：F-06 复用 F-26 写入面，本文件零裸 SQL、零消息发送");
{
  const raw = readFileSync(RECOVERY_SRC, "utf8");
  const src = stripComments(raw);
  assert(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(src), "recovery.js 不含任何裸 SQL（全部写委托 task-state.js / step-plan.js）");
  assert(!/\bdelegateToAgent\b|\bcreateLocalEnqueue\b|\benqueue\b/.test(src), "recovery.js 不发 Queue 消息（消息只带 task_id+step_no 的约定不由 F-06 破坏）");
  // 不变量：import 仅来自允许的写入面（task-state.js＝PD-01/PD-03；step-plan.js＝PD-02 advanceStep；research.js＝RESEARCH_TASK_TYPES 真源）
  const ALLOWED_IMPORTS = ["../tool-executor/task-state.js", "./step-plan.js", "./research.js"];
  const imports = [...src.matchAll(/import\s*\{[^}]*\}\s*from\s*["']([^"']+)["']/g)].map((m) => m[1]);
  assert(imports.length >= 1 && imports.every((i) => ALLOWED_IMPORTS.includes(i)),
    `recovery.js 仅 import 允许的写入面（task-state.js / step-plan.js / research.js；实测 ${imports.length} 个：${imports.join(", ")}）`);
  assert(ALLOWED_IMPORTS.every((i) => imports.includes(i)), "recovery.js 复用三个允许的写入面（task-state.js / step-plan.js / research.js 均出现）");
  assert(/clear_ended_at:\s*true/.test(src), "resumeTask 显式声明 clear_ended_at: true（F-37：恢复即清空 ended_at，锁住不回归）");
  assert(/rebuildActiveStepOnResume/.test(src), "resumeTask 调用 rebuildActiveStepOnResume（P1 修复：resume 重建 active 步）");
}

// ==================================================== ⑪ P1 修复 · resume 重建 active 步（不再 running 却无 active → 僵尸）
console.log("\n⑪ P1 修复 · 恢复重建 active 步：resume 后「running + 无 active」不再成立");
{
  const { sqlite, db } = freshDb();
  // 造「blocked 在研究步 2、步 1 done、步 3-5 pending」的同形任务（线上 T-0029 形：有研究壳）
  const tk = await createTask(db, {
    task_type: "hva_research", goal_id: "GOAL-2026Q3-01", goal_version_no: 3,
    trigger_basis: "test-f06 ⑪ 有壳 blocked 研究任务", agent_version_snapshot: "snap",
    task_status: "running", started_at: "2026-09-21 10:00",
  });
  await planTaskSteps(db, tk.task_id, "hva_research");
  await advanceStep(db, { task_id: tk.task_id, step_no: 1, step_state: "done" });
  await advanceStep(db, { task_id: tk.task_id, step_no: 2, step_state: "active" });
  await advanceStep(db, { task_id: tk.task_id, step_no: 2, step_state: "blocked" });
  // 挂研究壳（F-04 落 LNK-04 output；resume 的壳判定只看该锚点，不要求 research 行实际存在）
  await linkTaskObject(db, { task_id: tk.task_id, object_type: "research", object_id: "R-TF06A", link_role: "output", created_at: "2026-09-21 10:00" });
  await setTaskStatus(db, tk.task_id, "blocked", { ended_at: "2026-09-21 16:00" });

  const res = await resumeTask(db, { task_id: tk.task_id });
  assert(res.task.task_status === "running" && res.task.ended_at === null, "resume：blocked → running 且清空 ended_at");
  assert(res.rebuilt === true && res.active_step === 2, `resume 重建 active 步＝曾受阻的步 2（实测 rebuilt=${res.rebuilt} active_step=${res.active_step}）`);
  const s2 = sqlite.prepare("SELECT step_state FROM task_step WHERE task_id=? AND step_no=2").get(tk.task_id);
  assert(s2.step_state === "active", "步 2 由 blocked 回到 active（下一 tick 可被 work 相位消费，不再僵尸）");
  assert(sqlite.prepare("SELECT COUNT(*) c FROM task_step WHERE task_id=? AND step_state='active'").get(tk.task_id).c === 1,
    "恰好一个 active 步（不重复建）");

  // 幂等：对「已 running + 已有 active 步」直接调用重建函数 → 不再重建（already_active）
  const r2 = await rebuildActiveStepOnResume(db, { task_id: tk.task_id, task_type: "hva_research" });
  assert(r2.rebuilt === false && r2.reason === "already_active", "幂等：已有 active 步时不重复重建");

  // 缺研究壳的研究任务（线上 T-0026 形）：resume 不擅自代建、如实回报 missing_research_shell，不留下 active 步
  const { sqlite: sq2, db: db2 } = freshDb();
  const tk2 = await createTask(db2, {
    task_type: "hva_research", goal_id: "GOAL-2026Q3-01", goal_version_no: 3,
    trigger_basis: "test-f06 ⑪ 无壳遗留任务", agent_version_snapshot: "snap",
    task_status: "running", started_at: "2026-09-21 10:05",
  });
  await planTaskSteps(db2, tk2.task_id, "hva_research");
  await advanceStep(db2, { task_id: tk2.task_id, step_no: 1, step_state: "blocked" });
  await setTaskStatus(db2, tk2.task_id, "blocked", { ended_at: "2026-09-21 16:00" });
  const res3 = await resumeTask(db2, { task_id: tk2.task_id });
  assert(res3.task.task_status === "running", "无壳任务 resume 仍翻 running（恢复动作本身执行）");
  assert(res3.rebuilt === false && res3.reason === "missing_research_shell", `无壳研究任务 resume 如实回报 missing_research_shell（实测 ${res3.reason}）`);
  assert(sq2.prepare("SELECT COUNT(*) c FROM task_step WHERE task_id=? AND step_state='active'").get(tk2.task_id).c === 0,
    "无壳任务 resume 不留下 active 步（与 self-heal 同纪律：不擅自代建研究壳）");
}

finish();
