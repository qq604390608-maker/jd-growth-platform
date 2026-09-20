#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M4 · F-22 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M4.md **TC-I-M4-001**（L5 · F-22：继续追问承接——已有研究上提新问题 →
 *          **形成新任务但保留原结果与依据**（关联 `parent_research_no`）；问题/范围修改后形成新版本，
 *          **已启动任务继续用启动时版本**；引用 `PRD-M4` F-22 验收要点｜`schema.md` MD-07（parent_research_no）｜`M1` TC-I-M1-003）｜
 *        并回指 `TC-I-M2-004`（后续研究引用历史、避免重复研究——追问链读面 `getResearchLineage`）
 *   ｜ ../../docs/02-prd/PRD-M4-HVA分析Agent.md F-22（**检查已有依据是否仍适用**（时间范围、查询条件变化时补查），
 *        再决定**沿用或补查**；上游＝M1 F-05；**再触发本模块 F-19/F-20/F-21**）｜ ../../docs/01-brd/BRD.md §4 F-22｜§5.2 out of scope｜§7 第 4 条
 *   ｜ ../../docs/03-locks/schema.md（MD-07 L230 / MD-08 L251 / MD-09 L262 / MD-10 L270 / MD-11 L280 /
 *        PD-01 L186 / PD-07 L376 / EXT-02 L447 / LNK-02 L398）
 *   ｜ ./followup-intake.js（F-22 本体）｜ ./result.js（F-21 读面）｜ ./role.js（F-18 禁词表与扫描口径）
 *   ｜ ./research-start.js（F-19 五查顺序与比较条件口径）｜ ./verification.js（F-15 抽时点）｜
 *      ../shared-context/index.js（M2 读面）｜ ../task-runner/followup.js（M1 F-05 建行面——夹具用，不在本模块内实现）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-22 用例并断言。
 * 夹具：① **原型真实剧本**——种子里的追问任务 `T-1023`（`hva_followup`）＋显式原研究 `R-007`（done；4 条发现 /
 *          4 条证据 / 1 个候选行为 / 3 条改善方向 / `PD-07` 3 条追问消息）——**不手工拼行**；
 *       ② **M1 F-05 真实调用链**——F-03 `submitProposal` → F-04 `createHvaResearchTask` → F-11 `createResearch`
 *          → F-21 `saveResearchReport`（造出带发现与证据关联的 done 研究）→ F-05 `createFollowupTask`
 *          （产 `hva_followup` 任务 + 带 `parent_research_no` 的新研究壳）——**建行全归上游功能点，F-22 不复制**。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡语义判断）；**demo 数值不进断言**，只断结构与语义。
 * 边界：只验 F-22（承接 + 依据复用判定 + 版本口径 + 新一轮入口）；不验 S-B1~S-B4 的执行（F-19/F-20/F-21 各自用例负责）。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f22.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f22.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  intakeFollowup,
  loadFollowupIntakeContext,
  assessEvidenceReuse,
  parseCoverage,
  REUSE_DECISIONS,
  REUSE_SEVERITIES,
  CHANGE_DIMENSIONS,
  SCOPE_RELATIONS,
  NEXT_ROUND_CHAIN,
  NEXT_ROUND_ENTRY,
  FOLLOWUP_TASK_TYPE,
  STOP_CONDITION,
} from "./followup-intake.js";
import { RESEARCH_CHECK_SEQUENCE, COMPARISON_CONDITION_KEYS } from "./research-start.js";
import { FORBIDDEN_PRODUCTION_PATTERNS } from "./role.js";
import { submitProposal } from "../task-runner/proposal.js";
import { createHvaResearchTask } from "../task-runner/hva.js";
import { createFollowupTask } from "../task-runner/followup.js";
import { createResearch, getResearch } from "../shared-context/index.js";
import { saveResearchReport } from "./result.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./followup-intake.js", import.meta.url);
const TC_M4_PATH = new URL("../../docs/05-test-cases/test-M4.md", import.meta.url);
const PRD_M4_PATH = new URL("../../docs/02-prd/PRD-M4-HVA分析Agent.md", import.meta.url);

/** 把 node:sqlite 包成 D1 形态：`first()` 返回行或 null、`all()` 返回 {results}、`run()` 返回 {success,meta}。 */
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
/** 取整行做逐字段比对（本步零写的运行期判据）。 */
const rawRows = (sqlite, table, orderBy) =>
  JSON.stringify(sqlite.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all());

function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

/** 假证据行（纯函数用例用；字段形态对齐 EXT-02）。 */
const ev = (id, { qc = "标签 = 新客", itp = "2026-09-15 21:40 取数", scope = "仅 APP 端" } = {}) => ({
  evidence_id: id, source_id: "CDP", evidence_title: `${id} 标题`,
  query_condition: qc, info_time_point: itp, applicability_scope: scope,
});

