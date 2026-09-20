#!/usr/bin/env node
/**
 * 文档卡（阶段5 · M6 · F-29 用例执行器 · 2026-09-20）
 * 上游：`../../docs/05-test-cases/test-M6.md`（**TC-I-M6-003 = F-29 验收 oracle**：PM 选机会 → 填研究问题
 *        （必需）→ 可选补候选行为假设 / 人群限制；**提交后触发 F-04**；**重复提交幂等**。
 *        **TC-C-M6-001** = 契约：前端消费 `server/api` 返回的 JSON，**前端不直连数据库、不持有任何外部系统
 *        凭证**，动态数据一律经 API；硬红线：前端不发起任何生产写接口调用。**TC-D-M6-001** = 前端不写库。
 *        **TC-I-M6-007** = 前后端分离判断标准：删掉 `frontend/` 整个目录，`server/api` 与 `db` 仍能独立存在
 *        并被任意客户端调用）
 *   ｜ `../../docs/02-prd/PRD-M6-运营端工作台.md` F-29（功能描述与验收要点；**问题不明确时只补问题、
 *        不重填材料**）｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-03 / F-04
 *   ｜ `../../docs/01-brd/BRD.md` §4 M6 F-29、M1 F-03、§5.3 硬红线
 *   ｜ `../../docs/03-locks/tech-stack.md`（§1.2 前后端分离落点与判断标准；§2.1 前端形态＝零构建静态资源，
 *        数据来源＝server/api，**原型的 mock 数据不复制进前端**）
 *   ｜ `../../docs/03-locks/schema.md`（MD-12 research_proposal：`research_question` 必需、
 *        两可选列 varchar(300)、`idempotency_key` UK、`submitted_at`＝二阶段启动时点、
 *        `triggered_task_id` FK→PD-01；PD-01 task / PD-06 context_injection / PD-05 opportunity_status_log /
 *        LNK-04 task_object）
 *   ｜ `../../prototype/pages/propose.html`（**钉死需求的实证**：四个表单行 / 提交规则 / 提示文案以其为准）
 *   ｜ `./pages/propose.html`（被测页面）｜ `./assets/api.js`（唯一数据出口）｜ `./assets/app.js`（共享口径）
 *   ｜ `../server/api/index.js`（**真实后端**：本执行器把页面的 fetch 接到 worker.fetch，不 mock 业务语义）
 *   ｜ `../server/task-runner/proposal.js`（`checkResearchQuestion` / `submitProposal` / `markProposalTriggered`
 *        的唯一真源）｜ `../server/task-runner/hva.js`（F-04 `createHvaResearchTask`：二阶段启动时点＝
 *        建议提交时刻、PD-06 上下文、CFG-03 权限、幂等守卫）
 * 职责：用 jsdom 加载**真实页面**（内联 `<script src>`，走真实 `DOMContentLoaded` → `pageInit` 链路），
 *       把 `window.fetch` 接到**真实 Worker + 真实 D1（node:sqlite 适配层，载真实 DDL/种子）**，
 *       实跑 F-29 用例并断言。
 * 硬红线：仅本机内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构、语义与「前后端分离」）。
 * 边界：本执行器只验 F-29；F-27 / F-28 与 F-30~F-32 各自的执行器覆盖。静态扫描一律**先 strip 注释**
 *       （本文件自身的文档卡里就出现 `frontend`、`fetch` 等被扫词，不 strip 会自伤）。
 * 反向清单：登记 `./README.md`；被 `.github/workflows/ci.yml` 的 `validate` 步骤复用
 *       （`node frontend/test-f29.mjs`）。
 *
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node frontend/test-f29.mjs
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
  console.error("  npm i --no-save jsdom && node frontend/test-f29.mjs");
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

/** fetch 端口：接到**真实 Worker**（真实路由 + 真实库）；记录每个请求，供契约与幂等断言。 */
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

const Q3 = "GOAL-2026Q3-01";
const OPERATOR = "产品经理 · PM";
/* 逐字取自原型 `prototype/pages/propose.html` 的两句提示（服务端 `checkResearchQuestion` 照录） */
const HINT_NO_REFILL = "只需在问题中补清这些内容，无需重填机会材料。";
const HINT_OK = "问题指向了明确的人群与行为，可作为第二阶段的研究起点。";

