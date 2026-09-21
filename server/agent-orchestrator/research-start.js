/**
 * 文档卡（阶段4 · M4 · F-19 研究起点处理 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md（F-19 研究起点处理：先判断问题是否适合开展 HVA 研究；三种起点 ① 有候选行为假设 → 检查假设对应人群/行为/结果，**产品假设不预先作为研究结论** ② 只有研究问题 → 寻找候选行为再比较查证，**允许找不到有足够依据的候选行为** ③ 问题不适合或缺少关键行为依据 → 说明问题、已有发现与 HVA 判断限制，**不硬归结为关键行为**｜§1.1.3 S-B1 研究任务调度：输入＝二阶段注入清单，动作＝判断适合性 → 定比较条件 → 排查证顺序，输出＝研究计划，**停止＝路径确定**｜§4 红线 1/2）
 *   ｜ ../../docs/05-test-cases/test-M4.md（**TC-A-M4-001**（L4·F-19：S-B1 二阶段注入清单（机会及版本/产品问题/可选假设/证据/历史）→ 三分支，路径确定后停止，产品假设不预先作为结论）｜
 *        **TC-I-M4-003**（L5·F-19：适合性判断，不适合时说明限制而非硬做——⚠️待确认(§7-T21)，故适合性判据做成**可注入 + 可扩展**结构，**不硬编码「恰好 N 个信号」**）｜
 *        **TC-D-M4-006**（L3·F-19：MD-12 `opportunity_id='OPP-NOPE'` FK 反例）｜
 *        **TC-I-M4-002**（L5·F-18/F-20：查询链路经 M5 只读、不调生产写——本文件零外部调用、零写库））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-19（三种起点与保留判断＝验收要点）｜ §5.2 out of scope｜ §5.3 硬红线｜ §6 术语口径（候选行为；人工节点）｜ §7 第 4 条（运行失败不作为否定研究的依据）
 *   ｜ ../../docs/03-locks/schema.md（MD-12 research_proposal：研究问题必需、假设与人群限制可选、`idempotency_key` UK、`opportunity_id` FK→MD-06｜MD-07 research｜MD-02 research_goal_version）
 *   ｜ ../../docs/03-locks/external-deps.md（**A-1 LLM ⬜ 未提供（最大风险）——F-19 的「问题是否适合 HVA 研究」判断须 LLM**；F-19 本体属「本系统自造」（§3 表 L87）｜T-21 未关）
 *   ｜ ../../docs/04-plan/dev-plan.md（阶段4 · M4：F-19 三分支起点）
 *   ｜ ./role.js（**F-18 复用**：`labelProductHypothesis` 假设性质标注——假设「不预设结论」的真源，本文件不复制第二份）
 *   ｜ ../shared-context/index.js（读面复用：`getTaskContext` / `listResearch`）
 * 职责：F-19 研究起点处理——把「二阶段注入清单」转成**研究路径选择 + 研究计划**（S-B1），并把三分支做成确定性路由。
 * 硬红线：① **零外部调用**（不发起 HTTP / 不调 LLM——A-1 门禁只挡推理，本文件以确定性路由 + 可注入判据推进）；
 *   ② **零写库、零裸 SQL**（本文件所有导出均为纯计算或读面复用，不含改行/删行类语句、也不含 SELECT）；
 *   ③ **不复制第二个口径**：假设性质标注复用 F-18 `labelProductHypothesis`；比较条件三项与五查顺序只持键名与来源回指，叙述文本真源在子 PRD；
 *   ④ 两条红线做成**可运行判据**而非注释：「产品假设不预先作为结论」「允许找不到有足够依据的候选行为（＝合法完整结果）」。
 * 边界：只做 F-19（适合性判断 + 三分支路由 + 比较条件 + 查证顺序 + 薄读注入清单）；
 *   F-20 五查取数与「缺比较条件退回请补」的完整流程、F-21 七要素组装、F-22 追问承接不在本文件。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f19.mjs）。
 *
 * 用法：import { judgeResearchSuitability, assembleResearchStart, resolveComparisonConditions, assembleResearchCheckSequence, loadResearchStartContext } from "./research-start.js";
 */
import { labelProductHypothesis } from "./role.js";
import { getTaskContext, listResearch } from "../shared-context/index.js";

/**
 * 三种起点（BRD §4 F-19 / PRD-M4 F-19）——本文件只持**路径键**，叙述文本真源在 BRD/PRD。
 */
