#!/usr/bin/env node
/**
 * 文档卡（chore · `scripts/` 引用自检脚本「孤儿 / 悬空 / 重号」· 2026-09-19）
 * 上游：`../AGENTS.md`（宪法：一条硬红线「每份产物建立双向引用，拒绝孤儿文件」｜编号体系「编号是主键，
 *       文件名只是载体」｜索引三层｜目录索引 `scripts/`＝引用自检脚本（孤儿/悬空/重号），原状态「待建」）
 *   ｜ `../docs/03-locks/tech-stack.md`（§6 工程结构：`scripts/`＝引用自检脚本（孤儿/悬空/重号），
 *       「纯本地脚本，可跑在 CI」；§2 目录名不得改）
 *   ｜ `../docs/05-test-cases/README.md` + `../docs/05-test-cases/00-索引.md`
 *       （§4 声明「可执行断言脚本骨架归 `scripts/tests/`，本步未出」——本脚本的自检骨架即落在该目录）
 *   ｜ `../docs/07-decisions/DEC-PACK-001.md` §5.2（`OPP-015` 悬空引用前例：悬空引用须登记并上报，不擅自改）
 * 职责：纯本地静态自检，三类命中「孤儿 / 悬空 / 重号」，任一命中非 0 即退出码 1（供 CI 与本地交付门禁）。
 * 边界（严格只做引用自检）：不校验 SQL 可应用（归 `wrangler d1 migrations`）、不校验代码可运行
 *   （归各 F-xx 的 `test-fxx.mjs`）、不校验业务口径（归 `docs/03-locks/schema.md`）。
 *
 * 三类判定口径（本文件是这三类的唯一可执行定义，改动须同步 `./README.md`）：
 *   1. 悬空 dangling：文本里出现的**带目录层级**的相对路径（Markdown 链接目标或反引号路径），
 *      既不在「相对本文件目录」解析命中，也不在「相对仓库根」解析命中 → 命中。
 *      不含层级的裸文件名（如 `index.js`）只算「提及」，不参与悬空判定。
 *   2. 孤儿 orphan：受检产物文件的**文件名**在**其它任何受检文件**的正文中均未出现（即无人引用、
 *      也未登记进任何 README/索引）→ 命中。README/AGENTS/CI/配置类文件不参与孤儿判定（它们是索引的发起方）。
 *   3. 重号 duplicate：同一文件内，同一编号（F-xx/REQ-xx/R-xxx/S-Ax/S-Bx/PRD-Mx/ADR-xxx/TS-xx/T-xx/
 *       DS-xx/Q-xx/MD-xx/CFG-xx/EXT-xx/LNK-xx/PD-xx/TC-x-xx-xxx）出现在 **≥2 个「登记行」**
 *      （表格首列 / 列表项起始 / 标题）→ 命中。跨文件引用同一编号属正常，不算重号。
 *
 * 已知豁免走 `./ref-check-allowlist.json`：每条须带 `reason` + `registered_at` + `todo`，
 * 命中后单列「已登记豁免」，不计入失败——沿用本项目「已知缺口先登记、不擅自改」的惯例。
 *
 * 反向清单：被 `.github/workflows/ci.yml`（validate 步骤）与本地交付自检引用；
 *   自检骨架 `./tests/test-ref-check.mjs`；登记 `./README.md` 与 `../AGENTS.md`（`scripts/` 状态位）。
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(HERE, "..");

/** 扫描范围：仅这些扩展名参与（含文档卡与路由注释里的引用）。 */
const SCAN_EXT = new Set([".md", ".js", ".mjs", ".sql", ".yml", ".toml", ".py", ".html", ".css"]);
/** 路径候选的扩展名白名单（裸文件名不参与悬空判定，仅算提及）。 */
const PATH_EXT = new Set([
  ".md", ".js", ".mjs", ".sql", ".json", ".yml", ".toml", ".py", ".html", ".css", ".txt", ".jsonl",
]);
/** 整棵子树排除：`.trash/` 旧版本受「只移不删」保留，其引用指向旧结构；`db/probes/` 为行为实测留证产物。 */
const EXCLUDE_DIRS = new Set([".git", ".wrangler", "node_modules", ".kilo", ".trash", ".workbuddy"]);
/** 前缀排除：`db/probes/` 留证产物；`scripts/tests/` 内含夹具路径字面量（测试数据，不是真实引用）。 */
const EXCLUDE_PREFIXES = ["db/probes/", "scripts/tests/"];
/** 不参与「孤儿」判定的索引/配置类文件（它们是引用的发起方，不被别人引用属正常）。 */
const ORPHAN_SKIP = new Set(["AGENTS.md", ".gitignore", "wrangler.toml", "ci.yml"]);
const ORPHAN_SKIP_RE = /(?:^|\/)README\.md$/;

