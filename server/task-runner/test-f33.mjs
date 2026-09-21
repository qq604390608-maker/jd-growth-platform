#!/usr/bin/env node
/**
 * 文档卡（阶段4 接线 · M4 · **F-33 M4 执行体接线用例** · 2026-09-21）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md`（F-33 验收：M4 五步执行体接线 + 按 `task_type` 分派 +
 *        runner `[ai]` + 自愈补扫）
 *   ｜ `../../docs/05-test-cases/test-M4.md`（**TC-A-M4-001** 三分支起点 / **TC-A-M4-003** 五查＋倒挂隔离 /
 *        **TC-A-M4-004** 七要素齐备并保存 / **TC-A-M4-005** 失败不否定 / **TC-I-M4-002** 查询经 M5 只读）
 *   ｜ `./research.js`（被测：`runResearchStep` / `deriveAnalysisFallback` / `resolveAnalysisInput` /
 *        `assembleSevenElements` / `WIRED_TASK_TYPES`）
 *   ｜ `./self-heal.js`（被测：`runSelfHealScan`）｜`./executor.js`（分派 `runStepMessage` / 选取 `runPendingWork`）
 *   ｜ `./index.js`（queue 路由）｜`./hva.js`（F-04 真实任务链夹具）｜`./proposal.js`（F-03 建议）｜`./step-plan.js`
 *   ｜ `../../db/migrations/0001_init.sql` + `../../db/seed/0001_mock.sql`（真实 DDL + 种子，载入内存库）
 *   ｜ `../agent-orchestrator/verification.js`（F-15 真实查询经**注入 transport**——不 mock 业务语义，只替网络层）
 * 职责：验证 ① 静态：`research.js` 零裸 SQL / 零删行改表，`self-heal.js` 改行只经 `advanceStep`；② 步 ① 单跑
 *   （F-19 三分支 + 停止条件）；③ **全链路五步**（5 源真实查询 → EXT-01/EXT-02 → MD-09/MD-10 → MD-07 七要素 + MD-08/
 *   LNK-02 落库）；④ 按 `task_type` 分派（hva_research 走 M4 体；hva_followup 拒入；discovery 拒入 M4 体）；
 *   ⑤ 幂等（重复驱动 no-op、不重复落发现）；⑥ 结构受阻（快照版本缺失 → PD-03 + blocked）；⑦ 注入判据档
 *   （`analysis_input` 采纳并标 `provided`；形态非法即报错）；⑧ 门禁档（无 `readAnalysisFromAI` → 确定性 fallback +
 *   `llm_gated`）；⑨ 自愈补扫（缺 active 步补回；**缺研究壳者不擅自代建**、如实登记 skipped）；⑩ 未接线类型不被选取。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义与跃迁）。
 * 边界：F-19/F-20/F-21 各自的 oracle 归其执行器（`test-f19/f20/f21`）；本用例只验**接线与分派**，不重写它们的语义。
 * 反向清单：登记 `./README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f33.mjs`）。
 * 用法：node server/task-runner/test-f33.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

import runner from "./index.js";
import { submitProposal } from "./proposal.js";
import { createHvaResearchTask } from "./hva.js";
import { createTask, planTaskSteps, listTaskSteps, advanceStep, linkTaskObject } from "./step-plan.js";
import { runResearchStep, WIRED_TASK_TYPES, RESEARCH_TASK_TYPE, RESEARCH_STEP_COUNT, deriveAnalysisFallback, resolveAnalysisInput } from "./research.js";
import { runSelfHealScan } from "./self-heal.js";
import { runStepMessage, runPendingWork } from "./executor.js";
import { ALTERNATIVE_DIMENSIONS } from "../agent-orchestrator/behavior.js";

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
const stepRow = (sqlite, task_id, step_no) =>
  sqlite.prepare("SELECT * FROM task_step WHERE task_id = ? AND step_no = ?").get(task_id, step_no);

/** M4 计划要用的 5 个工具（CDP/HJE/PIM/MKT/ACT）＋ ACT 的临时降级态恢复（与 test-stage4 同款前置）。 */
function enableResearchTools(sqlite) {
  sqlite.exec("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id IN ('TOL-01','TOL-04','TOL-07','TOL-09','TOL-11')");
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
const emptyBody = (toolCode) => ({ ...okBody(toolCode), returned_rows: 0, data: { rows: [] } });
const throwingTransport = () => {
  const t = async function () {
    t.calls.push(1);
    throw new Error("ECONNREFUSED 127.0.0.1:8788（注入 transport 模拟端点不可达）");
  };
  t.calls = [];
  return t;
};

/** F-03 → F-04 真实任务链（含 MD-07 研究壳，F-04 2026-09-21 补齐）；返回任务号。 */
async function researchTaskOf(db, { at = "2026-09-21 09:00", behavior_hypothesis = "搜索进入的新客缺少二次找品机会" } = {}) {
  const sub = await submitProposal(db, {
    opportunity_id: "OPP-012",
    research_question: "搜索进入的新客复购更低，是缺少二次找品吗？",
    behavior_hypothesis,
    population_limit: "搜索进入新客 vs 推荐位进入新客",
    submitted_by: "PM",
    at,
  });
  const tk = await createHvaResearchTask(db, { proposal_id: sub.proposal.proposal_id, at });
  return tk;
}

// ==================================================== ① 静态：零裸 SQL / 零删行改表 / 写面收敛
console.log("① 静态扫描 · research.js 零裸 SQL、self-heal.js 改行只经 advanceStep");
{
  const strip = (p) =>
    readFileSync(new URL(p, import.meta.url), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/[^\n]*$/gm, "");
  const res = strip("./research.js");
  const heal = strip("./self-heal.js");
  for (const [name, src] of [["research.js", res], ["self-heal.js", heal]]) {
    const banned = ["DELETE", "DROP", "ALTER", "TRUNCATE", "INSERT"].filter((w) => new RegExp(`\\b${w}\\b`).test(src));
    assert(banned.length === 0, `${name} 零删行/改表/建行类语句（实测命中 ${banned.length ? banned.join(",") : "0"}）`);
    assert(!/\bUPDATE\b/.test(src), `${name} 本体零 UPDATE（改行只落在 step-plan/task-state 单一写入面）`);
  }
  assert(!/\bdb\s*\.\s*prepare\s*\(/.test(res), "research.js 零裸 SQL（连 SELECT 都不写，全经既有读写面）");
  assert(/advanceStep/.test(heal), "self-heal.js 的步骤跃迁确实委托给 step-plan.js `advanceStep`（非自写 SQL）");
  assert(WIRED_TASK_TYPES.join(">") === `discovery>${RESEARCH_TASK_TYPE}`,
    `已接线类型清单＝discovery/hva_research（实测 ${WIRED_TASK_TYPES.join(">")}）`);
}

// ==================================================== ② 步 ① 单跑：F-19 三分支 + 停止条件
console.log("\n② 步 ① 载入机会与目标口径 · 有假设 → verify_hypothesis、路径确定即停止");
{
  const { sqlite, db } = freshDb();
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  assert(tk.research_created === true && typeof tk.research_no === "string", `F-04 已建 MD-07 研究壳（实测 ${tk.research_no}）`);
  const qrBefore = countRows(sqlite, "query_record");
  const r = await runResearchStep(db, tid, 1, { at: "2026-09-21 10:01" });
  assert(r.outcome === "done" && r.path === "verify_hypothesis", `步 1 done、路径＝verify_hypothesis（实测 ${r.outcome}/${r.path}）`);
  assert(r.plan_step_count === 6, `计划＝路径首步 + 五查＝6（实测 ${r.plan_step_count}）`);
  const t = getTaskPending(sqlite, tid);
  assert(/① 载入机会与目标口径/.test(t.done_part), "done_part 含「① 载入机会与目标口径」");
  assert(/比较条件 三项已定/.test(t.done_part), "比较条件三项已定（population_limit + focus_period + metric_definition）");
  assert(/路径确定即停止/.test(t.done_part), "停止条件写明（S-B1 路径确定即停止）");
  assert(countRows(sqlite, "query_record") === qrBefore, `步 ① 只读装载、零新查询（前后 ${qrBefore}/${countRows(sqlite, "query_record")}）`);

  // 无假设 → find_candidate（起点②）
  const { db: db2 } = freshDb();
  const tk2 = await researchTaskOf(db2, { at: "2026-09-21 09:10", behavior_hypothesis: null });
  const r2 = await runResearchStep(db2, tk2.task.task_id, 1, { at: "2026-09-21 10:01" });
  assert(r2.path === "find_candidate", `无候选行为假设 → 起点② find_candidate（实测 ${r2.path}）`);
}
function getTaskPending(sqlite, task_id) {
  return sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(task_id);
}

// ==================================================== ③ 全链路五步
console.log("\n③ 全链路 · 五步全 done → 任务 done → EXT-01/EXT-02/MD-09/MD-10/MD-07+MD-08+LNK-02 逐层落库");
const GOAL = "GOAL-2026Q3-01";
let CHAIN_TASK;
{
  const { sqlite, db } = freshDb();
  enableResearchTools(sqlite);
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  CHAIN_TASK = tid;
  assert(stepRow(sqlite, tid, 1).step_state === "active", "建任务即投递：步 1 = active（createLocalEnqueue）");

  const before = {
    qr: countRows(sqlite, "query_record"), ev: countRows(sqlite, "evidence"),
    cand: countRows(sqlite, "candidate_behavior"), pt: countRows(sqlite, "behavior_point"),
    f: countRows(sqlite, "research_finding"), lk: countRows(sqlite, "finding_evidence"),
    ac: countRows(sqlite, "improvement_action"), research: countRows(sqlite, "research"),
  };
  const tr = transportOf((c) => okBody(c));
  const r = await runPendingWork(db, { transport: tr, at: "2026-09-21 10:01" });
  assert(r.executed.length === 5, `驱动执行 5 步（实测 ${r.executed.length}）`);
  assert(r.executed.every((e) => e.outcome === "done"), "五步全部 outcome=done");
  assert(r.finished.includes(tid), "任务进入 finished");

  const t = getTaskPending(sqlite, tid);
  assert(t.task_status === "done", `任务落 done（实测 ${t.task_status}）`);
  assert(t.progress_text === "5 / 5 步", `进度串 5 / 5 步（实测「${t.progress_text}」）`);
  for (const no of [1, 2, 3, 4, 5]) assert(stepRow(sqlite, tid, no).step_state === "done", `步 ${no} = done`);

  assert(countRows(sqlite, "query_record") - before.qr === 5,
    `EXT-01 落痕 5 行（CDP/HJE/PIM/MKT/ACT 各一，实测 ${countRows(sqlite, "query_record") - before.qr}）`);
  assert(tr.calls.length === 5, `transport 恰被调 5 次（实测 ${tr.calls.length}）`);
  assert(countRows(sqlite, "evidence") - before.ev === 5,
    `EXT-02 证据落库 5 行（四要素齐，实测 ${countRows(sqlite, "evidence") - before.ev}）`);
  assert(countRows(sqlite, "candidate_behavior") - before.cand === 1,
    `MD-09 候选行为 1 行（实测 ${countRows(sqlite, "candidate_behavior") - before.cand}）`);
  assert(countRows(sqlite, "behavior_point") - before.pt === 5,
    `MD-10 条目 5 条（实测 ${countRows(sqlite, "behavior_point") - before.pt}）`);
  assert(countRows(sqlite, "research_finding") - before.f === 5,
    `MD-08 关键发现 5 条（实测 ${countRows(sqlite, "research_finding") - before.f}）`);
  assert(countRows(sqlite, "finding_evidence") - before.lk === 5,
    `LNK-02 发现↔证据关联 5 条（实测 ${countRows(sqlite, "finding_evidence") - before.lk}）`);
  assert(countRows(sqlite, "research") === before.research, "MD-07 只改行、不新建研究行");
  assert(countRows(sqlite, "improvement_action") - before.ac === 0,
    "全部发现均获支持 → 改善方向 0 条（合法产出，不硬凑）");

  const research = sqlite.prepare("SELECT * FROM research WHERE start_task_id = ?").get(tid);
  assert(research.research_status === "done", `MD-07 research_status=done（实测 ${research.research_status}）`);
  assert(!!research.finished_at, "MD-07 finished_at 已写");
  assert(research.e2_scope_method.includes("研究范围与方法"), "七要素② 已由报告整体覆盖（不再是最初「尚未开展」）");
  assert(research.e4_population_diff.startsWith("人群差异："), "七要素④ 人群差异已填");
  assert(research.e6_limits.includes("其他解释"), "七要素⑥ 其他解释与限制已填");
  assert(research.out_of_scope_note.includes("不在本研究结论范围内"), "不覆盖范围声明已落（终版，非初值）");

  const cand = sqlite.prepare("SELECT * FROM candidate_behavior WHERE research_no = ?").get(research.research_no);
  assert(cand.behavior_status === "not_supported",
    `确定性 fallback 下五查未全通过 → 候选未获支持（实测 ${cand.behavior_status}）——**未获支持亦是完整结果**`);
  const dp = t.done_part || "";
  for (const mark of ["① 载入机会与目标口径", "② 调度工具采集证据", "③ 交叉验证候选行为", "④ 形成结论与适用范围", "⑤ 产出研究结果与依据", "任务完成"]) {
    assert(dp.includes(mark), `done_part 含「${mark}」`);
  }
  assert(/分析输入来源＝deterministic_fallback/.test(dp), "分析输入来源如实标注＝deterministic_fallback（A-1 门禁）");
}

// ==================================================== ④ 按 task_type 分派
console.log("\n④ 分派 · hva_research 走 M4 体；hva_followup 拒入执行体；discovery 任务不入 M4 体");
{
  const { sqlite, db } = freshDb();
  enableResearchTools(sqlite);
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  const r = await runStepMessage(db, { task_id: tid, step_no: 1 }, { at: "2026-09-21 10:01" });
  assert(r.outcome === "done" && r.path === "verify_hypothesis", "runStepMessage 对 hva_research 分派到 M4 体（回带 path）");

  await assertThrows(() => runResearchStep(db, tid, 0, {}), "M4 体收到未知步号 0 即报错", "未知步骤号");
  const disc = sqlite.prepare("SELECT task_id FROM task WHERE task_type='discovery' LIMIT 1").get();
  await assertThrows(() => runResearchStep(db, disc.task_id, 1, {}), "M4 体拒入 discovery 任务（不误用）", `${RESEARCH_TASK_TYPE} 任务`);

  // 未接线类型：hva_followup 的步骤消息仍走占位（不误入执行体）
  const fu = await createTask(db, {
    task_type: "hva_followup", goal_id: GOAL, goal_version_no: 3,
    trigger_basis: "test-f33 ④ 未接线类型", agent_version_snapshot: "snap", task_status: "running", started_at: "2026-09-21 10:02",
  });
  await planTaskSteps(db, fu.task_id, "hva_followup");
  const q = await runner.queue({ messages: [{ body: { task_id: fu.task_id, step_no: 1 }, ack() {} }] }, { DB: db });
  assert(q[0].delegated === true && !q[0].outcome, "queue：hva_followup 仍走 delegateToAgent 占位（未接线类型不受影响）");
}

// ==================================================== ⑤ 幂等：重复驱动 no-op
console.log("\n⑤ 幂等 · 无 active 步骤时重复驱动是 no-op（不重复落发现/证据）");
{
  const { sqlite, db } = freshDb();
  enableResearchTools(sqlite);
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  await runPendingWork(db, { transport: transportOf((c) => okBody(c)), at: "2026-09-21 10:01" });
  const f1 = countRows(sqlite, "research_finding");
  const lk1 = countRows(sqlite, "finding_evidence");
  const r2 = await runPendingWork(db, { transport: transportOf((c) => okBody(c)), at: "2026-09-21 10:02" });
  assert(r2.executed.length === 0, `第二次驱动 executed 0（实测 ${r2.executed.length}）`);
  assert(countRows(sqlite, "research_finding") === f1 && countRows(sqlite, "finding_evidence") === lk1,
    `发现/证据关联零新增（实测 ${countRows(sqlite, "research_finding")}/${countRows(sqlite, "finding_evidence")}）`);
  assert(getTaskPending(sqlite, tid).task_status === "done", "任务仍为 done（未被重跑改动）");
}

// ==================================================== ⑥ 结构受阻
console.log("\n⑥ 结构受阻 · 目标快照版本缺失 → 步 blocked + PD-03 留痕 + 任务 blocked");
{
  const { sqlite, db } = freshDb();
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  sqlite.prepare("UPDATE task SET goal_version_no = 99 WHERE task_id = ?").run(tid);
  const r = await runResearchStep(db, tid, 1, { at: "2026-09-21 10:01" });
  assert(r.outcome === "blocked" && r.reason === "target_unclear", `outcome=blocked、reason=target_unclear（实测 ${r.outcome}/${r.reason}）`);
  assert(stepRow(sqlite, tid, 1).step_state === "blocked", "步 1 = blocked");
  const blocks = sqlite.prepare("SELECT * FROM task_block WHERE task_id = ?").all(tid);
  assert(blocks.length === 1 && blocks[0].block_reason_code === "target_unclear", `PD-03 留痕 1 行（实测 ${blocks.length}）`);
  assert(getTaskPending(sqlite, tid).task_status === "blocked", "任务 blocked（保留已完成部分）");
}

// ==================================================== ⑦ 注入判据档（provided）
console.log("\n⑦ 注入判据 · analysis_input 被采纳并标 provided；形态非法即报错");
{
  const { sqlite, db } = freshDb();
  enableResearchTools(sqlite);
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  await runResearchStep(db, tid, 1, {});
  await runResearchStep(db, tid, 2, { at: "2026-09-21 10:01", transport: transportOf((c) => okBody(c)) });
  const injected = {
    population: {
      candidate_group: "搜索进入新客", comparison_group: "推荐位进入新客",
      features: ["消费力", "品类偏好"], prior_performance: "推荐位更高",
      differences: [
        { feature: "消费力", explained: true },
        { feature: "品类偏好", explained: true },
      ],
    },
    points: [{ point_id: "P1", point_type: "support", point_text: "搜索结果页新客复购更低", info_time_point: "2026-09-21 10:01" }],
    behavior_at: "2026-09-01", result_at: "2026-09-20",
    metric: { expected: "复购率", observed: "复购率" },
    alternatives: [
      { dimension: "product", evidence_kind: "existence_only", summary: "商品结构存在", concluded_excluded: false },
      { dimension: "activity", evidence_kind: "existence_only", summary: "活动存在", concluded_excluded: false },
      { dimension: "benefit", evidence_kind: "existence_only", summary: "权益发放存在", concluded_excluded: false },
    ],
    gaps: ["替代解释未排除"],
  };
  const r = await runResearchStep(db, tid, 3, { at: "2026-09-21 10:01", analysis_input: injected });
  assert(r.outcome === "done" && r.analysis_source === "provided" && r.llm_gated === false,
    `注入判据被采纳（source=provided、llm_gated=false，实测 ${r.analysis_source}/${r.llm_gated}）`);
  assert(r.candidate_id && r.behavior_status === "not_supported",
    `候选行为落库且按注入判据定支持情况（实测 ${r.candidate_id}/${r.behavior_status}）`);
  const st3Before = stepRow(sqlite, tid, 3).step_state;
  await assertThrows(() => runResearchStep(db, tid, 3, { analysis_input: "不许是字符串" }), "analysis_input 形态非法即报错（不静默忽略）", "不合法");
  await assertThrows(() => runResearchStep(db, tid, 3, { readAnalysisFromAI: "不是函数" }), "readAnalysisFromAI 形态非法即报错（不静默退回 fallback）", "不合法");
  assert(stepRow(sqlite, tid, 3).step_state === st3Before, `程序性错误不落步态（步 3 仍为 ${st3Before}，未制造幽灵受阻）`);
  assert(sqlite.prepare("SELECT COUNT(*) c FROM task_block WHERE task_id = ?").get(tid).c === 0, "程序性错误不留 PD-03（受阻≠调用方写错）");
  await assertThrows(() => resolveAnalysisInput({ start: { comparison_conditions: {} }, records: [], version: {}, opportunity: {}, stamp: "x", opts: { analysis_input: [] } }),
    "resolveAnalysisInput 自身亦拒非法形态（数组）——双层防线", "不合法");
  assert(RESEARCH_STEP_COUNT === 5, `步数派生自 F-02 TYPE_STEPS.hva_research（实测 ${RESEARCH_STEP_COUNT}，不复制第二份）`);
}

// ==================================================== ⑧ 门禁档（无 AI → 确定性 fallback）
console.log("\n⑧ 门禁档 · 未接 AI → 确定性 fallback 且标 llm_gated（不硬造结论）");
{
  const { db } = freshDb();
  const fb = deriveAnalysisFallback({
    records: [
      { query_id: "Q-1", source_id: "CDP", result_status: "ok", result_summary: "x", returned_rows: 3, queried_at: "2026-09-21 10:01" },
      { query_id: "Q-2", source_id: "HJE", result_status: "failed", result_summary: "超时", returned_rows: 0, queried_at: "2026-09-21 10:01" },
    ],
    version: { metric_definition: "复购率" },
    opportunity: { target_object: "搜索进入新客" },
  });
  assert(fb.llm_gated === true, "fallback 自述 llm_gated=true");
  assert(Array.isArray(fb.population.differences) && fb.population.differences.length === 0,
    "未取得差异清单 → 如实留空（不硬下「可比」）");
  assert(fb.points.length === 1 && fb.points[0].point_id === "Q-1",
    `候选项点由真实查询记录派生（point_id＝query_id）、非 ok 的查询不入条目（实测 ${fb.points.length} 条：${fb.points.map((p) => p.point_id).join(",") || "无"}）`);
  assert(fb.alternatives.every((a) => a.evidence_kind === "existence_only"),
    "三类来源只提供存在性 → evidence_kind=existence_only（不得据此排除）");
  assert(ALTERNATIVE_DIMENSIONS.join(">") === "product>activity>benefit",
    `替代解释维度取自 F-20 单一真源（实测 ${ALTERNATIVE_DIMENSIONS.join(">")}）`);
}

// ==================================================== ⑨ 自愈补扫
console.log("\n⑨ 自愈补扫 · 补回丢失的 active 步；缺研究壳者**不擅自代建**、如实登记 skipped");
{
  const { sqlite, db } = freshDb();
  // 造「running + 五步全 pending + 无 active」的卡死任务（P1-2 同形），并挂上研究壳锚点
  const stuck = await createTask(db, {
    task_type: "hva_research", goal_id: GOAL, goal_version_no: 3,
    trigger_basis: "test-f33 ⑨ 卡死任务", agent_version_snapshot: "snap", task_status: "running", started_at: "2026-09-21 11:00",
  });
  await planTaskSteps(db, stuck.task_id, "hva_research");
  await linkTaskObject(db, { task_id: stuck.task_id, object_type: "research", object_id: "R-007", link_role: "output", created_at: "2026-09-21 11:00" });
  assert((await listTaskSteps(db, stuck.task_id)).every((s) => s.step_state === "pending"), "卡死任务五步全 pending（无 active，P1-2 同形）");

  // 再造一个「连研究壳都没有」的遗留任务（F-04 建壳前的线上 T-0026/T-0029 同形）
  const orphan = await createTask(db, {
    task_type: "hva_research", goal_id: GOAL, goal_version_no: 3,
    trigger_basis: "test-f33 ⑨ 无研究壳遗留任务", agent_version_snapshot: "snap", task_status: "running", started_at: "2026-09-21 11:05",
  });
  await planTaskSteps(db, orphan.task_id, "hva_research");

  const heal = await runSelfHealScan(db);
  assert(heal.healed.some((h) => h.task_id === stuck.task_id && h.step_no === 1),
    `卡死任务被补回步 1 active（实测 healed=${JSON.stringify(heal.healed)}）`);
  assert(stepRow(sqlite, stuck.task_id, 1).step_state === "active", "步 1 确实落 active（跃迁落在 PD-02，可查）");
  assert(!heal.healed.some((h) => h.task_id === orphan.task_id), "缺研究壳的遗留任务**不被擅自救活**");
  assert(heal.skipped.some((s) => s.task_id === orphan.task_id && /研究壳/.test(s.why)),
    `skipped 如实说明原因（实测：${(heal.skipped.find((s) => s.task_id === orphan.task_id) || {}).why || "无"}）`);

  const again = await runSelfHealScan(db);
  assert(!again.healed.some((h) => h.task_id === stuck.task_id), "补扫幂等：已有 active 步的任务不再被重复补");
}

// ==================================================== ⑩ 未接线类型不被选取
console.log("\n⑩ 选取范围 · hva_followup 不在已接线类型内，不被 cron 驱动");
{
  const { sqlite, db } = freshDb();
  const fu = await createTask(db, {
    task_type: "hva_followup", goal_id: GOAL, goal_version_no: 3,
    trigger_basis: "test-f33 ⑩ 未接线类型", agent_version_snapshot: "snap", task_status: "running", started_at: "2026-09-21 12:00",
  });
  await planTaskSteps(db, fu.task_id, "hva_followup");
  await advanceStep(db, { task_id: fu.task_id, step_no: 1, step_state: "active" });
  const r = await runPendingWork(db, {});
  assert(!r.executed.some((e) => e.task_id === fu.task_id),
    `hva_followup 未被选取（实测 executed=${JSON.stringify(r.executed)}）`);
  assert(stepRow(sqlite, fu.task_id, 1).step_state === "active", "其 active 步原样保留（等接线后再消费）");
}

// ==================================================== ⑪ 失败路径（不否定结论）
console.log("\n⑪ 查询全失败 · 失败留痕 EXT-01、不当证据、任务被 F-26 处置");
{
  const { sqlite, db } = freshDb();
  enableResearchTools(sqlite);
  const tk = await researchTaskOf(db);
  const tid = tk.task.task_id;
  const beforeEv = countRows(sqlite, "evidence");
  const r = await runPendingWork(db, { transport: throwingTransport(), at: "2026-09-21 10:01" });
  assert(r.executed.length >= 1 && r.executed.every((e) => e.outcome === "done"),
    `步 1/2 执行（步 2 内查询失败触发 F-26 处置即停手，实测 ${r.executed.length} 步）`);
  assert(r.finished.length === 0, "任务未完成（受阻不是完成）");
  assert(countRows(sqlite, "evidence") === beforeEv, `零证据落库（失败不当证据，实测 ${countRows(sqlite, "evidence")}）`);
  const t = getTaskPending(sqlite, tid);
  assert(t.task_status === "blocked", `任务 blocked（F-26 持续失败处置，实测 ${t.task_status}）`);
  const failQr = sqlite.prepare("SELECT COUNT(*) c FROM query_record WHERE result_status != 'ok'").get().c;
  assert(failQr >= 1, `失败查询也留痕 EXT-01（实测 ${failQr} 行非 ok）`);
  const blocks = sqlite.prepare("SELECT * FROM task_block WHERE task_id = ?").all(tid);
  assert(blocks.length >= 1, `PD-03 留痕（实测 ${blocks.length} 行）`);
  assert(!/已确认|已证实|必然/.test(t.done_part || ""), "done_part 不含结论性措辞（失败不下 HVA 判断）");
}

finish();
