/**
 * 文档卡（阶段4 · M3 · F-14 围绕目标寻找线索 · 2026-09-20）
 * 上游：../../../docs/02-prd/PRD-M3-机会发现Agent.md（F-14 §「围绕目标寻找线索」：S-A1 发现任务调度＋S-A3 旅程线索归纳；
 *        线索须关联具体人群/用户旅程，记录「谁在什么环节遇到什么现象」而非罗列变化｜L74-75 数据源 CDP/HJE/MKT/ACT 与 TOL-01~06）
 *   ｜ ../../../docs/05-test-cases/test-M3.md（**TC-U-M3-001**（L1·F-14/F-15：意向分归一 min(raw/threshold,1)）｜
 *        **TC-A-M3-001**（L4·F-14：S-A1 一阶段注入清单→查证计划＋逐项结果，停止条件＝计划内查证完成或依据已足够）｜
 *        **TC-A-M3-003**（L4·F-14：S-A3 按「谁在什么环节遇到什么现象」组织线索，每条线索均有人群或环节归属））
 *   ｜ ../../../docs/01-brd/BRD.md §4 F-14（接收目标/背景/可用来源/历史研究，围绕目标决定先查看哪些信息）｜ §4 验收（线索对人群差异停留在发现现象）
 *   ｜ ../../../docs/03-locks/external-deps.md（A-1 LLM ✅ 已接入 Workers AI；TOL-01/02/04/05/06 工具契约未定，mock 推进）
 *   ｜ ../../../docs/04-plan/dev-plan.md（阶段4 · M3：F-13~F-17）
 * 职责：F-14 线索寻找编排——M3 机会发现 Agent 的「找线索」核心。
 *   - `normalizeIntentionScore`（TC-U-M3-001 确定性纯函数）
 *   - `assembleDiscoveryPlan`（S-A1 发现任务调度：确定性 fallback）
 *   - `summarizeCluesAsJourney`（S-A3 旅程线索归纳：确定性 fallback）
 *   - `loadDiscoveryContext`（薄读函数：复用 shared-context 读面装配一阶段注入清单）
 *   - `runDiscoveryWithLLM`（**A-1 LLM 驱动版**：chatWithTools → function calling 循环 → 线索归纳 → 机会形成）
 * 硬红线：① **LLM 只做推理判断，不代替 tool-executor 的真实返回**（BR-04）；
 *   ② **零自有写语句**——查询落痕（EXT-01）**委托** `../tool-executor` 的 `recordQuery` 单一写面，
 *      本文件不含任何 INSERT/UPDATE/DELETE 与裸 SQL（故 test-f14 的「零写」静态断言仍然成立）；
 *   ③ 无 `ai` binding 时不进入 LLM 路径（**A-1 门禁**，降级为确定性 fallback）。
 *   ② **零写库**：本文件所有导出均为纯计算 + 读面复用，**不 INSERT/UPDATE/DELETE** 任何表；
 *   ③ 不复制中文枚举（数据源/工具值域来自 PRD 与 external-deps，不内联业务字典）。
 * 边界：有 `ai` binding 时走 LLM 路径；无 `ai` 时降级为确定性 fallback（原有逻辑不变）。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f14.mjs）。
 *
 * 用法：import { normalizeIntentionScore, assembleDiscoveryPlan, summarizeCluesAsJourney, loadDiscoveryContext, runDiscoveryWithLLM } from "./discovery.js";
 */

import {
  getTaskContext,
  getResearch,
} from "../shared-context/index.js";
import { chatWithTools, chatJSON, MODELS } from "./llm-client.js";

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

// ================================================================== A-1 LLM 驱动版

/**
 * Discovery Agent 的系统指令（agent-runtime/discovery/agent.md 本体的精简版，供 LLM 消费）。
 * 不复制 agent.md 全文——只提取 LLM 做判断所需的关键约束。
 */
const DISCOVERY_SYSTEM_PROMPT = `你是京东超市新客复购场景的机会发现研究员（discovery-agent）。

## 核心职责
围绕业务目标在已有数据中寻找线索、形成值得研究的机会。
研究完成前一律称「候选行为/机会」，不提前定性；机会是否成立由 HVA 分析判定，你只负责「发现」。

## 工作方式
1. 理解业务目标与背景
2. 决定先查什么、后查什么（优先 CDP/HJE 基础事实，再 MKT/ACT 补充）
3. 调用工具查询（经 tool_executor，禁止以模型预期代替查询结果）
4. 对结果做五项检查：来源/适用范围/时点/已有机会/信息缺口
5. 按「谁在什么环节遇到什么现象」归纳线索（每条必须有人群或环节归属）
6. 形成机会六要素或记录信息缺口

## 输出格式
必须返回 JSON，结构如下：
{
  "clues": [
    { "attribution": "audience:xxx 或 journey:xxx", "phenomenon": "现象描述", "evidence_refs": ["查询ID"] }
  ],
  "opportunities": [
    {
      "target_object": "涉及对象",
      "observation": "观察现象",
      "preliminary_evidence": "初步依据",
      "research_reason": "研究理由",
      "unknown_items": ["未知项1", "未知项2"]
    }
  ],
  "gaps": ["信息缺口1", "信息缺口2"],
  "summary": "本轮发现总结"
}

## 硬红线
- 查询结果原样引用，不编造数据
- 不输出活动配置、权益组合、预算与排期
- 对现象的解释一律标明「尚未验证」
- 依据不足时只记缺口，不强行形成机会`;

