#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M4 · F-19 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M4.md（**TC-A-M4-001**（L4·F-19：S-B1 二阶段注入清单→三分支路径选择，**路径确定后停止**，产品假设不预先作为结论）｜
 *        **TC-I-M4-003**（L5·F-19：适合性判断，不适合时说明限制而非硬做——⚠️待确认(§7-T21)，本执行器只验**可注入判据 + 确定性路由**，该 oracle 项登记为「门禁未关闭、非发布门禁」）｜
 *        **TC-D-M4-006**（L3·F-19：MD-12 `opportunity_id='OPP-NOPE'` FK 失败）｜
 *        **TC-I-M4-002**（L5·F-18/F-20：查询链路经 M5 只读、不调生产写——本执行器以「真库行数不变 + fake-db 全 SELECT」证明零写））
 *   ｜ ../../docs/02-prd/PRD-M4-HVA分析Agent.md F-19（三分支与保留判断）｜ §1.1.3 S-B1（判断适合性→定比较条件→排查证顺序；停止＝路径确定）
 *   ｜ ../../docs/01-brd/BRD.md §4 F-19｜ §5.2 out of scope｜ §5.3 硬红线｜ §7 第 4 条
 *   ｜ ../../docs/03-locks/schema.md（MD-12 research_proposal：研究问题必需 / 假设与人群限制可选 / `opportunity_id` FK）
 *   ｜ ./research-start.js（F-19 本体）｜ ./role.js（F-18：`labelProductHypothesis` 口径来源）｜ ../shared-context/index.js（读面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-19 用例并断言。
 * 夹具：用 F-03 `submitProposal` 造真实研究建议（**依赖前序**），用 F-04 `createHvaResearchTask` 造真实任务链
 *   （任务 + LNK-04 锚点 + CFG-06 `hva_research` 模板落 PD-06）——不手工拼任务行。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理）；**数值以契约基准 v1（ADR-004）为准**，只断结构与语义。
 * 边界：只验 F-19（适合性判断 + 三分支路由 + 比较条件 + 查证顺序 + 薄读注入清单）；F-20~F-22 不在本执行器。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f19.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f19.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  judgeResearchSuitability,
  assembleResearchStart,
  resolveComparisonConditions,
  assembleResearchCheckSequence,
  loadResearchStartContext,
  RESEARCH_PATHS,
  COMPARISON_CONDITION_KEYS,
  RESEARCH_CHECK_SEQUENCE,
  STOP_CONDITION,
} from "./research-start.js";
import { submitProposal } from "../task-runner/proposal.js";
import { createHvaResearchTask } from "../task-runner/hva.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./research-start.js", import.meta.url);

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

/**
 * 真实任务链夹具（用 F-03 + F-04 造，不手工拼行）：
 * 种子机会 `OPP-012`（2 条 LNK-01 证据、且已有历史研究 R-007）上提交一份建议，再启动 HVA 研究任务。
 * @returns {Promise<{ task_id:string, proposal_id:string }>}
 */
