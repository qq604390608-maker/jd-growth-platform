/**
 * 文档卡（阶段4 · M3 · F-14 围绕目标寻找线索 · 2026-09-20）
 * 上游：../../../docs/02-prd/PRD-M3-机会发现Agent.md（F-14 §「围绕目标寻找线索」：S-A1 发现任务调度＋S-A3 旅程线索归纳；
 *        线索须关联具体人群/用户旅程，记录「谁在什么环节遇到什么现象」而非罗列变化｜L74-75 数据源 CDP/HJE/MKT/ACT 与 TOL-01~06）
 *   ｜ ../../../docs/05-test-cases/test-M3.md（**TC-U-M3-001**（L1·F-14/F-15：意向分归一 min(raw/threshold,1)）｜
 *        **TC-A-M3-001**（L4·F-14：S-A1 一阶段注入清单→查证计划＋逐项结果，停止条件＝计划内查证完成或依据已足够）｜
 *        **TC-A-M3-003**（L4·F-14：S-A3 按「谁在什么环节遇到什么现象」组织线索，每条线索均有人群或环节归属））
 *   ｜ ../../../docs/01-brd/BRD.md §4 F-14（接收目标/背景/可用来源/历史研究，围绕目标决定先查看哪些信息）｜ §4 验收（线索对人群差异停留在发现现象）
 *   ｜ ../../../docs/03-locks/external-deps.md（A-1 LLM ⬜ 未提供——最大风险；TOL-01/02/04/05/06 工具契约未定，mock 推进）
 *   ｜ ../../../docs/04-plan/dev-plan.md（阶段4 · M3：F-13~F-17）
 * 职责：F-14 线索寻找编排——M3 机会发现 Agent 的「找线索」核心纯逻辑。
 *   - `normalizeIntentionScore`（TC-U-M3-001 确定性纯函数）
 *   - `assembleDiscoveryPlan`（S-A1 发现任务调度：把一阶段注入清单装配成「先查什么、后查什么」的确定性查证计划）
 *   - `summarizeCluesAsJourney`（S-A3 旅程线索归纳：把查证事实集合按人群/旅程环节归类）
 *   - `loadDiscoveryContext`（薄读函数：复用 shared-context 读面装配一阶段注入清单，**不新增写面**）
 * 硬红线：① **零外部调用**（不发起 HTTP / 不调 LLM——A-1 门禁只挡推理，本文件编排层以确定性规则 + mock 推进，断言只锁结构契约）；
 *   ② **零写库**：本文件所有导出均为纯计算 + 读面复用，**不 INSERT/UPDATE/DELETE** 任何表；
 *   ③ 不复制中文枚举（数据源/工具值域来自 PRD 与 external-deps，不内联业务字典）。
 * 边界（mock/demo 推进，demo 值不进断言）：S-A1/S-A3 真实运行须 LLM（A-1），在门禁关闭前本文件提供**确定性 fallback 编排**，
 *   断言只验证「输出结构契约（有序计划 / 每条线索有归属）」，不验证真实 LLM 产出。TC-A-M3-001/003 的 LLM 产出契约登记为「门禁未关闭、非发布门禁」。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f14.mjs）。
 *
 * 用法：import { normalizeIntentionScore, assembleDiscoveryPlan, summarizeCluesAsJourney, loadDiscoveryContext } from "./discovery.js";
 */

import {
  getTaskContext,
  getResearch,
} from "../shared-context/index.js";

/**
 * 意向分归一（TC-U-M3-001）。确定性、无随机。
 * @param {number} raw 原始意向分
 * @param {number} threshold 阈值（默认 1.0）
 * @returns {number} min(raw/threshold, 1)，封顶 1；threshold≤0 时回退为 raw 本身（防御除零）
 */
export function normalizeIntentionScore(raw, threshold = 1.0) {
  if (threshold <= 0) return raw;
  const v = raw / threshold;
  return Math.min(v, 1);
}

/**
 * 默认查证顺序模板（确定性领域规则，mock 推进）。
 * 顺序依据：先查最可能产生「人群差异」与「行为变化」的基础事实（CDP/HJE），再查反馈与业务信息（MKT/ACT）。
 * 与 PRD-M3 L74-75 数据源（CDP/HJE/MKT/ACT）及 TOL-01~06 一一对应。
 */
const DEFAULT_CHECK_SEQUENCE = [
  {
    check_item: "人群已有行为差异",
    data_source: "CDP",
    tool: "cdp.crowd.query / cdp.tag.distribution",
    reason: "先确认目标人群是否存在可解释的差异分层，是后续线索的基础",
  },
  {
    check_item: "经营表现变化",
    data_source: "HJE",
    tool: "hje.traffic.entry / hje.slot.exposure / hje.path.conversion",
    reason: "在人群差异基础上叠加行为/转化路径，定位现象发生在哪一环节",
  },
  {
    check_item: "用户反馈与活动信息",
    data_source: "MKT",
    tool: "mkt.feedback.query",
    reason: "补充用户主观反馈，验证现象是否被真实感知",
  },
  {
    check_item: "新业务信息与触达",
    data_source: "ACT",
    tool: "act.campaign.touch",
    reason: "确认近期业务动作是否构成现象的外部触发，避免误归因",
  },
];

