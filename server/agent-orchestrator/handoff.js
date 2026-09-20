/**
 * 文档卡（阶段4 · M3 · F-17 两步衔接 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M3-机会发现Agent.md（**F-17 两步衔接**：机会＋初步依据作为 PM 输入的前提；
 *        拿到结果之后的对话过程作为第二个 Agent 的输入；必要信息可能需要 Agent 反过来问 PM
 *        ｜§4 红线 4「人工节点不自动交接」｜§4 红线 1「止于机会」｜§4 红线 3「解释须标未验证部分」）
 *   ｜ ../../docs/05-test-cases/test-M3.md（**TC-I-M3-001**（L5·F-17：机会发现 → HVA 分析衔接，经**人工节点**
 *        （M1 F-03/F-04，PM 选机会、提研究问题）转交；**不自动交接**；**无人工节点时 M4 不被调用**））
 *   ｜ ../../docs/01-brd/BRD.md §3.1 流程主线（… → 人工节点（F-03）→ M4 …）｜§6 全局术语口径「人工节点」
 *        （机会发现与 HVA 分析之间由 PM 选机会、提研究问题，不自动交接）｜§4 F-03（PM 选机会＋提研究问题，必需）
 *   ｜ ../../docs/03-locks/schema.md（MD-06 opportunity 六要素、MD-12 research_proposal、LNK-01 opportunity_evidence、
 *        ADR-003 未知项二态；Q-16 见 §12——`opportunity_evidence.linked_at` 种子值形式）
 *   ｜ ../task-runner/proposal.js（F-03 建议管理：**只读** `listProposals`）
 *   ｜ ../shared-context/index.js（读面：`getOpportunity` / `listEvidenceByOpportunity` / `getEvidence` /
 *        `assessOpportunitySixElements` / `UNKNOWN_ITEM_STATES`——**只调用，不重写**）
 * 职责：F-17「两步衔接」＝把 M3 产出整理成**PM 决策上下文**（PM 输入前提），并给出**人工节点守卫**与**反向问询**：
 *   ① `assemblePmDecisionContext`：机会六要素＋评定＋**初步依据四要素**（来源/条件/时点/适用范围）＋未知项＋缺口
 *      ＋「尚不构成 HVA 结论」声明——供 PM 选机会；
 *   ② `evaluateHandoffGate`：人工节点是否完成＝**MD-12 有无该机会的真实建议行**（不看机会状态，防种子/旁路造成假通过）；
 *   ③ `collectSupplementRequests`：必要信息缺失时列出**请补项**（由 Agent 反向问 PM，只补要查清的内容）；
 *   ④ `composeHandoffPackage`：组装交接包（**只组装、不触发**），未过守卫则 `handoff=null`＋`blocked_by='human_node'`。
 * 硬红线：① **零写库**（无新增/改行/删行类 SQL）；② **零裸 SQL**（一律走 `../shared-context` 与
 *      `../task-runner/proposal.js` 读面）；③ **零外部调用**（不发起 HTTP 请求、不调 LLM——A-1 门禁只挡推理，
 *      本文件是确定性编排）；④ **绝不触发 M4**——不 import `../task-runner/hva.js`、代码里不出现 M4 的建任务
 *      函数名 `createHvaResearchTask`，衔接只经 M1 F-03/F-04 人工节点（TC-I-M3-001「无人工节点时 M4 不被调用」）；
 *      ⑤ 不复制中文枚举（未知项状态取自 `UNKNOWN_ITEM_STATES`）。
 * 边界：F-17 不下 HVA 判断（PRD-M3 §4 红线 1）；M4 的启动仍归 M1 F-04——本文件只给**入口提示文字**，不给调用。
 * 反向清单：登记 ./README.md（文件清单 / 用例表 / 路由面 / 口径 / 反向清单）与 server/README.md（模块表 / 状态位）；
 *   被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f17.mjs）。
 *
 * 用法：import { assemblePmDecisionContext, composeHandoffPackage } from "./handoff.js";
 */

