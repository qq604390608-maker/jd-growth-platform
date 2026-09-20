/**
 * 文档卡（阶段4 · M4 · F-18 角色指令配置 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md（§1.1.1 角色指令：职责/输入/工作方式/输出/结束条件｜§1.1.2 公共业务指令 8 条｜F-18 角色指令配置）
 *   ｜ ../../docs/05-test-cases/test-M4.md（**TC-C-M4-001**（L2·F-18/F-21：七要素结构化 JSON + 硬红线「不含活动配置/权益/预算/排期」——推理契约受 A-1 门禁，本文件只提供**可运行的边界扫描器**，该 oracle 项登记为「门禁未关闭、非发布门禁」）｜
 *        **TC-I-M4-002**（L5·F-18/F-20：查询链路经 M5 只读、不调生产写——本文件零外部调用、零写库））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-18（验收要点：结束条件＝形成有依据的研究回答 / 说明无法完成判断的原因）｜ §5.2 out of scope｜ §5.3 硬红线｜ §7 第 4 条（运行失败不作为否定研究的依据）
 *   ｜ ../../docs/03-locks/schema.md（MD-13 agent_profile、MD-14 skill_registry、§12 Q-07 已决 S-B1↔hva-five-checks↔AGP-HVA）
 *   ｜ ../../docs/03-locks/external-deps.md（A-1 LLM ⬜ 未提供（最大风险）；A-3 指令加载与版本管理＝F-13/F-18/F-06/F-32）
 *   ｜ ../../docs/04-plan/dev-plan.md（阶段4 · M4：F-18~F-22；agent-runtime 本体落地归 M3/M4）
 *   ｜ ../../agent-runtime/hva/agent.md（角色指令**本体**，F-18 落地）｜ ../../agent-runtime/business-rules.md（公共业务指令**本体** 8 条）
 *   ｜ ./profile.js（**F-13 读面复用**：getAgentProfile / listAgentSkills / composeAgentVersionSnapshot；本文件不新增写面）
 * 职责：F-18 角色指令配置的**运行期装载与结束条件判定**——把「agent.md（你是谁）+ business-rules.md（行为边界）+ MD-13/MD-14（版本登记）」组装成运行期角色指令包，
 *   并把 F-18 验收要点「结束条件二选一」做成确定性判定（`evaluateResearchClosure`）。
 * 硬红线：① **零外部调用**（不发 HTTP / 不调 LLM——A-1 门禁只挡推理，不挡本文件的装载与判定）；② **零写库、零裸 SQL**（MD-13/MD-14 写入面在 F-13 `profile.js`，本文件只读）；
 *   ③ **不复制第二个口径**：角色指令与公共业务指令的**叙述文本本体在 `agent-runtime/`**，本文件只持「段落键/指令编号 + 判据键 + 来源回指」；
 *   ④ 「产品假设不预先作为研究结论」「运行失败不作为否定研究的依据」做成**可运行判据**，不止写在注释里。
 * 边界：只做 F-18（装载 + 结束条件 + 假设性质 + 输出边界扫描）；F-19 三分支路径选择、F-20 五查、F-21 七要素组装、F-22 追问承接不在本文件。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f18.mjs）。
 *
 * 用法：import { loadAgentRole, evaluateResearchClosure, labelProductHypothesis, scanProductionActions } from "./role.js";
 */
import {
  getAgentProfile,
  listAgentSkills,
  composeAgentVersionSnapshot,
} from "./profile.js";

/** HVA 分析 Agent 的对外代号（MD-13 种子 `AGP-HVA` / `agent_code='hva-agent'`）。 */
export const HVA_AGENT_CODE = "hva-agent";

/** 角色指令本体落位（叙述文本真源；本文件不复制文本）。 */
export const ROLE_DOC = "agent-runtime/hva/agent.md";

