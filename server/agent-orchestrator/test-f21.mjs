#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M4 · F-21 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M4.md（**TC-C-M4-001**（L2·F-18/F-21：结构化 JSON，**七要素须齐**——业务目标与研究问题 / 研究范围与方法 / 证据与关键发现 / 人群差异 / 候选 HVA 及支持情况 / 其他解释与限制 / 改善方向；**硬红线断言**：不含活动配置 / 权益 / 预算 / 排期——推理产出契约受 A-1 门禁，本执行器只验**可运行的七要素契约与边界扫描器**，该项登记为「门禁未关闭、非发布门禁」）｜
 *        **TC-D-M4-001**（L3·F-21：`MD-07 research.opportunity_id='OPP-NOPE'` → FK 失败——MD-07 **建行**面归 F-11 `../shared-context/index.js#createResearch`，本执行器经该面复现，F-21 不复制建行口径）｜
 *        **TC-D-M4-002**（L3·F-21：`MD-08 research_finding` 重复 `(research_no, order_no)` → 复合 UK 拒绝）｜
 *        **TC-D-M4-005**（L3·F-21：`MD-11 improvement_action` 重复 `(research_no, order_no)` → UK 拒绝）｜
 *        **TC-A-M4-004**（L4·F-21：S-B4 逐发现关联证据 → 并列支持 / 不支持 → 写限制与改善方向；七要素齐全并保存；**未找到足够依据支持候选 HVA 也是完整结果**）｜
 *        **TC-A-M4-005**（L4·F-21：**失败不否定**——查询失败导致的未完成不能当否定结论；系统降级但保留 warning、不静默丢弃；已有结论不被推翻——⚠️待确认(§7-T06)，故判据做成确定性规则））
 *   ｜ ../../docs/02-prd/PRD-M4-HVA分析Agent.md F-21（七要素组装；逐项挂证据；未支持亦完整；改善方向逐项对应；活动配置 / 权益组合 / 预算与排期不在其内）｜ §1.1 S-B4（停止＝七要素齐全并保存）｜ §4 红线
 *   ｜ ../../docs/01-brd/BRD.md §4 F-21（验收要点：读者能分清「已查明」与「仍受限」；失败导致的未完成不能当否定依据）｜ §5.3 硬红线｜ §7 第 4 条
 *   ｜ ../../docs/03-locks/schema.md（MD-07 / MD-08 / MD-11 / LNK-02；DDL L230 / L251 / L280 / L398）
 *   ｜ ./result.js（F-21 编排本体）｜ ./result-store.js（F-21 写入面）｜ ./role.js（F-18：禁词表唯一口径）｜ ./behavior.js + ./behavior-store.js（F-20：⑤ 候选行为真源）｜ ../shared-context/index.js（F-11：MD-07 读面 + LNK-02 唯一写入面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-21 用例并断言。
 * 夹具：用 F-03 `submitProposal` + F-04 `createHvaResearchTask` 造**真实任务链**，再用 F-11 `createResearch` 建**待出报告的研究壳**
 *   （**不手工拼任务行 / 不新增种子行**；MD-07 建行面属 F-11，F-21 只做内容填充）。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理）；**demo 数值不进断言**，只断结构与语义。
 * 边界：只验 F-21（七要素组装 + 逐发现挂证据 + 改善方向逐项对应 + 落库与回查）；F-20 五查与落库、F-22 追问承接连不在本执行器。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f21.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f21.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  assembleResearchResult,
  validateImprovementCorrespondence,
  checkFailureDoesNotNegate,
  scanResultBoundary,
  saveResearchReport,
  loadResearchResultContext,
  nextFindingId,
  nextActionId,
  nextFindingEvidenceLinkId,
  RESULT_ELEMENTS,
  ELEMENT_KEYS,
  RESEARCH_STATUS,
  FINDING_SUPPORT,
} from "./result.js";
import { createResearchFinding, createImprovementAction, updateResearchReport } from "./result-store.js";
import { FORBIDDEN_PRODUCTION_PATTERNS } from "./role.js";
import { createResearch, listResearchFindings, getResearch } from "../shared-context/index.js";
import { submitProposal } from "../task-runner/proposal.js";
import { createHvaResearchTask } from "../task-runner/hva.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./result.js", import.meta.url);
const STORE_SRC = new URL("./result-store.js", import.meta.url);
const TC_M4_PATH = new URL("../../docs/05-test-cases/test-M4.md", import.meta.url);
const PRD_M4_PATH = new URL("../../docs/02-prd/PRD-M4-HVA分析Agent.md", import.meta.url);

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

