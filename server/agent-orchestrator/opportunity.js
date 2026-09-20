/**
 * 文档卡（阶段4 · M3 · F-16 机会形成与去重 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M3-机会发现Agent.md（F-16 机会形成与去重｜§1.1.3 S-A4 机会整理与去重｜§4 红线 1「止于机会」）
 *   ｜ ../../docs/05-test-cases/test-M3.md（**TC-A-M3-004**（L4·F-16：S-A4 对照已有机会判重 + 组装六要素 + 标未知项二态 +
 *        输出机会记录或缺口记录 + **没有足够依据也是合法产出**）｜**TC-A-M3-005**（L4·F-15/F-16：missing-field 只松不严不硬映射，缺键退回））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-16（依据足够 → 保存机会与初步证据；相同问题关联更新；依据不足 → 保存检查范围与信息缺口）
 *   ｜ ../../docs/03-locks/schema.md（MD-06 opportunity 六要素 + `unknown_item` 二态、LNK-03 opportunity_relation 方向口径）
 *   ｜ ../../docs/07-decisions/ADR-003-机会六要素必填与未知项二态.md（Q-05 裁决：NULL=未评估 → 不齐；''=已评估且确无 → 计入齐全）
 *   ｜ ./verification.js（F-15 的查证结果：`fact` / `checks` / `evidence` 草稿——**本文件的输入**）
 *   ｜ ../shared-context/index.js（F-10 的 MD-06/LNK-03 单一写入面与六要素判定纯函数——**本文件只调用，不重写**）
 * 职责：F-16「机会整理与去重」＝把 F-15 的查证结果整理成**机会记录**或**缺口记录**：
 *   ① 依据足够 → 组装六要素（`goal_id`/`goal_version_no`/`target_object`/`phenomenon`/`initial_basis_note`/`research_reason`）
 *      ＋ `unknown_item` 二态 → 落 MD-06；② 与已有机会重复 → 落 LNK-03 关联（「相同问题关联更新」）；
 *   ③ 依据不足 → **返回缺口记录（检查范围 + 信息缺口 + 影响哪项判断）且不写库**——「本轮未产生新机会」是合法产出。
 * 硬红线：① **零外部调用**（不 `fetch`、不调 LLM——A-1 门禁只挡推理，本文件是确定性编排）；
 *   ② **零自有写语句**（无 INSERT/UPDATE/DELETE、无裸 SQL）：MD-06 经 `createOpportunity`、LNK-03 经 `linkOpportunityRelation`，
 *      取号与判重一律走 `../shared-context/index.js` 的读面（`listOpportunities` / `listOpportunityRelations`）；
 *   ③ **不下 HVA 判断、不输出生产动作**（PRD-M3 §4 红线 1：止于机会＋初步依据）；
 *   ④ `unknown_item` 纯空白串 → **应用层显式拒**（ADR-003：库级 `NOT NULL` 拦不住空白串）；
 *   ⑤ **未知项写入策略前置守卫**（ADR-003 §7，2026-09-20 用户裁决）：空串态「已评估且确无」
 *      **只允许 PM 写入**，Agent 路径（`producing_task_id` 非空）一律拒——须留 `NULL` 走待补，
 *      **不逼 Agent 编造未知项充数**；产出来源即由 `producing_task_id` 判定（**不新增列、不改 DDL**）。
 * 边界：机会形成与去重的**判断**归本文件（F-16）；M2 的 `shared-context` 只提供关系登记/读取与六要素判定纯函数。
 *   缺口记录**不落表**（schema 无缺口专表；缺口的出处是 `EXT-02.missing_note` 与 `CFG-01.capability_cannot`）。
 * 反向清单：登记 ./README.md（文件清单 / 用例表 / 路由面 / 口径 / 反向清单）与 server/README.md（模块表 / 状态位）；
 *   被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f16.mjs）。
 *
 * 用法：import { formOpportunityOrGap, nextOpportunityId } from "./opportunity.js";
 */