/** 公共业务指令本体落位（8 条叙述文本真源；本文件只持编号与判据键）。 */
export const BUSINESS_RULES_DOC = "agent-runtime/business-rules.md";

/**
 * 角色指令段落（顺序＝ agent.md 章节顺序；对应 PRD-M4 §1.1.1）。
 * 只持键名 / 标题 / 来源锚点——**不含叙述文本**，避免出现第二个口径。
 */
export const ROLE_SECTIONS = [
  { key: "responsibility", title: "职责", source: `${ROLE_DOC}#职责` },
  { key: "input", title: "输入", source: `${ROLE_DOC}#输入` },
  { key: "method", title: "工作方式", source: `${ROLE_DOC}#工作方式` },
  { key: "output", title: "输出", source: `${ROLE_DOC}#输出` },
  { key: "closure", title: "结束条件", source: `${ROLE_DOC}#结束条件` },
];

/**
 * 公共业务指令（`business-rules.md` 8 条）的编号与判据键——与本体逐条对齐（`test-f18` ① 断言 8 条且与本体有序列表逐项对应）。
 * 只持编号 / 标题 / 判据键，**不复制叙述文本**。
 */
export const BUSINESS_RULE_IDS = [
  { rule_id: "BR-01", title: "关键发现有据", key: "evidence_linked" },
  { rule_id: "BR-02", title: "性质分别标明", key: "nature_labeled" },
  { rule_id: "BR-03", title: "边界与原则", key: "scope_principles" },
  { rule_id: "BR-04", title: "查询经工具执行程序", key: "query_via_tool_executor" },
  { rule_id: "BR-05", title: "引用证据须带四要素", key: "evidence_four_elements" },
  { rule_id: "BR-06", title: "不替业务方定口径", key: "no_metric_definition" },
  { rule_id: "BR-07", title: "输出止于判断与限制", key: "no_production_actions" },
  { rule_id: "BR-08", title: "不调生产写接口", key: "no_production_write" },
];

/** 结束条件（PRD-M4 F-18 验收要点）：二者之一成立即可结束。 */
export const CLOSURE_KINDS = Object.freeze({
  RESEARCH_ANSWER: "research_answer",
  LIMITATION_STATED: "limitation_stated",
});

/** 研究回答的立场（用于 BRD §7 第 4 条：失败导致的未完成不得作为否定依据）。 */
export const ANSWER_STANCES = Object.freeze({ SUPPORT: "support", UNSUPPORT: "unsupport" });

/** 判断性质（BRD §6 术语口径）：研究完成前一律称「候选行为」，假设不预先当结论。 */
export const STATEMENT_NATURES = Object.freeze({
  HYPOTHESIS: "hypothesis",
  TENTATIVE: "tentative",
  FINDING: "finding",
  LIMITATION: "limitation",
});

/**
 * 输出边界禁词（PRD-M4 §1.1.2 第 7 条 + BRD §5.2 out of scope）：
 * 研究输出止于「有依据的判断＋限制＋改善方向」，**不含活动配置 / 权益组合 / 预算 / 排期**。
 * 服务端可运行的对照表——`scanProductionActions` 据此扫描产出文本。
 */
export const FORBIDDEN_PRODUCTION_PATTERNS = Object.freeze(["活动配置", "权益组合", "预算", "排期"]);

const NOT_CONCLUSION_NOTE = "产品假设不预先作为研究结论（PRD-M4 F-19 ①）：假设须经查证后才可能成为研究发现。";
const FAILURE_NOT_NEGATION_NOTE = "运行失败不作为否定研究的依据（BRD §7 第 4 条）：失败导致的未完成不能当否定结论。";
const LIMITATION_LEGAL_NOTE = "说明无法完成判断的原因是合法结束（BRD §7 第 4 条），不被视为未完成。";

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";