/* ============================================================ ① 契约与上游 oracle 逐条对齐 */
console.log("① 契约与上游 oracle 逐条对齐（TC-I-M6-003 / TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）");
{
  const tc = readFileSync(path.join(ROOT, "docs/05-test-cases/test-M6.md"), "utf8");
  const prd = readFileSync(path.join(ROOT, "docs/02-prd/PRD-M6-运营端工作台.md"), "utf8");
  const brd = readFileSync(path.join(ROOT, "docs/01-brd/BRD.md"), "utf8");
  const line = (id) => (tc.split("\n").find((l) => l.includes(id)) || "");

  const orc = line("TC-I-M6-003");
  assert(orc.includes("研究建议提交页"), "oracle TC-I-M6-003 行在案（研究建议提交页）");
  assert(/选机会/.test(orc) && /研究问题/.test(orc) && /必需/.test(orc), "oracle 含「PM 选机会 → 填研究问题（必需）」");
  assert(/候选行为假设/.test(orc) && /人群限制/.test(orc), "oracle 含「可选补候选行为假设 / 人群限制」");
  assert(/触发 F-04/.test(orc), "oracle 含「提交后触发 F-04」");
  assert(/幂等/.test(orc), "oracle 含「重复提交幂等」");
  assert(orc.includes("TC-I-M1-002") && orc.includes("BRD"), "oracle 回指 M1 TC-I-M1-002（幂等）与 BRD F-03");

  const c1 = line("TC-C-M6-001");
  assert(c1.includes("前端消费") && c1.includes("server/api"), "oracle TC-C-M6-001：前端消费 server/api 返回的 JSON");
  assert(/不直连数据库/.test(c1) && /凭证/.test(c1), "oracle TC-C-M6-001：前端不直连数据库、不持有外部系统凭证");
  assert(/生产写接口调用/.test(c1), "oracle TC-C-M6-001 硬红线：前端不发起任何生产写接口调用");

  const d1 = line("TC-D-M6-001");
  assert(d1.includes("前端不写库"), "oracle TC-D-M6-001：前端不写库（写请求经 server/api 转发）");

  const sep = line("TC-I-M6-007");
  assert(sep.includes("删掉") && sep.includes("frontend/"), "oracle TC-I-M6-007：删掉 frontend/ 后 server/api 与 db 仍独立可用");

  assert(/研究建议提交页/.test(prd) && /触发 F-04/.test(prd), "PRD-M6 F-29 在案（功能描述 + 验收要点）");
  assert(/只补问题不重填材料/.test(prd), "PRD-M6 F-29 在案：问题不明确时**只补问题、不重填材料**");
  assert(/MD-12/.test(prd), "PRD-M6 F-29 关联 schema＝MD-12 research_proposal");
  assert(/人工节点/.test(brd) && /F-03/.test(brd), "BRD 人工节点口径在案（M1 F-03）");
}

/* ============================================================ ② 研究问题检查口径：前端不复制第二份 */
console.log("② 研究问题的检查规则只此一份（在服务端），前端不复制关键词表 / 长度阈值");
{
  const propSrc = readFileSync(path.join(ROOT, "server/task-runner/proposal.js"), "utf8");
  assert(/export const QUESTION_CHECK_PATTERNS/.test(propSrc) && /crowd:/.test(propSrc) && /behavior:/.test(propSrc),
    "服务端持检查规则（QUESTION_CHECK_PATTERNS：人群 / 行为两组）");
  assert(/export const QUESTION_MIN_LENGTH/.test(propSrc), "服务端持最短长度阈值（QUESTION_MIN_LENGTH）");
  assert(propSrc.includes(HINT_NO_REFILL) && propSrc.includes(HINT_OK), "服务端持两句提示语原文（逐字照录原型）");
  assert(/export function checkResearchQuestion/.test(propSrc), "服务端导出 checkResearchQuestion（唯一判据入口）");

  const apiSrc = stripAllComments(readFileSync(path.join(ROOT, "frontend/assets/api.js"), "utf8"), "js");
  assert(/\/api\/research-proposal-checks/.test(apiSrc), "api.js 封装了研究问题即时检查端点（/api/research-proposal-checks）");
  assert(/\/api\/research-proposals"/.test(apiSrc), "api.js 封装了建议提交端点（/api/research-proposals）");
  assert(/\/api\/hva-research-tasks/.test(apiSrc), "api.js 封装了触发 F-04 的端点（/api/hva-research-tasks）");

  const page = stripAllComments(readFileSync(path.join(ROOT, "frontend/pages/propose.html"), "utf8"), "html");
  assert(/checkResearchProposal/.test(page), "页面即时检查经 window.API.checkResearchProposal（不自己算）");
  // 判据＝**正则字面**（含 `|` 的备选式），不是单个词——页面 placeholder 里有「人群」「搜索」等词（原型钉死），
  // 但它们不构成第二份匹配规则；只有把备选式抄进前端才算复制口径。
  assert(!page.includes("人群|用户|新客|客群"), "页面**不持**第二份「人群」关键词备选式（规则在服务端）");
  assert(!page.includes("行为|找品|搜索|加购|访问|复购|购买|下单"), "页面**不持**第二份「行为」关键词备选式（规则在服务端）");
  assert(!/QUESTION_MIN_LENGTH|[^\w]length\s*<\s*15/.test(page), "页面**不持**第二份最短长度阈值");
  assert(page.includes(HINT_NO_REFILL) === false, "两句提示语也不在前端硬编码（一律取服务端返回值）");
}

/* ============================================================ ③ 静态红线（前端纪律） */
console.log("③ 静态红线：只经 server/api、不持凭证、不写库、不改机会、不复制 mock 数据");
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

  const appSrc = code["frontend/assets/app.js"];
  assert(!/\bfetch\s*\(/.test(appSrc), "app.js 自身不发请求（一律经 api.js）");
  assert(/window\.API\./.test(appSrc), "app.js 取数经 window.API（唯一出口）");

  const page = code["frontend/pages/propose.html"];
  assert(/assets\/api\.js/.test(page) && /assets\/app\.js/.test(page), "建议页只加载 api.js 与 app.js 两个脚本");
  assert(!/<script src="[^"]*data\.js/.test(page), "建议页不加载原型 data.js");
  assert(/<link rel="stylesheet" href="\.\.\/assets\/base\.css">/.test(page), "建议页只引本目录 base.css（无外部样式）");
  // 「机会来自 F-28，此处不可改」——做成**不可调用**：页面根本不出现机会状态写面。
  assert(!/changeOpportunityStatus/.test(page), "页面不调用机会状态写面（机会不可改，硬约束落在代码层）");
  assert(/OPP_FIELDS/.test(page), "机会字段标签取自 U.OPP_FIELDS（不内联手写第二份字段表）");
}