/** 记录语句的包装（证「回查只读」）：只透传 prepare，不改变语义。 */
function recordingDb(inner, log) {
  return {
    prepare: (sql) => {
      log.push(sql);
      return inner.prepare(sql);
    },
  };
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

/** 一条关键发现（含证据引用）的入参形态。 */
const finding = (text, refs, extra = {}) => ({
  finding_text: text,
  support_flag: FINDING_SUPPORT.SUPPORTED,
  limit_note: "限制：现有人群标签维度内成立",
  evidence_refs: refs,
  ...extra,
});

/** 齐备的七要素入参（纯计算用例的基准；`research_no` 由各用例覆盖）。 */
function baseInput(research_no = "R-F21-001") {
  return {
    research_no,
    e1_goal_statement: "业务目标：提升超市新客 30 天复购率｜研究问题：搜索进入新客复购更低是否因缺少首单后二次找品",
    e2_scope_method: "范围：主站 APP 端三品类新客 2026-07-01～2026-09-15；方法：入口维度分组比较 + 候选行为时序核查 + 其他解释排查",
    e4_population_diff: "有二次找品行为的新客 30 天复购率高于无该行为者，差异在三个品类方向上一致",
    e6_limits: "① 观察性分组，未做干预验证，行为与较好表现同时出现不等于因果；② 活动期仅有报名记录，「活动存在」不能推出「用户参与」",
    out_of_scope_note: "活动玩法配置、权益组合、预算与排期不在本研究结论范围内，需另行开展。",
    findings: [
      finding("入口维度两组新客的原有特征分布基本一致，可比基础成立", ["EV-1038"]),
      finding("候选行为发生在后续复购之前（聚合时序一致）", ["EV-1038", "EV-1041"]),
      finding("两组人群的活动覆盖情况基本一致，不构成主要替代解释", ["EV-1027"]),
    ],
    candidates: [
      {
        candidate_id: "CB-001",
        behavior_name: "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）",
        behavior_status: "candidate_supported",
        points: [
          { point_type: "support", point_text: "与后续复购存在稳定先后关系" },
          { point_type: "unsupport", point_text: "未逐人核时序，仅聚合推断" },
        ],
      },
    ],
    improvement_actions: [
      { target_for: "搜索进入的超市新客", problem_what: "首单履约后 7 日内缺少二次找品行为", reason_why: "该行为与后续复购存在稳定先后关系，是值得干预的前置环节", related_finding_ref: "#2" },
      { target_for: "研究本身", problem_what: "需补用户级行为明细接口", reason_why: "当前时序结论建立在聚合标签上，只有拿到明细才能确认先后关系", related_finding_ref: "3" },
      { target_for: "乳品烘焙方向新客", problem_what: "该方向行为差异最明显", reason_why: "作为首轮验证的优先人群", related_finding_ref: "F-XXX" },
    ],
    warnings: ["上游降级：CDP 本次只返回聚合结果"],
    open_gaps: [{ gap_key: "alternative_explanations", detail: "活动参与明细缺失（TOL-12 不存在）", affects: "其他解释" }],
  };
}

/** 把改善方向的 `related_finding_ref` 修到都能命中（基准入参的第 3 条故意引用不存在的发现）。 */
function fixedInput(research_no = "R-F21-001") {
  const p = baseInput(research_no);
  p.improvement_actions = p.improvement_actions.map((a, i) => ({ ...a, related_finding_ref: i === 2 ? "#1" : a.related_finding_ref }));
  return p;
}

// ==================================================== ① 七要素契约 + 上游逐条对齐
console.log("① 七要素契约 · 条目名与边界禁词与上游用例文档逐条对齐");
{
  assert(RESULT_ELEMENTS.length === 7, `七要素恰 7 项（实测 ${RESULT_ELEMENTS.length}）`);
  assert(RESULT_ELEMENTS.map((e) => e.no).join(",") === "1,2,3,4,5,6,7", "要素序号为 1~7 且有序");
  assert(ELEMENT_KEYS.join(">") === RESULT_ELEMENTS.map((e) => e.key).join(">"), "键序由 RESULT_ELEMENTS 派生（不复制第二份清单）");
  assert(RESULT_ELEMENTS.every((e) => e.storage.length > 0), "每项要素都带 storage 落库位置回指");

  const tc = readFileSync(TC_M4_PATH, "utf8");
  const line = tc.split("\n").find((l) => l.includes("TC-C-M4-001"));
  const m1 = /七要素须齐：(.+?)。/.exec(line || "");
  const names = m1 ? m1[1].split(" / ").map((s) => s.trim()) : [];
  assert(names.length === 7, `用例文档 TC-C-M4-001 列出七要素 ${names.length} 项（实测 ${names.join(" / ")}）`);
  assert(
    names.join(">") === RESULT_ELEMENTS.map((e) => e.title).join(">"),
    `七要素条目名与 TC-C-M4-001 **逐条相等**（实测 ${names.join(" / ")}）`
  );

  const m2 = /不含(.+?)。/.exec((line || "").split("硬红线断言")[1] || "");
  const forbidden = m2 ? m2[1].split("/").map((s) => s.replace(/\*\*/g, "").trim()) : [];
  assert(forbidden.length === FORBIDDEN_PRODUCTION_PATTERNS.length,
    `用例文档列出禁词 ${forbidden.length} 项、实现 ${FORBIDDEN_PRODUCTION_PATTERNS.length} 项（实测 ${forbidden.join("/")} ↔ ${FORBIDDEN_PRODUCTION_PATTERNS.join("/")}）`);
  /**
   * 用例文档在 L2 行里用了简写（「权益」），实现取自 PRD-M4 §1.1.2 第 7 条与 BRD §5.2 的完整说法（「权益组合」），
   * 故此处断「文档每一项都被实现口径**覆盖**」（是某个实现的**前缀**），而非逐字相等——差异已登记在本执行器文档卡。
   */
  assert(
    forbidden.every((w) => FORBIDDEN_PRODUCTION_PATTERNS.some((p) => p === w || p.startsWith(w))),
    `用例文档的禁词逐项被实现口径覆盖（实测 ${forbidden.map((w) => `${w}→${FORBIDDEN_PRODUCTION_PATTERNS.find((p) => p === w || p.startsWith(w)) || "未覆盖"}`).join("，")}）`
  );

  const prd = readFileSync(PRD_M4_PATH, "utf8");
  assert(/七要素组装/.test(prd) && /未找到足够依据支持候选 HVA 也可形成完整结果/.test(prd),
    "PRD-M4 F-21 仍声明「七要素组装」与「未支持亦可成完整结果」");
  assert(RESEARCH_STATUS.RUNNING === "running" && RESEARCH_STATUS.DONE === "done",
    `研究状态键名取自 dict:RESEARCH_STATUS（running/done）`);
  assert(FINDING_SUPPORT.SUPPORTED === "supported" && FINDING_SUPPORT.UNSUPPORTED === "unsupported",
    "发现支持情况键名取自 dict:FINDING_SUPPORT（supported/unsupported）");
}

// ==================================================== ② TC-C-M4-001 组合与硬红线扫描
console.log("\n② TC-C-M4-001 · 七要素组装与输出边界硬红线");
{
  const r = assembleResearchResult(baseInput());
  assert(r.element_order.length === 7 && r.element_order.join(">") === ELEMENT_KEYS.join(">"),
    "组装结果带 7 键且键序＝ELEMENT_KEYS");
  assert(r.complete === true && r.missing.length === 0, `七要素齐全（实测 missing=${JSON.stringify(r.missing)}）`);
  assert(r.boundary.clean === true, `七要素正文不含生产动作（实测 hits=${r.boundary.hits.length}）`);
  assert(r.boundary.patterns_checked === FORBIDDEN_PRODUCTION_PATTERNS.length,
    `扫描禁词数＝F-18 口径 ${FORBIDDEN_PRODUCTION_PATTERNS.length} 项（不复制第二份）`);
  assert(r.boundary.scanned_fields > 0, `确实扫到正文（实测 ${r.boundary.scanned_fields} 个字段）`);

  // 反例：正文含生产动作 → clean=false 且回指命中位置
  const bad = assembleResearchResult({ ...baseInput(), e6_limits: "建议把权益组合与排期一并给出" });
  assert(bad.boundary.clean === false, "正文含「权益组合 / 排期」→ clean=false（硬红线命中）");
  assert(bad.boundary.hits.some((h) => h.where === "e6_limits" && h.pattern === "权益组合"),
    `命中回指到具体字段与禁词（实测 ${bad.boundary.hits.map((h) => `${h.where}:${h.pattern}`).join("、")}）`);

  // out_of_scope_note 不参与扫描（它本身就是「不覆盖范围」声明，必然含这些词）
  const keep = scanResultBoundary({ ...assembleResearchResult(baseInput()).elements, e6_limits: "无" });
  assert(keep.clean === true, "不覆盖范围声明含「权益组合 / 预算 / 排期」**不影响 clean**（扫描对象只有七要素正文）");
  const note = assembleResearchResult(baseInput());
  assert(note.out_of_scope_note.includes("活动玩法配置") && note.boundary.clean === true,
    "MD-07 out_of_scope_note 原样透传且不触发硬红线");

  // 缺要素
  const thin = assembleResearchResult({ research_no: "R-006", e1_goal_statement: "仅有目标" });
  assert(thin.complete === false && thin.missing.length === 6, `缺要素如实列出（实测 ${thin.missing.join("、")}）`);
  assert(thin.complete_result === false, "七要素不齐 → 不构成完整结果");

  // ⑤ 允许「未找到候选行为」但要说明原因
  const noCand = assembleResearchResult({ ...baseInput(), candidates: [] });
  assert(noCand.missing.includes("e5_candidate_hva"), "无候选行为且未说明原因 → ⑤ 记为缺项");
  const noCandOk = assembleResearchResult({ ...baseInput(), candidates: [], candidate_absent_reason: "本轮未找到有足够依据的候选行为" });
  assert(noCandOk.complete === true && noCandOk.candidate_support.has_supported === false,
    "说明原因后 ⑤ 成立；且 **未找到候选行为亦是完整结果**（complete_result=true）");

  await assertThrows(() => assembleResearchResult(null), "入参非对象即拒", "须为对象");
  await assertThrows(() => assembleResearchResult({ findings: [] }), "缺 research_no 即拒", "research_no");
}

// ==================================================== ③ TC-A-M4-004 S-B4 逐发现挂证据 / 并列支持不支持
console.log("\n③ TC-A-M4-004 · S-B4 逐发现关联证据、并列支持 / 不支持、限制与改善方向");
{
  const r = assembleResearchResult(fixedInput());
  assert(r.elements.e3_evidence_findings.length === 3, `③ 逐条保留发现（实测 ${r.elements.e3_evidence_findings.length} 条）`);
  assert(r.elements.e3_evidence_findings.every((f) => f.order_no >= 1 && f.finding_text && f.limit_note),
    "每条发现都有正文与限制说明（读者据此分清「已查明」与「仍受限」）");
  assert(r.elements.e3_evidence_findings[1].evidence_refs.join(",") === "EV-1038,EV-1041",
    "逐发现挂接实际取得的证据（LNK-02 引用随条目保留）");
  assert(r.evidence_linkage_complete === true && r.findings_without_evidence.length === 0,
    "全部发现均已关联证据");

  const gap = assembleResearchResult({
    ...fixedInput(),
    findings: [finding("无证据的发现", []), finding("有证据的发现", ["EV-1038"])],
  });
  assert(gap.evidence_linkage_complete === false && gap.findings_without_evidence.length === 1,
    "无证据的发现如实登记缺口（不编造证据）");
  assert(gap.open_gaps.some((g) => g.gap_key === "finding_without_evidence"),
    `缺口进入 open_gaps（实测 ${gap.open_gaps.map((g) => g.gap_key).join("、")}）`);
  assert(gap.complete === true, "缺证据不阻断七要素齐全（缺则如实登记，不静默回退）");

  const c = r.elements.e5_candidate_hva;
  assert(c.supported_count === 1 && c.candidates[0].supported.length === 1 && c.candidates[0].unsupported.length === 1,
    "⑤ 支持与不支持**并列成行**（同一候选行为两侧都保留）");
  assert(r.improvement_correspondence.ok === true && r.improvement_correspondence.linked.length === 3,
    `⑦ 三条改善方向均与发现逐项对应（实测 linked=${r.improvement_correspondence.linked.length}）`);
  assert(r.elements.e7_improvement_actions.every((a) => a.target_for && a.problem_what && a.reason_why),
    "改善方向三要素齐全（针对什么人群 / 什么问题 / 为什么值得改善）");

  const noteOnly = assembleResearchResult({ ...fixedInput(), improvement_actions: [], no_action_reason: "本轮无值得改善项" });
  assert(noteOnly.complete === true && noteOnly.elements.e7_improvement_actions.length === 0,
    "⑦ 允许空列表（但须给 no_action_reason），仍算齐全");

  // 未支持亦完整结果
  const unsupported = assembleResearchResult({
    ...fixedInput(),
    candidates: [{ candidate_id: "CB-002", behavior_name: "首单购买家庭装", behavior_status: "not_supported",
      points: [{ point_type: "unsupport", point_text: "可比基础不成立，剔除消费力后差异收窄" }] }],
  });
  assert(unsupported.complete_result === true && unsupported.is_failure === false,
    "**未找到足够依据支持候选 HVA 也是完整结果**（complete_result=true / is_failure=false）");
  assert(unsupported.candidate_support.unsupported_count === 1 && unsupported.candidate_support.has_supported === false,
    "⑤ 未支持候选行为照常保留并计数");
  assert(unsupported.causal_claim_allowed === false, "因果不臆断：causal_claim_allowed 恒 false");

  // 逐项对应校验（纯函数直测）
  const findings7 = [{ finding_id: "F-901", finding_text: "a" }, { finding_text: "b" }];
  const good = validateImprovementCorrespondence([{ target_for: "x", problem_what: "y", reason_why: "z", related_finding_ref: "F-901" }], findings7);
  assert(good.ok === true && good.linked[0].finding_order_no === 1, "对应校验：按 finding_id 命中");
  const byIndex = validateImprovementCorrespondence([{ target_for: "x", problem_what: "y", reason_why: "z", related_finding_ref: 2 }], findings7);
  assert(byIndex.ok === true && byIndex.linked[0].finding_order_no === 2, "对应校验：按序号（数字 / #n）命中");
  const miss = validateImprovementCorrespondence([{ target_for: "x", problem_what: "y", reason_why: "z" }], findings7);
  assert(miss.ok === false && miss.orphans[0].reason === "missing_finding_ref", "对应校验：缺 ref 记 orphan");
  const unknown = validateImprovementCorrespondence([{ target_for: "x", problem_what: "y", reason_why: "z", related_finding_ref: "F-XXX" }], findings7);
  assert(unknown.ok === false && unknown.orphans[0].reason === "unknown_finding_ref", "对应校验：ref 命中不到记 orphan");
  const mal = validateImprovementCorrespondence([{ target_for: "x", related_finding_ref: 1 }], findings7);
  assert(mal.ok === false && mal.malformed[0].missing.join(",") === "problem_what,reason_why",
    `对应校验：三要素缺项记 malformed（实测 ${mal.malformed[0].missing.join(",")}）`);
  const empty = validateImprovementCorrespondence([], findings7);
  assert(empty.ok === true && empty.count === 0, "对应校验：空列表合法（配合 no_action_reason）");
}

// ==================================================== ④ TC-A-M4-005 失败不否定结论
console.log("\n④ TC-A-M4-005 · 失败不否定结论（降级保留 warning、已有结论不推翻）");
{
  const withFailure = assembleResearchResult({
    ...fixedInput(),
    failure_induced: [{ point_id: "BP-900", order_no: 9 }],
    findings: [...fixedInput().findings, finding("未能核对该项", [], { support_flag: FINDING_SUPPORT.UNSUPPORTED, due_to_failure: true })],
    open_gaps: [],
  });
  assert(withFailure.elements.e3_evidence_findings.length === 3,
    "失败导致的条目**不进 ③**（不落为发现，实测 3 条）");
  assert(withFailure.failure_induced_findings.length === 1, "失败导致的条目单列（实测 1 条）");
  assert(withFailure.failure_induced_findings[0].usable_as_conclusion === false,
    "失败导致的条目标 `usable_as_conclusion=false`");
  assert(withFailure.negation_allowed === false && withFailure.negative_conclusions_allowed === false,
    "**failure_induced 存在 → negation_allowed=false**（不能当否定依据）");
  assert(withFailure.degraded === true && withFailure.warnings_kept === true, "系统降级但保留 warning（不静默丢弃）");
  assert(withFailure.warnings.length >= 3, `warning 数 ≥ 入参 1 + 失败条目 1 + 场景 1（实测 ${withFailure.warnings.length}）`);
  assert(withFailure.warnings.some((w) => w.includes("不能当否定结论")), "warning 明写「不能当否定结论」");
  assert(withFailure.open_gaps.some((g) => g.gap_key === "due_to_failure"), "失败条目转信息缺口登记");
  assert(withFailure.existing_conclusions_overturned === false && withFailure.conclusions_preserved === true,
    "已有结论不被推翻（conclusions_preserved=true / overturned=false）");
  assert(withFailure.complete_result === true, "失败不把报告判成不完整（限制写进 ⑥ 与 warnings）");

  // 合法反例：**非失败**的「未支持」仍是完整结果
  const legit = assembleResearchResult({
    ...fixedInput(),
    findings: [...fixedInput().findings, finding("活动与权益对两组覆盖基本一致", ["EV-1027"], { support_flag: FINDING_SUPPORT.UNSUPPORTED })],
  });
  assert(legit.elements.e3_evidence_findings.length === 4, "非失败的「未支持」发现照常进 ③（合法产出）");
  assert(legit.negation_allowed === true && legit.degraded === false, "无非失败条目 → negation_allowed=true、未降级");
  assert(legit.complete_result === true, "非失败的「未支持」仍是完整结果");

  // 纯函数直测
  const c = checkFailureDoesNotNegate({ failure_induced: [{ point_id: "BP-901" }], warnings: ["w0"] });
  assert(c.failure_induced_count === 1 && c.negation_allowed === false && c.warnings.length === 2,
    `checkFailureDoesNotNegate 逐条转警告（实测 ${c.warnings.length} 条）`);
  const c0 = checkFailureDoesNotNegate({});
  assert(c0.negation_allowed === true && c0.degraded === false && c0.warnings.length === 0, "无失败条目 → 不降级、无警告");
  assert(c0.conclusions_preserved === true && c0.existing_conclusions_overturned === false, "结论保全两键恒真（可运行判据）");
}

// ==================================================== ⑤ 取号（库内最大 +1）
console.log("\n⑤ 编号取号（读面全量自算，不写 SELECT MAX）");
{
  const { sqlite, db } = freshDb();
  assert((await nextFindingId(db)) === "F-007", `关键发现取号＝种子最大 +1（实测 ${await nextFindingId(db)}）`);
  assert((await nextActionId(db)) === "AC-005", `改善方向取号＝种子最大 +1（实测 ${await nextActionId(db)}）`);
  assert((await nextFindingEvidenceLinkId(db)) === "LK-FE-009", `发现证据关联取号＝种子最大 +1（实测 ${await nextFindingEvidenceLinkId(db)}）`);
  assert(countRows(sqlite, "research_finding") === 6 && countRows(sqlite, "improvement_action") === 4,
    "取号不写库（种子行数 6 / 4 不变）");
}

// ==================================================== ⑥ L3 约束反例（TC-D-M4-001 / 002 / 005）
console.log("\n⑥ L3 约束反例 · MD-07 外键 / MD-08 复合 UK / MD-11 UK 由库级拒绝");
{
  const { sqlite, db } = freshDb();

  // TC-D-M4-001：MD-07 建行面（F-11 createResearch 所依赖的库级外键）——opportunity_id 指向不存在的机会
  const before = countRows(sqlite, "research");
  const badFk = db
    .prepare(
      "INSERT INTO research (research_no, opportunity_id, research_question, e1_goal_statement, e2_scope_method, " +
        "e4_population_diff, e6_limits, out_of_scope_note, research_status, goal_id, goal_version_no, created_at) " +
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    )
    .bind("R-F21-BAD", "OPP-NOPE", "q", "a", "b", "c", "d", "e", "running", "GOAL-2026Q3-01", 3, "2026-09-20 09:00")
    .run();
  assert(badFk.success === false && /FOREIGN KEY/i.test(badFk.error || ""),
    `TC-D-M4-001 · MD-07 research.opportunity_id='OPP-NOPE' → FK 拒绝（实测「${badFk.error}」；建行面属 F-11，F-21 不复制）`);
  assert(countRows(sqlite, "research") === before, `FK 失败不留半截行（实测 ${countRows(sqlite, "research")} 行）`);

  // TC-D-M4-002：MD-08 重复 (research_no, order_no) → 复合 UK（经 F-21 写入面，失败即抛）
  const okFinding = { finding_id: "F-T01", research_no: "R-007", finding_text: "x", support_flag: "supported", limit_note: "y", order_no: 99 };
  await createResearchFinding(db, okFinding);
  const after1 = countRows(sqlite, "research_finding");
  await assertThrows(
    () => createResearchFinding(db, { ...okFinding, finding_id: "F-T02" }),
    "TC-D-M4-002 · MD-08 重复 (research_no, order_no) → 复合 UK 拒绝（写入面 run() 失败即抛）",
    "UNIQUE"
  );
  assert(countRows(sqlite, "research_finding") === after1, "UK 拒绝不留半截行");

  // TC-D-M4-005：MD-11 重复 (research_no, order_no) → UK（经 F-21 写入面）
  const okAction = { action_id: "AC-T01", research_no: "R-007", target_for: "x", problem_what: "y", reason_why: "z", order_no: 99 };
  await createImprovementAction(db, okAction);
  const after2 = countRows(sqlite, "improvement_action");
  await assertThrows(
    () => createImprovementAction(db, { ...okAction, action_id: "AC-T02" }),
    "TC-D-M4-005 · MD-11 重复 (research_no, order_no) → UK 拒绝（写入面 run() 失败即抛）",
    "UNIQUE"
  );
  assert(countRows(sqlite, "improvement_action") === after2, "UK 拒绝不留半截行");

  // 前置守卫（应用层）：研究不存在 / order_no 非法 / 必填缺项
  await assertThrows(() => createResearchFinding(db, { ...okFinding, research_no: "R-NOPE", order_no: 1 }), "MD-08 前置守卫：研究不存在即拒（不让 FK 兜底）", "研究不存在");
  await assertThrows(() => createResearchFinding(db, { ...okFinding, order_no: "" }), "MD-08 order_no 空串被应用层拒（数值列库级拦不住空串）", "order_no");
  await assertThrows(() => createResearchFinding(db, { ...okFinding, order_no: null }), "MD-08 order_no=null 被应用层拒（不隐式取 0）", "order_no");
  await assertThrows(() => createResearchFinding(db, { ...okFinding, order_no: 0 }), "MD-08 order_no=0 即拒（须正整数）", "正整数");
  await assertThrows(() => createResearchFinding(db, { ...okFinding, order_no: true }), "MD-08 order_no=true 即拒（布尔不得被当成 1）", "正整数");
  await assertThrows(() => createResearchFinding(db, { research_no: "R-007" }), "MD-08 缺必填项即拒", "缺必填项");
  await assertThrows(() => createImprovementAction(db, { action_id: "AC-T09", research_no: "R-NOPE", target_for: "x", problem_what: "y", reason_why: "z", order_no: 1 }), "MD-11 前置守卫：研究不存在即拒", "研究不存在");
  await assertThrows(() => updateResearchReport(db, { research_no: "R-NOPE", e1_goal_statement: "a", e2_scope_method: "b", e4_population_diff: "c", e6_limits: "d", out_of_scope_note: "e", research_status: "done" }), "MD-07 内容填充前置守卫：研究不存在即拒（不静默 upsert）", "研究不存在");
}

// ==================================================== ⑦ 落库编排与回查（真实任务链夹具）
console.log("\n⑦ 落库编排（S-B4 七要素齐全并保存）与回查");
{
  const { sqlite, db } = freshDb();

  // 夹具：F-03 提交建议 → F-04 建 hva_research 任务 → F-11 建待出报告的研究壳（真真实调用链）
  const sub = await submitProposal(db, { opportunity_id: "OPP-012", research_question: "搜索进入新客复购更低，是缺少二次找品吗？", submitted_by: "PM", at: "2026-09-20 09:00" });
  const tk = await createHvaResearchTask(db, { proposal_id: sub.proposal.proposal_id });
  assert(typeof tk.task.task_id === "string" && tk.task.task_id.length > 0, `真实任务链建立（task=${tk.task.task_id}）`);
  await createResearch(db, {
    research_no: "R-F21-001", opportunity_id: "OPP-012", research_question: "搜索进入新客复购更低，是缺少二次找品吗？",
    e1_goal_statement: "（待出报告）", e2_scope_method: "（待出报告）", e4_population_diff: "（待出报告）",
    e6_limits: "（待出报告）", out_of_scope_note: "活动玩法配置、权益组合、预算与排期不在本研究结论范围内。",
    research_status: RESEARCH_STATUS.RUNNING, goal_id: "GOAL-2026Q3-01", goal_version_no: 3, start_task_id: tk.task.task_id,
  });
  assert((await getResearch(db, "R-F21-001")).research_status === RESEARCH_STATUS.RUNNING, "研究壳为 running（未出报告）");

  const before = {
    research: countRows(sqlite, "research"), finding: countRows(sqlite, "research_finding"),
    action: countRows(sqlite, "improvement_action"), link: countRows(sqlite, "finding_evidence"),
    task: countRows(sqlite, "task"),
  };

  // ① 七要素不齐 → 不写库
  const thin = await saveResearchReport(db, { research_no: "R-F21-001", e1_goal_statement: "只有目标" });
  assert(thin.outcome === "incomplete" && thin.written === false, `七要素不齐不写库（outcome=${thin.outcome}）`);
  // ② 含生产动作 → 不写库
  const dirty = await saveResearchReport(db, { ...fixedInput("R-F21-001"), e6_limits: "建议排期与预算一并确定" });
  assert(dirty.outcome === "boundary_violation" && dirty.written === false, `硬红线命中不写库（outcome=${dirty.outcome}）`);
  // ③ 改善方向对不上发现 → 不写库
  const orphan = await saveResearchReport(db, { ...baseInput("R-F21-001") });
  assert(orphan.outcome === "action_finding_mismatch" && orphan.written === false, `改善方向对不上发现不写库（outcome=${orphan.outcome}）`);
  // ④ 研究不存在 → 抛错（404）
  await assertThrows(() => saveResearchReport(db, fixedInput("R-NOPE")), "研究不存在即抛错（HTTP 层 404）", "研究不存在");
  assert(
    countRows(sqlite, "research") === before.research &&
      countRows(sqlite, "research_finding") === before.finding &&
      countRows(sqlite, "improvement_action") === before.action &&
      countRows(sqlite, "finding_evidence") === before.link,
    "前置守卫全过之前**一行未写**（无半截状态）"
  );

  // ⑤ 正常落库
  const saved = await saveResearchReport(db, {
    ...fixedInput("R-F21-001"), finished_at: "2026-09-20 15:00", linked_at: "2026-09-20 15:00",
  });
  assert(saved.outcome === "saved" && saved.written === true, `七要素齐全并保存（outcome=${saved.outcome}）`);
  assert(saved.counts.findings === 3 && saved.counts.actions === 3 && saved.counts.evidence_links === 4,
    `落库计数：发现 3 / 证据关联 4 / 改善方向 3（实测 ${JSON.stringify(saved.counts)}）`);
  assert(saved.finding_ids.join(",") === "F-007,F-008,F-009", `发现编号接种子最大 +1（实测 ${saved.finding_ids.join(",")}）`);
  assert(saved.action_ids.join(",") === "AC-005,AC-006,AC-007", `改善方向编号接种子最大 +1（实测 ${saved.action_ids.join(",")}）`);
  assert(saved.conclusions_preserved === true, "已有结论不被推翻（发现行只增不减）");

  const after = {
    research: countRows(sqlite, "research"), finding: countRows(sqlite, "research_finding"),
    action: countRows(sqlite, "improvement_action"), link: countRows(sqlite, "finding_evidence"),
    task: countRows(sqlite, "task"),
  };
  assert(after.research === before.research, "MD-07 只改行、不新建研究行");
  assert(after.finding === before.finding + 3 && after.action === before.action + 3 && after.link === before.link + 4,
    `只新增 MD-08 / MD-11 / LNK-02 行（实测 ${before.finding}→${after.finding} / ${before.action}→${after.action} / ${before.link}→${after.link}）`);
  assert(after.task === before.task, "不建任务行（F-21 不触发 M1 调度）");

  // 报告行内容与启动快照
  const row = sqlite.prepare("SELECT * FROM research WHERE research_no = 'R-F21-001'").get();
  assert(row.research_status === "done" && row.finished_at === "2026-09-20 15:00", "研究状态推进为 done 且记完成时点");
  assert(row.e1_goal_statement === fixedInput().e1_goal_statement && row.e6_limits === fixedInput().e6_limits,
    "七要素 ①⑥ 正文已填回");
  assert(row.opportunity_id === "OPP-012" && row.goal_version_no === 3 && row.start_task_id === tk.task.task_id && row.parent_research_no === null,
    "**启动快照与追问链未被改写**（opportunity_id / goal_version_no / start_task_id / parent_research_no 原样）");
  assert(row.out_of_scope_note.includes("不在本研究结论范围内") && !row.out_of_scope_note.includes("REPLACED"),
    "不覆盖范围声明原样保留");

  const md8 = sqlite.prepare("SELECT finding_id, order_no, support_flag FROM research_finding WHERE research_no='R-F21-001' ORDER BY order_no").all();
  assert(md8.length === 3 && md8.map((r) => r.order_no).join(",") === "1,2,3", `MD-08 逐条成行且顺序连续（实测 ${md8.map((r) => r.finding_id).join(",")}）`);
  assert(md8.every((r) => r.support_flag === "supported"), "MD-08 support_flag 取自 dict:FINDING_SUPPORT 域内值");
  const md11 = sqlite.prepare("SELECT action_id, order_no FROM improvement_action WHERE research_no='R-F21-001' ORDER BY order_no").all();
  assert(md11.length === 3 && md11.map((r) => r.action_id).join(",") === "AC-005,AC-006,AC-007", "MD-11 逐条成行（改善方向与发现逐项对应）");
  const lk = sqlite.prepare("SELECT link_id, finding_id, evidence_id, linked_at FROM finding_evidence WHERE finding_id IN ('F-007','F-008','F-009') ORDER BY link_id").all();
  assert(lk.length === 4 && lk[0].link_id === "LK-FE-009" && lk[0].linked_at === "2026-09-20 15:00",
    `LNK-02 逐发现挂证据且编号接种子最大 +1（实测 ${lk.map((l) => l.link_id).join(",")}）`);
  assert(lk.filter((l) => l.finding_id === "F-008").length === 2, "一条发现可挂多条证据（多对多）");

  // ⑥ 重复出报告 → 不覆盖（前置守卫，避免半截状态）
  const again = await saveResearchReport(db, fixedInput("R-F21-001"));
  assert(again.outcome === "already_reported" && again.written === false,
    `同一研究二次出报告被拒（outcome=${again.outcome}，防覆盖、防半截）`);
  assert(countRows(sqlite, "research_finding") === after.finding, "二次尝试一行未写");

  // 回查（只读）
  const log = [];
  const back = await loadResearchResultContext(recordingDb(db, log), "R-F21-001");
  assert(back !== null && back.research_status === "done", "回查报告：状态 done");
  assert(back.elements.e3_evidence_findings.length === 3 && back.evidence_link_count === 4,
    `回查 ③ 发现 3 条 + 证据关联 4 条（实测 ${back.elements.e3_evidence_findings.length} / ${back.evidence_link_count}）`);
  assert(back.elements.e7_improvement_actions.length === 3, "回查 ⑦ 改善方向 3 条");
  assert(back.element_order.length === 7 && back.boundary.clean === true, "回查给出完整七要素视图且边界干净");
  assert(back.out_of_scope_note.includes("不在本研究结论范围内"), "回查带出不覆盖范围声明");
  assert(log.length > 0 && log.every((s) => /^\s*SELECT/i.test(s)),
    `回查只读：语句全为 SELECT（实测 ${log.length} 条，非 SELECT ${log.filter((s) => !/^\s*SELECT/i.test(s)).length} 条）`);
  assert((await loadResearchResultContext(db, "R-NOPE")) === null, "研究不存在 → 回查返回 null");

  // 种子既有研究报告可直接回查（R-007 为 done，2 条发现 / 未支持候选行为）
  const seedBack = await loadResearchResultContext(db, "R-007");
  assert(seedBack.elements.e3_evidence_findings.length === 4 && seedBack.element_order.length === 7,
    `种子研究 R-007 回查可得 4 条发现（实测 ${seedBack.elements.e3_evidence_findings.length}）`);
  assert(seedBack.elements.e5_candidate_hva.supported_count === 1,
    `⑤ 回查候选行为支持情况：R-007 的候选行为已获支持（实测 supported_count=${seedBack.elements.e5_candidate_hva.supported_count}）`);
  assert(seedBack.elements.e5_candidate_hva.candidates[0].unsupported.length === 3 &&
    seedBack.elements.e5_candidate_hva.candidates[0].supported.length === 3,
    `⑤ 支持与不支持条目一并回查（实测 支持 ${seedBack.elements.e5_candidate_hva.candidates[0].supported.length} / 不支持 ${seedBack.elements.e5_candidate_hva.candidates[0].unsupported.length}）`);
  assert(listResearchFindings && typeof listResearchFindings === "function", "F-11 的 MD-08 历史回查只读面仍在（本模块新增的是取号读面）");
}

// ==================================================== ⑧ 静态核验
console.log("\n⑧ 静态核验 · result.js 零 SQL / 零外部调用 / 口径全复用；result-store.js 写面收敛");
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "编排层无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  const sqlWords = src.match(/\b(SELECT|INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/gi) || [];
  assert(sqlWords.length === 0, `编排层零 SQL 语句（含读语句；实测 ${sqlWords.join(",") || "0"} 条）`);
  assert(!/\bnode:sqlite\b|\bnode:fs\b|\btool-executor\b/.test(src), "编排层不依赖 node:sqlite / node:fs / M5 模块");

  const specs = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(specs.length === 5, `import 恰 5 条（实测 ${specs.join(", ")}）`);
  assert(specs.includes("./result-store.js"), "落库一律经 F-21 写入面 ./result-store.js");
  assert(specs.includes("../shared-context/index.js"), "MD-07 读面与 LNK-02 写入面复用 F-11（不代写该表）");
  assert(specs.includes("./behavior-store.js") && specs.includes("./behavior.js"), "⑤ 候选行为复用 F-20 读面与口径常量");
  assert(specs.includes("./role.js"), "输出边界禁词复用 F-18（唯一口径）");

  assert(/scanProductionActions/.test(src) && /FORBIDDEN_PRODUCTION_PATTERNS/.test(src), "硬红线扫描确实复用 F-18（可静态核对）");
  assert(/linkFindingEvidence/.test(src), "LNK-02 确实委托 F-11 `linkFindingEvidence`（不重写一份）");
  assert(/getResearch/.test(src), "MD-07 读面确实复用 F-11 `getResearch`");
  assert(/listCandidateBehaviors/.test(src) && /listBehaviorPoints/.test(src), "⑤ 确实读 F-20 写面（MD-09/MD-10）");
  assert(!/\bSELECT\s+MAX\b/i.test(src), "取号不写 `SELECT MAX`（用读面全量自算；`Math.max` 系编号计算，非 SQL）");

  const store = stripComments(readFileSync(STORE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(store) && !/https?:\/\//.test(store), "写入面无外部 HTTP 调用");
  const targets = [...store.matchAll(/INSERT INTO\s+(\w+)/g)].map((m) => m[1]);
  assert(targets.length === 2 && targets.every((t) => t === "research_finding" || t === "improvement_action"),
    `写语句目标仅限 MD-08 / MD-11（实测 ${targets.join(", ")}）`);
  const updates = [...store.matchAll(/UPDATE\s+(\w+)/g)].map((m) => m[1]);
  assert(updates.length === 1 && updates[0] === "research", `唯一的改行语句只落在 MD-07 research（实测 ${updates.join(",")}）`);
  assert(!/\bDELETE\b|\bDROP\b|\bTRUNCATE\b/.test(store), "写入面绝不删行（研究依据必须可回查）");
  const storeSpecs = [...store.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
  assert(storeSpecs.length === 0, `写入面零 import（只依赖注入的 db；实测 ${storeSpecs.join(", ") || "无"}）`);
  assert(!/INSERT INTO finding_evidence/.test(store), "LNK-02 的写入不落在本模块（唯一写入面＝F-11）");
}

finish();