export const RESEARCH_PATHS = Object.freeze({
  VERIFY_HYPOTHESIS: "verify_hypothesis", // ① PM 提供候选行为假设 → 检查假设对应的人群、行为与结果
  FIND_CANDIDATE: "find_candidate", // ② 只有研究问题 → 寻找候选行为再比较查证
  STATE_LIMITATION: "state_limitation", // ③ 问题不适合或缺少关键行为依据 → 说明问题与判断限制
});

/**
 * 比较条件三要素（PRD-M4 F-20：「比较条件（涉及哪些用户、观察哪个阶段、什么结果口径）随分析保存」）。
 * 只持键名 / 标题 / 来源回指——**不复制叙述文本**。
 */
export const COMPARISON_CONDITION_KEYS = Object.freeze([
  { key: "audience", title: "涉及哪些用户", source_hint: "MD-12 population_limit ／ MD-06 target_object（涉及对象）" },
  { key: "observation_stage", title: "观察哪个阶段", source_hint: "MD-02 focus_period ／ MD-06 target_object（旅程环节）" },
  { key: "result_metric", title: "什么结果口径", source_hint: "MD-02 metric_definition ／ MD-12 research_question（结果口径）" },
]);

/**
 * 排查证顺序模板（S-B1 动作第三段「排查证顺序」）——**按 F-20 五查的顺序**排列，确定性、无随机。
 * `data_source` 只填**来源系统代号**（与 CFG-01 `source_registry.source_id` 同域）；具体工具契约的真源在 `external-deps.md` §5，
 * 本文件**不内联工具名**（避免出现第二个口径）。
 */
export const RESEARCH_CHECK_SEQUENCE = Object.freeze([
  {
    check_key: "population_comparability",
    check_item: "人群是否有可比基础",
    data_sources: ["CDP"],
    reason: "先确认两组人群的原有特征与表现差别是否已解释，未解释则须限制行为作用判断",
  },
  {
    check_key: "temporal_order",
    check_item: "行为与结果的先后关系",
    data_sources: ["HJE"],
    reason: "行为须发生在所讨论的后续表现之前，不能把已发生的结果当行为影响",
  },
  {
    check_key: "metric_alignment",
    check_item: "结果是否对应业务目标（口径一致）",
    data_sources: [],
    reason: "结果口径须与目标版本登记的口径一致，口径不一方可比较",
  },
  {
    check_key: "alternative_explanations",
    check_item: "是否存在其他解释（商品、活动、权益等业务条件）",
    data_sources: ["PIM", "MKT", "ACT"],
    reason: "商品结构、权益发放与活动存在都可能是替代解释，须逐项排查而非默认无关",
  },
  {
    check_key: "information_sufficiency",
    check_item: "信息是否足以支持判断",
    data_sources: [],
    reason: "缺关键依据时说明缺口，不给确定判断（缺口如实登记，不用系统名称代替证据）",
  },
]);

/** 路径确定即停止（S-B1 停止条件「路径确定」）。 */
export const STOP_CONDITION = "路径确定即停止（S-B1 停止：路径确定；后续取数由 F-20 承接）";

const DEFAULT_SUITABILITY_NOTE =
  "A-1（LLM 推理服务）当前未提供，无法做出「问题是否适合 HVA 研究」的语义判断；" +
  "按「适合」继续路由，不硬下「不适合」结论，也不硬做（该判断受 A-1 门禁，登记为「门禁未关闭、非发布门禁」）。";

const LIMITATION_NOTE =
  "问题不适合开展 HVA 研究或缺少关键行为依据时，说明问题、已有发现与 HVA 判断限制即可（PRD-M4 F-19 ③），" +
  "**不硬归结为关键行为**，也不把服务体验类问题强行转成行为研究。";

const NO_CANDIDATE_NOTE =
  "允许找不到有足够依据的候选行为（PRD-M4 F-19 ②）——未找到足够依据支持候选 HVA 也是完整结果，不是失败。";

const HYPOTHESIS_NOT_CONCLUSION_NOTE =
  "产品假设不预先作为研究结论（PRD-M4 F-19 ①／红线 2）：假设须经候选行为检验后才可能成为研究发现。";

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";
const textOrNull = (v) => (isNonEmptyText(v) ? String(v).trim() : null);

