/**
 * 文档卡（阶段4 · M4 · F-20 人群比较与行为关系检验 · 编排本体 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md（**F-20 候选行为五查**：① 人群是否有可比基础（原有特征与表现差别未解释时，限制行为作用判断）② 行为与结果的先后关系（行为须发生在所讨论的后续表现之前，不能把已发生的结果当行为影响）③ 结果是否对应业务目标（口径一致）④ 是否存在其他解释（商品、活动、权益等业务条件）⑤ 信息是否足以支持判断（缺关键依据时说明缺口，不给确定判断）；比较条件（涉及哪些用户、观察哪个阶段、什么结果口径）随分析保存｜§1.1 S-B2 人群可比性检查（停止＝两组人群可比性明确）／S-B3 候选行为检验（停止＝五查完成或信息缺口已说明）｜§4 红线 3「因果不臆断：行为与较好表现同时出现 ≠ 因果；活动存在 ≠ 用户参与」｜§4 红线 1 术语口径「研究完成前一律称候选行为」）
 *   ｜ ../../docs/05-test-cases/test-M4.md（**TC-U-M4-001**（L1：`composite_raw=0.62`/`pool_threshold=0.6` → `in_pool=true`；`0.55` → `false`；确定性无随机）｜
 *        **TC-A-M4-002**（L4·F-20①：S-B2 取人群特征与原有表现 → 检查差异是否已解释 → 可比性结论＋限制——⚠️待确认(§7-T03)）｜
 *        **TC-A-M4-003**（L4·F-20②③④⑤：S-B3 确认先后关系 → 对齐观察阶段取数 → 查商品/活动/权益等其他解释；**倒挂隔离**：信息时点晚于取数时刻的**仅该条失效**、非整包失败——⚠️待确认(§7-T03/T08/T10)）｜
 *        **TC-A-M4-006**（L4·F-20：**边界·missing-field**——输出缺比较条件 → **退回**请补，不静默回退）｜
 *        **TC-D-M4-003 / TC-D-M4-004**（L3：MD-09 外键 / MD-10 复合 UK——落库路径在 ./behavior-store.js）｜
 *        **TC-I-M4-002**（L5·F-18/F-20：查询链路经 M5 **只读**、不调生产写））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-20（验收要点：行为与较好表现同时出现 ≠ 因果；某活动存在只证明有活动信息，用户是否参与、受何影响需对应记录）｜ §5.3 硬红线｜ §7 第 4 条（运行失败不作为否定研究的依据）
 *   ｜ ../../docs/03-locks/schema.md（MD-09 candidate_behavior（行为名称 + 支持情况，**改名只发生在状态列**）｜MD-10 behavior_point（支持 / 不支持并列成行，**不支持也是完整合法产出**）｜CFG-05 gap_rule）
 *   ｜ ../../docs/03-locks/external-deps.md（**F-20 是全平台对外部依赖最脆弱的功能点**：12 工具中 11 个的 `blocks_features` 含 F-20；五查每查需不同系统  五系统缺口＝CDP/HJE 仅聚合无用户级明细、PIM/MKT 商品与权益条件、ACT 仅有报名信息无参与明细（TOL-12 ❌ 不存在）｜§7 **T-03/T-08/T-10 未关**、T-21 未关）
 *   ｜ ../../docs/04-plan/dev-plan.md（阶段4 · M4：F-20 候选行为五查，最脆弱功能点）
 *   ｜ ./behavior-store.js（**F-20 写入面**：MD-09/MD-10，本文件零写语句、落库一律经它）
 *   ｜ ./research-start.js（**F-19 复用**：`RESEARCH_CHECK_SEQUENCE`＝五查顺序与条目文案的**唯一真源**；`resolveComparisonConditions`＝比较条件三项的唯一口径）
 *   ｜ ./verification.js（**F-15 复用**：`runMetricVerification`＝经 M5 真实查询的唯一出口；`isolateContradictedEvidence`＝倒挂隔离口径；`parseStamp`＝时点抽取——均不复制第二份）
 * 职责：F-20 人群比较与行为关系检验——S-B2 人群可比性 + S-B3 候选行为五查，并把「因果不臆断」「未支持也是完整结果」「失败不否定结论」做成**可运行判据**。
 * 硬红线：① **零外部调用**（不 fetch、不调 LLM——语义类判断受 A-1 门禁，做成可注入判据 + 确定性 fallback）；
 *   ② **零写语句、零裸 SQL**（本文件不含任何改行 / 删行类语句，也不含 SELECT；落库一律经 `./behavior-store.js`，取号走该文件的读面返回的全量自算）；
 *   ③ **不复制第二个口径**：五查顺序与条目文案复用 F-19 `RESEARCH_CHECK_SEQUENCE`；比较条件复用 F-19 `resolveComparisonConditions`；查询与倒挂复用 F-15；
 *   ④ 四条红线做成**判据**而非注释：因果不臆断（`causal_claim_allowed` 恒 false）、活动存在 ≠ 用户参与（`existence_only` 不得计为已排除）、
 *     未支持亦为完整结果（`complete_result=true` / `is_failure=false`）、失败不否定结论（`due_to_failure` 的条目不得作否定依据、改记缺口）。
 * 边界：只做 F-20（入池筛选 + 人群可比性 + 五查 + 缺比较条件守卫 + 候选行为落库）；F-21 七要素组装与改善方向、F-22 追问承接不在本文件。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 `../api/index.js` 与 CI `validate` 步骤复用（node server/agent-orchestrator/test-f20.mjs）。
 *
 * 用法：import { judgePoolThreshold, checkPopulationComparability, runBehaviorChecks, evaluateComparisonGate, assembleBehaviorVerification, formCandidateBehavior, queryForBehaviorCheck, nextCandidateId, nextBehaviorPointId } from "./behavior.js";
 */