/* ============================================================ ④ 渲染（真实后端） */
console.log("④ 渲染（真实后端）：页头 / 机会只读卡 / 提交规则 / 既有建议（初始为空）");
const ctx = freshDb();
const { sqlite, db } = ctx;
const calls = [];
let dom;
const oppsOf = (gid) => sqlite.prepare("SELECT * FROM opportunity WHERE goal_id = ? ORDER BY opportunity_id").all(gid);
const OPP_ID = "OPP-009"; // 种子里的候选机会（candidate），用于提建议
{
  const target = sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(OPP_ID);
  assert(target.opportunity_status === "candidate", `选定机会 ${OPP_ID} 为候选态（实测 ${target.opportunity_status}）`);
  assert(countRows(sqlite, "research_proposal") === 0, "种子基线：MD-12 无任何建议行（实测 0）");

  dom = loadPage("pages/propose.html", {
    query: "?opp=" + OPP_ID + "&goal=" + Q3,
    fetcher: makeFetcher(db, calls),
  });
  const ready = await waitFor(() => !!q(dom, '[data-field="opportunity_id"]'));
  assert(ready, "页面完成启动（外壳注入 + 取数 + pageInit）");
  assert((dom.__errors || []).length === 0,
    `页面零运行时错误（实测 ${(dom.__errors || []).length}${(dom.__errors || [])[0] ? "：" + dom.__errors[0] : ""}）`);
  assert(text(dom, "#boot-notice") === "", "无「数据加载失败」提示（取数成功）");

  const goalRow = sqlite.prepare(
    "SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = (SELECT current_version_no FROM research_goal WHERE goal_id = ?)"
  ).get(Q3, Q3);
  const meta = text(dom, "#opp-meta");
  assert(meta.includes(goalRow.business_goal), "页头业务目标取自服务端当前版本（逐字）");
  assert(meta.includes(Q3), `页头显示目标编号（实测含 ${Q3}）`);

  const box = text(dom, "#opp-box");
  assert(box.includes(target.opportunity_title), "已选机会标题逐字取自服务端");
  for (const [k, v] of [
    ["opportunity_id", target.opportunity_id],
    ["target_object", target.target_object],
    ["phenomenon", target.phenomenon],
  ]) {
    const cell = q(dom, `[data-field="${k}"] .field-value`);
    assert(!!cell && cell.textContent.indexOf(v) !== -1,
      `机会「${k}」逐字取自服务端（实测 ${cell ? JSON.stringify(cell.textContent.slice(0, 26)) : "缺失"}）`);
  }
  assert(!!q(dom, '[data-field="unknown_item"]'), "机会只读卡呈现「未知项」（二态，与 F-28 同一份 U.UNKNOWN_TEXT）");

  // 「此处不可改」的运行期证据：卡内没有任何可编辑控件
  const boxEl = q(dom, "#opp-box");
  assert(qa(boxEl, "input").length === 0 && qa(boxEl, "textarea").length === 0 && qa(boxEl, "select").length === 0,
    "机会只读卡内无可编辑控件（机会来自 F-28，此处不可改）");

  const rules = text(dom, "#layout");
  for (const r of ["研究问题", "候选行为假设与人群限制可选", "建议与机会版本关联", "幂等", "第二阶段启动时点＝建议提交时刻", "已允许的查询工具按任务规则执行"]) {
    assert(rules.includes(r), `提交规则在案：${r}`);
  }

  assert(text(dom, "#existing").includes("暂无已提交的研究建议"), "该机会初始无建议行 → 空态文案");
  assert(qa(dom, ".readonly-box").length === 1, "已选机会以 readonly-box 呈现（原型同款）");
}

