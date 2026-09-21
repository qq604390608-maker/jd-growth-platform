#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M4 · F-18 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M4.md（**TC-C-M4-001**（L2·F-18/F-21：七要素结构化 JSON + 硬红线「不含活动配置/权益/预算/排期」——推理契约受 A-1 门禁，本执行器只验**可运行的边界扫描器**与装载契约，该 oracle 项登记为「门禁未关闭、非发布门禁」）｜
 *        **TC-I-M4-002**（L5·F-18/F-20：查询链路经 M5 只读、不调生产写——本执行器以「真库行数不变 + fake-db 全 SELECT」证明零写））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-18（结束条件二选一）｜ §5.2 out of scope｜ §5.3 硬红线｜ §7 第 4 条
 *   ｜ ../../docs/02-prd/PRD-M4-HVA分析Agent.md §1.1.1（角色指令五段）/ §1.1.2（业务指令 8 条）/ F-18
 *   ｜ ../../docs/03-locks/schema.md（MD-13 agent_profile、MD-14 skill_registry）
 *   ｜ ../../agent-runtime/hva/agent.md / ../../agent-runtime/business-rules.md（**本体**，逐条对齐断言）
 *   ｜ ./role.js（F-18 本体）｜ ./profile.js（**F-13 读面**）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-18 用例并断言。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理）；**数值以契约基准 v1（ADR-004）为准**，只断结构与语义
 *   （版本串取自种子、断言其与种子一致而非自造数值）。
 * 边界：只验 F-18（装载 + 结束条件 + 假设性质 + 输出边界扫描）；F-19~F-22 不在本执行器。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f18.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f18.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  loadAgentRole,
  evaluateResearchClosure,
  labelProductHypothesis,
  scanProductionActions,
  HVA_AGENT_CODE,
  ROLE_DOC,
  BUSINESS_RULES_DOC,
  ROLE_SECTIONS,
  BUSINESS_RULE_IDS,
  CLOSURE_KINDS,
  FORBIDDEN_PRODUCTION_PATTERNS,
} from "./role.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const ROLE_SRC = new URL("./role.js", import.meta.url);
const ROLE_MD = new URL("../../agent-runtime/hva/agent.md", import.meta.url);
const RULES_MD = new URL("../../agent-runtime/business-rules.md", import.meta.url);

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