import {
  runMetricVerification,
  isolateContradictedEvidence,
  parseStamp,
} from "./verification.js";
import { RESEARCH_CHECK_SEQUENCE, resolveComparisonConditions } from "./research-start.js";
import {
  createCandidateBehavior,
  appendBehaviorPoint,
  listCandidateBehaviors,
  listBehaviorPoints,
} from "./behavior-store.js";

/**
 * 五查键序＝**F-19 `RESEARCH_CHECK_SEQUENCE` 派生**（单一真源，不复制第二份清单）。
 * ① population_comparability ② temporal_order ③ metric_alignment ④ alternative_explanations ⑤ information_sufficiency。
 */
export const BEHAVIOR_CHECK_KEYS = Object.freeze(RESEARCH_CHECK_SEQUENCE.map((s) => s.check_key));

/** 入池边界口径：**闭区间**（等于阈值即入池）——确定性、无随机（TC-U-M4-001）。 */
export const POOL_BOUNDARY = "inclusive";

/** 四查「其他解释」须逐个排查的业务条件维度（PRD-M4 F-20④：商品、活动、权益）。 */
export const ALTERNATIVE_DIMENSIONS = Object.freeze(["product", "activity", "benefit"]);

/** 候选行为支持情况两态（值域真源＝`dict:BEHAVIOR_STATUS`，此处只持键名，不内联中文枚举）。 */
export const BEHAVIOR_STATUS = Object.freeze({ SUPPORTED: "candidate_supported", NOT_SUPPORTED: "not_supported" });

/** 条目立场两态（值域真源＝`dict:BEHAVIOR_POINT_TYPE`）。 */
export const BEHAVIOR_POINT_TYPE = Object.freeze({ SUPPORT: "support", UNSUPPORT: "unsupport" });

const STOP_CONDITION = "五查完成或信息缺口已说明（S-B3）";

const CAUSAL_NOTE =
  "观察到行为与较好表现同时出现 ≠ 因果（PRD-M4 §4 红线 3）：本轮为观察性比较、未做干预验证，" +
  "结论至多为「存在关联」，不得表述为「该行为导致 / 关键在于」。";

const NO_CANDIDATE_NOTE =
  "未找到足够依据支持候选 HVA 也是完整结果，不是失败（PRD-M4 F-21／F-19②）——" +
  "候选行为只在研究完成前称「候选」，未获支持时如实登记为「未找到足够依据支持」，不硬凑依据。";

const FAILURE_NOT_NEGATION_NOTE =
  "查询失败导致的未完成不能当否定结论（BRD §7 第 4 条）：由失败导致的条目转为**信息缺口**如实登记、" +
  "保留 warning、不静默丢弃，已有结论不被推翻。";

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";
const textOrNull = (v) => (isNonEmptyText(v) ? String(v).trim() : null);

/** 严数值化：`null`/`undefined`/`""`/布尔一律拒（`Number(null)` 会静默变 0，不可用于阈值判定）。 */
function numericOrThrow(v, label) {
  if (v === null || v === undefined || v === "" || typeof v === "boolean") {
    throw new Error(`${label} 须为数值（实测 ${JSON.stringify(v)}）`);
  }
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`${label} 须为有限数值（实测 ${JSON.stringify(v)}）`);
  return n;
}

