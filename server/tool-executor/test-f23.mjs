#!/usr/bin/env node
/**
 * 文档卡（阶段2 · M5 · F-23 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M5.md`（**TC-D-M5-001 / TC-D-M5-002 / TC-D-M5-003 / TC-D-M5-004 /
 *        TC-I-M5-001 / TC-I-M5-005 = F-23 验收 oracle**）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md` F-23（权限分支互斥；不允许时保存原因并返回受限原因）
 *   ｜ `../../docs/03-locks/schema.md` CFG-02（PK/UK tool_code/source_id FK）、CFG-03（tool_id FK、allow_flag 互斥、
 *        restrict_reason、有效期）、CFG-04（goal_id 可空 FK）、CFG-05（rule_id PK）、CFG-01（is_mcp_ready/availability_status）
 *   ｜ `../../docs/03-locks/external-deps.md` §5（12 工具 TOL-01~12；TOL-12「不存在」；TOL-11 降级）+ §6.2（403 受限映射）
 *   ｜ `../../db/migrations/0001_init.sql` L49-92（CFG-02/03/04/05）
 *   ｜ `../../db/seed/0001_mock.sql`（CFG-02 12 行 / CFG-03 24 行 / CFG-05 4 行 / CFG-01 5 行：ACT=degraded+mcp_ready=0）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-23 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 值不进断言**（只断结构与语义，不断言具体响应数值）。
 * 门禁：`external-deps.md` §7 未关——带 `*` 的 `tool_code` 为 demo 占位，本执行器**不把任何 demo 数值写进断言**。
 * 边界：只验 F-23；真实调用（F-24）、`EXT-01` 落痕（F-25）、重试与暂停（F-26）不在本执行器范围。
 * 反向清单：登记 `../README.md` 与本目录 `README.md`；被 CI `validate` 步骤复用（`node server/tool-executor/test-f23.mjs`）。
 *
 * 用法：node server/tool-executor/test-f23.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  registerTool,
  getTool,
  getToolByCode,
  listTools,
  registerPermission,
  listPermissions,
  checkToolPermission,
  checkToolPermissions,
} from "./index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const SRC_PATH = new URL("./index.js", import.meta.url);

/** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      try {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      } catch (e) {
        return { success: false, error: String(e.message || e) };
      }
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

/** 建库：载入真实 DDL +（可选）真实种子；种子自带 FK pragma，先剥离再载入，之后开 FK。 */
function freshDb({ seed = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  if (seed) {
    const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
    sqlite.exec(mock);
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}

// ============================================================ TC-D-M5-001 CFG-02 约束
console.log("TC-D-M5-001 · CFG-02 tool_registry：重复 tool_id / tool_code（DDL L50/57）");
{
  const { sqlite, db } = freshDb({ seed: false });
  const base = {
    tool_id: "TOL-01", tool_code: "cdp.crowd.query", tool_name: "人群圈选与规模查询",
    source_id: "CDP", tool_purpose: "取某人群规模", call_condition: "业务范围已明确", is_enabled: 1,
  };
  sqlite.exec("INSERT INTO source_registry (source_id, source_name, capability_can, capability_cannot, availability_status, is_mcp_ready, registered_at, updated_at) VALUES ('CDP','CDP','can','cannot','ok',1,'2026-01-01 00:00','2026-01-01 00:00');");

  assert((await listTools(db)).length === 0, "基线：未登记时 0 行");
  await registerTool(db, base);
  assert((await getTool(db, "TOL-01")) !== null, "正：登记成功");

  const dupPk = await db.prepare("INSERT INTO tool_registry (tool_id, tool_code, tool_name, source_id, tool_purpose, call_condition, is_enabled) VALUES (?,?,?,?,?,?,?)")
    .bind("TOL-01", "cdp.other", "重名", "CDP", "p", "c", 1).run();
  assert(dupPk.success === false && /UNIQUE|PRIMARY/i.test(dupPk.error), "反①：重复 tool_id 被 PK 拒绝");

  const dupUk = await db.prepare("INSERT INTO tool_registry (tool_id, tool_code, tool_name, source_id, tool_purpose, call_condition, is_enabled) VALUES (?,?,?,?,?,?,?)")
    .bind("TOL-99", "cdp.crowd.query", "重码", "CDP", "p", "c", 1).run();
  assert(dupUk.success === false && /UNIQUE/i.test(dupUk.error), "反②：重复 tool_code 被 UNIQUE 拒绝");

  const nullPk = await db.prepare("INSERT INTO tool_registry (tool_id, tool_code, tool_name, source_id, tool_purpose, call_condition, is_enabled) VALUES (?,?,?,?,?,?,?)")
    .bind(null, "cdp.null", "空主键", "CDP", "p", "c", 1).run();
  assert(nullPk.success === false, "反③：tool_id 为 NULL 被拒绝");

  const badFk = await db.prepare("INSERT INTO tool_registry (tool_id, tool_code, tool_name, source_id, tool_purpose, call_condition, is_enabled) VALUES (?,?,?,?,?,?,?)")
    .bind("TOL-98", "cdp.bad", "坏来源", "NOPE", "p", "c", 1).run();
  assert(badFk.success === false && /FOREIGN/i.test(badFk.error), "反④：source_id 不存在被 FK 拒绝");
}

console.log("TC-D-M5-001 · 正：12 工具（TOL-01~12）种子齐全（demo 名不进断言，只断数量与归属）");
{
  const { db } = freshDb();
  const tools = await listTools(db);
  assert(tools.length === 12, `种子 12 行（实测 ${tools.length}）`);
  assert(tools.every((t) => /^TOL-\d{2}$/.test(t.tool_id)), "tool_id 形如 TOL-xx");
  assert(new Set(tools.map((t) => t.tool_code)).size === 12, "tool_code 互不重复");
  const bySrc = {};
  for (const t of tools) bySrc[t.source_id] = (bySrc[t.source_id] || 0) + 1;
  assert(bySrc.CDP === 3 && bySrc.HJE === 3 && bySrc.PIM === 2 && bySrc.MKT === 2 && bySrc.ACT === 2,
    "五系统归属：CDP3 / HJE3 / PIM2 / MKT2 / ACT2");
  assert((await getToolByCode(db, "act.enroll.detail"))?.tool_id === "TOL-12", "TOL-12（不存在的工具）已如实登记在册");
}

// ============================================================ TC-D-M5-002 CFG-03 FK
console.log("TC-D-M5-002 · CFG-03 tool_permission.tool_id='TOL-NOPE'（DDL L65）");
{
  const { db } = freshDb();
  const bad = await db.prepare("INSERT INTO tool_permission (permission_id, grantee_type, grantee_ref, tool_id, allow_flag, restrict_reason, effective_from, effective_until) VALUES (?,?,?,?,?,?,?,?)")
    .bind("PERM-X", "agent", "discovery-agent", "TOL-NOPE", 1, null, "2026-07-01 00:00", null).run();
  assert(bad.success === false && /FOREIGN/i.test(bad.error), "反：权限须指向已注册工具，FK 拒绝");

  const ok = await registerPermission(db, {
    permission_id: "PERM-TEST", grantee_type: "agent", grantee_ref: "discovery-agent",
    tool_id: "TOL-01", allow_flag: 1, restrict_reason: null,
  });
  assert(ok !== null && ok.permission_id === "PERM-TEST", "正：指向已注册工具可登记");
  assert((await listPermissions(db, { tool_id: "TOL-01" })).length >= 1, "正：可按工具查授权记录");
}

// ============================================================ TC-D-M5-003 CFG-04
console.log("TC-D-M5-003 · CFG-04 run_policy.goal_id（DDL L76）");
{
  const { db } = freshDb();
  const bad = await db.prepare("INSERT INTO run_policy (policy_id, policy_scope, goal_id, run_frequency, max_duration_min, call_limit, retry_limit, is_active) VALUES (?,?,?,?,?,?,?,?)")
    .bind("POL-X", "goal", "GOAL-NOPE", "每日 02:00", 60, 100, 3, 1).run();
  assert(bad.success === false && /FOREIGN/i.test(bad.error), "反：目标级策略 goal_id 不存在被 FK 拒绝");

  const plat = await db.prepare("INSERT INTO run_policy (policy_id, policy_scope, goal_id, run_frequency, max_duration_min, call_limit, retry_limit, is_active) VALUES (?,?,?,?,?,?,?,?)")
    .bind("POL-NEW", "platform", null, "每日 02:00", 60, 100, 3, 1).run();
  assert(plat.success === true, "正：平台级 goal_id=NULL 允许（DDL 可空）");
}

// ============================================================ TC-D-M5-004 CFG-05
console.log("TC-D-M5-004 · CFG-05 gap_rule 重复 rule_id（DDL L86）");
{
  const { db } = freshDb();
  const dup = await db.prepare("INSERT INTO gap_rule (rule_id, target_field, match_pattern, gap_text, impact_note, is_active) VALUES (?,?,?,?,?,?)")
    .bind("GAP-1", "scope", "x", "y", "z", 1).run();
  assert(dup.success === false && /UNIQUE|PRIMARY/i.test(dup.error), "反：重复 rule_id 被 PK 拒绝");
  const rules = (await db.prepare("SELECT * FROM gap_rule ORDER BY rule_id").all()).results;
  assert(rules.length === 4, `正：4 条口径规则 GAP-1~4（实测 ${rules.length}）`);
}

// ============================================================ TC-I-M5-001 权限分支互斥
console.log("TC-I-M5-001 · 权限分支互斥（允许 → 执行；不允许 → 受限 + 原因，不静默放行）");
{
  const { db } = freshDb();
  const G = { grantee_type: "agent", grantee_ref: "discovery-agent" };
  const AT = "2026-09-19 12:00";

  // ① 种子现状：12 工具 is_enabled 全 0（外部依赖 §5「未接入/不存在」的如实登记）→ 一律受限，不静默放行
  const all = await listTools(db);
  assert(all.length === 12 && all.every((t) => t.is_enabled === 0), "种子现状：12 工具均未启用（如实登记外部依赖未接入）");
  const r0 = await checkToolPermission(db, { tool_id: "TOL-01", ...G, at: AT });
  assert(r0.allowed === false && r0.decision === "restricted" && r0.reason_code === "tool_disabled",
    "未启用 → 受限（tool_disabled），非静默放行");
  assert(typeof r0.restrict_reason === "string" && r0.restrict_reason.length > 0, "受限必带原因（restrict_reason 非空）");

  // ② 造正例：启用 TOL-01（CDP 已 ok + mcp_ready）→ 有授权记录 → 允许
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = 'TOL-01'").run();
  const allow = await checkToolPermission(db, { tool_id: "TOL-01", ...G, at: AT });
  assert(allow.allowed === true && allow.decision === "allowed", "启用 + 已授权 → 允许");
  assert(allow.restrict_reason === null && allow.reason_code === null, "允许分支不带受限原因（互斥）");
  assert(allow.source?.source_id === "CDP" && allow.limits.length === 0, "允许时回带来源；CDP 正常无限制提示");

  // ③ 来源未 MCP 化（ACT）：即便工具启用也拒绝
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = 'TOL-11'").run();
  const act = await checkToolPermission(db, { tool_id: "TOL-11", ...G, at: AT });
  assert(act.allowed === false && act.reason_code === "source_not_mcp_ready", "ACT 未 MCP 化 → 受限（source_not_mcp_ready）");

  // ④ 无匹配授权记录 → 受限
  const noPerm = await checkToolPermission(db, { tool_id: "TOL-01", grantee_type: "agent", grantee_ref: "nobody-agent", at: AT });
  assert(noPerm.allowed === false && noPerm.reason_code === "no_permission", "授权对象无匹配记录 → 受限（no_permission）");

  // ⑤ 授权记录明确不允许 → 受限，且原样带出 restrict_reason
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = 'TOL-02'").run();
  await registerPermission(db, {
    permission_id: "PERM-DENY", grantee_type: "agent", grantee_ref: "discovery-agent",
    tool_id: "TOL-02", allow_flag: 0, restrict_reason: "超出目标业务范围", effective_from: "2026-07-01 00:00",
  });
  const denied = await checkToolPermission(db, { tool_id: "TOL-02", ...G, at: AT });
  assert(denied.allowed === false && denied.reason_code === "restricted", "allow_flag=0 → 受限");
  assert(denied.restrict_reason === "超出目标业务范围", "受限原因原样带出（不为空、不静默）");

  // ⑥ 有效期：effective_until 之前的时点允许，之后受限
  // 用独立授权对象（种子里 discovery-agent 对每个工具都有长期授权，会覆盖过期那条）
  await registerPermission(db, {
    permission_id: "PERM-EXPIRE", grantee_type: "agent", grantee_ref: "temp-agent",
    tool_id: "TOL-03", allow_flag: 1, effective_from: "2026-07-01 00:00", effective_until: "2026-08-01 00:00",
  });
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = 'TOL-03'").run();
  const T = { grantee_type: "agent", grantee_ref: "temp-agent" };
  const inWin = await checkToolPermission(db, { tool_id: "TOL-03", ...T, at: "2026-07-15 00:00" });
  const outWin = await checkToolPermission(db, { tool_id: "TOL-03", ...T, at: "2026-09-19 00:00" });
  assert(inWin.allowed === true, "有效期内 → 允许");
  assert(outWin.allowed === false && outWin.reason_code === "no_permission", "过期 → 受限（无有效授权）");

  // ⑦ 工具未登记
  const missing = await checkToolPermission(db, { tool_id: "TOL-NOPE", ...G, at: AT });
  assert(missing.allowed === false && missing.reason_code === "tool_not_found", "未登记工具 → 受限（tool_not_found）");

  // ⑧ 降级是「限制」不是「失败」：把 ACT 置为 mcp_ready + 启用，应允许但带限制提示
  await db.prepare("UPDATE source_registry SET is_mcp_ready = 1 WHERE source_id = 'ACT'").run();
  const degraded = await checkToolPermission(db, { tool_id: "TOL-11", ...G, at: AT });
  assert(degraded.allowed === true, "来源降级不阻断（degraded ≠ 失败）");
  assert(degraded.limits.length === 1 && /降级/.test(degraded.limits[0]), "降级作为「限制」随结果返回（供四要素之限制）");

  // ⑨ 批量判定：单条受限不影响其它条（实体级隔离，非整包失败）
  const batch = await checkToolPermissions(db, {
    tools: [{ tool_id: "TOL-01" }, { tool_id: "TOL-02" }, { tool_id: "TOL-NOPE" }], ...G, at: AT,
  });
  assert(batch.allowed.length === 1 && batch.restricted.length === 2, "批量：1 允许 / 2 受限，逐条独立判定");
}

// ============================================================ TC-I-M5-005 生产零写
console.log("TC-I-M5-005 · 生产零写：本模块只读判定，不实现/不调用任何写生产外部系统的接口");
{
  const src = readFileSync(SRC_PATH, "utf8");
  assert(!/^\s*(?:export\s+)?(?:async\s+)?function\s+(?:write|update|delete|create|post|put)\w*/im.test(src),
    "模块不导出任何写类外部接口（write/update/delete/create/post/put 开头的函数）");
  assert(!/\bfetch\s*\(|\bhttps?:\/\//.test(src), "模块不含任何外部 HTTP 调用（调用归 F-24）");
  assert(!/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/.test(src), "模块 SQL 无 UPDATE / DELETE / DROP / ALTER / TRUNCATE");
  assert(/INSERT INTO tool_registry|INSERT INTO tool_permission/.test(src) && !/INSERT INTO source_registry/.test(src),
    "仅登记本平台的 CFG-02 / CFG-03，不写外部系统");
}

console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} — 通过 ${pass} / 失败 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
