/**
 * 文档卡（A-1 LLM 客户端用例执行器 · 2026-09-20 收编）
 * 上游 oracle：../../../docs/05-test-cases/（A-1 属门禁项，登记为「门禁未关闭、非发布门禁」）
 *   ｜ ../../docs/03-locks/tech-stack.md §2.5（DS-02 Cloudflare Workers AI）
 *   ｜ ../../docs/03-locks/external-deps.md §3 A-1 / §7 T-21
 * 范围：`llm-client.js` 的**纯逻辑与编排行为**，用 mock AI binding 验证（**不触真实推理、无需账号**）。
 * 覆盖要点：
 *   1. 参数校验与 options 透传（含 `temperature: 0` 这类假值不得被吞）；
 *   2. `chatWithTools` 的两种结束态语义（模型自然结束 / 用尽轮次）——**收编时修的两个 bug 在此锁死**；
 *   3. 硬红线：本文件与被测文件**零写库、零外部 HTTP**（只经注入的 `ai.run`）。
 *
 * 用法：node server/agent-orchestrator/test-llm-client.mjs
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  chat,
  chatWithTools,
  chatJSON,
  extractContent,
  extractToolCalls,
  needsToolExecution,
  MODELS,
} from "./llm-client.js";

let passed = 0;
let failed = 0;
const fails = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; fails.push(msg); console.log("  ✗ " + msg); }
}
async function assertThrows(fn, msg, match) {
  try {
    await fn();
    failed++; fails.push(msg + "（应抛错但未抛）"); console.log("  ✗ " + msg + "（应抛错但未抛）");
  } catch (e) {
    if (match && !String(e.message).includes(match)) {
      failed++; fails.push(msg + `（抛出但信息不符：期望含「${match}」，实际「${e.message}」）`);
      console.log("  ✗ " + msg + `（期望含「${match}」）`);
    } else { passed++; }
  }
}
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function finish() {
  console.log(`\n${failed === 0 ? "VERIFY PASS" : "VERIFY FAIL"} · ${passed} 断言通过 / ${failed} 失败`);
  if (failed > 0) { console.log("失败项："); fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
  process.exit(0);
}

/* ---------- mock AI binding（不触真实推理） ---------- */
function makeAI(responses) {
  const calls = [];
  let i = 0;
  return {
    calls,
    async run(model, inputs) {
      const r = responses[Math.min(i, responses.length - 1)];
      calls.push({ model, inputs, n: i + 1 });
      i += 1;
      return typeof r === "function" ? r(model, inputs, i) : r;
    },
  };
}
/** 普通文本回答 */
const reply = (content) => ({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
/** 要求调用工具的回答 */
const wantTool = (calls) => ({
  choices: [{
    message: { role: "assistant", content: null, tool_calls: calls },
    finish_reason: "tool_calls",
  }],
});
const tc = (name, args, id = "call_1") => ({
  id, type: "function",
  function: { name, arguments: JSON.stringify(args) },
});

// ==================================================== ① chat 参数校验（前置守卫，不静默降级）
console.log("① `chat` 参数校验：缺 binding / 空 messages 一律抛错（不静默降级）");
{
  // 2026-09-20 收编：库层空 ai 走 mock 兜底（模型名 mock-model，可观测）；
  // 业务侧防静默伪造由编排层 A-1 门禁把关（见 test-f14 ⑦：默认拒跑、显式 opts.mock 放行）。
  const mockChat = await chat(null, [{ role: "user", content: "hi" }]);
  assert(mockChat && mockChat.model === "mock-model", "① ai 为空 → mock 兜底（model=mock-model，可观测）");
  await assertThrows(() => chat(makeAI([reply("ok")]), []), "① messages 为空数组 → 抛错", "非空数组");
  await assertThrows(() => chat(makeAI([reply("ok")]), "not-an-array"), "① messages 非数组 → 抛错", "非空数组");
  await assertThrows(
    () => chat(makeAI([{ choices: [] }]), [{ role: "user", content: "hi" }]),
    "① 模型返回无 choices → 抛错（不静默返回空）", "模型返回异常"
  );
}

// ==================================================== ② 正常调用与 options 透传
console.log("\n② `chat` 正常调用：默认模型 + options 逐项透传（含假值 0 不得被吞）");
{
  const ai = makeAI([reply("ok")]);
  const r = await chat(ai, [{ role: "user", content: "hi" }]);
  assert(r.choices[0].message.content === "ok", "② 返回 completion 原样透传");
  assert(ai.calls[0].model === MODELS.MAIN, `② 未指定 model 时用默认模型（实测 ${ai.calls[0].model}）`);
  assert(ai.calls[0].inputs.messages.length === 1, "② messages 原样透传给 binding");

  const ai2 = makeAI([reply("ok")]);
  await chat(ai2, [{ role: "user", content: "hi" }], {
    tools: [{ type: "function", function: { name: "x" } }],
    response_format: { type: "json_object" },
    max_tokens: 10,
    temperature: 0,
  });
  const inp = ai2.calls[0].inputs;
  assert(Array.isArray(inp.tools) && inp.tools.length === 1, "② tools 透传");
  assert(inp.response_format && inp.response_format.type === "json_object", "② response_format 透传（JSON mode 基础）");
  assert(inp.max_tokens === 10, "② max_tokens 透传");
  assert(inp.temperature === 0, "② **temperature=0 不得被吞**（假值须显式透传，实测 " + inp.temperature + "）");

  const ai3 = makeAI([reply("ok")]);
  await chat(ai3, [{ role: "user", content: "hi" }], { model: MODELS.HEAVY });
  assert(ai3.calls[0].model === MODELS.HEAVY, "② 指定 model 时覆盖默认值");
}

// ==================================================== ③ 纯函数：内容 / 工具调用 / 是否需执行
console.log("\n③ 纯函数 `extractContent` / `extractToolCalls` / `needsToolExecution`");
{
  assert(extractContent(reply("你好")) === "你好", "③ extractContent 取文本");
  assert(extractContent(null) === null, "③ extractContent(null) → null（不抛）");
  assert(extractContent({}) === null, "③ extractContent(空对象) → null（可选链兜底）");

  const calls = [tc("get_weather", { city: "北京" })];
  assert(extractToolCalls(wantTool(calls)).length === 1, "③ extractToolCalls 取 tool_calls");
  assert(extractToolCalls(reply("文本")).length === 0, "③ 无 tool_calls → 空数组（不是 undefined）");

  assert(needsToolExecution(wantTool(calls)) === true, "③ finish_reason=tool_calls 且有调用 → 需执行");
  assert(needsToolExecution(reply("文本")) === false, "③ 普通回答 → 不需执行");
  assert(
    needsToolExecution({ choices: [{ message: { tool_calls: calls }, finish_reason: "stop" }] }) === false,
    "③ 有 tool_calls 但 finish_reason 不是 tool_calls → 不执行（双条件，防误判）"
  );
}

// ==================================================== ④ chatWithTools：无需工具 → 模型自然结束
console.log("\n④ `chatWithTools` 无需工具：直接返回，`stopped_by='model_end'`");
{
  const ai = makeAI([reply("直接回答")]);
  const r = await chatWithTools(ai, "sys", "问题", [], async () => ({}));
  assert(r.content === "直接回答", "④ content 取回模型回答");
  assert(r.rounds === 1, `④ 只调 1 轮（实测 ${r.rounds}）`);
  assert(r.stopped_by === "model_end", `④ stopped_by=model_end（实测 ${r.stopped_by}）`);
  assert(r.tool_calls_executed.length === 0, "④ 未执行任何工具");
}

// ==================================================== ⑤ 收编修复①：执行过工具后正常结束，不得错报 max_rounds
console.log("\n⑤ 收编修复① · 执行过工具后**正常结束** → `stopped_by` 仍须为 `model_end`");
{
  const ai = makeAI([wantTool([tc("get_weather", { city: "北京" })]), reply("北京今天晴 22°C")]);
  const executed = [];
  const r = await chatWithTools(ai, "sys", "北京天气？", [{ type: "function", function: { name: "get_weather" } }],
    async (name, args) => { executed.push({ name, args }); return { city: args.city, weather: "晴" }; });

  assert(r.rounds === 2, `⑤ 共 2 轮（实测 ${r.rounds}）`);
  assert(r.stopped_by === "model_end", `⑤ **执行过工具后正常结束仍报 model_end**（实测 ${r.stopped_by}）— 修复前此处错报 max_rounds`);
  assert(r.content === "北京今天晴 22°C", "⑤ 最终回答取回");
  assert(executed.length === 1 && executed[0].name === "get_weather", "⑤ 工具被执行一次且名字正确");
  assert(r.tool_calls_executed.length === 1 && r.tool_calls_executed[0].name === "get_weather", "⑤ 执行记录留痕");
  // 工具结果须喂回下一轮（否则模型看不到结果）
  const lastInputs = ai.calls[ai.calls.length - 1].inputs;
  assert(
    lastInputs.messages.some((m) => m.role === "tool"),
    "⑤ 工具结果以 role=tool 喂回下一轮（模型须可见）"
  );
}

// ==================================================== ⑥ 收编修复②：用尽轮次 → 标 max_rounds 且能取到最后回答
console.log("\n⑥ 收编修复② · 用尽轮次：`stopped_by='max_rounds'`，且**能取到最后一条 assistant 内容**");
{
  const ai = makeAI([wantTool([tc("loop", {})])]); // 每次都要工具 → 永不自然结束
  const r = await chatWithTools(ai, "sys", "u", [{ type: "function", function: { name: "loop" } }],
    async () => ({ ok: 1 }), { max_rounds: 3 });

  assert(r.rounds === 3, `⑥ 用尽 max_rounds=3（实测 ${r.rounds}）`);
  assert(r.stopped_by === "max_rounds", `⑥ stopped_by=max_rounds（实测 ${r.stopped_by}）`);
  assert(ai.calls.length === 3, "⑥ 实际调用 3 次（循环上限生效，防无限循环）");
  assert(r.tool_calls_executed.length === 3, "⑥ 3 次工具执行均留痕");
  assert(
    r.content === null || typeof r.content === "string",
    "⑥ 用尽轮次的 content 取最后一条 assistant（可为 null，但**不得因判断恒假而取不到**）"
  );
}

// ==================================================== ⑦ chatWithTools 参数校验与容错
console.log("\n⑦ `chatWithTools` 参数校验与工具容错（工具失败不中断整轮）");
{
  // 2026-09-20 收编：库层空 ai → mock 工具执行（不调注入的 toolExecutor，零写库）
  let executorTouched = false;
  const TOOLS_LIKE = [{ type: "function", function: { name: "cdp_crowd_query", description: "d", parameters: {} } }];
  const mockToolRes = await chatWithTools(null, "s", "u", TOOLS_LIKE, async () => { executorTouched = true; return {}; });
  assert(mockToolRes.stopped_by === "mock_mode", "⑦ ai 为空 → mock 兜底（stopped_by=mock_mode，可观测）");
  assert(executorTouched === false, "⑦ mock 分支不调注入的 toolExecutor（零写库红线）");
  assert(JSON.parse(mockToolRes.content)._mock === true, "⑦ mock 结论带 _mock=true 标记");
  await assertThrows(
    () => chatWithTools(makeAI([reply("x")]), "s", "u", [], "not-a-function"),
    "⑦ toolExecutor 非函数 → 抛错（不静默忽略）", "toolExecutor 须为 async 函数"
  );

  // 工具抛错 → 转成 { error } 继续，不中断
  const ai = makeAI([wantTool([tc("boom", {})]), reply("已处理")]);
  const r = await chatWithTools(ai, "s", "u", [{ type: "function", function: { name: "boom" } }],
    async () => { throw new Error("工具炸了"); });
  assert(r.tool_calls_executed.length === 1, "⑦ 工具抛错仍留痕");
  assert(
    r.tool_calls_executed[0].result && typeof r.tool_calls_executed[0].result.error === "string",
    "⑦ 工具异常被转成 error 字段（不中断整轮）"
  );
  assert(r.content === "已处理", "⑦ 工具失败后仍能拿到模型后续回答");

  // arguments 非法 JSON → 兜底为 {}
  const ai2 = makeAI([wantTool([{ id: "c2", type: "function", function: { name: "bad", arguments: "{oops" } }]), reply("ok")]);
  const r2 = await chatWithTools(ai2, "s", "u", [{ type: "function", function: { name: "bad" } }], async () => ({}));
  assert(
    JSON.stringify(r2.tool_calls_executed[0].args) === "{}",
    "⑦ arguments 非法 JSON → 兜底为 {}（不抛、不静默丢整条）"
  );
}

// ==================================================== ⑧ chatJSON：强制 JSON mode 并解析
console.log("\n⑧ `chatJSON` · 强制 JSON mode + 解析（非法/空一律抛错，不静默降级）");
{
  const ai = makeAI([reply('{"suitable":true}')]);
  const obj = await chatJSON(ai, "sys", "问题");
  assert(obj.suitable === true, "⑧ 解析出 JSON 对象");
  assert(ai.calls[0].inputs.response_format.type === "json_object", "⑧ 强制 response_format=json_object");

  await assertThrows(
    () => chatJSON(makeAI([reply("不是 JSON")]), "s", "u"),
    "⑧ 返回非 JSON → 抛错（不静默返回空对象；2026-09-20 收编：错误措辞由「不是合法 JSON」改为「非法 JSON」）", "非法 JSON"
  );
  await assertThrows(
    () => chatJSON(makeAI([reply("")]), "s", "u"),
    "⑧ 返回空内容 → 抛错", "空内容"
  );
}

// ==================================================== ⑨ MODELS 常量（唯一真源，路由不得硬编码）
console.log("\n⑨ `MODELS` 常量池：冻结、形态合规（路由一律引用常量，不内联字面）");
{
  assert(Object.isFrozen(MODELS), "⑨ MODELS 被冻结（防运行期改写）");
  const keys = Object.keys(MODELS);
  assert(keys.length >= 3, `⑨ 至少 3 档候选模型（实测 ${keys.length}）`);
  const vals = Object.values(MODELS);
  assert(vals.every((v) => typeof v === "string" && v.startsWith("@cf/")), "⑨ 所有模型 ID 均为 @cf/ 前缀形态");
  assert(vals.includes("@cf/qwen/qwen3-30b-a3b-fp8"), "⑨ 含默认主力模型 qwen3-30b（Free 池，实测 23/0 满分）");
  assert(vals.includes("@cf/meta/llama-3.3-70b-instruct-fp8-fast"), "⑨ 含重推理档 llama-3.3-70b-fast（Free 池，实测 23/0 满分）");
}

// ==================================================== ⑩ 静态核验：零外部 HTTP / 零写库
console.log("\n⑩ 静态核验 · 本文件与被测文件**零外部 HTTP、零写语句**（只经注入的 `ai.run`）");
{
  // 用 fileURLToPath：`new URL(...).pathname` 会把中文路径百分号编码，导致 ENOENT
  const LLM_SRC = fileURLToPath(new URL("./llm-client.js", import.meta.url));
  const API_SRC = fileURLToPath(new URL("../api/index.js", import.meta.url));
  const src = stripComments(readFileSync(LLM_SRC, "utf8"));

  assert(!/\bfetch\s*\(/.test(src), "⑩ llm-client：无 fetch 调用");
  assert(!/https?:\/\//.test(src), "⑩ llm-client：无 http(s) 地址字面");
  const writes = src.match(/\b(INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/gi) || [];
  assert(writes.length === 0, `⑩ llm-client：**零写语句**（实测命中 ${writes.length}）`);
  assert(!/\b(env\.DB|DB\.prepare|SELECT\b)/.test(src), "⑩ llm-client：不碰 D1（无 DB.prepare / 无裸 SELECT）");
  assert(!/(api_token|api_key|API_TOKEN|secret)/i.test(src), "⑩ llm-client：**零凭证**（依赖注入的 env.AI binding）");

  // 路由层不得再硬编码模型 ID（须引用 MODELS 常量）
  const apiSrc = stripComments(readFileSync(API_SRC, "utf8"));
  const hardcoded = (apiSrc.match(/@cf\//g) || []).length;
  assert(hardcoded === 0, `⑩ api/index.js：**无硬编码模型 ID**（实测 @cf/ 字面 ${hardcoded} 处，应全部改用 MODELS.*）`);
}

finish();
