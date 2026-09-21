#!/usr/bin/env node
/**
 * 文档卡（阶段5 · M6 · F-30 用例执行器 · 2026-09-20）
 * 上游：`../../docs/05-test-cases/test-M6.md`（**TC-I-M6-004 = F-30 验收 oracle**：呈现结果七要素；
 *        每项关键发现挂证据来源与适用范围；候选 HVA 支持/不支持并列；**已查明与仍受限内容视觉可分**）
 *   ｜ `../../docs/01-brd/BRD.md` §4 F-30（功能描述＝呈现结果七要素＋逐发现挂证据来源与适用范围＋候选 HVA
 *        支持/不支持并列；验收要点＝**已查明与仍受限的内容视觉可分**）
 *   ｜ `../../docs/02-prd/PRD-M6-运营端工作台.md` F-30（验收要点）
 *   ｜ `../../docs/03-locks/tech-stack.md`（§1.2 前后端分离落点；§2.1 前端形态＝零构建静态资源，
 *        数据来源＝server/api，**原型的 mock 数据不复制进前端**）
 *   ｜ `../../docs/03-locks/schema.md`（MD-07 research：七要素 ①②④⑥｜MD-08 research_finding：③｜
 *        MD-09 candidate_behavior + MD-10 behavior_point：⑤｜MD-11 improvement_action：⑦｜
 *        LNK-02 finding_evidence：逐发现挂证据）
 *   ｜ `../../prototype/pages/result.html`（**钉死需求的实证**：①~⑦ 一整页、③ 可折叠、⑤ 支持/不支持并列、
 *        ⑦ 逐项对应表；同名页 study.html 已并入本页，仅作跳转）
 *   ｜ `./pages/result.html`（被测页面）｜ `./assets/api.js`（唯一数据出口）｜ `./assets/app.js`（共享口径）
 *   ｜ `../server/api/index.js`（**真实后端**：`GET /api/research`（全量切换器）、
 *        `GET /api/research-result/{no}`（F-21 七要素读面）、`GET /api/evidence-trace/{id}`（③ 证据点开回查））
 *   ｜ `../server/agent-orchestrator/result.js`（`loadResearchResultContext`：七要素 `elements` 真源；
 *        `RESULT_ELEMENTS`、`scanResultBoundary`（复用 F-18 禁词表，输出不含活动配置/权益组合/预算/排期））
 * 职责：用 jsdom 加载**真实页面**（内联 `<script src>`，走真实 `DOMContentLoaded` → `pageInit` 链路），
 *       把 `window.fetch` 接到**真实 Worker + 真实 D1（node:sqlite 适配层，载真实 DDL/种子）**，
 *       实跑 F-30 用例并断言。
 * 硬红线：仅本机内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义与「前后端分离」）。
 * 边界：本执行器只验 F-30；F-27/F-28/F-29 与 F-31~F-32 各自的执行器覆盖。静态扫描一律**先 strip 注释**
 *       （本文件自身的文档卡里就出现 `frontend`、`fetch` 等被扫词，不 strip 会自伤）。
 * 反向清单：登记 `./README.md`；被 `.github/workflows/ci.yml` 的 `validate` 步骤复用
 *       （`node frontend/test-f30.mjs`）。
 *
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node frontend/test-f30.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import worker from "../server/api/index.js";

const require = createRequire(import.meta.url);
// 前端用例是**唯一**需要 jsdom 的执行器（仓库零构建、无 package.json，jsdom 只作测试期依赖）。
// 缺依赖时**显式失败**并给出安装命令——不静默跳过（前端用例被跳过＝一条无人看守的静默洞）。
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  console.error("VERIFY FAIL · 缺少测试期依赖 jsdom。安装后重跑：");
  console.error("  npm i --no-save jsdom && node frontend/test-f30.mjs");
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DDL_PATH = path.join(ROOT, "db/migrations/0001_init.sql");
const SEED_PATH = path.join(ROOT, "db/seed/0001_mock.sql");
const SESSION_KEY = "jd_growth_frontend_session_v1";

/* ============================================================ 基建 */

