#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M3 · F-13 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M3.md（**TC-D-M3-001**（L3·F-13：MD-13 `agent_code` UNIQUE 拒绝重复）｜
 *        **TC-D-M3-002**（L3·F-13/F-16：MD-14 `S-A1`/`clue-scan`/`bound_agent_code=discovery-agent`，PK/UK/FK 三反例）｜
 *        **TC-C-M3-001**（L2·F-13：Agent 产出结构化 JSON，response_format=json_schema；⚠️ A-1 LLM 未提供 → 本执行器只验能力登记与版本管理，该 oracle 项登记为「门禁未关闭、非发布门禁」））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-13（角色指令配置）｜ ../../docs/02-prd/PRD-M3-机会发现Agent.md §1.1 / F-13
 *   ｜ ../../docs/03-locks/schema.md（MD-13 agent_profile、MD-14 skill_registry、§12 Q-07 已决 S-A1↔clue-scan↔AGP-DISC）
 *   ｜ ../../docs/03-locks/external-deps.md（A-3 指令加载与版本管理＝F-13/F-18/F-06/F-32；A-1 LLM ⬜ 未提供）
 *   ｜ ./profile.js（F-13 本体，MD-13/MD-14 唯一写入面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-13 用例并断言。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理，不挡本文件的配置与版本管理）；
 *   **demo 数值一律不进断言**，只断字段形态、UNIQUE/PK/UK/FK 约束、版本推进语义与快照串形态。
 * 边界：只验 F-13；business-rules.md 公共指令加载归后续；F-14~F-22 推理部分受 A-1 门禁未关闭限制，不在此实现。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f13.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f13.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  registerAgentProfile,
  getAgentProfile,
  bumpAgentProfileVersion,
  registerSkill,
  listAgentSkills,
  composeAgentVersionSnapshot,
} from "./profile.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const PROFILE_SRC = new URL("./profile.js", import.meta.url);

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