import {
  getOpportunity,
  listEvidenceByOpportunity,
  getEvidence,
  assessOpportunitySixElements,
  UNKNOWN_ITEM_STATES,
} from "../shared-context/index.js";

import { listProposals } from "../task-runner/proposal.js";

/** 人工节点（承接 BRD §3.1 / §6：机会发现与 HVA 分析之间由 PM 选机会、提研究问题；不自动交接）。 */
export const HANDOFF_NODE = Object.freeze({
  feature: "M1 F-03 研究建议管理",
  action: "PM 选机会＋提研究问题（必需）",
  trigger: "M1 F-04 HVA 研究任务调度（建议提交后触发）",
  auto: false,
});

/** 「不自动交接」声明（供 API / 用例断言与前端提示共用）。 */
export const NO_AUTO_HANDOFF_NOTE =
  "机会 → 研究建议 → HVA 任务之间必须经 PM（人工节点）；本编排只组装交接物，不自动交接、不代为启动 M4。";

/** PM 决策上下文的性质声明（PRD-M3 §4 红线 1「止于机会」／红线 3「解释须标未验证部分」）。 */
export const PM_CONTEXT_NOTICE =
  "本上下文只含机会＋初步依据，尚不构成 HVA 结论；是否值得进一步研究由 M4 在 PM 提问后分析。";

/** 证据四要素（BRD §7 第 3 条 / PRD-M3 §5 验收总则「证据可回查：来源/条件/时点/适用范围」）。 */
export const EVIDENCE_FOUR_ELEMENTS = Object.freeze([
  "source_id",
  "query_condition",
  "info_time_point",
  "applicability_scope",
]);

const norm = (v) => (v === undefined || v === null ? "" : String(v).trim());

/** 从一条证据行里挑出四要素并判齐（齐＝四项都非空）。 */
function evidenceFourOf(row) {
  const missing = EVIDENCE_FOUR_ELEMENTS.filter((f) => norm(row?.[f]) === "");
  return {
    source_id: row?.source_id ?? null,
    query_condition: row?.query_condition ?? null,
    info_time_point: row?.info_time_point ?? null,
    applicability_scope: row?.applicability_scope ?? null,
    complete: missing.length === 0,
    missing,
  };
}

/**
 * 组装 **PM 决策上下文**（F-17 的「输入 → 输出」：机会记录 → PM 决策上下文）。
 * 只读、纯计算——不含 HVA 结论、不含生产动作。
 * @param {object} db D1 形态
 * @param {object} args { opportunity_id }
 * @returns {Promise<object>} 上下文（机会 + 六要素评定 + 初步依据四要素 + 缺口 + 声明 + 下一步人工节点）
 */