/** node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()（`first()` 返回行或 null）。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      try {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      } catch (e) { return { success: false, error: String(e.message || e) }; }
    },
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: (col) => {
      const row = sqlite.prepare(sql).get(...params) ?? null;
      if (row === null) return null;
      return col === undefined ? row : row[col];
    },
  });
  return { prepare: (sql) => makeStmt(sql, []) };
}

/** 建库：真实 DDL + 真实种子；种子自带 FK pragma，先剥离再载入，之后开 FK。 */
function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  sqlite.exec(readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, ""));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

/** 静态扫描前必做：去注释（HTML / CSS / 整行 JS 注释），否则文档卡里的字面词会自伤。 */
const stripAllComments = (src, kind) => {
  let s = src.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "html") s = s.replace(/<!--[\s\S]*?-->/g, "");
  s = s.replace(/^\s*\/\/[^\n]*$/gm, "");
  return s;
};

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const rel = (p) => path.relative(ROOT, p);
const frontendFiles = () =>
  walk(path.join(ROOT, "frontend")).filter((f) => /\.(js|html|css|mjs)$/.test(f)).sort();

/* ---------- 页面加载：内联 <script src> + 注 fetch + 注会话态 ---------- */
function loadPage(relPath, { query = "", session = null, fetcher } = {}) {
  const abs = path.join(ROOT, "frontend", relPath);
  let html = readFileSync(abs, "utf8");
  html = html.replace(/<script src="([^"]+)"><\/script>/g, (_m, src) => {
    const p = path.resolve(path.dirname(abs), src);
    return "<script>" + readFileSync(p, "utf8") + "</script>";
  });
  const errors = [];
  const vc = new VirtualConsole();
  vc.on("jsdomError", (e) => errors.push(String((e && e.message) || e)));
  vc.on("error", (m) => errors.push("console.error: " + m));
  const dom = new JSDOM(html, {
    url: "http://localhost/" + relPath + query,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w) {
      w.fetch = fetcher;
      if (session) w.localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    },
  });
  dom.__errors = errors;
  return dom;
}

/** fetch 端口：接到**真实 Worker**（真实路由 + 真实库）；记录每个请求，供契约与只读断言。 */
function makeFetcher(db, calls) {
  return async function (input, init = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const u = new URL(raw, "http://localhost");
    calls.push({ method: String(init.method || "GET").toUpperCase(), url: u.toString(), path: u.pathname + u.search });
    const req = new Request(u.toString(), { method: init.method || "GET", headers: init.headers, body: init.body });
    return await worker.fetch(req, { DB: db });
  };
}