/**
 * 适合性判断（PRD-M4 F-19 首句「先判断问题是否适合开展 HVA 研究」／TC-I-M4-003）。
 * **可注入 + 可扩展**：语义判断须 LLM（A-1），调用方可传 `suitability` 覆盖；未传时走**确定性 fallback**
 * （`suitable=true`、标 `llm_gated=true`），**不硬造「不适合」**。
 * @param {object} input { research_question, suitability?: { suitable, reason, signals? } }
 * @returns {{ suitable:boolean, source:string, llm_gated:boolean, reason:string, signals:Array, note:string }}
 */
export function judgeResearchSuitability(input) {
  const p = input && typeof input === "object" ? input : {};
  const question = textOrNull(p.research_question);
  if (!question) throw new Error("适合性判断必填：research_question 不能为空（MD-12 研究问题为必需项）");

  const given = p.suitability;
  if (given && typeof given === "object" && typeof given.suitable === "boolean") {
    const signals = Array.isArray(given.signals) ? given.signals.filter((s) => isNonEmptyText(s)) : [];
    return {
      suitable: given.suitable,
      source: "provided",
      llm_gated: true,
      reason: textOrNull(given.reason) || (given.suitable ? "由上游语义判断给出：适合开展 HVA 研究。" : "由上游语义判断给出：不适合开展 HVA 研究。"),
      signals,
      note: given.suitable ? "按「适合」进入候选行为路径。" : LIMITATION_NOTE,
    };
  }
  if (given !== undefined && given !== null && (typeof given !== "object" || typeof given.suitable !== "boolean")) {
    throw new Error("适合性判断入参不合法：suitability 若提供须为含布尔 suitable 的对象（不静默忽略）");
  }

  return {
    suitable: true,
    source: "default_no_llm",
    llm_gated: true,
    reason: "未提供语义判断，按「适合」继续路由（不硬下「不适合」结论）。",
    signals: [],
    note: DEFAULT_SUITABILITY_NOTE,
  };
}

/**
 * 比较条件装配（S-B1 动作第二段「定比较条件」）。
 * 三项（涉及哪些用户 / 观察哪个阶段 / 什么结果口径）**能定则定、缺则如实登记缺项**（不编造、不静默回退）。
 * @param {object} input { comparison_conditions?, population_limit?, focus_period?, metric_definition?, research_question? }
 * @returns {{ conditions:object, missing:string[], declared:boolean, note:string }}
 */
export function resolveComparisonConditions(input) {
  const p = input && typeof input === "object" ? input : {};
  const explicit = p.comparison_conditions && typeof p.comparison_conditions === "object" ? p.comparison_conditions : {};
  const conditions = {
    audience: textOrNull(explicit.audience) || textOrNull(p.population_limit),
    observation_stage: textOrNull(explicit.observation_stage) || textOrNull(p.focus_period),
    result_metric: textOrNull(explicit.result_metric) || textOrNull(p.metric_definition),
  };
  const missing = COMPARISON_CONDITION_KEYS.filter((c) => !conditions[c.key]).map((c) => c.key);
  return {
    conditions,
    missing,
    declared: missing.length === 0,
    note: missing.length === 0
      ? "比较条件三项已定，随分析一并保存（PRD-M4 F-20）。"
      : `比较条件缺 ${missing.length} 项（${missing.join("、")}）——如实登记为缺口，由 F-20 取数前补齐，不编造。`,
  };
}

/**
 * 来源代号归一（接受 `source_id` 字符串，或 CFG-01 `source_registry` 行取 `source_id`）——**唯一一份**：
 * 查证顺序过滤与「按可用来源过滤」（F-38）共用它，不复制第二个解析口径。形态不认识的值一律忽略。
 */
function normalizeSourceCodes(list) {
  return Array.isArray(list)
    ? list
        .map((s) => {
          if (typeof s === "string") return s.trim();
          if (s && typeof s === "object" && typeof s.source_id === "string") return s.source_id.trim();
          return null;
        })
        .filter((s) => s)
    : [];
}

/**
 * 排查证顺序（S-B1 动作第三段）。
 * @param {Array<string|object>} only 可选：只保留命中这些来源系统的步骤——接受来源代号字符串，或 CFG-01 `source_registry` 行（取 `source_id`）；
 *   不含来源的步骤（口径校验 / 信息充分）恒保留。未传 / 空 → 不过滤。
 * @param {object} [opts] `allowEmpty`（默认 `false`）：显式传入**空数组**时，是否视为「一个来源都不可用」。
 *   既有口径（`[]`＝不过滤）**保持不变**；F-38 的「按可用来源过滤」需要「可用清单为空 ⇒ 只剩无来源步骤」这一语义，
 *   故由调用方显式开启——不把既有的「空＝不过滤」静默改掉。
 * @returns {Array<object>} 每项 { step_no, check_key, check_item, data_sources, reason, stop_when_enough }
 */
