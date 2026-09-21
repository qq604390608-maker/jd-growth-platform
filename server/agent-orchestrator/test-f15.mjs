#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M3 · F-15 用例执行器 · 2026-09-20）
 * 上游 oracle： ../../docs/05-test-cases/test-M3.md
 *   ｜ **TC-A-M3-002**（L4·F-15：S-A2 指标查证——经工具执行程序 M5 真实查询 → 分析返回 → 记录任务；
 *        输出带来源与时点的查询事实；**禁止以模型预期内容代替查询结果**）
 *   ｜ **TC-A-M3-005**（L4·F-15/F-16：边界·missing-field——只松不严不硬映射：缺字段/查不到已过审素材时**退回请补**，不静默回退、不编造）
 *   ｜ **TC-A-M3-006**（L4·F-15：边界·price-conflict 倒挂隔离——证据信息时点晚于取数时刻 → **商品/实体级隔离**，非整包失败）
 *   ｜ **TC-I-M3-002**（L5·F-15：所有外部查询经 M5 工具执行程序，只读、不调生产写接口）
 *   ｜ **TC-U-M3-001**（L1·F-14/F-15：意向分归一——同模块复验）
 *   ｜ ../../docs/01-brd/BRD.md §4 F-15（L191-195 五项检查 + 验收：解释须标明尚未验证、支持「值得进一步研究」、不给完整人群对照与 HVA 结论）
 *   ｜ ../../docs/02-prd/PRD-M3-机会发现Agent.md F-15（L78-85：五项检查＝来源/适用范围/信息时点/已有机会/信息缺口；关联 schema＝CFG-05 gap_rule）
 *   ｜ ../../docs/03-locks/schema.md（CFG-05 gap_rule；EXT-02 evidence 四要素；§12 Q-10/Q-11）
 *   ｜ ./verification.js（F-15 本体）｜ ../tool-executor/index.js（M5，S-A2 的查询执行面）｜ ../shared-context/index.js（F-09 证据写入面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层 + 载入真实 DDL/种子，注入式 transport 模拟外部工具返回，实跑 F-15 用例并断言。
 * 硬红线：本地内存库 + **注入式 transport**，**零真实外部调用、零 LLM 调用、零生产写**；
 *   「禁止以模型预期代替查询结果」用**哨兵串**验证（传 `model_expectation` 后输出里不得出现该串）；
 *   **数值以契约基准 v1（ADR-004）为准**，只断结构契约、真实原因透传、四要素形态与约束行为。
 * 边界：A-1（LLM）⬜ 未提供 → 本执行器只验**确定性编排 + 真实返回透传**；TC-A-M3-002 的「真实 LLM 产出契约」登记为「门禁未关闭、非发布门禁」。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f15.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f15.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  runMetricVerification,
  verifyFiveChecks,
  isolateContradictedEvidence,
  resolveMissingFields,
  buildTentativeExplanation,
  buildEvidenceDraft,
  verifyClueAndDraftEvidence,
  recordVerificationEvidence,
  parseStamp,
  FIVE_CHECKS,
  FORBIDDEN_CONCLUSION_PATTERNS,
} from "./verification.js";
import { registerPermission } from "../tool-executor/index.js";
import { getEvidence } from "../shared-context/index.js";
import { SCENARIOS, defaultOk } from "../../prototype/mock/scenarios.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const VERIF_SRC = new URL("./verification.js", import.meta.url);

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

/** 只在本次生效的授权对象（避开种子的长期授权）。 */
const G = { grantee_type: "agent", grantee_ref: "qa-f15-agent" };
/** 种子里的可运行任务（`running`）——S-A2 查询事实须归属真实任务，且已停止/已完成任务不进入执行。 */
const TASK = "T-1023";
const AT = "2026-09-20 10:00:00";

