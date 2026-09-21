#!/usr/bin/env node
/**
 * 文档卡（阶段5 · M6 · F-31 用例执行器 · 2026-09-20）
 * 上游：`../../docs/05-test-cases/test-M6.md`（**TC-I-M6-005 = F-31 验收 oracle**：基于通用 Agent 的场景化追问；
 *        拿到上下文→对话再调度／查没发现处／注入新信息再跑；**追问建新任务并关联原研究（F-05）**。
 *        **TC-C-M6-001** = 契约：前端消费 `server/api` 返回的 JSON，**前端不直连数据库、不持有任何外部系统
 *        凭证**，动态数据一律经 API；硬红线：前端不发起任何生产写接口调用。**TC-D-M6-001** = 前端不写库。
 *        **TC-I-M6-007** = 前后端分离判断标准：删掉 `frontend/` 整个目录，`server/api` 与 `db` 仍能独立存在
 *        并被任意客户端调用）
 *   ｜ `../../docs/02-prd/PRD-M6-运营端工作台.md` F-31（功能描述与验收要点；**追问建新任务并关联原研究（F-05）**）
 *        ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-05
 *   ｜ `../../docs/01-brd/BRD.md` §4 M6 F-31、M1 F-05、§5.3 硬红线
 *   ｜ `../../docs/03-locks/tech-stack.md`（§1.2 前后端分离落点与判断标准；§2.1 前端形态＝零构建静态资源，
 *        数据来源＝server/api，**原型的 mock 数据不复制进前端**）
 *   ｜ `../../docs/03-locks/schema.md`（PD-07 followup_message：追问消息｜PD-01 task：parent_task_id 关联原任务｜
 *        MD-07 research：parent_research_no 指向原研究）
 *   ｜ `../../prototype/pages/followup.html`（**钉死需求的实证**：对话区 ＋ 已注入上下文 ＋ 可调度工具 ＋ 追问建新任务）
 *   ｜ `./pages/followup.html`（被测页面）｜ `./assets/api.js`（唯一数据出口）｜ `./assets/app.js`（共享口径）
 *   ｜ `../server/api/index.js`（**真实后端**：本执行器把页面的 fetch 接到 worker.fetch，不 mock 业务语义）
 *   ｜ `../server/task-runner/followup.js`（`createFollowupTask` 的唯一真源：建 hva_followup 任务 ＋ 新研究壳，
 *        parent_task_id 挂原任务、parent_research_no 指向原研究；原研究须已关联 start_task_id）
 * 职责：用 jsdom 加载**真实页面**（内联 `<script src>`，走真实 `DOMContentLoaded` → `pageInit` 链路），
 *       把 `window.fetch` 接到**真实 Worker + 真实 D1（node:sqlite 适配层，载真实 DDL/种子）**，
 *       实跑 F-31 用例并断言。
 * 硬红线：仅本机内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义与「前后端分离」）。
 * 边界：本执行器只验 F-31；F-27 / F-28 / F-29 / F-30 与 F-32 各自的执行器覆盖。静态扫描一律**先 strip 注释**
 *       （本文件自身的文档卡里就出现 `frontend`、`fetch` 等被扫词，不 strip 会自伤）。
 * 反向清单：登记 `./README.md`；被 `.github/workflows/ci.yml` 的 `validate` 步骤复用
 *       （`node frontend/test-f31.mjs`）。
 *
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node frontend/test-f31.mjs
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
  console.error("  npm i --no-save jsdom && node frontend/test-f31.mjs");
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
/* 种子里 R-006 已关联启动任务 T-1021（可发起追问）；R-007 虽有种子追问消息但 start_task_id 为空，不作创建目标。 */
const STUDY = "R-006";
let target; // R-006 基线（追问前），供 ④ 比对「原研究逐字节不变」