/** 编号体系（宪法「编号是主键」）：这些编号若在同一文件登记两次即为重号。 */
const ID_PATTERNS = [
  /\bF-\d{2}\b/g, /\bREQ-\d{2}\b/g, /\bR-\d{3}\b/g, /\bS-[AB]\d\b/g, /\bPRD-M\d\b/g,
  /\bADR-\d{3}\b/g, /\bTS-\d{2}\b/g, /\bT-\d{2}\b/g, /\bDS-\d{2}\b/g, /\bQ-\d{2}\b/g,
  /\bMD-\d{2}\b/g, /\bCFG-\d{2}\b/g, /\bEXT-\d{2}\b/g, /\bLNK-\d{2}\b/g, /\bPD-\d{2}\b/g,
  /\bTC-[A-Z]-[A-Z]\d-\d{3}\b/g,
];

// ---------------------------------------------------------------- 参数

function parseArgs(argv) {
  const args = { root: DEFAULT_ROOT, json: false, strict: false, allowlist: path.join(HERE, "ref-check-allowlist.json") };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--root") args.root = path.resolve(argv[++i]);
    else if (a === "--allowlist") args.allowlist = path.resolve(argv[++i]);
    else if (a === "--json") args.json = true;
    else if (a === "--strict") args.strict = true;
    else if (a === "--help" || a === "-h") args.help = true;
  }
  return args;
}

// ---------------------------------------------------------------- 扫描

function walkGeneric(root, accept) {
  const out = [];
  const stack = [""];
  while (stack.length) {
    const relDir = stack.pop();
    const absDir = path.join(root, relDir);
    for (const ent of readdirSync(absDir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (ent.isDirectory()) {
        if (EXCLUDE_DIRS.has(ent.name)) continue;
        if (ent.name.startsWith(".") && ent.name !== ".github") continue;
        if (EXCLUDE_PREFIXES.some((p) => `${rel}/`.startsWith(p))) continue;
        stack.push(rel);
        continue;
      }
      if (ent.isFile() && accept(ent.name)) out.push(rel);
    }
  }
  return out.sort();
}

const walk = (root) => walkGeneric(root, (n) => SCAN_EXT.has(path.extname(n)));
const walkAll = (root) => walkGeneric(root, () => true);

// ---------------------------------------------------------------- 悬空

/** 从一行文本里抽出路径候选（Markdown 链接目标 + 反引号内路径）。 */
function extractPathCandidates(line) {
  const found = [];
  for (const m of line.matchAll(/\]\(([^)\s]+)\)/g)) found.push(m[1]);
  for (const m of line.matchAll(/`([^`\n]+)`/g)) found.push(m[1]);
  return found;
}

function isPathCandidate(s) {
  if (!s || s.includes("://")) return false;
  if (/[*?<>{}|$~]/.test(s)) return false; // 通配符 / 占位符 / 模板串 / 范围简写（如 `S-A1~S-A4.md`），不作路径
  if (/\s/.test(s)) return false; // 含空格的多半是命令（如 `node --check x.js`），不作路径
  if (s.startsWith("#")) return false;
  return true;
}

/** 剥掉前导 `./` `../`，用于「相对仓库根」的兜底解析。 */
function stripDots(cand) {
  let s = cand;
  while (s.startsWith("./") || s.startsWith("../")) s = s.replace(/^\.{1,2}\//, "");
  return s;
}

function normalizeCandidate(s) {
  return s.replace(/^<|>$/g, "").split("#")[0].split("?")[0].trim();
}

/**
 * 悬空判定（两级）：
 *   硬悬空 dangling —— 相对本文件目录、相对仓库根都解析不到，**且仓库内不存在同名文件**（查无所指）→ 失败。
 *   软偏差 imprecise —— 解析不到但仓库内存在同名文件（能找到，只是写得不严谨）→ 默认仅列出，
 *       加 `--strict` 才计入失败。待建目录 / 目录引用 / 无扩展名片段不参与本判定。
 */
function scanDangling(root, files, allBasenames, strict) {
  const hits = [];
  for (const rel of files) {
    const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
    const base = path.dirname(rel);
    lines.forEach((line, idx) => {
      for (const raw of extractPathCandidates(line)) {
        if (!isPathCandidate(raw)) continue;
        const cand = normalizeCandidate(raw);
        if (!cand || !cand.includes("/")) continue; // 裸文件名只算提及
        const ext = path.extname(cand);
        if (!PATH_EXT.has(ext)) continue; // 目录引用 / 无扩展名片段不判悬空
        const viaFile = path.resolve(root, base, cand);
        const viaRoot = path.resolve(root, stripDots(cand));
        if (existsSync(viaFile)) continue; // 相对本文件精确命中
        if (existsSync(viaRoot)) continue; // 相对仓库根命中——本项目主流写法即「相对仓库根简写」，视为命中
        const note = "仓库内有同名文件但在别处（路径写错了）";
        if (!allBasenames.has(path.basename(cand))) hits.push({ kind: "dangling", file: rel, line: idx + 1, target: cand });
        else if (strict) hits.push({ kind: "dangling", file: rel, line: idx + 1, target: cand, note });
        else hits.push({ kind: "imprecise", file: rel, line: idx + 1, target: cand, note });
      }
    });
  }
  return hits;
}

// ---------------------------------------------------------------- 孤儿

function scanOrphans(root, files) {
  const contents = new Map(files.map((f) => [f, readFileSync(path.join(root, f), "utf8")]));
  const hits = [];
  for (const rel of files) {
    const name = path.basename(rel);
    if (ORPHAN_SKIP.has(name) || ORPHAN_SKIP_RE.test(rel)) continue;
    let mentioned = false;
    for (const [other, text] of contents) {
      if (other === rel) continue;
      if (text.includes(name)) { mentioned = true; break; }
    }
    if (!mentioned) hits.push({ kind: "orphan", file: rel, target: name });
  }
  return hits;
}

// ---------------------------------------------------------------- 重号

/**
 * 重号判定：同一编号的「主键位」在同一文件内出现 ≥2 次。主键位分两类，各自独立计数——
 *   A. 同一**表格块**内，该编号作为首列出现 ≥2 次（两行抢同一个编号）；
 *   B. 同一文件内，该编号出现在 ≥2 个**列表项起始位**（`- Q-08 …`）。
 * 不参与判定的常规写法（实测本项目普遍如此，误报已排除）：
 *   标题复述编号（`## 1. Q-03 …` 与文件标题 `# …（Q-03 / Q-04）` 并存）、
 *   「索引表一行 + 本体一节」（索引是指针、本体是定义）、非 Markdown 文件的注释行。
 */