// ==================================================== ① 契约与常量（对齐 TC-I-M4-001）
console.log("① 契约与常量 · 与 TC-I-M4-001 / PRD-M4 F-22 逐条对齐");
{
  const tc = readFileSync(TC_M4_PATH, "utf8");
  const line = tc.split("\n").find((l) => l.includes("TC-I-M4-001")) || "";
  assert(line.includes("F-22"), "TC-I-M4-001 归属 F-22（oracle 回指正确）");
  assert(line.includes("parent_research_no"), "TC-I-M4-001 明示「保留原结果与依据」靠 parent_research_no 关联");
  assert(line.includes("启动时版本"), "TC-I-M4-001 明示「已启动任务继续用启动时版本」");
  assert(line.includes("保留原结果与依据") || line.includes("原结果与依据"), "TC-I-M4-001 明示保留原结果与依据");

  const prd = readFileSync(PRD_M4_PATH, "utf8");
  const f22 = prd.split("\n").find((l) => l.includes("### F-22")) || "";
  assert(f22.includes("继续追问承接"), `PRD-M4 有 F-22 章节（实测「${f22.trim()}」）`);
  const f22Body = prd.slice(prd.indexOf("### F-22"), prd.indexOf("## 4. 关键约束"));
  assert(f22Body.includes("检查已有依据是否仍适用"), "PRD-M4 F-22 要求「检查已有依据是否仍适用」");
  assert(f22Body.includes("时间范围") && f22Body.includes("查询条件"), "PRD-M4 F-22 点明「时间范围、查询条件变化时补查」");
  assert(f22Body.includes("沿用或补查"), "PRD-M4 F-22 的判定输出为「沿用或补查」");
  assert(f22Body.includes("再触发本模块 F-19/F-20/F-21"), "PRD-M4 F-22 明示「再触发本模块 F-19/F-20/F-21」");

  assert(REUSE_DECISIONS.REUSE === "reuse" && REUSE_DECISIONS.SUPPLEMENT === "supplement" && REUSE_DECISIONS.UNDETERMINED === "undetermined",
    "依据复用判定为三态：沿用 / 补查 / 未决（未决≠沿用）");
  assert(CHANGE_DIMENSIONS.length === 3, `变更维度恰 3 项（实测 ${CHANGE_DIMENSIONS.length}）`);
  assert(CHANGE_DIMENSIONS.map((d) => d.key).join(">") === "time_range>query_condition>applicability_scope",
    "三项维度＝时间范围 / 查询条件 / 适用范围（有序、与 PRD 措辞对应）");
  assert(Object.values(SCOPE_RELATIONS).join(">") === "same>narrower>wider>disjoint",
    "适用范围关系四态齐备（能定则定）");
  assert(NEXT_ROUND_CHAIN.join(">") === "F-19>F-20>F-21", "再做一轮的下游链＝F-19>F-20>F-21");
  assert(NEXT_ROUND_ENTRY === "S-B1", "新一轮起点＝S-B1");
  assert(FOLLOWUP_TASK_TYPE === "hva_followup", "承接入口守卫的任务类型＝hva_followup（与 M1 F-05 同款）");
  assert(typeof STOP_CONDITION === "string" && STOP_CONDITION.includes("承接完成即停止"), "停止条件＝承接完成即停止（本步不越界执行）");
  assert(Object.values(REUSE_SEVERITIES).join(">") === "ok>required>undetermined", "严重度三档：沿用 / 必补查 / 无法判定");
}

