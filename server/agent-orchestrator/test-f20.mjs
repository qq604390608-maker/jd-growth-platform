#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M4 · F-20 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M4.md（**TC-U-M4-001**（L1·F-20：`composite_raw=0.62`/`pool_threshold=0.6` → `in_pool=true`；`0.55` → `false`；确定性无随机）｜
 *        **TC-A-M4-002**（L4·F-20①：S-B2 取人群特征与原有表现 → 检查差异是否已解释 → 可比性结论＋限制；两组人群可比性明确——⚠️待确认(§7-T03)，故判据做成**可注入 + 确定性推导**）｜
 *        **TC-A-M4-003**（L4·F-20②③④⑤：S-B3 确认先后关系 → 对齐观察阶段取数 → 查商品/活动/权益等其他解释；五查完成或信息缺口已说明；**倒挂隔离**＝信息时点晚于取数时刻的**仅该条失效**、非整包失败——⚠️待确认(§7-T03/T08/T10)）｜
 *        **TC-A-M4-006**（L4·F-20：**边界·missing-field**——缺比较条件 → **退回**请补，不静默回退）｜
 *        **TC-D-M4-003**（L3·F-20：`MD-09 candidate_behavior.research_no='R-NOPE'` → FK 失败）｜
 *        **TC-D-M4-004**（L3·F-20：`MD-10 behavior_point` 重复 `(candidate_id, point_type, order_no)` → 复合 UK 拒绝）｜
 *        **TC-I-M4-002**（L5·F-18/F-20：查询链路经 M5 工具执行程序**只读**查询、不调生产写））
 *   ｜ ../../docs/02-prd/PRD-M4-HVA分析Agent.md F-20（候选行为五查 + 验收要点：行为与较好表现同时出现 ≠ 因果；某活动存在只证明有活动信息）｜ §1.1 S-B2/S-B3｜ §4 红线 1/3
 *   ｜ ../../docs/01-brd/BRD.md §4 F-20｜ §5.3 硬红线｜ §7 第 4 条（失败不否定结论）
 *   ｜ ../../docs/03-locks/schema.md（MD-09 / MD-10；DDL L262 / L270）｜ ../../docs/03-locks/external-deps.md §2 五系统缺口、§5 TOL-12 ❌ 不存在、§7 T-03/T-08/T-10 未关
 *   ｜ ./behavior.js（F-20 编排本体）｜ ./behavior-store.js（F-20 写入面）｜ ./research-start.js（F-19：五查顺序与比较条件真源）｜ ./verification.js（F-15：经 M5 查询与倒挂口径）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-20 用例并断言。
 * 夹具：用 F-03 `submitProposal` + F-04 `createHvaResearchTask` 造**真实任务链**（不手工拼任务行）；
 *   M5 查询链路用**注入式 transport**（复用 `prototype/mock/scenarios.js`）+ 自造授权（不复用种子长期授权）。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理）；**demo 数值不进断言**，只断结构与语义。
 * 边界：只验 F-20（入池筛选 + 人群可比性 + 五查 + 缺比较条件守卫 + 候选行为落库）；F-21/F-22 不在本执行器。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f20.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f20.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  judgePoolThreshold,
  checkPopulationComparability,
  runBehaviorChecks,
  evaluateComparisonGate,
  assembleBehaviorVerification,
  formCandidateBehavior,
  queryForBehaviorCheck,
  nextCandidateId,
  nextBehaviorPointId,
  BEHAVIOR_CHECK_KEYS,
  ALTERNATIVE_DIMENSIONS,
  POOL_BOUNDARY,
  BEHAVIOR_STATUS,
  BEHAVIOR_POINT_TYPE,
} from "./behavior.js";
import { updateCandidateBehaviorStatus, listCandidateBehaviors, listBehaviorPoints } from "./behavior-store.js";
import { RESEARCH_CHECK_SEQUENCE } from "./research-start.js";
import { registerPermission } from "../tool-executor/index.js";
import { submitProposal } from "../task-runner/proposal.js";
import { createHvaResearchTask } from "../task-runner/hva.js";
import { defaultOk } from "../../prototype/mock/scenarios.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./behavior.js", import.meta.url);
const STORE_SRC = new URL("./behavior-store.js", import.meta.url);

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
const G = { grantee_type: "agent", grantee_ref: "qa-f20-agent" };
/** 种子里的可运行任务（`running`）——查询事实须归属真实任务。 */
const TASK = "T-1023";
const AT = "2026-09-20 10:00";

