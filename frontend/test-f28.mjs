#!/usr/bin/env node
/**
 * 文档卡（阶段5 · M6 · F-28 用例执行器 · 2026-09-20）
 * 上游：`../../docs/05-test-cases/test-M6.md`（**TC-I-M6-002 = F-28 验收 oracle**：按目标浏览机会
 *        （状态：候选 / 暂不研究 / 已提交研究）；详情呈现**六要素齐全**＋证据链（来源 / 条件 / 时点
 *        可点开回查）＋未知项；**证据四要素缺一不可回查**。**TC-C-M6-001** = 契约：前端消费
 *        `server/api` 返回的 JSON，**前端不直连数据库、不持有任何外部系统凭证**，动态数据一律经 API；
 *        硬红线：前端不发起任何生产写接口调用。**TC-D-M6-001** = 前端不写库（前端代码库不得出现
 *        直接 D1 binding 或外部凭证）。**TC-I-M6-007** = 前后端分离判断标准：删掉 `frontend/`
 *        整个目录，`server/api` 与 `db` 仍能独立存在并被任意客户端调用）
 *   ｜ `../../docs/02-prd/PRD-M6-运营端工作台.md` F-28（验收要点；§4 约束 1/2/3）
 *   ｜ `../../docs/01-brd/BRD.md` §4 M6 F-28、§5.3 硬红线
 *   ｜ `../../docs/03-locks/tech-stack.md`（§1.2 前后端分离落点与判断标准；§2.1 前端形态＝零构建静态资源，
 *        数据来源＝server/api，**原型的 mock 数据不复制进前端**）
 *   ｜ `../../docs/03-locks/schema.md`（MD-06 opportunity / PD-05 opportunity_status_log /
 *        LNK-01 opportunity_evidence / EXT-02 evidence / EXT-01 query_record / CFG-01 source_registry）
 *   ｜ `../../docs/07-decisions/ADR-003`（六要素必填与未知项二态）
 *   ｜ `../../prototype/pages/opportunities.html`（**钉死需求的实证**：区块 / 交互 / 文案以其为准）
 *   ｜ `./pages/opportunities.html`（被测页面）｜ `./assets/api.js`（唯一数据出口）｜ `./assets/app.js`（共享口径）
 *   ｜ `../server/api/index.js`（**真实后端**：本执行器把页面的 fetch 接到 worker.fetch，不 mock 业务语义）
 *   ｜ `../server/shared-context/index.js`（`OPPORTUNITY_SIX_ELEMENTS` / `OPPORTUNITY_SIX_ELEMENT_LABELS`
 *        与 `getEvidenceTrace` 四要素回查口径的唯一真源）
 * 职责：用 jsdom 加载**真实页面**（内联 `<script src>`，走真实 `DOMContentLoaded` → `pageInit` 链路），
 *       把 `window.fetch` 接到**真实 Worker + 真实 D1（node:sqlite 适配层，载真实 DDL/种子）**，
 *       实跑 F-28 用例并断言。
 * 硬红线：仅本机内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构、语义与「前后端分离」）。
 * 边界：本执行器只验 F-28；F-27 与 F-29~F-32 各自的执行器覆盖。静态扫描一律**先 strip 注释**
 *       （本文件自身的文档卡里就出现 `frontend`、`fetch` 等被扫词，不 strip 会自伤）。
 * 反向清单：登记 `./README.md`；被 `.github/workflows/ci.yml` 的 `validate` 步骤复用
 *       （`node frontend/test-f28.mjs`）。
 *
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node frontend/test-f28.mjs
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
  console.error("  npm i --no-save jsdom && node frontend/test-f28.mjs");
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

/** 静态扫描前必做：去注释（含 HTML 注释与 CSS 注释），否则文档卡里的字面词会自伤。 */
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

/** fetch 端口：接到**真实 Worker**（真实路由 + 真实库）；记录每个请求，供 TC-C-M6-001 断言。 */
function makeFetcher(db, calls) {
  return async function (input, init = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const u = new URL(raw, "http://localhost");
    calls.push({ method: String(init.method || "GET").toUpperCase(), url: u.toString(), path: u.pathname + u.search });
    const req = new Request(u.toString(), { method: init.method || "GET", headers: init.headers, body: init.body });
    return await worker.fetch(req, { DB: db });
  };
}

/** 直接打真实 Worker（不经前端）——给夹具/门禁用例造真实前置状态。 */
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
const text = (dom, sel) => {
  const el = rootOf(dom).querySelector(sel);
  return el ? el.textContent : "";
};
/** 选择器工具：第一个参数可以是 JSDOM、Document 或 Element（避免「把元素当 dom 传」这类失误）。 */
const rootOf = (x) => (x && x.window ? x.window.document : x);
const q = (dom, sel) => rootOf(dom).querySelector(sel);
const qa = (dom, sel) => [...rootOf(dom).querySelectorAll(sel)];

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