import {
  assessOpportunitySixElements,
  classifyUnknownItem,
  UNKNOWN_ITEM_STATES,
  createOpportunity,
  listOpportunities,
  listOpportunityRelations,
  linkOpportunityRelation,
} from "../shared-context/index.js";

/** S-A4 的两种终止产出（「形成记录并保存」）。 */
export const OPPORTUNITY_OUTCOMES = {
  OPPORTUNITY: "opportunity", // 形成机会记录（MD-06）
  GAP: "gap", // 依据不足 → 缺口记录（不落表）
};

/** 判重命中时的关系语义（`dict:OPP_RELATION` 码；「相同问题关联」）。 */
export const DEFAULT_RELATION_KIND = "same_issue";

/** 机会产出来源（由 `MD-06.producing_task_id` 派生，**不新增列**）。ADR-003 §7-②。 */
export const OPPORTUNITY_SOURCES = {
  AGENT: "agent", // producing_task_id 非空 → 由机会发现任务产出（Agent 路径）
  PM: "pm", // 无产出任务 → PM 手工补录路径
};

/**
 * 机会产出来源判定（**纯函数**）。ADR-003 §7-②「两者皆有，按来源区分」：
 * 以 `MD-06.producing_task_id` 是否为空区分——非空即由某个机会发现任务产出（Agent 路径），
 * 为空即无产出任务（PM 手工补录路径）。**不新增列、不改 DDL**（该列本就可空，FK → PD-01）。
 */
export function classifyOpportunitySource(producing_task_id) {
  const raw =
    producing_task_id === undefined || producing_task_id === null ? "" : String(producing_task_id);
  return raw.trim() === "" ? OPPORTUNITY_SOURCES.PM : OPPORTUNITY_SOURCES.AGENT;
}

/**
 * 未知项写入策略判定（**纯函数**，写入前置守卫用）。ADR-003 §7：
 * - ① 「确无未知项」（空串态 `''`）**只允许 PM 写入**——Agent 不得自行结论「确无」，
 *   类比 F-01「Agent 和产品经理不能替业务方另定指标定义」；Agent 未识别出未知项时应留
 *   `NULL`（未评估）并触发待补，交由 PM 确认，**不得编造未知项充数**；
 * - ② 防 `NULL` 规避**不由本函数判定**——已由 `assessOpportunitySixElements` 的
 *   `pending_supplement` 承担（未评估 → 六要素不齐 → 依据不足走缺口分支，不写库），
 *   此处不重造第二套口径。
 * @returns {{ state:string, source:string, allowed:boolean, reason:string }}
 */
export function judgeUnknownItemWrite({ unknown_item, producing_task_id } = {}) {
  const state = classifyUnknownItem(unknown_item);
  const source = classifyOpportunitySource(producing_task_id);
  const blocked = state === UNKNOWN_ITEM_STATES.NONE_CONFIRMED && source === OPPORTUNITY_SOURCES.AGENT;
  return {
    state,
    source,
    allowed: !blocked,
    reason: blocked
      ? "未知项「已评估且确无」（空串）只允许 PM 写入：Agent 不得自行结论「确无未知项」（ADR-003 §7-①）。未识别出未知项时应留 NULL（未评估）并触发待补，不得编造未知项充数。"
      : "允许写入",
  };
}

/**
 * 新机会的默认状态（`dict:OPP_STATUS` 码 `candidate`＝候选）。
 * 值域真源在 `dict_item`（DI-019），本文件只引用**码**、不内联中文枚举。
 */
export const DEFAULT_OPPORTUNITY_STATUS = "candidate";

/** 标题最大长度（避免把整段现象写进标题列）。 */
const TITLE_MAX = 80;

/* ================================================================== *
 * 取号（确定性、可回查）：读面走 shared-context，不写裸 SQL。
 * 全库口径与种子一致：机会 `OPP-NNN`、关系 `LK-OR-NNN`（均 3 位补零）。
 * ================================================================== */