/** 建库：载入真实 DDL + 真实种子；种子自带 FK pragma，先剥离再载入，之后开 FK。 */
function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  sqlite.exec(mock);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
async function assertThrows(fn, label, match = null) {
  try {
    await fn();
    fail++; console.log(`  ✗ ${label}（未抛错）`);
  } catch (e) {
    const ok = !match || String(e.message).includes(match);
    if (ok) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}（错误信息不含「${match}」：${String(e.message)}）`); }
  }
}
const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==================================================== ① 读角色指令（MD-13 种子行，全字段形态）
console.log("① 读角色指令 · MD-13 种子行 `AGP-DISC`（discovery-agent）全字段形态");
{
  const { db } = freshDb();
  const p = await getAgentProfile(db, "discovery-agent");
  assert(p && p.profile_id === "AGP-DISC", "取到 AGP-DISC");
  assert(p.agent_code === "discovery-agent", "agent_code=discovery-agent");
  assert(p.agent_name === "机会发现 Agent", "agent_name=机会发现 Agent");
  assert(p.agent_stage === "M3", "agent_stage=M3");
  assert(p.current_version === "v1.2", "current_version=v1.2（种子值）");
  assert(p.doc_revision === "r9", "doc_revision=r9（种子值）");
  assert(Number(p.is_active) === 1, "is_active=1");
  const hva = await getAgentProfile(db, "hva-agent");
  assert(hva && hva.profile_id === "AGP-HVA" && hva.agent_stage === "M4", "hva-agent→AGP-HVA / M4");
  const none = await getAgentProfile(db, "no-such-agent");
  assert(none === null, "不存在的 agent_code → null（只读不报错）");
}

// ==================================================== ② 版本管理（MD-13 单行推进，不新建行）
console.log("\n② 版本管理 · `bumpAgentProfileVersion` 推进同 agent_code 单行版本号（不新建行）");
{
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "agent_profile");
  const changed = await bumpAgentProfileVersion(db, { agent_code: "discovery-agent", current_version: "v1.3", doc_revision: "r10" });
  assert(changed === 1, "影响 1 行");
  assert(countRows(sqlite, "agent_profile") === before, "行数不变（UNIQUE 单行，未新建）");
  const p = await getAgentProfile(db, "discovery-agent");
  assert(p.current_version === "v1.3" && p.doc_revision === "r10", "版本号已推进 v1.3 / r10");
  // 不存在的 agent_code → UPDATE 影响 0 行，不报错
  const zero = await bumpAgentProfileVersion(db, { agent_code: "no-such-agent", current_version: "v9.9", doc_revision: "r99" });
  assert(zero === 0, "不存在的 agent_code → 影响 0 行，不报错");
  assert(countRows(sqlite, "agent_profile") === before, "仍无新增行");
}

// ==================================================== ③ 注册 Skill（MD-14 新行成功）
console.log("\n③ 注册 Skill · `registerSkill` 插新 S-A2 绑 discovery-agent → 成功");
{
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "skill_registry");
  const r = await registerSkill(db, {
    skill_no: "S-A2", skill_code: "journey-clue", skill_name: "旅程线索归纳", version: "v1.0", bound_agent_code: "discovery-agent",
  });
  assert(r.success === true, "注册成功");
  assert(countRows(sqlite, "skill_registry") === before + 1, "skill_registry 行数 +1");
  const skills = await listAgentSkills(db, "discovery-agent");
  assert(skills.length === 2 && skills.some((s) => s.skill_no === "S-A2" && s.skill_code === "journey-clue"), "discovery-agent 现有 2 个生效 Skill（含 S-A2）");
  // 生效 Skill 仅含 is_active=1
  const hvaSkills = await listAgentSkills(db, "hva-agent");
  assert(hvaSkills.length === 1 && hvaSkills[0].skill_no === "S-B1", "hva-agent 仅 S-B1 生效");
}

// ==================================================== ④ MD-14 三反例（TC-D-M3-002）
console.log("\n④ TC-D-M3-002 · MD-14 三反例（PK / UK / FK）");
{
  const { db } = freshDb();
  await assertThrows(
    () => registerSkill(db, { skill_no: "S-A1", skill_code: "x-scan", skill_name: "X", version: "v1.0", bound_agent_code: "discovery-agent" }),
    "反①：重复 skill_no='S-A1' → PK 拒绝", "skill_registry.skill_no",
  );
  const { db: db2 } = freshDb();
  await assertThrows(
    () => registerSkill(db2, { skill_no: "S-A9", skill_code: "clue-scan", skill_name: "Y", version: "v1.0", bound_agent_code: "discovery-agent" }),
    "反②：重复 skill_code='clue-scan' → UK 拒绝", "skill_registry.skill_code",
  );
  const { db: db3 } = freshDb();
  await assertThrows(
    () => registerSkill(db3, { skill_no: "S-A9", skill_code: "x-scan", skill_name: "Z", version: "v1.0", bound_agent_code: "no-such-agent" }),
    "反③：错误 bound_agent_code='no-such-agent' → FK 失败", "FOREIGN KEY",
  );
}

// ==================================================== ⑤ MD-13 重复 agent_code UNIQUE 反例（TC-D-M3-001）
console.log("\n⑤ TC-D-M3-001 · MD-13 `agent_code='discovery-agent'` 重复 → UNIQUE 拒绝");
{
  const { db } = freshDb();
  await assertThrows(
    () => registerAgentProfile(db, {
      profile_id: "AGP-DISC-DUP", agent_code: "discovery-agent", agent_name: "重复角色", agent_stage: "M3",
      current_version: "v0.1", doc_revision: "r0", is_active: 1,
    }),
    "重复 agent_code='discovery-agent' → UNIQUE 拒绝（该 UK 承载 MD-14 外键）", "UNIQUE",
  );
  // 不同 agent_code 可正常注册（新角色）
  const { db: db2 } = freshDb();
  const r = await registerAgentProfile(db2, {
    profile_id: "AGP-NEW", agent_code: "new-agent", agent_name: "新角色", agent_stage: "M3",
    current_version: "v1.0", doc_revision: "r1", is_active: 1,
  });
  assert(r.success === true, "新 agent_code='new-agent' 可正常注册");
}

// ==================================================== ⑥ 组装指令与能力版本快照（供 F-06 冻结落库）
console.log("\n⑥ `composeAgentVersionSnapshot` 输出形态对齐种子 task.agent_version_snapshot");
{
  const { db } = freshDb();
  const snap = await composeAgentVersionSnapshot(db, "discovery-agent");
  assert(snap === "discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0", `快照串与种子一致：「${snap}」`);
  const snapHva = await composeAgentVersionSnapshot(db, "hva-agent");
  assert(snapHva === "hva-agent v1.3 / agent.md r12 / skills: hva-five-checks v1.1", `HVA 快照串正确：「${snapHva}」`);
  const snapNone = await composeAgentVersionSnapshot(db, "no-such-agent");
  assert(snapNone === null, "找不到 profile → null（不报错）");
}

// ==================================================== ⑦ 静态核验（零外部调用 / 零裸 SQL / 单一写入面）
console.log("\n⑦ 静态核验 · 零外部调用 / 无裸 SQL（全委托本模块 prepare）/ 唯一写入面 MD-13+MD-14");
{
  const src = stripComments(readFileSync(PROFILE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  // 精确断言：本文件仅对 MD-13(agent_profile) / MD-14(skill_registry) 出现写语句
  const writes = (src.match(/\b(UPDATE|INSERT)\s+INTO\s+([a-z_]+)/gi) || []).map((m) => m.toLowerCase());
  const targets = writes.map((w) => (w.match(/into\s+([a-z_]+)/) || [])[1]).filter(Boolean);
  assert(targets.length > 0, `存在写语句（${targets.join(", ")}）`);
  assert(targets.every((t) => t === "agent_profile" || t === "skill_registry"),
    `写语句目标仅限 MD-13(agent_profile)/MD-14(skill_registry)，实际：${targets.join(", ")}`);
  // 零外部模块依赖：profile.js 自身不 import 任何其它模块（纯 D1 适配层调用，零外部依赖）
  const importLines = src.split("\n").filter((l) => l.trim().startsWith("import "));
  assert(importLines.length === 0, "profile.js 不 import 任何其它模块（纯 D1 适配层调用，零外部依赖）");
}

finish();