/**
 * 综合分入池阈值（TC-U-M4-001）。候选行为筛选：`composite_raw ≥ pool_threshold` → 入池（进入五查）。
 * 纯计算、确定性、无随机；`pool_threshold` **不隐式取默认**（缺则报错）。
 * @param {object} input { composite_raw, pool_threshold }
 * @returns {{ in_pool:boolean, composite_raw:number, pool_threshold:number, margin:number, boundary:string, deterministic:boolean, note:string }}
 */
export function judgePoolThreshold(input) {
  const p = input && typeof input === "object" ? input : {};
  const raw = numericOrThrow(p.composite_raw, "入池判定必填：composite_raw");
  const threshold = numericOrThrow(p.pool_threshold, "入池判定必填：pool_threshold");
  const inPool = raw >= threshold;
  return {
    in_pool: inPool,
    composite_raw: raw,
    pool_threshold: threshold,
    margin: Number((raw - threshold).toFixed(6)),
    boundary: POOL_BOUNDARY,
    deterministic: true,
    note: inPool
      ? `综合分 ${raw} ≥ 阈值 ${threshold}（闭区间）→ 入池，进入候选行为五查。`
      : `综合分 ${raw} < 阈值 ${threshold} → 不入池；候选行为筛选到此为止，不进入五查（不硬凑依据）。`,
  };
}

/**
 * S-B2 人群可比性检查（TC-A-M4-002）。取人群特征与原有表现 → 检查差异是否已解释 → 可比性结论＋限制。
 * 语义判断（差异是否「已解释」是否成立）受 **T-03**（历史深度未定）与 **A-1**（LLM 未提供）门禁：
 * 可注入 `comparability={comparable,reason,signals}` 覆盖；未注入时按**差异清单的 `explained` 标记**做确定性推导；
 * **提供不了差异清单 → 可比性记为「无法明确」并限制行为作用判断**（不硬下「可比」结论）。
 * @param {object} input { candidate_group?, comparison_group?, features?, prior_performance?, differences?:Array, comparability?:object }
 * @returns {object}
 */
export function checkPopulationComparability(input) {
  const p = input && typeof input === "object" ? input : {};

  const given = p.comparability;
  if (given !== undefined && given !== null && (typeof given !== "object" || typeof given.comparable !== "boolean")) {
    throw new Error("人群可比性入参不合法：comparability 若提供须为含布尔 comparable 的对象（不静默忽略）");
  }

  const rawDiff = p.differences === undefined || p.differences === null ? [] : p.differences;
  if (!Array.isArray(rawDiff)) throw new Error("人群可比性入参不合法：differences 若提供须为数组");
  const differences = rawDiff.map((d) => {
    if (!d || typeof d !== "object" || !isNonEmptyText(d.feature)) {
      throw new Error("人群可比性差异项不合法：每项须为含非空 feature 的对象");
    }
    return {
      feature: String(d.feature).trim(),
      explained: d.explained === true,
      note: textOrNull(d.note),
    };
  });
  const unexplained = differences.filter((d) => d.explained !== true).map((d) => d.feature);

  const limits = [];
  let comparable;
  let source;
  let gated = false;
  let reason;

  if (given) {
    comparable = given.comparable;
    source = "provided";
    gated = true;
    reason = textOrNull(given.reason) || (given.comparable ? "由上游语义判断给出：两组人群可比基础成立。" : "由上游语义判断给出：两组人群可比基础不成立。");
  } else if (differences.length > 0) {
    comparable = unexplained.length === 0;
    source = "derived_from_differences";
    reason = comparable
      ? "差异清单内各项目均标记为「已解释」→ 原有特征与表现的差别已解释。"
      : `差异清单内有 ${unexplained.length} 项未解释（${unexplained.join("、")}）。`;
  } else {
    comparable = null;
    source = "undetermined";
    reason = "未提供人群特征与原有表现的差异清单，可比性无法明确。";
  }

  if (comparable !== true) {
    limits.push(
      "原有特征与表现差别未解释时，限制行为作用判断（PRD-M4 F-20①）——" +
        (comparable === false ? `未解释项：${unexplained.join("、") || "（由上游判定）"}` : "缺差异清单，无法确认差异是否已解释")
    );
  }
  return {
    check_key: "population_comparability",
    comparable,
    basis: source,
    gated,
    reason,
    candidate_group: textOrNull(p.candidate_group),
    comparison_group: textOrNull(p.comparison_group),
    features_count: Array.isArray(p.features) ? p.features.length : 0,
    prior_performance_declared: p.prior_performance !== undefined && p.prior_performance !== null,
    differences,
    unexplained,
    limits,
    restricts_behavior_judgement: comparable !== true,
    signals: given && Array.isArray(given.signals) ? given.signals.filter((s) => isNonEmptyText(s)) : [],
    stop_condition: "两组人群可比性明确（S-B2）",
    note:
      "可比性结论与限制一并输出；差异未解释时**限制行为作用判断**，不因「观察到差异」就认定行为作用。" +
      (gated ? "（本次可比性结论由上游语义判断注入，受 T-03/A-1 门禁。）" : ""),
  };
}