export function assembleResearchCheckSequence(only, { allowEmpty = false } = {}) {
  const codes = normalizeSourceCodes(only);
  const filter = codes.length > 0 ? codes : (allowEmpty && Array.isArray(only) ? [] : null);
  const steps = RESEARCH_CHECK_SEQUENCE.filter((s) => {
    if (!filter) return true;
    if (s.data_sources.length === 0) return true;
    return s.data_sources.some((d) => filter.includes(d));
  });
  return steps.map((s, i) => ({
    step_no: i + 1,
    check_key: s.check_key,
    check_item: s.check_item,
    data_sources: s.data_sources.slice(),
    reason: s.reason,
    stop_when_enough: i === steps.length - 1
      ? "五查全部完成，或因缺少关键依据而明确说明缺口后停止"
      : "本步已能支撑判断时，可进入下一步；依据不足则记录缺口、不硬下结论",
  }));
}

/**
 * S-B1 研究任务调度（TC-A-M4-001 主入口）：二阶段注入清单 → **研究路径选择 + 研究计划**。
 * 路由（确定性，优先级从高到低）：
 *   ③ 适合性判定为「不适合」→ `state_limitation`（说明限制而非硬做）；
 *   ① 有候选行为假设 → `verify_hypothesis`（检查假设对应的人群、行为与结果；**假设不预先作为结论**）；
 *   ② 只有研究问题 → `find_candidate`（寻找候选行为再比较查证；**允许找不到有足够依据的候选行为**）。
 * 停止：**路径确定即停止**（`stopped=true`）。
 * @param {object} injection { research_question, behavior_hypothesis?, population_limit?, opportunity?, goal?, evidence?, history?, comparison_conditions?, suitability?, sources? }
 * @returns {object}
 */