// ==================================================== ① 装载角色指令（MD-13 种子 AGP-HVA）
console.log("① 装载角色指令 · `loadAgentRole(db,'hva-agent')`（复用 F-13 读面：MD-13 + MD-14）");
{
  const { db } = freshDb();
  const role = await loadAgentRole(db, HVA_AGENT_CODE);
  assert(role.agent_code === "hva-agent", `agent_code=hva-agent（实测 ${role.agent_code}）`);
  assert(role.agent_name === "HVA 分析 Agent", `agent_name 取自 MD-13（实测 ${role.agent_name}）`);
  assert(role.agent_stage === "M4", `agent_stage=M4（实测 ${role.agent_stage}）`);
  assert(role.current_version === "v1.3" && role.doc_revision === "r12", "版本号从 MD-13 现读（v1.3 / r12，种子值）");
  assert(role.agent_version_snapshot === "hva-agent v1.3 / agent.md r12 / skills: hva-five-checks v1.1, crowd-compare v1.0, behavior-check v1.0, result-assembly v1.0",
    `版本快照串与 F-13/MD-14 一致（T-24 裁决后 4 Skill，实测「${role.agent_version_snapshot}」）`);
  assert(role.skills.length === 4 && role.skills[0].skill_no === "S-B1" && role.skills[0].skill_code === "hva-five-checks" && role.skills[3].skill_code === "result-assembly",
    `生效 Skill 取自 MD-14（T-24 裁决后 S-B1~S-B4，实测 ${role.skills.map((s) => s.skill_no).join(",") || "无"}）`);
  assert(role.role_sections.length === 5, `agent.md 段落骨架 5 段（实测 ${role.role_sections.length}）`);
  assert(role.role_sections.map((s) => s.key).join(",") === "responsibility,input,method,output,closure",
    `段落顺序＝职责→输入→工作方式→输出→结束条件（实测 ${role.role_sections.map((s) => s.key).join(",")}）`);
  assert(role.role_sections.every((s) => String(s.source).startsWith(ROLE_DOC)), "每段 source 回指 agent.md 本体（不复制叙述文本）");
  assert(role.business_rules.length === 8, `公共业务指令 8 条（实测 ${role.business_rules.length}）`);
  assert(role.business_rules.every((r) => /^BR-\d{2}$/.test(r.rule_id) && r.key && r.title), "每条含 rule_id / 判据键 / 标题");
  assert(role.closure.kinds.length === 2 && role.closure.kinds.includes(CLOSURE_KINDS.RESEARCH_ANSWER)
    && role.closure.kinds.includes(CLOSURE_KINDS.LIMITATION_STATED), "结束条件二选一登记在装载结果里");
  assert(role.closure.hypothesis_not_conclusion === true && role.closure.failure_is_not_negation === true,
    "两条红线（假设不预设结论 / 失败不否定）随装载结果暴露");
  assert(role.boundaries.no_production_actions === true && role.boundaries.no_production_write === true
    && role.boundaries.query_via_tool_executor === true, "输出边界与只读边界已声明");
  assert(role.business_rules_doc === BUSINESS_RULES_DOC, "公共业务指令回指 business-rules.md");
  // 反例：不存在的 agent_code / 空 agent_code
  await assertThrows(() => loadAgentRole(db, "no-such-agent"), "反例：不存在的 agent_code → 报错（角色指令不存在）", "角色指令不存在");
  await assertThrows(() => loadAgentRole(db, "   "), "反例：空 agent_code → 报错（必填）", "不能为空");
  // 默认参数即 hva-agent
  const byDefault = await loadAgentRole(db);
  assert(byDefault.agent_code === "hva-agent", "默认装载对象＝hva-agent（F-18 角色）");
}

// ==================================================== ② 指令本体逐条对齐（回指不重述）
console.log("\n② 本体逐条对齐 · 服务端只持编号/键，叙述文本以 agent-runtime/ 为唯一真源");
{
  const rulesMd = readFileSync(RULES_MD, "utf8");
  const listed = [...rulesMd.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1].trim());
  assert(listed.length === 8, `business-rules.md 有序列表 8 条（实测 ${listed.length}）`);
  assert(listed.join("|") === BUSINESS_RULE_IDS.map((r) => r.title).join("|"),
    `8 条标题与 BUSINESS_RULE_IDS 逐条一致（本体：${listed.join(" / ")}）`);
  const roleMd = readFileSync(ROLE_MD, "utf8");
  for (const s of ROLE_SECTIONS) {
    assert(roleMd.includes(`### ${s.title}`), `agent.md 本体含章节「### ${s.title}」`);
  }
  assert(roleMd.includes("产品假设不预先作为研究结论"), "agent.md 结束条件含「产品假设不预先作为研究结论」");
  assert(!/建壳声明/.test(roleMd), "agent.md 已去建壳声明（本体落地）");
  assert(!/建壳声明/.test(rulesMd), "business-rules.md 已去建壳声明（本体落地）");
}