/**
 * S-B3 时间先后关系（五查②）。行为须发生在所讨论的后续表现之前，**不能把已发生的结果当行为影响**。
 * 倒挂（条目信息时点晚于取数时刻）复用 **F-15 `isolateContradictedEvidence`**——**仅该条失效、非整包失败**（TC-A-M4-003）。
 * @param {object} input { points:Array, at:string, behavior_at?, result_at? }
 * @returns {object}
 */
function checkTemporalOrder(input) {
  const p = input && typeof input === "object" ? input : {};
  const points = Array.isArray(p.points) ? p.points.filter((x) => x && typeof x === "object") : [];
  const at = textOrNull(p.at);
  if (!at) throw new Error("五查②必填：at（取数时刻——倒挂判定的基准）");
  const keyOf = (pt) => (pt.point_id !== undefined && pt.point_id !== null ? String(pt.point_id) : `idx:${pt._idx}`);

  const isolatedRes = isolateContradictedEvidence(points, { at });
  const isolated = isolatedRes.isolated;
  const kept = isolatedRes.kept;

  const gaps = [];
  const violations = [];
  for (const pt of kept) {
    if (textOrNull(pt.used_as) === "behavior_effect" && textOrNull(pt.stage) === "result") {
      violations.push({
        point_id: pt.point_id ?? null,
        point_ref: keyOf(pt),
        reason: "result_used_as_behavior_effect",
        note: "该条把已发生的结果当作行为影响，不成立（PRD-M4 F-20②）。",
      });
    }
  }

  const bStamp = parseStamp(p.behavior_at);
  const rStamp = parseStamp(p.result_at);
  let ordered;
  if (bStamp && rStamp) {
    ordered = bStamp < rStamp;
  } else {
    ordered = null;
    gaps.push({
      gap_key: "temporal_order_undetermined",
      detail: "行为时点或结果时点未标明（或文本中无可识别时点）——先后关系无法确认，不做先后判定。",
      affects: "行为与结果的先后关系",
    });
  }
  if (ordered === false) {
    gaps.push({
      gap_key: "result_not_after_behavior",
      detail: "所讨论的「后续表现」时点不晚于行为时点——不能把已发生的结果当行为影响。",
      affects: "行为与结果的先后关系",
    });
  }

  return {
    check_key: "temporal_order",
    ordered: violations.length > 0 ? false : ordered,
    behavior_at: bStamp,
    result_at: rStamp,
    kept_count: kept.length,
    isolated_count: isolated.length,
    isolated_points: isolated.map((i) => ({
      point_id: i.point_id ?? null,
      point_ref: keyOf(i),
      isolate_reason: i.isolate_reason,
      info_stamp: i.info_stamp ?? null,
    })),
    batch_failed: false,
    violations,
    gaps,
    note:
      "行为须发生在所讨论的后续表现之前，不能把已发生的结果当行为影响（PRD-M4 F-20②）；" +
      (isolated.length > 0
        ? `倒挂隔离：${isolated.length} 条条目的信息时点晚于取数时刻，**仅该条失效**、其余照常参与（非整包失败）。`
        : "无倒挂条目，全部照常参与。") +
      " 本处倒挂口径复用 F-15，不另立一套。",
  };
}

/** S-B3 口径一致性（五查③）。结果口径须与业务目标登记的口径一致，口径不一方可比较。 */
function checkMetricAlignment(input) {
  const p = input && typeof input === "object" ? input : {};
  const m = p.metric && typeof p.metric === "object" ? p.metric : {};
  const expected = textOrNull(m.expected);
  const observed = textOrNull(m.observed);
  const gaps = [];
  let aligned;
  if (expected && observed) {
    aligned = expected === observed;
    if (!aligned) {
      gaps.push({
        gap_key: "metric_mismatch",
        detail: `结果口径与目标版本登记口径不一致（登记「${expected}」，取数「${observed}」）——口径不一方可比较。`,
        affects: "结果是否对应业务目标",
      });
    }
  } else {
    aligned = null;
    gaps.push({
      gap_key: "metric_undeclared",
      detail: "结果口径未登记或未取到（含查不到已过审素材）——口径一致性无法确认，不做口径判定。",
      affects: "结果是否对应业务目标",
    });
  }
  return {
    check_key: "metric_alignment",
    aligned,
    expected_metric: expected,
    observed_metric: observed,
    gaps,
    note: "结果是否对应业务目标（口径一致）——口径不一方可比较（PRD-M4 F-20③）。",
  };
}