export async function assemblePmDecisionContext(db, { opportunity_id } = {}) {
  const oid = norm(opportunity_id);
  if (!oid) throw new Error("assemblePmDecisionContext：opportunity_id 必填（PM 决策上下文针对某个机会）");
  const opportunity = await getOpportunity(db, oid);
  if (!opportunity) throw new Error(`机会不存在：${oid}（上下文只针对真实机会）`);

  const assessment = assessOpportunitySixElements(opportunity);
  const links = await listEvidenceByOpportunity(db, oid);

  const initial_basis = [];
  for (const l of links) {
    const full = (await getEvidence(db, l.evidence_id)) || {};
    const four = evidenceFourOf({ ...full, ...l });
    initial_basis.push({
      evidence_id: l.evidence_id,
      evidence_title: l.evidence_title ?? full.evidence_title ?? null,
      link_kind: l.link_kind ?? null,
      // 关联建立时点：**原样透传、不解析**（种子值为任务 ID 形式，见 schema.md §12 Q-16）
      linked_at: l.linked_at ?? null,
      source_id: four.source_id,
      query_condition: four.query_condition,
      info_time_point: four.info_time_point,
      applicability_scope: four.applicability_scope,
      result_summary: full.result_summary ?? null,
      missing_note: full.missing_note ?? null,
      four_elements_complete: four.complete,
      missing_elements: four.missing,
      retrievable: norm(four.source_id) !== "" && norm(l.evidence_id) !== "",
    });
  }

  const incomplete = initial_basis.filter((e) => !e.four_elements_complete);

  return {
    opportunity_id: oid,
    opportunity: {
      opportunity_title: opportunity.opportunity_title,
      opportunity_status: opportunity.opportunity_status,
      goal_id: opportunity.goal_id,
      goal_version_no: opportunity.goal_version_no,
      target_object: opportunity.target_object,
      phenomenon: opportunity.phenomenon,
      research_reason: opportunity.research_reason,
      unknown_item: opportunity.unknown_item ?? null,
      producing_task_id: opportunity.producing_task_id ?? null,
      created_at: opportunity.created_at ?? null,
    },
    six_elements: {
      present: assessment.six_elements_present,
      complete: assessment.six_elements_complete,
      missing: assessment.missing,
      missing_labels: assessment.missing_labels,
      unknown_state: assessment.unknown_state,
      pending_supplement: assessment.pending_supplement,
    },
    initial_basis,
    basis_count: initial_basis.length,
    basis_complete: initial_basis.length > 0 && incomplete.length === 0,
    incomplete_evidence_ids: incomplete.map((e) => e.evidence_id),
    gap_notes: initial_basis.map((e) => e.missing_note).filter((x) => norm(x) !== ""),
    notice: PM_CONTEXT_NOTICE,
    next_step: { ...HANDOFF_NODE },
  };
}

/**
 * **人工节点守卫**（TC-I-M3-001 的落地）：判定该机会能否交接给 M4。
 * 完成判据＝**MD-12 存在该机会的真实研究建议行**（不看 `opportunity_status`——状态可被种子/旁路置于
 * `submitted` 而无建议行，只看状态会造成「假通过」）。
 * @returns {Promise<object>} `auto_handoff` **恒 false**；未完成时 `can_handoff=false` + `blocked_by='human_node'` + `reasons`
 */
export async function evaluateHandoffGate(db, { opportunity_id } = {}) {
  const oid = norm(opportunity_id);
  if (!oid) throw new Error("evaluateHandoffGate：opportunity_id 必填");
  const opportunity = await getOpportunity(db, oid);
  if (!opportunity) throw new Error(`机会不存在：${oid}`);

  const proposals = await listProposals(db, { opportunity_id: oid });
  const proposal_ids = proposals.map((p) => p.proposal_id);
  const human_node_completed = proposal_ids.length > 0;

  const reasons = [];
  if (!human_node_completed) {
    reasons.push(
      "该机会在 MD-12 无研究建议行：人工节点（M1 F-03，PM 选机会＋提研究问题）尚未完成" +
        "——按 TC-I-M3-001，此时不得交接、M4 不被调用。",
    );
  }

  return {
    opportunity_id: oid,
    required_node: { ...HANDOFF_NODE },
    human_node_completed,
    proposal_ids,
    proposals: proposals.map((p) => ({
      proposal_id: p.proposal_id,
      research_question: p.research_question,
      behavior_hypothesis: p.behavior_hypothesis ?? null,
      population_limit: p.population_limit ?? null,
      goal_version_no: p.goal_version_no,
      submitted_at: p.submitted_at,
      submitted_by: p.submitted_by,
      triggered_task_id: p.triggered_task_id ?? null,
    })),
    can_handoff: human_node_completed,
    auto_handoff: false, // 恒 false：衔接必须经人工节点，绝不自动
    blocked_by: human_node_completed ? null : "human_node",
    reasons,
  };
}

/**
 * **反向问 PM**：必要信息缺失时列出请补项（F-17「必要信息可能需要 Agent 反过来问 PM」）。
 * 只补要查清的内容、不要求重填已有材料（承接 M1 F-03 口径）；不静默回退、不编造。
 * @returns {Promise<object>} `{ ask_pm, to:'PM', requests:[{field,label,why,ask}], note }`
 */