/**
 * 工具定义：供 LLM function calling 使用（对齐 external-deps.md §5 TOL-01~06）。
 * 工具名与 tool_registry 种子数据一致。
 */
export const DISCOVERY_TOOLS = [
  {
    type: "function",
    function: {
      name: "cdp_crowd_query",
      description: "查询人群规模与标签分布（CDP）。用于确认目标人群是否存在可解释的差异分层。",
      parameters: {
        type: "object",
        properties: {
          crowd_condition: { type: "string", description: "人群圈选条件" },
          tags: { type: "array", items: { type: "string" }, description: "要查看的标签列表" },
        },
        required: ["crowd_condition"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hje_traffic_entry",
      description: "查询入口维度流量与转化（HJE）。按入口类型/时段/品类取流量与转化，用于入口差异观察。",
      parameters: {
        type: "object",
        properties: {
          entry_type: { type: "string", description: "入口类型（搜索/推荐/活动等）" },
          period: { type: "string", description: "时段" },
          category: { type: "string", description: "品类" },
        },
        required: ["entry_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hje_slot_exposure",
      description: "查询坑位曝光与点击（HJE）。取坑位级曝光与点击，用于触点效果观察。",
      parameters: {
        type: "object",
        properties: {
          slot_id: { type: "string", description: "坑位ID" },
          period: { type: "string", description: "时段" },
        },
        required: ["slot_id"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "hje_path_conversion",
      description: "查询路径转化（HJE）。取路径转化，用于旅程环节的流量观察。",
      parameters: {
        type: "object",
        properties: {
          path_type: { type: "string", description: "路径类型" },
          period: { type: "string", description: "时段" },
        },
        required: ["path_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "mkt_feedback_query",
      description: "查询用户反馈（MKT）。补充用户主观反馈，验证现象是否被真实感知。",
      parameters: {
        type: "object",
        properties: {
          feedback_type: { type: "string", description: "反馈类型（评价/投诉/咨询）" },
          period: { type: "string", description: "时段" },
        },
        required: ["feedback_type"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "act_campaign_touch",
      description: "查询活动触达信息（ACT）。确认近期业务动作是否构成现象的外部触发。",
      parameters: {
        type: "object",
        properties: {
          campaign_type: { type: "string", description: "活动类型" },
          period: { type: "string", description: "时段" },
        },
        required: ["campaign_type"],
      },
    },
  },
];

/**
 * 工具执行器：把 LLM 的 function call 路由到 tool-executor 的真实查询。
 * 每个工具调用经 tool-executor 权限检查 + 真实执行，返回结果原样回传给 LLM。
 *
 * @param {object} db D1
 * @param {string} task_id 当前任务 ID（tool-executor 落痕需要）
 * @param {string} grantee_type 授权对象类型
 * @param {string} grantee_ref 授权对象引用
 * @returns {Function} async (toolName, args) => result
 */
export function createDiscoveryToolExecutor(db, task_id, grantee_type, grantee_ref) {
  // 工具名 → tool_code 映射（对齐 CFG-02 种子数据）
  const TOOL_CODE_MAP = {
    cdp_crowd_query: "cdp.crowd.query",
    hje_traffic_entry: "hje.traffic.entry",
    hje_slot_exposure: "hje.slot.exposure",
    hje_path_conversion: "hje.path.conversion",
    mkt_feedback_query: "mkt.feedback.query",
    act_campaign_touch: "act.campaign.touch",
  };

  return async (toolName, args) => {
    const tool_code = TOOL_CODE_MAP[toolName];
    if (!tool_code) {
      return { error: `未知工具：${toolName}` };
    }

    // 动态导入 tool-executor（避免循环依赖）
    const { recordQuery } = await import("../tool-executor/index.js");

    try {
      const result = await recordQuery(db, {
        tool_code,
        grantee_type,
        grantee_ref,
        query_condition: args,
        task_id,
      });

      // 原样返回查询结果（不编造、不替代）
      if (result.persisted) {
        return {
          query_id: result.query_id,
          status: result.envelope?.result_status || "unknown",
          summary: result.envelope?.result_summary || null,
          rows: result.envelope?.returned_rows ?? null,
          restricted: result.envelope?.restricted_flag === 1,
          fail_reason: result.envelope?.fail_reason || null,
        };
      }
      return { status: "not_persisted", skip: result.persist_skip };
    } catch (err) {
      return { error: String(err?.message || err) };
    }
  };
}

/**
 * LLM 驱动的机会发现主流程（A-1 接入后的正式路径）。
 *
 * 流程：
 * 1. 从 D1 加载一阶段注入清单
 * 2. 调 LLM（chatWithTools）：LLM 规划查证路径 → 调用工具 → 分析结果 → 生成线索与机会
 * 3. 返回结构化输出（线索 + 机会 + 缺口）
 *
 * @param {Ai} ai Workers AI binding（env.AI）
 * @param {object} db D1
 * @param {string} task_id 发现任务 ID
 * @param {object} [opts]
 * @param {string} [opts.model] 模型名
 * @param {string} [opts.grantee_type] 授权对象类型（默认 "agent"）
 * @param {string} [opts.grantee_ref] 授权对象引用（默认 "discovery-agent"）
 * @returns {Promise<{ content: object, tool_calls_executed: Array, rounds: number }>}
 */
export async function runDiscoveryWithLLM(ai, db, task_id, opts = {}) {
  // A-1 门禁：无 binding 时**默认拒跑**——生产漏配 binding 必须响亮失败，
  // 不得静默产出伪造结果（红线「真实返回 / 失败不否定结论」；2026-09-20 查证
  // ci.yml 部署步为 `wrangler deploy` 原样使用 wrangler.toml，**不存在**追加
  // binding 的机制，故 [ai] 缺失即生产 env.AI = undefined）。
  // 本地零密钥调试须**显式**传 opts.mock = true 才走 mock 路径（输出带 _mock
  // 标记、零写库——llm-client 的 mock 工具执行不触注入的 toolExecutor）。
  if (!ai && opts.mock !== true) {
    throw new Error("runDiscoveryWithLLM：ai binding 不能为空（A-1 未接入）。本地零密钥调试请显式传 opts.mock = true");
  }

  const model = opts.model || MODELS.FLASH;
  const grantee_type = opts.grantee_type || "agent";
  const grantee_ref = opts.grantee_ref || "discovery-agent";

  // 1. 加载注入清单（显式 mock 模式下任务不存在时用默认清单，不报错；
  //    走到这里而无 ai 时必为 opts.mock === true——上方门禁已拦住其余情形）
  let injection;
  try {
    injection = await loadDiscoveryContext(db, task_id);
  } catch (err) {
    if (!ai) {
      // 显式 mock 模式：用默认注入清单
      injection = {
        goal: [{ goal_name: "京东超市新客复购率提升", goal_description: "mock 目标" }],
        scope: {},
        background: [],
        history: [],
        capabilities: [],
        sources: ["CDP-MOCK", "HJE-MOCK"],
      };
    } else {
      throw err;
    }
  }

  // 构造用户消息：把注入清单翻成 LLM 可消费的文本
  const userMessage = [
    `## 业务目标`,
    JSON.stringify(injection.goal, null, 2),
    injection.scope ? `\n## 范围\n${JSON.stringify(injection.scope, null, 2)}` : "",
    injection.background?.length > 0 ? `\n## 业务背景\n${injection.background.map((b) => typeof b === "string" ? b : JSON.stringify(b)).join("\n")}` : "",
    injection.history?.length > 0 ? `\n## 历史研究\n${injection.history.join("\n")}` : "",
    injection.sources?.length > 0 ? `\n## 可用数据源\n${injection.sources.join("、")}` : "",
    `\n## 任务`,
    `请围绕以上目标，决定先查什么、后查什么，调用工具查询，并归纳线索与机会。`,
    `每条线索必须说明「谁在什么环节遇到什么现象」。`,
    `依据不足时只记缺口，不强行形成机会。`,
  ].filter(Boolean).join("\n");

  // 2. 调 LLM（chatWithTools 循环）
  const toolExecutor = createDiscoveryToolExecutor(db, task_id, grantee_type, grantee_ref);

  const result = await chatWithTools(
    ai,
    DISCOVERY_SYSTEM_PROMPT,
    userMessage,
    DISCOVERY_TOOLS,
    toolExecutor,
    { model, max_rounds: 8 },
  );

  // 3. 解析 LLM 最终回答为结构化 JSON
  let parsed;
  try {
    parsed = typeof result.content === "string" ? JSON.parse(result.content) : result.content;
  } catch {
    // LLM 未返回合法 JSON → 包装为非结构化结果
    parsed = {
      clues: [],
      opportunities: [],
      gaps: ["LLM 返回内容无法解析为结构化 JSON"],
      summary: result.content || "(无内容)",
      _parse_error: true,
    };
  }

  return {
    content: parsed,
    tool_calls_executed: result.tool_calls_executed,
    rounds: result.rounds,
    stopped_by: result.stopped_by,
  };
}