/**
 * S-B3 其他解释排查（五查④）。商品 / 活动 / 权益三类业务条件**逐个排查，不默认无关**。
 * 红线：**某活动存在只证明有活动信息**——`evidence_kind='existence_only'`（如活动报名清单）**不得计为已排除**；
 * 「无参与明细」的系统（`evidence_kind='none'`，对应 TOL-12 ❌ 不存在）同样不得据此排除。
 */
function checkAlternativeExplanations(input) {
  const p = input && typeof input === "object" ? input : {};
  const list = Array.isArray(p.alternatives) ? p.alternatives.filter((a) => a && typeof a === "object") : [];
  const checked = [];
  const excluded = [];
  const unexcluded = [];
  const gaps = [];

  for (const dim of ALTERNATIVE_DIMENSIONS) {
    const hit = list.find((a) => textOrNull(a.dimension) === dim) || null;
    if (!hit) {
      gaps.push({
        gap_key: `alt_${dim}_not_checked`,
        detail: `未排查「${dim}」维度的其他解释——不得默认无关（PRD-M4 F-20④）。`,
        affects: "是否存在其他解释",
      });
      unexcluded.push({ dimension: dim, reason: "not_checked", summary: null, note: "该维度未排查，不能视为已排除。" });
      checked.push({ dimension: dim, checked: false });
      continue;
    }
    const kind = textOrNull(hit.evidence_kind) || "none";
    const summary = textOrNull(hit.summary);
    checked.push({ dimension: dim, checked: true, evidence_kind: kind });
    if (kind === "participation" && hit.concluded_excluded !== false) {
      excluded.push({ dimension: dim, evidence_kind: kind, summary });
    } else if (kind === "existence_only") {
      unexcluded.push({
        dimension: dim,
        reason: "existence_only",
        summary,
        note: "某活动存在只证明有活动信息——用户是否参与、受何影响需对应记录（BRD §4 F-20 验收）。",
      });
    } else {
      unexcluded.push({
        dimension: dim,
        reason: kind === "none" ? "no_participation_record" : "insufficient_evidence",
        summary,
        note: "该系统只提供存在性 / 报名信息、无用户参与明细，不能据此排除（登记其不存在与登记工具本身同样重要）。",
      });
    }
  }

  for (const u of unexcluded) {
    if (u.reason === "not_checked") continue;
    gaps.push({
      gap_key: `alt_${u.dimension}_unexcluded`,
      detail: `「${u.dimension}」维度的替代解释未排除（${u.reason}）。`,
      affects: "是否存在其他解释",
    });
  }

  return {
    check_key: "alternative_explanations",
    checked,
    excluded,
    unexcluded,
    gaps,
    note:
      "商品、活动、权益等业务条件逐个排查；**排除只能靠参与侧记录**，存在性信息不足以排除。" +
      (unexcluded.length > 0 ? `未排除 ${unexcluded.length} 项，须写入限制说明。` : "三类维度均已排除。"),
  };
}

/**
 * S-B3 主入口：候选行为五查（TC-A-M4-003）。
 * 停止＝**五查完成或信息缺口已说明**（`stopped=true`）。
 * @param {object} input { at, population?, points?, behavior_at?, result_at?, metric?, alternatives?, gaps? }
 * @returns {object}
 */
