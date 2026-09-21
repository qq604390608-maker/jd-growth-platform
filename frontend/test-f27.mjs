#!/usr/bin/env node
/**
 * 文档卡（阶段5 · M6 · F-27 用例执行器 · 2026-09-20）
 * 上游：`../../docs/05-test-cases/test-M6.md`（**TC-I-M6-001 = F-27 验收 oracle**：业务方登记 / 关联
 *        目标六要素；**不替业务方定指标**（口径不清时列待补项）；目标更新形成新版本并提示影响范围
 *        （版本可见、不混期）。**TC-C-M6-001** = 契约：前端消费 `server/api` 返回的 JSON；
 *        **前端不直连数据库、不持有任何外部系统凭证**，动态数据一律经 API；硬红线：前端不发起任何
 *        生产写接口调用。**TC-D-M6-001** = 前端不写库（前端代码库不得出现直接 D1 binding 或外部凭证）。
 *        **TC-I-M6-007** = 前后端分离判断标准：删掉 `frontend/` 整个目录，`server/api` 与 `db`
 *        仍能独立存在并被任意客户端调用）
 *   ｜ `../../docs/02-prd/PRD-M6-运营端工作台.md` F-27（验收要点两行；§4 关键约束 1/2/5/6）
 *   ｜ `../../docs/01-brd/BRD.md` §4 M6 F-27、§5.3 硬红线
 *   ｜ `../../docs/03-locks/tech-stack.md`（§1.2 前后端分离落点与判断标准；§2.1 前端形态＝零构建静态资源，
 *        数据来源＝server/api，**原型的 mock 数据不复制进前端**；§6 工程结构 frontend/）
 *   ｜ `../../docs/03-locks/schema.md`（MD-01 research_goal / MD-02 research_goal_version /
 *        MD-03 goal_material / PD-04 goal_gap）
 *   ｜ `../../prototype/pages/goal.html`（**钉死需求的实证**：区块 / 交互 / 文案以其为准）
 *   ｜ `./pages/goal.html`（被测页面）｜ `./assets/api.js`（唯一数据出口）｜ `./assets/app.js`（共享口径）
 *   ｜ `../server/api/index.js`（**真实后端**：本执行器把页面的 fetch 接到 worker.fetch，不 mock 业务语义）
 *   ｜ `../server/task-runner/goal.js`（`GOAL_FIELDS` 六要素键唯一真源）
 * 职责：用 jsdom 加载**真实页面**（内联 `<script src>`，走真实 `DOMContentLoaded` → `pageInit` 链路），
 *       把 `window.fetch` 接到**真实 Worker + 真实 D1（node:sqlite 适配层，载真实 DDL/种子）**，
 *       实跑 F-27 用例并断言。
 * 硬红线：仅本机内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义与版本隔离）。
 * 边界：本执行器只验 F-27；F-28~F-32 各自的执行器覆盖。静态扫描一律**先 strip 注释**（本文件自身的
 *       文档卡里就出现 `frontend`、`fetch` 等被扫词，不 strip 会自伤），且**按执行器通配排除**同目录的
 *       其它 `test-f*.mjs`（它们是 jsdom 装置，不是前端运行期产物）。
 * 反向清单：登记 `./README.md`；被 `.github/workflows/ci.yml` 的 `validate` 步骤复用
 *       （`node frontend/test-f27.mjs`）。
 *
 * 用法：NODE_PATH=<jsdom 所在 node_modules> node frontend/test-f27.mjs
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
  console.error("  npm i --no-save jsdom && node frontend/test-f27.mjs");
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
const text = (dom, sel) => {
  const el = dom.window.document.querySelector(sel);
  return el ? el.textContent : "";
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
const Q2 = "GOAL-2026Q2-01";
const OPERATOR = "产品经理 · PM";

/* ============================================================ ① 契约与上游对齐 */
console.log("① 契约与上游 oracle 逐条对齐（TC-I-M6-001 / TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）");
{
  const tc = readFileSync(path.join(ROOT, "docs/05-test-cases/test-M6.md"), "utf8");
  const prd = readFileSync(path.join(ROOT, "docs/02-prd/PRD-M6-运营端工作台.md"), "utf8");
  const line = (id) => (tc.split("\n").find((l) => l.includes(id)) || "");

  const orc = line("TC-I-M6-001");
  assert(orc.includes("目标配置页"), "oracle TC-I-M6-001 行在案（目标配置页）");
  assert(orc.includes("不替业务方定指标") && orc.includes("待补项"), "oracle 含「不替业务方定指标（口径不清时列待补项）」");
  assert(orc.includes("新版本") && orc.includes("影响范围") && orc.includes("版本可见"), "oracle 含「新版本＋影响范围＋版本可见（不混期）」");

  const c1 = line("TC-C-M6-001");
  assert(c1.includes("前端消费") && c1.includes("server/api"), "oracle TC-C-M6-001：前端消费 server/api 返回的 JSON");
  assert(/不直连数据库/.test(c1) && /凭证/.test(c1), "oracle TC-C-M6-001：前端不直连数据库、不持有外部系统凭证");
  assert(/生产写接口调用/.test(c1), "oracle TC-C-M6-001 硬红线：前端不发起任何生产写接口调用");

  const d1 = line("TC-D-M6-001");
  assert(d1.includes("前端不写库"), "oracle TC-D-M6-001：前端不写库（写请求经 server/api 转发）");

  const sep = line("TC-I-M6-007");
  assert(sep.includes("删掉") && sep.includes("frontend/"), "oracle TC-I-M6-007：删掉 frontend/ 后 server/api 与 db 仍独立可用");

  assert(prd.includes("不替业务方定指标；版本变化可见"), "PRD-M6 F-27 验收要点两行在案");
  assert(/F-27 目标配置页/.test(prd) && /触发 M1 F-01/.test(prd), "PRD-M6 F-27 的衔接面＝触发 M1 F-01");
}