// ==================================================== ② 纯函数：时点/区间抽取 + 依据复用判定
console.log("\n② 纯函数 · parseCoverage 与 assessEvidenceReuse（无需建库）");
{
  const cov = parseCoverage("2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15");
  assert(cov.coverage && cov.coverage.from === "2026-07-01 00:00" && cov.coverage.to === "2026-09-15 00:00",
    `抽到覆盖区间（实测 ${JSON.stringify(cov.coverage)}）`);
  assert(cov.fetch_time === "2026-09-16 03:00", `抽到取数时点（复用 F-15 parseStamp，实测 ${cov.fetch_time}）`);
  const cov2 = parseCoverage("2026-09-13 15:20 取数");
  assert(cov2.coverage === null && cov2.fetch_time === "2026-09-13 15:20", "无「覆盖 A ~ B」时不猜区间（coverage=null，时点仍可抽）");
  const cov3 = parseCoverage("");
  assert(cov3.fetch_time === null && cov3.coverage === null, "空文本既不猜时点也不猜区间");

  const rows = [ev("EV-A"), ev("EV-B", { qc: "标签 = 新客；窗口 = 0~7 日" })];

  // 未声明 → 未决（受 A-1 门禁，不臆断沿用也不臆断补查）
  const und = assessEvidenceReuse(rows, undefined);
  assert(und.declared === false && und.decision === REUSE_DECISIONS.UNDETERMINED, `未声明 → undetermined（实测 ${und.decision}）`);
  assert(und.llm_gated === true && und.reusable.length === 0 && und.refresh_list.length === 0,
    "未声明时不产出「沿用」也不产出「补查」（避免把过时依据当仍适用）");

  // 声明但空对象 → 明确「无变更」→ 全部沿用
  const none = assessEvidenceReuse(rows, {});
  assert(none.declared === true && none.decision === REUSE_DECISIONS.REUSE, `声明无变更 → reuse（实测 ${none.decision}）`);
  assert(none.reusable.length === 2 && none.refresh_list.length === 0, `两条依据全部沿用（实测 ${none.reusable.length}）`);

  // 查询条件变化 / 未变化
  const qcChanged = assessEvidenceReuse(rows, { query_condition: "标签 = 新客；窗口 = 0~14 日" });
  assert(qcChanged.decision === REUSE_DECISIONS.SUPPLEMENT, "查询条件变更 → 补查");
  const codesA = qcChanged.refresh_list.flatMap((r) => r.refresh_reasons.map((x) => x.code));
  assert(codesA.includes("query_condition_changed") && codesA.includes("query_condition_unchanged") === false,
    `原因码＝query_condition_changed（实测 ${codesA.join(",")}）`);
  const qcSame = assessEvidenceReuse([rows[0]], { query_condition: "  标签 = 新客  " });
  assert(qcSame.decision === REUSE_DECISIONS.REUSE, "查询条件归一化后相等（去首尾空白）→ 沿用");

  // 适用范围：相同 / 更窄 / 更宽
  const scSame = assessEvidenceReuse([rows[0]], { applicability_scope: "仅 APP 端" });
  assert(scSame.decision === REUSE_DECISIONS.REUSE, "适用范围未变 → 沿用");
  const scNarrow = assessEvidenceReuse([rows[0]], { applicability_scope: "仅 APP 端乳品烘焙", applicability_relation: SCOPE_RELATIONS.NARROWER });
  assert(scNarrow.decision === REUSE_DECISIONS.REUSE, "适用范围更窄 → 原依据仍在覆盖内 → 沿用");
  assert(scNarrow.reusable[0].reasons.some((r) => r.code === "scope_narrowed_still_applicable"),
    "更窄沿用带原因码 scope_narrowed_still_applicable（可核对，不是静默）");
  const scWider = assessEvidenceReuse([rows[0]], { applicability_scope: "APP + 小程序", applicability_relation: SCOPE_RELATIONS.WIDER });
  assert(scWider.decision === REUSE_DECISIONS.SUPPLEMENT &&
    scWider.refresh_list[0].refresh_reasons.some((r) => r.code === "applicability_scope_changed"),
    "适用范围更宽 → 补查（原依据覆盖不到新范围）");
  const scNoRel = assessEvidenceReuse([rows[0]], { applicability_scope: "APP + 小程序" });
  assert(scNoRel.decision === REUSE_DECISIONS.SUPPLEMENT, "适用范围变更但未声明关系 → 不猜，保守补查");

  // 时间范围：区间内 / 区间外 / 晚于取数时点 / 无法解析
  const wide = [ev("EV-C", { itp: "2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15" })];
  const inCov = assessEvidenceReuse(wide, { time_range: { from: "2026-07-01", to: "2026-09-15" } });
  assert(inCov.decision === REUSE_DECISIONS.REUSE, "新时间范围落在覆盖区间内 → 沿用");
  const outCov = assessEvidenceReuse(wide, { time_range: { from: "2026-07-01", to: "2026-09-20" } });
  assert(outCov.decision === REUSE_DECISIONS.SUPPLEMENT &&
    outCov.refresh_list[0].refresh_reasons.some((r) => r.code === "time_range_outside_coverage"),
    "新时间范围超出覆盖区间 → 补查（time_range_outside_coverage）");
  const beyond = assessEvidenceReuse([ev("EV-D", { itp: "2026-09-13 15:20 取数" })], { time_range: { from: "2026-09-01", to: "2026-09-18" } });
  assert(beyond.decision === REUSE_DECISIONS.SUPPLEMENT &&
    beyond.refresh_list[0].refresh_reasons.some((r) => r.code === "time_range_beyond_fetch_time"),
    "新范围上限晚于取数时点 → 补查（time_range_beyond_fetch_time）");
  const unparsed = assessEvidenceReuse([ev("EV-E", { itp: "未标注取数时点" })], { time_range: { from: "2026-09-01", to: "2026-09-10" } });
  assert(unparsed.decision === REUSE_DECISIONS.SUPPLEMENT &&
    unparsed.refresh_list[0].refresh_reasons.some((r) => r.code === "coverage_unparsed" && r.severity === REUSE_SEVERITIES.UNDETERMINED),
    "依据缺可比对字段 → 记 undetermined 并**保守计入补查**（不默认沿用）");

  // 无既有依据
  const noEv = assessEvidenceReuse([], { query_condition: "x" });
  assert(noEv.decision === REUSE_DECISIONS.SUPPLEMENT &&
    noEv.refresh_list.some((r) => r.refresh_reasons.some((x) => x.code === "no_prior_evidence")),
    "原研究无既有依据 → 必补查（no_prior_evidence）");

  // 形态非法一律报错、不静默忽略（沿用 F-19 入参口径）
  await assertThrows(() => assessEvidenceReuse(rows, []), "requested_changes 为数组即拒", "须为对象");
  await assertThrows(() => assessEvidenceReuse(rows, { time_range: "2026-07-01~2026-09-15" }), "time_range 非对象即拒", "time_range");
  await assertThrows(() => assessEvidenceReuse(rows, { time_range: { from: "2026-07-01" } }), "time_range 缺 to 即拒", "from / to");
  await assertThrows(() => assessEvidenceReuse(rows, { time_range: { from: "2026-09-15", to: "2026-07-01" } }), "time_range 倒挂即拒", "不得早于");
  await assertThrows(() => assessEvidenceReuse(rows, { query_condition: "   " }), "声明的 query_condition 为空串即拒", "query_condition");
  await assertThrows(() => assessEvidenceReuse(rows, { applicability_scope: "" }), "声明的 applicability_scope 为空串即拒", "applicability_scope");
  await assertThrows(() => assessEvidenceReuse(rows, { applicability_scope: "x", applicability_relation: "类似的" }), "applicability_relation 值域外即拒", "applicability_relation");
  assert(assessEvidenceReuse(null, {}).checked === 0, "依据入参非数组时不崩（按空集处理）");
}