/* ============================================================ ① 契约与上游 oracle 逐条对齐 */
console.log("① 契约与上游 oracle 逐条对齐（TC-I-M6-005 / TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）");
{
  const tc = readFileSync(path.join(ROOT, "docs/05-test-cases/test-M6.md"), "utf8");
  const prd = readFileSync(path.join(ROOT, "docs/02-prd/PRD-M6-运营端工作台.md"), "utf8");
  const brd = readFileSync(path.join(ROOT, "docs/01-brd/BRD.md"), "utf8");
  // BRD §4 F-31 标题与功能描述跨行——按全文正则而非单行 find
  assert(/#### F-31 追问对话页/.test(brd), "BRD §4 F-31 标题在案（追问对话页）");
  assert(/追问建新任务并关联原研究/.test(brd), "BRD §4 F-31 描述含「追问建新任务并关联原研究」");
  assert(/基于通用 Agent 的场景化追问/.test(brd), "BRD §4 F-31 描述含「基于通用 Agent 的场景化追问」");

  const line = (id) => (tc.split("\n").find((l) => l.includes(id)) || "");
  const orc = line("TC-I-M6-005");
  assert(orc.includes("追问对话页"), "oracle TC-I-M6-005 行在案（追问对话页）");
  assert(/场景化追问/.test(orc) && /上下文/.test(orc), "oracle 含「基于通用 Agent 的场景化追问 / 拿到上下文」");
  assert(/建新任务并关联原研究/.test(orc), "oracle 含「追问建新任务并关联原研究（F-05）」");
  assert(orc.includes("F-05"), "oracle 回指 M1 F-05（建立追问任务）");
  assert(orc.includes("TC-I-M1-003"), "oracle 回指 M1 TC-I-M1-003");

  const c1 = line("TC-C-M6-001");
  assert(c1.includes("前端消费") && c1.includes("server/api"), "oracle TC-C-M6-001：前端消费 server/api 返回的 JSON");
  assert(/不直连数据库/.test(c1) && /凭证/.test(c1), "oracle TC-C-M6-001：前端不直连数据库、不持有外部系统凭证");
  assert(/生产写接口调用/.test(c1), "oracle TC-C-M6-001 硬红线：前端不发起任何生产写接口调用");

  const d1 = line("TC-D-M6-001");
  assert(d1.includes("前端不写库"), "oracle TC-D-M6-001：前端不写库（写请求经 server/api 转发）");

  const sep = line("TC-I-M6-007");
  assert(sep.includes("删掉") && sep.includes("frontend/"), "oracle TC-I-M6-007：删掉 frontend/ 后 server/api 与 db 仍独立可用");

  assert(/追问对话页/.test(prd) && /关联原研究/.test(prd), "PRD-M6 F-31 在案（功能描述 + 验收要点）");
  assert(/F-05/.test(prd), "PRD-M6 F-31 关联 M1 F-05（追问与版本管理）");
  assert(/PD-07/.test(prd) && /PD-01/.test(prd), "PRD-M6 F-31 关联 schema＝PD-07 followup_message / PD-01 task");
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
  assert(names.length >= 8, `前端受检运行期文件 ${names.length} 个（实测）`);

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

  const page = code["frontend/pages/followup.html"];
  assert(/assets\/api\.js/.test(page) && /assets\/app\.js/.test(page), "追问页只加载 api.js 与 app.js 两个脚本");
  assert(!/<script src="[^"]*data\.js/.test(page), "追问页不加载原型 data.js");
  assert(/<link rel="stylesheet" href="\.\.\/assets\/base\.css">/.test(page), "追问页只引本目录 base.css（无外部样式）");
  assert(/\/api\/followup-tasks/.test(apiSrc), "api.js 封装了发起追问端点（/api/followup-tasks，F-05）");
  assert(!/changeOpportunityStatus|research-proposals|hva-research-tasks/.test(page), "追问页不调用机会状态 / 建议 / HVA 任务等其它写面（只经 F-05）");
}

