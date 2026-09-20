#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M3 · F-16 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M3.md（**TC-A-M3-004**（L4·F-16：S-A4 对照已有机会判重 + 组装六要素 + 标未知项二态 +
 *        输出机会记录或缺口记录 + **没有足够依据也是合法产出**）｜
 *        **TC-A-M3-005**（L4·F-15/F-16：missing-field 只松不严不硬映射——缺键退回请补，不静默回退不编造）｜
 *        **TC-D-M3-001/002**（L3·F-16：MD-13/MD-14 约束——由 test-f13 覆盖，本文件不重复））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-16（依据足够 → 保存机会；相同问题关联更新；依据不足 → 保存检查范围与信息缺口）
 *   ｜ ../../docs/02-prd/PRD-M3-机会发现Agent.md §1.1.3 S-A4（机会整理与去重）｜ §4 红线 1（止于机会，不下 HVA 判断）
 *   ｜ ../../docs/03-locks/schema.md（MD-06 opportunity 六要素、LNK-03 opportunity_relation）
 *   ｜ ../../docs/07-decisions/ADR-003-机会六要素必填与未知项二态.md（NULL=未评估→不齐；''=已评估且确无→计入齐全；纯空白串=非法）
 *   ｜ ./opportunity.js（F-16 本体）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-16 用例并断言。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理）；**demo 数值一律不进断言**——
 *   只断「结果从真实返回透传 / 六要素落库形态 / 二态判定 / 关系方向 / 不写库」等结构性事实。
 * 边界：只验 F-16 的整理与去重编排；F-17 两步衔接（人工节点）归后续；M4 归阶段4 后半。
 * 反向清单：登记 ../agent-orchestrator/README.md 与 ../../server/README.md；被 CI `validate` 复用（node server/agent-orchestrator/test-f16.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f16.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  formOpportunityOrGap,
  nextOpportunityId,
  nextOpportunityRelationId,
  deriveOpportunityTitle,
  buildOpportunitySixElements,
  hasEnoughBasis,
  buildGapRecord,
  OPPORTUNITY_OUTCOMES,
  DEFAULT_RELATION_KIND,
  OPPORTUNITY_SOURCES,
  classifyOpportunitySource,
  judgeUnknownItemWrite,
} from "./opportunity.js";
import {
  getOpportunity,
  listOpportunities,
  listOpportunityRelations,
  assessOpportunitySixElements,
  UNKNOWN_ITEM_STATES,
} from "../shared-context/index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const OPP_SRC = new URL("./opportunity.js", import.meta.url);

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
const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

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
function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ *
 * 夹具：F-15 查证结果（`fact` / `checks` / `evidence.draft`）——F-16 的输入。
 * 全部为**结构性注入**（无随机、无外部调用）；数值仅为占位，不进「真实数值」类断言。
 * ------------------------------------------------------------------ */
const GOAL = { goal_id: "GOAL-2026Q3-01", goal_version_no: 3, business_scope: "主站频道" };

function okVerification({ matches = [], contradicted = false, scopeDecided = true, factOver = {} } = {}) {
  const fact = {
    ok: true,
    verified: true,
    query_id: "Q-T16-001",
    source_id: "SRC-01",
    tool_code: "cdp.crowd.query",
    result_summary: "占位返回摘要",
    info_time_point: "2026-09-16 10:00",
    applicability_scope: "主站频道；新客",
    query_condition: "频道=超市；人群=新客",
    missing_note: "",
    queried_at: "2026-09-18 09:00",
    fail_reason: null,
    ...factOver,
  };
  const checks = {
    checks: {
      source: { ok: true, query_id: fact.query_id, source_id: fact.source_id, tool_code: fact.tool_code, detail: "来源可回查" },
      applicability: {
        ok: scopeDecided,
        decided: scopeDecided,
        goal_scope: "主站频道",
        fact_scope_text: fact.applicability_scope,
        detail: scopeDecided ? "适用范围与目标一致" : "目标未声明范围，记未知",
      },
      info_time_point: {
        ok: !contradicted,
        inverted: contradicted,
        info_stamp: "2026-09-16 10:00",
        fetched_at: "2026-09-18 09:00",
        detail: contradicted ? "证据倒挂" : "信息时点未晚于取数时刻",
      },
      existing_opportunity: {
        ok: true,
        duplicate_suspected: matches.length > 0,
        matches,
        keywords: ["复购"],
        min_hits: 1,
        detail: matches.length > 0 ? "疑似重复" : "未发现重复",
      },
      gap: { ok: true, rules_checked: 3, open_gaps: [], missing_note: "", detail: "未发现待补项" },
    },
    decided: { source: true, applicability: scopeDecided, info_time_point: !contradicted, existing_opportunity: true, gap: true },
    all_present: scopeDecided && !contradicted,
    contradicted,
    verified: true,
    note: "五项检查为结构性标注",
  };
  const evidence = {
    ok: true,
    draft: {
      evidence_id: "EV-T16-001",
      query_id: fact.query_id,
      source_id: fact.source_id,
      evidence_title: "占位证据标题",
      query_condition: fact.query_condition,
      info_time_point: fact.info_time_point,
      applicability_scope: fact.applicability_scope,
      result_summary: fact.result_summary,
      missing_note: "",
      created_at: null,
    },
    note: "证据草稿待 F-16 采用",
  };
  return { verified: true, fact, checks, evidence, note: "已取得真实返回" };
}