// ==================================================== ③ 承接主流程（M1 F-05 真实调用链夹具）
const FX = freshDb();
const { sqlite, db } = FX;

/** 用真实调用链造一个「已完成」的原研究：F-03 → F-04 → F-11 → F-21。 */
async function buildDoneResearch({ research_no, proposal_question, population_limit }) {
  const sub = await submitProposal(db, {
    opportunity_id: "OPP-012", research_question: proposal_question, submitted_by: "PM", at: "2026-09-20 09:00",
  });
  const tk = await createHvaResearchTask(db, { proposal_id: sub.proposal.proposal_id });
  await createResearch(db, {
    research_no, opportunity_id: "OPP-012", research_question: proposal_question,
    e1_goal_statement: "（待出报告）", e2_scope_method: "（待出报告）", e4_population_diff: "（待出报告）",
    e6_limits: "（待出报告）", out_of_scope_note: "活动玩法配置、权益组合、预算与排期不在本研究结论范围内。",
    research_status: "running", goal_id: "GOAL-2026Q3-01", goal_version_no: 3,
    start_task_id: tk.task.task_id, population_limit,
  });
  const f = (text, refs) => ({ finding_text: text, support_flag: "supported", limit_note: "限制：现有人群标签维度内成立", evidence_refs: refs });
  const rep = await saveResearchReport(db, {
    research_no,
    e1_goal_statement: "业务目标：提升超市新客 30 天复购率｜研究问题：缺少首单后二次找品是否为主因",
    e2_scope_method: "范围：主站 APP 端三品类新客 2026-07-01~2026-09-15；方法：入口维度分组比较 + 时序核查 + 其他解释排查",
    e4_population_diff: "有二次找品行为的新客复购率高于无该行为者，差异在三个品类方向上一致",
    e6_limits: "① 观察性分组，未做干预验证，行为与较好表现同时出现不等于因果；②「活动存在」不能推出「用户参与」",
    out_of_scope_note: "活动玩法配置、权益组合、预算与排期不在本研究结论范围内，需另行开展。",
    findings: [f("两组人群可比基础成立", ["EV-1038"]), f("活动覆盖基本一致，不构成主要替代解释", ["EV-1041"])],
    candidates: [{
      candidate_id: `CB-${research_no}`, behavior_name: "首单后 7 日内二次找品", behavior_status: "candidate_supported",
      points: [{ point_type: "support", point_text: "与后续复购存在稳定先后关系" }],
    }],
    improvement_actions: [{ target_for: "搜索进入的超市新客", problem_what: "缺少二次找品行为", reason_why: "与后续复购存在稳定先后关系", related_finding_ref: "#1" }],
    warnings: ["上游降级：CDP 本次只返回聚合结果"],
  });
  if (rep.outcome !== "saved") throw new Error(`夹具失败：原研究未出报告（${rep.outcome}）`);
  return { task_id: tk.task.task_id, finding_ids: rep.finding_ids };
}