/** 下一个机会号：库内 `OPP-NNN` 最大 +1（种子最大 `OPP-014` → `OPP-015`）。 */
export async function nextOpportunityId(db) {
  const rows = (await listOpportunities(db, {})) || [];
  let max = 0;
  for (const r of rows) {
    const m = /^OPP-(\d+)$/.exec(String(r.opportunity_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `OPP-${String(max + 1).padStart(3, "0")}`;
}

/** 下一个机会关系号：库内 `LK-OR-NNN` 最大 +1（种子最大 `LK-OR-002` → `LK-OR-003`）。 */
export async function nextOpportunityRelationId(db) {
  const rows = (await listOpportunityRelations(db, {})) || [];
  let max = 0;
  for (const r of rows) {
    const m = /^LK-OR-(\d+)$/.exec(String(r.relation_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `LK-OR-${String(max + 1).padStart(3, "0")}`;
}

/* ================================================================== *
 * 纯函数：六要素组装（不触库）
 * ================================================================== */

/**
 * 派生机会标题（`opportunity_title` 是 NOT NULL，但**不在六要素内**，故需单独给值）。
 * 优先用调用方给的 `clue.opportunity_title`；否则截取现象描述；两者皆空 → `null`（由依据足够性判定拦下）。
 */
export function deriveOpportunityTitle(clue = {}) {
  const raw = clue.opportunity_title ?? clue.phenomenon;
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const s = String(raw).trim();
  return s.length > TITLE_MAX ? s.slice(0, TITLE_MAX) : s;
}

/**
 * 由「目标 + 线索 + 查证结果」组装六要素与标题（**纯函数**）。
 * 来源分派（避免互相顶替）：查证**测量值**来自 F-15 的 `fact`／`evidence` 草稿；
 *   **人群/旅程归属**（`target_object`）与**研究理由**来自线索侧；`unknown_item` 二态由线索侧原样透传。
 * @returns {{ elements: object, assessment: object }}
 */
export function buildOpportunitySixElements({ goal = {}, clue = {}, verification = {} } = {}) {
  const fact = verification.fact || {};
  const evidence = (verification.evidence && verification.evidence.draft) || {};

  const source_id = evidence.source_id ?? fact.source_id ?? null;
  const query_id = evidence.query_id ?? fact.query_id ?? null;
  const info_time_point = evidence.info_time_point ?? fact.info_time_point ?? null;

  const elements = {
    // 六要素 ① 对应目标（占 goal_id + goal_version_no 两列）
    goal_id: goal.goal_id ?? fact.goal_id ?? null,
    goal_version_no:
      goal.goal_version_no ?? goal.current_version_no ?? fact.goal_version_no ?? null,
    // 六要素 ② 涉及对象（谁在哪个旅程环节）——线索侧归属，来自 S-A3
    target_object: clue.target_object ?? clue.attribution ?? null,
    // 六要素 ③ 观察现象——线索侧描述优先，无则用查证返回摘要
    phenomenon: clue.phenomenon ?? fact.result_summary ?? null,
    // 六要素 ④ 初步依据——调用方显式给定优先，否则由「来源 + 查询 + 信息时点」组装
    initial_basis_note:
      clue.initial_basis_note ??
      (source_id || query_id
        ? `来源 ${source_id ?? "未登记"} 第 ${query_id ?? "未登记"} 次查询（信息时点 ${info_time_point ?? "未标注"}）`
        : null),
    // 六要素 ⑤ 研究理由——线索侧
    research_reason: clue.research_reason ?? null,
    // 六要素·未知项（二态，单独判定）：undefined/null→未评估；''→确无；文本→有；纯空白→非法
    unknown_item: clue.unknown_item,
    // 非六要素但 NOT NULL
    opportunity_title: deriveOpportunityTitle(clue),
  };

  const assessment = assessOpportunitySixElements(elements);
  return { elements, assessment };
}

/* ================================================================== *
 * 纯函数：依据足够性判定（F-16 的「依据足够 / 依据不足」分水岭）
 * ================================================================== */

/**
 * 依据是否足够形成机会（**纯函数**，确定性、无随机）。
 *
 * 「足够」＝**必要条件全满足**（缺一即判不足，退回缺口记录，不硬凑）：
 * - `real_return`：**拿到了真实返回**（F-15 `fact.ok` 且 `verified`）——不允许以模型预期代替查询结果；
 * - `source_traceable`：来源可回查（`query_id` + `source_id` 齐）——「初步依据」必须能回查；
 * - `not_contradicted`：**未倒挂**（信息时点不晚于取数时刻）——倒挂证据不作为依据；
 * - `six_elements_complete`：六要素**都被评估过**（ADR-003：`unknown_item` 未评估＝不齐）；
 * - `title_present`：标题可派生（`opportunity_title` 是 NOT NULL 列）。
 *
 * 「适用范围」判定未命中**不阻断**（归 `caveats`）——目标未声明范围时记「未知」，不猜、也不因此丢掉已成立的证据；
 * 该项以 caveat 形式随机会记录一并暴露，由后续人工节点（F-03）复核。
 * @returns {{ enough:boolean, required:object, caveats:object, note:string }}
 */
export function hasEnoughBasis({ verification = {}, sixElements = {} } = {}) {
  const fact = verification.fact || {};
  const checksWrapped = verification.checks || {};
  const checks = checksWrapped.checks || {};
  const assessment =
    sixElements.assessment || assessOpportunitySixElements(sixElements.elements || {});

  const required = {
    real_return: fact.ok === true && verification.verified === true,
    source_traceable: Boolean(fact.query_id && fact.source_id),
    not_contradicted: checksWrapped.contradicted !== true,
    six_elements_complete: assessment.six_elements_complete === true,
    title_present: Boolean(sixElements.elements && sixElements.elements.opportunity_title),
  };
  const caveats = {
    scope_decided: checks.applicability ? checks.applicability.decided === true : false,
    scope_ok: checks.applicability ? checks.applicability.ok === true : false,
    unknown_state: assessment.unknown_state,
    pending_supplement: assessment.pending_supplement === true,
  };
  const enough = Object.values(required).every(Boolean);
  const failed = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);

  return {
    enough,
    required,
    caveats,
    note: enough
      ? "依据足够：真实返回可回查、未倒挂、六要素已评估齐备——可形成机会记录"
      : `依据不足（未满足：${failed.join("、")}）——退回缺口记录，本轮不产生新机会（合法产出）`,
  };
}

/* ================================================================== *
 * 纯函数：缺口记录（依据不足时的合法产出；**不落表**）
 * ================================================================== */

/**
 * 组装缺口记录：**检查范围 + 信息缺口 + 影响哪项判断**（PRD-M3 F-16「保存检查范围与信息缺口」）。
 * 缺口来源三条：① F-15 五查的开放口径缺口（`CFG-05`）；② 未取得真实返回的失败原因；③ 缺失的六要素项 / 证据缺失说明。
 * @returns {{ scope_checked:object, info_gaps:Array, affected_judgements:Array, note:string }}
 */
export function buildGapRecord({ goal = {}, clue = {}, verification = {}, sixElements = {} } = {}) {
  const fact = verification.fact || {};
  const checksWrapped = verification.checks || {};
  const checks = checksWrapped.checks || {};

  const info_gaps = [];
  for (const g of checks.gap?.open_gaps || []) {
    info_gaps.push({
      source: "cfg05_gap_rule",
      rule_id: g.rule_id ?? null,
      target_field: g.target_field ?? null,
      gap_text: g.gap_text ?? null,
      impact_note: g.impact_note ?? null,
    });
  }
  if (fact.ok === false) {
    info_gaps.push({
      source: "query_failed",
      rule_id: null,
      target_field: "initial_basis_note",
      gap_text: `未取得真实返回（${fact.fail_reason ?? "原因未标注"}）`,
      impact_note: "无可用依据，机会无法形成——不以模型预期代替查询结果",
    });
  }
  if (fact.ok === true && checksWrapped.contradicted === true) {
    info_gaps.push({
      source: "evidence_isolated",
      rule_id: null,
      target_field: "info_time_point",
      gap_text: "证据倒挂（信息时点晚于取数时刻）——该条证据失效",
      impact_note: "时点无法对齐，不能作为依据",
    });
  }
  if (fact.missing_note) {
    info_gaps.push({
      source: "evidence_missing_note",
      rule_id: null,
      target_field: "missing_note",
      gap_text: String(fact.missing_note),
      impact_note: "该证据未能证明的内容",
    });
  }
  const assessment =
    sixElements.assessment || assessOpportunitySixElements(sixElements.elements || {});
  for (const label of assessment.missing_labels) {
    info_gaps.push({
      source: "six_elements",
      rule_id: null,
      target_field: null,
      gap_text: `机会六要素缺「${label}」`,
      impact_note: "六要素不齐，机会记录无法形成",
    });
  }

  const affected_judgements = [];
  if (fact.ok === false) affected_judgements.push("现象是否存在（本轮未取得数据，无法描述）");
  if (checksWrapped.contradicted === true) affected_judgements.push("现象是否成立（证据倒挂，时点不可用）");
  if (checks.applicability && checks.applicability.decided === false) {
    affected_judgements.push("适用范围是否对应当前目标（目标未声明范围，无法判定）");
  }
  if (checks.existing_opportunity && checks.existing_opportunity.duplicate_suspected) {
    affected_judgements.push("是否为已有机会的重复记录（疑似重复，须人工复核）");
  }
  if (affected_judgements.length === 0) affected_judgements.push("现象与人群差异的关系仍未经验证");

  return {
    scope_checked: {
      goal_id: goal.goal_id ?? null,
      goal_version_no: goal.goal_version_no ?? goal.current_version_no ?? null,
      business_scope: goal.business_scope ?? goal.scope ?? null,
      fact_scope_text: checks.applicability?.fact_scope_text ?? null,
      keywords: Array.isArray(clue.keywords) ? clue.keywords.slice() : [],
      query_id: fact.query_id ?? null,
      source_id: fact.source_id ?? null,
      info_time_point: fact.info_time_point ?? null,
    },
    info_gaps,
    affected_judgements,
    note: "依据不足：本轮不产生新机会，只保留检查范围与信息缺口（PRD-M3 F-16 合法产出）",
  };
}

/* ================================================================== *
 * 编排：S-A4 机会整理与去重（依据足够 → 机会记录；不足 → 缺口记录）
 * ================================================================== */

/**
 * S-A4 编排（**写面全部委托 shared-context**）：
 * 1. 组装六要素 + 依据足够性判定；
 * 2. `unknown_item` 纯空白串 → **显式拒**（ADR-003：应用层须拒，库级拦不住）；
 * 3. **未知项写入策略前置守卫**（ADR-003 §7-①，在取号与写库之前判）：空串态（已评估且确无）
 *    **只允许 PM 写入**；Agent 路径（`producing_task_id` 非空）一律拒，须留 `NULL` 走待补；
 * 4. 依据不足 → 返回 `outcome="gap"` + 缺口记录，**不写任何表**；
 * 5. 依据足够 → 取号 → `createOpportunity`（MD-06）→ 命中已有机会则 `linkOpportunityRelation`（LNK-03）→ 返回 `outcome="opportunity"`。
 *
 * **产出来源**（ADR-003 §7-②）以 `producing_task_id` 判定：非空＝机会发现任务（Agent）产出，
 * 空＝PM 手工补录。**不新增列、不改 DDL**；防 `NULL` 规避由 `pending_supplement` 承担（见 `judgeUnknownItemWrite`）。
 *
 * 「相同问题」关系方向**对齐种子 `LK-OR-002`（`same_issue`）**：`from`＝**已有机会**（原机会），`to`＝**新机会**。
 *
 * @param {object} db D1 形态
 * @param {object} input { goal, clue, verification（必填，F-15 结果）、opportunity_title?、opportunity_status?、producing_task_id?、created_at? }
 * @returns {Promise<object>} outcome / opportunity_id / relations / six_elements / assessment / basis / gap_record
 */
export async function formOpportunityOrGap(db, input = {}) {
  const { goal = {}, clue = {}, verification = {}, created_at = null } = input;

  if (!verification || typeof verification !== "object" || !verification.fact) {
    throw new Error("formOpportunityOrGap 缺必填项：verification（F-15 的查证结果，须含 fact）");
  }

  const six = buildOpportunitySixElements({
    goal,
    clue: { opportunity_title: input.opportunity_title, ...clue },
    verification,
  });

  // ADR-003：`unknown_item` 纯空白串是**非法态**（库级 NOT NULL 拦不住）→ 应用层显式拒，不静默降级。
  if (six.assessment.unknown_item_valid === false) {
    throw new Error(
      "未知项（unknown_item）不得为纯空白串：未评估（未提供或 NULL）与已评估且确无（空串）是两种状态，须显式表达"
    );
  }

  // ADR-003 §7-①：**前置守卫**（在取号与写库之前判，不留半截状态）——
  // 空串态（已评估且确无）只允许 PM 写入；Agent 路径（producing_task_id 非空）一律拒。
  const writePolicy = judgeUnknownItemWrite({
    unknown_item: six.elements.unknown_item,
    producing_task_id: input.producing_task_id,
  });
  if (writePolicy.allowed === false) throw new Error(writePolicy.reason);

  const basis = hasEnoughBasis({ verification, sixElements: six });

  if (!basis.enough) {
    return {
      outcome: OPPORTUNITY_OUTCOMES.GAP,
      opportunity_id: null,
      relations: [],
      six_elements: six.elements,
      assessment: six.assessment,
      basis,
      gap_record: buildGapRecord({ goal, clue, verification, sixElements: six }),
      note: "依据不足：本轮未产生新机会（合法产出，允许不产机会）",
    };
  }

  const opportunity_id = input.opportunity_id || (await nextOpportunityId(db));
  const record = {
    opportunity_id,
    goal_id: six.elements.goal_id,
    goal_version_no: six.elements.goal_version_no,
    opportunity_title: six.elements.opportunity_title,
    opportunity_status: input.opportunity_status || DEFAULT_OPPORTUNITY_STATUS,
    target_object: six.elements.target_object,
    phenomenon: six.elements.phenomenon,
    initial_basis_note: six.elements.initial_basis_note,
    research_reason: six.elements.research_reason,
    unknown_item: six.elements.unknown_item === undefined ? null : six.elements.unknown_item,
    producing_task_id: input.producing_task_id === undefined ? null : input.producing_task_id,
    created_at: created_at || undefined,
  };

  // MD-06 写面（F-10）：六要素不齐 / 未知项非法时由 createOpportunity 再兜一层（本文件已前置守卫）。
  await createOpportunity(db, record);

  // 判重来源＝F-15 五项检查的「已有机会」比对结果（不重造一套关键词逻辑）
  const matches = verification.checks?.checks?.existing_opportunity?.matches || [];
  const relations = [];
  for (const m of matches) {
    const relation_id = await nextOpportunityRelationId(db);
    await linkOpportunityRelation(db, {
      relation_id,
      from_opportunity_id: m.opportunity_id, // 已有机会（原机会）
      to_opportunity_id: opportunity_id, // 新机会
      relation_kind: DEFAULT_RELATION_KIND,
      created_at: created_at || undefined,
    });
    relations.push({
      relation_id,
      from_opportunity_id: m.opportunity_id,
      to_opportunity_id: opportunity_id,
      relation_kind: DEFAULT_RELATION_KIND,
      matched_opportunity_id: m.opportunity_id,
      hits: Array.isArray(m.hits) ? m.hits.slice() : [],
    });
  }

  return {
    outcome: OPPORTUNITY_OUTCOMES.OPPORTUNITY,
    opportunity_id,
    relations,
    six_elements: six.elements,
    assessment: assessOpportunitySixElements({ ...record }),
    basis,
    gap_record: null,
    note:
      relations.length > 0
        ? `依据足够：已形成机会记录，并与已有机会 ${relations.map((r) => r.matched_opportunity_id).join("、")} 关联更新（相同问题）`
        : "依据足够：已形成机会记录，未发现与已有机会重复",
  };
}