function failVerification() {
  return {
    verified: false,
    fact: {
      ok: false,
      verified: false,
      query_id: null,
      source_id: "SRC-01",
      tool_code: "cdp.crowd.query",
      result_summary: null,
      info_time_point: null,
      applicability_scope: null,
      query_condition: null,
      missing_note: null,
      queried_at: "2026-09-18 09:00",
      fail_reason: "tool_call_failed",
    },
    checks: null,
    evidence: null,
    note: "未取得真实返回",
  };
}

const CLUE = {
  target_object: "人群：搜索进入新客 vs 首页推荐位进入新客 ｜ 旅程环节：首单入口",
  phenomenon: "搜索进入新客 30 天复购低于推荐位进入（占位数值）",
  research_reason: "入口差异可能对应需求明确度与后续行为模式差异",
  keywords: ["复购", "入口"],
  unknown_item: "",
};

// ==================================================== ① 依据足够 → 形成机会记录（MD-06）
console.log("① 依据足够 · S-A4 `formOpportunityOrGap` → `outcome=opportunity` 并落 MD-06（六要素 + 二态）");
{
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "opportunity");
  const beforeResearch = countRows(sqlite, "research");
  const beforeEvidence = countRows(sqlite, "evidence");

  const r = await formOpportunityOrGap(db, { goal: GOAL, clue: CLUE, verification: okVerification() });

  assert(r.outcome === OPPORTUNITY_OUTCOMES.OPPORTUNITY, "① outcome=opportunity");
  assert(r.opportunity_id === "OPP-015", `① 取号=OPP-015（库内最大 014 +1，实测 ${r.opportunity_id}）`);
  assert(r.relations.length === 0, "① 未命中已有机会 → 无关联关系");
  assert(r.gap_record === null, "① 形成机会时 gap_record 为空");
  assert(countRows(sqlite, "opportunity") === before + 1, `① MD-06 新增 1 行（实测 ${countRows(sqlite, "opportunity")}，改前 ${before}）`);
  assert(countRows(sqlite, "research") === beforeResearch, "① **不写 MD-07**：研究行数不变（F-16 止于机会）");
  assert(countRows(sqlite, "evidence") === beforeEvidence, "① **不写 EXT-02**：证据行数不变（证据落库归 F-15/F-09）");

  const row = await getOpportunity(db, "OPP-015");
  assert(row && row.goal_id === "GOAL-2026Q3-01", "① 六要素·对应目标 goal_id 落库");
  assert(Number(row.goal_version_no) === 3, "① 六要素·对应目标版本 goal_version_no=3");
  assert(row.target_object === CLUE.target_object, "① 六要素·涉及对象来自线索归属（人群｜旅程环节）");
  assert(row.phenomenon === CLUE.phenomenon, "① 六要素·观察现象来自线索");
  assert(row.research_reason === CLUE.research_reason, "① 六要素·研究理由来自线索");
  assert(
    typeof row.initial_basis_note === "string" && row.initial_basis_note.includes("Q-T16-001") && row.initial_basis_note.includes("SRC-01"),
    `① 六要素·初步依据含可回查的查询号与来源（实测「${row.initial_basis_note}」）`,
  );
  assert(row.unknown_item === "", "① 未知项二态：'' = 已评估且确无（ADR-003）");
  assert(row.opportunity_status === "candidate", `① 默认状态=candidate（dict:OPP_STATUS 码，实测 ${row.opportunity_status}）`);

  const a = assessOpportunitySixElements(row);
  assert(a.six_elements_complete === true, "① 六要素齐全＝六项都被评估过");
  assert(a.pending_supplement === false, "① 非待补（unknown_item 已评估）");
  assert(r.basis.enough === true, "① basis.enough=true");
  assert(r.basis.required.real_return === true, "① 必要条件·真实返回（不以模型预期代替查询结果）");
  assert(r.basis.required.source_traceable === true, "① 必要条件·来源可回查");
}

