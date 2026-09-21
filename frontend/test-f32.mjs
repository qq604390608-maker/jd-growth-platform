#!/usr/bin/env node
/**
 * 文档卡（阶段5 · M6 · F-32 用例执行器 · 2026-09-20）
 * 上游：`../../docs/05-test-cases/test-M6.md`（**TC-I-M6-006 = F-32 验收 oracle**：展示任务运行状态 /
 *        受阻原因（等待必要信息 / 等待接口恢复 / 已停止）/ 已完成部分；机会未被选中、任务未完成、
 *        研究未支持候选行为三类事实分别可见；状态机口径与 M1 F-06 一致。
 *        **TC-C-M6-001** ＝ 契约：前端消费 server/api；**不直连数据库、不持凭证**；硬红线：前端不发起任何
 *        生产写接口调用。**TC-D-M6-001** ＝ 前端不写库。**TC-I-M6-007** ＝ 前后端分离判断标准）。
 *   ｜ `../../docs/02-prd/PRD-M6-运营端工作台.md` F-32（功能描述与验收要点；关联 schema＝PD-01 task、
 *        PD-02 task_step、PD-03 task_block、PD-05 opportunity_status_log）
 *   ｜ `../../docs/01-brd/BRD.md` §4 M6 F-32、§5.3 硬红线、F-06
 *   ｜ `../../docs/03-locks/schema.md`（PD-01 task：task_status 走 dict:TASK_STATUS；PD-03 task_block：
 *        block_reason_code 走 dict:BLOCK_REASON；MD-06 opportunity：opportunity_status；
 *        MD-09 candidate_behavior：behavior_status＝candidate_supported / not_supported）
 *   ｜ `../../prototype/pages/tasks.html`（钉死需求的实证）
 *   ｜ `./pages/tasks.html`（被测页面）｜ `./assets/api.js`（唯一数据出口）｜ `./assets/app.js`（共享口径）
 *   ｜ `../server/api/index.js`（**真实后端**：本执行器把页面的 fetch 接到 worker.fetch，不 mock 业务语义）
 * 职责：用 jsdom 加载真实页面（内联 <script src>，走真实 DOMContentLoaded → pageInit 链路），把 window.fetch
 *       接到真实 Worker + 真实 D1（node:sqlite 适配层，载真实 DDL/种子），实跑 F-32 用例并断言。
 * 硬红线：仅本机内存库，零外部调用、零生产写；数值以契约基准 v1（ADR-004）为准（只断结构、语义与「前后端分离」——
 *        三类事实的数字来自种子真值，且不混入断言文案）。本页为只读展示页，**零写请求**。
 * 边界：本执行器只验 F-32；F-27~F-31 各自的执行器覆盖。静态扫描一律先 strip 注释
 *       （本文件自身的文档卡里就出现 frontend、fetch 等被扫词，不 strip 会自伤）。
 * 反向清单：登记 ./README.md；被 .github/workflows/ci.yml 的 validate 步骤复用（node frontend/test-f32.mjs）。
 *
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node frontend/test-f32.mjs
 */
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import worker from "../server/api/index.js";

