/**
 * T-12 collation 探针 —— 远程 REST 通道运行器（2026-09-21）
 * 范式同 ../type/run-remote-rest.mjs：直接复用探针 worker 源码（./worker/index.js 一行不改），
 * 以 D1 REST /query 后端的 env.DB 垫片替换注入绑定，打真实远程库 collation-probe（c0b873f5）。
 * 本探针全部语句为静态 SQL（无绑定参数），无 type 探针那类 boolean 传输层差异面。
 * 凭证只走环境变量。
 */

import { writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ACCOUNT_ID = process.env.CLOUDFLARE_ACCOUNT_ID;
const API_TOKEN = process.env.CLOUDFLARE_API_TOKEN;
const DB_ID = "c0b873f5-c783-4444-94af-ec86d859ef71";
const OUT = process.argv[2] || join(HERE, "raw/2026-09-21-remote.json");

if (!ACCOUNT_ID || !API_TOKEN) {
  console.error("缺少 CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN（只走环境变量）");
  process.exit(1);
}

async function d1Query(sql) {
  const resp = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${ACCOUNT_ID}/d1/database/${DB_ID}/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${API_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ sql }),
    },
  );
  const j = await resp.json();
  if (!j.success) {
    const e = (j.errors && j.errors[0]) || {};
    throw new Error(`D1_ERROR: ${e.message || "unknown"}${e.code ? ` (code ${e.code})` : ""}`);
  }
  return j.result[0];
}

const env = {
  DB: {
    prepare: (sql) => ({
      async all() {
        const r = await d1Query(sql);
        return { results: r.results, meta: r.meta };
      },
    }),
  },
};

const probe = await import(join(HERE, "worker/index.js"));
const response = await probe.default.fetch(new Request("https://probe.local/all"), env);
const payload = await response.json();

await mkdir(dirname(OUT), { recursive: true });
await writeFile(OUT, JSON.stringify(payload, null, 2));
console.log(`已写 ${OUT}`);
console.log(`paths: ${Object.keys(payload).join(", ")}`);