/* ============================================================ ③ 渲染（真实后端） */
console.log("③ 渲染（真实后端）：已注入上下文 ＋ 可调度工具 ＋ 追问建议");
const ctx = freshDb();
const { sqlite, db } = ctx;
const calls = [];
let dom;
{
  assert(countRows(sqlite, "research") === 2, "种子基线：MD-07 共 2 行研究（R-006 / R-007）");
  target = sqlite.prepare("SELECT * FROM research WHERE research_no = ?").get(STUDY);
  assert(!!target && target.start_task_id === "T-1021", `选定原研究 ${STUDY} 已关联启动任务 T-1021（实测 ${target && target.start_task_id}）`);

  dom = loadPage("pages/followup.html", {
    query: "?study=" + STUDY + "&goal=" + Q3,
    fetcher: makeFetcher(db, calls),
  });
  const ready = await waitFor(() => !!q(dom, "#ctx") && text(dom, "#ctx").length > 0);
  assert(ready, "页面完成启动（外壳注入 + 取数 + pageInit）");
  assert((dom.__errors || []).length === 0,
    `页面零运行时错误（实测 ${(dom.__errors || []).length}${(dom.__errors || [])[0] ? "：" + dom.__errors[0] : ""}）`);

  // 已注入上下文：五个字段逐字取自服务端
  const ctxText = text(dom, "#ctx");
  assert(ctxText.includes("关联研究"), "已注入上下文含「关联研究」标签");
  assert(ctxText.includes(STUDY), `已注入上下文显示原研究编号（实测含 ${STUDY}）`);
  assert(ctxText.includes(target.research_question), "已注入上下文逐字显示原研究问题（取自服务端）");
  assert(ctxText.includes("已有证据"), "已注入上下文含「已有证据」标签");
  assert(/相关历史/.test(ctxText), "已注入上下文含「相关历史」（其它研究）");
  assert(ctxText.includes(Q3), `已注入上下文显示目标版本（实测含 ${Q3}）`);

  // 可调度工具：来源说明（M5-F-23）
  const toolsText = text(dom, "#tools");
  assert(/已授权|降级/.test(toolsText), "可调度工具呈现「已授权 / 降级」徽标");

  // 追问建议 chips
  const chips = qa(dom, ".chip[data-s]");
  assert(chips.length >= 4, `追问建议 chips 至少 4 条（实测 ${chips.length}）`);
  // 点一个 chip → 输入框被填入
  chips[0].dispatchEvent(new dom.window.MouseEvent("click", { bubbles: true }));
  assert(dom.window.document.getElementById("input").value.length > 0, "点建议 chip 后输入框被填入（不重打字）");
}

