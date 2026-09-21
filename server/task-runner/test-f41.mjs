#!/usr/bin/env node
/**
 * 文档卡（阶段4 接线 · F-41 · `hva_followup` 追问执行体接线 · 2026-09-22）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md`（编号映射表：F-33 起登记；**F-41 由本轮新增**）
 *   ｜ `../../docs/04-plan/dev-plan.md`（阶段 4「接线进展」；阶段 3 · M1 的 F-05 追问与版本管理）
 *   ｜ `../../docs/05-test-cases/test-M1.md`（**TC-I-M1-003** 已有研究上提新问题：关联原研究建新任务；
 *        原研究结果与依据继续保留；新旧版本不混）
 *   ｜ `../../docs/05-test-cases/test-M4.md`（**TC-I-M4-001** 追问承接：既有依据是否仍适用 → 沿用 / 补查；
 *        **TC-I-M4-002** 查询经 M5 只读；**TC-A-M4-004** 七要素齐备并保存；**TC-A-M4-005** 失败不否定）
 *   ｜ `./followup.js`（F-05：建 hva_followup 任务 + 新 MD-07 研究壳 + PD-07 追问消息 + PD-06 上下文）
 *   ｜ `./research.js`（被测：追问与研究**同构**的五步执行体；步 ① 追问多做一次 F-22 承接判定）
 *   ｜ `../agent-orchestrator/followup-intake.js`（**F-22**：`intakeFollowup` 承接判定；类型常量 `FOLLOWUP_TASK_TYPE`
 *        的唯一真源——本执行体**复用**它，不复制第二份）
 * 职责：证明「追问」这条链路**真的能跑完**——此前 `hva_followup` 不在已接线类型内，任务建行后五步恒 `pending`、
 *   永不被 cron 选中（`0 / 5 步`），是全流程最后一个断点；本项把它接上。
 * 硬红线：仅本地内存库，零外部调用、零生产写；数值以契约基准 v1（ADR-004）为准（只断结构、语义、字典值与平台口径）。
 * 边界：本执行器只验 F-41（追问执行体接线）；F-33（M4 研究执行体）/ F-05（追问建任务）/ F-22（承接判定）各自覆盖。
 * 反向清单：登记 `./README.md` 与 `../README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f41.mjs`）。
 *
 * 用法：node server/task-runner/test-f41.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { submitProposal } from "./proposal.js";
import { createHvaResearchTask } from "./hva.js";
import { createFollowupTask } from "./followup.js";
import { runStepMessage } from "./executor.js";
import { WIRED_TASK_TYPES, RESEARCH_TASK_TYPES, RESEARCH_STEP_COUNT_OF, RESEARCH_TASK_TYPE } from "./research.js";
import { FOLLOWUP_TASK_TYPE } from "../agent-orchestrator/followup-intake.js";
import { TYPE_STEPS } from "./step-plan.js";
import { getResearch } from "../shared-context/index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const RESEARCH_SRC = new URL("./research.js", import.meta.url);

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

/** 只启用生产同形的 4 个工具（CDP/HJE/MKT/ACT），PIM 仍 `is_enabled=0`——F-38 应让计划避开它。 */
function enableProductionTools(sqlite) {
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
    assert(ok, `${msg}（实测：${String(e.message).slice(0, 80)}）`);
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

const AT = "2026-09-22 09:00";
const NEW_Q = "把时间窗收窄到 2026-05-01 ~ 2026-06-30 再看一次入口差异，结论是否变化？";

/** 追问夹具：原研究（F-04 建壳）→ F-05 建追问任务 + 新研究壳。 */
async function followupFixture(db) {
  const sub = await submitProposal(db, {
    opportunity_id: "OPP-012",
    research_question: "搜索进入的新客复购更低，是缺少二次找品吗？",
    behavior_hypothesis: "搜索进入的新客缺少二次找品机会",
    population_limit: "搜索进入新客 vs 推荐位进入新客",
    submitted_by: "PM",
    at: AT,
  });
  const tk = await createHvaResearchTask(db, { proposal_id: sub.proposal.proposal_id, at: AT });
  const fu = await createFollowupTask(db, { research_no: tk.research_no, new_question: NEW_Q, at: AT });
  return { original: tk, followup: fu };
}

// ==================================================== ① 静态：类型清单与步数都派生自真源
console.log("① 静态 · 追问已接线；类型清单与步数均为派生（不复制第二份）");
{
  const src = readFileSync(RESEARCH_SRC, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  assert(WIRED_TASK_TYPES.includes(FOLLOWUP_TASK_TYPE),
    `hva_followup 在已接线清单内（实测 ${WIRED_TASK_TYPES.join(" / ")}）`);
  assert(RESEARCH_TASK_TYPES.join(">") === `${RESEARCH_TASK_TYPE}>${FOLLOWUP_TASK_TYPE}`,
    `研究类两种＝hva_research / hva_followup（实测 ${RESEARCH_TASK_TYPES.join(">")}）`);
  for (const t of RESEARCH_TASK_TYPES) {
    assert(RESEARCH_STEP_COUNT_OF[t] === TYPE_STEPS[t].length,
      `${t} 步数派生自 TYPE_STEPS（实测 ${RESEARCH_STEP_COUNT_OF[t]} ＝ ${TYPE_STEPS[t].length}）`);
  }
  assert(!/FOLLOWUP_TASK_TYPE\s*=\s*"/.test(src),
    "research.js 不复制追问类型常量字面（import 自 F-22 `followup-intake.js` 唯一真源）");
  assert(!/\bdb\s*\.\s*prepare\s*\(/.test(src), "research.js 零裸 SQL（连 SELECT 都不写，全经既有读写面）");
}

// ==================================================== ② 步 ①：追问多做一次 F-22 承接判定
console.log("\n② 步 ① 关联原研究与依据 · 走 F-22 承接判定并如实写进「已完成部分」");
{
  const { sqlite, db } = freshDb();
  enableProductionTools(sqlite);
  const fx = await followupFixture(db);
  const fuId = fx.followup.task.task_id;
  const r = await runStepMessage(db, { task_id: fuId, step_no: 1 }, { at: AT });
  assert(r.outcome === "done", `步 ① 执行完成（实测 ${r.outcome}${r.message ? "：" + r.message.slice(0, 60) : ""}）`);
  const dp = taskRow(sqlite, fuId).done_part || "";
  assert(/追问承接/.test(dp), "① 的已完成部分写明「追问承接」（承接结果可回查，不只体现在报告正文）");
  assert(/原样保留/.test(dp), "① 写明原研究的结果与依据**原样保留**（追问不覆盖原研究）");
  assert(/既有依据复用判定＝/.test(dp), "① 写明既有依据的复用判定（沿用 / 补查 / 未决）");
  assert(stepRow(sqlite, fuId, 1).step_state === "done", "步 ① 落 done");
}

// ==================================================== ③ 反例：非追问任务口径逐字不变
console.log("\n③ 反例 · hva_research 步 ① **不走**承接判定（既有口径逐字不变）");
{
  const { sqlite, db } = freshDb();
  enableProductionTools(sqlite);
  const fx = await followupFixture(db);
  const origId = fx.original.task.task_id;
  const r = await runStepMessage(db, { task_id: origId, step_no: 1 }, { at: AT });
  assert(r.outcome === "done", `原研究任务步 ① 仍正常完成（实测 ${r.outcome}）`);
  const dp = taskRow(sqlite, origId).done_part || "";
  assert(!/追问承接/.test(dp), "反例：hva_research 的已完成部分**不含**「追问承接」（不误挂）");
  assert(/载入机会与目标口径/.test(dp), "仍是原口径标题「载入机会与目标口径」");
}

// ==================================================== ④ 生产同形全链路：追问五步跑到报告落库
console.log("\n④ 生产同形全链路 · 只启用 CDP/HJE/MKT/ACT → 追问五步跑到 done，报告落在**新**研究");
{
  const { sqlite, db } = freshDb();
  enableProductionTools(sqlite);
  const fx = await followupFixture(db);
  const fuId = fx.followup.task.task_id;
  const newResearchNo = fx.followup.research.research_no;
  const origResearchNo = fx.original.research_no;
  const origBefore = await getResearch(db, origResearchNo);

  const tr = transportOf((c) => okBody(c));
  const outcomes = [];
  for (let s = 1; s <= 5; s += 1) {
    outcomes.push(await runStepMessage(db, { task_id: fuId, step_no: s }, { at: AT, transport: tr }));
  }
  assert(outcomes.every((o) => o.outcome === "done"),
    `五步全 done（实测 ${outcomes.map((o) => o.outcome).join("/")}）`);
  const t = taskRow(sqlite, fuId);
  assert(t.task_status === "done", `追问任务 done（实测 ${t.task_status}）`);
  assert(t.progress_text === "5 / 5 步", `进度 5 / 5 步（实测 ${t.progress_text}）`);
  const blocks = sqlite.prepare("SELECT COUNT(*) c FROM task_block WHERE task_id = ?").get(fuId).c;
  assert(blocks === 0, `追问任务零 PD-03 受阻（实测 ${blocks}）`);
  assert(!tr.calls.includes("pim.category.query"), `PIM 未被查询（实测调用 ${tr.calls.join(",")}）`);

  const after = await getResearch(db, newResearchNo);
  assert(after.research_status === "done", `新研究报告落库（research_status＝done，实测 ${after.research_status}）`);
  assert(after.research_question === NEW_Q, "新研究的 research_question ＝ 追问新问题（不沿用旧问题）");
  assert(after.parent_research_no === origResearchNo, "新研究 parent_research_no 指向原研究（追问链成立）");
  assert(countRows(sqlite, "research_finding") > 0, `发现落库（实测 ${countRows(sqlite, "research_finding")} 行）`);

  // 原研究**不被覆盖**：逐字段比对（追问 ≠ 否定原结论）
  const origAfter = await getResearch(db, origResearchNo);
  assert(origAfter.research_question === origBefore.research_question, "原研究的研究问题未被改");
  assert(origAfter.e1_goal_statement === origBefore.e1_goal_statement, "原研究的 ① 未被覆盖");
  assert(origAfter.finished_at === origBefore.finished_at, "原研究的 finished_at 未被改（原结论不被推翻）");
  assert(origAfter.parent_research_no === origBefore.parent_research_no, "原研究的追问链上游未被改");
}

// ==================================================== ⑤ 边界：程序性错误不落库
console.log("\n⑤ 边界 · 越界步号＝程序性错误（在 try 之外抛错，不写幽灵步态）");
{
  const { sqlite, db } = freshDb();
  const fx = await followupFixture(db);
  const fuId = fx.followup.task.task_id;
  await assertThrows(() => runStepMessage(db, { task_id: fuId, step_no: 9 }, { at: AT }),
    "追问任务步号越界 → 抛错", "未知步骤号");
  assert(stepRow(sqlite, fuId, 1).step_state === "active", "越界步号不改动任何步态（步 1 仍 active）");
  const blocks = sqlite.prepare("SELECT COUNT(*) c FROM task_block WHERE task_id = ?").get(fuId).c;
  assert(blocks === 0, `越界步号零 PD-03 留痕（实测 ${blocks}；不把调用方写错说成任务受阻）`);
}

finish();