/** 让某工具可被允许：启用工具 + 其来源 MCP 化 + 可用 + 给 G 一条有效期内的允许授权。 */
async function allow(db, tool_id, source_id) {
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = ?").bind(tool_id).run();
  await db
    .prepare("UPDATE source_registry SET is_mcp_ready = 1, availability_status = 'ok' WHERE source_id = ?")
    .bind(source_id)
    .run();
  await registerPermission(db, {
    permission_id: `PERM-F15-${tool_id}`,
    grantee_type: G.grantee_type,
    grantee_ref: G.grantee_ref,
    tool_id,
    allow_flag: 1,
    effective_from: "2026-01-01 00:00",
    effective_until: null,
  });
}

/** 固定返回体的 transport；记录调用次数以便断言「不允许时不发起外部调用」。 */
function transportOf(payload) {
  const t = async function () {
    t.calls.push(1);
    return JSON.parse(JSON.stringify(payload)); // 深拷贝，避免被测代码改动夹具
  };
  t.calls = [];
  return t;
}

/** 必然失败的 transport（传输层异常）。 */
function throwingTransport(message) {
  const t = async function () {
    t.calls.push(1);
    throw new Error(message);
  };
  t.calls = [];
  return t;
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

let pass = 0;
let fail = 0;
const fails = [];
function assert(cond, label) {
  if (cond) { pass++; }
  else { fail++; fails.push(label); console.log("  ✗ " + label); }
}
async function assertThrows(fn, label, match = null) {
  try {
    await fn();
    fail++; fails.push(label + "（应抛错但未抛）"); console.log("  ✗ " + label + "（应抛错但未抛）");
  } catch (e) {
    if (match && !String(e.message).includes(match)) {
      fail++; fails.push(label + `（期望含「${match}」，实际「${e.message}」）`);
      console.log("  ✗ " + label + `（期望含「${match}」，实际「${e.message}」）`);
    } else { pass++; }
  }
}
function finish() {
  console.log(`\n${fail === 0 ? "VERIFY PASS" : "VERIFY FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  if (fail > 0) { console.log("失败项："); fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
  process.exit(0);
}

// ==================================================== ① TC-A-M3-002 · S-A2 经 M5 真实查询
console.log("① TC-A-M3-002 · S-A2 指标查证：经 M5 真实查询，禁止以模型预期代替查询结果");
{
  // 缺必填 → 抛错（查询事实须归属真实任务、须先识别工具）
  const { db: dbX } = freshDb();
  await assertThrows(() => runMetricVerification(dbX, { tool_id: "TOL-01" }), "缺 task_id → 抛错", "task_id");
  await assertThrows(() => runMetricVerification(dbX, { task_id: TASK }), "缺 tool_id/tool_code → 抛错", "tool_code");

  // 真实成功路径
  const { db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const tr = transportOf(defaultOk("cdp.crowd.query", "CDP"));
  const ok = await runMetricVerification(db, {
    task_id: TASK, tool_id: "TOL-01", ...G, query_condition: { biz: "超市" }, at: AT, transport: tr,
  });
  assert(ok.result_status === "ok" && ok.ok === true && ok.verified === true,
    `真实 ok → verified=true（实测 status=${ok.result_status}）`);
  assert(typeof ok.result_summary === "string" && ok.result_summary.length > 0 && ok.result_summary === defaultOk("cdp.crowd.query", "CDP").result_summary,
    "A2 result_summary **原样透传**自 M5 信封（与注入返回体逐字一致）");
  assert(typeof ok.query_id === "string" && /^Q-\d{5}$/.test(ok.query_id),
    `A2 查询事实带 query_id（实测 ${ok.query_id}）`);
  assert(ok.source_id === "CDP" && ok.tool_code === "cdp.crowd.query",
    `A2 查询事实带来源与工具（实测 ${ok.source_id} / ${ok.tool_code}）`);
  assert(ok.queried_at === AT, `A2 查询事实带取数时刻（实测 ${ok.queried_at}）`);
  assert(ok.persisted === true && ok.persist_skip === null, "A2「记录任务」由 M5 承接：EXT-01 已落痕（persisted=true）");
  assert(tr.calls.length === 1, `A2 真实发起了一次外部调用（实测 ${tr.calls.length} 次）`);
  assert(ok.used_model_expectation === false, "A2 硬红线自述：未使用模型预期");
  assert(String(ok.note).includes("真实返回"), "A2 note 明示查询事实来源为真实返回");

  // 哨兵串：传了模型预期，输出里绝不出现（硬红线）
  const FABRICATED = "MODEL-FABRICATED-9.9";
  const { db: db2 } = freshDb();
  await allow(db2, "TOL-01", "CDP");
  const withExp = await runMetricVerification(db2, {
    task_id: TASK, tool_id: "TOL-01", ...G, query_condition: {}, at: AT,
    transport: transportOf(defaultOk("cdp.crowd.query", "CDP")),
    model_expectation: FABRICATED, expected_summary: FABRICATED,
  });
  assert(withExp.model_expectation_ignored === true && withExp.used_model_expectation === false,
    "A2 传入 model_expectation/expected_summary → 显式忽略并留痕");
  assert(!JSON.stringify(withExp).includes(FABRICATED),
    "A2 **硬红线**：模型预期（哨兵串）不出现在查询事实的任何字段里");

  // 失败路径：只回报真实原因，不编造
  const { db: db3 } = freshDb();
  await allow(db3, "TOL-04", "HJE");
  const boom = await runMetricVerification(db3, {
    task_id: TASK, tool_id: "TOL-04", ...G, query_condition: {}, at: AT,
    transport: throwingTransport("ECONNREFUSED 127.0.0.1:8788"),
  });
  assert(boom.ok === false && boom.verified === false, "A2 传输层失败 → verified=false（不冒充已验证）");
  assert(boom.result_summary === null, "A2 失败时 result_summary 为空（schema EXT-01：失败时结果为空）");
  assert(String(boom.fail_reason).includes("调用失败") && String(boom.fail_reason).includes("ECONNREFUSED"),
    `A2 失败原因原样透传（实测「${boom.fail_reason}」）`);
  assert(String(boom.note).includes("不用模型预期填充"), "A2 失败时的口径：只回报真实原因，不替代查询结果");

  // 受限路径：不允许 → **不发起外部调用**（TC-I-M3-002 / 只读）
  const { db: db4 } = freshDb();
  const trDeny = transportOf({});
  const deny = await runMetricVerification(db4, {
    task_id: TASK, tool_code: "cdp.crowd.query", grantee_type: "agent", grantee_ref: "qa-f15-nobody",
    query_condition: {}, at: AT, transport: trDeny,
  });
  assert(deny.restricted === true && deny.verified === false, "A2 无授权 → 受限、不得视为已验证");
  assert(trDeny.calls.length === 0, `A2 不允许时**不发起外部调用**（实测 ${trDeny.calls.length} 次）`);
}

// ==================================================== ② 五项检查（BRD §4 F-15）
console.log("\n② BRD §4 F-15 · 五项检查：来源 / 适用范围 / 信息时点 / 已有机会 / 信息缺口");
{
  const { db } = freshDb();
  await allow(db, "TOL-04", "HJE");
  const factBase = await runMetricVerification(db, {
    task_id: TASK, tool_id: "TOL-04", ...G, query_condition: { 品类: "乳品烘焙" }, at: AT,
    transport: transportOf(SCENARIOS.multi_value("hje.traffic.entry")),
  });
  assert(factBase.ok === true, "② 前置：取得一份真实查询事实");

  const fact = {
    ...factBase,
    applicability_scope: "仅京东超市主站 APP 端；不含小程序",
    missing_note: "无用户级明细，无法确认后续行为变化",
    keywords: ["复购"],
  };
  const goal = { goal_id: "GOAL-2026Q3-01", business_scope: "APP", business_goal: "提升新客复购" };
  const five = await verifyFiveChecks(db, { fact, goal, at: AT });

  assert(FIVE_CHECKS.length === 5 && FIVE_CHECKS.every((k) => five.checks[k] !== undefined),
    `② 五项检查齐备（${FIVE_CHECKS.join(" / ")}）`);
  assert(five.checks.source.ok === true && five.checks.source.query_id === factBase.query_id,
    "② ①来源：可回查（哪份资料哪次查询）");
  assert(five.checks.applicability.ok === true && five.checks.applicability.decided === true,
    "② ②适用范围：人群/渠道/旅程环节与目标范围一致 → 通过");
  assert(five.checks.info_time_point.inverted === false && five.checks.info_time_point.ok === true,
    "② ③信息时点：未晚于取数时刻 → 不倒挂");
  assert(five.checks.existing_opportunity.duplicate_suspected === true && five.checks.existing_opportunity.matches.length > 0,
    `② ④已有机会：命中已有机会（${five.checks.existing_opportunity.matches.map((m) => m.opportunity_id).join("、")}）`);
  assert(five.checks.existing_opportunity.matches.every((m) => typeof m.hit_count === "number" && Array.isArray(m.hits)),
    "② ④已有机会：命中项带 hits/hit_count（比对过程可见）");
  assert(five.checks.gap.rules_checked === 4, `② ⑤信息缺口：按 CFG-05 逐条核对（实测 ${five.checks.gap.rules_checked} 条规则）`);
  assert(five.checks.gap.open_gaps.every((g) => g.rule_id && g.target_field && g.gap_text && g.impact_note),
    "② ⑤信息缺口：每条开放缺口带 rule_id/target_field/gap_text/impact_note（缺什么 + 影响哪项判断）");
  assert(!five.checks.gap.open_gaps.some((g) => g.rule_id === "GAP-3"),
    "② ⑤信息缺口：文本已含渠道（APP）→ GAP-3 命中即视为已写清，不进开放缺口");
  assert(five.checks.gap.open_gaps.some((g) => g.rule_id === "GAP-1"),
    "② ⑤信息缺口：文本未提退款/取消 → GAP-1 如实列为待补（不静默放过）");
  assert(five.all_present === true && five.contradicted === false, "② 五项判定齐全且无倒挂 → all_present=true");
  assert(String(five.note).includes("不下 HVA 判断"), "② 口径自述：只说明依据的来源与边界");

  // 初步解释：标明尚未验证 + 支持「值得进一步研究」+ 不下 HVA 判断
  const txt = buildTentativeExplanation(fact, five);
  assert(txt.includes("尚未验证"), "② 验收：解释**必须标明尚未验证**的部分");
  assert(txt.includes("值得进一步研究"), "② 验收：支持「值得进一步研究」");
  assert(txt.includes("不下 HVA 判断"), "② 验收：明示不给完整人群对照与 HVA 结论");
  assert(FORBIDDEN_CONCLUSION_PATTERNS.every((p) => !txt.includes(p)),
    `② 解释中不含结论性措辞（禁 ${FORBIDDEN_CONCLUSION_PATTERNS.join("/")}）`);

  // 目标未声明范围 → 适用范围「未知」，不猜；all_present 为 false
  const fiveNoScope = await verifyFiveChecks(db, { fact, goal: { goal_id: "GOAL-2026Q3-01" }, at: AT });
  assert(fiveNoScope.checks.applicability.decided === false && fiveNoScope.checks.applicability.ok === false,
    "② 目标未声明范围 → 适用范围记为未知（不猜测、也不算通过）");
  assert(fiveNoScope.all_present === false, "② 适用范围无法判定 → all_present=false（不把未知当通过）");

  // 缺 at 基准 → 抛错（倒挂判定不能没有基准）
  await assertThrows(() => verifyFiveChecks(db, { fact: { ...fact, queried_at: null } }), "缺取数时刻基准 → 抛错", "at");
  await assertThrows(() => verifyFiveChecks(db, {}), "缺 fact → 抛错", "fact");
}

// ==================================================== ③ TC-A-M3-006 · 倒挂隔离
console.log("\n③ TC-A-M3-006 · 边界·price-conflict：倒挂隔离（仅该条失效，非整包失败）");
{
  const items = [
    { evidence_id: "EV-A", info_time_point: "2026-09-16 03:00 取数" },
    { evidence_id: "EV-B", info_time_point: "2026-09-25 09:00 取数" }, // 晚于 AT → 倒挂
    { evidence_id: "EV-C", info_time_point: "2026-09-14 09:00 取数" },
  ];
  const r = isolateContradictedEvidence(items, { at: AT });
  assert(r.isolated.length === 1 && r.isolated[0].evidence_id === "EV-B", "③ 仅倒挂那条被隔离（实测 " + r.isolated.map((x) => x.evidence_id).join(",") + "）");
  assert(r.isolated[0].isolate_reason === "info_time_point_after_fetch", "③ 隔离原因显式标注");
  assert(r.kept.length === 2 && r.kept.every((k) => k.isolated === false), "③ 其余证据**照常参与**（不被牵连）");
  assert(r.batch_failed === false, "③ **非整包失败**（batch_failed=false）");
  assert(String(r.note).includes("倒挂隔离"), "③ 处置结果有可读说明");

  const clean = isolateContradictedEvidence([{ evidence_id: "EV-A", info_time_point: "2026-09-16 03:00" }], { at: AT });
  assert(clean.isolated.length === 0 && clean.kept.length === 1, "③ 无倒挂 → 全部照常参与");

  await assertThrows(() => isolateContradictedEvidence([], {}), "③ 缺 at → 抛错", "at");
  await assertThrows(() => isolateContradictedEvidence("not-array", { at: AT }), "③ 入参非数组 → 抛错", "数组");

  // 倒挂事实不得被写成依据
  const { db } = freshDb();
  const invertedFact = { query_id: "Q-90218", source_id: "HJE", info_time_point: "2026-09-25 09:00", result_summary: "x", applicability_scope: "APP", missing_note: "n", verified: true };
  const five = await verifyFiveChecks(db, { fact: invertedFact, goal: { business_scope: "APP" }, at: AT });
  assert(five.contradicted === true, "③ 倒挂事实在五项检查里被标 contradicted");
  const draft = buildEvidenceDraft({ fact: invertedFact, checks: five });
  assert(draft.ok === false && draft.draft === null && draft.reason === "contradicted_evidence_isolated",
    "③ 倒挂证据**不予采用**为依据（草稿为空 + 显式原因）");
}

// ==================================================== ④ TC-A-M3-005 · missing-field 退回请补
console.log("\n④ TC-A-M3-005 · 边界·missing-field：只松不严不硬映射（退回请补，不静默回退、不编造）");
{
  const REQ = ["query_id", "source_id", "info_time_point", "applicability_scope", "result_summary", "missing_note"];
  const bad = resolveMissingFields(
    { query_id: "Q-1", source_id: "HJE", info_time_point: "2026-09-16 03:00", applicability_scope: "APP", result_summary: "ok", missing_note: "" },
    REQ,
  );
  assert(bad.action === "request_supplement", "④ 缺字段 → 退回请补（action=request_supplement）");
  assert(bad.missing.length === 1 && bad.missing[0] === "missing_note", `④ 精确列出缺项（实测 ${bad.missing.join("、")}）`);
  assert(bad.draft === null, "④ **不返回半成品**（避免静默回退把缺项伪装成已完成）");
  assert(String(bad.note).includes("不静默回退") && String(bad.note).includes("不编造"), "④ 口径明示：不静默回退、不编造");
  assert(String(bad.guidance).includes("退回请补"), "④ 含补齐指引（含「已过审但查不到」同样退回请补）");

  const good = resolveMissingFields(
    { query_id: "Q-1", source_id: "HJE", info_time_point: "2026-09-16 03:00", applicability_scope: "APP", result_summary: "ok", missing_note: "无明细" },
    REQ,
  );
  assert(good.action === "accept" && good.missing.length === 0 && good.draft !== null, "④ 齐备 → 直接采用（accept）");

  await assertThrows(() => resolveMissingFields({}, []), "④ requiredFields 为空 → 抛错（不隐式取默认）", "requiredFields");
  await assertThrows(() => resolveMissingFields(null, REQ), "④ draft 缺失 → 抛错", "draft");
}

// ==================================================== ⑤ 证据草稿 + 复用 F-09 落 EXT-02
console.log("\n⑤ EXT-02 证据：装配草稿 + 复用 F-09 单一写入面落库（只读实测回查）");
{
  const { db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const fact = await runMetricVerification(db, {
    task_id: TASK, tool_id: "TOL-01", ...G, query_condition: { 人群: "新客" }, at: AT,
    transport: transportOf(defaultOk("cdp.crowd.query", "CDP")),
  });
  const analysed = { ...fact, applicability_scope: "APP + 小程序；超市频道新客", missing_note: "仅标签聚合，无行为时序", keywords: ["新客"] };
  const five = await verifyFiveChecks(db, { fact: analysed, goal: { business_scope: "APP" }, at: AT });
  const draft = buildEvidenceDraft({ fact: analysed, checks: five, evidence_id: "EV-9001", evidence_title: "新客标签分布（qa-f15）", created_at: AT });

  assert(draft.ok === true && draft.completeness.valid === true, "⑤ 证据四要素齐全 → 草稿可用");
  assert(["query_id", "source_id", "info_time_point", "applicability_scope"].every((k) => draft.draft[k]),
    "⑤ 草稿含四要素（来源/条件/时点/适用范围）");
  assert(draft.draft.missing_note.length > 0, "⑤ 草稿含 missing_note（缺口随依据一起留痕）");

  const res = await recordVerificationEvidence(db, draft.draft);
  assert(res.evidence_id === "EV-9001", `⑤ 复用 F-09 单一写入面 createEvidence 落 EXT-02（实测 ${res.evidence_id}）`);
  const back = await getEvidence(db, "EV-9001");
  assert(back && back.query_id === fact.query_id && back.source_id === "CDP", "⑤ 回查 EXT-02：证据挂到真实 query_id/source_id");
  assert(back.applicability_scope === "APP + 小程序；超市频道新客", "⑤ 回查 EXT-02：适用范围与缺口随行留痕");

  // 四要素不齐 → F-09 直接 fail、不落库（沿用既有单一写入面口径，不在此重复实现校验）
  await assertThrows(
    () => recordVerificationEvidence(db, { ...draft.draft, evidence_id: "EV-9002", applicability_scope: "" }),
    "⑤ 四要素不齐 → 拒绝落库（由 F-09 写入面 fail）",
    "四要素不齐",
  );
  assert((await getEvidence(db, "EV-9002")) === null, "⑤ 被拒的证据确实未落库");
  await assertThrows(() => recordVerificationEvidence(db, null), "⑤ 缺草稿 → 抛错", "draft");
}

// ==================================================== ⑥ 一步编排：线索 → 查证后的初步依据
console.log("\n⑥ F-15 一步编排：线索 → 经 M5 真实查询 → 五项检查 → 初步依据");
{
  const { db } = freshDb();
  await allow(db, "TOL-01", "CDP");
  const FABRICATED = "MODEL-FABRICATED-7.7";
  const good = await verifyClueAndDraftEvidence(db, {
    clue: { applicability_scope: "APP 端新客", missing_note: "无行为时序", keywords: ["新客"], evidence_title: "新客分布（qa-f15）" },
    goal: { goal_id: "GOAL-2026Q3-01", business_scope: "APP", business_goal: "提升新客复购" },
    evidence_id: "EV-9003", created_at: AT,
    task_id: TASK, tool_id: "TOL-01", ...G, query_condition: { 人群: "新客" }, at: AT,
    transport: transportOf(defaultOk("cdp.crowd.query", "CDP")),
    model_expectation: FABRICATED,
  });
  assert(good.verified === true && good.checks !== null && good.evidence.ok === true,
    "⑥ 真实返回 → 完成五项检查并产出证据草稿");
  assert(good.explanation.includes("尚未验证") && good.explanation.includes("值得进一步研究"),
    "⑥ 初步依据同样标明「尚未验证」并支持「值得进一步研究」");
  assert(!JSON.stringify(good).includes(FABRICATED), "⑥ 硬红线：编排全链路都不出现模型预期（哨兵串）");

  const { db: db2 } = freshDb();
  await allow(db2, "TOL-01", "CDP");
  const bad = await verifyClueAndDraftEvidence(db2, {
    clue: { applicability_scope: "APP" },
    goal: { goal_id: "GOAL-2026Q3-01", business_scope: "APP" },
    task_id: TASK, tool_id: "TOL-01", ...G, query_condition: {}, at: AT,
    transport: throwingTransport("HTTP 502 Bad Gateway"),
  });
  assert(bad.verified === false && bad.checks === null && bad.evidence === null,
    "⑥ 未取得真实返回 → 不产出依据（checks/evidence 均为空）");
  assert(String(bad.fact.fail_reason).includes("HTTP 502"), "⑥ 失败原因原样回报");
  assert(String(bad.note).includes("不编造"), "⑥ 失败路径口径：只回报真实原因与缺口，不编造");
  assert(bad.missing && bad.missing.action === "request_supplement", "⑥ 失败路径同样给出「退回请补」结论");
}

// ==================================================== ⑦ 纯函数 · parseStamp
console.log("\n⑦ parseStamp · 时点抽取（倒挂判定的基础，确定性、不猜）");
{
  assert(parseStamp("2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15") === "2026-09-16 03:00",
    "⑦ 从自由文本抽出首个可识别时点（取数时刻优先）");
  assert(parseStamp("2026-9-6") === "2026-09-06 00:00", "⑦ 缺时刻补 00:00、单位数补零");
  assert(parseStamp("未标注时点") === null, "⑦ 无可识别时点 → null（不猜）");
  assert(parseStamp(null) === null && parseStamp(undefined) === null, "⑦ null/undefined → null");
}

// ==================================================== ⑧ 静态核验（硬红线）
console.log("\n⑧ 静态核验 · 零外部调用 / 零写语句 / 单一写入面 / 不复制字典");
{
  const src = stripComments(readFileSync(VERIF_SRC, "utf8"));
  assert(!src.includes("fetch(") && !/https?:\/\//.test(src), "⑧ 零外部调用：无 fetch(、无 http(s) 字面");

  // 注意：import 是多行的（`import {\n ...\n} from "..."`），按行过滤只会拿到 `import {` 这一行——
  // 因此这里直接抽全部 `from "..."` 模块说明符（踩过的坑，勿改回按行过滤）。
  const importLines = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]).join(" ");
  assert(importLines.includes("../tool-executor/index.js"), "⑧ 外部访问**只经 M5**：import ../tool-executor/index.js（TC-I-M3-002）");
  assert(importLines.includes("../shared-context/index.js"), "⑧ 读面与 F-09 证据写入面经 ../shared-context/index.js");
  assert(!importLines.includes("node:sqlite") && !importLines.includes("node:fs"), "⑧ 本体不依赖 node:sqlite / node:fs（D1 形态注入）");
  assert(!importLines.includes("task-runner"), "⑧ 本体不 import task-runner（不与 M1 写面耦合）");

  // 读语句只面向 CFG-05（真源）
  const selects = (src.match(/SELECT[^`"']*?\bFROM\s+([a-z_]+)/gi) || [])
    .map((m) => (m.match(/from\s+([a-z_]+)/i) || [])[1]).filter(Boolean);
  assert(selects.length > 0, `⑧ 存在只读查询（${[...new Set(selects)].join("、")}）`);
  assert(selects.every((t) => t === "gap_rule"),
    `⑧ 读语句仅面向 CFG-05 gap_rule（实测 ${[...new Set(selects)].join("、")}）`);

  // 写语句扫描：本体**不得含任何写语句**（写全部委托既有单一写入面：M5 的 EXT-01 / F-09 的 EXT-02）
  const hits = src.match(/\b(INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/gi) || [];
  assert(hits.length === 0, `⑧ 零写语句（实测命中 ${hits.length}：${hits.join(" / ")}）`);
  assert(/\bcreateEvidence\b/.test(src), "⑧ 证据落库走 F-09 `createEvidence`（复用而非重写写入面）");
}

finish();
