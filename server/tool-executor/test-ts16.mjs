#!/usr/bin/env node
/**
 * 文档卡（TS-16 用例执行器 · 应用层截断＋留痕标注 · 2026-09-21）
 * 上游：`../../docs/03-locks/tech-stack.md` §4「单行 / 字符串上限 2 MB」约束与 §8 **TS-16 已决**
 *       （2026-09-21 依用户裁决：应用层截断＋留痕标注，不引入对象存储 / 分段多行）
 *   ｜ `../../docs/03-locks/schema.md` EXT-01 `query_record.result_summary`（真实返回摘要，不得用模型预期替代）、
 *       EXT-02 `evidence.result_summary`（结果原样保留，不拆数值）
 *   ｜ `./text-limit.js`（被测纯函数）｜ `./index.js` F-25 `saveQueryRecord`（EXT-01 落痕写入面）｜
 *       `../shared-context/index.js` F-09 `createEvidence`（EXT-02 落库写入面）
 * 职责：实测 ① 纯函数边界（未超限原样 / 字节计量 / 字符边界截断 / 留痕标注）；
 *       ② EXT-01 落痕端到端（超限信封 → 行内已截断＋标注；未超限逐字节原样）；
 *       ③ EXT-02 落库端到端（同上）。
 * 硬红线：本地内存库（`node:sqlite` 载真实 DDL + 种子），零真实外部调用、零生产写；
 *   断言只看截断语义与留痕标注，**数值以契约基准 v1（ADR-004）为准**。
 * 边界：只验 TS-16 截断；F-25/F-09 自身语义归各自执行器。
 * 反向清单：登记 `../README.md` 与 `./README.md`；被 CI `validate` 步骤复用（`node server/tool-executor/test-ts16.mjs`）。
 *
 * 用法：node server/tool-executor/test-ts16.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { SUMMARY_MAX_BYTES, truncateForStorage } from "./text-limit.js";
import { saveQueryRecord, getQueryRecord } from "./index.js";
import { createEvidence } from "../shared-context/index.js";
import { mapResponseToResult } from "./mcp-client.js";
import { defaultOk } from "../../prototype/mock/scenarios.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);

/** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      try {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      } catch (e) {
        return { success: false, error: e.message };
      }
    },
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: () => sqlite.prepare(sql).get(...params),
  });
  return { prepare: (sql) => makeStmt(sql, []) };
}

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  sqlite.exec(mock);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const enc = new TextEncoder();
const byteLen = (s) => enc.encode(s).length;

let pass = 0;
const fails = [];
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    fails.push(msg);
    console.log(`  ❌ ${msg}`);
  }
}

const TASK = "T-1022";

// ==================================================== ① 纯函数：truncateForStorage
console.log("\n① 纯函数 · 未超限原样 / 空值透传 / 超限截断＋留痕标注");
{
  const short = "京东超市 30-39 岁人群复购率环比 +3.2%（真实返回摘要）";
  assert(truncateForStorage(short) === short, "未超限 → 返回同一字符串（逐字符相等）");
  assert(truncateForStorage(null) === null && truncateForStorage("") === "", "null / 空串原样透传（失败时空语义归 schema）");

  // 中文 3 字节/字：400,000 字 = 1,200,000 字节 > 1,000,000 上限 → 触发截断
  const big = "数".repeat(400_000);
  const out = truncateForStorage(big);
  assert(out !== big && typeof out === "string", "超限（1,200,000 字节 > 上限）→ 触发截断");
  const nl = out.lastIndexOf("\n[TRUNCATED result_summary]");
  assert(nl > 0, "文末含 `[TRUNCATED result_summary]` 留痕标注");
  const body = out.slice(0, nl);
  assert(byteLen(body) <= SUMMARY_MAX_BYTES && byteLen(body) >= SUMMARY_MAX_BYTES - 2,
    `截断主体落在上限内且贴近上限（字符边界回退，实测 ${byteLen(body)} ≤ ${SUMMARY_MAX_BYTES}）`);
  assert(!body.includes("\uFFFD"), "截断落在字符边界（无 U+FFFD 残缺字符）");
  assert(out.includes(`原文 ${byteLen(big)} 字节`), `标注记录原字节数（${byteLen(big)}）`);
  assert(out.includes("TS-16"), "标注回指 tech-stack §8 TS-16 裁决");

  // 字节恰好不超限：333,333 字 × 3 = 999,999 字节 < 1,000,000 → 原样
  const fit = "字".repeat(333_333);
  assert(truncateForStorage(fit) === fit, `恰不超限（${byteLen(fit)} 字节 < 上限）→ 原样返回`);
}

// ==================================================== ② EXT-01 端到端：saveQueryRecord 落痕
console.log("\n② EXT-01 端到端 · 超限信封落痕已截断＋标注 / 短信封逐字节原样");
{
  const { db } = freshDb();
  const env = mapResponseToResult(defaultOk("cdp.crowd.query", "CDP"),
    { task_id: TASK, source: { source_id: "CDP" }, query_condition: "{}", queried_at: "2026-09-19 09:00:00" });
  env.result_summary = "果".repeat(400_000); // 1.2MB 字节
  const saved = await saveQueryRecord(db, env, { task_id: TASK });
  const row = await getQueryRecord(db, saved.query_id);
  assert(row && row.result_status === "ok", "落痕成功（result_status=ok）");
  const stored = row.result_summary;
  const nl = stored.lastIndexOf("\n[TRUNCATED result_summary]");
  assert(nl > 0, "行内 result_summary 含留痕标注（分析面信封仍为全量原文，截断只发生在存储面）");
  assert(byteLen(stored.slice(0, nl)) <= SUMMARY_MAX_BYTES, `行内截断主体 ≤ 上限字节（实测 ${byteLen(stored.slice(0, nl))}）`);

  // 短信封：逐字节原样（真实返回原样透传红线不受影响）
  const env2 = mapResponseToResult(defaultOk("cdp.crowd.query", "CDP"),
    { task_id: TASK, source: { source_id: "CDP" }, query_condition: "{}", queried_at: "2026-09-19 09:00:01" });
  const saved2 = await saveQueryRecord(db, env2, { task_id: TASK });
  const row2 = await getQueryRecord(db, saved2.query_id);
  assert(row2.result_summary === env2.result_summary, "未超限信封 → 行内逐字节原样（原样透传红线不变）");
}

// ==================================================== ③ EXT-02 端到端：createEvidence 落库
console.log("\n③ EXT-02 端到端 · 超限证据落库已截断＋标注 / 短证据原样");
{
  const { db } = freshDb();
  const env = mapResponseToResult(defaultOk("cdp.crowd.query", "CDP"),
    { task_id: TASK, source: { source_id: "CDP" }, query_condition: "{}", queried_at: "2026-09-19 09:00:00" });
  const q1 = await saveQueryRecord(db, env, { task_id: TASK });
  const q2 = await saveQueryRecord(db, { ...env, queried_at: "2026-09-19 09:00:01" }, { task_id: TASK });

  const base = {
    source_id: "CDP",
    evidence_title: "人群标签分布（真实返回）",
    query_condition: "{}",
    info_time_point: "2026-09-19 09:00:00",
    applicability_scope: "京东超市",
    missing_note: "无缺口",
    created_at: "2026-09-19 09:05:00",
  };
  await createEvidence(db, { evidence_id: "EV-TS16-1", query_id: q1.query_id, ...base, result_summary: "证".repeat(400_000) });
  await createEvidence(db, { evidence_id: "EV-TS16-2", query_id: q2.query_id, ...base, result_summary: "短摘要" });
  const r1 = db.prepare("SELECT result_summary FROM evidence WHERE evidence_id = 'EV-TS16-1'").first();
  const r2 = db.prepare("SELECT result_summary FROM evidence WHERE evidence_id = 'EV-TS16-2'").first();
  const nl = r1.result_summary.lastIndexOf("\n[TRUNCATED evidence.result_summary]");
  assert(nl > 0, "EXT-02 行内含留痕标注（field 名进入标注便于回查定位）");
  assert(byteLen(r1.result_summary.slice(0, nl)) <= SUMMARY_MAX_BYTES, `截断主体 ≤ 上限字节（实测 ${byteLen(r1.result_summary.slice(0, nl))}）`);
  assert(r2.result_summary === "短摘要", "未超限证据 → 原样落库（「原样保留，不拆数值」不变）");
}

// ==================================================== 汇总
console.log(`\n=== TS-16 截断用例：通过 ${pass} / 失败 ${fails.length} ===`);
if (fails.length) {
  console.log("失败项：\n - " + fails.join("\n - "));
  process.exit(1);
}