/* ============================================================ ⑤ 选机会的口径 */
console.log("⑤ 选机会：?opp= 优先；未带参数时取该目标第一条候选（便利默认，不替 PM 定问题）");
{
  // 未带 ?opp= → 第一条候选
  const auto = loadPage("pages/propose.html", { query: "?goal=" + Q3, fetcher: makeFetcher(db, []) });
  await waitFor(() => !!q(auto, '[data-field="opportunity_id"]'));
  const cands = oppsOf(Q3).filter((r) => r.opportunity_status === "candidate");
  assert(cands.length >= 1, `种子含候选机会（实测 ${cands.length} 条）`);
  assert(q(auto, '[data-field="opportunity_id"] .field-value').textContent.indexOf(cands[0].opportunity_id) !== -1,
    `未带 ?opp= 时默认选中第一条候选（实测 ${cands[0].opportunity_id}）`);

  // 带 ?opp= 指向**非候选**（已提交研究态）→ 尊重用户明确指定，仍选中它
  const submittedOpp = oppsOf(Q3).filter((r) => r.opportunity_status === "submitted")[0];
  const picked = loadPage("pages/propose.html", {
    query: "?opp=" + submittedOpp.opportunity_id + "&goal=" + Q3, fetcher: makeFetcher(db, []),
  });
  await waitFor(() => !!q(picked, '[data-field="opportunity_id"]'));
  assert(q(picked, '[data-field="opportunity_id"] .field-value').textContent.indexOf(submittedOpp.opportunity_id) !== -1,
    `带 ?opp= 时尊重明确指定（实测 ${submittedOpp.opportunity_id}）`);
  // 「是否已提交过建议」以**事实行**为准：该机会状态为 submitted，但种子无建议行 → 不得谎报「已提交过」
  assert(countRows(sqlite, "research_proposal") === 0, "该机会状态为 submitted 但**没有**建议行（事实行真源）");
  assert(!/该机会已提交过研究建议/.test(text(picked, "#opp-box")),
    "状态列不作判据：无建议行时不谎报「已提交过研究建议」（以事实行为准）");
  assert(/暂无登记在案的研究建议行/.test(text(picked, "#opp-box")),
    "而是如实说明「状态为已提交研究、但暂无登记在案的建议行」（M1-F-17 同口径）");
}

/* ============================================================ ⑥ 边填边看：研究问题即时检查（不阻断） */
console.log("⑥ 边填边看：即时检查给「需补充的要点」，**不阻断提交**（原型钉死需求）");
{
  const before = calls.length;
  /* 「复购」含行为词、不含人群词 → 应点名缺人群 + 过短（**不误报**缺行为） */
  setVal(dom, "q", "复购");
  const warned = await waitFor(() => /需补充的要点/.test(text(dom, "#q-check")));
  assert(warned, "过短 / 未指明人群的问题 → 给出「需补充的要点」");
  const warnTxt = text(dom, "#q-check");
  assert(warnTxt.includes("未指明针对哪个人群"), "缺人群即点名「未指明针对哪个人群」（逐字取自服务端）");
  assert(warnTxt.includes("问题描述过短"), "过短即点名「问题描述过短，难以确定查证方向」");
  assert(!warnTxt.includes("未指明要检验的行为或结果"), "问题已含行为词（「复购」）→ 不误报缺行为");
  assert(warnTxt.includes(HINT_NO_REFILL), "并说明**只需补问题、不重填机会材料**（PRD-M6 F-29）");
  assert(calls.slice(before).some((c) => c.path === "/api/research-proposal-checks"),
    "即时检查经 server/api（前端不自己算关键词）");

  /* 「客群」含人群词、不含行为词 → 应点名缺行为 */
  setVal(dom, "q", "客群");
  await waitFor(() => /未指明要检验的行为或结果/.test(text(dom, "#q-check")));
  const warnTxt2 = text(dom, "#q-check");
  assert(warnTxt2.includes("未指明要检验的行为或结果"), "换含人群词的问题 → 点名「未指明要检验的行为或结果」");
  assert(!warnTxt2.includes("未指明针对哪个人群"), "含人群词 → 不误报缺人群");

  setVal(dom, "q", "搜索进入的新客复购更低，是否因为缺少首单后二次找品这一行为？");
  const ok = await waitFor(() => /可作为第二阶段的研究起点/.test(text(dom, "#q-check")));
  assert(ok, "问题指向明确人群与行为 → 提示「可作为第二阶段的研究起点」（逐字取自服务端）");
  assert(!/需补充的要点/.test(text(dom, "#q-check")), "完整问题的提示里不再出现「需补充的要点」");

  setVal(dom, "q", "");
  assert(text(dom, "#q-check") === "", "清空问题后即时提示随之清空（不残留旧结论）");
  // 提示**不阻断**：有「需补充的要点」时仍可提交 → 见 ⑦/⑧ 组（⑦ 用空问题、⑧ 用完整问题）
  setVal(dom, "q", "复购");
  await waitFor(() => /需补充的要点/.test(text(dom, "#q-check")));
  assert(!!q(dom, "#submit") && !q(dom, "#submit").disabled, "有「需补充的要点」时提交按钮**未被禁用**（不阻断）");
}

