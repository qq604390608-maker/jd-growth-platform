/**
 * T-11 类型探针 —— 远程 REST 通道运行器（2026-09-21）
 *
 * 背景：账号无 workers.dev 大陆可达性（*.workers.dev 被网络阻断），
 * 但 api.cloudflare.com 可达。本脚本**直接复用探针 worker 源码**（./worker/index.js，
 * 一行不改），用「D1 REST API 后端的 env.DB 垫片」替换注入绑定，等价打到远程真库。
 *
 * 等价性说明：D1 REST /query 与 JS 驱动走同一服务端执行，读回 results/meta 形状一致；
 * 错误以 success:false 返回，垫片转译为 `D1_ERROR: …` 形态的 Error（与 JS 驱动报错文案同构）。
 * ⚠️ 已实测的例外（2026-09-21）：**boolean 绑定不走等价路径**——JS 驱动 `.bind(true/false)`
 * 落 integer 1/0，REST JSON 布尔被服务端按文本落（boolean 不在 REST 参数支持类型内）。
 * 这是传输层差异、非引擎差异；故远程复测结论中 g4/recheck 的 boolean 计数差异**判归传输层**，
 * 生产 worker 的 JS 驱动绑定行为不受影响（详见 README §5b）。
 *
 * 用法：
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node run-remote-rest.mjs [输出.json]
 *   输出缺省为 raw/2026-09-21-remote.json。凭证只走环境变量，不落任何文件。
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_ID = "c73a1ea3-0933-4c49-b99f-8f16c6ae4db8"; // 远程探针库 type-probe
const OUT = process.argv[2] || join(HERE, "raw/2026-09-21-remote.json");

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（只走环境变量）");
  process.exit(1);
}

/** D1 REST 查询；与 JS 驱动同构：成功返回 {results, meta}，失败 throw D1_ERROR */
async function d1Query(sql, params) {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql, params }),
    },
  );
  const j = await resp.json();
  if (!j.success) {
    const e = (j.errors && j.errors[0]) || {};
    throw new Error(`D1_ERROR: ${e.message || "unknown"}${e.code ? ` (code ${e.code})` : ""}`);
  }
  return j.result[0]; // { results, meta }
}

/** env.DB 垫片：只实现探针用到的 prepare().bind(...).all() */
const env = {
  DB: {
    prepare(sql) {
      let bound = [];
      return {
        bind(...params) {
          bound = params;
          return this;
        },
        async all() {
          const r = await d1Query(sql, bound);
          return { results: r.results, meta: r.meta };
        },
      };
    },
  },
};

// 复用探针 worker 本体：default export 的 fetch(request, env)
const probe = await import(join(HERE, "worker/index.js"));
const request = new Request("https://probe.local/all");
const response = await probe.default.fetch(request, env);
const payload = await response.json();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 2));

let total = 0, ok = 0, err = 0;
for (const [, body] of Object.entries(payload.groups || {})) {
  for (const s of body.steps || []) {
    total += 1;
    if (s.ok) ok += 1; else err += 1;
  }
}
console.log(`已写 ${OUT}`);
console.log(`steps total=${total} ok=${ok} err=${err}`);