function collectIds(text) {
  const ids = new Set();
  for (const re of ID_PATTERNS) for (const m of text.matchAll(re)) ids.add(m[0]);
  return ids;
}

function firstCell(line) {
  const m = /^\s*\|\s*([^|]*)\|/.exec(line);
  if (!m) return null;
  return m[1].replace(/[`*]/g, "").trim();
}

function scanDuplicates(root, files) {
  const hits = [];
  for (const rel of files) {
    const lines = readFileSync(path.join(root, rel), "utf8").split("\n");
    const ids = collectIds(lines.join("\n"));

    // A. 逐表格块统计首列
    const rowMap = new Map(); // id -> 行号数组（只在「同一表格块」内累计）
    let curBlock = null;
    lines.forEach((line, i) => {
      if (/^\s*\|/.test(line)) {
        if (!curBlock) curBlock = new Map();
        const cell = firstCell(line);
        if (cell) {
          for (const id of ids) {
            if (cell === id || cell.startsWith(`${id} `) || cell.startsWith(`${id}（`)) {
              if (!curBlock.has(id)) curBlock.set(id, []);
              curBlock.get(id).push(i + 1);
            }
          }
        }
      } else if (curBlock) {
        for (const [id, ln] of curBlock) if (ln.length >= 2) merge(rowMap, id, ln);
        curBlock = null;
      }
    });
    if (curBlock) for (const [id, ln] of curBlock) if (ln.length >= 2) merge(rowMap, id, ln);

    // B. 列表项起始位（仅 Markdown：非 .md 的 `#` 行是代码注释，不算登记）
    const listMap = new Map();
    if (rel.endsWith(".md")) {
      lines.forEach((line, i) => {
        if (!/^\s*[-*+]\s/.test(line)) return;
        for (const id of ids) {
          // 反引号包裹的是「引用」，裸写或加粗的才是「登记」
          if (new RegExp(`^\\s*[-*+]\\s+(\\*\\*)?${id.replace(/-/g, "\\-")}\\b`).test(line)) merge(listMap, id, [i + 1]);
        }
      });
    }

    for (const id of [...ids].sort()) {
      const where = [];
      if (rowMap.get(id)?.length >= 2) where.push(`表格首列 L${rowMap.get(id).join(", L")}`);
      if (listMap.get(id)?.length >= 2) where.push(`列表项 L${listMap.get(id).join(", L")}`);
      if (where.length) hits.push({ kind: "duplicate", file: rel, target: id, where });
    }
  }
  return hits;
}

function merge(map, key, arr) {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(...arr);
}

// ---------------------------------------------------------------- 豁免

function loadAllowlist(p) {
  if (!p || !existsSync(p)) return [];
  const text = readFileSync(p, "utf8").trim();
  if (!text) return [];
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) throw new Error(`豁免清单须为数组：${p}`);
  return parsed;
}

