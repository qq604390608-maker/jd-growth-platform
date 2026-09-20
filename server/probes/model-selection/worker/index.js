// 探针 Worker：TS-10 模型选型实测 —— **不属于业务代码**，不参与任何业务流程
// 上游：../../../../docs/03-locks/tech-stack.md §2.5 / §8 TS-10；../../agent-orchestrator/llm-client.js（复用封装，不重复造轮子）
// 路由：GET /cases 判例清单 ｜ GET /probe 跑实测（?models=MAIN,HEAVY 指定模型；?dry_run=1 只跑链路验证）
//
// 设计原则（对齐 db/probes/type 的探针范式）：
//   - **原样记录**模型的原始返回，不做改写、不做结论、不做模型推荐；
//   - 评分交给 judge.js（纯函数），本文件只负责取回原始内容；
//   - `dry_run` 仅用于验证探针自身链路，**结果不得写入 raw/、不得当作实测结论**。
//
// ⚠️ 计费提示：Workers AI **即使本地 wrangler dev 也会走真实账号并产生费用**
//    （官方文档：Using Workers AI always accesses your Cloudflare account … even in local development）。

import { CASES } from "../cases.js";
import { judgeCase, scoreModel } from "../judge.js";
import { chat, extractContent, MODELS } from "../../../agent-orchestrator/llm-client.js";

/** 输出 schema 的要求（写进 system prompt，要求模型严格按此输出）。 */
const SYSTEM_PROMPT =
  "你是研究证据的充分性判断助手。只依据给定的查询结果回答，**不得使用这些结果之外的任何信息**。" +
  "输出必须是如下 JSON：{\"sufficient\": boolean, \"gaps\": [{\"gap_key\": string, \"detail\": string}], \"reason\": string}。" +
  "若依据不足以支持判断，sufficient 必须为 false，并在 gaps 中逐项说明缺什么、影响哪项判断。" +
  "证据中缺失或未计算的数值，不得推测、不得用估计值代替。";

/**
 * 构造某判例的 user 消息。
 * @param {object} c 判例
 * @returns {string}
 */
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

/**
 * 调用单个模型的单个判例，取回**原始返回文本**（不解析、不改写）。
 * @param {Ai} ai
 * @param {string} model
 * @param {object} c 判例
 * @returns {Promise<{ ok:boolean, raw:string|null, error:string|null, elapsed_ms:number }>}
 */
async function runOne(ai, model, c) {
  const t0 = Date.now();
  try {
    const completion = await chat(
      ai,
      [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: buildUserMessage(c) },
      ],
      { model, response_format: { type: "json_object" } }
    );
    return { ok: true, raw: extractContent(completion), error: null, elapsed_ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, raw: null, error: String(e && e.message ? e.message : e), elapsed_ms: Date.now() - t0 };
  }
}

/** dry-run 用的固定应答（**不是实测结果**，仅验证评分链路）。 */
const DRY_RUN_ANSWERS = Object.freeze({
  "C1-restricted": '{"sufficient":false,"reason":"关键证据因权限受限未取到","gaps":[{"gap_key":"restricted","detail":"cdp.behavior.agg 返回 403 权限未开通，该人群复购数据缺失"}]}',
  "C2-empty": '{"sufficient":false,"reason":"查询成功但命中 0 行","gaps":[{"gap_key":"empty","detail":"pim.spec.distribution 返回 0 行，规格分布未查明"}]}',
  "C3-uncomputable": '{"sufficient":false,"reason":"该指标不可算","gaps":[{"gap_key":"uncomputable","detail":"样本量不足（n=37），不满足最小样本阈值，复购率不可算"}]}',
  "C4-coverage": '{"sufficient":false,"reason":"覆盖区间不完整","gaps":[{"gap_key":"coverage","detail":"实际仅覆盖至 2026-09-10，尾部 5 天缺失"}]}',
  "C5-sufficient": '{"sufficient":true,"reason":"品类路径与规格标签均已返回","gaps":[]}',
  "C6-nofabrication": '{"sufficient":false,"reason":"证据未给出该数值","gaps":[{"gap_key":"uncomputable","detail":"证据中 repurchase_rate_30d 为 null，不可算，不能给出数值"}]}',
});

/**
 * 跑一批模型 × 全部判例。
 * @param {Ai|null} ai
 * @param {string[]} modelIds
 * @param {boolean} dryRun
 */
async function runProbe(ai, modelIds, dryRun) {
  const out = [];
  for (const model of modelIds) {
    const results = [];
    for (const c of CASES) {
      if (dryRun) {
        results.push({ case_id: c.case_id, raw: DRY_RUN_ANSWERS[c.case_id] ?? "", elapsed_ms: 0 });
      } else {
        const r = await runOne(ai, model, c);
        results.push({ case_id: c.case_id, raw: r.ok ? r.raw : "", error: r.error, elapsed_ms: r.elapsed_ms });
      }
    }
    const scored = scoreModel(model, results);
    out.push({ model, dry_run: dryRun, ...scored, results });
  }
  return out;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/cases") {
      return Response.json(
        { count: CASES.length, cases: CASES.map((c) => ({ case_id: c.case_id, title: c.title, source: c.source, expect_sufficient: c.expect_sufficient })) },
        { headers: { "content-type": "application/json; charset=utf-8" } }
      );
    }

    if (url.pathname !== "/probe") {
      return Response.json({ error: "not_found", routes: ["/cases", "/probe"] }, { status: 404 });
    }

    const modelsParam = url.searchParams.get("models");
    const dryRun = url.searchParams.get("dry_run") === "1";
    const keys = modelsParam ? modelsParam.split(",").map((s) => s.trim()).filter(Boolean) : Object.keys(MODELS);

    const unknown = keys.filter((k) => !(k in MODELS));
    if (unknown.length > 0) {
      return Response.json({ error: "unknown_model_key", unknown, known: Object.keys(MODELS) }, { status: 400 });
    }
    const modelIds = keys.map((k) => MODELS[k]);

    if (!dryRun && !env.AI) {
      return Response.json(
        { error: "ai_not_bound", message: "AI binding 未配置（wrangler.toml 缺 [ai] 段，注意是单表语法而非数组表）" },
        { status: 503 }
      );
    }

    const startedAt = new Date().toISOString();
    const runs = await runProbe(env.AI ?? null, modelIds, dryRun);
    return Response.json(
      { started_at: startedAt, dry_run: dryRun, models: modelIds, runs },
      { headers: { "content-type": "application/json; charset=utf-8" } }
    );
  },
};