export function assembleResearchStart(injection) {
  const p = injection && typeof injection === "object" ? injection : null;
  if (!p) throw new Error("研究起点处理必填：入参（二阶段注入清单）须为对象");
  const question = textOrNull(p.research_question);
  if (!question) throw new Error("研究起点处理缺必填项：research_question（研究问题为 MD-12 必需字段）");

  const hypothesisText = textOrNull(p.behavior_hypothesis);
  const evidence = Array.isArray(p.evidence) ? p.evidence.filter((e) => e) : [];
  const history = Array.isArray(p.history) ? p.history.filter((h) => h) : [];

  const suitability = judgeResearchSuitability({ research_question: question, suitability: p.suitability });

  // —— 路径路由（③ 优先：不适合就不进入候选行为路径） ——
  let path;
  let path_reason;
  if (suitability.suitable === false) {
    path = RESEARCH_PATHS.STATE_LIMITATION;
    path_reason = `适合性判定为「不适合开展 HVA 研究」：${suitability.reason}${LIMITATION_NOTE}`;
  } else if (hypothesisText) {
    path = RESEARCH_PATHS.VERIFY_HYPOTHESIS;
    path_reason = "PM 提供了候选行为假设：按起点①检查假设对应的人群、行为与结果；" + HYPOTHESIS_NOT_CONCLUSION_NOTE;
  } else {
    path = RESEARCH_PATHS.FIND_CANDIDATE;
    path_reason = "只有研究问题、未提供候选行为假设：按起点②根据问题与可获得的行为信息寻找候选行为再比较查证；" + NO_CANDIDATE_NOTE;
  }

  const comparison = resolveComparisonConditions({
    comparison_conditions: p.comparison_conditions,
    population_limit: p.population_limit,
    focus_period: p.focus_period,
    metric_definition: p.metric_definition,
    research_question: question,
  });

  // —— 来源可用性过滤（F-38）：计划只用「已声明 且 当前可用」的来源 ——
  // `available_sources` 由调用方注入（读面：`CFG-02 tool_registry.is_enabled=1` 的工具所属来源）；未注入 → 口径不变（不过滤）。
  // 硬边界（如实登记）：此处只按「该来源有无已启用工具」判可用；更细的权限 / 接入态仍由 M5 前置守卫兜底。
  const sources_declared = normalizeSourceCodes(p.sources);
  const sources_available = Array.isArray(p.available_sources) ? normalizeSourceCodes(p.available_sources) : null;
  const baseFilter = sources_declared.length > 0 ? sources_declared : null;
  const filter = sources_available === null
    ? baseFilter
    : (baseFilter === null ? sources_available : baseFilter.filter((c) => sources_available.includes(c)));
  const allowed = filter === null ? null : new Set(filter);
  // **逐步骤收窄 `data_sources`**（不只是丢步骤）：某步只要还剩可用来源就保留，但计划里不得残留不可用来源——
  // 否则执行体按 `step.data_sources` 取数时仍会打到未接入的来源，M4 一动手就被 F-26 受阻。
  const checks = assembleResearchCheckSequence(filter, { allowEmpty: sources_available !== null }).map((s) => ({
    ...s,
    data_sources: allowed ? s.data_sources.filter((d) => allowed.has(d)) : s.data_sources.slice(),
    excluded_sources: allowed ? s.data_sources.filter((d) => !allowed.has(d)) : [],
  }));
  const usedSources = new Set(checks.flatMap((s) => s.data_sources));
  const plan_excluded_sources = [...new Set(RESEARCH_CHECK_SEQUENCE.flatMap((s) => s.data_sources))]
    .filter((c) => !usedSources.has(c))
    .map((c) => ({
      source_id: c,
      reason: [
        sources_available !== null && !sources_available.includes(c)
          ? "来源未启用（该来源无任何已启用工具；M5 前置守卫会判 source_unavailable）"
          : null,
        baseFilter !== null && !baseFilter.includes(c) ? "未在注入清单声明" : null,
      ].filter(Boolean).join("；"),
    }));
  const keptChecks = new Set(checks.map((s) => s.check_key));
  const plan_excluded_checks = RESEARCH_CHECK_SEQUENCE.filter((s) => !keptChecks.has(s.check_key)).map((s) => ({
    check_key: s.check_key,
    check_item: s.check_item,
    reason: "该步的来源全部不可用（未启用或未声明），本轮不安排取数；缺口如实登记，不静默丢弃",
  }));
  const availability_note = sources_available === null
    ? "未提供可用来源清单 → 计划不按启用面过滤（口径不变）；实际取数时若来源未启用，仍由 M5 前置守卫处置并留痕。"
    : (plan_excluded_sources.length === 0
        ? "计划内每一步的来源均在可用清单内。"
        : `已按可用来源过滤，排除 ${plan_excluded_sources.map((x) => x.source_id).join("、")}（原因见 plan_excluded_sources）——排除项如实登记、不静默丢弃；更细的权限 / 接入态仍由 M5 前置守卫兜底。`);

  // 路径专属首步（把起点差异落到计划里，而不是只写在 reason 里）
  const leadSteps = [];
  if (path === RESEARCH_PATHS.VERIFY_HYPOTHESIS) {
    const labeled = labelProductHypothesis(hypothesisText);
    leadSteps.push({
      step_no: 1,
      check_key: "hypothesis_check",
      check_item: "检验 PM 提供的候选行为假设（对应的人群、行为与结果）",
      data_sources: [],
      reason: "假设须被检验而非被采纳——" + labeled.note,
      stop_when_enough: "假设的三段对应关系（人群 / 行为 / 结果）均已检查并给出保留判断",
    });
  } else if (path === RESEARCH_PATHS.FIND_CANDIDATE) {
    leadSteps.push({
      step_no: 1,
      check_key: "candidate_search",
      check_item: "根据研究问题与可获得的行为信息寻找候选行为",
      data_sources: [],
      reason: "无假设时先找候选行为再比较查证；" + NO_CANDIDATE_NOTE,
      stop_when_enough: "找到可供比较查证的候选行为，或确认找不到有足够依据的候选行为（后者亦为完整结果）",
    });
  }

  let plan;
  let limitation = null;
  let hypothesis = null;
  if (path === RESEARCH_PATHS.STATE_LIMITATION) {
    plan = [
      {
        step_no: 1,
        check_key: "state_problem",
        check_item: "说明问题与已有发现",
        data_sources: [],
        reason: `研究问题「${question}」当前的判断限制：${suitability.reason}`,
        stop_when_enough: "问题、已有发现与判断限制均已写明",
      },
      {
        step_no: 2,
        check_key: "state_limitation",
        check_item: "说明 HVA 判断的限制（必要时只说明障碍与改善方向）",
        data_sources: [],
        reason: LIMITATION_NOTE,
        stop_when_enough: "限制说明完整，不硬归结为关键行为",
      },
    ];
    limitation = {
      problem: question,
      existing_findings_count: evidence.length,
      existing_findings: evidence.map((e) => (e && typeof e === "object" ? (e.finding_text || e.evidence_id || null) : null)).filter(Boolean),
      hva_limit: suitability.reason,
      hard_run: false,
      note: LIMITATION_NOTE,
    };
  } else {
    hypothesis = hypothesisText ? labelProductHypothesis(hypothesisText) : null;
    plan = [...leadSteps, ...checks].map((s, i) => ({ ...s, step_no: i + 1 }));
  }

  return {
    research_question: question,
    path,
    path_reason,
    suitability,
    hypothesis,
    hypothesis_not_conclusion: true,
    hypothesis_is_conclusion: false,
    comparison_conditions: comparison.conditions,
    comparison_conditions_missing: comparison.missing,
    comparison_conditions_declared: comparison.declared,
    comparison_conditions_note: comparison.note,
    // —— 来源可用性（F-38）：计划只用「已声明 且 可用」的来源，排除项如实登记 ——
    sources_declared,
    sources_available,
    plan_source_filter: filter === null ? null : filter.slice(),
    plan_excluded_sources,
    plan_excluded_checks,
    availability_note,
    evidence_order: checks.map((s) => s.check_key),
    plan,
    plan_step_count: plan.length,
    allow_no_candidate: path === RESEARCH_PATHS.FIND_CANDIDATE,
    complete_result_possible: true,
    limitation,
    stop_condition: STOP_CONDITION,
    stopped: true,
    inputs_used: {
      evidence_count: evidence.length,
      history_count: history.length,
      has_hypothesis: Boolean(hypothesisText),
      has_population_limit: Boolean(textOrNull(p.population_limit)),
      has_opportunity: Boolean(p.opportunity),
      has_goal: Boolean(p.goal),
    },
    notes: {
      hypothesis_not_conclusion: HYPOTHESIS_NOT_CONCLUSION_NOTE,
      no_candidate_is_complete: NO_CANDIDATE_NOTE,
      limitation_is_legal: LIMITATION_NOTE,
      llm_gated: DEFAULT_SUITABILITY_NOTE,
    },
  };
}