// ==================================================== ② 依据不足 → 缺口记录（不写库，合法产出）
console.log("\n② 依据不足 · 未取得真实返回 → `outcome=gap` + 缺口记录，且**不写任何表**（TC-A-M3-004 合法产出）");
{
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "opportunity");
  const beforeRel = countRows(sqlite, "opportunity_relation");

  const r = await formOpportunityOrGap(db, { goal: GOAL, clue: CLUE, verification: failVerification() });

  assert(r.outcome === OPPORTUNITY_OUTCOMES.GAP, "② outcome=gap（依据不足也是合法产出）");
  assert(r.opportunity_id === null, "② 不产机会 id");
  assert(r.gap_record !== null && typeof r.gap_record === "object", "② 返回缺口记录");
  assert(countRows(sqlite, "opportunity") === before, `② **不写 MD-06**（实测 ${countRows(sqlite, "opportunity")}＝改前 ${before}）`);
  assert(countRows(sqlite, "opportunity_relation") === beforeRel, "② **不写 LNK-03**");
  assert(r.basis.required.real_return === false, "② 必要条件·真实返回未满足 → 判不足");
  assert(r.basis.note.includes("依据不足"), `② basis.note 说明依据不足（实测「${r.basis.note}」）`);
}

// ==================================================== ③ ADR-003：unknown 未评估 → 判不齐 → 缺口
console.log("\n③ ADR-003 二态 · `unknown_item` 未评估（NULL）→ 六要素判**不齐** → 退回缺口记录");
{
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "opportunity");
  const clue2 = { ...CLUE };
  delete clue2.unknown_item; // 未提供 → NULL = 未评估

  const r = await formOpportunityOrGap(db, { goal: GOAL, clue: clue2, verification: okVerification() });

  assert(r.assessment.unknown_state === "not_assessed", "③ unknown_state=not_assessed（NULL）");
  assert(r.assessment.pending_supplement === true, "③ pending_supplement=true（触发待补）");
  assert(r.assessment.six_elements_complete === false, "③ 六要素不齐（未评估≠确无）");
  assert(r.outcome === OPPORTUNITY_OUTCOMES.GAP, "③ outcome=gap（不放过漏评估）");
  assert(countRows(sqlite, "opportunity") === before, "③ 不写库");
}

// ==================================================== ④ ADR-003：unknown 纯空白串 → 应用层显式拒
console.log("\n④ ADR-003 二态 · `unknown_item` 纯空白串 → 应用层**显式拒**（库级 NOT NULL 拦不住空白串）");
{
  const { db } = freshDb();
  await assertThrows(
    () => formOpportunityOrGap(db, { goal: GOAL, clue: { ...CLUE, unknown_item: "   " }, verification: okVerification() }),
    "④ 纯空白串 '   ' → 抛错（不静默降级为缺口）",
    "未知项",
  );
  const ok = await formOpportunityOrGap(db, { goal: GOAL, clue: { ...CLUE, unknown_item: "尚未核对两组人群可比性" }, verification: okVerification() });
  assert(ok.outcome === OPPORTUNITY_OUTCOMES.OPPORTUNITY, "④ 有实义未知项 → 正常形成机会（'有未知项'亦是合法态）");
  assert(ok.assessment.unknown_state === "has_unknown", "④ unknown_state=has_unknown");
  assert(ok.assessment.six_elements_complete === true, "④ 有未知项也计入齐全（可留待后续核对）");
}