/**
 * S-A1 发现任务调度：把一阶段注入清单装配成「先查什么、后查什么」的确定性查证计划。
 * 输入是已读好的注入清单对象（消费 M2 背景/来源/历史；不在此写库）。
 * @param {object} injection { goal, scope?, background?, history?, capabilities?, sources? }
 * @returns {{ goal:string, scope?:string, plan:Array, stop_condition:string, sources_used:string[] }}
 *   plan 每一项：{ step_no, check_item, data_source, tool, reason, stop_when_enough }
 */
export function assembleDiscoveryPlan(injection) {
  const { goal, scope, background, history, capabilities, sources } = injection || {};
  if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
    throw new Error("assembleDiscoveryPlan 缺必填项：goal（目标文本）");
  }

  // 可用数据源（调用方传入则过滤模板，否则用默认全集）
  const wanted = Array.isArray(sources) && sources.length > 0
    ? DEFAULT_CHECK_SEQUENCE.filter((s) => sources.includes(s.data_source))
    : DEFAULT_CHECK_SEQUENCE.slice();

  // 依据能力说明裁剪：若传入 capabilities 且不含 clue-scan 类，仍保留计划但标注能力受限
  const capabilityNote = Array.isArray(capabilities) && capabilities.length > 0
    ? `已登记能力：${capabilities.join("、")}`
    : "未显式登记能力，按默认工具集规划";

  const plan = wanted.map((s, i) => ({
    step_no: i + 1,
    check_item: s.check_item,
    data_source: s.data_source,
    tool: s.tool,
    reason: s.reason,
    // 停止条件表达：默认「当本步查证结果已能解释目标现象时，可提前停止」
    stop_when_enough:
      i === wanted.length - 1
        ? "计划内查证全部完成，或任一步结果已足以支撑线索归纳时提前停止"
        : "本步结果已能解释目标现象时，可跳过后续步骤",
  }));

  if (plan.length === 0) {
    throw new Error("assembleDiscoveryPlan：sources 须为 CDP/HJE/MKT/ACT 之一，当前未命中任何已定义数据源");
  }

  // 停止条件（S-A1 验收：计划内查证完成 或 依据已足够）
  const stop_condition =
    "停止条件＝计划内查证完成，或任一步已获得足够依据（stop_when_enough 命中）——不强制跑满全部步骤";

  return {
    goal: goal.trim(),
    scope: scope || null,
    background: background || null,
    history_count: Array.isArray(history) ? history.length : 0,
    capability_note: capabilityNote,
    plan,
    stop_condition,
    sources_used: wanted.map((s) => s.data_source),
  };
}

/**
 * S-A3 旅程线索归纳：把查证事实集合按「谁在什么环节遇到什么现象」组织为线索。
 * 每条有效线索必须带有「人群归属」或「旅程环节归属」，禁止把裸变化罗列为有效线索。
 * @param {Array} factSet 每个 fact：{ fact_id, audience?, journey_stage?, phenomenon, evidence_ref? }
 * @returns {{ clues:Array, unattributed_count:number }}
 *   clues 每一项：{ attribution, phenomenon, evidence_refs[] }；attribution 形如 "audience:年轻妈妈" 或 "journey:支付"
 */
export function summarizeCluesAsJourney(factSet) {
  if (!Array.isArray(factSet)) {
    throw new Error("summarizeCluesAsJourney 入参须为 fact 数组");
  }
  const clues = [];
  let unattributed_count = 0;

  for (const fact of factSet) {
    const hasAudience = !!fact.audience && String(fact.audience).trim().length > 0;
    const hasStage = !!fact.journey_stage && String(fact.journey_stage).trim().length > 0;
    // 裸变化（既无人群也无环节归属）→ 不进入有效线索，单独计数
    if (!hasAudience && !hasStage) {
      unattributed_count += 1;
      continue;
    }
    const attribution = hasAudience
      ? `audience:${String(fact.audience).trim()}`
      : `journey:${String(fact.journey_stage).trim()}`;
    clues.push({
      attribution,
      phenomenon: fact.phenomenon || "(现象未描述)",
      evidence_refs: fact.evidence_ref ? [fact.evidence_ref] : [],
    });
  }

  return { clues, unattributed_count };
}

/**
 * 薄读函数：从任务上下文装配一阶段注入清单（复用 shared-context 读面，**本文件不新增写面**）。
 * @param {object} db D1 形态（prepare().bind().all()/first()）
 * @param {string} task_id
 * @returns {Promise<object>} 注入清单 { goal, scope, background, history, capabilities, sources }
 */
export async function loadDiscoveryContext(db, task_id) {
  const ctx = await getTaskContext(db, task_id); // { ...buildTaskContext, injections }
  const sections = Array.isArray(ctx.sections) ? ctx.sections : [];
  // F-14 取值缺陷修复（2026-09-20）：原实现读 ctx.goal/background/capabilities/sources
  // 顶层键，但 getTaskContext 实际返回 sections[]（按 CFG-06 模板分组）＋ scope，无这四个顶层键；
  // 真实数据须从 sections 按 context_type_code 取（对齐 F-19 research-start.js:355）。
  const sectionItems = (code) => {
    const s = sections.find((x) => x.context_type_code === code);
    return s && Array.isArray(s.items) ? s.items : [];
  };
  const scope = ctx.scope || {};
  const research_no = scope.research_no || null;
  let history = [];
  if (research_no) {
    const research = await getResearch(db, research_no);
    if (research) history = [research.research_question || research_no];
  }
  return {
    goal: sectionItems("goal"),
    scope,
    background: sectionItems("background"),
    history,
    capabilities: sectionItems("source"),
    sources: sectionItems("source"),
  };
}