console.log("\n③ 承接主流程 · M1 F-05 真实调用链（F-03→F-04→F-11→F-21→F-05）");
let F05 = null;
{
  const base = await buildDoneResearch({
    research_no: "R-901", proposal_question: "搜索进入新客复购更低，是缺少首单后二次找品吗？",
    population_limit: "搜索进入的超市新客",
  });
  const fu = await createFollowupTask(db, {
    research_no: "R-901", new_question: "渠道结构（APP / 小程序）是否一致？", at: "2026-09-20 10:00",
  });
  F05 = { base, fu, followup_research_no: fu.research.research_no, task_id: fu.task.task_id };
  assert(fu.research.parent_research_no === "R-901", `F-05 建的新研究挂在原研究上（parent=${fu.research.parent_research_no}）`);
  assert(fu.task.task_type === FOLLOWUP_TASK_TYPE, `F-05 建的任务类型为 hva_followup（实测 ${fu.task.task_type}）`);
  assert(fu.task.parent_task_id === base.task_id, "追问任务的 parent_task_id 指向原任务");

  const tables = ["research", "task", "research_finding", "finding_evidence", "evidence", "improvement_action", "candidate_behavior"];
  const beforeCounts = Object.fromEntries(tables.map((t) => [t, countRows(sqlite, t)]));
  const beforeRows = {
    original: JSON.stringify(await getResearch(db, "R-901")),
    originalTask: rawRows(sqlite, "task", "task_id"),
    originalFindings: rawRows(sqlite, "research_finding", "finding_id"),
  };

  const r = await intakeFollowup(db, { task_id: fu.task.task_id, requested_changes: {} });

  // 承接身份
  assert(r.intake.task_id === fu.task.task_id && r.intake.task_type === FOLLOWUP_TASK_TYPE, "回带追问任务身份与类型");
  assert(r.intake.followup_research_no === fu.research.research_no,
    `回带追问研究编号（实测 ${r.intake.followup_research_no}）`);
  assert(r.intake.original_research_no === "R-901", "回带原研究编号");
  assert(r.intake.followup_research_shell_present === true, "追问研究壳已存在（由 F-05 建行，F-22 不建）");
  assert(r.intake.question === "渠道结构（APP / 小程序）是否一致？", "追问问题缺省取追问研究行的 research_question");
  assert(r.intake.question_source === "followup_research.research_question", `问题来源可追溯（实测 ${r.intake.question_source}）`);
  assert(r.intake.original_task_id === base.task_id, "回带原任务编号（原研究 start_task_id 有效时）");

  // 保留原结果与依据
  const p = r.preserved;
  assert(p.original_research.research_no === "R-901" && p.original_research.research_status === "done", "原研究身份与状态原样回带");
  assert(p.original_research.elements.e3_evidence_findings.length === 2, `原结果发现逐条回带（实测 ${p.original_research.elements.e3_evidence_findings.length} 条）`);
  assert(p.original_research.elements.e7_improvement_actions.length === 1, "原改善方向逐条回带");
  assert(p.original_research.elements.e5_candidate_hva.candidates.length === 0,
    "F-21 只写发现与改善方向（候选行为 MD-09 归 F-20）——本夹具未跑 F-20，故候选为 0；候选回带由 ④ 的 CB-001 覆盖");
  assert(p.original_research.elements.e3_evidence_findings.every((f) => (f.evidence_refs || []).length > 0), "逐发现证据回指齐备（LNK-02）");
  assert(p.evidence.length === 2 && p.evidence.every((e) => e.query_condition && e.info_time_point && e.applicability_scope),
    `原依据全字段回带（实测 ${p.evidence.length} 条，四要素字段齐）`);
  assert(p.lineage && Array.isArray(p.lineage.descendants) && p.lineage.descendants.some((d) => d.research_no === fu.research.research_no),
    "追问链可见（原研究的 descendants 含本轮追问研究）");
  assert(p.original_research.parent_research_no === null, "原研究自身不带父指针（链的起点）");
  assert(p.negates_original_conclusion === false, "补查 ≠ 否定：negates_original_conclusion 恒 false");
  assert(p.original_preserved === true, "运行期自检：本步前后原研究读模型逐字节一致（original_preserved）");

  // 版本口径（沿用）
  assert(r.version.original_research_goal_version_no === 3 && r.version.followup_effective_goal_version_no === 3,
    "沿用原版本 v3（研究侧）");
  assert(r.version.original_task_goal_version_no === 3, "原任务版本可读且＝研究版本（启动快照一致）");
  assert(r.version.version_changed === false && r.version.new_version_required === false, "无版本变更、不需新版本");
  assert(r.version.task_research_version_consistent === true, "校验「任务版本 ↔ 研究版本」一致");

  // 新一轮入口
  const nr = r.next_round;
  assert(nr.entry === NEXT_ROUND_ENTRY && nr.chain.join(">") === NEXT_ROUND_CHAIN.join(">"), "新一轮起点＝S-B1、下游链＝F-19>F-20>F-21");
  assert(nr.research_no === fu.research.research_no && nr.task_id === fu.task.task_id, "新一轮入口带上追问任务与新研究编号");
  assert(nr.check_sequence_keys.join(">") === RESEARCH_CHECK_SEQUENCE.map((s) => s.check_key).join(">"),
    "查证顺序**派生自 F-19** RESEARCH_CHECK_SEQUENCE（不复制第二份）");
  assert(nr.comparison_conditions.audience === "搜索进入的超市新客", `比较条件能定则定（audience 取人口限定，实测 ${nr.comparison_conditions.audience}）`);
  assert(nr.comparison_missing.length === COMPARISON_CONDITION_KEYS.length - 1, `比较条件缺项如实登记（缺 ${nr.comparison_missing.join("/")}）`);
  assert(nr.reuse_decision === REUSE_DECISIONS.REUSE && nr.refresh_checklist.length === 0, "沿用时不产出补查清单");
  assert(nr.out_of_scope_note.includes("活动") && nr.out_of_scope_note.includes("排期"), "新一轮入口自带不覆盖范围声明（BRD §5.2）");
  assert(nr.stop_when === STOP_CONDITION, "新一轮入口带停止条件（不在本步执行）");

  // 边界自述 + 零写实测
  assert(r.boundaries.zero_write === true && r.boundaries.external_calls === 0 && r.boundaries.llm_calls === 0, "本步零写 / 零外部调用 / 零 LLM 自述");
  assert(r.dispatch_result.dispatched === false && r.dispatch_result.reason === "not_injected",
    "下游派发端口未注入 → 不触发（不重复发 Queue 消息）");
  assert(r.question_scope_warning === null, "追问文本不含禁词时不产出警告");

  const afterCounts = Object.fromEntries(tables.map((t) => [t, countRows(sqlite, t)]));
  assert(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), `运行期零写：7 张表行数不变（实测 ${JSON.stringify(afterCounts)}）`);
  assert(JSON.stringify(await getResearch(db, "R-901")) === beforeRows.original, "原研究行逐字段未变（钉版）");
  assert(rawRows(sqlite, "task", "task_id") === beforeRows.originalTask, "task 表逐行未变（原任务与新任务都未被本步改写）");
  assert(rawRows(sqlite, "research_finding", "finding_id") === beforeRows.originalFindings, "原发现行逐字段未变（保留原结果）");
}