/* ============================================================ ⑦ 必填拒绝：研究问题为空 */
console.log("⑦ 必填：研究问题为空即拒（发起写请求之前就挡住；库不受影响）");
{
  setVal(dom, "q", "");
  const writeBefore = calls.filter((c) => c.method === "POST").length;
  click(dom, "submit");
  await waitFor(() => /必填项/.test(text(dom, "#result-box")));
  assert(/研究问题为必填项/.test(text(dom, "#result-box")), "空问题提交 → 明确拒绝（「研究问题为必填项，请先填写后再提交」）");
  assert(calls.filter((c) => c.method === "POST").length === writeBefore, "拒绝发生在**发请求之前**（零写请求）");
  assert(countRows(sqlite, "research_proposal") === 0, "库内仍无建议行（拒绝不落库）");
  assert(countRows(sqlite, "task") === 7, "任务行数不变（未启动任何任务）");
}

/* ============================================================ ⑧ 提交成功：落 MD-12 + 触发 F-04 */
console.log("⑧ 提交成功：落 MD-12（版本绑定 / 可选列 / 幂等键）→ **触发 F-04** 建 HVA 研究任务");
const QUESTION = "搜索进入的新客复购更低，是否因为缺少首单后二次找品这一行为？";
const HYPO = "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）";
const LIMIT = "仅限 APP 端；剔除大促时段";
let propId = "";
{
  const oppRow = sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(OPP_ID);
  const tasksBefore = countRows(sqlite, "task");
  const logsBefore = sqlite.prepare("SELECT COUNT(*) c FROM opportunity_status_log WHERE opportunity_id = ?").get(OPP_ID).c;
  const hvaPostsBefore = calls.filter((c) => c.method === "POST" && c.path === "/api/hva-research-tasks").length;

  setVal(dom, "q", QUESTION);
  setVal(dom, "hypo", HYPO);
  setVal(dom, "limit", LIMIT);
  await waitFor(() => /可作为第二阶段的研究起点/.test(text(dom, "#q-check")));
  click(dom, "submit");

  const created = await waitFor(() => countRows(sqlite, "research_proposal") > 0);
  assert(created, "提交经 server/api 落库（MD-12 出现建议行）");

  const prop = sqlite.prepare("SELECT * FROM research_proposal").get();
  propId = prop.proposal_id;
  assert(/^PROP-\d{3}$/.test(propId), `建议号形如 PROP-nnn（实测 ${propId}）`);
  assert(prop.opportunity_id === OPP_ID, "建议绑定到所选机会（MD-12 外键）");
  assert(Number(prop.goal_version_no) === Number(oppRow.goal_version_no),
    `版本从机会**现读**（实测 v${prop.goal_version_no}＝机会 v${oppRow.goal_version_no}，不受入参改写）`);
  assert(prop.research_question === QUESTION, "研究问题原样落库（逐字）");
  assert(prop.behavior_hypothesis === HYPO && prop.population_limit === LIMIT, "两个可选列原样落库");
  assert(prop.submitted_by === OPERATOR, "提交人取自页面固定操作人标识（非凭证）");
  assert(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(String(prop.submitted_at)), `提交时点非空且形如时间戳（实测 ${prop.submitted_at}）`);
  assert(/^prop-[0-9a-f]{64}$/.test(String(prop.idempotency_key)), "幂等键＝prop- + SHA-256（服务端算法，页面不自行拼）");

  // —— 触发 F-04 ——
  const tasksAfter = countRows(sqlite, "task");
  assert(tasksAfter === tasksBefore + 1, `触发 F-04 建任务（task 行数 ${tasksBefore} → ${tasksAfter}）`);
  const task = sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(prop.triggered_task_id);
  assert(!!task, `建议行回填触发任务（triggered_task_id＝${prop.triggered_task_id}）`);
  assert(task.task_type === "hva_research", `新任务类型为 hva_research（实测 ${task.task_type}）`);
  assert(task.goal_id === oppRow.goal_id, "任务归属目标＝机会的目标");
  assert(task.started_at === prop.submitted_at,
    `**第二阶段启动时点＝建议提交时刻**（任务 started_at ${task.started_at} ＝ 建议 submitted_at）`);
  assert(task.agent_version_snapshot, "任务携带 Agent 版本快照（启动依据可回查）");

  const links = sqlite.prepare("SELECT * FROM task_object WHERE task_id = ? ORDER BY link_id").all(task.task_id);
  assert(links.some((l) => l.object_type === "proposal" && l.object_id === propId && l.link_role === "trigger"),
    "LNK-04：任务 ↔ 建议（trigger）已关联");
  assert(links.some((l) => l.object_type === "opportunity" && l.object_id === OPP_ID),
    "LNK-04：任务 ↔ 机会（作用对象）已关联");
  assert(sqlite.prepare("SELECT COUNT(*) c FROM task_step WHERE task_id = ?").get(task.task_id).c > 0,
    "任务已生成步骤计划（PD-02）");
  const ctxRows = sqlite.prepare("SELECT * FROM context_injection WHERE task_id = ?").all(task.task_id);
  assert(ctxRows.length > 0, `二阶段上下文已落 PD-06（实测 ${ctxRows.length} 行）`);

  // —— 机会状态迁移 + PD-05 留痕 ——
  const oppAfter = sqlite.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").get(OPP_ID);
  assert(oppAfter.opportunity_status === "submitted", `机会迁移为「已提交研究」（实测 ${oppAfter.opportunity_status}）`);
  const logsAfter = sqlite.prepare("SELECT COUNT(*) c FROM opportunity_status_log WHERE opportunity_id = ?").get(OPP_ID).c;
  assert(logsAfter === logsBefore + 1, `状态变更逐次留痕（PD-05 行数 ${logsBefore} → ${logsAfter}）`);
  const lastLog = sqlite.prepare("SELECT * FROM opportunity_status_log WHERE opportunity_id = ? ORDER BY changed_at").all(OPP_ID).slice(-1)[0];
  assert(lastLog.to_status === "submitted" && lastLog.from_status === "candidate", "状态链记录 from→to（candidate → submitted）");

  // —— 页面提示与联动 ——
  await waitFor(() => /已触发 M1-F-04|幂等/.test(text(dom, "#action-note")));
  assert(/已提交研究建议/.test(text(dom, "#action-note")) && text(dom, "#action-note").includes(propId),
    "提交后给出结果提示（含建议号）");
  assert(text(dom, "#result-box").includes(task.task_id), `结果卡点出新建任务号（实测含 ${task.task_id}）`);
  assert(/已提交，触发 M1-F-04/.test(text(dom, "#result-box")), "结果卡标题＝「已提交，触发 M1-F-04」");
  assert(text(dom, "#existing").includes(QUESTION), "既有建议列表随之出现该建议（逐字）");
  assert(text(dom, "#existing").includes(propId), "既有建议列表标出建议号");
  assert(/已提交过研究建议/.test(text(dom, "#opp-box")), "机会卡随之提示「已提交过研究建议」（事实行驱动）");
  assert(calls.filter((c) => c.method === "POST" && c.path === "/api/hva-research-tasks").length === hvaPostsBefore + 1,
    "本次提交恰触发一次 F-04");
  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const navUnread = (JSON.parse(raw).navUnread || {})[Q3] || {};
  assert(navUnread.tasks >= 1, "新任务产生后标记「任务与状态」有更新待查看（会话态，不入库）");
}