const Q3 = "GOAL-2026Q3-01";
const OPERATOR = "产品经理 · PM";
/** 页面里写死的两条处置说明（见页头「有意偏差①」）：断言二者确实原样落进 PD-05。 */
const DEFER_NOTE = "PM 在 F-28 机会列表标记「暂不研究」（F-28 人工处置，经 server/api 留痕 PD-05）";
const RESTORE_NOTE = "PM 在 F-28 机会列表将机会恢复为「候选」（F-28 人工处置，经 server/api 留痕 PD-05）";

/* ============================================================ ① 契约与上游 oracle 逐条对齐 */
console.log("① 契约与上游 oracle 逐条对齐（TC-I-M6-002 / TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）");
{
  const tc = readFileSync(path.join(ROOT, "docs/05-test-cases/test-M6.md"), "utf8");
  const prd = readFileSync(path.join(ROOT, "docs/02-prd/PRD-M6-运营端工作台.md"), "utf8");
  const brd = readFileSync(path.join(ROOT, "docs/01-brd/BRD.md"), "utf8");
  const line = (id) => (tc.split("\n").find((l) => l.includes(id)) || "");

  const orc = line("TC-I-M6-002");
  assert(orc.includes("机会列表与详情页"), "oracle TC-I-M6-002 行在案（机会列表与详情页）");
  assert(/候选/.test(orc) && /暂不研究/.test(orc) && /已提交研究/.test(orc), "oracle 含三状态（候选 / 暂不研究 / 已提交研究）");
  assert(orc.includes("六要素齐全"), "oracle 含「六要素齐全」");
  assert(/证据链/.test(orc) && /来源/.test(orc) && /条件/.test(orc) && /时点/.test(orc) && /回查/.test(orc),
    "oracle 含「证据链（来源 / 条件 / 时点可点开回查）」");
  assert(orc.includes("未知项"), "oracle 含「未知项」");
  assert(orc.includes("四要素缺一不可回查"), "oracle 含「证据四要素缺一不可回查」");
  assert(orc.includes("ADR-003") && orc.includes("TC-I-M2-001"), "oracle 回指 ADR-003 与 M2 证据四要素用例");

  const c1 = line("TC-C-M6-001");
  assert(c1.includes("前端消费") && c1.includes("server/api"), "oracle TC-C-M6-001：前端消费 server/api 返回的 JSON");
  assert(/不直连数据库/.test(c1) && /凭证/.test(c1), "oracle TC-C-M6-001：前端不直连数据库、不持有外部系统凭证");
  assert(/生产写接口调用/.test(c1), "oracle TC-C-M6-001 硬红线：前端不发起任何生产写接口调用");

  const d1 = line("TC-D-M6-001");
  assert(d1.includes("前端不写库"), "oracle TC-D-M6-001：前端不写库（写请求经 server/api 转发）");

  const sep = line("TC-I-M6-007");
  assert(sep.includes("删掉") && sep.includes("frontend/"), "oracle TC-I-M6-007：删掉 frontend/ 后 server/api 与 db 仍独立可用");

  assert(prd.includes("按目标浏览机会"), "PRD-M6 F-28 在案（按目标浏览机会）");
  assert(/证据可回查到查询记录/.test(brd), "BRD F-28 验收要点在案（证据可回查到查询记录）");
  assert(/数据来自 M2（F-10）/.test(prd) && /回查经 M5 `EXT-01`/.test(prd),
    "PRD-M6 F-28 的衔接面＝M2 F-10（数据）＋ M5 EXT-01（回查）");
}