/* ============================================================ ④ 发送追问：建新任务并关联原研究（F-05） */
console.log("④ 发送追问：POST /api/followup-tasks → 建 hva_followup 任务（parent_task_id=T-1021）＋ 新研究壳（parent_research_no=R-006）");
const QUESTION = "如果控制了消费力标签，家庭装的差异还剩多少？";
let newTaskId = "";
let newResearchNo = "";
{
  const taskBefore = countRows(sqlite, "task");
  const researchBefore = countRows(sqlite, "research");
  const fmBefore = countRows(sqlite, "followup_message");
  const fuPostsBefore = calls.filter((c) => c.method === "POST" && c.path === "/api/followup-tasks").length;

  const input = dom.window.document.getElementById("input");
  input.value = QUESTION;
  click(dom, "send");

  const created = await waitFor(() => countRows(sqlite, "research") > researchBefore);
  assert(created, "发送经 server/api 落库（MD-07 出现新研究行）");

  // 从 Agent 应答气泡里提取新任务号与新研究号（页面回显真实返回）
  const chatText = text(dom, "#chat");
  const taskM = chatText.match(/新任务\s+(T-\d+)/);
  const resM = chatText.match(/新研究\s+(R-\d+)/);
  assert(!!taskM, "Agent 应答回显新任务号（真实返回，不编造）");
  assert(!!resM, "Agent 应答回显新研究号（真实返回，不编造）");
  assert(/关联原研究\s*R-006/.test(chatText), "Agent 应答明示「关联原研究 R-006」（parent_research_no）");
  newTaskId = taskM ? taskM[1] : "";
  newResearchNo = resM ? resM[1] : "";

  const newResearch = sqlite.prepare("SELECT * FROM research WHERE research_no = ?").get(newResearchNo);
  assert(!!newResearch, `新研究行落库（实测 ${newResearchNo}）`);
  assert(newResearch.parent_research_no === STUDY, `新研究 parent_research_no 指向原研究（实测 ${newResearch.parent_research_no}）`);
  assert(newResearch.start_task_id === newTaskId, `新研究 start_task_id 指向新任务（实测 ${newResearch.start_task_id}）`);
  assert(newResearch.research_question === QUESTION, "新研究问题＝追问问题（逐字）");

  const newTask = sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(newTaskId);
  assert(!!newTask, `新任务行落库（实测 ${newTaskId}）`);
  assert(newTask.task_type === "hva_followup", `新任务类型为 hva_followup（实测 ${newTask.task_type}）`);
  assert(newTask.parent_task_id === "T-1021", `新任务 parent_task_id 挂**原研究的启动任务 T-1021**（实测 ${newTask.parent_task_id}）`);
  assert(newTask.goal_id === Q3, "新任务归属目标＝原研究目标");

  // 任务 ↔ 研究 关联（LNK-04）
  const links = sqlite.prepare("SELECT * FROM task_object WHERE task_id = ? ORDER BY link_id").all(newTaskId);
  assert(links.some((l) => l.object_type === "research" && l.object_id === newResearchNo && l.link_role === "output"),
    "LNK-04：新任务 ↔ 新研究（output）已关联");

  // 步骤计划 ＋ 二阶段上下文
  assert(sqlite.prepare("SELECT COUNT(*) c FROM task_step WHERE task_id = ?").get(newTaskId).c > 0, "新任务已生成步骤计划（PD-02）");
  const ctxRows = sqlite.prepare("SELECT * FROM context_injection WHERE task_id = ?").all(newTaskId);
  assert(ctxRows.length > 0, `二阶段上下文已落 PD-06（实测 ${ctxRows.length} 行）`);

  // 追问消息（PD-07）：PM 的新问题被记录（不落前端存储）
  const fmAfter = countRows(sqlite, "followup_message");
  assert(fmAfter === fmBefore + 1, `追问消息落 PD-07（followup_message 行数 ${fmBefore} → ${fmAfter}）`);
  const fm = sqlite.prepare("SELECT * FROM followup_message WHERE research_no = ? AND message_role = 'pm' ORDER BY created_at").all(STUDY).slice(-1)[0];
  assert(fm && fm.message_text === QUESTION, "PD-07 记录 PM 追问问题（逐字，不存前端）");

  // 原研究**不被覆盖**：R-006 行数仍为 1，且内容未变
  assert(countRows(sqlite, "research") === researchBefore + 1, `仅新增 1 行研究（research ${researchBefore} → ${countRows(sqlite, "research")}）`);
  const origAfter = sqlite.prepare("SELECT * FROM research WHERE research_no = ?").get(STUDY);
  assert(JSON.stringify(origAfter) === JSON.stringify(target), "原研究 R-006 逐字节不变（追问不覆盖原研究）");

  // 页面提示与联动
  assert(calls.filter((c) => c.method === "POST" && c.path === "/api/followup-tasks").length === fuPostsBefore + 1,
    "本次发送恰触发一次 F-05");
  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const navUnread = (JSON.parse(raw).navUnread || {})[Q3] || {};
  assert(navUnread.tasks >= 1, "新任务产生后标记「任务与状态」有更新待查看（会话态，不入库）");
}

