#!/usr/bin/env node
/**
 * 文档卡（TS-10 模型选型探针 · REST 运行器 · 2026-09-20）
 * 上游：./worker/index.js（SYSTEM_PROMPT / buildUserMessage 与其**逐字一致**）
 *     ｜ ../../agent-orchestrator/llm-client.js（chat / extractContent 直接复用，不重复实现）
 *     ｜ ./judge.js（scoreModel 判分直接复用）｜ ./cases.js（判例）
 * 为什么存在：本机无 wrangler（2026-09-19 确认，npx 下载缓慢），而官方 REST 端点
 *   `POST /accounts/{account_id}/ai/run/{model}` 与 Binding `ai.run(model, inputs)` 的
 *   入参与返回结构等价（Cloudflare 官方文档：Workers AI REST API）。传输层不同，其余全同。
 * 硬红线：
 *   ① 凭证只走环境变量（CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN），**不落任何文件**；
 *   ② 只调 /ai/run 推理与 /ai/models/search 列目录，零写库、不碰业务路由；
 *   ③ 原样记录模型返回，不做改写、不做推荐；评分交给 judge.js。
 * 用法：
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
 *     node server/probes/model-selection/run-rest.mjs [输出文件.json] [模型键,模型键]
 *   不传模型键则跑 ALL_MODELS 全部（原候选池 + Free 补充池）。结果 JSON 建议存 ./raw/。
 */

import { CASES } from "./cases.js";
import { scoreModel } from "./judge.js";
import { chat, extractContent } from "../../agent-orchestrator/llm-client.js";

/**
 * 原候选池（llm-client.js 的 MODELS 键位）目录核对后的真实 ID（2026-09-20 经 /ai/models/search 实证）。
 * ⚠️ 这 4 个模型目录属性均带 `require_workers_paid: "true"`，Workers Free 计划下调不通
 *   （/ai/run 返回 403 code=5035，已实测）。llm-client.js 本体**待用户点头后**再改。
 */
export const REAL_MODELS = Object.freeze({
  FLASH: "@cf/deepseek-ai/deepseek-v4-flash-0731",
  PRO: "@cf/deepseek-ai/deepseek-v4-pro-0813",
  GLM_FLASH: "@cf/zai-org/glm-5.3-flash",
  KIMI: "@cf/moonshotai/kimi-k2.6",
});

/**
 * Free 计划可用的补充池（2026-09-20 目录核对：不带 require_workers_paid，且
 * function_calling=true 优先；均为 chat.completion 返回形态，llm-client.chat 可直接消费）。
 * 仅作补充实测事实，**不构成选型推荐**（选型由技术方 + PM 拍板）。
 * 注：@cf/deepseek-ai/deepseek-r1-distill-qwen-32b 虽 Free 可调，但返回为旧形态
 *   `{response}` 而非 chat.completion，llm-client.chat 直接判「返回异常」，故不入池。
 */
export const FREE_MODELS = Object.freeze({
  GLM4_FLASH: "@cf/zai-org/glm-4.7-flash",
  GPT_OSS_120B: "@cf/openai/gpt-oss-120b",
  LLAMA33_70B: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  QWEN3_30B: "@cf/qwen/qwen3-30b-a3b-fp8",
});

const ALL_MODELS = Object.freeze({ ...REAL_MODELS, ...FREE_MODELS });

/** 与 worker/index.js 的 SYSTEM_PROMPT 逐字一致（worker 未导出，故此处复制；改一处须同步另一处）。 */
const SYSTEM_PROMPT =
  "你是研究证据的充分性判断助手。只依据给定的查询结果回答，**不得使用这些结果之外的任何信息**。" +
  "输出必须是如下 JSON：{\"sufficient\": boolean, \"gaps\": [{\"gap_key\": string, \"detail\": string}], \"reason\": string}。" +
  "若依据不足以支持判断，sufficient 必须为 false，并在 gaps 中逐项说明缺什么、影响哪项判断。" +
  "证据中缺失或未计算的数值，不得推测、不得用估计值代替。";

/** 与 worker/index.js 的 buildUserMessage 逐字一致。 */
function buildUserMessage(c) {
  return [
    `研究问题：${c.question}`,
    "",
    "查询结果（证据，原样给出）：",
    "```json",
    JSON.stringify(c.evidence, null, 2),
    "```",
    "",
    "请按约定的 JSON 结构输出，不要输出 JSON 之外的内容。",
  ].join("\n");
}

/** REST 传输层：构造与 Binding `ai.run` 同签名的对象，交还给 llm-client.chat 使用。 */
function restAi(accountId, token) {
  return {
    async run(model, inputs) {
      const resp = await fetch(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(inputs),
        }
      );
      const j = await resp.json();
      if (!j.success) {
        throw new Error(`REST /ai/run 失败 http=${resp.status} errors=${JSON.stringify(j.errors ?? j).slice(0, 300)}`);
      }
      return j.result;
    },
  };
}

async function runOne(ai, model, c) {
  const t0 = Date.now();
  try {
    const completion = await chat(
      ai,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(c) },
      ],
      { model, response_format: { type: "json_object" }, ...(process.env.PROBE_MAX_TOKENS ? { max_tokens: Number(process.env.PROBE_MAX_TOKENS) } : {}) }
    );
    return { ok: true, raw: extractContent(completion), error: null, elapsed_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, raw: null, error: String(e && e.message ? e.message : e), elapsed_ms: Date.now() - t0 };
  }
}

async function main() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) {
    console.error("缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN 环境变量");
    process.exit(1);
  }
  const outFile = process.argv[2] || null;
  const keysParam = process.argv[3] || null;
  const keys = keysParam ? keysParam.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(ALL_MODELS);
  const unknown = keys.filter((k) => !(k in ALL_MODELS));
  if (unknown.length > 0) {
    console.error(`未知模型键: ${unknown.join(",")}（可用: ${Object.keys(ALL_MODELS).join(",")}）`);
    process.exit(1);
  }

  const ai = restAi(accountId, token);
  const startedAt = new Date().toISOString();
  const runs = [];
  for (const k of keys) {
    const model = ALL_MODELS[k];
    const results = [];
    for (const c of CASES) {
      const r = await runOne(ai, model, c);
      results.push({ case_id: c.case_id, raw: r.ok ? r.raw : "", error: r.error, elapsed_ms: r.elapsed_ms });
      const mark = r.ok ? "ok " : "ERR";
      console.error(`[${k}] ${c.case_id} ${mark} ${r.elapsed_ms}ms`);
    }
    const scored = scoreModel(model, results);
    runs.push({ key: k, model, dry_run: false, ...scored, results });
  }

  const report = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    transport: "rest:/accounts/{id}/ai/run/{model}（与 Binding ai.run 等价，llm-client.chat 复用）",
    runner: "server/probes/model-selection/run-rest.mjs",
    models: keys.map((k) => ALL_MODELS[k]),
    runs,
  };
  const json = JSON.stringify(report, null, 2);
  if (outFile) {
    const fs = await import("node:fs");
    fs.writeFileSync(outFile, json);
    console.error(`已写入 ${outFile}`);
  } else {
    console.log(json);
  }
}

main();