/* ============================================================ ② 六要素口径：与服务端逐条对齐 */
console.log("② 六要素键与服务端真源逐条对齐（不复制第二个口径）");
{
  const goalSrc = readFileSync(path.join(ROOT, "server/task-runner/goal.js"), "utf8");
  const m = /export const GOAL_FIELDS = \[([\s\S]*?)\];/.exec(goalSrc);
  const serverFields = [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]);
  const appSrc = readFileSync(path.join(ROOT, "frontend/assets/app.js"), "utf8");
  const appBody = stripAllComments(appSrc, "js");
  const feBlock = /const SIX_FIELDS = \[([\s\S]*?)\];/.exec(appBody)[1];
  const feKeys = [...feBlock.matchAll(/key:\s*"([^"]+)"/g)].map((x) => x[1]);
  assert(serverFields.length === 6, `服务端 GOAL_FIELDS 为 6 键（实测 ${serverFields.length}）`);
  assert(feKeys.join(">") === serverFields.join(">"),
    `前端 SIX_FIELDS 键序与服务端逐条相等（实测 ${feKeys.join(">")}）`);

  const labels = [...feBlock.matchAll(/label:\s*"([^"]+)"/g)].map((x) => x[1]);
  assert(labels.length === 6 && labels[0] === "业务目标" && labels[5] === "提供方与材料",
    "六要素中文标签与原型一致（① 业务目标 … ⑥ 提供方与材料）");
  assert(/no:\s*"①"/.test(feBlock) && /no:\s*"⑥"/.test(feBlock), "六要素带原型同一套序号 ①~⑥");
}