/* ============================================================ ⑨ 幂等：同一份建议不重复启动任务 */
console.log("⑨ 幂等：同一份建议重复提交 → 不新建建议行、**不重复启动相同任务**；换问题则视为新研究");
{
  const propBefore = countRows(sqlite, "research_proposal");
  const taskBefore = countRows(sqlite, "task");
  const hvaBefore = calls.filter((c) => c.method === "POST" && c.path === "/api/hva-research-tasks").length;
  const propPostsBefore = calls.filter((c) => c.method === "POST" && c.path === "/api/research-proposals").length;

  click(dom, "submit"); // 同一份内容（问题 / 假设 / 限制均未改）
  const settled = await waitFor(() => /不会重复启动相同任务/.test(text(dom, "#result-box")));
  assert(settled, "重复提交命中幂等 → 提示「已提交过、不会重复启动相同任务」");
  assert(/幂等/.test(text(dom, "#result-box")), "提示中显式出现「幂等」字样");
  assert(text(dom, "#result-box").includes(propId), "幂等提示指向**既有的**建议号（同一份建议）");
  assert(countRows(sqlite, "research_proposal") === propBefore,
    `不新建建议行（MD-12 行数 ${propBefore} → ${countRows(sqlite, "research_proposal")}）`);
  assert(countRows(sqlite, "task") === taskBefore,
    `**不重复启动相同任务**（task 行数 ${taskBefore} → ${countRows(sqlite, "task")}）`);
  assert(calls.filter((c) => c.method === "POST" && c.path === "/api/hva-research-tasks").length === hvaBefore,
    "幂等命中时**不再调用 F-04 建任务面**（页面据此收口，不靠后端兜错）");
  assert(calls.filter((c) => c.method === "POST" && c.path === "/api/research-proposals").length === propPostsBefore + 1,
    "重复提交仍是一次正常的建议提交（服务端以幂等键判定为同一份）");

  // 区分度：换研究问题 → 不同幂等键 → 视为**新的研究**（幂等不是「不让提交」）
  setVal(dom, "q", "首页推荐位进入的新客复购更低，是否因为入口带来的人群需求强度不同？");
  setVal(dom, "hypo", "");
  setVal(dom, "limit", "");
  await waitFor(() => /可作为第二阶段的研究起点/.test(text(dom, "#q-check")));
  click(dom, "submit");
  const second = await waitFor(() => countRows(sqlite, "research_proposal") === propBefore + 1);
  assert(second, `换研究问题后视为新研究（MD-12 行数 ${propBefore} → ${countRows(sqlite, "research_proposal")}）`);
  const props = sqlite.prepare("SELECT * FROM research_proposal ORDER BY proposal_id").all();
  assert(props[1].behavior_hypothesis === null && props[1].population_limit === null,
    "可选列留空存 NULL 而非空串（schema MD-12 口径）");
  assert(props[1].idempotency_key !== props[0].idempotency_key, "不同研究问题 → 不同幂等键（区分度）");
  assert(countRows(sqlite, "task") === taskBefore + 1, "新的研究各自触发一次 F-04（任务 +1）");
}