/** 让某工具可被允许：启用工具 + 其来源 MCP 化 + 可用 + 给 G 一条有效期内的允许授权。 */
async function allow(db, tool_id, source_id) {
  await db.prepare("UPDATE tool_registry SET is_enabled = 1 WHERE tool_id = ?").bind(tool_id).run();
  await db
    .prepare("UPDATE source_registry SET is_mcp_ready = 1, availability_status = 'ok' WHERE source_id = ?")
    .bind(source_id)
    .run();
  await registerPermission(db, {
    permission_id: `PERM-F20-${tool_id}`,
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
    return JSON.parse(JSON.stringify(payload));
  };
  t.calls = [];
  return t;
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

/** 齐备的比较条件（三项）＋ 五查基础入参。 */
const BASE = {
  research_question: "搜索进入的新客复购更低，是缺少首单后二次找品这一候选行为，还是入口带来的需求强度差异？",
  population_limit: "搜索入口新客",
  focus_period: "2026-07-01 ~ 2026-09-15",
  metric_definition: "30 天复购率（剔除退款订单）",
  at: AT,
};

/** 五条条目：1 条支持、1 条不支持、1 条倒挂、1 条失败导致、1 条正常支持。 */
const POINTS = [
  { point_id: "BP-T1", point_type: BEHAVIOR_POINT_TYPE.SUPPORT, point_text: "行为发生在复购之前（聚合时序一致）", info_time_point: "2026-09-10 10:00" },
  { point_id: "BP-T2", point_type: BEHAVIOR_POINT_TYPE.UNSUPPORT, point_text: "两组人群获客渠道结构未完全对齐", info_time_point: "2026-09-10 11:00" },
  { point_id: "BP-T3", point_type: BEHAVIOR_POINT_TYPE.SUPPORT, point_text: "信息时点晚于取数时刻（倒挂）", info_time_point: "2026-09-25 10:00" },
  { point_id: "BP-T4", point_type: BEHAVIOR_POINT_TYPE.UNSUPPORT, point_text: "查询失败导致未完成", due_to_failure: true },
  { point_id: "BP-T5", point_type: BEHAVIOR_POINT_TYPE.SUPPORT, point_text: "入口维度人群原始特征可比", info_time_point: "2026-09-09 09:00" },
];

const ALTERNATIVES_ALL_PARTICIPATION = ALTERNATIVE_DIMENSIONS.map((d) => ({
  dimension: d, summary: `已有参与侧记录，不构成替代解释（${d}）`, evidence_kind: "participation",
}));

// ==================================================== ① TC-U-M4-001 综合分入池阈值（纯计算）
console.log("① TC-U-M4-001 · 综合分入池阈值（确定性、无随机）");
{
  const a = judgePoolThreshold({ composite_raw: 0.62, pool_threshold: 0.6 });
  assert(a.in_pool === true, `composite_raw=0.62 / pool_threshold=0.6 → in_pool=true（实测 ${a.in_pool}）`);
  const b = judgePoolThreshold({ composite_raw: 0.55, pool_threshold: 0.6 });
  assert(b.in_pool === false, `composite_raw=0.55 / pool_threshold=0.6 → in_pool=false（实测 ${b.in_pool}）`);
  const edge = judgePoolThreshold({ composite_raw: 0.6, pool_threshold: 0.6 });
  assert(edge.in_pool === true && edge.boundary === "inclusive" && POOL_BOUNDARY === "inclusive",
    "边界取闭区间：等于阈值即入池（确定性口径冻结）");
  assert(a.deterministic === true && typeof a.margin === "number", "标记确定性并给出与阈值的差值（可复核）");
  const again = judgePoolThreshold({ composite_raw: 0.62, pool_threshold: 0.6 });
  assert(again.in_pool === a.in_pool && again.margin === a.margin, "重复调用结果一致（无随机）");

  await assertThrows(() => judgePoolThreshold({ pool_threshold: 0.6 }), "缺 composite_raw → 报错", "composite_raw");
  await assertThrows(() => judgePoolThreshold({ composite_raw: 0.62 }), "缺 pool_threshold → 报错（不隐式取默认）", "pool_threshold");
  await assertThrows(() => judgePoolThreshold({ composite_raw: null, pool_threshold: 0.6 }), "composite_raw=null → 报错（Null 不静默变 0）", "composite_raw");
  await assertThrows(() => judgePoolThreshold({ composite_raw: "abc", pool_threshold: 0.6 }), "composite_raw 非数值 → 报错", "composite_raw");
}

// ==================================================== ② TC-A-M4-002 S-B2 人群可比性
console.log("\n② TC-A-M4-002 · S-B2 人群可比性检查（取人群特征与原有表现 → 差异是否已解释 → 结论＋限制）");
{
  const ok = checkPopulationComparability({
    candidate_group: "有二次找品行为的新客",
    comparison_group: "无该行为的新客",
    differences: [{ feature: "获客渠道结构", explained: true }, { feature: "消费力标签分布", explained: true }],
  });
  assert(ok.comparable === true && ok.basis === "derived_from_differences" && ok.unexplained.length === 0,
    `差异均已解释 → 可比基础成立（实测 ${ok.comparable}/${ok.basis}）`);
  assert(ok.restricts_behavior_judgement === false, "可比时不限制行为作用判断");
  assert(/可比性明确/.test(ok.stop_condition), `停止条件＝两组人群可比性明确（实测「${ok.stop_condition}」）`);

  const bad = checkPopulationComparability({
    differences: [{ feature: "消费力标签分布", explained: false, note: "家庭装组本身消费力更高" }],
  });
  assert(bad.comparable === false && bad.unexplained.join(",") === "消费力标签分布",
    `存在未解释差异 → comparable=false（实测 ${bad.comparable}）`);
  assert(bad.restricts_behavior_judgement === true, "差异未解释 → 限制行为作用判断（红线可运行）");
  assert(bad.limits.some((l) => /限制行为作用判断/.test(l)), "限制说明含「限制行为作用判断」原文口径");

  const none = checkPopulationComparability({});
  assert(none.comparable === null && none.basis === "undetermined", "无差异清单 → 可比性无法明确（不硬下「可比」结论）");
  assert(none.restricts_behavior_judgement === true, "可比性无法明确 → 同样限制行为作用判断");

  const given = checkPopulationComparability({
    comparability: { comparable: true, reason: "上游语义判断：入口维度人群结构对齐", signals: ["获客渠道已对齐"] },
  });
  assert(given.comparable === true && given.basis === "provided" && given.gated === true,
    "可比性语义判断可注入并采纳（source=provided，受 T-03/A-1 门禁）");
  assert(given.signals.length === 1, "信号如实透传（可扩展结构，不硬编码个数）");

  await assertThrows(() => checkPopulationComparability({ comparability: "yes" }), "comparability 形态非法 → 报错（不静默忽略）", "不合法");
  await assertThrows(() => checkPopulationComparability({ differences: "x" }), "differences 非数组 → 报错", "不合法");
  await assertThrows(() => checkPopulationComparability({ differences: [{}] }), "差异项缺 feature → 报错", "不合法");
}

// ==================================================== ③ TC-A-M4-003 S-B3 五查 + 倒挂隔离
console.log("\n③ TC-A-M4-003 · S-B3 候选行为五查（确认先后关系 → 对齐取数 → 查商品/活动/权益；倒挂仅该条失效）");
{
  assert(BEHAVIOR_CHECK_KEYS.join(">") === RESEARCH_CHECK_SEQUENCE.map((s) => s.check_key).join(">"),
    "五查键序＝F-19 查证顺序派生（单一真源，不复制第二份清单）");
  assert(BEHAVIOR_CHECK_KEYS.length === 5, `恰五查（实测 ${BEHAVIOR_CHECK_KEYS.length}）`);
  assert(ALTERNATIVE_DIMENSIONS.join(",") === "product,activity,benefit", "其他解释维度＝商品/活动/权益");

  await assertThrows(() => runBehaviorChecks({}), "缺 at（取数时刻）→ 报错", "at");

  const r = runBehaviorChecks({
    ...BASE,
    population: { differences: [{ feature: "获客渠道结构", explained: true }] },
    points: POINTS,
    behavior_at: "2026-08-01 00:00",
    result_at: "2026-09-01 00:00",
    metric: { expected: "30 天复购率（剔除退款订单）", observed: "30 天复购率（剔除退款订单）" },
    alternatives: [
      { dimension: "product", summary: "规格占比已核", evidence_kind: "participation" },
      { dimension: "activity", summary: "活动报名清单（仅存在性）", evidence_kind: "existence_only" },
    ],
  });

  assert(Object.keys(r.checks).join(">") === BEHAVIOR_CHECK_KEYS.join(">"), "五查逐项产出且键序与模板一致");
  assert(r.checks.population_comparability.comparable === true, "① 人群可比基础成立（差异已解释）");
  assert(r.checks.temporal_order.ordered === true && r.checks.temporal_order.batch_failed === false,
    "② 行为在结果之前（2026-08 行为 → 2026-09 结果），且非整包失败");
  assert(r.checks.metric_alignment.aligned === true, "③ 结果口径与目标版本登记口径一致");
  assert(r.checks.information_sufficiency.sufficient === false, "⑤ 存在未排除解释 / 缺口 → 依据不足以给确定判断");
  assert(r.checks.information_sufficiency.definite_judgement_allowed === false, "⑤ 不给确定判断（红线可运行）");
  assert(/不给确定判断/.test(r.checks.information_sufficiency.note), "⑤ 口径含「不给确定判断」原文");

  // —— 倒挂隔离：仅该条失效、非整包失败 ——
  assert(r.isolated_points.length === 1 && r.isolated_points[0].point_id === "BP-T3",
    `倒挂隔离：仅 BP-T3（信息时点 2026-09-25 晚于取数 2026-09-20）失效（实测 ${r.isolated_points.map((i) => i.point_id).join(",")}）`);
  assert(r.isolated_points[0].isolate_reason === "info_time_point_after_fetch", "倒挂原因回指信息时点晚于取数时刻");
  assert(r.checks.temporal_order.isolated_count === 1 && r.checks.temporal_order.kept_count === 4,
    `其余 4 条照常参与（实测 isolated=${r.checks.temporal_order.isolated_count} / kept=${r.checks.temporal_order.kept_count}）`);
  assert(!r.usable_points.some((p) => p.point_id === "BP-T3"), "倒挂条目不出现在可用条目里");

  // —— 失败不否定结论：失败导致的条目不得作否定依据 ——
  assert(r.failure_induced.length === 1 && r.failure_induced[0].point_id === "BP-T4" && r.failure_induced[0].usable_as_negation === false,
    "失败导致的条目：usable_as_negation=false（BRD §7 第 4 条）");
  assert(r.negation_allowed === false, "存在失败条目 → 整批标记不得据此否定");
  assert(r.open_gaps.some((g) => g.gap_key === "due_to_failure"), "失败条目不静默丢弃，转为信息缺口登记");
  assert(/不能当否定结论/.test(r.notes.failure_not_negation), "口径明示「失败不能当否定结论」");

  // —— 红线：活动存在 ≠ 用户参与；未排查的维度不得默认无关 ——
  const unex = r.unexcluded_alternatives.map((u) => `${u.dimension}:${u.reason}`);
  assert(unex.includes("activity:existence_only"), `活动仅有报名清单（存在性）→ 不得计为已排除（实测 ${unex.join(",")}）`);
  assert(r.unexcluded_alternatives.find((u) => u.dimension === "activity").note.includes("只证明有活动信息"),
    "口径回指 BRD「某活动存在只证明有活动信息，用户是否参与需对应记录」");
  assert(unex.includes("benefit:not_checked"), "权益维度未排查 → 不得默认无关（记为 not_checked）");
  assert(r.checks.alternative_explanations.excluded.some((e) => e.dimension === "product"), "商品维度有参与侧记录 → 已排除");

  // —— 红线：因果不臆断；未支持亦是完整结果 ——
  assert(r.causal_claim_allowed === false && /≠ 因果/.test(r.causal_note), "因果不臆断：同时出现 ≠ 因果（判据恒 false）");
  assert(r.status === BEHAVIOR_STATUS.NOT_SUPPORTED, `依据不足 → 状态「未找到足够依据支持」（实测 ${r.status}）`);
  assert(r.complete_result === true && r.is_failure === false, "未支持也是完整结果、不是失败（判据可运行）");
  assert(/完整结果/.test(r.notes.no_candidate_is_complete), "口径明示「未找到足够依据支持候选 HVA 也是完整结果」");
  assert(r.stopped === true && /五查完成或信息缺口已说明/.test(r.stop_condition), "停止条件＝五查完成或信息缺口已说明（S-B3）");

  // —— 反例：把已发生的结果当行为影响 ——
  const inverted = runBehaviorChecks({
    ...BASE,
    population: { differences: [{ feature: "获客渠道结构", explained: true }] },
    points: [{ point_id: "BP-R1", point_type: BEHAVIOR_POINT_TYPE.SUPPORT, point_text: "结果当作行为影响", used_as: "behavior_effect", stage: "result" }],
    behavior_at: "2026-08-01 00:00", result_at: "2026-09-01 00:00",
    metric: { expected: "m", observed: "m" },
    alternatives: ALTERNATIVE_DIMENSIONS.map((d) => ({ dimension: d, evidence_kind: "participation" })),
  });
  assert(inverted.checks.temporal_order.ordered === false && inverted.checks.temporal_order.violations.length === 1,
    "把已发生的结果当行为影响 → 先后关系不成立并记 violation（红线可运行）");

  // —— 反例：结果时点早于行为时点 ——
  const reversed = runBehaviorChecks({
    ...BASE,
    population: { differences: [{ feature: "x", explained: true }] },
    points: [], behavior_at: "2026-09-05 00:00", result_at: "2026-08-01 00:00",
    metric: { expected: "m", observed: "m" },
    alternatives: ALTERNATIVE_DIMENSIONS.map((d) => ({ dimension: d, evidence_kind: "participation" })),
  });
  assert(reversed.checks.temporal_order.ordered === false && reversed.open_gaps.some((g) => g.gap_key === "result_not_after_behavior"),
    "结果不晚于行为 → 先后关系不成立（不能把已发生的结果当行为影响）");

  // —— 反例：口径不一致 ——
  const mismatch = runBehaviorChecks({
    ...BASE,
    population: { differences: [{ feature: "x", explained: true }] },
    points: [], behavior_at: "2026-08-01 00:00", result_at: "2026-09-01 00:00",
    metric: { expected: "30 天复购率（剔除退款订单）", observed: "30 天复购率（含退款）" },
    alternatives: ALTERNATIVE_DIMENSIONS.map((d) => ({ dimension: d, evidence_kind: "participation" })),
  });
  assert(mismatch.checks.metric_alignment.aligned === false && mismatch.open_gaps.some((g) => g.gap_key === "metric_mismatch"),
    "口径不一致 → 记 metric_mismatch 缺口（口径不一方可比较）");

  // —— 正例：五查全通过 → 候选行为获得支持 ——
  const supported = runBehaviorChecks({
    ...BASE,
    population: { differences: [{ feature: "获客渠道结构", explained: true }] },
    points: [
      { point_id: "BP-S1", point_type: BEHAVIOR_POINT_TYPE.SUPPORT, point_text: "行为在前、复购在后", info_time_point: "2026-09-10 10:00" },
      { point_id: "BP-S2", point_type: BEHAVIOR_POINT_TYPE.UNSUPPORT, point_text: "仍属观察性结论，未做对照实验", info_time_point: "2026-09-10 11:00" },
    ],
    behavior_at: "2026-08-01 00:00", result_at: "2026-09-01 00:00",
    metric: { expected: "30 天复购率", observed: "30 天复购率" },
    alternatives: ALTERNATIVES_ALL_PARTICIPATION,
  });
  assert(supported.status === BEHAVIOR_STATUS.SUPPORTED && supported.checks.information_sufficiency.sufficient === true,
    `五查均通过 → 候选行为获得支持（实测 ${supported.status}）`);
  assert(supported.causal_claim_allowed === false, "即便获支持也不得表述为因果（观察性、未做干预验证）");
  assert(/仍属候选/.test(supported.status_reason), "获支持仍称「候选行为」（术语红线）");
}

// ==================================================== ④ TC-A-M4-006 缺比较条件 → 退回请补
console.log("\n④ TC-A-M4-006 · 边界·missing-field：缺比较条件 → 退回请补（不静默回退、不编造）");
{
  const full = evaluateComparisonGate(BASE);
  assert(full.action === "proceed" && full.resolved === true, `三项齐 → 放行取数（实测 ${full.action}）`);

  const partial = evaluateComparisonGate({ research_question: "q", population_limit: "搜索入口新客" });
  assert(partial.action === "request_supplement" && partial.resolved === false, `缺项 → 退回请补（实测 ${partial.action}）`);
  assert(partial.missing.join(",") === "observation_stage,result_metric", `缺项精确列出（实测 ${partial.missing.join(",")}）`);
  assert(partial.draft === null, "退回时不返回半成品（draft=null）");
  assert(partial.reasons.length === 2 && partial.reasons.every((x) => x.reason === "comparison_condition_missing"),
    "逐项给出请补理由（含缺哪一项）");
  assert(/不静默回退、不编造/.test(partial.note), "口径明示「不静默回退、不编造」");
  assert(typeof partial.guidance === "string" && partial.guidance.length > 0, "给出补齐指引");

  const noMaterial = evaluateComparisonGate({ ...BASE, materials_available: false });
  assert(noMaterial.action === "request_supplement" && noMaterial.reasons.some((x) => x.reason === "no_approved_material"),
    "查不到已过审素材 → 同样退回请补（引用证据须四要素齐全）");

  const all = evaluateComparisonGate({});
  assert(all.action === "request_supplement" && all.missing.length === 3, "三项全缺 → 三项全列出（不静默回退）");

  // —— 一步编排：退回请补时不进入五查、不写库 ——
  const gateFirst = assembleBehaviorVerification({ research_question: "q" });
  assert(gateFirst.outcome === "request_supplement" && gateFirst.written === false,
    "一步编排：比较条件不全时优先退回请补（不进入五查）");
  assert(gateFirst.checks === undefined, "退回时不含五查结果（不返回半成品判定）");

  const outPool = assembleBehaviorVerification({ ...BASE, composite_raw: 0.55, pool_threshold: 0.6 });
  assert(outPool.outcome === "out_of_pool" && outPool.pool.in_pool === false && outPool.written === false,
    "未入池 → 合法筛选结果：不进入五查、不写库");
  assert(/不是失败/.test(outPool.note), "未入池口径明示「不是失败」");
}

// ==================================================== ⑤ 落库路径：MD-09 / MD-10
console.log("\n⑤ 候选行为落库 · MD-09 + MD-10（支持 / 不支持并列成行；失败不下沉为否定条目）");
let formed = null;
let fixture = null;
{
  const { sqlite, db } = freshDb();
  const sub = await submitProposal(db, {
    opportunity_id: "OPP-012",
    research_question: "首单后二次找品是否为候选关键行为？",
    submitted_by: "PM（用例夹具）",
    at: "2026-09-20 09:00",
  });
  const created = await createHvaResearchTask(db, { proposal_id: sub.proposal.proposal_id });
  fixture = { task_id: created.task.task_id, proposal_id: sub.proposal.proposal_id };
  assert(typeof fixture.task_id === "string" && fixture.task_id.length > 0, `夹具：F-03 建议 → F-04 任务链（实测 ${fixture.task_id}）`);

  assert((await nextCandidateId(db)) === "CB-003", "取号：候选行为库内最大 +1（种子 CB-001/CB-002 → CB-003）");
  assert((await nextBehaviorPointId(db)) === "BP-011", "取号：条目库内最大 +1（种子至 BP-010 → BP-011）");

  const before = ["candidate_behavior", "behavior_point", "research", "task", "evidence", "opportunity", "research_proposal"].map((t) => countRows(sqlite, t));

  formed = await formCandidateBehavior(db, {
    ...BASE,
    research_no: "R-007",
    behavior_name: "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）",
    population: { differences: [{ feature: "获客渠道结构", explained: true }] },
    points: POINTS,
    behavior_at: "2026-08-01 00:00",
    result_at: "2026-09-01 00:00",
    metric: { expected: "30 天复购率（剔除退款订单）", observed: "30 天复购率（剔除退款订单）" },
    alternatives: [
      { dimension: "product", summary: "规格占比已核", evidence_kind: "participation" },
      { dimension: "activity", summary: "活动报名清单（仅存在性）", evidence_kind: "existence_only" },
    ],
  });

  assert(formed.outcome === "candidate_behavior" && formed.written === true, `落库产出候选行为（实测 ${formed.outcome}）`);
  assert(formed.candidate_id === "CB-003", `编号取自库内最大 +1（实测 ${formed.candidate_id}）`);
  assert(formed.behavior_status === BEHAVIOR_STATUS.NOT_SUPPORTED, `依据不足 → not_supported（实测 ${formed.behavior_status}）`);

  // 落库内容逐项核对
  const cb = sqlite.prepare("SELECT * FROM candidate_behavior WHERE candidate_id = ?").get("CB-003");
  assert(cb && cb.research_no === "R-007" && cb.behavior_status === "not_supported", "MD-09 行落库（研究归属 + 状态列）");
  assert(typeof cb.behavior_name === "string" && cb.behavior_name.includes("二次找品"), "MD-09 行为名称落库（仍称「候选行为」，不改名）");
  const pts = sqlite.prepare("SELECT * FROM behavior_point WHERE candidate_id = ? ORDER BY point_type, order_no").all("CB-003");
  assert(pts.length === formed.point_ids.length, `MD-10 条目数＝返回的 point_ids 数（实测 ${pts.length}）`);
  assert(pts.some((p) => p.point_type === "support") && pts.some((p) => p.point_type === "unsupport"),
    "支持 / 不支持并列成行（不支持也是完整合法产出）");
  assert(!pts.some((p) => /未完成/.test(p.point_text)), "失败导致的条目不下沉为不支持条目（转缺口，避免失败当否定）");
  assert(!pts.some((p) => /倒挂/.test(p.point_text)), "倒挂条目不落库（该条失效）");
  assert(pts.filter((p) => p.point_type === "support").every((p, i) => p.order_no === i + 1), "同立场下 order_no 从 1 连续（UK 口径）");
  assert(pts.filter((p) => p.point_type === "unsupport").every((p, i) => p.order_no === i + 1), "不支持侧 order_no 同样从 1 起");

  const after = ["candidate_behavior", "behavior_point", "research", "task", "evidence", "opportunity", "research_proposal"].map((t) => countRows(sqlite, t));
  assert(after[0] === before[0] + 1 && after[1] === before[1] + formed.point_ids.length,
    `只新增 MD-09/MD-10 行（实测 candidate_behavior ${before[0]}→${after[0]}、behavior_point ${before[1]}→${after[1]}）`);
  assert(JSON.stringify(after.slice(2)) === JSON.stringify(before.slice(2)),
    `research / task / evidence / opportunity / research_proposal 行数不变（实测 ${before.slice(2).join("/")} → ${after.slice(2).join("/")}）`);

  // 状态推进＝只改状态列、不改名
  const upd = await updateCandidateBehaviorStatus(db, { candidate_id: "CB-003", behavior_status: "candidate_supported" });
  assert(upd.changed === 1, "状态推进影响 1 行（单行更新）");
  const cb2 = sqlite.prepare("SELECT * FROM candidate_behavior WHERE candidate_id = ?").get("CB-003");
  assert(cb2.behavior_status === "candidate_supported" && cb2.behavior_name === cb.behavior_name,
    "只改状态列、不改名（DDL L262 注释口径）");
  assert(countRows(sqlite, "candidate_behavior") === after[0], "状态推进不新增行");

  // 读面与返回一致
  assert((await listCandidateBehaviors(db, { research_no: "R-007" })).some((x) => x.candidate_id === "CB-003"),
    "按研究反查候选行为（读面）");
  assert((await listBehaviorPoints(db, { candidate_id: "CB-003" })).length === pts.length, "按候选行为反查条目（读面）");

  // 前置守卫
  await assertThrows(() => formCandidateBehavior(db, { ...BASE, behavior_name: "x", points: [] }), "缺 research_no → 报错", "research_no");
  await assertThrows(() => formCandidateBehavior(db, { ...BASE, research_no: "R-007", points: [] }), "缺 behavior_name → 报错", "behavior_name");
  await assertThrows(
    () => formCandidateBehavior(db, { ...BASE, research_no: "R-NOPE", behavior_name: "x", points: [] }),
    "研究不存在 → 应用层守卫报错（库级 + 应用层双保险）", "研究不存在");

  // 退回请补 / 未入池都不写库
  const cBefore = countRows(sqlite, "candidate_behavior");
  const g = await formCandidateBehavior(db, { research_question: "q", research_no: "R-007", behavior_name: "x", points: [] });
  assert(g.outcome === "request_supplement" && g.written === false && countRows(sqlite, "candidate_behavior") === cBefore,
    "退回请补时**不写库**（行数不变）");
  const o = await formCandidateBehavior(db, { ...BASE, research_no: "R-007", behavior_name: "x", composite_raw: 0.5, pool_threshold: 0.6, points: [] });
  assert(o.outcome === "out_of_pool" && o.written === false && countRows(sqlite, "candidate_behavior") === cBefore,
    "未入池时**不写库**（行数不变）");
}

// ==================================================== ⑥ TC-D-M4-003 / TC-D-M4-004 库级约束反例
console.log("\n⑥ TC-D-M4-003 / TC-D-M4-004 · MD-09 外键 / MD-10 复合 UK 由库级拒绝");
{
  const { sqlite, db } = freshDb();

  const badFk = db.prepare(
    "INSERT INTO candidate_behavior (candidate_id, research_no, behavior_name, behavior_status) VALUES (?, ?, ?, ?)"
  ).bind("CB-BAD-FK", "R-NOPE", "候选行为", "candidate_supported").run();
  assert(badFk.success === false && /FOREIGN KEY/i.test(badFk.error || ""), `研究不存在 → FK 拒绝（实测「${badFk.error}」）`);
  assert(countRows(sqlite, "candidate_behavior") === 2, "反例未留下半截行（行数仍为种子基线 2）");

  const badPk = db.prepare(
    "INSERT INTO candidate_behavior (candidate_id, research_no, behavior_name, behavior_status) VALUES (?, ?, ?, ?)"
  ).bind("CB-001", "R-007", "重复编号", "candidate_supported").run();
  assert(badPk.success === false && /UNIQUE|PRIMARY/i.test(badPk.error || ""), `重复 candidate_id → PK 拒绝（实测「${badPk.error}」）`);

  const p1 = db.prepare(
    "INSERT INTO behavior_point (point_id, candidate_id, point_type, point_text, order_no) VALUES (?, ?, ?, ?, ?)"
  ).bind("BP-BAD-1", "CB-001", "support", "条目一", 1).run();
  assert(p1.success === false && /UNIQUE/i.test(p1.error || ""), `与种子既有 (CB-001, support, 1) 撞复合 UK（实测「${p1.error}」）`);

  const p2 = db.prepare(
    "INSERT INTO behavior_point (point_id, candidate_id, point_type, point_text, order_no) VALUES (?, ?, ?, ?, ?)"
  ).bind("BP-OK-1", "CB-001", "support", "同立场下一个新序号", 9).run();
  assert(p2.success === true, "同候选行为 + 同立场 + 新 order_no → 允许（UK 只卡三元组）");
  const p3 = db.prepare(
    "INSERT INTO behavior_point (point_id, candidate_id, point_type, point_text, order_no) VALUES (?, ?, ?, ?, ?)"
  ).bind("BP-OK-2", "CB-001", "support", "重复三元组", 9).run();
  assert(p3.success === false && /UNIQUE constraint failed: behavior_point/.test(p3.error || ""),
    `重复 (candidate_id, point_type, order_no) → 复合 UK 拒绝（实测「${p3.error}」）`);
  const p4 = db.prepare(
    "INSERT INTO behavior_point (point_id, candidate_id, point_type, point_text, order_no) VALUES (?, ?, ?, ?, ?)"
  ).bind("BP-BAD-3", "CB-NOPE", "support", "候选行为不存在", 1).run();
  assert(p4.success === false && /FOREIGN KEY/i.test(p4.error || ""), `候选行为不存在 → FK 拒绝（实测「${p4.error}」）`);

  // 应用层同步守卫：写入面对不存在研究 / 候选行为报错
  await assertThrows(
    () => formCandidateBehavior(db, { ...BASE, research_no: "R-NOPE", behavior_name: "x", points: [] }),
    "写入面：研究不存在 → 应用层报错", "研究不存在");
}

// ==================================================== ⑦ TC-I-M4-002 经 M5 只读查询 + 运行期零写
console.log("\n⑦ TC-I-M4-002 · 查询链路经 M5 只读（不调生产写）＋ 运行期零写");
{
  const { sqlite, db } = freshDb();
  await allow(db, "TOL-01", "CDP");

  const SENTINEL = "MODEL-FABRICATED-9.9";
  const tr = transportOf(defaultOk("cdp.crowd.query", "CDP"));
  const fact = await queryForBehaviorCheck(db, {
    check_key: "population_comparability",
    task_id: TASK, tool_id: "TOL-01", ...G,
    query_condition: { tag_expr: "new_customer_2026Q3 = true" }, at: AT,
    transport: tr,
    model_expectation: SENTINEL, // 刻意传入：证明模型预期不参与查询事实
  });
  assert(fact.verified === true && fact.result_status === "ok", `经 M5 取得真实返回 → verified=true（实测 ${fact.result_status}）`);
  assert(fact.via === "M5（runQueryWithRecovery）" && fact.read_only === true, "查询出口标注为 M5 只读链路（不另写查询面）");
  assert(typeof fact.query_id === "string" && /^Q-\d{5}$/.test(fact.query_id), `查询事实带 query_id 可回查（实测 ${fact.query_id}）`);
  assert(fact.source_id === "CDP" && fact.tool_code === "cdp.crowd.query", "来源与工具取自 M5 信封");
  assert(fact.persisted === true, "EXT-01 留痕由 M5 承接（F-20 不自建留痕）");
  assert(tr.calls.length === 1, `确实发起了一次外部调用（实测 ${tr.calls.length}）`);
  assert(!JSON.stringify(fact).includes(SENTINEL) && fact.used_model_expectation === false,
    "硬红线：模型预期哨兵串不出现在任何输出字段里（used_model_expectation=false）");
  assert(fact.check_key === "population_comparability", "查询归属五查之①（可逐查回溯）");

  await assertThrows(() => queryForBehaviorCheck(db, { check_key: "bogus", task_id: TASK, tool_id: "TOL-01", ...G, at: AT }),
    "check_key 不属五查键 → 报错（不静默忽略）", "不属五查键");

  // 未授权 → 受限且不发起外部调用（不产生生产写）
  const limited = transportOf(defaultOk("cdp.crowd.query", "CDP"));
  const noPerm = await queryForBehaviorCheck(db, {
    check_key: "information_sufficiency",
    task_id: TASK, tool_id: "TOL-02", grantee_type: "agent", grantee_ref: "qa-f20-other",
    at: AT, transport: limited,
  });
  assert(noPerm.verified === false && noPerm.result_summary === null,
    "无授权 → 不做「已验证」判定、不编造结论");
  assert(limited.calls.length === 0, `无授权时不发起外部调用（实测 ${limited.calls.length} 次）`);

  // —— 运行期零写：纯编排前后 MD-09/MD-10 行数不变 ——
  const before = ["candidate_behavior", "behavior_point"].map((t) => countRows(sqlite, t));
  judgePoolThreshold({ composite_raw: 0.62, pool_threshold: 0.6 });
  checkPopulationComparability({ differences: [{ feature: "x", explained: true }] });
  runBehaviorChecks({ ...BASE, population: { differences: [{ feature: "x", explained: true }] }, points: POINTS, behavior_at: "2026-08-01 00:00", result_at: "2026-09-01 00:00", metric: { expected: "m", observed: "m" }, alternatives: ALTERNATIVES_ALL_PARTICIPATION });
  evaluateComparisonGate(BASE);
  const g = await formCandidateBehavior(db, { research_question: "q", research_no: "R-007", behavior_name: "x", points: [] });
  assert(g.outcome === "request_supplement", "编排入口退回请补");
  const after = ["candidate_behavior", "behavior_point"].map((t) => countRows(sqlite, t));
  assert(JSON.stringify(before) === JSON.stringify(after),
    `纯编排与退回请补前后 MD-09/MD-10 行数不变（实测 ${before.join("/")} → ${after.join("/")}）`);

  // —— fake-db：取号走读面，发出的语句全为 SELECT（零写） ——
  const seen = [];
  const fakeDb = {
    prepare: (sql) => {
      seen.push(sql);
      return { bind: () => ({ all: () => ({ results: [] }), first: () => null, run: () => ({ success: true, meta: { changes: 0 } }) }) };
    },
  };
  const id1 = await nextCandidateId(fakeDb);
  const id2 = await nextBehaviorPointId(fakeDb);
  assert(id1 === "CB-001" && id2 === "BP-001", `空库取号从 001 起（实测 ${id1} / ${id2}）`);
  assert(seen.length === 2, `取号经读面发出语句（实测 ${seen.length} 条）`);
  assert(seen.every((s) => /^\s*SELECT/i.test(s)),
    `取号语句全为 SELECT（零写；实测非 SELECT ${seen.filter((s) => !/^\s*SELECT/i.test(s)).length} 条）`);
}

// ==================================================== ⑧ 静态核验
console.log("\n⑧ 静态核验 · behavior.js 零外部调用 / 零写语句 / 零裸 SQL / 口径全复用；behavior-store.js 写面收敛");
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "编排层无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  const writes = src.match(/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/gi) || [];
  assert(writes.length === 0, `编排层零写语句（实测 ${writes.length} 条）`);
  const selects = src.match(/\bSELECT\b/gi) || [];
  assert(selects.length === 0, `编排层零裸 SQL（SELECT 实测 ${selects.length} 条）`);

  const specs = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(specs.length === 3, `import 恰 3 条（实测 ${specs.join(", ") || "无"}）`);
  assert(specs.includes("./behavior-store.js"), "落库一律经 F-20 写入面 ./behavior-store.js（编排层不自带写语句）");
  assert(specs.includes("./verification.js"), "查询与倒挂口径复用 F-15（经 M5 的唯一出口，不另写查询面）");
  assert(specs.includes("./research-start.js"), "五查顺序与比较条件复用 F-19（不复制第二份清单）");
  assert(!specs.some((s) => /node:sqlite|node:fs|tool-executor/.test(s)),
    "不直接依赖 node:sqlite / node:fs / M5 模块（外部访问只经 F-15 出口）");
  assert(/runMetricVerification/.test(src), "取数确实委托给 F-15 `runMetricVerification`（可静态核对）");
  assert(/isolateContradictedEvidence/.test(src), "倒挂隔离确实复用 F-15（可静态核对，不重写一份）");
  assert(/resolveComparisonConditions/.test(src), "比较条件确实复用 F-19（可静态核对）");
  assert(/RESEARCH_CHECK_SEQUENCE\.map/.test(src), "五查键序由 F-19 常量**派生**（不内联第二份键表）");
  assert(!/INSERT INTO|UPDATE\s+\w+\s+SET/.test(src), "编排层不出现任何写语句形态");

  const storeSrc = stripComments(readFileSync(STORE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(storeSrc) && !/https?:\/\//.test(storeSrc), "写入面无外部 HTTP 调用");
  const targets = [...storeSrc.matchAll(/INSERT INTO\s+(\w+)/g)].map((m) => m[1]);
  assert(targets.every((t) => t === "candidate_behavior" || t === "behavior_point"),
    `写语句目标仅限 MD-09 / MD-10（实测 ${targets.join(", ")}）`);
  const updates = [...storeSrc.matchAll(/UPDATE\s+(\w+)/g)].map((m) => m[1]);
  assert(updates.length === 1 && updates[0] === "candidate_behavior", `唯一的改行语句只落在 candidate_behavior（实测 ${updates.join(",")}）`);
  assert(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/.test(storeSrc), "写入面绝不删行（候选行为与研究依据必须可回查）");
  assert(!/SELECT MAX|MAX\(/i.test(storeSrc), "写入面不写取号 SQL（取号在编排层用读面全量自算）");
  const storeSpecs = [...storeSrc.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(storeSpecs.length === 0, `写入面零 import（只依赖注入的 db；实测 ${storeSpecs.join(", ") || "无"}）`);
}

finish();
