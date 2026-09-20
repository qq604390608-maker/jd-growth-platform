/**
 * 文档卡（A-1 LLM 推理服务 · 2026-09-20）
 * 上游：../03-locks/tech-stack.md §2.5（DS-02 Cloudflare Workers AI｜A-1 是唯一完全空缺项）
 *   ｜ ../03-locks/external-deps.md §3 A-1（LLM 推理服务，两个 Agent 的线索判断/查证决策/结果组装）
 *   ｜ ../02-prd/PRD-M3-机会发现Agent.md §1.1.1（F-14/F-15 线索判断与查证决策）
 *   ｜ ../02-prd/PRD-M4-HVA分析Agent.md §1.1.1（F-19/F-20/F-21 HVA 分析与结果组装）
 *   ｜ ../01-brd/BRD.md §5.3 硬红线（不调生产写接口）、§7 验收总则
 * 本文件：server/agent-orchestrator/llm-client.js —— A-1 LLM 推理服务的运行期客户端
 *   封装 Workers AI Binding 调用：chat(messages, tools?, options?)
 *   + function calling 循环（调用→判断→执行工具→再调用→直到模型给出最终回答）
 *   + JSON mode（response_format: { type: "json_object" }）
 * 职责：提供 Agent 编排层可调用的 LLM 能力，不包含业务逻辑。
 * 硬红线：① 零写库（本文件不做任何 DB 操作）；② 零外部凭证（依赖 env.AI binding，代码里无密钥）；
 *   ③ 不替代查询结果（LLM 只做推理判断，不代替 tool-executor 的真实返回）。
 * 反向清单：被 discovery.js / research-start.js / result.js / behavior.js 等 agent-orchestrator 模块引用。
 */

/** 默认模型（轻量快速，验证链路；重推理场景换 deepseek-v4-pro） */
const DEFAULT_MODEL = "@cf/deepseek/deepseek-v4-flash";

/** function calling 最大循环次数（防止无限循环） */
const MAX_TOOL_ROUNDS = 10;

/**
 * 基础 chat 调用（单次，不做 tool loop）。
 * @param {Ai} ai Workers AI binding（env.AI）
 * @param {Array} messages [{ role: "system"|"user"|"assistant"|"tool", content: string, ... }]
 * @param {object} [options]
 * @param {string} [options.model] 模型名，默认 deepseek-v4-flash
 * @param {Array} [options.tools] function calling 工具定义
 * @param {object} [options.response_format] { type: "json_object" } 强制 JSON 输出
 * @param {number} [options.max_tokens] 最大输出 token
 * @param {number} [options.temperature] 温度
 * @returns {Promise<object>} OpenAI 兼容格式的 completion
 */