/**
 * 薄读函数：装配 F-19 的「二阶段注入清单」（机会及版本 / 产品问题 / 可选假设 / 证据 / 历史），
 * **复用 shared-context 读面**（`getTaskContext` / `listResearch`），**本文件不新增写面、不写库**。
 * 清单取自任务上下文 `sections`（CFG-06 `hva_research` 模板：goal / background / source / selected_opp /
 * product_question / existing_evidence），历史研究另按机会从 MD-07 现读。
 * @param {object} db D1 形态（prepare().bind().all()/first()）
 * @param {string} task_id
 * @returns {Promise<object>}
 */
export async function loadResearchStartContext(db, task_id) {
  if (!isNonEmptyText(task_id)) throw new Error("装配二阶段注入清单必填：task_id 不能为空");
  const ctx = await getTaskContext(db, task_id);
  const sections = Array.isArray(ctx.sections) ? ctx.sections : [];
  const section = (code) => sections.find((s) => s.context_type_code === code) || null;
  const items = (code) => {
    const s = section(code);
    return s && Array.isArray(s.items) ? s.items : [];
  };

  const goalItem = items("goal")[0] || null;
  const oppItem = items("selected_opp")[0] || null;
  const qItem = items("product_question")[0] || null;
  const evidenceItems = items("existing_evidence");
  const opportunity = oppItem ? oppItem.opportunity : null;

  const history = opportunity
    ? await listResearch(db, { opportunity_id: opportunity.opportunity_id })
    : [];

  return {
    task_id: ctx.task_id,
    task_type: ctx.task_type,
    goal_id: ctx.goal_id,
    goal_version_no: ctx.goal_version_no,
    goal: goalItem ? goalItem.goal : null,
    goal_version: goalItem ? goalItem.version : null,
    opportunity,
    six_elements: oppItem ? oppItem.six_elements : null,
    proposal: qItem ? qItem.proposal : null,
    research_question: qItem ? qItem.proposal.research_question : null,
    behavior_hypothesis: qItem ? qItem.proposal.behavior_hypothesis : null,
    population_limit: qItem ? qItem.proposal.population_limit : null,
    evidence: evidenceItems.map((e) => e.evidence),
    history,
    background: items("background").map((b) => b.background),
    sources: items("source").map((s) => s.source),
    context_complete: ctx.complete === true,
    missing_required: Array.isArray(ctx.missing_required) ? ctx.missing_required : [],
    injections: Array.isArray(ctx.injections) ? ctx.injections : [],
  };
}
