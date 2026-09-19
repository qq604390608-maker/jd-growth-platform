#!/usr/bin/env node
/**
 * 文档卡（chore · `scripts/` 引用自检脚本 · 自检骨架 · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：一条硬红线「双向引用，拒绝孤儿文件」｜编号体系｜`scripts/` 引用自检脚本（孤儿/悬空/重号））
 *   ｜ `../ref-check.mjs`（被自检对象；三类判定口径以其文档卡为准）
 *   ｜ `../../docs/05-test-cases/README.md` + `../../docs/05-test-cases/00-索引.md`
 *       （§4：「可执行断言脚本骨架归 `scripts/tests/`，本步未出」——本文件即该骨架的第一份）
 * 职责：用临时夹具（fixture）证明自检脚本本身可信——**能抓到**三类命中、**能放行**干净仓库、
 *   **豁免清单**生效、`--strict` 生效、退出码正确。不依赖仓库真实内容，故不受存量缺陷影响。
 * 边界：只验 `ref-check.mjs` 的判定与退出码；仓库真实跑数（0 命中）由 CI 步骤 `node scripts/ref-check.mjs` 承担。
 *
 * 反向清单：被 `.github/workflows/ci.yml`（validate 步骤）引用；登记 `../README.md`。
 *
 * 用法：node scripts/tests/test-ref-check.mjs
 */

import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHECKER = path.resolve(HERE, "..", "ref-check.mjs");
const NODE = process.execPath;

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

function run(root, extraArgs = []) {
  const r = spawnSync(NODE, [CHECKER, "--root", root, "--json", ...extraArgs], { encoding: "utf8" });
  if (r.status === null || r.error) throw new Error(`运行失败：${r.error?.message}`);
  const json = JSON.parse(r.stdout);
  return { ...json, exit: r.status };
}

/** 造一个「三类命中各一 + 一条软偏差」的夹具仓库。 */
function buildFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ref-check-"));
  mkdirSync(path.join(root, "nested"));
  const w = (rel, text) => writeFileSync(path.join(root, rel), text, "utf8");

  // 索引：提及除 orphan.md 之外的全部文件（README 自身不参与孤儿判定）
  w("README.md", [
    "# 夹具索引",
    "- `good.md` — 干净引用",
    "- `detail.md` — 被引用",
    "- `bad.md` — 悬空",
    "- `imprecise.md` — 软偏差",
    "- `dup.md` — 重号",
    "- `real.md` — 被引用",
  ].join("\n"));
  w("good.md", "# good\n\n见 `./detail.md`。\n");
  w("detail.md", "# detail\n\n正文。\n");
  w("bad.md", "# bad\n\n见 `./missing-xyz.md`。\n");
  w("imprecise.md", "# imprecise\n\n见 `nested/real.md`（real.md 实际在根）。\n");
  w("real.md", "# real\n\n正文。\n");
  w("dup.md", [
    "# dup",
    "",
    "| 编号 | 说明 |",
    "| ---- | ---- |",
    "| Q-01 | 第一次登记 |",
    "| Q-01 | 第二次登记（重号） |",
    "",
  ].join("\n"));
  w("orphan.md", "# orphan\n\n从未被任何文件提及。\n");
  return root;
}

/** 造一个零命中（干净）夹具：每个文件都被提及、引用都精确、登记都不重复。 */
function buildCleanFixture() {
  const root = mkdtempSync(path.join(tmpdir(), "ref-check-clean-"));
  const w = (rel, text) => writeFileSync(path.join(root, rel), text, "utf8");
  w("README.md", "# 干净索引\n\n- `a.md`\n- `b.md`\n");
  w("a.md", "# a\n\n见 `b.md` 与 `./sub/c.md`。\n");
  mkdirSync(path.join(root, "sub"));
  w("sub/c.md", "# c\n\n见 `../a.md`。\n");
  w("b.md", "# b\n\n| 编号 | 说明 |\n| ---- | ---- |\n| Q-01 | 唯一登记 |\n");
  return root;
}

console.log("用例 1：三类命中 + 软偏差，退出码 1");
{
  const root = buildFixture();
  const r = run(root, ["--allowlist", path.join(root, "__none.json")]);
  assert(r.exit === 1, "退出码为 1（有命中）");
  assert(r.pass === false, "pass=false");
  assert(r.dangling.length === 1 && r.dangling[0].file === "bad.md" && r.dangling[0].target === "./missing-xyz.md",
    "抓到 1 条悬空：bad.md → ./missing-xyz.md");
  assert(r.orphan.length === 1 && r.orphan[0].file === "orphan.md", "抓到 1 个孤儿：orphan.md");
  assert(r.duplicate.length === 1 && r.duplicate[0].target === "Q-01", "抓到 1 处重号：Q-01（同表格首列两次）");
  assert(r.imprecise.length === 1 && r.imprecise[0].file === "imprecise.md", "软偏差 1 条：imprecise.md");
  assert(r.waived.length === 0, "无豁免时 waived=0");
  assert(r.duplicate.every((h) => !h.where.some((s) => s.startsWith("标题"))), "重号不含标题类误判");

  console.log("用例 2：豁免清单生效");
  const allow = path.join(root, "allow.json");
  writeFileSync(allow, JSON.stringify([
    { kind: "dangling", file: "bad.md", target: "./missing-xyz.md", reason: "夹具豁免", registered_at: "2026-09-19", todo: "无" },
    { kind: "orphan", file: "orphan.md", target: "orphan.md", reason: "夹具豁免", registered_at: "2026-09-19", todo: "无" },
    { kind: "duplicate", file: "dup.md", target: "Q-01", reason: "夹具豁免", registered_at: "2026-09-19", todo: "无" },
  ]), "utf8");
  const r2 = run(root, ["--allowlist", allow]);
  assert(r2.dangling.length === 0 && r2.orphan.length === 0 && r2.duplicate.length === 0, "三类命中均被豁免");
  assert(r2.waived.length === 3, "waived=3");
  assert(r2.pass === true && r2.exit === 0, "豁免后 pass=true、退出码 0");

  console.log("用例 3：--strict 把软偏差计入失败");
  const r3 = run(root, ["--allowlist", allow, "--strict"]);
  assert(r3.dangling.length === 1 && r3.dangling[0].file === "imprecise.md", "strict 下 imprecise.md 计入悬空");
  assert(r3.exit === 1, "strict 下退出码 1");

  rmSync(root, { recursive: true, force: true });
}

console.log("用例 4：干净夹具零命中、退出码 0");
{
  const root = buildCleanFixture();
  const r = run(root, ["--allowlist", path.join(root, "__none.json")]);
  assert(r.dangling.length === 0, "悬空 0");
  assert(r.orphan.length === 0, "孤儿 0");
  assert(r.duplicate.length === 0, "重号 0（表格首列唯一 + 列表登记不被误判）");
  assert(r.imprecise.length === 0, "软偏差 0（相对路径均精确命中）");
  assert(r.pass === true && r.exit === 0, "pass=true、退出码 0");
  rmSync(root, { recursive: true, force: true });
}

console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} — 通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