export async function chat(ai, messages, options = {}) {
  if (!ai) throw new Error("llm-client.chat：ai binding 不能为空（env.AI 未注入）");
  if (!Array.isArray(messages) || messages.length === 0) {
    throw new Error("llm-client.chat：messages 须为非空数组");
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

  // Workers AI binding 返回 OpenAI 兼容格式
  // { id, object, created, model, choices: [{ index, message, finish_reason }] }
  if (!result || !result.choices || !Array.isArray(result.choices) || result.choices.length === 0) {
    throw new Error(`llm-client.chat：模型返回异常 ${JSON.stringify(result).slice(0, 200)}`);
  }

  return result;
}

/**
 * 提取 completion 中 assistant message 的文本内容。
 * @param {object} completion chat() 的返回值
 * @returns {string|null}
 */
export function extractContent(completion) {
  const msg = completion?.choices?.[0]?.message;
  return msg?.content ?? null;
}

/**
 * 提取 completion 中 assistant message 的 tool_calls。
 * @param {object} completion chat() 的返回值
 * @returns {Array} tool_calls 数组，每项 { id, type: "function", function: { name, arguments } }
 */
export function extractToolCalls(completion) {
  const msg = completion?.choices?.[0]?.message;
  return msg?.tool_calls ?? [];
}

/**
 * 检查 completion 是否因 tool_calls 而结束（需要执行工具后再调用）。
 * @param {object} completion
 * @returns {boolean}
 */
export function needsToolExecution(completion) {
  const finishReason = completion?.choices?.[0]?.finish_reason;
  const toolCalls = extractToolCalls(completion);
  return finishReason === "tool_calls" && toolCalls.length > 0;
}

/**
 * Function calling 循环：调 LLM → 执行工具 → 把结果喂回 LLM → 重复，直到模型给出最终回答。
 *
 * 这是 Agent 编排层的核心调用入口。用法：
 *   const result = await chatWithTools(ai, systemPrompt, userMessage, tools, toolExecutor);
 *
 * @param {Ai} ai Workers AI binding
 * @param {string} systemPrompt 系统指令（agent.md 角色指令）
 * @param {string|Array} userMessage 用户消息或消息数组
 * @param {Array} tools function calling 工具定义（OpenAI 格式）
 * @param {Function} toolExecutor async (toolName, args) => result —— 执行工具并返回结果
 * @param {object} [options]
 * @param {string} [options.model] 模型名
 * @param {number} [options.max_rounds] 最大循环次数（默认 MAX_TOOL_ROUNDS）
 * @param {object} [options.response_format] JSON mode
 * @returns {Promise<{ content: string|null, tool_calls_executed: Array, rounds: number, stopped_by: string }>}
 */
export async function chatWithTools(ai, systemPrompt, userMessage, tools, toolExecutor, options = {}) {
  if (!ai) throw new Error("llm-client.chatWithTools：ai binding 不能为空");
  if (typeof toolExecutor !== "function") {
    throw new Error("llm-client.chatWithTools：toolExecutor 须为 async 函数 (toolName, args) => result");
  }

  const model = options.model || DEFAULT_MODEL;
  const maxRounds = options.max_rounds || MAX_TOOL_ROUNDS;

  // 初始化消息列表
  const messages = [
    { role: "system", content: systemPrompt },
    ...(Array.isArray(userMessage)
      ? userMessage
      : [{ role: "user", content: String(userMessage) }]),
  ];

  const toolCallsExecuted = [];
  let rounds = 0;
  let stoppedBy = "model_end";

  for (let round = 0; round < maxRounds; round++) {
    rounds = round + 1;

    // 调用 LLM
    const completion = await chat(ai, messages, {
      model,
      tools: tools && tools.length > 0 ? tools : undefined,
      ...(options.response_format ? { response_format: options.response_format } : {}),
    });

    // 无 tool_calls → 模型给出最终回答，结束循环
    if (!needsToolExecution(completion)) {
      const content = extractContent(completion);
      // 收编时修正：此处恒为「模型自然结束」，不沿用上一轮留下的 stoppedBy
      // （原写法会在「执行过工具后正常结束」时错报成 max_rounds）
      return { content, tool_calls_executed: toolCallsExecuted, rounds, stopped_by: "model_end" };
    }

    // 有 tool_calls → 逐个执行工具
    const toolCalls = extractToolCalls(completion);
    const toolMessage = { role: "assistant", content: extractContent(completion) || null, tool_calls: toolCalls };
    messages.push(toolMessage);

    for (const tc of toolCalls) {
      const fnName = tc.function?.name;
      let fnArgs;
      try {
        fnArgs = JSON.parse(tc.function?.arguments || "{}");
      } catch {
        fnArgs = {};
      }

      // 执行工具
      let toolResult;
      try {
        toolResult = await toolExecutor(fnName, fnArgs);
      } catch (err) {
        toolResult = { error: String(err?.message || err) };
      }

      toolCallsExecuted.push({ tool_call_id: tc.id, name: fnName, args: fnArgs, result: toolResult });

      // 把工具结果喂回消息列表
      messages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult),
      });
    }

  }

  // 用尽循环次数（未由模型自然结束）——只有走到这里才标 max_rounds
  stoppedBy = "max_rounds";

  // 用尽循环次数：取**最后一条 assistant 消息**的内容。
  // 收编时修正：原实现只判断「最后一条是否为 assistant」，而每轮末尾都会 push 一条 tool 消息，
  // 该判断**恒假** → content 恒 null，用尽轮次时拿不到任何内容。
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const lastContent = lastAssistant ? lastAssistant.content ?? null : null;
  return { content: lastContent, tool_calls_executed: toolCallsExecuted, rounds, stopped_by: stoppedBy };
}

/**
 * JSON mode chat：强制模型返回 JSON，自动解析。
 * @param {Ai} ai
 * @param {string} systemPrompt
 * @param {string} userMessage
 * @param {object} [options] 透传给 chat()（除 response_format 外）
 * @returns {Promise<object>} 解析后的 JSON 对象
 */
export async function chatJSON(ai, systemPrompt, userMessage, options = {}) {
  const completion = await chat(ai, systemPrompt ? [
    { role: "system", content: systemPrompt },
    { role: "user", content: String(userMessage) },
  ] : [
    { role: "user", content: String(userMessage) },
  ], {
    ...options,
    response_format: { type: "json_object" },
  });

  const content = extractContent(completion);
  if (!content) throw new Error("llm-client.chatJSON：模型返回空内容");

  try {
    return JSON.parse(content);
  } catch (err) {
    throw new Error(`llm-client.chatJSON：模型返回内容不是合法 JSON：${content.slice(0, 200)}`);
  }
}

/** 常用模型名常量 */
export const MODELS = Object.freeze({
  FLASH: "@cf/deepseek/deepseek-v4-flash",
  PRO: "@cf/deepseek/deepseek-v4-pro",
  GLM_FLASH: "@cf/zhipu/glm-5.3-flash",
  KIMI: "@cf/moonshot/kimi-k2.6",
});