// ==================================================== ⑤ 判重命中 → LNK-03 相同问题关联更新
console.log("\n⑤ 判重命中 · 与已有机会重复 → `linkOpportunityRelation` 落 LNK-03（same_issue，方向对齐种子 LK-OR-002）");
{
  const { sqlite, db } = freshDb();
  const beforeRel = countRows(sqlite, "opportunity_relation");
  const matches = [{ opportunity_id: "OPP-013", opportunity_status: "candidate", hits: ["复购"], hit_count: 1 }];

  const r = await formOpportunityOrGap(db, { goal: GOAL, clue: CLUE, verification: okVerification({ matches }) });

  assert(r.outcome === OPPORTUNITY_OUTCOMES.OPPORTUNITY, "⑤ 仍形成机会记录（新现象有独立价值 → 新机会）");
  assert(r.relations.length === 1, `⑤ 登记 1 条关联（实测 ${r.relations.length}）`);
  const rel = r.relations[0];
  assert(rel.relation_id === "LK-OR-003", `⑤ 取号=LK-OR-003（库内最大 002 +1，实测 ${rel.relation_id}）`);
  assert(rel.from_opportunity_id === "OPP-013", "⑤ from=已有机会（原机会 OPP-013）");
  assert(rel.to_opportunity_id === "OPP-015", "⑤ to=新机会（OPP-015）");
  assert(rel.relation_kind === DEFAULT_RELATION_KIND, "⑤ kind=same_issue（相同问题关联）");
  assert(countRows(sqlite, "opportunity_relation") === beforeRel + 1, "⑤ LNK-03 新增 1 行");

  const rows = await listOpportunityRelations(db, { opportunity_id: "OPP-015" });
  assert(rows.length === 1 && rows[0].relation_id === "LK-OR-003", "⑤ 关联可回查（按机会反查）");

  // 再跑一次（同一批 matches）：新机会是另一个 to → 关系 (from=OPP-013, to=OPP-016) 是新的一对，
  // 不撞复合 UK；复合 UK 的反例归 F-10（TC-D-M2-014，test-f10 覆盖），此处只证「按新机会逐个登记」。
  const again = await formOpportunityOrGap(db, { goal: GOAL, clue: CLUE, verification: okVerification({ matches }) });
  assert(again.opportunity_id === "OPP-016", `⑤ 再跑一次取号推进（实测 ${again.opportunity_id}）`);
  assert(
    again.relations.length === 1 && again.relations[0].from_opportunity_id === "OPP-013" && again.relations[0].to_opportunity_id === "OPP-016",
    "⑤ 关系按「已有机会 → 各自的新机会」逐个登记（方向口径稳定）",
  );
}

// ==================================================== ⑥ 取号（确定性、可回查）
console.log("\n⑥ 取号 · `nextOpportunityId` / `nextOpportunityRelationId`（库内最大 +1，3 位补零）");
{
  const { db } = freshDb();
  assert((await nextOpportunityId(db)) === "OPP-015", "⑥ nextOpportunityId=OPP-015");
  assert((await nextOpportunityRelationId(db)) === "LK-OR-003", "⑥ nextOpportunityRelationId=LK-OR-003");
}

// ==================================================== ⑦ 缺口记录结构（检查范围 + 信息缺口 + 影响判断）
console.log("\n⑦ 缺口记录 · `buildGapRecord` 输出「检查范围 + 信息缺口 + 影响哪项判断」");
{
  const { db } = freshDb();
  const r = await formOpportunityOrGap(db, { goal: GOAL, clue: CLUE, verification: failVerification() });
  const g = r.gap_record;

  assert(g.scope_checked.goal_id === "GOAL-2026Q3-01", "⑦ 检查范围·记录目标 id");
  assert(g.scope_checked.business_scope === "主站频道", "⑦ 检查范围·记录业务范围");
  assert(Array.isArray(g.scope_checked.keywords) && g.scope_checked.keywords.length === 2, "⑦ 检查范围·记录比对关键词");
  assert(g.info_gaps.length > 0, `⑦ 信息缺口非空（实测 ${g.info_gaps.length} 条）`);
  assert(g.info_gaps.some((x) => x.source === "query_failed"), "⑦ 缺口来源·未取得真实返回");
  assert(g.affected_judgements.length > 0, "⑦ 影响判断非空");

  const contradicted = await formOpportunityOrGap(db, {
    goal: GOAL,
    clue: CLUE,
    verification: okVerification({ contradicted: true }),
  });
  assert(contradicted.outcome === OPPORTUNITY_OUTCOMES.GAP, "⑦ 倒挂 → 判依据不足（不拿失效证据当依据）");
  assert(contradicted.gap_record.info_gaps.some((x) => x.source === "evidence_isolated"), "⑦ 缺口来源·证据倒挂隔离");
  assert(contradicted.basis.required.not_contradicted === false, "⑦ 必要条件·未倒挂 未满足");
}