// ==================================================== ③ 结束条件判定（PRD-M4 F-18 验收要点）
console.log("\n③ 结束条件 · `evaluateResearchClosure`（二选一 + 两条红线做成判据）");
{
  // ① 有依据的研究回答 → 可结束
  const a = evaluateResearchClosure({
    research_answer: "乳品方向的高频复购人群与门店自提行为同现",
    evidence_refs: ["EV-1", "EV-2"], answer_stance: "support",
  });
  assert(a.closed === true && a.kind === "research_answer", `有依据的研究回答 → closed/kind=research_answer（实测 ${a.closed}/${a.kind}）`);
  assert(a.evidence_count === 2, `依据条数如实（实测 ${a.evidence_count}）`);
  assert(a.negation_allowed === true, "非失败场景下否定判定允许（negation_allowed=true）");
  assert(a.failure_is_not_negation === true && a.hypothesis_not_conclusion === true, "两条红线声明恒在");

  // ② 无依据（无证据引用）→ 不构成「有依据的研究回答」
  const b = evaluateResearchClosure({ research_answer: "该行为是关键行为", evidence_refs: [] });
  assert(b.closed === false && b.kind === null, `无依据 → 不结束（实测 closed=${b.closed}）`);
  assert(/有依据的研究回答/.test(b.reason || ""), `原因指出不构成有依据的研究回答（实测「${b.reason}」）`);
  assert(/BR-01/.test(b.reason || ""), "原因回指公共业务指令 BR-01（关键发现有据）");

  // ③ 说明无法完成判断的原因 → 合法结束
  const c = evaluateResearchClosure({ limitation_reason: "关键行为明细查询失败，人群对照不足，无法完成判断" });
  assert(c.closed === true && c.kind === "limitation_stated", `说明限制 → closed/kind=limitation_stated（实测 ${c.closed}/${c.kind}）`);
  assert(/失败|受限|原因/.test(c.limitation_reason || ""), "限制原因原样透传（不吞掉）");
  assert(c.negation_allowed === false, "限制型结束不给出否定判定（negation_allowed=false）");
  assert(/合法结束/.test(c.note || ""), "明示「说明无法完成判断的原因是合法结束」");

  // ④ 二者皆无 → 不结束，列出缺什么
  const d = evaluateResearchClosure({ evidence_refs: ["EV-1"] });
  assert(d.closed === false && d.kind === null, "二者皆无 → 不结束");
  assert(Array.isArray(d.missing) && d.missing.length === 2, `missing 列出两项（实测 ${JSON.stringify(d.missing)}）`);

  // ⑤ 红线一：产品假设不得直接当研究回答
  const e = evaluateResearchClosure({ research_answer: "我判断「首单家庭装」是关键行为", evidence_refs: ["EV-1"], answer_nature: "hypothesis" });
  assert(e.closed === false && e.kind === null, "假设当回答 → 拒绝结束（产品假设不预先作为研究结论）");
  assert(/假设/.test(e.reason || "") && /检验/.test(e.reason || ""), `原因要求先经查证（实测「${e.reason}」）`);

  // ⑥ 红线二：失败导致的否定不得作为否定依据（BRD §7 第 4 条）
  const f = evaluateResearchClosure({
    research_answer: "该行为与长期价值无关", evidence_refs: ["EV-1"],
    answer_stance: "unsupport", due_to_failure: true,
  });
  assert(f.closed === false && f.kind === null, "失败导致的否定 → 拒绝结束（不得当否定依据）");
  assert(f.negation_allowed === false, "并明确 negation_allowed=false");
  assert(/失败/.test(f.reason || ""), `原因点明由失败导致（实测「${f.reason}」）`);
  // 未支持也是合法结论——只要不是失败导致
  const g = evaluateResearchClosure({
    research_answer: "未找到足够依据支持该候选 HVA", evidence_refs: ["EV-1"], answer_stance: "unsupport", due_to_failure: false,
  });
  assert(g.closed === true && g.kind === "research_answer", "「未支持」在非失败场景下是完整结果（PRD-M4 F-21 口径）");
  assert(g.negation_allowed === true, "非失败场景的未支持 → 允许作为结论");

  // ⑦ 入参守卫
  await assertThrows(() => evaluateResearchClosure(null), "入参非对象 → 报错", "须为对象");
}

// ==================================================== ④ 产品假设性质标注
console.log("\n④ 产品假设性质标注 · `labelProductHypothesis`（假设不预设结论）");
{
  const h = labelProductHypothesis({ text: "家庭装首单可能是关键行为" });
  assert(h.nature === "hypothesis" && h.is_conclusion === false, `标为假设且非结论（实测 nature=${h.nature}）`);
  assert(h.must_verify === true, "须经查证（must_verify=true）");
  assert(/不预先作为研究结论/.test(h.note || ""), "附口径说明");
  const h2 = labelProductHypothesis("  字符串形态的假设  ");
  assert(h2.text === "字符串形态的假设", `字符串入参也可，且去空白（实测「${h2.text}」）`);
  await assertThrows(() => labelProductHypothesis({ text: "   " }), "空白假设 → 报错（不静默降级）", "不能为空");
  await assertThrows(() => labelProductHypothesis({}), "缺文本 → 报错", "不能为空");
}