/** 直接打真实 Worker（不经前端）——给门禁/空态用例造真实前置状态。 */
async function api(db, method, p, body) {
  const req = new Request("http://localhost" + p, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const res = await worker.fetch(req, { DB: db });
  let payload = null;
  try { payload = await res.json(); } catch (e) { payload = null; }
  return { status: res.status, payload };
}

async function waitFor(fn, ms = 5000) {
  const t0 = Date.now();
  for (;;) {
    let ok = false;
    try { ok = !!fn(); } catch (e) { ok = false; }
    if (ok) return true;
    if (Date.now() - t0 > ms) return false;
    await new Promise((r) => setTimeout(r, 10));
  }
}

const click = (dom, id) =>
  dom.window.document.getElementById(id).dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
const clickEl = (dom, el) => el.dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
/** 选择器工具：第一个参数可以是 JSDOM、Document 或 Element（避免「把元素当 dom 传」这类失误）。 */
const rootOf = (x) => (x && x.window ? x.window.document : x);
const q = (dom, sel) => rootOf(dom).querySelector(sel);
const qa = (dom, sel) => [...rootOf(dom).querySelectorAll(sel)];
const text = (dom, sel) => {
  const el = q(dom, sel);
  return el ? el.textContent : "";
};
/** 填入并触发 `input`（页面据此做即时检查）。 */
const setVal = (dom, id, v) => {
  const el = dom.window.document.getElementById(id);
  el.value = v;
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  return el;
};

/* ---------- 断言 ---------- */
let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

/* ============================================================ ① 契约与上游 oracle 逐条对齐 */
console.log("① 契约与上游 oracle 逐条对齐（TC-I-M6-004 / TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）");
{
  const tc = readFileSync(path.join(ROOT, "docs/05-test-cases/test-M6.md"), "utf8");
  const brd = readFileSync(path.join(ROOT, "docs/01-brd/BRD.md"), "utf8");
  const prd = readFileSync(path.join(ROOT, "docs/02-prd/PRD-M6-运营端工作台.md"), "utf8");
  const line = (id) => (tc.split("\n").find((l) => l.includes(id)) || "");

  const orc = line("TC-I-M6-004");
  assert(orc.includes("呈现结果七要素"), "oracle TC-I-M6-004：呈现结果七要素");
  assert(/每项关键发现挂证据来源与适用范围/.test(orc), "oracle：每项关键发现挂证据来源与适用范围");
  assert(/候选 HVA 支持\/不支持并列/.test(orc), "oracle：候选 HVA 支持/不支持并列");
  assert(/已查明与仍受限内容视觉可分/.test(orc), "oracle：已查明与仍受限内容视觉可分");

  assert(/#### F-30 研究结果页/.test(brd), "BRD §4 F-30 标题在案（研究结果页）");
  assert(/呈现结果七要素/.test(brd), "BRD §4 F-30 功能描述含「呈现结果七要素」");
  assert(/每项关键发现挂证据来源与适用范围/.test(brd), "BRD F-30：逐发现挂证据来源与适用范围");
  assert(/候选 HVA 的支持 \/ 不支持情况并列展示/.test(brd), "BRD F-30：候选 HVA 支持/不支持并列");
  assert(/已查明与仍受限的内容视觉可分/.test(brd), "BRD F-30 验收要点：已查明与仍受限视觉可分");

  assert(/F-30/.test(prd) && /研究结果页/.test(prd), "PRD-M6 F-30（研究结果页）在案");
  assert(/七要素/.test(prd) && /视觉可分/.test(prd), "PRD-M6 F-30 验收要点与 BRD 同口径（七要素／视觉可分）");
}

/* ============================================================ ② 静态红线（前端纪律） */
console.log("② 静态红线：只经 server/api、不持凭证、不写库、不复制 mock 数据");
{
  const files = frontendFiles();
  const code = {};
  for (const f of files) {
    if (/^test-f\d+\.mjs$/.test(path.basename(f))) continue; // 执行器自身不属于前端运行期产物
    const kind = f.endsWith(".html") ? "html" : "js";
    code[rel(f)] = stripAllComments(readFileSync(f, "utf8"), kind);
  }
  const names = Object.keys(code);
  assert(names.length >= 7, `前端受检运行期文件 ${names.length} 个（实测）`);

  const abs = names.filter((n) => /https?:\/\//.test(code[n]));
  assert(abs.length === 0, `无任何绝对地址（http/https）——前端不直连外部系统（实测命中 ${abs.length}）`);

  const protoRel = names.filter((n) => /["'`]\/\/[a-z0-9.-]+\//i.test(code[n]));
  assert(protoRel.length === 0, `无协议相对地址（//host/）——同上（实测命中 ${protoRel.length}）`);

  const cred = names.filter((n) => /\bAuthorization\b|\bBearer\b|api[_-]?key|access[_-]?token|secret[_-]?key/i.test(code[n]));
  assert(cred.length === 0, `不设 Authorization / 不持 API Key / Token / Secret（实测命中 ${cred.length}）`);

  const d1 = names.filter((n) => /\benv\.DB\b|D1Database|\.prepare\s*\(/.test(code[n]));
  assert(d1.length === 0, `不出现 D1 binding 与 SQL 语句入口（前端不直连数据库，实测命中 ${d1.length}）`);

  const SQL_STMT = /["'`][^"'`]*\b(?:SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[\w"'`[\].]+\s+SET|DELETE\s+FROM|DROP\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|TRUNCATE\s+TABLE)\b/i;
  const sql = names.filter((n) => SQL_STMT.test(code[n]));
  assert(sql.length === 0, `不出现 SQL 语句（前端不写库，实测命中 ${sql.length}${sql.length ? "：" + sql.join(",") : ""}）`);

  const mock = names.filter((n) => /window\.DB\b|assets\/data\.js/.test(code[n]));
  assert(mock.length === 0, `不引用原型的 mock 数据源（原型的 mock 数据不复制进前端，实测命中 ${mock.length}）`);

  const fetchHits = names.filter((n) => /\bfetch\s*\(/.test(code[n]));
  assert(fetchHits.length === 1 && fetchHits[0] === "frontend/assets/api.js",
    `fetch 只出现在唯一数据出口 assets/api.js（实测 ${fetchHits.join(",") || "无"}）`);

  const apiSrc = code["frontend/assets/api.js"];
  assert(/path\.indexOf\("\/api\/"\)\s*!==\s*0/.test(apiSrc), "api.js 有「路径必须 /api/ 开头」的运行期守卫");
  assert(/indexOf\(":\/\/"\)\s*!==\s*-1/.test(apiSrc), "api.js 有「不得是绝对地址」的运行期守卫");
  assert(/const BASE = ""/.test(apiSrc), "api.js 的 BASE 为空串（同源部署，不得指向任何外部域名）");
  assert(!/https?:\/\//i.test(apiSrc), "api.js 内无任何带 scheme 的地址（同源相对路径，实测命中 0）");

  const appSrc = code["frontend/assets/app.js"];
  assert(!/\bfetch\s*\(/.test(appSrc), "app.js 自身不发请求（一律经 api.js）");
  assert(/window\.API\./.test(appSrc), "app.js 取数经 window.API（唯一出口）");

  const page = code["frontend/pages/result.html"];
  assert(/assets\/api\.js/.test(page) && /assets\/app\.js/.test(page), "研究页只加载 api.js 与 app.js 两个脚本");
  assert(!/<script src="[^"]*data\.js/.test(page), "研究页不加载原型 data.js");
  assert(/<link rel="stylesheet" href="\.\.\/assets\/base\.css">/.test(page), "研究页只引本目录 base.css（无外部样式）");
  assert(!/changeOpportunityStatus/.test(page), "研究页不调用机会状态写面（只读呈现，不写库）");
  assert(/listAllResearch/.test(page) && /getResearchResult/.test(page) && /getEvidenceTrace/.test(page),
    "研究页经 window.API 的三个只读封装取数（研究列表／结果回查／证据回查）");
}

/* ============================================================ ③ 渲染（真实后端）：默认 R-007 */
console.log("③ 渲染（真实后端）：默认 R-007 —— 七要素 ①~⑦ + 证据点开回查 + 已查明/仍受限视觉可分");
const ctx = freshDb();
const { sqlite, db } = ctx;
const calls = [];
let dom;
{
  assert(countRows(sqlite, "research") === 2, "种子基线：MD-07 有 2 条已完成研究（R-007 / R-006）");
  assert(countRows(sqlite, "research_finding") === 6, `种子基线：MD-08 关键发现 6 行（R-007×4 / R-006×2，实测 ${countRows(sqlite, "research_finding")}）`);

  dom = loadPage("pages/result.html", { query: "", fetcher: makeFetcher(db, calls) });
  const ready = await waitFor(() => text(dom, "#res-meta").length > 0);
  assert(ready, "页面完成启动（研究清单 + 结果回查 + 渲染）");
  assert((dom.__errors || []).length === 0,
    `页面零运行时错误（实测 ${(dom.__errors || []).length}${(dom.__errors || [])[0] ? "：" + dom.__errors[0] : ""}）`);

  // ---- 研究切换器：全量 2 条 ----
  assert(qa(dom, "#study-sel option").length === 2, "研究切换器含 2 个选项（R-007 / R-006）");
  const opts = qa(dom, "#study-sel option").map((o) => o.value);
  assert(opts.includes("R-007") && opts.includes("R-006"), "切换器选项含 R-007 与 R-006");

  // ---- 页头元信息（对应机会 / 目标版本 / 完成时间） ----
  const meta = text(dom, "#res-meta");
  assert(meta.includes("OPP-012"), "页头显示对应机会 OPP-012（逐字取自服务端）");
  assert(meta.includes("GOAL-2026Q3-01") && meta.includes("v3"), "页头显示目标 GOAL-2026Q3-01 v3");
  assert(meta.includes("2026-09-17 18:42"), "页头显示完成时间 2026-09-17 18:42（逐字）");

  const root = text(dom, "#root");

  // ---- 顶部结论条：R-007 有候选行为获得支持 ----
  assert(root.includes("有候选行为获得支持（仍属候选，未定性）"),
    "结论条：R-007 显示「有候选行为获得支持（仍属候选，未定性）」（supported_count=1）");

  // ---- ① 业务目标与研究问题 ----
  assert(root.includes("业务目标：提升京东超市新客 30 天复购率（GOAL-2026Q3-01 v3）"),
    "① 业务目标与研究问题逐字取自服务端（e1_goal_statement）");

  // ---- ② 研究范围与方法 ----
  assert(root.includes("研究范围：京东超市主站 APP 端"), "② 研究范围与方法逐字取自服务端（e2_scope_method）");

  // ---- ③ 证据与关键发现（已查明视觉） ----
  const evBody = q(dom, "#ev-body");
  assert(!!evBody && evBody.classList.contains("res-established"), "③ 关键发现以「已查明」视觉呈现（.res-established 绿左线）");
  assert(qa(dom, ".find-item").length === 4, `③ R-007 有 4 条关键发现（实测 ${qa(dom, ".find-item").length}）`);
  assert(root.includes("搜索进入与推荐位进入的新客，在消费力标签、品类偏好上的分布基本一致，可比基础成立"),
    "③ 逐条发现文本逐字取自服务端（F-001）");
  assert(qa(dom, ".find-item .badge-done").length === 4, "③ 4 条发现均为「已支持」徽标（badge-done）");
  const folds = qa(dom, "[data-ev]");
  assert(folds.length >= 1 && folds.some((f) => /EV-1038/.test(f.textContent)), "③ 每条发现下挂证据折叠（含证据编号 EV-1038）");

  // ---- ④ 人群差异 ----
  assert(root.includes("有二次找品行为的新客复购率 29.3%"), "④ 人群差异逐字取自服务端（e4_population_diff）");

  // ---- ⑤ 候选 HVA 及支持情况（支持/不支持并列） ----
  assert(root.includes("首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）"), "⑤ 候选行为名逐字取自服务端（CB-001）");
  assert(root.includes("支持") && root.includes("不支持"), "⑤ 候选行为状态徽标并列（支持 / 不支持）");
  assert(root.includes("支持的方面") && root.includes("不支持 / 存疑的方面"), "⑤ 支持与不支持两列并列展示（grid-2 两块 alert）");
  assert(root.includes("有无该行为的人群复购差异达 11.4pp"),
    "⑤ 支持的方面逐字取自服务端（BP-002 point_text）");
  assert(root.includes("CDP 无用户级明细，行为发生的精确时序未逐人核对"),
    "⑤ 不支持/存疑的方面逐字取自服务端（BP-004 point_text）");

  // ---- ⑥ 其他解释与限制（仍受限视觉） ----
  const limited = q(dom, ".doc-limits.res-limited");
  assert(!!limited, "⑥ 其他解释与限制以「仍受限」视觉呈现（.doc-limits.res-limited 琥珀底）");
  assert(root.includes("观察到「行为与较好表现同时出现」不等于因果"),
    "⑥ 限制文本逐字取自服务端（e6_limits）");
  // ---- 视觉可分：③ 与 ⑥ 使用两套不同视觉类 ----
  assert(!!evBody && !!limited && evBody !== limited, "已查明（.res-established）与仍受限（.res-limited）为两套不同视觉，明显可分");

  // ---- ⑦ 改善方向（逐项对应表） ----
  const tbl = q(dom, "table.tbl.tbl-sm");
  assert(!!tbl, "⑦ 改善方向以逐项对应表呈现（table.tbl.tbl-sm）");
  assert(tbl && qa(tbl, "tbody tr").length === 3, `⑦ R-007 有 3 条改善方向（实测 ${tbl ? qa(tbl, "tbody tr").length : 0}）`);
  assert(root.includes("搜索进入的超市新客") && root.includes("乳品烘焙方向的新客") && root.includes("研究本身"),
    "⑦ 改善方向行逐字取自服务端（AC-001/002/003 的 target_for）");
  assert(root.includes("活动玩法配置、权益组合、预算与排期不在本研究结论范围内"),
    "⑦ 末附不覆盖范围声明（out_of_scope_note，承载硬红线）");
}

/* ============================================================ ④ 证据点开回查（③ 内，同 F-28 链路） */
console.log("④ 证据点开回查：点开才调真实 GET /api/evidence-trace/{id}，渲染四要素与可回查判据");
{
  const fold = q(dom, '[data-ev="EV-1038"]');
  assert(!!fold, "存在 EV-1038 证据折叠（③ 中 F-001 关联）");
  const sum = fold.querySelector("summary");
  const before = calls.length;
  clickEl(dom, sum);
  const body = q(dom, '[data-ev-body="EV-1038"]');
  const loaded = await waitFor(() => body && body.dataset && body.dataset.loaded === "1");
  assert(loaded, "点开后回查并完成渲染（dataset.loaded=1）");
  assert(calls.length === before + 1 && calls[calls.length - 1].path === "/api/evidence-trace/EV-1038",
    "证据回查经真实路由 GET /api/evidence-trace/EV-1038（不复制 mock 数据）");
  const bt = body.textContent;
  assert(/查询条件/.test(bt) && /信息时点/.test(bt) && /适用范围/.test(bt) && /查询结果/.test(bt),
    "证据回查渲染四要素字段（查询条件 / 信息时点 / 适用范围 / 查询结果）");
  assert(/四要素/.test(bt), "证据回查给出「四要素齐全 / 不齐」可回查判据");
}

/* ============================================================ ⑤ 切换器切到 R-006 重渲染（未支持候选） */
console.log("⑤ 切换器切到 R-006：重渲染——未支持候选 / 不同结论条 / AC-004");
{
  const sel = q(dom, "#study-sel");
  sel.value = "R-006";
  sel.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const reReady = await waitFor(() => text(dom, "#res-meta").includes("OPP-010"));
  assert(reReady, "切换后重新渲染（页头机会变为 OPP-010）");

  const root = text(dom, "#root");
  assert(root.includes("未找到足够依据支持候选行为，这也是完整的研究结果"),
    "结论条：R-006 切换为「未找到足够依据支持候选行为，这也是完整的研究结果」（supported_count=0）");
  assert(text(dom, "#res-meta").includes("2026-09-16 15:10"), "R-006 完成时间 2026-09-16 15:10（逐字）");

  // ③ 发现数量不同（R-006 有 2 条）
  assert(qa(dom, ".find-item").length === 2, `③ R-006 重渲染为 2 条发现（实测 ${qa(dom, ".find-item").length}）`);
  assert(root.includes("家庭装首单新客复购率 31.5%"), "③ R-006 发现文本逐字（F-005）");

  // ⑤ 候选行为未支持
  assert(root.includes("首单购买家庭装 / 多件装"), "⑤ R-006 候选行为名逐字（CB-002）");
  assert(root.includes("不支持"), "⑤ R-006 候选行为徽标＝「不支持」");
  assert(root.includes("两组人群消费力标签本身差异显著"), "⑤ R-006 不支持方面逐字（BP-008）");

  // ⑦ 改善方向不同（R-006 仅 1 条 AC-004）
  const tbl = q(dom, "table.tbl.tbl-sm");
  assert(tbl && qa(tbl, "tbody tr").length === 1, `⑦ R-006 重渲染为 1 条改善方向（实测 ${tbl ? qa(tbl, "tbody tr").length : 0}）`);
  assert(root.includes("若继续验证，需先构造消费力可比的人群分组"), "⑦ R-006 改善方向逐字（AC-004）");
}

/* ============================================================ ⑥ 前端不写库 / 只读（TC-C-M6-001 / TC-D-M6-001） */
console.log("⑥ 前端只读：全部请求经 /api/、仅 GET、零写（硬红线：前端不发起任何生产写接口调用）");
{
  assert(calls.every((c) => c.path.startsWith("/api/")), `全部 ${calls.length} 次请求均经 /api/（无直连外部）`);
  assert(calls.every((c) => new URL(c.url).origin === "http://localhost"), "所有请求**同源**（origin 与页面一致）");
  assert(calls.every((c) => c.method === "GET"), `全部请求仅 GET（实测 ${calls.length} 次，无写）`);

  const expect = ["/api/research", "/api/research-result/R-007", "/api/research-result/R-006", "/api/evidence-trace/EV-1038"];
  for (const p of expect) {
    assert(calls.some((c) => c.path === p), `只读路由被真实调用：${p}`);
  }
  const writes = calls.filter((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method));
  assert(writes.length === 0, `未发起任何写请求（生产写接口调用红线，实测 ${writes.length}）`);

  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  assert(!/R-007|R-006|EV-1038/.test(raw), "研究数据不在前端存储（业务数据只存服务端）");
}

/* ============================================================ ⑦ 前后端分离判断（TC-I-M6-007） */
console.log("⑦ 前后端分离：删掉 frontend/ 后 server/api 与 db 仍独立可用");
{
  const runtime = [];
  for (const dir of ["server", "db", "scripts"]) {
    for (const f of walk(path.join(ROOT, dir))) {
      if (/\.(js|mjs|sql)$/.test(f) && !/node_modules/.test(f)) runtime.push(f);
    }
  }
  const refs = runtime.filter((f) => {
    const kind = f.endsWith(".sql") ? "sql" : "js";
    return /\bfrontend\b/.test(stripAllComments(readFileSync(f, "utf8"), kind));
  });
  assert(refs.length === 0,
    `server/ + db/ + scripts/ 的 ${runtime.length} 个运行期文件零引用 frontend（实测命中 ${refs.length}${refs.length ? "：" + refs.map(rel).join(",") : ""}）`);

  const imports = runtime.filter((f) => /\.(js|mjs)$/.test(f) && /from\s+"[^"]*frontend/.test(readFileSync(f, "utf8")));
  assert(imports.length === 0, "无任何服务端模块 import 前端文件（不存在反向依赖）");

  const probes = [
    ["GET", "/api/research"],
    ["GET", "/api/research-result/R-007"],
    ["GET", "/api/evidence-trace/EV-1038"],
  ];
  const raw = [];
  for (const [method, p] of probes) {
    const res = await api(db, method, p);
    raw.push({ p, status: res.status });
  }
  assert(raw.every((r) => r.status === 200),
    `直接调用接口（不经前端）全部可用（实测 ${raw.map((r) => r.p.split("?")[0] + "→" + r.status).join("、")}）`);
  assert(!frontendFiles().some((f) => /\.json$/.test(f)), "前端不携带任何数据快照文件（无 mock 数据副本）");
}

finish();