// ==================================================== ④ 种子原型剧本（T-1023 + R-007）
console.log("\n④ 种子原型剧本 · 追问任务 T-1023 + 显式原研究 R-007（PM 问「渠道结构 APP/小程序」）");
{
  const r = await intakeFollowup(db, {
    task_id: "T-1023",
    original_research_no: "R-007",
    new_question: "乳品方向再补查一下：搜索进入和推荐位进入的人群，渠道结构（APP / 小程序）是不是一致的？",
    requested_changes: { applicability_scope: "京东超市主站 APP + 小程序", applicability_relation: SCOPE_RELATIONS.WIDER },
  });
  assert(r.intake.followup_research_no === null && r.intake.followup_research_shell_present === false,
    "种子口径：该追问任务尚未建研究壳（F-05 未跑）——不编造，如实回带 null");
  assert(r.preserved.original_research.elements.e3_evidence_findings.length === 4, `R-007 的 4 条发现全部回带（实测 ${r.preserved.original_research.elements.e3_evidence_findings.length}）`);
  assert(r.preserved.original_research.elements.e7_improvement_actions.length === 3, "R-007 的 3 条改善方向全部回带");
  assert(r.preserved.original_research.elements.e5_candidate_hva.candidates[0].candidate_id === "CB-001", "R-007 的候选行为 CB-001 回带");
  assert(r.preserved.evidence.length === 4, `4 条去重依据全字段回带（实测 ${r.preserved.evidence.length}：${r.preserved.evidence.map((e) => e.evidence_id).join(",")}）`);
  assert(r.preserved.lineage.ancestors.length === 0 && r.preserved.lineage.chain_from_root.length === 1, "R-007 是链的根（ancestors 0）");

  assert(r.evidence_reuse.decision === REUSE_DECISIONS.SUPPLEMENT, `适用范围放宽到「APP + 小程序」→ 补查（实测 ${r.evidence_reuse.decision}）`);
  assert(r.evidence_reuse.checked === 4 && r.evidence_reuse.refresh_list.length === 4,
    `4 条依据全部需补查（实测 checked=${r.evidence_reuse.checked} refresh=${r.evidence_reuse.refresh_list.length}）`);
  assert(r.evidence_reuse.refresh_list.every((x) => x.refresh_reasons.some((y) => y.code === "applicability_scope_changed")),
    "补查原因码＝applicability_scope_changed（EV-1041 原范围「仅主站 APP 端；不含小程序」覆盖不到新范围）");
  assert(r.next_round.refresh_checklist.length === 4 && r.next_round.refresh_checklist.every((x) => x.severity === REUSE_SEVERITIES.REQUIRED),
    "补查清单逐条带证据编号与严重度（required）");
  assert(r.next_round.reuse_decision === REUSE_DECISIONS.SUPPLEMENT, "新一轮入口带上「补查」判定");
  assert(r.intake.original_task_id === null, "R-007 的 start_task_id 为空 → 原任务回带 null（不编造）");
  assert(r.preserved.original_preserved === true, "R-007 前后逐字节一致（保留原结果与依据）");

  const und = await intakeFollowup(db, { task_id: "T-1023", original_research_no: "R-007" });
  assert(und.evidence_reuse.decision === REUSE_DECISIONS.UNDETERMINED && und.evidence_reuse.llm_gated === true,
    "未声明变更 → undetermined 且标 llm_gated（A-1 门禁只挡语义判断）");
  assert(und.next_round.refresh_checklist.length === 0, "未决时不产出补查清单（不臆断）");

  const reuseAll = await intakeFollowup(db, { task_id: "T-1023", original_research_no: "R-007", requested_changes: {} });
  assert(reuseAll.evidence_reuse.decision === REUSE_DECISIONS.REUSE && reuseAll.evidence_reuse.reusable.length === 4,
    "明确无变更 → 4 条依据全部沿用");

  // 适用范围「更窄」→ 沿用（不瞎补查）
  const narrower = await intakeFollowup(db, {
    task_id: "T-1023", original_research_no: "R-007",
    requested_changes: { applicability_scope: "仅京东超市主站 APP 端", applicability_relation: SCOPE_RELATIONS.NARROWER },
  });
  assert(narrower.evidence_reuse.decision === REUSE_DECISIONS.REUSE, "适用范围更窄 → 沿用（原依据仍在覆盖内）");
}