// ==================================================== ⑤ 输出边界扫描（TC-C-M4-001 硬红线可运行形式）
console.log("\n⑤ 输出边界扫描 · `scanProductionActions`（不含活动配置/权益组合/预算/排期）");
{
  const clean = scanProductionActions("研究输出：人群差异已查明；仍受限项：参与明细缺失；改善方向：补齐行为埋点");
  assert(clean.clean === true && clean.hits.length === 0, "合规文本 → clean=true");
  assert(clean.patterns_checked === FORBIDDEN_PRODUCTION_PATTERNS.length, `扫描项数＝禁词表长度（实测 ${clean.patterns_checked}）`);
  assert(FORBIDDEN_PRODUCTION_PATTERNS.length === 4, "禁词表恰 4 项（活动配置 / 权益组合 / 预算 / 排期）");
  const dirty = scanProductionActions("建议对该人群发放权益组合并安排投放排期");
  assert(dirty.clean === false, "含生产动作类内容 → clean=false");
  assert(dirty.hits.length === 2 && dirty.hits.some((x) => x.pattern === "权益组合") && dirty.hits.some((x) => x.pattern === "排期"),
    `命中并逐个列出（实测 ${dirty.hits.map((x) => x.pattern).join(",")}）`);
  assert(dirty.hits.every((x) => typeof x.index === "number" && x.index >= 0), "每个命中带位置（可定位）");
  await assertThrows(() => scanProductionActions(undefined), "非字符串入参 → 报错", "须为字符串");
}

// ==================================================== ⑥ 运行期零写（真库行数不变 + fake-db 全 SELECT）
console.log("\n⑥ 运行期零写 · 装载前后 MD-13/MD-14 行数不变；fake-db 记录到的 SQL 全为 SELECT");
{
  const { sqlite, db } = freshDb();
  const beforeProfile = countRows(sqlite, "agent_profile");
  const beforeSkill = countRows(sqlite, "skill_registry");
  await loadAgentRole(db, "hva-agent");
  assert(countRows(sqlite, "agent_profile") === beforeProfile && countRows(sqlite, "skill_registry") === beforeSkill,
    "装载后 MD-13/MD-14 行数不变（实测两端相等）");
  const seen = [];
  const fakeDb = {
    prepare: (sql) => {
      seen.push(sql);
      return { bind: () => ({ all: () => ({ results: [] }), first: () => ({}), run: () => ({ success: true, meta: { changes: 0 } }) }) };
    },
  };
  await loadAgentRole(fakeDb, "hva-agent");
  assert(seen.length > 0, `确实经 prepare 发出语句（实测 ${seen.length} 条）`);
  assert(seen.every((s) => /^\s*SELECT/i.test(s)), `全部为 SELECT（零写；实测非 SELECT ${seen.filter((s) => !/^\s*SELECT/i.test(s)).length} 条）`);
}

// ==================================================== ⑦ 静态核验（零外部调用 / 零写库 / 零裸 SQL / 唯一依赖）
console.log("\n⑦ 静态核验 · role.js 零外部调用 / 零写语句 / 零裸 SQL / 仅依赖 F-13 读面");
{
  const src = stripComments(readFileSync(ROLE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  const writes = src.match(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/gi) || [];
  assert(writes.length === 0, `零写语句（实测 ${writes.length} 条）`);
  const selects = src.match(/\bSELECT\b/gi) || [];
  assert(selects.length === 0, `零裸 SQL（SELECT 实测 ${selects.length} 条）`);
  const specs = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(specs.length === 1 && specs[0] === "./profile.js", `import 恰 1 条且来自 ./profile.js（实测 ${specs.join(", ") || "无"}）`);
  assert(!specs.some((s) => /node:sqlite|node:fs|tool-executor|task-runner|shared-context/.test(s)),
    "不依赖 node:sqlite / node:fs / M5 / task-runner / shared-context");
  assert(!/createHvaResearchTask|createDiscoveryTask|executeQuery/.test(src), "不触发下游建任务 / 查询执行入口（只做装载与判定）");
}

finish();