export async function collectSupplementRequests(db, { opportunity_id } = {}) {
  const oid = norm(opportunity_id);
  if (!oid) throw new Error("collectSupplementRequests：opportunity_id 必填");
  const opportunity = await getOpportunity(db, oid);
  if (!opportunity) throw new Error(`机会不存在：${oid}`);

  const assessment = assessOpportunitySixElements(opportunity);
  const links = await listEvidenceByOpportunity(db, oid);

  const requests = [];
  for (let i = 0; i < assessment.missing.length; i += 1) {
    requests.push({
      field: assessment.missing[i],
      label: assessment.missing_labels[i],
      why: "机会六要素不齐（缺该项）",
      ask: "请补齐该要素后再进入人工节点——Agent 与 PM 均不替业务方另定口径。",
    });
  }
  if (assessment.unknown_state === UNKNOWN_ITEM_STATES.NOT_ASSESSED) {
    requests.push({
      field: "unknown_item",
      label: "未知项",
      why: "未知项未评估（NULL）",
      ask: "请标注「尚未知 / 待验证」的项；若已评估且确无，请明确填「已评估且确无」（空串）。",
    });
  }
  if (links.length === 0) {
    requests.push({
      field: "initial_basis",
      label: "初步依据",
      why: "该机会暂无关联证据（LNK-01）",
      ask: "请补充初步依据（来源 / 条件 / 时点 / 适用范围）后再由此进入人工节点。",
    });
  }

  return {
    opportunity_id: oid,
    ask_pm: requests.length > 0,
    to: "PM",
    requests,
    note: "必要信息缺失时由 Agent 反向问 PM（只补要查清的内容）；不静默回退、不编造。",
  };
}

/**
 * **组装交接包**（F-17 主入口）：M3 产出 → PM 决策上下文 + 人工节点守卫 + 请补项 + 交接物。
 * **只组装、不触发**：`handoff` 非空时也只给出「由 M1 F-04 消费」的入口提示文字，绝不代为启动 M4。
 * @returns {Promise<object>} `{ pm_decision_context, handoff_gate, supplement, handoff|null, blocked_by, auto_handoff:false, no_auto_handoff:true }`
 */
export async function composeHandoffPackage(db, { opportunity_id } = {}) {
  const oid = norm(opportunity_id);
  if (!oid) throw new Error("composeHandoffPackage：opportunity_id 必填");

  const pm_decision_context = await assemblePmDecisionContext(db, { opportunity_id: oid });
  const handoff_gate = await evaluateHandoffGate(db, { opportunity_id: oid });
  const supplement = await collectSupplementRequests(db, { opportunity_id: oid });

  const ready = handoff_gate.can_handoff === true;
  const latest = ready ? handoff_gate.proposals[handoff_gate.proposals.length - 1] : null;

  return {
    opportunity_id: oid,
    pm_decision_context,
    handoff_gate,
    supplement,
    // 交接物：**只组装、不触发**。非空代表「人工节点已完成，PM 的对话过程已结构化为建议」，
    // 可作为 M4 的输入前提；实际启动仍由 M1 F-04 执行。
    handoff: ready
      ? {
          triggered_by: "human_node",
          proposal_id: latest.proposal_id,
          proposal_ids: handoff_gate.proposal_ids,
          // 第二阶段的输入前提（由 M1 F-04 消费）：研究问题 / 可选假设 / 人群限制 / 机会版本
          research_question: latest.research_question,
          behavior_hypothesis: latest.behavior_hypothesis,
          population_limit: latest.population_limit,
          goal_version_no: latest.goal_version_no,
          submitted_at: latest.submitted_at,
          submitted_by: latest.submitted_by,
          already_triggered: latest.triggered_task_id !== null && latest.triggered_task_id !== undefined,
          triggered_task_id: latest.triggered_task_id ?? null,
          downstream_entry: "M1 F-04（建议提交后启动 HVA 任务）——本编排只给入口提示，不调用。",
        }
      : null,
    blocked_by: ready ? null : "human_node",
    auto_handoff: false,
    no_auto_handoff: true,
    note: NO_AUTO_HANDOFF_NOTE,
  };
}