// ==================================================== ⑤ 版本口径：沿用 / 升版 / 范围变更未升版
console.log("\n⑤ 版本口径 · 追问可落新版本，原任务与原研究钉在启动时版本");
{
  const r0 = await loadFollowupIntakeContext(db, { task_id: F05.task_id });
  const v0 = JSON.stringify({ t: r0.original_task.goal_version_no, r: r0.original_research.goal_version_no });

  const fu4 = await createFollowupTask(db, {
    research_no: "R-901", new_question: "换到 Q4 口径再查一遍渠道结构", goal_version_no: 4, at: "2026-09-20 11:00",
  });
  const bumped = await intakeFollowup(db, { task_id: fu4.task.task_id, requested_changes: { scope_changed: true } });
  assert(bumped.version.version_changed === true && bumped.version.followup_effective_goal_version_no === 4,
    `追问落新版本 v4（实测 ${bumped.version.followup_effective_goal_version_no}）`);
  assert(bumped.version.original_research_goal_version_no === 3, "原研究版本仍为 v3（钉版）");
  assert(bumped.version.new_version_required === false, "已升版 → 不再要求新建版本");

  const r1 = await loadFollowupIntakeContext(db, { task_id: F05.task_id });
  const v1 = JSON.stringify({ t: r1.original_task.goal_version_no, r: r1.original_research.goal_version_no });
  assert(v0 === v1, `原任务与原研究版本在本轮追问前后逐字未变（实测 ${v1}）`);
  assert(r1.original_task.goal_version_no === 3, "原任务继续用启动时版本 v3（BRD「已启动任务继续使用启动时的版本」）");

  // 声明范围变更但未升版 → 提示须由 F-01 建新版本（本步不建）
  const needNew = await intakeFollowup(db, { task_id: F05.task_id, requested_changes: { scope_changed: true } });
  assert(needNew.version.new_version_required === true && needNew.version.scope_changed === true,
    "声明范围变更但未升版 → new_version_required=true（建版本归 M1 F-01，本步不建行）");
  const researchRowsBefore = countRows(sqlite, "research");
  const goalVerRows = rawRows(sqlite, "research_goal_version", "goal_id, version_no");
  await intakeFollowup(db, { task_id: F05.task_id, requested_changes: { scope_changed: true } });
  assert(countRows(sqlite, "research") === researchRowsBefore && rawRows(sqlite, "research_goal_version", "goal_id, version_no") === goalVerRows,
    "本步不新建研究行、不改写 MD-02 版本行（建行归上游）");
}