/* ============================================================ ⑩ 前端不写库 / 业务数据不落前端存储 */
console.log("⑩ 前端不写库、业务数据不落前端持久存储（TC-C-M6-001 / TC-D-M6-001）");
{
  assert(calls.every((c) => c.path.startsWith("/api/")), `全部 ${calls.length} 次请求均经 /api/（无直连外部）`);
  assert(calls.every((c) => new URL(c.url).origin === "http://localhost"), "所有请求**同源**（origin 与页面一致）");

  const writes = calls.filter((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method));
  assert(writes.length >= 4, `写动作全部经 server/api 转发（实测 ${writes.length} 次）`);
  const allowed = ["/api/research-proposals", "/api/hva-research-tasks", "/api/research-proposal-checks"];
  assert(writes.every((w) => allowed.indexOf(w.path) !== -1),
    `写只落在本点三个既有路由（实测 ${[...new Set(writes.map((w) => w.path))].join("、")}）`);
  assert(!writes.some((w) => /\/api\/(query|query-records|query-recovery|tool-permission|agent-delegations)/.test(w.path)),
    "未调用任何「生产查询 / 外部调用」类接口（硬红线：前端不发起任何生产写接口调用）");
  assert(!writes.some((w) => w.path === "/api/opportunity-status"),
    "未调用机会状态写面（机会来自 F-28，此处不可改）");

  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const keys = Object.keys(JSON.parse(raw));
  assert(keys.every((k) => ["applied", "navUnread"].indexOf(k) !== -1),
    `前端持久存储只含会话态键（实测 ${JSON.stringify(keys)}）`);
  assert(raw.indexOf(QUESTION) === -1 && raw.indexOf(HYPO) === -1,
    "研究问题 / 假设等**业务数据不在前端存储**里（业务数据只存服务端）");

  const before = {
    prop: countRows(sqlite, "research_proposal"),
    task: countRows(sqlite, "task"),
    step: countRows(sqlite, "task_step"),
    ctx: countRows(sqlite, "context_injection"),
  };
  const fresh = loadPage("pages/propose.html", { query: "?opp=" + OPP_ID + "&goal=" + Q3, fetcher: makeFetcher(db, []) });
  await waitFor(() => !!q(fresh, '[data-field="opportunity_id"]'));
  const after = {
    prop: countRows(sqlite, "research_proposal"),
    task: countRows(sqlite, "task"),
    step: countRows(sqlite, "task_step"),
    ctx: countRows(sqlite, "context_injection"),
  };
  assert(JSON.stringify(before) === JSON.stringify(after),
    `仅打开页面不改库（建议 ${after.prop} / 任务 ${after.task} / 步骤 ${after.step} / 上下文 ${after.ctx} 均不变：读操作零写）`);
}