export function runBehaviorChecks(input) {
  const p = input && typeof input === "object" ? input : {};
  const at = textOrNull(p.at);
  if (!at) throw new Error("候选行为五查必填：at（取数时刻——倒挂判定的基准）");

  const rawPoints = Array.isArray(p.points) ? p.points.filter((x) => x && typeof x === "object") : [];
  // 打稳定身份（point_id 缺失时用序号兜底），使「仅该条失效」可逐条核对
  const points = rawPoints.map((pt, i) => ({ ...pt, _idx: i }));
  const pointRef = (pt) => (pt.point_id !== undefined && pt.point_id !== null ? String(pt.point_id) : `idx:${pt._idx}`);

  const comparability = checkPopulationComparability(p.population);
  const temporal = checkTemporalOrder({ points, at, behavior_at: p.behavior_at, result_at: p.result_at });
  const metric = checkMetricAlignment(p);
  const alternatives = checkAlternativeExplanations(p);

  // —— 失败不否定结论：由失败导致的条目不得作否定依据，改记缺口（BRD §7 第 4 条） ——
  const isolatedRefs = new Set(temporal.isolated_points.map((i) => i.point_ref));
  const usable_points = [];
  const failure_induced = [];
  for (const pt of points) {
    const pid = pt.point_id ?? null;
    if (isolatedRefs.has(pointRef(pt))) continue; // 倒挂：该条失效
    if (pt.due_to_failure === true) {
      failure_induced.push({
        point_id: pid,
        point_ref: pointRef(pt),
        point_type: textOrNull(pt.point_type),
        usable_as_negation: false,
        note: "该条源自查询失败 / 受限，**不能当否定结论**，已转为信息缺口。",
      });
      continue;
    }
    usable_points.push({
      point_id: pid,
      point_ref: pointRef(pt),
      point_type: textOrNull(pt.point_type),
      point_text: textOrNull(pt.point_text),
      info_time_point: textOrNull(pt.info_time_point),
      usable_as_negation: true,
    });
  }
  if (failure_induced.length > 0) {
    for (const f of failure_induced) {
      temporal.gaps.push({
        gap_key: "due_to_failure",
        detail: `条目 ${f.point_id ?? "（无 id）"} 由失败 / 受限导致未完成——按 BRD §7 第 4 条转为缺口登记，不作否定依据。`,
        affects: "信息是否足以支持判断",
      });
    }
  }

  const declaredGaps = Array.isArray(p.gaps)
    ? p.gaps
        .filter((g) => g)
        .map((g) => (typeof g === "string" ? { gap_key: "declared", detail: String(g).trim(), affects: "信息是否足以支持判断" } : { gap_key: textOrNull(g.gap_key) || "declared", detail: textOrNull(g.detail) || null, affects: textOrNull(g.affects) || "信息是否足以支持判断" }))
    : [];

  const open_gaps = [...comparabilityGaps(comparability), ...temporal.gaps, ...metric.gaps, ...alternatives.gaps, ...declaredGaps];

  const sufficient =
    comparability.comparable === true &&
    temporal.ordered === true &&
    metric.aligned === true &&
    alternatives.unexcluded.length === 0 &&
    open_gaps.length === 0;

  const information_sufficiency = {
    check_key: "information_sufficiency",
    sufficient,
    open_gaps,
    definite_judgement_allowed: sufficient,
    note: sufficient
      ? "关键依据齐备，可给出明确判断。"
      : `缺关键依据时说明缺口，不给确定判断（PRD-M4 F-20⑤）——当前登记 ${open_gaps.length} 项缺口。`,
  };

  const status = sufficient ? BEHAVIOR_STATUS.SUPPORTED : BEHAVIOR_STATUS.NOT_SUPPORTED;

  return {
    check_order: BEHAVIOR_CHECK_KEYS.slice(),
    checks: {
      population_comparability: comparability,
      temporal_order: temporal,
      metric_alignment: metric,
      alternative_explanations: alternatives,
      information_sufficiency,
    },
    all_checks_ran: true,
    all_present: sufficient,
    isolated_points: temporal.isolated_points,
    usable_points,
    failure_induced,
    unexcluded_alternatives: alternatives.unexcluded,
    open_gaps,
    status,
    status_reason: sufficient
      ? "五查均通过：人群可比基础成立、行为在结果之前、口径一致、其他解释已排除、关键依据齐备 → 候选行为获得支持（**仍属候选**）。"
      : `五查未全部通过（${open_gaps.map((g) => g.gap_key).join("、") || "依据不足"}）→ 未找到足够依据支持该候选行为。`,
    complete_result: true,
    is_failure: false,
    causal_claim_allowed: false,
    causal_note: CAUSAL_NOTE,
    negation_allowed: failure_induced.length === 0,
    stop_condition: STOP_CONDITION,
    stopped: true,
    notes: {
      no_candidate_is_complete: NO_CANDIDATE_NOTE,
      failure_not_negation: FAILURE_NOT_NEGATION_NOTE,
      causal: CAUSAL_NOTE,
    },
  };
}

/** 可比性检查的缺口（未明确 / 不可比时各记一条，供⑤汇总）。 */
function comparabilityGaps(c) {
  const gaps = [];
  if (c.comparable === null) {
    gaps.push({ gap_key: "population_comparability_undetermined", detail: "两组人群可比性无法明确（缺差异清单）。", affects: "人群是否有可比基础" });
  } else if (c.comparable === false) {
    gaps.push({ gap_key: "population_not_comparable", detail: `两组人群可比基础不成立（未解释项：${c.unexplained.join("、") || "由上游判定"}）。`, affects: "人群是否有可比基础" });
  }
  return gaps;
}