function matchAllowlist(entry, hit) {
  return (
    entry.kind === hit.kind &&
    (!entry.file || entry.file === hit.file) &&
    (!entry.target || entry.target === hit.target)
  );
}

// ---------------------------------------------------------------- 主流程

export function runCheck({ root = DEFAULT_ROOT, allowlistPath, strict = false } = {}) {
  const files = walk(root);
  const allBasenames = new Set(walkAll(root).map((f) => path.basename(f)));
  const refs = scanDangling(root, files, allBasenames, strict);
  const raw = {
    dangling: refs.filter((h) => h.kind === "dangling"),
    imprecise: refs.filter((h) => h.kind === "imprecise"),
    orphan: scanOrphans(root, files),
    duplicate: scanDuplicates(root, files),
  };
  const allow = loadAllowlist(allowlistPath);
  const out = { dangling: [], imprecise: [], orphan: [], duplicate: [], waived: [] };
  for (const kind of Object.keys(raw)) {
    for (const hit of raw[kind]) {
      const waive = allow.find((e) => matchAllowlist(e, hit));
      if (waive) out.waived.push({ ...hit, reason: waive.reason, registered_at: waive.registered_at, todo: waive.todo });
      else out[kind].push(hit);
    }
  }
  const total = out.dangling.length + out.orphan.length + out.duplicate.length
    + (strict ? out.imprecise.length : 0);
  return { root, scanned: files.length, strict, ...out, total, pass: total === 0 };
}

export function formatReport(r) {
  const L = [];
  L.push(`引用自检（孤儿 / 悬空 / 重号） root=${r.root}${r.strict ? " [strict]" : ""}`);
  L.push(`扫描文件：${r.scanned}`);
  for (const [kind, label] of [["dangling", "悬空引用"], ["orphan", "孤儿文件"], ["duplicate", "重号登记"]]) {
    L.push(`[${label}] ${r[kind].length} 命中`);
    for (const h of r[kind]) {
      if (kind === "duplicate") L.push(`  - ${h.file}  ${h.target} 重复登记：${h.where.join("｜")}`);
      else if (kind === "orphan") L.push(`  - ${h.file}（文件名 ${h.target} 未被任何受检文件提及）`);
      else L.push(`  - ${h.file}:${h.line}  ${h.target} → 仓库内无同名文件`);
    }
  }
  L.push(`[软偏差·路径不精确] ${r.imprecise.length} 条（同名文件存在但相对路径解析不到${r.strict ? "；strict 计入失败" : "，不计入失败"}）`);
  for (const h of r.imprecise) L.push(`  - ${h.file}:${h.line}  ${h.target}（${h.note}）`);
  L.push(`[已登记豁免] ${r.waived.length} 条（不计入失败）`);
  for (const w of r.waived) L.push(`  - ${w.kind} ${w.file} ${w.target || ""}｜${w.reason}（登记 ${w.registered_at}；待办：${w.todo}）`);
  L.push(`合计：${r.total} 命中 → ${r.pass ? "PASS" : "FAIL"}`);
  return L.join("\n");
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isCli) {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log("用法: node scripts/ref-check.mjs [--root <dir>] [--allowlist <file>] [--strict] [--json]");
    process.exit(0);
  }
  const r = runCheck({ root: args.root, allowlistPath: args.allowlist, strict: args.strict });
  console.log(args.json ? JSON.stringify(r, null, 2) : formatReport(r));
  process.exit(r.pass ? 0 : 1);
}