// ==================================================== ⑥ 下游派发端口 + 禁词提示
console.log("\n⑥ 下游派发端口与输出边界提示");
{
  const calls = [];
  const r = await intakeFollowup(db, {
    task_id: F05.task_id,
    requested_changes: {},
    dispatch: async (payload) => { calls.push(payload); return { accepted: true }; },
  });
  assert(calls.length === 1, `注入派发端口时恰调用一次（实测 ${calls.length}）`);
  assert(r.dispatch_result.dispatched === true && r.dispatch_result.reason === "injected", "派发结果自述 dispatched=true");
  assert(calls[0] && calls[0].entry === NEXT_ROUND_ENTRY && Array.isArray(calls[0].chain) && calls[0].chain.join(">") === "F-19>F-20>F-21",
    "派发载荷带新一轮入口（entry=S-B1、chain=F-19>F-20>F-21）");
  assert(calls[0].research_no === F05.followup_research_no && calls[0].task_id === F05.task_id, "派发载荷带追问任务与新研究编号");

  const dirty = await intakeFollowup(db, {
    task_id: F05.task_id, new_question: "顺便把活动预算和排期也定了", requested_changes: {},
  });
  const hits = dirty.question_scope_warning ? dirty.question_scope_warning.hits.map((h) => h.pattern) : [];
  assert(hits.includes("预算") && hits.includes("排期"), `追问越界文本被提示（实测命中 ${hits.join(",")}）`);
  assert(dirty.question_scope_warning.patterns_checked === FORBIDDEN_PRODUCTION_PATTERNS.length,
    "禁词表复用 F-18（口径项数与实现一致，不复制第二份）");
  assert(dirty.intake.question === "顺便把活动预算和排期也定了", "越界追问**不被拦截**（人工节点的提问不归本步否决）");

  const clean = await intakeFollowup(db, { task_id: F05.task_id, new_question: "渠道结构是否一致？", requested_changes: {} });
  assert(clean.question_scope_warning === null, "未越界时不产出警告（无误报）");
}

// ==================================================== ⑦ 入口守卫（错误态）
console.log("\n⑦ 入口守卫 · 承接须挂在真实 hva_followup 任务与真实原研究上");
{
  await assertThrows(() => intakeFollowup(db, { original_research_no: "R-007" }), "缺 task_id 即拒", "task_id");
  await assertThrows(() => intakeFollowup(db, { task_id: "T-NOPE", original_research_no: "R-007" }), "任务不存在即拒（HTTP 层 404）", "追问任务不存在");
  await assertThrows(() => intakeFollowup(db, { task_id: "T-1021", original_research_no: "R-006" }),
    "非 hva_followup 任务即拒（防把普通研究/发现任务当追问）", "hva_followup");
  await assertThrows(() => intakeFollowup(db, { task_id: F05.task_id, original_research_no: "R-NOPE" }),
    "原研究不存在即拒", "原研究不存在");
  await assertThrows(() => intakeFollowup(db, { task_id: "T-1023" }),
    "既无研究行又未给原研究编号 → 无法解析即拒（不猜）", "无法解析原研究");
  const ctx = await loadFollowupIntakeContext(db, { task_id: "T-NOPE" });
  assert(ctx === null, "薄读对不存在的任务返回 null（由调用方决定错误码）");
}

// ==================================================== ⑧ 静态核验（零裸 SQL / 零外部调用 / 依赖面收敛）
console.log("\n⑧ 静态核验 · 零裸 SQL、零外部调用、import 面收敛、不重复实现上游写面");
{
  const src = readFileSync(MODULE_SRC, "utf8");
  const code = stripComments(src);

  // 静态 import 提取**先 stripComments**：文档卡「用法」行里的 `from "./x.js"` 示例会被朴素扫描计入（踩过）。
  const imps = [...code.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  const expected = [
    "./result.js",
    "./role.js",
    "./research-start.js",
    "./verification.js",
    "../shared-context/index.js",
    "../task-runner/step-plan.js",
  ];
  assert(imps.length === expected.length && expected.every((e) => imps.includes(e)),
    `import 恰 ${expected.length} 条且全部为既有读面（实测 ${imps.join(" | ")}）`);

  assert(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(code), "零写语句（stripComments 后 0 命中）");
  assert(!/\bSELECT\b/.test(code), "零裸 SQL（连 SELECT 都不写，取值全经既有读面）");
  assert(!/\bfetch\s*\(|XMLHttpRequest|axios/.test(code), "零外部调用（无 fetch / XHR / axios）");
  assert(!/createFollowupTask|recordFollowupMessage|createResearch\b|saveResearchReport|updateResearchReport|createImprovementAction|createResearchFinding/.test(code),
    "不重复实现上游写面（M1 F-05 建行 / F-21 落库函数名不出现于代码）");
  assert(/loadResearchResultContext/.test(code), "原结果经 F-21 读面取得（复用而非重写）");
  assert(/getResearchLineage/.test(code), "追问链经 M2 读面 getResearchLineage（TC-I-M2-004）");
  assert(/parseStamp/.test(code), "抽时点复用 F-15 parseStamp（不复制第二份口径）");
  assert(/FORBIDDEN_PRODUCTION_PATTERNS|scanProductionActions/.test(code), "禁词口径复用 F-18（不内联禁词）");
  assert(!/FORBIDDEN_PRODUCTION_PATTERNS\s*=\s*\[/.test(code), "不在本文件内重新定义禁词表（唯一真源在 F-18）");
  assert(/NEXT_ROUND_CHAIN\s*=\s*Object\.freeze\(\["F-19", "F-20", "F-21"\]\)/.test(src), "下游链常量显式且冻结");
  assert(!/TODO|FIXME|占位|&& false/.test(src), "交付物无草稿残留（TODO / 占位 / && false）");
}

finish();