/* ============================================================ ② 机会六要素：与服务端逐条对齐 */
console.log("② 机会六要素键与标签与服务端真源逐条对齐（不复制第二个口径）");
{
  const scSrc = readFileSync(path.join(ROOT, "server/shared-context/index.js"), "utf8");
  const elBlock = /export const OPPORTUNITY_SIX_ELEMENTS = \[([\s\S]*?)\];/.exec(scSrc)[1];
  const serverKeys = [...elBlock.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const lbBlock = /export const OPPORTUNITY_SIX_ELEMENT_LABELS = \{([\s\S]*?)\};/.exec(scSrc)[1];
  const serverLabels = {};
  for (const m of lbBlock.matchAll(/(\w+)\s*:\s*"([^"]+)"/g)) serverLabels[m[1]] = m[2];

  const appSrc = readFileSync(path.join(ROOT, "frontend/assets/app.js"), "utf8");
  const appBody = stripAllComments(appSrc, "js");
  const feBlock = /const OPP_FIELDS = \[([\s\S]*?)\];/.exec(appBody)[1];
  const feKeys = [...feBlock.matchAll(/key:\s*"([^"]+)"/g)].map((x) => x[1]);
  const feLabels = [...feBlock.matchAll(/label:\s*"([^"]+)"/g)].map((x) => x[1]);

  assert(serverKeys.length === 6, `服务端 OPPORTUNITY_SIX_ELEMENTS 为 6 键（实测 ${serverKeys.length}）`);
  assert(feKeys.join(">") === serverKeys.join(">"),
    `前端 OPP_FIELDS 键序与服务端逐条相等（实测 ${feKeys.join(">")}）`);
  assert(feLabels.join("|") === serverKeys.map((k) => serverLabels[k]).join("|"),
    `前端中文标签与服务端 LABELS 逐条相等（实测 ${feLabels.join("|")}）`);
  assert(feKeys.includes("goal_version_no") && feKeys.includes("target_object"),
    "六要素含「版本」与「涉及对象」两列（ADR-003：「对应目标」占两列）");
  assert(!feKeys.includes("unknown_item"), "unknown_item **不在六要素内**（它是二态判定列，单独呈现）");
}

/* ============================================================ ③ 静态红线（前端纪律） */
console.log("③ 静态红线：只经 server/api、不持凭证、不写库、不复制 mock 数据");
{
  const files = frontendFiles();
  const code = {};
  for (const f of files) {
    if (/^test-f\d+\.mjs$/.test(path.basename(f))) continue; // 受检对象＝前端运行期产物；执行器（jsdom 装置）不属于它
    const kind = f.endsWith(".html") ? "html" : "js";
    code[rel(f)] = stripAllComments(readFileSync(f, "utf8"), kind);
  }
  const names = Object.keys(code);
  assert(names.length >= 6, `前端受检运行期文件 ${names.length} 个（实测）`);

  const abs = names.filter((n) => /https?:\/\//.test(code[n]));
  assert(abs.length === 0, `无任何绝对地址（http/https）——前端不直连外部系统（实测命中 ${abs.length}）`);

  const protoRel = names.filter((n) => /["'`]\/\/[a-z0-9.-]+\//i.test(code[n]));
  assert(protoRel.length === 0, `无协议相对地址（//host/）——同上（实测命中 ${protoRel.length}）`);

  const cred = names.filter((n) => /\bAuthorization\b|\bBearer\b|api[_-]?key|access[_-]?token|secret[_-]?key/i.test(code[n]));
  assert(cred.length === 0, `不设 Authorization / 不持 API Key / Token / Secret（实测命中 ${cred.length}）`);

  const d1 = names.filter((n) => /\benv\.DB\b|D1Database|\.prepare\s*\(/.test(code[n]));
  assert(d1.length === 0, `不出现 D1 binding 与 SQL 语句入口（前端不直连数据库，实测命中 ${d1.length}）`);

  // 判据＝**语句形态**，不是裸关键字：`<select>` 元素、CSS `select` 选择器、JS `delete` 运算符都不是 SQL。
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
  // 证据链「可回查」必须走既有回查路由——前端不自己拼「证据 + 查询记录」。
  assert(/\/api\/evidence-trace\//.test(apiSrc), "api.js 的证据回查走 /api/evidence-trace/（F-09 回查链路）");

  const appSrc2 = code["frontend/assets/app.js"];
  assert(!/\bfetch\s*\(/.test(appSrc2), "app.js 自身不发请求（一律经 api.js）");
  assert(/window\.API\./.test(appSrc2), "app.js 取数经 window.API（唯一出口）");

  const page = code["frontend/pages/opportunities.html"];
  assert(/assets\/api\.js/.test(page) && /assets\/app\.js/.test(page), "机会页只加载 api.js 与 app.js 两个脚本");
  assert(!/<script src="[^"]*data\.js/.test(page), "机会页不加载原型 data.js");
  assert(/<link rel="stylesheet" href="\.\.\/assets\/base\.css">/.test(page), "机会页只引本目录 base.css（无外部样式）");
  assert(/OPP_FIELDS/.test(page), "详情六要素字段取自 U.OPP_FIELDS（不内联手写第二份字段表）");
}

/* ============================================================ ④ 渲染（真实后端） */
console.log("④ 渲染（真实后端）：页头 / 运行链 / 列表 / 默认选中 / 详情六要素与未知项");
const ctx = freshDb();
const { sqlite, db } = ctx;
const calls = [];
let dom;
const oppsOf = (gid) => sqlite.prepare("SELECT * FROM opportunity WHERE goal_id = ? ORDER BY opportunity_id").all(gid);
const evLinks = (id) => sqlite.prepare("SELECT * FROM opportunity_evidence WHERE opportunity_id = ? ORDER BY link_id").all(id);
const logsOf = (id) => sqlite.prepare("SELECT * FROM opportunity_status_log WHERE opportunity_id = ?").all(id);
{
  const q3 = oppsOf(Q3);
  const applied = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND is_applied = 1").get(Q3);
  const first = q3[0].opportunity_id;

  dom = loadPage("pages/opportunities.html", { fetcher: makeFetcher(db, calls) });
  const ready = await waitFor(() => qa(dom, "[data-opp]").length > 0);
  assert(ready, "页面完成启动（外壳注入 + 取数 + pageInit）");
  assert((dom.__errors || []).length === 0, `页面零运行时错误（实测 ${(dom.__errors || []).length}${(dom.__errors || [])[0] ? "：" + dom.__errors[0] : ""}）`);
  assert(text(dom, "#boot-notice") === "", "无「数据加载失败」提示（取数成功）");

  const meta = text(dom, "#opp-meta");
  const goalRow = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = (SELECT current_version_no FROM research_goal WHERE goal_id = ?)").get(Q3, Q3);
  assert(meta.includes(goalRow.business_goal), "页头业务目标取自服务端当前版本（逐字）");
  assert(meta.includes(Q3), `页头显示目标编号（实测含 ${Q3}）`);
  assert(meta.includes("v" + applied.version_no), `页头显示生效版本 v${applied.version_no}（版本可见）`);

  const chain = text(dom, "#chain");
  assert(new RegExp("① 目标配置 v" + applied.version_no + " 已登记").test(chain), "运行链 ① 显示该目标的生效配置版本");
  const lastDisc = sqlite.prepare("SELECT * FROM task WHERE goal_id = ? AND task_type = 'discovery' ORDER BY task_id").all(Q3).slice(-1)[0];
  assert(new RegExp("② 机会发现\\s*已完成（任务 " + lastDisc.task_id + "）").test(chain),
    `运行链 ② 显示机会发现已完成并带最近一次任务号（实测链内任务 ${lastDisc.task_id}）`);
  assert(new RegExp("③ 机会产出 " + q3.length + " 条").test(chain), `运行链 ③ 机会产出条数＝该目标机会数（实测 ${q3.length}）`);

  const note = text(dom, "#count-note");
  assert(note.includes("共 " + q3.length + " 条") && note.includes(Q3 + " 下 " + q3.length + " 条"),
    `计数说明＝筛选后 / 该目标下（实测「${note}」）`);

  const rows = qa(dom, "[data-opp]");
  assert(rows.length === q3.length, `列表条数＝该目标机会数（实测 ${rows.length}／库内 ${q3.length}）`);
  assert(rows.map((r) => r.dataset.opp).join(">") === q3.map((r) => r.opportunity_id).join(">"),
    `列表只呈现本目标的机会且顺序取服务端（实测 ${rows.map((r) => r.dataset.opp).join(">")}）`);
  assert(qa(dom, "[data-opp].active").length === 1 && rows[0].classList.contains("active"),
    `默认选中第一条（实测 ${rows[0].dataset.opp}）`);
  assert(text(dom, "#list").includes("来自 T-1022"), "列表行显示产出来源任务");

  const o0 = q3[0];
  assert(text(dom, "#detail").includes(o0.opportunity_title), "详情标题＝选中机会标题（逐字）");
  for (const [k, v] of [
    ["goal_id", o0.goal_id],
    ["goal_version_no", "v" + o0.goal_version_no],
    ["target_object", o0.target_object],
    ["phenomenon", o0.phenomenon],
    ["initial_basis_note", o0.initial_basis_note],
    ["research_reason", o0.research_reason],
  ]) {
    const cell = q(dom, `[data-field="${k}"] .field-value`);
    assert(!!cell && cell.textContent === v, `详情六要素「${k}」逐字取自服务端（实测 ${cell ? JSON.stringify(cell.textContent.slice(0, 24)) : "缺失"}）`);
  }
  assert(text(dom, `[data-field="unknown_item"]`).includes(o0.unknown_item), "未知项展示服务端原文（二态：有未知项）");
  assert(text(dom, "#detail").includes("六要素齐全"), "六要素齐全者标注「六要素齐全」（oracle 验收要点）");
  assert(!/系统|平台自动判断|自动生成/.test(text(dom, "#detail .field-list")),
    "六要素正文不含任何「平台自动生成口径」痕迹");

  assert(calls.length >= 3, `启动取数 ${calls.length} 次，全部经 /api/（实测）`);
  assert(calls.every((c) => c.path.startsWith("/api/")), "所有请求路径均以 /api/ 开头（前端只经 server/api）");
  assert(calls.every((c) => new URL(c.url).origin === "http://localhost"), "所有请求**同源**（origin 与页面一致，实测）");
  assert(!calls.some((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method)),
    "进入页面**不产生任何写请求**（GET-only：看页面不写库）");
}

/* ============================================================ ⑤ 三状态与对象筛选 */
console.log("⑤ 三状态筛选 + 对象筛选：条数一律以真实库为真源");
{
  const q3 = oppsOf(Q3);
  const cnt = (pred) => q3.filter(pred).length;
  const pick = (kind, value) => {
    const c = qa(dom, `.chip[data-filter="${kind}"][data-value="${value}"]`)[0];
    assert(!!c, `筛选 chip 存在（${kind}=${value}）`);
    clickEl(dom, c);
    return c;
  };
  const shown = () => qa(dom, "[data-opp]");

  const expectStatus = {
    candidate: cnt((r) => r.opportunity_status === "candidate"),
    submitted: cnt((r) => r.opportunity_status === "submitted"),
    deferred: cnt((r) => r.opportunity_status === "deferred"),
  };
  assert(expectStatus.candidate >= 1 && expectStatus.submitted >= 1 && expectStatus.deferred >= 1,
    `种子含三种状态各自的机会（实测 候选 ${expectStatus.candidate} / 已提交 ${expectStatus.submitted} / 暂不研究 ${expectStatus.deferred}）`);

  for (const [st, label] of [["candidate", "候选"], ["submitted", "已提交研究"], ["deferred", "暂不研究"]]) {
    const c = pick("status", st);
    assert(shown().length === expectStatus[st], `状态「${label}」筛出 ${shown().length} 条＝库内 ${expectStatus[st]} 条`);
    assert(c.dataset.active === "1", `选中态 chip 标记 data-active（${label}）`);
  }

  pick("status", "all");
  assert(shown().length === q3.length, `状态「全部」恢复为该目标全部 ${q3.length} 条`);

  const expectObj = {
    人群: cnt((r) => String(r.target_object).includes("人群")),
    品类: cnt((r) => String(r.target_object).includes("品类")),
    旅程: cnt((r) => String(r.target_object).includes("旅程")),
  };
  for (const [ob, label] of [["人群", "人群"], ["品类", "品类"], ["旅程", "旅程环节"]]) {
    pick("obj", ob);
    assert(shown().length === expectObj[ob], `对象「${label}」筛出 ${shown().length} 条＝库内命中 ${expectObj[ob]} 条`);
  }
  pick("obj", "all");
  assert(shown().length === q3.length, "对象「全部」恢复为该目标全部机会");

  // 选一条改看详情：列表联动 + 详情随之切换
  const second = q3[1];
  clickEl(dom, qa(dom, "[data-opp]")[1]);
  assert(shown()[1].classList.contains("active"), "点击列表项切换选中（选中态跟随）");
  assert(text(dom, "#detail").includes(second.opportunity_title), "详情随选中切换（逐字）");
  clickEl(dom, qa(dom, "[data-opp]")[0]);
  assert(text(dom, "#detail").includes(q3[0].opportunity_title), "切回第一条，详情回到该机会");
}

/* ============================================================ ⑥ 证据链：关联条数与要素可见 */
console.log("⑥ 证据链：条数＝LNK-01 关联行数；来源 / 标题 / 时点可见；四要素缺一不可回查");
{
  const o0 = oppsOf(Q3)[0];
  const links = evLinks(o0.opportunity_id);
  assert(links.length >= 1, `选中机会有证据关联（实测 ${links.length} 条 LNK-01）`);

  const folds = qa(dom, "#detail [data-ev]");
  assert(folds.length === links.length, `证据链条数＝LNK-01 关联行数（实测 ${folds.length}／库内 ${links.length}）`);
  const firstEv = sqlite.prepare("SELECT * FROM evidence WHERE evidence_id = ?").get(links[0].evidence_id);
  const src = sqlite.prepare("SELECT * FROM source_registry WHERE source_id = ?").get(firstEv.source_id);
  const sum = folds[0].querySelector("summary");
  assert(sum.textContent.includes(src.source_name), `证据条呈现来源名称（实测含「${src.source_name}」）`);
  assert(sum.textContent.includes(firstEv.evidence_title), "证据条呈现证据标题（逐字）");
  assert(sum.textContent.includes(firstEv.info_time_point), "证据条呈现信息时点（未展开即可见）");
  assert(sum.textContent.includes(firstEv.evidence_id), "证据条呈现证据编号（可核对到具体一条）");
  assert(q(folds[0], "[data-ev-body]") && q(folds[0], "[data-ev-body]").dataset.loaded !== "1",
    "证据默认**不展开、不预取**（点开才回查，减少无谓请求）");

  const sources = qa(dom, "#source-fold .card-section");
  const srcCount = countRows(sqlite, "source_registry");
  assert(sources.length === srcCount, `「可用来源与工具」列出全部来源（实测 ${sources.length}／库内 ${srcCount}）`);
  assert(text(dom, "#source-fold").includes("不可查："), "来源说明含「可查 / 不可查」两段（M2-F-08 语义）");
}

/* ============================================================ ⑦ 证据可回查 + 四要素不齐反例 */
console.log("⑦ 证据可回查（EXT-01）/ 四要素不齐不可作为有效依据（反例）");
let dom2;
{
  const o0 = oppsOf(Q3)[0];
  const link0 = evLinks(o0.opportunity_id)[0];
  const ev0 = sqlite.prepare("SELECT * FROM evidence WHERE evidence_id = ?").get(link0.evidence_id);
  const callsBefore = calls.length;

  const fold = qa(dom, "#detail [data-ev]")[0];
  clickEl(dom, fold.querySelector("summary"));
  const got = await waitFor(() => {
    const body = q(dom, `[data-ev-body="${ev0.evidence_id}"]`);
    return body && /查询条件/.test(body.textContent);
  });
  assert(got, "点开证据触发回查并渲染出查询条件（证据链可点开回查）");
  assert(calls.slice(callsBefore).some((c) => c.path === "/api/evidence-trace/" + ev0.evidence_id),
    "回查走既有链路 /api/evidence-trace/{id}（前端不自己拼证据与查询记录）");

  const body = q(dom, `[data-ev-body="${ev0.evidence_id}"]`);
  const bt = body.textContent;
  assert(bt.includes(ev0.query_condition), "回查体呈现查询条件（逐字）");
  assert(bt.includes(ev0.info_time_point), "回查体呈现信息时点（逐字）");
  assert(bt.includes(ev0.applicability_scope), "回查体呈现适用范围（逐字）");
  assert(bt.includes(ev0.result_summary), "回查体呈现查询结果（真实返回，非替代值）");
  assert(bt.includes(ev0.missing_note), "回查体呈现缺失说明（逐字）");
  assert(bt.includes(ev0.query_id), `回查体呈现查询记录编号（实测含 ${ev0.query_id}）`);
  assert(/四要素齐全 · 可回查/.test(bt), "四要素齐全者标注「可回查」（oracle：证据可回查到查询记录）");

  // 反例：库级允许空白串（NOT NULL 拦不住 '   '），应用层必须判「四要素不齐」→ 不可作为有效依据
  const BAD = "EV-9099";
  sqlite.prepare(
    `INSERT INTO evidence (evidence_id, query_id, source_id, evidence_title, query_condition,
       info_time_point, applicability_scope, result_summary, missing_note, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(BAD, ev0.query_id, ev0.source_id, "【夹具】适用范围为纯空白串的证据", "夹具查询条件",
    "2026-09-20 取数", "   ", "夹具查询结果", "夹具缺失说明", "2026-09-20 00:00");
  const inserted = sqlite.prepare("SELECT * FROM evidence WHERE evidence_id = ?").get(BAD);
  assert(!!inserted, "库级**放行**「适用范围＝纯空白串」的证据行（NOT NULL 拦不住空白串，实测确认）");
  sqlite.prepare(
    "INSERT INTO opportunity_evidence (link_id, opportunity_id, evidence_id, link_kind, linked_at) VALUES (?, ?, ?, ?, ?)"
  ).run("LK-OE-9099", o0.opportunity_id, BAD, "related_update", "2026-09-20 00:00");

  dom2 = loadPage("pages/opportunities.html", { fetcher: makeFetcher(db, calls) });
  await waitFor(() => qa(dom2, "[data-opp]").length > 0);
  const folds2 = qa(dom2, "#detail [data-ev]");
  assert(folds2.length === evLinks(o0.opportunity_id).length,
    `新增关联后证据链条数随之增长（实测 ${folds2.length}）`);
  const bad = qa(dom2, `[data-ev="${BAD}"]`)[0];
  assert(!!bad, "夹具证据出现在证据链中（反例可见）");
  clickEl(dom2, bad.querySelector("summary"));
  const got2 = await waitFor(() => /四要素不齐/.test(text(dom2, `[data-ev-body="${BAD}"]`)));
  assert(got2, "四要素不齐的证据被标注「不可作为有效依据」（应用层判缺，不靠库级）");
  assert(text(dom2, `[data-ev-body="${BAD}"]`).includes("适用范围"),
    "缺什么就写明什么（实测理由含「适用范围」）");
  assert(!/四要素齐全 · 可回查/.test(text(dom2, `[data-ev-body="${BAD}"]`)),
    "不齐者**不会**被误标为「可回查」（四要素缺一不可回查）");
}

/* ============================================================ ⑧ 人工处置：状态变更落库 + PD-05 留痕 */
console.log("⑧ 人工处置：标记暂不研究 / 恢复为候选——落库并逐次留痕（PD-05）");
{
  dom = dom2; // 反例已入库，后续用例在这个页面实例上继续（数据经同一真实库）
  const target = oppsOf(Q3).filter((r) => r.opportunity_status === "candidate")[0];
  assert(!!target, "存在一条候选机会可供处置（实测）");

  // 选中目标机会
  const row = qa(dom, `[data-opp="${target.opportunity_id}"]`)[0];
  assert(!!row, `列表中存在机会 ${target.opportunity_id} 行`);
  clickEl(dom, row);
  assert(!!q(dom, `[data-defer="${target.opportunity_id}"]`), "候选机会给出「标记暂不研究」入口");

  const logsBefore = logsOf(target.opportunity_id).length;
  const oppCountBefore = countRows(sqlite, "opportunity");
  clickEl(dom, q(dom, `[data-defer="${target.opportunity_id}"]`));
  const deferred = await waitFor(() =>
    sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(target.opportunity_id).opportunity_status === "deferred");
  assert(deferred, "「标记暂不研究」经 server/api 落库（MD-06 状态真变为 deferred）");

  const afterDefer = sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(target.opportunity_id);
  assert(afterDefer.opportunity_id === target.opportunity_id && afterDefer.goal_id === target.goal_id,
    "机会身份（opportunity_id / goal_id）未被改写");
  const logsA = logsOf(target.opportunity_id);
  assert(logsA.length === logsBefore + 1, `状态变更逐次留痕（PD-05 行数 ${logsBefore} → ${logsA.length}）`);
  const logA = logsA[logsA.length - 1];
  assert(logA.from_status === "candidate" && logA.to_status === "deferred", "状态链记录 from→to（candidate → deferred）");
  assert(logA.change_reason === DEFER_NOTE, "变更说明原样落库（PD-05 change_reason NOT NULL 已满足）");
  assert(logA.changed_by === OPERATOR, "变更人取自页面固定操作人标识（非凭证）");
  assert(afterDefer.defer_reason === "PM 评估：该现象暂不列入本轮研究范围（记录保留，条件变化或出现新证据后可再选）",
    "defer_reason 仅 deferred 时填写（原样落库）");
  assert(countRows(sqlite, "opportunity") === oppCountBefore,
    `**只改状态不删记录**（机会行数 ${oppCountBefore} → ${countRows(sqlite, "opportunity")}，机会本体不被改写）`);

  await waitFor(() => /已变更为/.test(text(dom, "#action-note")));
  assert(/已变更为/.test(text(dom, "#action-note")) && text(dom, "#action-note").includes("暂不研究"),
    "处置后给出结果提示（含新状态）");
  assert(text(dom, "#detail").includes("暂不研究"), "详情卡随之显示暂不研究（含 defer_reason）");
  assert(!!q(dom, `[data-restore="${target.opportunity_id}"]`), "暂不研究者给出「恢复为候选」入口");

  // 恢复为候选
  clickEl(dom, q(dom, `[data-restore="${target.opportunity_id}"]`));
  const restored = await waitFor(() =>
    sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(target.opportunity_id).opportunity_status === "candidate");
  assert(restored, "「恢复为候选」经 server/api 落库（状态回到 candidate）");
  const afterRestore = sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(target.opportunity_id);
  assert(afterRestore.defer_reason === null, "非 deferred 状态清空 defer_reason（schema MD-06 口径）");
  const logsB = logsOf(target.opportunity_id);
  assert(logsB.length === logsBefore + 2, `恢复动作再留一条痕（PD-05 行数 ${logsA.length} → ${logsB.length}）`);
  assert(logsB[logsB.length - 1].to_status === "candidate" && logsB[logsB.length - 1].change_reason === RESTORE_NOTE,
    "恢复动作的变更说明原样落库");
  assert(logsB[logsB.length - 1].from_status === "deferred", "恢复动作的 from_status＝deferred（链完整可回查）");
  assert(!!q(dom, `[data-defer="${target.opportunity_id}"]`), "恢复后重新给出「标记暂不研究」入口（状态驱动）");
}

/* ============================================================ ⑨ 前端不写库 / 业务数据不落前端存储 */
console.log("⑨ 前端不写库、业务数据不落前端持久存储（TC-C-M6-001 / TC-D-M6-001）");
{
  assert(calls.every((c) => c.path.startsWith("/api/")), `全部 ${calls.length} 次请求均经 /api/（无直连外部）`);
  const writes = calls.filter((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method));
  assert(writes.length >= 2, `写动作全部经 server/api 转发（实测 ${writes.length} 次：${writes.map((w) => w.method + " " + w.path.split("?")[0]).join("、")}）`);
  assert(writes.every((w) => w.path === "/api/opportunity-status"),
    "写只落在平台自身的状态变更路由（机会状态 + PD-05 留痕）");
  assert(!writes.some((w) => /\/api\/(query|query-records|query-recovery|tool-permission|agent-delegations)/.test(w.path)),
    "未调用任何「生产查询 / 外部调用」类接口（硬红线：前端不发起任何生产写接口调用）");

  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const keys = Object.keys(JSON.parse(raw));
  assert(keys.every((k) => ["applied", "navUnread"].indexOf(k) !== -1),
    `前端持久存储只含会话态键（实测 ${JSON.stringify(keys)}）`);
  const o0 = oppsOf(Q3)[0];
  assert(raw.indexOf(o0.opportunity_title) === -1 && raw.indexOf("phenomenon") === -1,
    "机会正文等**业务数据不在前端存储**里（业务数据只存服务端）");

  const before = {
    opp: countRows(sqlite, "opportunity"),
    ev: countRows(sqlite, "evidence"),
    log: countRows(sqlite, "opportunity_status_log"),
  };
  const dom3 = loadPage("pages/opportunities.html", { fetcher: makeFetcher(db, []) });
  await waitFor(() => qa(dom3, "[data-opp]").length > 0);
  const after = {
    opp: countRows(sqlite, "opportunity"),
    ev: countRows(sqlite, "evidence"),
    log: countRows(sqlite, "opportunity_status_log"),
  };
  assert(JSON.stringify(before) === JSON.stringify(after),
    `仅打开页面不改库（机会 ${after.opp} / 证据 ${after.ev} / 状态链 ${after.log} 均不变：读操作零写）`);
}

/* ============================================================ ⑩ 准入条件：门禁态与空态 */
console.log("⑩ 准入条件：未跑过机会发现 → 门禁态；跑过但无产出 → 空态（「没有产出」≠「没有机会」）");
{
  const created = await api(db, "POST", "/api/goals", {
    created_by: OPERATOR,
    business_goal: "提升京东超市新客 30 天复购率（门禁用例）",
    metric_definition: "", business_scope: "", focus_period: "", known_constraints: "", provider: "",
  });
  assert(created.status === 201 && created.payload && created.payload.goal,
    `夹具目标登记成功（实测 HTTP ${created.status}）`);
  const gid = created.payload.goal.goal_id;

  const gateDom = loadPage("pages/opportunities.html", { query: "?goal=" + gid, fetcher: makeFetcher(db, []) });
  await waitFor(() => text(gateDom, "#gate-box").length > 0 || qa(gateDom, "[data-opp]").length > 0);
  assert(/未执行过机会发现/.test(text(gateDom, "#gate-box")), "未跑过机会发现的目标：给出门禁态（本页不进）");
  assert(/机会列表呈现的是机会发现的产出/.test(text(gateDom, "#gate-box")),
    "门禁文案讲清「这一步还不成立」，且与空态刻意分开");
  assert(/也不等于「没有机会」/.test(text(gateDom, "#gate-box")), "门禁文案点明「没有产出 ≠ 没有机会」");
  assert(q(gateDom, "#split") && q(gateDom, "#split").style.display === "none", "门禁态下筛选与列表整块收起");
  assert(qa(gateDom, "[data-opp]").length === 0, "门禁态不渲染任何机会行");
  assert(q(gateDom, `#link-goal`) && q(gateDom, "#link-goal").getAttribute("href").includes(gid),
    "「查看目标口径」带上当前目标（可指回目标配置执行机会发现）");

  // 执行一次机会发现（真实 F-02 路由）→ 放行，但本轮尚无产出 → 空态
  const disc = await api(db, "POST", "/api/discovery-tasks", { goal_id: gid, created_by: OPERATOR });
  assert(disc.status === 201, `夹具发现任务创建成功（实测 HTTP ${disc.status}）`);
  const emptyDom = loadPage("pages/opportunities.html", { query: "?goal=" + gid, fetcher: makeFetcher(db, []) });
  await waitFor(() => text(emptyDom, "#chain").length > 0);
  assert(q(emptyDom, "#gate-box").textContent === "", "跑过机会发现后放行（门禁态消失）");
  assert(/② 机会发现 <b>运行中<\/b>/.test(q(emptyDom, "#chain").innerHTML) || /运行中/.test(text(emptyDom, "#chain")),
    "运行链 ② 显示「运行中」（本次正在跑）");
  assert(/③ 机会产出 0 条/.test(text(emptyDom, "#chain")), "运行链 ③ 产出 0 条");
  assert(/本轮发现未产出机会记录/.test(text(emptyDom, "#list")), "空态文案＝「本轮发现未产出机会记录」");
  assert(/没有足够依据也是合法产出/.test(text(emptyDom, "#list")),
    "空态点明 M3-F-16 口径：没有足够依据也是合法产出（不外推为「没有机会」）");
  assert(qa(emptyDom, "[data-opp]").length === 0, "空态不渲染任何机会行");
}

/* ============================================================ ⑪ 前后端分离判断（TC-I-M6-007） */
console.log("⑪ 前后端分离：删掉 frontend/ 后 server/api 与 db 仍独立可用");
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
    ["GET", "/api/opportunities?goal_id=" + Q3],
    ["GET", "/api/opportunities/" + oppsOf(Q3)[0].opportunity_id],
    ["GET", "/api/evidence-trace/" + evLinks(oppsOf(Q3)[0].opportunity_id)[0].evidence_id],
    ["GET", "/api/source-tool-briefing"],
  ];
  const raw = [];
  for (const [method, p] of probes) {
    const res = await worker.fetch(new Request("http://localhost" + p, { method }), { DB: db });
    raw.push({ p, status: res.status });
  }
  assert(raw.every((r) => r.status === 200),
    `直接调用接口（不经前端）全部 200（实测 ${raw.map((r) => r.p.split("?")[0] + "→" + r.status).join("、")}）`);
  assert(!frontendFiles().some((f) => /\.json$/.test(f)), "前端不携带任何数据快照文件（无 mock 数据副本）");
}

finish();