/**
 * 装载运行期角色指令包（F-18）：读 MD-13 角色登记 + MD-14 生效 Skill（**复用 F-13 读面**），
 * 组装 agent.md 段落骨架（5 段）+ business-rules.md 指令编号（8 条）+ 结束条件与边界声明。
 * **只读**：不写 MD-13/MD-14（写面在 `profile.js`）。
 * @param {object} db D1 形态（prepare().bind().first()/all()）
 * @param {string} agent_code 默认 `hva-agent`
 * @returns {Promise<object>}
 */
export async function loadAgentRole(db, agent_code = HVA_AGENT_CODE) {
  if (!isNonEmptyText(agent_code)) throw new Error("角色指令装载必填：agent_code 不能为空");
  const profile = await getAgentProfile(db, agent_code);
  if (!profile) throw new Error(`角色指令不存在：${agent_code}`);
  const skills = await listAgentSkills(db, agent_code);
  const snapshot = await composeAgentVersionSnapshot(db, agent_code);
  return {
    agent_code: profile.agent_code,
    agent_name: profile.agent_name,
    agent_stage: profile.agent_stage,
    current_version: profile.current_version,
    doc_revision: profile.doc_revision,
    profile,
    skills,
    agent_version_snapshot: snapshot,
    role_doc: ROLE_DOC,
    business_rules_doc: BUSINESS_RULES_DOC,
    role_sections: ROLE_SECTIONS.map((s) => ({ ...s })),
    business_rules: BUSINESS_RULE_IDS.map((r) => ({ ...r })),
    closure: {
      kinds: [CLOSURE_KINDS.RESEARCH_ANSWER, CLOSURE_KINDS.LIMITATION_STATED],
      hypothesis_not_conclusion: true,
      failure_is_not_negation: true,
    },
    boundaries: {
      no_production_actions: true,
      no_production_write: true,
      query_via_tool_executor: true,
      candidate_behavior_until_done: true,
    },
  };
}

/**
 * 结束条件判定（PRD-M4 F-18 验收要点 / BRD §4 F-18）——确定性、无随机、不用模型替代判断：
 *   ① 有研究回答 **且** 带依据（`evidence_refs` 非空）→ `kind='research_answer'`，可结束；
 *   ② 无研究回答但有「无法完成判断的原因」→ `kind='limitation_stated'`，**同样可结束**（合法产出）；
 *   ③ 二者皆无 → **不结束**（`closed=false`，列出缺什么）。
 * 两条红线做成判据而非注释：
 *   - **产品假设不预先作为结论**：`answer_nature==='hypothesis'` 时**拒绝**当作研究回答；
 *   - **失败不否定结论**：`due_to_failure===true` 且回答是否定立场（`unsupport`）时**拒绝**结束，提示不得以失败当否定依据。
 * @param {object} input { research_answer, evidence_refs, answer_stance, due_to_failure, answer_nature, limitation_reason }
 * @returns {object}
 */