/* ============================================================ ⑪ 门禁与空态 */
console.log("⑪ 准入条件：未跑过机会发现 → 门禁态；跑过但无机会 → 空态");
{
  const created = await api(db, "POST", "/api/goals", {
    created_by: OPERATOR,
    business_goal: "提升京东超市新客 30 天复购率（门禁用例）",
    metric_definition: "", business_scope: "", focus_period: "", known_constraints: "", provider: "",
  });
  assert(created.status === 201 && created.payload && created.payload.goal, `夹具目标登记成功（实测 HTTP ${created.status}）`);
  const gid = created.payload.goal.goal_id;

  const gateDom = loadPage("pages/propose.html", { query: "?goal=" + gid, fetcher: makeFetcher(db, []) });
  await waitFor(() => text(gateDom, "#gate-box").length > 0);
  assert(/未执行过机会发现/.test(text(gateDom, "#gate-box")), "未跑过机会发现的目标：给出门禁态（本页不进）");
  assert(/还没有可研究的机会/.test(text(gateDom, "#gate-box")), "门禁文案说明「还没有可研究的机会」");
  assert(/不替你选机会、也不替你定研究问题/.test(text(gateDom, "#gate-box")),
    "门禁文案守住人工节点边界（平台不替 PM 选机会 / 定问题）");
  assert(q(gateDom, "#layout") && q(gateDom, "#layout").style.display === "none", "门禁态下表单整块收起");
  assert(qa(gateDom, "#opp-box").length === 0 || text(gateDom, "#opp-box") === "", "门禁态不渲染机会只读卡");

  const disc = await api(db, "POST", "/api/discovery-tasks", { goal_id: gid, created_by: OPERATOR });
  assert(disc.status === 201, `夹具发现任务创建成功（实测 HTTP ${disc.status}）`);
  const emptyDom = loadPage("pages/propose.html", { query: "?goal=" + gid, fetcher: makeFetcher(db, []) });
  await waitFor(() => text(emptyDom, "#gate-box").length > 0);
  assert(q(emptyDom, "#gate-box").textContent === "" || !/未执行过机会发现/.test(text(emptyDom, "#gate-box")),
    "跑过机会发现后放行（门禁态消失）");
  assert(/暂无可研究的机会/.test(text(emptyDom, "#gate-box")), "无机会 → 空态文案（「暂无可研究的机会」）");
  assert(/MD-12 外键/.test(text(emptyDom, "#gate-box")), "空态点明「建议必须挂在真实机会上」");
  assert(q(emptyDom, "#layout") && q(emptyDom, "#layout").style.display === "none", "空态下表单同理收起");
}

/* ============================================================ ⑫ 前后端分离判断（TC-I-M6-007） */
console.log("⑫ 前后端分离：删掉 frontend/ 后 server/api 与 db 仍独立可用");
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
    ["GET", "/api/research-proposals?opportunity_id=" + OPP_ID],
    ["GET", "/api/opportunities/" + OPP_ID],
    ["POST", "/api/research-proposal-checks", { research_question: QUESTION }],
    ["POST", "/api/research-proposals", {
      opportunity_id: "OPP-014", research_question: "无前端时直调接口：新客复购与二次找品行为的关系是否成立？",
      submitted_by: OPERATOR,
    }],
  ];
  const raw = [];
  for (const [method, p, body] of probes) {
    const res = await api(db, method, p, body);
    raw.push({ p, status: res.status });
  }
  assert(raw.every((r) => r.status === 200 || r.status === 201),
    `直接调用接口（不经前端）全部可用（实测 ${raw.map((r) => r.p.split("?")[0] + "→" + r.status).join("、")}）`);
  assert(!frontendFiles().some((f) => /\.json$/.test(f)), "前端不携带任何数据快照文件（无 mock 数据副本）");
}

finish();