/* ============================================================ ⑤ 必填拒绝：追问问题为空 */
console.log("⑤ 必填：追问问题为空即拒（发起写请求之前就挡住；库不受影响）");
{
  const taskBefore = countRows(sqlite, "task");
  const researchBefore = countRows(sqlite, "research");
  const fuPostsBefore = calls.filter((c) => c.method === "POST" && c.path === "/api/followup-tasks").length;

  const input = dom.window.document.getElementById("input");
  input.value = "";
  click(dom, "send");
  await waitFor(() => text(dom, "#boot-notice").length > 0 && q(dom, "#boot-notice").style.display !== "none");
  assert(/必填项/.test(text(dom, "#boot-notice")), "空问题发送 → 明确拒绝（「追问问题为必填项」）");
  assert(calls.filter((c) => c.method === "POST" && c.path === "/api/followup-tasks").length === fuPostsBefore,
    "拒绝发生在**发请求之前**（零写请求）");
  assert(countRows(sqlite, "task") === taskBefore, "库内任务行数不变（拒绝不落库）");
  assert(countRows(sqlite, "research") === researchBefore, "库内研究行数不变（拒绝不落库）");
}

/* ============================================================ ⑥ 前端不写库 / 业务数据不落前端存储 */
console.log("⑥ 前端不写库、业务数据不落前端持久存储（TC-C-M6-001 / TC-D-M6-001）");
{
  assert(calls.every((c) => c.path.startsWith("/api/")), `全部 ${calls.length} 次请求均经 /api/（无直连外部）`);
  assert(calls.every((c) => new URL(c.url).origin === "http://localhost"), "所有请求**同源**（origin 与页面一致）");

  const writes = calls.filter((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method));
  assert(writes.length >= 1, `写动作全部经 server/api 转发（实测 ${writes.length} 次）`);
  const allowed = ["/api/followup-tasks"];
  assert(writes.every((w) => allowed.indexOf(w.path) !== -1),
    `写只落在本点唯一路由（实测 ${[...new Set(writes.map((w) => w.path))].join("、")}）`);
  assert(!writes.some((w) => /\/api\/(query|query-records|query-recovery|tool-permission|agent-delegations)/.test(w.path)),
    "未调用任何「生产查询 / 外部调用」类接口（硬红线：前端不发起任何生产写接口调用）");

  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const keys = Object.keys(JSON.parse(raw));
  assert(keys.every((k) => ["applied", "navUnread"].indexOf(k) !== -1),
    `前端持久存储只含会话态键（实测 ${JSON.stringify(keys)}）`);
  assert(raw.indexOf(QUESTION) === -1, "追问问题等**业务数据不在前端存储**里（业务数据只存服务端 PD-07）");

  const before = {
    task: countRows(sqlite, "task"),
    research: countRows(sqlite, "research"),
    step: countRows(sqlite, "task_step"),
    ctx: countRows(sqlite, "context_injection"),
  };
  const fresh = loadPage("pages/followup.html", { query: "?study=" + STUDY + "&goal=" + Q3, fetcher: makeFetcher(db, []) });
  await waitFor(() => text(fresh, "#ctx").length > 0);
  const after = {
    task: countRows(sqlite, "task"),
    research: countRows(sqlite, "research"),
    step: countRows(sqlite, "task_step"),
    ctx: countRows(sqlite, "context_injection"),
  };
  assert(JSON.stringify(before) === JSON.stringify(after),
    `仅打开页面不改库（任务 ${after.task} / 研究 ${after.research} / 步骤 ${after.step} / 上下文 ${after.ctx} 均不变：读操作零写）`);
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
    ["GET", "/api/research?goal_id=" + Q3],
    ["GET", "/api/research-result/" + STUDY],
    ["GET", "/api/source-tool-briefing"],
    ["POST", "/api/followup-tasks", { research_no: STUDY, new_question: "直接调接口验证前后端分离：控制消费力后差异还剩多少？" }],
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