/* ============================================================ ③ 静态红线（前端纪律） */
console.log("③ 静态红线：只经 server/api、不持凭证、不写库、不复制 mock 数据");
{
  const files = frontendFiles();
  const code = {};
  for (const f of files) {
    // 受检对象＝**前端运行期产物**：本目录下的 .js/.html/.css。执行器（test-f*.mjs）不是运行期产物，
    // 它自带 SQL 语句、`fetch(`、`http://localhost` 等字面（jsdom 装置与断言），必须整体排除——
    // 排除规则按**执行器通配**而非「自己的文件名」，否则同目录每新增一个 F-xx 执行器都会把本组断言打红。
    if (/^test-f\d+\.mjs$/.test(path.basename(f))) continue;
    const kind = f.endsWith(".html") ? "html" : "js";
    code[rel(f)] = stripAllComments(readFileSync(f, "utf8"), kind);
  }
  const names = Object.keys(code);
  assert(names.length >= 5, `前端受检运行期文件 ${names.length} 个（实测）`);

  const joiner = "\n";
  const all = names.map((n) => code[n]).join(joiner);

  const abs = names.filter((n) => /https?:\/\//.test(code[n]));
  assert(abs.length === 0, `无任何绝对地址（http/https）——前端不直连外部系统（实测命中 ${abs.length}）`);

  const protoRel = names.filter((n) => /["'`]\/\/[a-z0-9.-]+\//i.test(code[n]));
  assert(protoRel.length === 0, `无协议相对地址（//host/）——同上（实测命中 ${protoRel.length}）`);

  const cred = names.filter((n) => /\bAuthorization\b|\bBearer\b|api[_-]?key|access[_-]?token|secret[_-]?key/i.test(code[n]));
  assert(cred.length === 0, `不设 Authorization / 不持 API Key / Token / Secret（实测命中 ${cred.length}）`);

  const d1 = names.filter((n) => /\benv\.DB\b|D1Database|\.prepare\s*\(/.test(code[n]));
  assert(d1.length === 0, `不出现 D1 binding 与 SQL 语句入口（前端不直连数据库，实测命中 ${d1.length}）`);

  // 判据＝**语句形态**，不是裸关键字：`<select>` 元素、CSS `select` 选择器、JS `delete` 运算符都不是 SQL。
  // 前端若真写库，必然出现「引号内的语句」（如 "SELECT ... FROM" / "DELETE FROM"），故按语句扫描。
  const SQL_STMT = /["'`][^"'`]*\b(?:SELECT\s+[\s\S]*?\s+FROM|INSERT\s+INTO|UPDATE\s+[\w"'`[\].]+\s+SET|DELETE\s+FROM|DROP\s+(?:TABLE|INDEX|VIEW)|ALTER\s+TABLE|TRUNCATE\s+TABLE)\b/i;
  const sql = names.filter((n) => SQL_STMT.test(code[n]));
  assert(sql.length === 0, `不出现 SQL 语句（前端不写库，实测命中 ${sql.length}${sql.length ? "：" + sql.join(",") : ""}）`);

  const mock = names.filter((n) => /window\.DB\b|data\.js/.test(code[n]));
  assert(mock.length === 0, `不引用原型的 mock 数据源（原型的 mock 数据不复制进前端，实测命中 ${mock.length}）`);

  const fetchHits = names.filter((n) => /\bfetch\s*\(/.test(code[n]));
  assert(fetchHits.length === 1 && fetchHits[0] === "frontend/assets/api.js",
    `fetch 只出现在唯一数据出口 assets/api.js（实测 ${fetchHits.join(",") || "无"}）`);

  const apiSrc = code["frontend/assets/api.js"];
  assert(/path\.indexOf\("\/api\/"\)\s*!==\s*0/.test(apiSrc), "api.js 有「路径必须 /api/ 开头」的运行期守卫");
  assert(/indexOf\(":\/\/"\)\s*!==\s*-1/.test(apiSrc), "api.js 有「不得是绝对地址」的运行期守卫");
  const apiPaths = [...apiSrc.matchAll(/get\(|post\(/g)].length;
  assert(apiPaths >= 8, `api.js 只收口既有端点（get/post 调用 ${apiPaths} 处，实测）`);
  // 判据＝**带 scheme 的地址**（http:// / https://），不是字面词 `HTTP`（错误文案里写「HTTP 500」是正常的）。
  assert(!/https?:\/\//i.test(apiSrc), "api.js 内无任何带 scheme 的地址（同源相对路径，实测命中 0）");
  assert(/const BASE = ""/.test(apiSrc), "api.js 的 BASE 为空串（同源部署，不得指向任何外部域名）");

  const appSrc2 = code["frontend/assets/app.js"];
  assert(!/\bfetch\s*\(/.test(appSrc2), "app.js 自身不发请求（一律经 api.js）");
  assert(/window\.API\./.test(appSrc2), "app.js 取数经 window.API（唯一出口）");

  const html = code["frontend/pages/goal.html"];
  assert(/assets\/api\.js/.test(html) && /assets\/app\.js/.test(html), "goal.html 只加载 api.js 与 app.js 两个脚本");
  assert(!/<script src="[^"]*data\.js/.test(html), "goal.html 不加载原型 data.js");
  assert(/<link rel="stylesheet" href="\.\.\/assets\/base\.css">/.test(html), "goal.html 只引本目录 base.css（无外部样式）");
}

/* ============================================================ ④ 渲染：目标选择 / 六要素 / 版本 / 运行链 */
console.log("④ 渲染（真实后端）：目标选择、六要素、版本历史与影响范围、运行链");
const ctx = freshDb();
const { sqlite, db } = ctx;
const calls = [];
let dom;
{
  const seedGoals = countRows(sqlite, "research_goal");
  const seedVersions = sqlite.prepare("SELECT COUNT(*) c FROM research_goal_version WHERE goal_id = ?").get(Q3).c;
  const applied = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND is_applied = 1").get(Q3);
  const v3 = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = 3").get(Q3);

  dom = loadPage("pages/goal.html", { fetcher: makeFetcher(db, calls) });
  const ready = await waitFor(() => dom.window.document.getElementById("goal-select").options.length > 1);
  assert(ready, "页面完成启动（骨架注入 + 取数 + pageInit）");

  const errors = dom.__errors || [];
  assert(errors.length === 0, `页面零运行时错误（实测 ${errors.length}${errors.length ? "：" + errors[0] : ""}）`);
  assert(text(dom, "#boot-notice") === "", "无「数据加载失败」提示（取数成功）");

  const opts = [...dom.window.document.getElementById("goal-select").options];
  assert(opts.length === seedGoals + 1, `目标下拉＝种子目标 ${seedGoals} 条 ＋「＋ 新增六要素」（实测 ${opts.length} 项）`);
  assert(opts[0].value === Q3, `默认落在序号最小的目标（实测 ${opts[0].value}）`);
  assert(opts[opts.length - 1].value === "__new__" && /新增六要素/.test(opts[opts.length - 1].textContent), "末项为「＋ 新增六要素」");

  const sixHtml = text(dom, "#six-rows");
  assert(/①\s*业务目标/.test(sixHtml) && /⑥\s*提供方与材料/.test(sixHtml), "六要素六行齐备（①~⑥）");
  for (const [no, label] of [["②", "指标口径"], ["③", "业务范围"], ["④", "关注时段"], ["⑤", "已知约束"]]) {
    assert(new RegExp(no + "\\s*" + label).test(sixHtml), `六要素含「${no} ${label}」`);
  }
  const shown = dom.window.document.querySelector('[data-view="business_goal"]').textContent;
  assert(shown === v3.business_goal, "① 业务目标取自服务端当前版本（逐字）");
  const shownMetric = dom.window.document.querySelector('[data-view="metric_definition"]').textContent;
  assert(shownMetric === v3.metric_definition, "② 指标口径取自服务端当前版本（逐字）");

  const noteTxt = text(dom, "#six-note");
  assert(noteTxt.includes(Q3) && noteTxt.includes("v3"), `六要素说明显示目标与当前版本（实测含 v3）`);
  assert(noteTxt.includes("生效 v" + applied.version_no), "显示当前生效版本（版本可见）");

  const tl = dom.window.document.querySelectorAll("#version-timeline .tl-item");
  assert(tl.length === seedVersions, `版本历史条数＝该目标版本数（实测 ${tl.length}／种子 ${seedVersions}）`);
  assert(text(dom, "#version-timeline").includes("影响："), "版本历史逐条带「影响范围」");
  assert(text(dom, "#version-timeline").includes(v3.change_note), "含当前版本的变更说明（版本不混期：各版本各说各的）");

  const chain = text(dom, "#chain");
  assert(/① 目标配置 v3 已登记/.test(chain), `运行链显示「① 目标配置 v3 已登记」（实测）`);
  assert(/② 机会发现已执行/.test(chain), "运行链显示 ② 机会发现已执行（种子已有 discovery 任务）");

  const mats = text(dom, "#materials");
  const activeMats = sqlite.prepare("SELECT COUNT(*) c FROM goal_material WHERE goal_id = ? AND is_active = 1").get(Q3).c;
  assert(mats.includes("已关联材料 " + activeMats + " 份"), `材料按生效行只读展示（实测 ${activeMats} 份）`);
  assert(/只读展示/.test(mats), "材料区明示「只读展示」（登记面未接入 api，缺口已登记）");

  const gapCard0 = text(dom, "#gap-card");
  assert(gapCard0 === "", "进入页面**不自动执行口径检查**：种子里无待补项则该块不出现（看页面不写库）");
  assert(calls.length >= 3, `启动取数 ${calls.length} 次，全部经 /api/（实测）`);
  assert(calls.every((c) => c.path.startsWith("/api/")), "所有请求路径均以 /api/ 开头（前端只经 server/api）");
  assert(calls.every((c) => new URL(c.url).origin === "http://localhost"),
    "所有请求**同源**（origin 与页面一致，实测）");
  assert(!calls.some((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method)),
    "进入页面**不产生任何写请求**（GET-only）");
}

/* ============================================================ ⑤ 保存为新版本：版本可见、不混期、历史只读 */
console.log("⑤ 保存为新版本：形成新版本并提示影响范围；历史版本逐字节只读");
{
  const before = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? ORDER BY version_no").all(Q3);
  click(dom, "btn-edit");
  assert(dom.window.document.getElementById("btn-save").disabled === false, "点「编辑六要素」后「保存为新版本」可点");
  assert(dom.window.document.querySelector('[data-field="metric_definition"]').style.display === "block",
    "编辑态切换为输入控件（只读视图隐藏）");

  dom.window.document.querySelector('[data-field="known_constraints"]').value = "新增约束：Q4 起按周对齐口径";
  dom.window.document.getElementById("change-note").value = "补充已知约束并复核指标口径";
  dom.window.document.getElementById("impact-note").value = "影响 2 个在研研究：相关证据需按新口径复核";
  click(dom, "btn-save");

  const ok = await waitFor(() => /已保存为目标新版本 v4/.test(text(dom, "#action-note")));
  assert(ok, "保存动作完成并给出结果提示（含新版本号）");

  const after = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? ORDER BY version_no").all(Q3);
  assert(after.length === before.length + 1, `版本数 +1（实测 ${before.length} → ${after.length}）`);
  assert(after[after.length - 1].version_no === before[before.length - 1].version_no + 1, "新版本号＝库内最大 +1");
  assert(after[after.length - 1].change_note === "补充已知约束并复核指标口径", "变更说明原样落库（版本可追溯）");
  assert(after[after.length - 1].impact_note === "影响 2 个在研研究：相关证据需按新口径复核",
    "影响范围原样落库并展示（oracle：提示影响范围）");
  assert(after[after.length - 1].is_applied === 0, "新版本 is_applied=0（**尚不生效**，须显式应用配置）");

  const oldIntact = before.every((b) => {
    const a = after.find((x) => x.version_no === b.version_no);
    return JSON.stringify(a) === JSON.stringify(b);
  });
  assert(oldIntact, "历史版本逐字节只读（保存新版本不改动任何旧版本行）");

  const goalRow = sqlite.prepare("SELECT * FROM research_goal WHERE goal_id = ?").get(Q3);
  assert(goalRow.current_version_no === 4, "MD-01 的 current_version_no 指向新版本");
  assert(goalRow.goal_id === Q3 && goalRow.goal_seq === 1, "目标身份（goal_id / goal_seq）跨版本稳定");

  const tl = [...dom.window.document.querySelectorAll("#version-timeline .tl-item")];
  assert(tl.length === after.length, `版本历史随保存即时增加（实测 ${tl.length} 条）`);
  assert(tl[0].textContent.includes("v4") && tl[0].textContent.includes("影响："), "新版本置顶且带影响范围（版本可见）");
  assert(text(dom, "#version-timeline").includes("v3") && text(dom, "#version-timeline").includes("v1"),
    "历史版本仍在（新版本不覆盖旧版本）");
}

/* ============================================================ ⑥ 不替业务方定指标：留空 → 列待补项 */
console.log("⑥ 不替业务方定指标：留空即产生待补项；页面不编造任何口径");
{
  // 上一步「保存为新版本」已**自动执行一次口径检查任务**（F-01）——此处先核对它的产出
  const q3Gaps = () => sqlite.prepare("SELECT * FROM goal_gap WHERE goal_id = ? ORDER BY gap_id").all(Q3);
  const rows = q3Gaps();
  assert(rows.length === 3, `Q3 v4 按 4 条规则校验产出 3 项待补（实测 ${rows.length}：metric_definition×2 + business_scope×1）`);
  const checkTaskId = rows[0].raised_by_task_id;
  assert(rows.every((r) => r.raised_by_task_id === checkTaskId), "同一轮检查的待补项归属同一个任务");
  assert(rows.every((r) => r.goal_version_no === 4), "待补项钉在触发它的目标版本（v4，不混期）");
  assert(rows.every((r) => r.raised_by_task_id && r.impact_note && r.raised_at), "每项待补都带提出任务、影响的判断与时间");
  const task = sqlite.prepare("SELECT * FROM task WHERE task_id = ?").get(rows[0].raised_by_task_id);
  assert(task.task_type === "goal_check" && task.task_status === "done", "待补项归属一次已完成的口径检查任务（task_type=goal_check）");

  const gapTxt = text(dom, "#gap-card");
  assert(/口径待补任务/.test(gapTxt) && /待补 3 项/.test(gapTxt), "待补任务块出现并显示项数");
  assert(/平台只列缺失，不替业务方定义/.test(gapTxt), "待补块明示「平台只列缺失，不替业务方定义」");
  assert(rows.every((r) => gapTxt.includes(r.gap_id)), "逐项列出待补编号");
  assert(/影响的判断/.test(gapTxt), "待补项列出「影响的判断」列");

  // 显式「重新检查口径」按钮：真跑一次口径检查任务（进入页面**不**自动跑，见 ④）
  const checkTasksBefore = sqlite.prepare("SELECT COUNT(*) c FROM task WHERE goal_id = ? AND task_type = 'goal_check'").get(Q3).c;
  const gapsBeforeRecheck = q3Gaps().length;
  click(dom, "btn-recheck");
  await waitFor(() => /口径检查任务/.test(text(dom, "#action-note")) &&
    sqlite.prepare("SELECT COUNT(*) c FROM task WHERE goal_id = ? AND task_type = 'goal_check'").get(Q3).c > checkTasksBefore);
  const checkTasksAfter = sqlite.prepare("SELECT COUNT(*) c FROM task WHERE goal_id = ? AND task_type = 'goal_check'").get(Q3).c;
  assert(checkTasksAfter === checkTasksBefore + 1, `「重新检查口径」新建 1 个检查任务（${checkTasksBefore} → ${checkTasksAfter}）`);
  // 2026-09-21 裁决收口（frontend/README §4 缺口 2）：F-01 的 checkGoalGaps 增加「仍未补充的规则
  // 重跑不重复列」（同 goal 同规则已有 is_solved=0 的待补项即跳过，why=open_gap_exists）——
  // 重跑只新建检查任务与留痕，不再落重复待补项行。
  assert(q3Gaps().length === gapsBeforeRecheck,
    `重跑检查不再重复列未补充规则（实测 ${gapsBeforeRecheck} → ${q3Gaps().length}；2026-09-21 去重裁决）`);
  assert(!/系统|平台自动|自动生成/.test(text(dom, "#gap-card")), "待补块文案不含任何「平台自动生成口径」痕迹");

  // 反向：页面**没有**替业务方填任何指标口径
  const v4 = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = 4").get(Q3);
  const v3 = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = 3").get(Q3);
  assert(v4.metric_definition === v3.metric_definition, "未编辑的字段原样沿用（页面不擅自改写口径）");
  assert(v4.known_constraints === "新增约束：Q4 起按周对齐口径", "只把业务方输入的值写入（逐字）");
  assert(!/系统|平台|自动生成/.test(v4.metric_definition), "指标口径正文不含任何「系统自动生成」痕迹");

  // 新目标：六要素全留空也允许登记（留空即待补），页面不阻断也不编造
  const beforeGoals = countRows(sqlite, "research_goal");
  dom.window.document.getElementById("goal-select").value = "__new__";
  dom.window.document.getElementById("goal-select").dispatchEvent(new dom.window.Event("change"));
  await waitFor(() => dom.window.document.getElementById("btn-save").disabled === false);
  assert(/草稿，尚未保存/.test(text(dom, "#chain")), "切到「＋ 新增六要素」后运行链说明为草稿态");
  assert(text(dom, "#six-rows").includes("（未填写）"), "新建态六要素全为「（未填写）」（不预填任何值）");

  dom.window.document.getElementById("change-note").value = "新建目标：仅登记业务目标，其余留待口径检查";
  dom.window.document.querySelector('[data-field="business_goal"]').value = "提升京东超市老客月度复购频次";
  click(dom, "btn-save");
  const created = await waitFor(() => /已登记目标/.test(text(dom, "#action-note")));
  assert(created, "新建目标登记成功（六要素允许留空，不阻断提交）");
  assert(countRows(sqlite, "research_goal") === beforeGoals + 1, `目标数 +1（实测 ${beforeGoals} → ${countRows(sqlite, "research_goal")}）`);
  const newGoal = sqlite.prepare("SELECT * FROM research_goal ORDER BY goal_seq DESC").get();
  const newV1 = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ?").get(newGoal.goal_id);
  assert(newV1.business_goal === "提升京东超市老客月度复购频次", "新目标 v1 只写业务方输入的那一项");
  assert(newV1.metric_definition === "" && newV1.known_constraints === "",
    "其余五项留空落库为空串（**不编造默认口径**，交口径检查列待补）");
  assert(newV1.created_by === OPERATOR, "登记人来自页面固定的操作人标识（非凭证）");

  // 回到 Q3 继续后续用例
  dom.window.document.getElementById("goal-select").value = Q3;
  dom.window.document.getElementById("goal-select").dispatchEvent(new dom.window.Event("change"));
  await waitFor(() => (text(dom, "#six-note") || "").includes(Q3));
  assert(text(dom, "#six-note").includes(Q3), "切回目标后六要素按服务端记录重渲染");
}

/* ============================================================ ⑦ 补充待补项：并入六要素并形成新版本 */
console.log("⑦ 补充待补项：并入对应六要素字段并形成目标新版本");
{
  const unsolvedQ3 = () => sqlite.prepare("SELECT * FROM goal_gap WHERE goal_id = ? AND is_solved = 0").all(Q3);
  const gapsBeforeFill = unsolvedQ3().length;
  const target = unsolvedQ3().find((g) => g.target_field === "metric_definition");
  assert(!!target, "存在以 metric_definition 为目标的待补项（实测）");
  await waitFor(() => dom.window.document.querySelector(`[data-fill="${target.gap_id}"]`));
  assert(!!dom.window.document.querySelector(`[data-fill="${target.gap_id}"]`), "待补项带「填写」入口（可逐项补充）");

  const beforeVer = sqlite.prepare("SELECT COUNT(*) c FROM research_goal_version WHERE goal_id = ?").get(Q3).c;
  const beforeVal = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = 4").get(Q3).metric_definition;

  dom.window.document.querySelector(`[data-fill="${target.gap_id}"]`).dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true }));
  await waitFor(() => dom.window.document.getElementById("gap-input"));
  dom.window.document.getElementById("gap-input").value = "已形成口径：退款与取消订单剔除后再计";
  dom.window.document.querySelector(`[data-gapsave="${target.gap_id}"]`).dispatchEvent(
    new dom.window.MouseEvent("click", { bubbles: true }));

  const ok = await waitFor(() => /已补充/.test(text(dom, "#action-note")));
  assert(ok, "补充动作完成并给出结果提示");

  const g = sqlite.prepare("SELECT * FROM goal_gap WHERE gap_id = ?").get(target.gap_id);
  assert(g.is_solved === 1 && g.filled_value === "已形成口径：退款与取消订单剔除后再计" && g.filled_by === OPERATOR && g.filled_at,
    "待补项落 filled_* + is_solved=1（含补充人与时间）");
  const afterVer = sqlite.prepare("SELECT COUNT(*) c FROM research_goal_version WHERE goal_id = ?").get(Q3).c;
  assert(afterVer === beforeVer + 1, `形成目标新版本（版本数 ${beforeVer} → ${afterVer}）`);
  const v5 = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = 5").get(Q3);
  assert(v5.metric_definition === beforeVal + "；已形成口径：退款与取消订单剔除后再计",
    "补充值**追加**并入对应六要素字段（不覆盖业务方已写内容）");
  assert(/补充口径/.test(v5.change_note), "新版本的变更说明自动记为「补充口径（gap_id）」");
  assert(v5.impact_note.includes(target.gap_id), "影响范围记明补充自哪个待补项");
  assert(unsolvedQ3().length === gapsBeforeFill - 1,
    `已补项不再重复列出（该目标未补 ${gapsBeforeFill} → ${unsolvedQ3().length}）`);
  assert(!text(dom, "#gap-card").includes(target.gap_id + "</td>"), "已补项从待补块移除");
}

/* ============================================================ ⑧ 应用配置：版本生效 + 执行一次机会发现 */
console.log("⑧ 应用配置：使选中版本生效（F-01）并执行一次机会发现（F-02），运行链随之推进");
{
  const beforeTasks = countRows(sqlite, "task");
  const beforeApplied = sqlite.prepare("SELECT version_no FROM research_goal_version WHERE goal_id = ? AND is_applied = 1").get(Q3);
  assert(beforeApplied.version_no === 3, `应用前生效版本仍是 v3（实测 v${beforeApplied.version_no}）`);

  click(dom, "btn-apply");
  const ok = await waitFor(() => /已应用 v/.test(text(dom, "#action-note")));
  assert(ok, "应用配置动作完成并给出结果提示");

  const ap = sqlite.prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND is_applied = 1").all(Q3);
  assert(ap.length === 1, `同目标生效版本恒为 1 行（实测 ${ap.length}）`);
  assert(ap[0].version_no === 5, `生效版本推进到最新 v5（实测 v${ap[0].version_no}）`);
  assert(typeof ap[0].applied_at === "string" && ap[0].applied_at.length > 0, "生效时间已落库");

  assert(countRows(sqlite, "task") === beforeTasks + 1, `新建 1 个任务（${beforeTasks} → ${countRows(sqlite, "task")}）`);
  const disc = sqlite.prepare("SELECT * FROM task WHERE goal_id = ? AND task_type = 'discovery' ORDER BY task_id DESC").get(Q3);
  assert(!!disc && disc.task_status === "running", "新建任务为机会发现任务（task_type=discovery，running）");
  assert(disc.goal_version_no === 5, "机会发现任务钉在应用时的目标版本（v5）");
  const link = sqlite.prepare("SELECT * FROM task_object WHERE task_id = ?").all(disc.task_id);
  assert(link.length >= 1, "任务与启动对象（目标）已关联（LNK-04）");

  assert(/② 机会发现已执行/.test(text(dom, "#chain")) && text(dom, "#chain").includes(disc.task_id),
    "运行链 ② 显示机会发现已执行并带任务号");
  assert(/① 目标配置 v5 已登记/.test(text(dom, "#chain")), "运行链 ① 显示配置版本（版本可见）");
  assert(text(dom, "#six-note").includes("生效 v5"), "六要素说明的生效版本随之更新（不混期）");

  const session = JSON.parse(dom.window.localStorage.getItem(SESSION_KEY) || "{}");
  assert(session.applied && session.applied.goalId === Q3, "会话态记录「当前浏览目标」（会话态，不入库）");
}

/* ============================================================ ⑨ 前端不写库 / 业务数据不落前端存储 */
console.log("⑨ 前端不写库、业务数据不落前端持久存储（TC-C-M6-001 / TC-D-M6-001）");
{
  assert(calls.every((c) => c.path.startsWith("/api/")), `全部 ${calls.length} 次请求均经 /api/（无直连外部）`);
  const writes = calls.filter((c) => ["POST", "PATCH", "PUT", "DELETE"].includes(c.method));
  assert(writes.length >= 4, `写动作全部经 server/api 转发（实测 ${writes.length} 次，逐条：${writes.map((w) => w.method + " " + w.path.split("?")[0]).join("、")}）`);
  assert(!writes.some((w) => /\/api\/(query|verification-query|agent-delegations)/.test(w.path)),
    "未调用任何「生产查询 / 外部调用」类接口（硬红线：前端不发起任何生产写接口调用）");

  const raw = dom.window.localStorage.getItem(SESSION_KEY) || "{}";
  const keys = Object.keys(JSON.parse(raw));
  assert(keys.every((k) => ["applied", "navUnread"].indexOf(k) !== -1),
    `前端持久存储只含会话态键（实测 ${JSON.stringify(keys)}）`);
  assert(raw.indexOf("business_goal") === -1 && raw.indexOf("提升京东超市") === -1,
    "六要素等**业务数据不在前端存储**里（业务数据只存服务端）");

  const before = countRows(sqlite, "research_goal");
  const dom2 = loadPage("pages/goal.html", { fetcher: makeFetcher(db, []), session: JSON.parse(raw) });
  await waitFor(() => dom2.window.document.getElementById("goal-select").options.length > 1);
  assert(countRows(sqlite, "research_goal") === before,
    `仅打开页面不改库（目标数 ${before} 不变：读操作零写）`);
  const defaultGoal = dom2.window.document.getElementById("goal-select").value;
  assert(defaultGoal === Q3, `会话态在跨页面重载后仍生效（默认目标＝${defaultGoal}）`);
}

/* ============================================================ ⑩ 前后端分离判断（TC-I-M6-007） */
console.log("⑩ 前后端分离：删掉 frontend/ 后 server/api 与 db 仍独立可用");
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
  assert(refs.length === 0, `server/ + db/ + scripts/ 的 ${runtime.length} 个运行期文件零引用 frontend（实测命中 ${refs.length}${refs.length ? "：" + refs.map(rel).join(",") : ""}）`);

  const imports = runtime.filter((f) => /\.(js|mjs)$/.test(f) && /from\s+"[^"]*frontend/.test(readFileSync(f, "utf8")));
  assert(imports.length === 0, "无任何服务端模块 import 前端文件（不存在反向依赖）");

  // 不经前端、直接以任意客户端调 API：接口独立可用
  const raw = [];
  for (const [method, p] of [["GET", "/api/goals"], ["GET", "/api/goals/" + Q3], ["GET", "/api/opportunities?goal_id=" + Q3]]) {
    const res = await worker.fetch(new Request("http://localhost" + p, { method }), { DB: db });
    raw.push({ p, status: res.status });
  }
  assert(raw.every((r) => r.status === 200), `直接调用接口（不经前端）全部 200（实测 ${raw.map((r) => r.p + "→" + r.status).join("、")}）`);
  assert(!frontendFiles().some((f) => /\.json$/.test(f)), "前端不携带任何数据快照文件（无 mock 数据副本）");
}

/* ============================================================ ⑪ 空库引导（2026-09-21 实测回归）
 * 用户实测踩坑：空系统（零目标）下初始停在「已有目标」分支且 curId 为空，
 * 编辑后点保存打出 POST /api/goals//versions → 服务端「saveGoalVersion：goal_id 必填」。
 * 修复：pageInit 空库自动进入「新建目标」态（isNew=true）＋ 保存/编辑前置守卫 ＋ 下拉占位项。
 * 本节用**无种子的纯 DDL 空库**复现该场景并验证走新建路径。 */
console.log("⑪ 空库引导：自动进入新建目标态，保存走 registerGoal（旧缺陷路径不复现）");
{
  // 空库＝纯 DDL + **仅字典行**（业务服务端校验依赖 dict 值域，字典属平台配置非业务数据；
  // 目标/任务/查询等业务行一律不灌，等效「零目标的全新系统」）。
  const empty = new DatabaseSync(":memory:");
  empty.exec(readFileSync(DDL_PATH, "utf8"));
  empty.exec(readFileSync(SEED_PATH, "utf8").split("\n").filter((l) => /^INSERT INTO dict_(type|item) /.test(l)).join("\n"));
  const edb = d1From(empty);
  const ecalls = [];
  const edom = loadPage("pages/goal.html", { fetcher: makeFetcher(edb, ecalls) });
  const ready = await waitFor(() => /新建目标/.test(text(edom, "#select-note")));
  assert(ready, "空库自动进入「新建目标」态（pageInit 空库兜底，无需手动选「＋ 新增六要素」）");
  assert(countRows(empty, "research_goal") === 0, "前置：空库零目标（纯 DDL，未载种子）");

  const eopts = [...edom.window.document.getElementById("goal-select").options];
  assert(eopts.length === 1 && eopts[0].value === "__new__",
    `下拉仅「＋ 新增六要素」一项（实测 ${eopts.length} 项${eopts[0] ? "，value=" + eopts[0].value : ""}）`);

  // 点「编辑」不被守卫拦截（isNew 已为 true），填写后保存应走新建路径
  click(edom, "btn-edit");
  const doc = edom.window.document;
  const bg = doc.querySelector('[data-field="business_goal"]');
  assert(!!bg && bg.style.display !== "none", "编辑态六要素输入框可见");
  bg.value = "提升冷冻品类 90 天复购率";
  doc.getElementById("change-note").value = "首次登记";
  click(edom, "btn-save");
  const saved = await waitFor(() => /已登记目标/.test(text(edom, "#action-note")));
  assert(saved, `空库直接保存成功：走新建路径并提示「已登记目标」（实测提示：${text(edom, "#action-note").slice(0, 60)}…）`);
  assert(countRows(empty, "research_goal") === 1 && countRows(empty, "research_goal_version") === 1,
    `落库：目标 1 行 + 版本 v1 一行（实测 ${countRows(empty, "research_goal")}/${countRows(empty, "research_goal_version")}）`);
  assert(!ecalls.some((c) => c.path === "/api/goals//versions"),
    `零调用 POST /api/goals//versions（旧缺陷路径不复现；实测 goal 相关写调用：${
      ecalls.filter((c) => c.method === "POST" && c.path.startsWith("/api/goals")).map((c) => c.path).join(",") || "仅 /api/goals"
    }）`);
}

finish();