// ==================================================== ⑧ 纯函数与「范围未判定不阻断」
console.log("\n⑧ 纯函数 · 标题派生 / 六要素组装 / 依据足够性 caveats（适用范围未判定不阻断）");
{
  const { db } = freshDb();
  assert(deriveOpportunityTitle({ phenomenon: "短现象" }) === "短现象", "⑧ 标题·取现象");
  assert(deriveOpportunityTitle({ opportunity_title: "显式标题", phenomenon: "现象" }) === "显式标题", "⑧ 标题·显式优先");
  assert(deriveOpportunityTitle({}) === null, "⑧ 标题·无来源→null");
  assert(deriveOpportunityTitle({ phenomenon: "甲".repeat(120) }).length === 80, "⑧ 标题·截断到 80 字");

  const six = buildOpportunitySixElements({ goal: GOAL, clue: CLUE, verification: okVerification() });
  assert(six.elements.goal_id === "GOAL-2026Q3-01" && Number(six.elements.goal_version_no) === 3, "⑧ 六要素·对应目标两列");
  assert(Object.keys(six.elements).includes("unknown_item"), "⑧ 六要素·未知项在装配结果中（单独二态）");

  const scopeUnknown = okVerification({ scopeDecided: false });
  const r = await formOpportunityOrGap(db, { goal: { goal_id: "GOAL-2026Q3-01", goal_version_no: 3 }, clue: CLUE, verification: scopeUnknown });
  assert(r.basis.caveats.scope_decided === false, "⑧ caveat·适用范围未判定（目标未声明范围）");
  assert(r.basis.enough === true, "⑧ **不阻断**：范围未判定不因此丢掉已成立的证据（记未知、不猜）");
  assert(r.outcome === OPPORTUNITY_OUTCOMES.OPPORTUNITY, "⑧ 仍形成机会记录，由人工节点复核范围");

  const basis = hasEnoughBasis({ verification: okVerification(), sixElements: buildOpportunitySixElements({ goal: GOAL, clue: CLUE, verification: okVerification() }) });
  assert(Object.keys(basis).sort().join(",") === "caveats,enough,note,required", "⑧ hasEnoughBasis 返回结构稳定");
}