export function evaluateResearchClosure(input) {
  const p = input && typeof input === "object" ? input : null;
  if (!p) throw new Error("结束条件判定必填：入参须为对象");
  const answer = isNonEmptyText(p.research_answer) ? p.research_answer.trim() : null;
  const limitation = isNonEmptyText(p.limitation_reason) ? p.limitation_reason.trim() : null;
  const refs = Array.isArray(p.evidence_refs) ? p.evidence_refs.filter((r) => isNonEmptyText(r)) : [];
  const stance = p.answer_stance === ANSWER_STANCES.UNSUPPORT ? ANSWER_STANCES.UNSUPPORT : ANSWER_STANCES.SUPPORT;
  const dueToFailure = p.due_to_failure === true;
  const base = {
    evidence_count: refs.length,
    due_to_failure: dueToFailure,
    hypothesis_not_conclusion: true,
    failure_is_not_negation: true,
  };

  if (answer && p.answer_nature === STATEMENT_NATURES.HYPOTHESIS) {
    return {
      ...base, closed: false, kind: null, answer_stance: stance, negation_allowed: null,
      reason: `产品假设不得直接作为研究回答（answer_nature=hypothesis）——须先经候选行为检验。`,
      note: NOT_CONCLUSION_NOTE, missing: [],
    };
  }
  if (answer && refs.length === 0) {
    return {
      ...base, closed: false, kind: null, answer_stance: stance, negation_allowed: null,
      reason: "研究回答未关联任何实际取得的证据，不构成「有依据的研究回答」（公共业务指令 BR-01）。",
      note: "关键发现需要关联实际取得的证据；无依据时请改为说明限制（limitation_reason）。", missing: [],
    };
  }
  if (answer && stance === ANSWER_STANCES.UNSUPPORT && dueToFailure) {
    return {
      ...base, closed: false, kind: null, answer_stance: stance, negation_allowed: false,
      reason: "本次否定判定由查询/运行失败导致，不得作为否定研究的依据（BRD §7 第 4 条）。",
      note: `${FAILURE_NOT_NEGATION_NOTE}请保留已完成部分并说明受限，或改用 limitation_reason 结束。`, missing: [],
    };
  }
  if (answer) {
    return {
      ...base, closed: true, kind: CLOSURE_KINDS.RESEARCH_ANSWER, answer_stance: stance,
      negation_allowed: !dueToFailure,
      reason: null,
      note: "形成有依据的研究回答——每项关键发现须在组装结果时逐项关联证据（F-21）。", missing: [],
    };
  }
  if (limitation) {
    return {
      ...base, closed: true, kind: CLOSURE_KINDS.LIMITATION_STATED, answer_stance: null, negation_allowed: false,
      limitation_reason: limitation, reason: null,
      note: LIMITATION_LEGAL_NOTE, missing: [],
    };
  }
  return {
    ...base, closed: false, kind: null, answer_stance: null, negation_allowed: null,
    reason: "既未形成有依据的研究回答，也未说明无法完成判断的原因，本轮不得结束。",
    note: "结束条件二选一：形成有依据的研究回答 / 说明无法完成判断的原因。", missing: ["research_answer", "limitation_reason"],
  };
}

/**
 * 产品假设性质标注（PRD-M4 红线 2 / BRD §6 术语口径）：假设一律标为「假设」、**不是结论**，须经查证。
 * @param {object} hypothesis { text }（也可直接传字符串）
 * @returns {object}
 */
export function labelProductHypothesis(hypothesis) {
  const text = typeof hypothesis === "string" ? hypothesis : hypothesis && typeof hypothesis === "object" ? hypothesis.text : null;
  if (!isNonEmptyText(text)) throw new Error("产品假设标注必填：假设内容不能为空");
  return {
    text: text.trim(),
    nature: STATEMENT_NATURES.HYPOTHESIS,
    is_conclusion: false,
    must_verify: true,
    note: NOT_CONCLUSION_NOTE,
  };
}

/**
 * 输出边界扫描（PRD-M4 §1.1.2 第 7 条 / BRD §5.2 / TC-C-M4-001 硬红线的**可运行形式**）：
 * 扫描产出文本是否含活动配置 / 权益组合 / 预算 / 排期等生产动作类内容。
 * @param {string} text
 * @returns {object} { clean, hits: [{pattern, index}], patterns_checked }
 */
export function scanProductionActions(text) {
  if (typeof text !== "string") throw new Error("输出边界扫描必填：被扫描文本须为字符串");
  const hits = [];
  for (const pattern of FORBIDDEN_PRODUCTION_PATTERNS) {
    const index = text.indexOf(pattern);
    if (index >= 0) hits.push({ pattern, index });
  }
  return {
    clean: hits.length === 0,
    hits,
    patterns_checked: FORBIDDEN_PRODUCTION_PATTERNS.length,
    note: "研究输出止于「有依据的判断＋限制＋改善方向」，不输出活动配置、权益组合、预算与排期。",
  };
}