/**
 * 比较条件守卫（**TC-A-M4-006 边界·missing-field**）。输出缺比较条件 / 查不到已过审素材 → **退回请补**，
 * **不静默回退、不编造**。比较条件三项的解析复用 **F-19 `resolveComparisonConditions`**（单一口径）。
 * @param {object} input 同 F-19 比较条件入参，另可带 `materials_available`
 * @returns {{ action:'proceed'|'request_supplement', resolved:boolean, conditions:object, missing:string[], draft:null, reasons:Array, guidance:string, note:string }}
 */
export function evaluateComparisonGate(input) {
  const p = input && typeof input === "object" ? input : {};
  const resolved = resolveComparisonConditions(p);
  const reasons = [];
  if (resolved.missing.length > 0) {
    for (const key of resolved.missing) {
      reasons.push({ reason: "comparison_condition_missing", field: key, note: `比较条件缺「${key}」，须请补后再取数。` });
    }
  }
  if (p.materials_available === false) {
    reasons.push({ reason: "no_approved_material", field: null, note: "查不到已过审素材（引用证据须四要素齐全），须请补后再取数。" });
  }

  if (reasons.length > 0) {
    return {
      action: "request_supplement",
      resolved: false,
      conditions: resolved.conditions,
      missing: resolved.missing.slice(),
      draft: null, // 不返回半成品
      reasons,
      guidance: "请补齐比较条件（涉及哪些用户 / 观察哪个阶段 / 什么结果口径）或提供已过审素材后再启动五查取数；本轮不产出候选行为条目。",
      note: "缺比较条件即退回请补：**不静默回退、不编造**（BRD §7.3 / 公共业务指令·引用证据须四要素齐全）。",
      stop_condition: STOP_CONDITION,
      stopped: true,
    };
  }

  return {
    action: "proceed",
    resolved: true,
    conditions: resolved.conditions,
    missing: [],
    draft: null,
    reasons: [],
    guidance: "比较条件三项已定，随分析保存（PRD-M4 F-20）。",
    note: resolved.note,
    stop_condition: STOP_CONDITION,
    stopped: true,
  };
}

/**
 * S-B2 + S-B3 一步编排：比较条件守卫 → （可选）入池筛选 → 五查 → 候选行为支持情况。
 * 纯计算、**零写库**；落库由 `formCandidateBehavior` 承接。
 * @param {object} input 比较条件入参 + `{ composite_raw?, pool_threshold?, at, population?, points?, behavior_at?, result_at?, metric?, alternatives?, gaps? }`
 * @returns {object}
 */
export function assembleBehaviorVerification(input) {
  const p = input && typeof input === "object" ? input : null;
  if (!p) throw new Error("人群比较与行为关系检验必填：入参须为对象");

  const gate = evaluateComparisonGate(p);
  if (gate.action === "request_supplement") {
    return {
      outcome: "request_supplement",
      written: false,
      gate,
      comparison_conditions: gate.conditions,
      comparison_conditions_missing: gate.missing,
      stopped: true,
      stop_condition: STOP_CONDITION,
    };
  }

  let pool = null;
  if (p.composite_raw !== undefined || p.pool_threshold !== undefined) {
    pool = judgePoolThreshold(p);
    if (pool.in_pool === false) {
      return {
        outcome: "out_of_pool",
        written: false,
        gate,
        pool,
        comparison_conditions: gate.conditions,
        comparison_conditions_missing: [],
        note: "候选行为未入池（综合分低于阈值），不进入五查——这是合法的筛选结果，不是失败。",
        stopped: true,
        stop_condition: STOP_CONDITION,
      };
    }
  }

  const checks = runBehaviorChecks(p);
  return {
    outcome: checks.status === BEHAVIOR_STATUS.SUPPORTED ? "candidate_supported" : "not_supported",
    written: false,
    gate,
    pool,
    comparison_conditions: gate.conditions,
    comparison_conditions_missing: [],
    ...checks,
    stopped: true,
    stop_condition: STOP_CONDITION,
  };
}