// ==================================================== ⑨ 静态核验（零外部调用 / 零写语句 / 唯一依赖）
console.log("\n⑨ 静态核验 · 零外部调用 / 零写语句（写全委托 shared-context）/ 唯一业务 import");
{
  const raw = readFileSync(OPP_SRC, "utf8");
  const src = stripComments(raw);
  assert(!/\bfetch\s*\(/.test(src) && !/https?:\/\//.test(src), "⑨ 无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  const writes = src.match(/\b(INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/gi) || [];
  assert(writes.length === 0, `⑨ **零自有写语句**：写全委托 shared-context（实测命中 ${writes.length}）`);
  const selects = src.match(/\bSELECT\b/gi) || [];
  assert(selects.length === 0, `⑨ **零裸 SQL**：取号/判重走读面（实测 SELECT ${selects.length}）`);

  const importTargets = [...src.matchAll(/import\s*\{[\s\S]*?\}\s*from\s*"([^"]+)"/g)].map((m) => m[1]);
  assert(importTargets.length === 1, `⑨ 唯一 import 语句（实测 ${importTargets.length}）`);
  assert(importTargets[0] === "../shared-context/index.js", `⑨ 唯一依赖＝shared-context（实测 ${importTargets.join("、")}）`);

  const banned = ["../task-runner", "../tool-executor"];
  assert(!banned.some((b) => importTargets.some((t) => t.includes(b))), "⑨ 不反向依赖 task-runner / tool-executor");
}

// ==================================================== ⑩ ADR-003 §7 未知项写入策略（2026-09-20 用户裁决）
console.log("\n⑩ ADR-003 §7 · 未知项写入策略：空串态只允许 PM / 来源按 `producing_task_id` 区分（**不新增列**）");
{
  // 来源判定：producing_task_id 非空＝Agent 任务产出；空＝PM 补录
  assert(classifyOpportunitySource("T-1022") === OPPORTUNITY_SOURCES.AGENT, "⑩ producing_task_id='T-1022' → agent");
  assert(classifyOpportunitySource(null) === OPPORTUNITY_SOURCES.PM, "⑩ producing_task_id=null → pm");
  assert(classifyOpportunitySource(undefined) === OPPORTUNITY_SOURCES.PM, "⑩ 未提供 producing_task_id → pm（既有调用不受影响）");
  assert(classifyOpportunitySource("") === OPPORTUNITY_SOURCES.PM, "⑩ producing_task_id='' → pm（空串不算产出任务）");
  assert(classifyOpportunitySource("   ") === OPPORTUNITY_SOURCES.PM, "⑩ producing_task_id 纯空白 → pm");

  // ① 空串态（已评估且确无）：Agent 拒、PM 放行
  const agentNone = judgeUnknownItemWrite({ unknown_item: "", producing_task_id: "T-1022" });
  assert(agentNone.allowed === false, "⑩ §7-① Agent 路径写空串（确无未知项）→ 拒绝（Agent 不得自行结论）");
  assert(
    agentNone.source === "agent" && agentNone.state === UNKNOWN_ITEM_STATES.NONE_CONFIRMED,
    `⑩ 拒绝时来源=agent、态=none_confirmed（实测 ${agentNone.source}/${agentNone.state}）`
  );
  assert(
    judgeUnknownItemWrite({ unknown_item: "", producing_task_id: null }).allowed === true,
    "⑩ §7-① PM 路径写空串（确无未知项）→ 允许"
  );

  // 门禁只挡空串态，不误伤其他态
  assert(
    judgeUnknownItemWrite({ unknown_item: "样本量不足", producing_task_id: "T-1022" }).allowed === true,
    "⑩ Agent 路径写非空未知项 → 允许（门禁只挡空串态）"
  );
  assert(
    judgeUnknownItemWrite({ unknown_item: null, producing_task_id: "T-1022" }).allowed === true,
    "⑩ Agent 路径留 NULL（未评估）→ 允许，转待补而非拒写（不逼 Agent 编造未知项）"
  );

  // ② 防 NULL 规避：NULL → 待补 + 六要素不齐（既有口径 `pending_supplement`，此处锁定）
  const full = {
    opportunity_title: "t", goal_id: "G", goal_version_no: 1,
    target_object: "人群", phenomenon: "现象", initial_basis_note: "依据", research_reason: "理由",
  };
  const aNull = assessOpportunitySixElements({ ...full, unknown_item: null });
  assert(
    aNull.pending_supplement === true && aNull.six_elements_complete === false,
    "⑩ §7-② 防 NULL 规避：未评估 → pending_supplement 且六要素不齐（不静默通过）"
  );
  const aNone = assessOpportunitySixElements({ ...full, unknown_item: "" });
  assert(
    aNone.pending_supplement === false && aNone.six_elements_complete === true,
    "⑩ 空串态计入齐全——故才须限制谁可写（门禁的必要性）"
  );

  // 端到端：Agent 路径 + 空串 → 前置守卫抛错，且**不写库**（守卫在取号与写库之前，不留半截状态）
  const { sqlite, db } = freshDb();
  const before = countRows(sqlite, "opportunity");
  await assertThrows(
    () => formOpportunityOrGap(db, { goal: GOAL, clue: CLUE, verification: okVerification(), producing_task_id: "T-1022" }),
    "⑩ 端到端：Agent 路径（producing_task_id='T-1022'）+ 空串态 → 守卫抛错",
    "只允许 PM 写入"
  );
  assert(
    countRows(sqlite, "opportunity") === before,
    `⑩ 守卫在写库之前：**不写 MD-06**（实测 ${countRows(sqlite, "opportunity")}＝改前 ${before}）`
  );

  // 端到端：Agent 路径 + 非空未知项 → 正常落库（门禁不误伤）
  const { sqlite: s2, db: db2 } = freshDb();
  const b2 = countRows(s2, "opportunity");
  const r2 = await formOpportunityOrGap(db2, {
    goal: GOAL,
    clue: { ...CLUE, unknown_item: "尚未核对两组人群可比性" },
    verification: okVerification(),
    producing_task_id: "T-1022",
  });
  assert(r2.outcome === OPPORTUNITY_OUTCOMES.OPPORTUNITY, "⑩ 端到端：Agent 路径 + 非空未知项 → 正常形成机会（门禁不误伤）");
  assert(countRows(s2, "opportunity") === b2 + 1, `⑩ 该落库的落库（实测 ${countRows(s2, "opportunity")}，改前 ${b2}）`);
}

finish();