async function buildResearchTaskFixture(db, { hypothesis, population_limit } = {}) {
  const submitted = await submitProposal(db, {
    opportunity_id: "OPP-012",
    research_question: "搜索进入的新客复购更低，是入口带来的需求强度差异，还是缺少首单后二次找品这一候选行为？",
    behavior_hypothesis: hypothesis,
    population_limit: population_limit,
    submitted_by: "PM（用例夹具）",
    at: "2026-09-19 10:00",
  });
  const created = await createHvaResearchTask(db, { proposal_id: submitted.proposal.proposal_id });
  return { task_id: created.task.task_id, proposal_id: submitted.proposal.proposal_id };
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

const BASE_INJECTION = {
  research_question: "首单购买家庭装是否是与新客长期价值相关的关键行为？",
  population_limit: "乳品烘焙新客",
  focus_period: "2026-07-01 ~ 2026-09-15",
  metric_definition: "30 天复购率（剔除退款订单）",
  evidence: [{ evidence_id: "EV-1041" }, { evidence_id: "EV-1038" }],
  history: [{ research_no: "R-007" }],
};

// ==================================================== ① TC-A-M4-001 三分支路径选择（纯计算）
console.log("① TC-A-M4-001 · S-B1 三分支路由（起点①查证假设 / 起点②寻找候选 / 起点③说明限制）");
{
  await assertThrows(() => assembleResearchStart(null), "入参非对象 → 报错", "须为对象");
  await assertThrows(() => assembleResearchStart({}), "缺 research_question → 报错（MD-12 研究问题为必需项）", "research_question");

  // —— 起点①：有候选行为假设 ——
  const h1 = assembleResearchStart({ ...BASE_INJECTION, behavior_hypothesis: "家庭装首单是关键行为" });
  assert(h1.path === RESEARCH_PATHS.VERIFY_HYPOTHESIS, `起点① 有假设 → path=verify_hypothesis（实测 ${h1.path}）`);
  assert(h1.plan[0].check_key === "hypothesis_check", `起点① 首步＝检验假设（实测 ${h1.plan[0].check_key}）`);
  assert(h1.hypothesis && h1.hypothesis.nature === "hypothesis" && h1.hypothesis.is_conclusion === false && h1.hypothesis.must_verify === true,
    "起点① 假设经 F-18 口径标注：nature=hypothesis / is_conclusion=false / must_verify=true");
  assert(h1.hypothesis_not_conclusion === true && h1.hypothesis_is_conclusion === false,
    "起点① 红线可运行：产品假设不预先作为研究结论（假设不出现在任何结论位）");
  assert(/不预先作为研究结论/.test(h1.path_reason), `起点① 路由理由明示红线（实测「${h1.path_reason.slice(0, 40)}…」）`);

  // —— 起点②：只有研究问题 ——
  const h2 = assembleResearchStart({ ...BASE_INJECTION });
  assert(h2.path === RESEARCH_PATHS.FIND_CANDIDATE, `起点② 无假设 → path=find_candidate（实测 ${h2.path}）`);
  assert(h2.plan[0].check_key === "candidate_search", `起点② 首步＝寻找候选行为（实测 ${h2.plan[0].check_key}）`);
  assert(h2.hypothesis === null, "起点② 不编造假设（hypothesis=null）");
  assert(h2.allow_no_candidate === true, "起点② 允许找不到有足够依据的候选行为（allow_no_candidate=true）");
  assert(/完整结果/.test(h2.notes.no_candidate_is_complete), "起点② 明示「未找到有足够依据的候选行为也是完整结果」");
  assert(h2.complete_result_possible === true, "起点② 结果可为完整（complete_result_possible=true）");

  // —— 起点③：问题不适合（语义判断受 A-1 门禁，由上游注入） ——
  const h3 = assembleResearchStart({
    ...BASE_INJECTION,
    behavior_hypothesis: "家庭装首单是关键行为",
    suitability: { suitable: false, reason: "研究问题主要涉及服务体验，不适合硬归结为关键行为" },
  });
  assert(h3.path === RESEARCH_PATHS.STATE_LIMITATION, `起点③ 不适合 → path=state_limitation（实测 ${h3.path}）`);
  assert(h3.plan.every((s) => s.check_key.startsWith("state_")), "起点③ 不安排五查取数，只说明问题与限制");
  assert(h3.limitation && h3.limitation.hard_run === false, "起点③ 不硬做（hard_run=false）");
  assert(h3.limitation.problem === BASE_INJECTION.research_question, "起点③ 原样带出研究问题（不重构）");
  assert(h3.limitation.existing_findings_count === 2, `起点③ 已有发现条数如实（实测 ${h3.limitation.existing_findings_count}）`);
  assert(/不硬归结为关键行为/.test(h3.limitation.note), "起点③ 口径含「不硬归结为关键行为」");
  assert(h3.hypothesis === null && h3.hypothesis_is_conclusion === false, "起点③ 即便有假设也不当结论（不进结论位）");

  // —— 停止条件：路径确定即停止（S-B1） ——
  for (const [name, r] of [["①", h1], ["②", h2], ["③", h3]]) {
    assert(r.stopped === true && /路径确定/.test(r.stop_condition), `起点${name} 停止＝路径确定（stopped=${r.stopped}）`);
  }
  assert(STOP_CONDITION === STOP_CONDITION && /S-B1/.test(STOP_CONDITION), "停止条件常量回指 S-B1");

  // —— 排查证顺序＝F-20 五查顺序，确定性 ——
  const expectOrder = RESEARCH_CHECK_SEQUENCE.map((s) => s.check_key).join(">");
  assert(expectOrder === "population_comparability>temporal_order>metric_alignment>alternative_explanations>information_sufficiency",
    `查证顺序模板＝五查顺序（实测 ${expectOrder}）`);
  assert(h2.evidence_order.join(">") === expectOrder, `起点② 计划内顺序与模板一致（实测 ${h2.evidence_order.join(">")}）`);
  assert(h2.plan.length === 1 + RESEARCH_CHECK_SEQUENCE.length, `起点② 计划＝首步 + 五查共 ${1 + RESEARCH_CHECK_SEQUENCE.length} 步（实测 ${h2.plan.length}）`);
  assert(h2.plan.every((s, i) => s.step_no === i + 1), "计划 step_no 从 1 连续递增（先查/后查有序）");
  assert(h2.plan.every((s) => s.check_item && s.reason && s.stop_when_enough && Array.isArray(s.data_sources)),
    "每步含 check_item/reason/stop_when_enough/data_sources");

  // —— 来源过滤：只查 CDP → 只保留人群可比基础 + 无来源步骤 ——
  const onlyCdp = assembleResearchCheckSequence(["CDP"]);
  assert(onlyCdp.length === 1 + 2, `仅 CDP → 1 个来源步骤 + 2 个无来源步骤（实测 ${onlyCdp.length}）`);
  assert(onlyCdp[0].check_key === "population_comparability", "过滤后首步仍是人群可比基础");
  assert(onlyCdp.some((s) => s.check_key === "information_sufficiency"), "无来源步骤（信息充分）恒保留");
  const none = assembleResearchCheckSequence();
  assert(none.length === RESEARCH_CHECK_SEQUENCE.length, `不传 only → 全量五步（实测 ${none.length}）`);
  assert(assembleResearchCheckSequence(null).length === RESEARCH_CHECK_SEQUENCE.length,
    "only 为 null → 视为不过滤（可选参数，不报错）");
}

// ==================================================== ② TC-I-M4-003 适合性判断（可注入 + 不硬下结论）
console.log("\n② TC-I-M4-003 · 适合性判断（A-1 门禁下走确定性 fallback，不硬造「不适合」）");
{
  await assertThrows(() => judgeResearchSuitability({}), "缺 research_question → 报错", "不能为空");
  await assertThrows(() => judgeResearchSuitability({ research_question: "   " }), "空白 research_question → 报错", "不能为空");

  const d = judgeResearchSuitability({ research_question: "家庭装首单是否关键行为" });
  assert(d.suitable === true && d.source === "default_no_llm", `未提供判断 → 按「适合」继续（实测 ${d.suitable}/${d.source}）`);
  assert(d.llm_gated === true, "标注该判断受 LLM（A-1）门禁");
  assert(/A-1/.test(d.note) && /门禁/.test(d.note), "口径声明含 A-1 门禁登记");
  assert(/不硬下/.test(d.note), "明示「不硬下不适合结论」");

  const given = judgeResearchSuitability({
    research_question: "x", suitability: { suitable: false, reason: "问题主要涉及服务体验", signals: ["服务体验类问题"] },
  });
  assert(given.suitable === false && given.source === "provided", "上游语义判断被采纳（source=provided）");
  assert(given.signals.length === 1 && given.signals[0] === "服务体验类问题", "信号如实透传（可扩展结构，不硬编码个数）");
  assert(/不硬归结为关键行为/.test(given.note), "不适合时给出「说明限制而非硬做」口径");

  const ok = judgeResearchSuitability({ research_question: "x", suitability: { suitable: true, reason: "有可观察行为" } });
  assert(ok.suitable === true && ok.source === "provided", "正例：上游判定适合 → 进入候选行为路径");

  await assertThrows(() => judgeResearchSuitability({ research_question: "x", suitability: "yes" }),
    "suitability 形态非法（字符串）→ 报错（不静默忽略）", "不合法");
  await assertThrows(() => judgeResearchSuitability({ research_question: "x", suitability: { suitable: "yes" } }),
    "suitability.suitable 非布尔 → 报错（不静默忽略）", "不合法");
}

// ==================================================== ③ 比较条件装配（能定则定、缺则登记）
console.log("\n③ 比较条件 · `resolveComparisonConditions`（三项：涉及哪些用户 / 观察哪个阶段 / 什么结果口径）");
{
  assert(COMPARISON_CONDITION_KEYS.length === 3, `比较条件恰 3 项（实测 ${COMPARISON_CONDITION_KEYS.length}）`);
  assert(COMPARISON_CONDITION_KEYS.map((c) => c.key).join(",") === "audience,observation_stage,result_metric",
    "键名＝audience/observation_stage/result_metric");
  assert(COMPARISON_CONDITION_KEYS.every((c) => c.title && c.source_hint), "每项含标题与来源回指（不复制叙述文本）");

  const full = resolveComparisonConditions({ ...BASE_INJECTION });
  assert(full.declared === true && full.missing.length === 0, "三项齐 → declared=true、无缺项");
  assert(full.conditions.audience === "乳品烘焙新客", `audience 取自 population_limit（实测 ${full.conditions.audience}）`);
  assert(full.conditions.observation_stage === "2026-07-01 ~ 2026-09-15", "observation_stage 取自目标版本关注时段");
  assert(full.conditions.result_metric === "30 天复购率（剔除退款订单）", "result_metric 取自目标版本指标口径");

  const partial = resolveComparisonConditions({ comparison_conditions: { audience: "新客" } });
  assert(partial.declared === false && partial.missing.join(",") === "observation_stage,result_metric",
    `缺项如实列出（实测 ${partial.missing.join(",")}）`);
  assert(/不编造/.test(partial.note), "缺口口径含「不编造」");
  const empty = resolveComparisonConditions({});
  assert(empty.missing.length === 3, "全缺 → 三项全部列入（不静默回退）");

  const viaStart = assembleResearchStart({ research_question: "q" });
  assert(viaStart.comparison_conditions_declared === false && viaStart.comparison_conditions_missing.length === 3,
    "编排入口如实带出比较条件缺口（不阻断路径确定）");
  assert(viaStart.stopped === true, "比较条件缺失不阻断「路径确定」停止（缺口由 F-20 承接）");
}

// ==================================================== ④ 薄读：真实任务链 + 二阶段注入清单 + 零写
console.log("\n④ 薄读二阶段注入清单 · F-03 建议 + F-04 任务链（真实库）");
let realCtx = null;
{
  const { sqlite, db } = freshDb();
  const fx = await buildResearchTaskFixture(db, { hypothesis: "首单后二次找品是关键行为", population_limit: "搜索入口新客" });
  const before = ["task", "context_injection", "research_proposal", "research"].map((t) => countRows(sqlite, t));

  realCtx = await loadResearchStartContext(db, fx.task_id);
  assert(realCtx.task_id === fx.task_id, `清单锚定任务（实测 ${realCtx.task_id}）`);
  assert(realCtx.task_type === "hva_research", `任务类型＝hva_research（实测 ${realCtx.task_type}）`);
  assert(realCtx.opportunity && realCtx.opportunity.opportunity_id === "OPP-012", "机会及版本：机会取自 LNK-04 锚点（OPP-012）");
  assert(realCtx.opportunity.goal_version_no === 3 && realCtx.goal_version_no === 3, "机会版本与任务版本一致（v3）");
  assert(realCtx.goal_version && realCtx.goal_version.version_no === 3, "目标版本快照已装配（MD-02 v3）");
  assert(realCtx.proposal && realCtx.proposal.proposal_id === fx.proposal_id, "产品问题：取自 MD-12 真实建议行（非种子）");
  assert(realCtx.research_question && realCtx.research_question.length > 0, "研究问题原样透传");
  assert(realCtx.behavior_hypothesis === "首单后二次找品是关键行为", "可选假设随清单带入");
  assert(realCtx.population_limit === "搜索入口新客", "人群限制随清单带入");
  assert(realCtx.evidence.length === 2, `证据：条数＝LNK-01 关联数（实测 ${realCtx.evidence.length}）`);
  assert(realCtx.evidence.every((e) => e.evidence_id), "每条证据带 evidence_id（可回查）");
  // F-04 于 2026-09-21 补齐「建任务同时建 MD-07 研究壳」后，本机会的历史研究由 1 条变 2 条：
  // 首条＝本研究刚建的研究壳（`R-008`，`start_task_id` 指回本任务）、次条＝种子里已有的 `R-007`。
  // （口径未变：仍是「按机会现读 MD-07」；变的是**库里真的多了一行**——这正是补齐的目的。）
  assert(
    realCtx.history.map((h) => h.research_no).join(",") === "R-008,R-007" && realCtx.history[0].start_task_id === fx.task_id,
    `历史研究：按机会现读 MD-07（实测 ${realCtx.history.map((h) => h.research_no).join(",")}；start_task_id=${JSON.stringify(realCtx.history[0] && realCtx.history[0].start_task_id)}）`,
  );
  assert(realCtx.six_elements && typeof realCtx.six_elements === "object", "所选机会附六要素判定（供判断参考）");
  assert(realCtx.context_complete === true && realCtx.missing_required.length === 0, "CFG-06 hva_research 模板必需类型齐备");
  assert(Array.isArray(realCtx.injections) && realCtx.injections.length > 0, `PD-06 注入留痕非空（实测 ${realCtx.injections.length} 条）`);

  // 一步编排：清单 → 路径选择
  const started = assembleResearchStart(realCtx);
  assert(started.path === RESEARCH_PATHS.VERIFY_HYPOTHESIS, `真实清单一步编排 → 起点①（实测 ${started.path}）`);
  assert(started.comparison_conditions.audience === "搜索入口新客", "比较条件从清单现读（population_limit）");
  assert(started.stopped === true, "编排结束于路径确定");

  // —— 零写：薄读 + 纯编排前后关键表行数不变 ——
  const after = ["task", "context_injection", "research_proposal", "research"].map((t) => countRows(sqlite, t));
  assert(JSON.stringify(before) === JSON.stringify(after), `薄读与编排前后行数不变（task/context_injection/research_proposal/research；实测 ${before.join("/")} → ${after.join("/")}）`);

  // 前置守卫：任务不存在 → 报错（不静默造清单）
  await assertThrows(() => loadResearchStartContext(db, "T-NOPE"), "任务不存在 → 报错", "不存在");
  await assertThrows(() => loadResearchStartContext(db, "   "), "空 task_id → 报错", "不能为空");

  // fake-db：发出的语句全为 SELECT（零写）
  const seen = [];
  const fakeDb = {
    prepare: (sql) => {
      seen.push(sql);
      return { bind: () => ({ all: () => ({ results: [] }), first: () => null, run: () => ({ success: true, meta: { changes: 0 } }) }) };
    },
  };
  await assertThrows(() => loadResearchStartContext(fakeDb, "T-X"), "fake-db 下 task 为空 → 抛错（前置守卫生效）", "不存在");
  assert(seen.length > 0, `确实经 prepare 发出语句（实测 ${seen.length} 条）`);
  assert(seen.every((s) => /^\s*SELECT/i.test(s)), `全部为 SELECT（零写；实测非 SELECT ${seen.filter((s) => !/^\s*SELECT/i.test(s)).length} 条）`);
}

// ==================================================== ⑤ TC-D-M4-006 MD-12 外键反例
console.log("\n⑤ TC-D-M4-006 · `MD-12 research_proposal.opportunity_id` 外键：指向不存在的机会须被库级拒绝");
{
  const { sqlite, db } = freshDb();
  const bad = db.prepare(
    "INSERT INTO research_proposal (proposal_id, opportunity_id, goal_version_no, research_question, " +
    "behavior_hypothesis, population_limit, idempotency_key, submitted_at, submitted_by, triggered_task_id) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)"
  ).bind("PROP-BAD-FK", "OPP-NOPE", 3, "研究问题", null, null, "prop-bad-fk", "2026-09-19 10:00", "PM").run();
  assert(bad.success === false && /FOREIGN KEY/i.test(bad.error || ""), `机会不存在 → FK 拒绝（实测「${bad.error}」）`);
  assert(countRows(sqlite, "research_proposal") === 0, "反例未留下半截行（行数仍 0）");

  // 应用层同步守卫：F-03 写入面对不存在机会也报错（库级 + 应用层双保险）
  await assertThrows(() => submitProposal(db, { opportunity_id: "OPP-NOPE", research_question: "q", submitted_by: "PM" }),
    "写入面：机会不存在 → 报错（应用层守卫）", "机会不存在");
}

// ==================================================== ⑥ 静态核验（零外部调用 / 零写库 / 零裸 SQL / 依赖面）
console.log("\n⑥ 静态核验 · research-start.js 零外部调用 / 零写语句 / 零裸 SQL / 复用 F-18 口径与 shared-context 读面");
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  const writes = src.match(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/gi) || [];
  assert(writes.length === 0, `零写语句（实测 ${writes.length} 条）`);
  const selects = src.match(/\bSELECT\b/gi) || [];
  assert(selects.length === 0, `零裸 SQL（SELECT 实测 ${selects.length} 条）`);
  const specs = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(specs.length === 2, `import 恰 2 条（实测 ${specs.join(", ") || "无"}）`);
  assert(specs.includes("./role.js"), "复用 F-18 `./role.js` 的假设性质标注口径（不复制第二份）");
  assert(specs.includes("../shared-context/index.js"), "复用 shared-context 读面");
  assert(!specs.some((s) => /node:sqlite|node:fs|tool-executor|task-runner/.test(s)),
    "不依赖 node:sqlite / node:fs / M5 / task-runner（只读编排层）");
  assert(!/createHvaResearchTask|createDiscoveryTask|executeQuery|runQueryWithRecovery/.test(src),
    "不触发建任务 / 查询执行入口（编排层不越界）");
  assert(/labelProductHypothesis/.test(src), "假设标注确实委托给 F-18（写面/口径收敛可静态核对）");
}

finish();
