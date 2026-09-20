/**
 * 文档卡（A-1 LLM 推理服务 · 2026-09-20）
 * 上游：../03-locks/tech-stack.md §2.5（DS-02 Cloudflare Workers AI）
 *   ｜ ../03-locks/external-deps.md §3 A-1（LLM 推理服务）
 *   ｜ ../01-brd/BRD.md §5.3 硬红线、§7 验收总则
 * 本文件：server/agent-orchestrator/llm-client.js
 *   封装 Workers AI Binding 调用 + function calling 循环 + mock 模式（env.AI 不存在时自动降级）
 * 硬红线：① 零写库 ② 零外部凭证 ③ 不替代查询结果
 */

const DEFAULT_MODEL = "@cf/deepseek/deepseek-v4-flash";
const MAX_TOOL_ROUNDS = 10;

// ================================================================== Mock 模式

function mockCompletion(content, toolCalls = []) {
  return {
    id: `mock-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: "mock-model",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: toolCalls.length > 0 ? "tool_calls" : "stop",
    }],
  };
}

function mockToolExecutor(toolName, args) {
  const mockResults = {
    cdp_crowd_query: { crowd_size: 125000, top_tags: ["复购率偏低", "价格敏感", "品类偏好:日百"], source: "CDP-MOCK" },
    hje_traffic_entry: { entries: [{ type: "搜索", uv: 45000, cvr: 3.2 }, { type: "推荐", uv: 32000, cvr: 5.8 }], source: "HJE-MOCK" },
    hje_slot_exposure: { slots: [{ id: "home-banner", exposure: 120000, click: 8500, ctr: 7.1 }], source: "HJE-MOCK" },
    hje_path_conversion: { paths: [{ name: "搜索-详情-加购-支付", conversion: 2.1 }, { name: "推荐-详情-支付", conversion: 4.5 }], source: "HJE-MOCK" },
    mkt_feedback_query: { feedbacks: [{ type: "价格投诉", count: 230 }, { type: "物流投诉", count: 180 }], source: "MKT-MOCK" },
    act_campaign_touch: { campaigns: [{ name: "周末秒杀", reach: 89000, touch_rate: 12.3 }], source: "ACT-MOCK" },
  };
  return mockResults[toolName] || { note: "mock: " + toolName, args };
}

function mockDiscoveryResponse() {
  return {
    clues: [
      { attribution: "audience:新客-价格敏感人群", phenomenon: "搜索入口新客复购率(3.2%)低于推荐入口(5.8%)", evidence_refs: ["MOCK-Q-001"] },
      { attribution: "journey:加购到支付", phenomenon: "加购到支付转化率仅2.1%，远低于推荐路径4.5%", evidence_refs: ["MOCK-Q-002"] },
    ],
    opportunities: [{
      target_object: "搜索入口新客的支付转化",
      observation: "搜索入口新客加购后支付转化率偏低",
      preliminary_evidence: "搜索路径转化 2.1% vs 推荐路径 4.5%（HJE-MOCK）",
      research_reason: "支付环节转化差异可能指向可干预机会点",
      unknown_items: ["是否受优惠券/价格策略影响", "支付环节具体卡点未知"],
    }],
    gaps: [],
    summary: "本轮发现搜索入口新客在支付环节存在转化缺口。",
    _mock: true,
  };
}

// ================================================================== 核心 API

export function isMockMode(ai) {
  return !ai;
}

export async function chat(ai, messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("llm-client.chat: messages 须为非空数组");
  }

  // mock 模式：ai 不存在时返回确定性假数据
  if (!ai) {
    const lastMsg = messages[messages.length - 1];
    const content = lastMsg?.content || "(mock: 无输入)";
    return mockCompletion(content.includes("回复") ? "ok (mock)" : JSON.stringify(mockDiscoveryResponse()));
  }

  const model = options.model || DEFAULT_MODEL;
  const inputs = {
    messages,
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.response_format ? { response_format: options.response_format } : {}),
    ...(options.max_tokens ? { max_tokens: options.max_tokens } : {}),
    ...(options.temperature != null ? { temperature: options.temperature } : {}),
  };

  const result = await ai.run(model, inputs);

  if (!result || !result.choices || !Array.isArray(result.choices) || result.choices.length === 0) {
    throw new Error("llm-client.chat: 模型返回异常 " + JSON.stringify(result).slice(0, 200));
  }

  return result;
}

export function extractContent(completion) {
  return completion?.choices?.[0]?.message?.content ?? null;
}

export function extractToolCalls(completion) {
  return completion?.choices?.[0]?.message?.tool_calls ?? [];
}

export function needsToolExecution(completion) {
  const finishReason = completion?.choices?.[0]?.finish_reason;
  return finishReason === "tool_calls" && extractToolCalls(completion).length > 0;
}

export async function chatWithTools(ai, systemPrompt, userMessage, tools, toolExecutor, options = {}) {
  if (typeof toolExecutor !== "function") {
    throw new Error("llm-client.chatWithTools: toolExecutor 须为 async 函数");
  }

  // mock 模式：直接执行工具 + 返回 mock 结论
  if (!ai) {
    const executed = [];
    for (const t of (tools || [])) {
      const name = t.function?.name;
      if (name) {
        const result = mockToolExecutor(name, {});
        executed.push({ name, args: {}, result });
      }
    }
    const content = JSON.stringify(mockDiscoveryResponse());
    return { content, tool_calls_executed: executed, rounds: 1, stopped_by: "mock_mode" };
  }

  const model = options.model || DEFAULT_MODEL;
  const maxRounds = options.max_rounds || MAX_TOOL_ROUNDS;

  const messages = [
    { role: "system", content: systemPrompt },
    ...(Array.isArray(userMessage) ? userMessage : [{ role: "user", content: String(userMessage) }]),
  ];

  const toolCallsExecuted = [];
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;

    const completion = await chat(ai, messages, {
      model,
      tools: tools && tools.length > 0 ? tools : undefined,
      ...(options.response_format ? { response_format: options.response_format } : {}),
    });

    if (!needsToolExecution(completion)) {
      return { content: extractContent(completion), tool_calls_executed: toolCallsExecuted, rounds, stopped_by: "model_end" };
    }

    const toolCalls = extractToolCalls(completion);
    messages.push({ role: "assistant", content: extractContent(completion) || null, tool_calls: toolCalls });

    for (const tc of toolCalls) {
      const fnName = tc.function?.name;
      let fnArgs;
      try { fnArgs = JSON.parse(tc.function?.arguments || "{}"); } catch { fnArgs = {}; }

      let toolResult;
      try { toolResult = await toolExecutor(fnName, fnArgs); } catch (err) { toolResult = { error: String(err?.message || err) }; }

      toolCallsExecuted.push({ tool_call_id: tc.id, name: fnName, args: fnArgs, result: toolResult });
      messages.push({ role: "tool", tool_call_id: tc.id, content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult) });
    }
  }

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  return { content: lastAssistant?.content ?? null, tool_calls_executed: toolCallsExecuted, rounds, stopped_by: "max_rounds" };
}

export async function chatJSON(ai, systemPrompt, userMessage, options = {}) {
  const msgs = systemPrompt
    ? [{ role: "system", content: systemPrompt }, { role: "user", content: String(userMessage) }]
    : [{ role: "user", content: String(userMessage) }];

  const completion = await chat(ai, msgs, { ...options, response_format: { type: "json_object" } });
  const content = extractContent(completion);
  if (!content) throw new Error("llm-client.chatJSON: 模型返回空内容");
  try { return JSON.parse(content); } catch { throw new Error("llm-client.chatJSON: 非法 JSON: " + content.slice(0, 200)); }
}

export const MODELS = Object.freeze({
  FLASH: "@cf/deepseek/deepseek-v4-flash",
  PRO: "@cf/deepseek/deepseek-v4-pro",
  GLM_FLASH: "@cf/zhipu/glm-5.3-flash",
  KIMI: "@cf/moonshot/kimi-k2.6",
});