/** `CB-NNN` / `BP-NNN` 取号：用读面返回的**全量**自算「库内最大 +1」（不写 SELECT MAX——零裸 SQL 的取号范式）。 */
function nextSeq(rows, key, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) {
    const m = re.exec(String((r && r[key]) ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
const padId = (prefix, n) => `${prefix}-${String(n).padStart(3, "0")}`;

/** 下一个候选行为编号（`CB-NNN`）。 */
export async function nextCandidateId(db) {
  return padId("CB", nextSeq(await listCandidateBehaviors(db), "candidate_id", "CB"));
}

/** 下一个候选行为条目编号（`BP-NNN`）。 */
export async function nextBehaviorPointId(db) {
  return padId("BP", nextSeq(await listBehaviorPoints(db), "point_id", "BP"));
}

/**
 * 落库编排：五查结果 → MD-09 候选行为（含支持情况）+ MD-10 条目（支持 / 不支持并列）。
 * 写面一律经 `./behavior-store.js`（本文件零写语句、零裸 SQL）。语义：
 *   · 退回请补 / 未入池 → **不写库**，原样返回判定；
 *   · **失败导致的条目不下沉为不支持条目**（转缺口，避免「失败当否定」）；
 *   · **未支持也是完整合法产出**——仍写 MD-09（状态 `not_supported`）与不支持条目。
 * @param {object} db
 * @param {object} input 编排入参 + `{ research_no, behavior_name?, candidate_id?, points?:[{point_id?, point_type, point_text, info_time_point?, due_to_failure?}] }`
 * @returns {Promise<object>}
 */
export async function formCandidateBehavior(db, input) {
  const p = input && typeof input === "object" ? input : {};
  const research_no = textOrNull(p.research_no);
  if (!research_no) throw new Error("候选行为落库必填：research_no（候选行为须归属 MD-07 真实研究）");
  const behavior_name = textOrNull(p.behavior_name) || textOrNull(p.candidate_behavior_name) || textOrNull(p.behavior_hypothesis);
  if (!behavior_name) throw new Error("候选行为落库必填：behavior_name（MD-09 行为名称为 NOT NULL 列）");

  const assembled = assembleBehaviorVerification(p);
  if (assembled.outcome === "request_supplement" || assembled.outcome === "out_of_pool") {
    return { ...assembled, candidate_id: null, point_ids: [] };
  }

  const candidate_id = textOrNull(p.candidate_id) || (await nextCandidateId(db));
  await createCandidateBehavior(db, {
    candidate_id,
    research_no,
    behavior_name,
    behavior_status: assembled.status,
  });

  let seq = nextSeq(await listBehaviorPoints(db), "point_id", "BP");
  const counters = { support: 0, unsupport: 0 };
  const point_ids = [];
  for (const pt of assembled.usable_points) {
    const point_text = textOrNull(pt.point_text);
    if (!point_text) continue;
    const side = textOrNull(pt.point_type) === BEHAVIOR_POINT_TYPE.SUPPORT ? "support" : "unsupport";
    counters[side] += 1;
    const point_id = padId("BP", seq);
    seq += 1;
    await appendBehaviorPoint(db, {
      point_id,
      candidate_id,
      point_type: side,
      point_text,
      order_no: counters[side],
    });
    point_ids.push(point_id);
  }

  return {
    outcome: "candidate_behavior",
    written: true,
    candidate_id,
    research_no,
    behavior_name,
    behavior_status: assembled.status,
    point_ids,
    support_count: counters.support,
    unsupport_count: counters.unsupport,
    failure_induced_count: assembled.failure_induced.length,
    complete_result: true,
    is_failure: false,
    causal_claim_allowed: false,
    open_gaps: assembled.open_gaps,
    isolated_points: assembled.isolated_points,
    comparison_conditions: assembled.comparison_conditions,
    stopped: true,
    stop_condition: assembled.stop_condition,
    note:
      "候选行为与其支持 / 不支持情况条目已登记（MD-09 / MD-10）；" +
      (counters.unsupport > 0 ? "不支持的方面并列成行，**未支持亦是完整合法产出**。" : "本轮未登记不支持条目。") +
      (assembled.failure_induced.length > 0 ? ` ${assembled.failure_induced.length} 条失败导致的条目转为缺口、未下沉为不支持条目。` : ""),
  };
}

/**
 * 经 **M5 工具执行程序只读查询**（TC-I-M4-002）：本函数是 F-20 唯一的取数出口，
 * 复用 **F-15 `runMetricVerification`**（其内部经 M5 `runQueryWithRecovery`：重试 + 落 EXT-01 + 失败/受限处置任务态），
 * **不另写查询面、不调生产写**；`model_expectation` 等模型预期入参同样被 F-15 显式忽略。
 * @param {object} db
 * @param {object} params 同 F-15 `runMetricVerification`，另可带 `check_key`（须属五查键）
 * @returns {Promise<object>}
 */
export async function queryForBehaviorCheck(db, params = {}) {
  const p = params && typeof params === "object" ? params : {};
  const { check_key, ...rest } = p;
  if (check_key !== undefined && check_key !== null && !BEHAVIOR_CHECK_KEYS.includes(String(check_key))) {
    throw new Error(`check_key 不属五查键：${JSON.stringify(check_key)}（只能取 ${BEHAVIOR_CHECK_KEYS.join(" / ")}）`);
  }
  const fact = await runMetricVerification(db, rest);
  return { check_key: check_key === undefined ? null : check_key, via: "M5（runQueryWithRecovery）", read_only: true, ...fact };
}