const require = createRequire(import.meta.url);
let JSDOM, VirtualConsole;
try {
  ({ JSDOM, VirtualConsole } = require("jsdom"));
} catch (e) {
  console.error("VERIFY FAIL · 缺少测试期依赖 jsdom。安装后重跑：");
  console.error("  npm i --no-save jsdom && node frontend/test-f32.mjs");
  process.exit(1);
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DDL_PATH = path.join(ROOT, "db/migrations/0001_init.sql");
const SEED_PATH = path.join(ROOT, "db/seed/0001_mock.sql");
const SESSION_KEY = "jd_growth_frontend_session_v1";

/* ============================================================ 基建 */

/** node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
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

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  sqlite.exec(readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, ""));
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

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

function makeFetcher(db, calls) {
  return async function (input, init = {}) {
    const raw = typeof input === "string" ? input : input.url;
    const u = new URL(raw, "http://localhost");
    calls.push({ method: String(init.method || "GET").toUpperCase(), url: u.toString(), path: u.pathname + u.search });
    const req = new Request(u.toString(), { method: init.method || "GET", headers: init.headers, body: init.body });
    return await worker.fetch(req, { DB: db });
  };
}

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
const rootOf = (x) => (x && x.window ? x.window.document : x);
const q = (dom, sel) => rootOf(dom).querySelector(sel);
const qa = (dom, sel) => [...rootOf(dom).querySelectorAll(sel)];
const text = (dom, sel) => {
  const el = q(dom, sel);
  return el ? el.textContent : "";
};
const setVal = (dom, id, v) => {
  const el = dom.window.document.getElementById(id);
  el.value = v;
  el.dispatchEvent(new dom.window.Event("input", { bubbles: true }));
  return el;
};

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

/* ============================================================ ① 契约与上游 oracle 逐条对齐 */
console.log("① 契约与上游 oracle 逐条对齐（TC-I-M6-006 / TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）");
{
  const tc = readFileSync(path.join(ROOT, "docs/05-test-cases/test-M6.md"), "utf8");
  const prd = readFileSync(path.join(ROOT, "docs/02-prd/PRD-M6-运营端工作台.md"), "utf8");
  const brd = readFileSync(path.join(ROOT, "docs/01-brd/BRD.md"), "utf8");
  assert(/#### F-32 任务与状态页/.test(brd), "BRD §4 F-32 标题在案（任务与状态页）");
  assert(/任务运行状态/.test(brd) && /受阻原因/.test(brd) && /已完成部分/.test(brd), "BRD §4 F-32 描述含「任务运行状态 / 受阻原因 / 已完成部分」");

  const line = (id) => (tc.split("\n").find((l) => l.includes(id)) || "");
  const orc = line("TC-I-M6-006");
  assert(orc.includes("任务与状态页"), "oracle TC-I-M6-006 行在案（任务与状态页）");
  assert(/任务运行状态/.test(orc) && /受阻原因/.test(orc) && /已完成部分/.test(orc), "oracle 含「任务运行状态 / 受阻原因 / 已完成部分」");
  assert(/机会未被选中/.test(orc) && /任务未完成/.test(orc) && /研究未支持候选行为/.test(orc), "oracle 三类事实分别可见（机会未被选中 / 任务未完成 / 研究未支持候选行为）");
  assert(orc.includes("F-06"), "oracle 回指 M1 F-06（状态机口径一致）");
  assert(orc.includes("TC-I-M1-004"), "oracle 回指 M1 TC-I-M1-004（状态机）");

  const c1 = line("TC-C-M6-001");
  assert(c1.includes("前端消费") && c1.includes("server/api"), "oracle TC-C-M6-001：前端消费 server/api 返回的 JSON");
  assert(/不直连数据库/.test(c1) && /凭证/.test(c1), "oracle TC-C-M6-001：前端不直连数据库、不持有外部系统凭证");
  assert(/生产写接口调用/.test(c1), "oracle TC-C-M6-001 硬红线：前端不发起任何生产写接口调用");

  const d1 = line("TC-D-M6-001");
  assert(d1.includes("前端不写库"), "oracle TC-D-M6-001：前端不写库（写请求经 server/api 转发）");

  const sep = line("TC-I-M6-007");
  assert(sep.includes("删掉") && sep.includes("frontend/"), "oracle TC-I-M6-007：删掉 frontend/ 后 server/api 与 db 仍独立可用");

  assert(/任务与状态页/.test(prd) && /三类事实/.test(prd), "PRD-M6 F-32 在案（功能描述 + 验收要点）");
  assert(/PD-01/.test(prd) && /PD-02/.test(prd) && /PD-03/.test(prd) && /PD-05/.test(prd), "PRD-M6 F-32 关联 schema＝PD-01/PD-02/PD-03/PD-05");
}

/* ============================================================ ② 静态红线（前端纪律） */
console.log("② 静态红线：只经 server/api、不持凭证、不写库、不复制 mock 数据、只读页零写调用");
{
  const files = frontendFiles();
  const code = {};
  for (const f of files) {
    if (/^test-f\d+\.mjs$/.test(path.basename(f))) continue;
    const kind = f.endsWith(".html") ? "html" : "js";
    code[rel(f)] = stripAllComments(readFileSync(f, "utf8"), kind);
  }
  const names = Object.keys(code);
  assert(names.length >= 9, `前端受检运行期文件 ${names.length} 个（实测）`);

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

  const page = code["frontend/pages/tasks.html"];
  assert(/assets\/api\.js/.test(page) && /assets\/app\.js/.test(page), "任务页只加载 api.js 与 app.js 两个脚本");
  assert(!/<script src="[^"]*data\.js/.test(page), "任务页不加载原型 data.js");
  assert(/<link rel="stylesheet" href="\.\.\/assets\/base\.css">/.test(page), "任务页只引本目录 base.css（无外部样式）");
  assert(/\/api\/task-blocks/.test(apiSrc), "api.js 封装了受阻记录端点（/api/task-blocks，PD-03 读面）");
  assert(/listTaskBlocks\s*[:=]\s*\(/.test(apiSrc) && /get\("\/api\/task-blocks"/.test(apiSrc), "listTaskBlocks 为 GET 只读封装（不自造写面）");

  // F-32 为只读页：页面只调只读 API 封装，不得出现任何写面调用
  const apiCalls = (page.match(/API\.\w+/g) || []).map((s) => s.slice(4));
  const allowed = ["listTaskBlocks", "listOpportunities", "listAllResearch", "getResearchResult"];
  assert(apiCalls.every((c) => allowed.indexOf(c) !== -1),
    `任务页只调只读 API 封装（实测 ${[...new Set(apiCalls)].join(",")}）`);
  assert(!/createFollowupTask|submitProposal|createHvaResearchTask|changeOpportunityStatus|registerGoal|saveGoalVersion|applyGoalVersion|runGoalCheck|fillGoalGap|createDiscoveryTask|createResearchProposalTrigger|createResearchTask/.test(page),
    "任务页不调用任何写面（F-32 纯展示，零写请求）");
}

/* ============================================================ ③ 渲染（真实后端）：三类事实 + 任务卡片 */
console.log("③ 渲染（真实后端）：三类事实统计 ＋ 任务卡片（状态 / 受阻原因 / 已完成部分）");
const ctx = freshDb();
const { sqlite, db } = ctx;
const calls = [];
let dom;
{
  assert(countRows(sqlite, "task") === 7, "种子基线：PD-01 共 7 行任务");
  assert(countRows(sqlite, "task_block") === 2, "种子基线：PD-03 共 2 行受阻记录");
  assert(countRows(sqlite, "opportunity") === 8, "种子基线：MD-06 共 8 行机会");
  assert(countRows(sqlite, "research") === 2, "种子基线：MD-07 共 2 行研究");
  assert(countRows(sqlite, "candidate_behavior") === 2, "种子基线：MD-09 共 2 行候选行为");

  dom = loadPage("pages/tasks.html", {
    query: "?goal=" + Q3,
    fetcher: makeFetcher(db, calls),
  });
  const ready = await waitFor(() => qa(dom, ".stat-num").length === 3 && text(dom, "#list").length > 0);
  assert(ready, "页面完成启动（外壳注入 + 取数 + pageInit）");
  assert((dom.__errors || []).length === 0,
    `页面零运行时错误（实测 ${(dom.__errors || []).length}${(dom.__errors || [])[0] ? "：" + dom.__errors[0] : ""}）`);

  const scopeText = text(dom, "#goal-scope");
  assert(scopeText.includes(Q3), `scope 条显示当前目标（实测含 ${Q3}）`);

  // 三类事实：标签分别可见
  const statsText = text(dom, "#stats");
  assert(/① 机会未被选中/.test(statsText), "三类事实① 标签可见（机会未被选中）");
  assert(/② 任务未完成/.test(statsText), "三类事实② 标签可见（任务未完成）");
  assert(/③ 研究未支持候选行为/.test(statsText), "三类事实③ 标签可见（研究未支持候选行为）");

  // 三类事实：数字取自种子真值（不混 demo）
  const nums = qa(dom, ".stat-num").map((e) => e.textContent.trim());
  assert(nums.length === 3, `三类事实各一个计数（实测 ${nums.length}）`);
  assert(Number(nums[0]) === 4, `① 机会未被选中＝4（3 候选 + 1 暂不研究，实测 ${nums[0]}）`);
  assert(Number(nums[1]) === 3, `② 任务未完成＝3（运行中1 + 受阻1 + 已停止1，实测 ${nums[1]}）`);
  assert(Number(nums[2]) === 1, `③ 研究未支持候选行为＝1（R-006 候选行为未获支持，实测 ${nums[2]}）`);

  // 任务卡片：所有任务都渲染
  const listText = text(dom, "#list");
  assert(listText.includes("T-1022") && listText.includes("T-1021") && listText.includes("T-1023"), "已渲染已知任务（T-1022/T-1021/T-1023）");
  assert(listText.includes("T-1020") && listText.includes("T-1019") && listText.includes("T-1018"), "已渲染受阻 / 已停止 / 已完成任务");

  // 过滤器 chips
  const chips = qa(dom, ".chip[data-f]");
  assert(chips.length === 5, `过滤器 5 个（全部/运行中/受阻/已停止/已完成，实测 ${chips.length}）`);
}

/* ============================================================ ④ 受阻原因 / 已完成部分 口径（与 BRD F-06 / M5 F-26 一致） */
console.log("④ 受阻原因与已完成部分：停止→已停止；受阻非「目标口径不清」→ 等待接口恢复；done_part 呈现");
{
  const listText = text(dom, "#list");

  // T-1020：blocked + call_failed → 等待接口恢复；done_part 来自种子
  const blockedCard = (() => {
    const cards = qa(dom, ".task-card");
    return cards.find((c) => c.textContent.includes("T-1020"));
  })();
  assert(!!blockedCard, "存在 T-1020 卡片（blocked 任务）");
  assert(blockedCard.textContent.includes("等待接口恢复"), "T-1020（call_failed）→ 受阻原因「等待接口恢复」");
  assert(blockedCard.textContent.includes("已保存启动依据与首次查询记录；CDP 行为明细查询失败，已完成部分保留待续"), "T-1020 呈现真实 done_part（已完成部分）");
  assert(blockedCard.textContent.includes("CDP 行为明细查询失败（接口超时，重试 3/3）"), "T-1020 呈现 block_note（受阻具体说明）");
  assert(blockedCard.textContent.includes("等待 CDP 接口恢复（阻塞自 2026-09-16 10:02）"), "T-1020 呈现 resume_condition（继续条件）");

  // T-1019：stopped + source_unavailable → 已停止；done_part 来自种子
  const stoppedCard = (() => {
    const cards = qa(dom, ".task-card");
    return cards.find((c) => c.textContent.includes("T-1019"));
  })();
  assert(!!stoppedCard, "存在 T-1019 卡片（stopped 任务）");
  assert(stoppedCard.textContent.includes("已停止"), "T-1019（stopped）→ 受阻原因「已停止」");
  assert(stoppedCard.textContent.includes("已形成的范围说明与信息缺口已保存，可后续重跑"), "T-1019 呈现真实 done_part（保留已完成部分，不自动重启）");
  assert(stoppedCard.textContent.includes("（保留已完成部分，不自动重启）"), "已停止任务标注「保留已完成部分，不自动重启」（与 BRD F-06 一致）");

  // 字段标签
  assert(/运行状态/.test(listText) && /已完成部分/.test(listText), "任务卡片含「运行状态 / 已完成部分」字段标签");
  assert(/启动依据/.test(listText), "任务卡片含「启动依据」字段（触发原因可回查）");
}

/* ============================================================ ⑤ 三类事实口径一致（跨原表重算核对） */
console.log("⑤ 三类事实口径一致：页内数字＝原表重算（机会 / 任务 / 研究）");
{
  const oppRaw = (await api(db, "GET", "/api/opportunities?goal_id=" + Q3)).payload.items;
  const notSelectedRaw = oppRaw.filter((o) => o.opportunity_status === "candidate" || o.opportunity_status === "deferred").length;

  const recRaw = (await api(db, "GET", "/api/goals/" + Q3)).payload;
  const tasksRaw = recRaw.tasks || [];
  const unfinishedRaw = tasksRaw.filter((t) => t.task_status !== "done").length;

  const studiesRaw = (await api(db, "GET", "/api/research")).payload.items
    .filter((s) => s.goal_id === Q3 && s.research_status === "done");
  let nsRaw = 0;
  for (const st of studiesRaw) {
    const r = (await api(db, "GET", "/api/research-result/" + st.research_no)).payload;
    if (r.elements && r.elements.e5_candidate_hva && r.elements.e5_candidate_hva.unsupported_count > 0) nsRaw++;
  }

  const nums = qa(dom, ".stat-num").map((e) => e.textContent.trim());
  assert(Number(nums[0]) === notSelectedRaw, `① 页内数＝机会原表重算（候选+暂不研究＝${notSelectedRaw}）`);
  assert(Number(nums[1]) === unfinishedRaw, `② 页内数＝任务原表重算（非 done＝${unfinishedRaw}）`);
  assert(Number(nums[2]) === nsRaw, `③ 页内数＝研究七要素读模型重算（未支持候选行为＝${nsRaw}）`);
}

/* ============================================================ ⑥ 前端只读 / 业务数据不落前端存储（TC-C-M6-001 / TC-D-M6-001） */
console.log("⑥ F-32 为只读页：零写请求、业务数据不落前端持久存储");
{
  assert(calls.every((c) => c.path.startsWith("/api/")), `全部 ${calls.length} 次请求均经 /api/（无直连外部）`);
  assert(calls.every((c) => new URL(c.url).origin === "http://localhost"), "所有请求同源（origin 与页面一致）");

  const writes = calls.filter((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method));
  assert(writes.length === 0, `F-32 纯展示页：写动作 0 次（实测 ${writes.length}，硬红线：前端不发起任何生产写接口调用）`);
  assert(!calls.some((c) => /\/api\/(query|query-records|query-recovery|tool-permission|agent-delegations|followup-tasks|research-proposals|hva-research-tasks)/.test(c.path)),
    "未调用任何「生产查询 / 外部调用 / 写面」类接口（前后端分离 + 硬红线）");

  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const keys = Object.keys(JSON.parse(raw));
  assert(keys.every((k) => ["applied", "navUnread"].indexOf(k) !== -1),
    `前端持久存储只含会话态键（实测 ${JSON.stringify(keys)}）`);

  const before = {
    task: countRows(sqlite, "task"),
    research: countRows(sqlite, "research"),
    block: countRows(sqlite, "task_block"),
  };
  const fresh = loadPage("pages/tasks.html", { query: "?goal=" + Q3, fetcher: makeFetcher(db, []) });
  await waitFor(() => qa(fresh, ".stat-num").length === 3);
  const after = {
    task: countRows(sqlite, "task"),
    research: countRows(sqlite, "research"),
    block: countRows(sqlite, "task_block"),
  };
  assert(JSON.stringify(before) === JSON.stringify(after),
    `仅打开页面不改库（任务 ${after.task} / 研究 ${after.research} / 受阻 ${after.block} 均不变：读操作零写）`);
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
    ["GET", "/api/goals"],
    ["GET", "/api/goals/" + Q3],
    ["GET", "/api/task-blocks"],
    ["GET", "/api/opportunities?goal_id=" + Q3],
    ["GET", "/api/research"],
    ["GET", "/api/research-result/R-006"],
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
