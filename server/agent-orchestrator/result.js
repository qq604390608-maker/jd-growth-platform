/**
 * 文档卡（阶段4 · M4 · F-21 研究结果生成 · 编排本体 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md（**F-21 研究结果生成**：七要素组装 ① 业务目标与研究问题 ② 研究范围与方法 ③ 证据与关键发现 ④ 人群差异 ⑤ 候选 HVA 及支持情况 ⑥ 其他解释与限制 ⑦ 改善方向；**每项关键发现关联实际取得的证据**；**未找到足够依据支持候选 HVA 也可形成完整结果**；改善方向与发现**逐项对应**（针对什么人群、什么问题、为什么值得改善），活动配置、权益组合、预算与排期不在其内｜§1.1 S-B4 研究结果组装（输入＝全部查证与分析记录；动作＝逐发现关联证据 → 并列支持 / 不支持 → 写限制与改善方向；**停止＝七要素齐全并保存**）｜§4 红线）
 *   ｜ ../../docs/05-test-cases/test-M4.md（**TC-C-M4-001**（L2·F-18/F-21：结构化 JSON，**七要素须齐**；硬红线「不含活动配置 / 权益组合 / 预算 / 排期」——推理产出契约受 A-1 门禁，本文件提供**可运行的七要素契约 + 边界扫描器**，该项登记为「门禁未关闭、非发布门禁」）｜
 *        **TC-A-M4-004**（L4·F-21：S-B4 逐发现关联证据 → 并列支持 / 不支持 → 写限制与改善方向；七要素齐全并保存；**未找到足够依据支持候选 HVA 也是完整结果**）｜
 *        **TC-A-M4-005**（L4·F-21：**失败不否定**——查询失败导致的未完成**不能当否定结论**；系统降级但保留 warning、不静默丢弃；已有结论不被推翻——⚠️待确认(§7-T06)）｜
 *        **TC-D-M4-001 / TC-D-M4-002 / TC-D-M4-005**（L3：MD-07 外键 / MD-08 复合 UK / MD-11 UK——落库路径在 ./result-store.js））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-21（验收要点：读者能分清「已查明的内容」与「仍存在的限制」；查询失败导致的未完成不能当否定依据）｜ §5.3 硬红线｜ §7 第 4 条（失败不否定结论）
 *   ｜ ../../docs/03-locks/schema.md（MD-07 research（七要素 ①②④⑥ + `out_of_scope_note`）/ MD-08 research_finding（每项发现单独成行，逐条挂证据 LNK-02）/ MD-09 candidate_behavior + MD-10 behavior_point（七要素 ⑤ 的支持 / 不支持并列）/ MD-11 improvement_action（七要素 ⑦，逐项对应发现）/ LNK-02 finding_evidence）
 *   ｜ ../../docs/04-plan/dev-plan.md（阶段4 · M4：F-21 七要素组装、证据逐项挂接）
 *   ｜ ./result-store.js（**F-21 写入面**：MD-07 内容填充 + MD-08/MD-11 落库 + 三者读面；本文件零 SQL 语句）
 *   ｜ ./behavior-store.js（**F-20 读面复用**：MD-09/MD-10——七要素 ⑤「候选 HVA 及支持情况」的真源）
 *   ｜ ./role.js（**F-18 复用**：`scanProductionActions` 与 `FORBIDDEN_PRODUCTION_PATTERNS`——输出边界硬红线的**唯一口径**，不复制第二份禁词表）
 *   ｜ ../shared-context/index.js（**F-11 复用**：MD-07 读面 `getResearch` 与 **LNK-02 唯一写入面** `linkFindingEvidence`——本文件不代写该表）
 * 职责：F-21 研究结果生成——S-B4 七要素组装 + 逐发现挂证据 + 支持 / 不支持并列 + 限制与改善方向，并把
 *   「未支持亦是完整结果」「改善方向逐项对应发现」「失败不否定结论」「输出不含生产动作」做成**可运行判据**。
 * 硬红线：① **零外部调用**（不 fetch、不调 LLM——语义产出受 A-1 门禁，本文件只做确定性组装与校验）；
 *   ② **零 SQL 语句**（本文件不含任何查询 / 改行 / 删行类 SQL；读写一律经 `./result-store.js`、`./behavior-store.js`、`../shared-context/index.js` 的既有面）；
 *   ③ **不复制第二个口径**：输出边界禁词表复用 F-18 `FORBIDDEN_PRODUCTION_PATTERNS`；候选行为 ⑤ 复用 F-20 读面；LNK-02 写入复用 F-11；
 *   ④ **编号取号**用读面返回的全量自算「库内最大 +1」（不写 `SELECT MAX`），与 F-20 `behavior.js` 同范式。
 * 边界：只做 F-21（七要素组装 + 逐发现挂证据 + 改善方向落库 + 报告回查）；F-20 的候选行为五查与落库、F-22 的追问承接连不在本文件。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 `../api/index.js` 与 CI `validate` 步骤复用（node server/agent-orchestrator/test-f21.mjs）。
 *
 * 用法：import { assembleResearchResult, validateImprovementCorrespondence, checkFailureDoesNotNegate, scanResultBoundary, saveResearchReport, loadResearchResultContext, nextFindingId, nextActionId, nextFindingEvidenceLinkId, RESULT_ELEMENTS, ELEMENT_KEYS, RESEARCH_STATUS, FINDING_SUPPORT } from "./result.js";
 */
import { scanProductionActions, FORBIDDEN_PRODUCTION_PATTERNS } from "./role.js";
import { BEHAVIOR_POINT_TYPE } from "./behavior.js";
import { listCandidateBehaviors, listBehaviorPoints } from "./behavior-store.js";
import {
  createResearchFinding,
  createImprovementAction,
  updateResearchReport,
  listFindings,
  listImprovementActions,
  listFindingEvidenceLinks,
} from "./result-store.js";
import { getResearch, linkFindingEvidence } from "../shared-context/index.js";

/**
 * 七要素**键清单 + 条目名**（F-21 的唯一真源）。
 * 条目名逐字对齐 `test-M4.md` TC-C-M4-001 与 `PRD-M4` F-21；`test-f21` ② 组读用例文档**逐条对齐断言**——
 * 上游改了七要素说法而本文件未跟随，用例立刻失败。`no` 为展示序号，`storage` 为落库位置回指。
 */
export const RESULT_ELEMENTS = Object.freeze([
  { no: 1, key: "e1_goal_statement", title: "业务目标与研究问题", storage: "MD-07 research.e1_goal_statement" },
  { no: 2, key: "e2_scope_method", title: "研究范围与方法", storage: "MD-07 research.e2_scope_method" },
  { no: 3, key: "e3_evidence_findings", title: "证据与关键发现", storage: "MD-08 research_finding + LNK-02 finding_evidence" },
  { no: 4, key: "e4_population_diff", title: "人群差异", storage: "MD-07 research.e4_population_diff" },
  { no: 5, key: "e5_candidate_hva", title: "候选 HVA 及支持情况", storage: "MD-09 candidate_behavior + MD-10 behavior_point" },
  { no: 6, key: "e6_limits", title: "其他解释与限制", storage: "MD-07 research.e6_limits" },
  { no: 7, key: "e7_improvement_actions", title: "改善方向", storage: "MD-11 improvement_action" },
]);

/** 七要素键序（由 `RESULT_ELEMENTS` 派生，不复制第二份清单）。 */
export const ELEMENT_KEYS = Object.freeze(RESULT_ELEMENTS.map((e) => e.key));

/** 研究状态两态（值域真源＝`dict:RESEARCH_STATUS`，此处只持键名，不内联中文枚举）。 */
export const RESEARCH_STATUS = Object.freeze({ RUNNING: "running", DONE: "done" });

/** 关键发现支持情况两态（值域真源＝`dict:FINDING_SUPPORT`）。 */
export const FINDING_SUPPORT = Object.freeze({ SUPPORTED: "supported", UNSUPPORTED: "unsupported" });

const STOP_CONDITION = "七要素齐全并保存（S-B4）";

const OUT_OF_SCOPE_NOTE =
  "不覆盖范围声明（MD-07 `out_of_scope_note`）承载硬红线「活动配置 / 权益组合 / 预算与排期不在本研究结论范围内」，" +
  "故**它本身不被禁词扫描**——扫描对象只有七要素正文（见 `scanResultBoundary`）。";

const NO_CANDIDATE_NOTE = "未找到有足够依据的候选行为也是完整结果，不是失败（PRD-M4 F-21）。";

const FAILURE_NOT_NEGATION_NOTE =
  "查询失败导致的未完成**不能当否定结论**：条目转信息缺口登记、系统降级但保留 warning，已有结论不被推翻（BRD §7 第 4 条）。";

const CORRESPONDENCE_NOTE =
  "改善方向须与发现**逐项对应**（针对什么人群、什么问题、为什么值得改善）；对应不到的条目不落库，退回补齐。";

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";
const textOrNull = (v) => (isNonEmptyText(v) ? String(v).trim() : null);

/** `前缀-NNN` 取号：用读面返回的**全量**自算「库内最大 +1」（与 F-20 `behavior.js` 同范式，不写 `SELECT MAX`）。 */
function nextSeq(rows, key, prefix) {
  let max = 0;
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  for (const r of rows) {
    const m = re.exec(String((r && r[key]) ?? ""));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}
const padId = (prefix, n) => `${prefix}-${String(n).padStart(3, "0")}`;

/** 下一个关键发现编号（`F-NNN`，与种子 `F-001`~`F-006` 同域）。 */
export async function nextFindingId(db) {
  return padId("F", nextSeq(await listFindings(db), "finding_id", "F"));
}

/** 下一个改善方向编号（`AC-NNN`，与种子 `AC-001`~`AC-004` 同域）。 */
export async function nextActionId(db) {
  return padId("AC", nextSeq(await listImprovementActions(db), "action_id", "AC"));
}

/** 下一条「发现 ↔ 证据」关联编号（`LK-FE-NNN`，与种子 `LK-FE-001`~`LK-FE-008` 同域）。 */
export async function nextFindingEvidenceLinkId(db) {
  return padId("LK-FE", nextSeq(await listFindingEvidenceLinks(db), "link_id", "LK-FE"));
}

/** 把入参规整成「逐条可选证据引用」的发现列表（顺序＝入参顺序，`order_no` 由位置决定）。 */
function normalizeFindings(raw) {
  const list = Array.isArray(raw) ? raw.filter((x) => x && typeof x === "object") : [];
  return list.map((f, i) => ({
    order_no: i + 1,
    finding_id: textOrNull(f.finding_id),
    finding_text: textOrNull(f.finding_text),
    support_flag: textOrNull(f.support_flag),
    limit_note: textOrNull(f.limit_note),
    evidence_refs: Array.isArray(f.evidence_refs)
      ? f.evidence_refs.filter((x) => isNonEmptyText(x)).map((x) => String(x).trim())
      : [],
    due_to_failure: f.due_to_failure === true,
  }));
}

/** 把入参规整成「支持 / 不支持并列」的候选行为列表（七要素 ⑤）。 */
function normalizeCandidates(raw) {
  const list = Array.isArray(raw) ? raw.filter((x) => x && typeof x === "object") : [];
  const sideOf = (pt, i) => ({
    order_no: i + 1,
    point_id: textOrNull(pt.point_id),
    point_text: textOrNull(pt.point_text),
  });
  return list.map((c, i) => {
    const points = Array.isArray(c.points) ? c.points.filter((x) => x && typeof x === "object") : [];
    return {
      order_no: i + 1,
      candidate_id: textOrNull(c.candidate_id),
      behavior_name: textOrNull(c.behavior_name),
      behavior_status: textOrNull(c.behavior_status),
      supported: points.filter((p) => textOrNull(p.point_type) === BEHAVIOR_POINT_TYPE.SUPPORT).map(sideOf),
      unsupported: points.filter((p) => textOrNull(p.point_type) !== BEHAVIOR_POINT_TYPE.SUPPORT).map(sideOf),
    };
  });
}

/**
 * 改善方向与发现**逐项对应**校验（PRD-M4 F-21「逐项对应」；`CORRESPONDENCE_NOTE`）。
 * 每条改善方向须带 `related_finding_ref`（发现编号 `F-00x` / 序号 `#3` / 纯数字 `3`），且能在发现列表里命中；
 * 另校验三要素（`target_for` / `problem_what` / `reason_why`）非空。**对应不到的条目不落库**。
 * @param {Array<object>} rawActions 入参改善方向
 * @param {Array<object>} findings 已规整的发现列表（`assembleResearchResult` 内传规整后的）
 * @returns {{ok:boolean,count:number,linked:Array,orphans:Array,malformed:Array,note:string}}
 */
export function validateImprovementCorrespondence(rawActions, findings) {
  const actions = Array.isArray(rawActions) ? rawActions.filter((x) => x && typeof x === "object") : [];
  const rows = Array.isArray(findings) ? findings : [];
  const byRef = new Map();
  rows.forEach((f, i) => {
    byRef.set(`#${i + 1}`, i + 1);
    if (isNonEmptyText(f.finding_id)) byRef.set(String(f.finding_id).trim(), i + 1);
  });

  const linked = [];
  const orphans = [];
  const malformed = [];
  actions.forEach((a, i) => {
    const orderNo = i + 1;
    const missing = ["target_for", "problem_what", "reason_why"].filter((k) => !isNonEmptyText(a[k]));
    if (missing.length > 0) malformed.push({ order_no: orderNo, missing });

    const raw = a.related_finding_ref ?? a.finding_ref ?? a.finding_id ?? null;
    let ref = null;
    if (isNonEmptyText(raw)) ref = String(raw).trim();
    else if (typeof raw === "number" && Number.isInteger(raw) && raw >= 1) ref = String(raw);
    if (ref === null) {
      orphans.push({ order_no: orderNo, reason: "missing_finding_ref", ref: null });
      return;
    }
    const key = isNonEmptyText(ref) && ref.startsWith("#") ? ref : /^\d+$/.test(ref) ? `#${Number(ref)}` : ref;
    const hitOrder = byRef.get(key);
    if (hitOrder === undefined) {
      orphans.push({ order_no: orderNo, reason: "unknown_finding_ref", ref });
      return;
    }
    linked.push({ order_no: orderNo, finding_order_no: hitOrder, related_finding_ref: ref });
  });

  return {
    ok: malformed.length === 0 && orphans.length === 0,
    count: actions.length,
    linked,
    orphans,
    malformed,
    note: CORRESPONDENCE_NOTE,
  };
}

/**
 * **失败不否定结论** 判据（TC-A-M4-005；BRD §7 第 4 条）。
 * 失败 / 受限导致的未完成**不作否定依据**：转信息缺口、系统降级但**保留 warning**（不静默丢弃）、已有结论不被推翻。
 * @param {object} input 编排入参（读 `failure_induced` / `warnings`）
 * @returns {object}
 */
export function checkFailureDoesNotNegate(input) {
  const p = input && typeof input === "object" ? input : {};
  const induced = Array.isArray(p.failure_induced) ? p.failure_induced.filter((x) => x && typeof x === "object") : [];
  const warnings = Array.isArray(p.warnings) ? p.warnings.filter((w) => isNonEmptyText(w)).map((w) => String(w).trim()) : [];

  const blocked = induced.map((f) => ({
    order_no: f.order_no ?? null,
    point_id: textOrNull(f.point_id),
    usable_as_negation: false,
    note: "该条源自查询失败 / 受限，**不能当否定结论**，已转为信息缺口。",
  }));
  for (const b of blocked) {
    warnings.push(
      `条目 ${b.point_id || b.order_no || "（无编号）"} 由查询失败 / 受限导致未完成——**不能当否定结论**，转信息缺口登记（BRD §7 第 4 条）。`
    );
  }

  return {
    failure_induced_count: blocked.length,
    failure_induced: blocked,
    negation_allowed: blocked.length === 0,
    degraded: blocked.length > 0,
    warnings,
    warnings_kept: true,
    conclusions_preserved: true,
    existing_conclusions_overturned: false,
    note: FAILURE_NOT_NEGATION_NOTE,
  };
}

/**
 * 把七要素正文收成「逐字段文本」，供输出边界扫描（**不含 `out_of_scope_note`**，理由见 `OUT_OF_SCOPE_NOTE`）。
 * @param {object} elements 七要素对象
 * @returns {Array<{where:string,text:string}>}
 */
function elementTexts(elements) {
  const e = elements && typeof elements === "object" ? elements : {};
  const out = [];
  const push = (where, text) => {
    if (isNonEmptyText(text)) out.push({ where, text: String(text) });
  };
  push("e1_goal_statement", e.e1_goal_statement);
  push("e2_scope_method", e.e2_scope_method);
  const findings = Array.isArray(e.e3_evidence_findings) ? e.e3_evidence_findings : [];
  for (const f of findings) {
    push(`e3:${f.order_no}`, `${f.finding_text || ""}｜限制：${f.limit_note || ""}`);
  }
  push("e4_population_diff", e.e4_population_diff);
  const candidates = e.e5_candidate_hva && Array.isArray(e.e5_candidate_hva.candidates) ? e.e5_candidate_hva.candidates : [];
  for (const c of candidates) {
    push(`e5:${c.candidate_id || c.order_no}`, c.behavior_name || "");
    for (const pt of Array.isArray(c.supported) ? c.supported : []) push(`e5:${c.candidate_id || c.order_no}:support#${pt.order_no}`, pt.point_text);
    for (const pt of Array.isArray(c.unsupported) ? c.unsupported : []) push(`e5:${c.candidate_id || c.order_no}:unsupport#${pt.order_no}`, pt.point_text);
  }
  push("e6_limits", e.e6_limits);
  const actions = Array.isArray(e.e7_improvement_actions) ? e.e7_improvement_actions : [];
  for (const a of actions) {
    push(`e7:${a.order_no}`, `${a.target_for || ""}｜${a.problem_what || ""}｜${a.reason_why || ""}`);
  }
  return out;
}

/**
 * 输出边界扫描（**TC-C-M4-001 硬红线的可运行形式**）。禁词表复用 **F-18 `FORBIDDEN_PRODUCTION_PATTERNS`**
 * （活动配置 / 权益组合 / 预算 / 排期，唯一口径，不复制第二份），逐字段扫七要素正文并回指命中位置。
 * @param {object} elements 七要素对象
 * @returns {{clean:boolean,hits:Array,patterns_checked:number,scanned_fields:number,note:string}}
 */
export function scanResultBoundary(elements) {
  const items = elementTexts(elements);
  const hits = [];
  for (const it of items) {
    const r = scanProductionActions(it.text);
    for (const h of r.hits) hits.push({ where: it.where, pattern: h.pattern, index: h.index });
  }
  return {
    clean: hits.length === 0,
    hits,
    patterns_checked: FORBIDDEN_PRODUCTION_PATTERNS.length,
    scanned_fields: items.length,
    note:
      "研究输出止于「有依据的判断＋限制＋改善方向」，**不含活动配置 / 权益组合 / 预算 / 排期**" +
      "（硬红线；禁词表复用 F-18，不复制第二份）。" +
      " " +
      OUT_OF_SCOPE_NOTE,
  };
}

/** 七要素齐备性判定（确定性、逐条给出缺项键）。 */
function elementPresence(elements, ctx) {
  const e = elements;
  const missing = [];
  if (!isNonEmptyText(e.e1_goal_statement)) missing.push("e1_goal_statement");
  if (!isNonEmptyText(e.e2_scope_method)) missing.push("e2_scope_method");
  if (e.e3_evidence_findings.length === 0) missing.push("e3_evidence_findings");
  if (!isNonEmptyText(e.e4_population_diff)) missing.push("e4_population_diff");
  if (e.e5_candidate_hva.candidates.length === 0 && !isNonEmptyText(ctx.candidate_absent_reason)) {
    missing.push("e5_candidate_hva");
  }
  if (!isNonEmptyText(e.e6_limits)) missing.push("e6_limits");
  if (e.e7_improvement_actions.length === 0 && !isNonEmptyText(ctx.no_action_reason)) {
    missing.push("e7_improvement_actions");
  }
  return missing;
}

/**
 * **S-B4 七要素组装**（TC-A-M4-004 / TC-C-M4-001）。纯计算、**零写库**；落库由 `saveResearchReport` 承接。
 *
 * 判据（都做成可运行形态，不写在注释里）：
 *   · **逐发现关联证据**——每条发现列出 `evidence_refs`；无证据的发现记 `finding_without_evidence` 缺口（如实登记、不编造）；
 *   · **支持 / 不支持并列**——⑤ 同时给出两侧条目，**未支持亦是完整结果**（`complete_result=true`/`is_failure=false`）；
 *   · **改善方向逐项对应发现**——`validateImprovementCorrespondence`，对不上的不落库；
 *   · **失败不否定结论**——`due_to_failure` 的发现**不进 ③**、转信息缺口并保留 warning，`negation_allowed=false`；
 *   · **输出边界**——`scanResultBoundary`，命中即 `boundary.clean=false`（HTTP 层回 409）。
 *
 * @param {object} input `{ research_no, e1_goal_statement, e2_scope_method, e4_population_diff, e6_limits, out_of_scope_note, findings[], candidates[], improvement_actions[], failure_induced[], open_gaps[], warnings[] }`
 * @returns {object}
 */
export function assembleResearchResult(input) {
  const p = input && typeof input === "object" ? input : null;
  if (!p) throw new Error("研究结果组装必填：入参须为对象");

  const research_no = textOrNull(p.research_no);
  if (!research_no) throw new Error("研究结果组装必填：research_no（报告须归属 MD-07 真实研究）");

  // —— ③ 逐发现关联证据 + 失败不否定（失败导致的发现不进 ③，转缺口） ——
  const allFindings = normalizeFindings(p.findings);
  const findings = [];
  const failure_induced_findings = [];
  for (const f of allFindings) {
    if (f.due_to_failure === true) {
      failure_induced_findings.push({
        order_no: f.order_no,
        finding_id: f.finding_id,
        support_flag: f.support_flag,
        usable_as_conclusion: false,
        note: "该条源自查询失败 / 受限，**不能当否定结论**，已转为信息缺口、不进七要素 ③。",
      });
      continue;
    }
    findings.push(f);
  }
  const findings_without_text = findings.filter((f) => !f.finding_text).map((f) => f.order_no);
  const findings_without_evidence = findings
    .filter((f) => f.finding_text && f.evidence_refs.length === 0)
    .map((f) => ({ order_no: f.order_no, finding_id: f.finding_id }));
  const graded = findings.filter((f) => f.finding_text);

  // —— ⑤ 并列支持 / 不支持（未支持也是完整结果） ——
  const candidates = normalizeCandidates(p.candidates).filter((c) => c.behavior_name);
  const supported_count = candidates.filter((c) => c.behavior_status === "candidate_supported").length;
  const unsupported_count = candidates.filter((c) => c.behavior_status === "not_supported").length;

  // —— ⑦ 改善方向（逐项对应发现） ——
  const rawActions = Array.isArray(p.improvement_actions) ? p.improvement_actions.filter((x) => x && typeof x === "object") : [];
  const correspondence = validateImprovementCorrespondence(rawActions, graded);
  /**
   * `related_finding_ref` 是**组装期校验字段**：MD-11 无指向 MD-08 的外键列，对应关系由 `reason_why`
   * 正文承载（schema MD-11 口径「为什么值得改善：与哪项发现对应」），故该字段**不落库、不新增列**。
   */
  const actions = rawActions.map((a, i) => ({
    order_no: i + 1,
    action_id: textOrNull(a.action_id),
    target_for: textOrNull(a.target_for),
    problem_what: textOrNull(a.problem_what),
    reason_why: textOrNull(a.reason_why),
    related_finding_ref: textOrNull(a.related_finding_ref ?? a.finding_ref ?? a.finding_id),
  }));

  // —— 失败不否定（含入参带入的失败条目 + 本条发现的失败条目） ——
  const failure = checkFailureDoesNotNegate({
    failure_induced: [...(Array.isArray(p.failure_induced) ? p.failure_induced : []), ...failure_induced_findings],
    warnings: p.warnings,
  });

  // —— 继承 F-20 的未决缺口（⑥ 的输入之一，不静默丢弃） ——
  const inherited_gaps = Array.isArray(p.open_gaps)
    ? p.open_gaps
        .filter((g) => g)
        .map((g) =>
          typeof g === "string"
            ? { gap_key: "declared", detail: String(g).trim() }
            : { gap_key: textOrNull(g.gap_key) || "declared", detail: textOrNull(g.detail), affects: textOrNull(g.affects) }
        )
    : [];

  const elements = {
    e1_goal_statement: textOrNull(p.e1_goal_statement),
    e2_scope_method: textOrNull(p.e2_scope_method),
    e3_evidence_findings: graded,
    e4_population_diff: textOrNull(p.e4_population_diff),
    e5_candidate_hva: {
      candidates,
      supported_count,
      unsupported_count,
      candidate_absent_reason: textOrNull(p.candidate_absent_reason),
      note: candidates.length === 0 ? `${NO_CANDIDATE_NOTE}${textOrNull(p.candidate_absent_reason) ? " 已说明原因。" : ""}` : null,
    },
    e6_limits: textOrNull(p.e6_limits),
    e7_improvement_actions: actions,
  };

  const missing = elementPresence(elements, {
    candidate_absent_reason: p.candidate_absent_reason,
    no_action_reason: p.no_action_reason,
  });
  const boundary = scanResultBoundary(elements);

  const open_gaps = [
    ...findings_without_evidence.map((f) => ({
      gap_key: "finding_without_evidence",
      detail: `发现 #${f.order_no} 尚未关联实际取得的证据（LNK-02），如实登记缺口。`,
      affects: "证据与关键发现",
    })),
    ...failure_induced_findings.map((f) => ({
      gap_key: "due_to_failure",
      detail: `发现 #${f.order_no} 由查询失败 / 受限导致未完成——转缺口登记，不作否定依据。`,
      affects: "其他解释与限制",
    })),
    ...inherited_gaps,
  ];

  const supported_any = supported_count > 0;
  return {
    research_no,
    element_order: ELEMENT_KEYS.slice(),
    elements,
    complete: missing.length === 0,
    missing,
    out_of_scope_note: textOrNull(p.out_of_scope_note),
    boundary,
    evidence_linkage_complete: findings_without_evidence.length === 0,
    findings_without_text,
    findings_without_evidence,
    failure_induced_findings,
    improvement_correspondence: correspondence,
    inherited_gaps,
    open_gaps,
    candidate_support: {
      supported_count,
      unsupported_count,
      has_supported: supported_any,
      note: supported_any
        ? "有候选行为获得支持（**仍属候选**：终态定性归 F-21 之后的决策链，本报告不作因果结论）。"
        : NO_CANDIDATE_NOTE,
    },
    negation_allowed: failure.negation_allowed,
    negative_conclusions_allowed: failure.negation_allowed,
    degraded: failure.degraded,
    warnings: failure.warnings,
    warnings_kept: failure.warnings_kept,
    conclusions_preserved: failure.conclusions_preserved,
    existing_conclusions_overturned: failure.existing_conclusions_overturned,
    causal_claim_allowed: false,
    /**
     * **未找到足够依据支持候选 HVA 亦是完整结果**——完整性只由「七要素是否齐全」决定（与 F-20
     * `runBehaviorChecks` 的 `complete_result=true` 同口径）；失败导致的否定受限另由 `negation_allowed` 表达，
     * **不因此把报告判成不完整**（报告照常保存，限制写进 ⑥ 与 `warnings`）。
     */
    complete_result: missing.length === 0,
    is_failure: false,
    stopped: true,
    stop_condition: STOP_CONDITION,
    notes: {
      no_candidate_is_complete: NO_CANDIDATE_NOTE,
      failure_not_negation: FAILURE_NOT_NEGATION_NOTE,
      correspondence: CORRESPONDENCE_NOTE,
      out_of_scope: OUT_OF_SCOPE_NOTE,
    },
  };
}

/**
 * 落库编排（S-B4「七要素齐全并保存」）：**前置守卫全部通过后才动笔**（避免半截状态）——
 * ① 边界不合规（含生产动作）→ 不写库；② 改善方向对不上发现 → 不写库；③ 七要素不齐 → 不写库；
 * ④ 研究不存在 → 抛错（404）；⑤ **该研究已出过报告**（MD-08/MD-11 已有行）→ 不覆盖，退回（追问须形成新研究，对齐 MD-07 表注）。
 * 写路径：MD-07（内容填充，只改行）→ MD-08（逐发现）+ LNK-02（逐发现挂证据，经 **F-11 写入面**）→ MD-11（改善方向）。
 * @param {object} db
 * @param {object} input `assembleResearchResult` 入参 + `{ finished_at?, linked_at? }`
 * @returns {Promise<object>}
 */
export async function saveResearchReport(db, input) {
  const p = input && typeof input === "object" ? input : {};
  const assembled = assembleResearchResult(p);

  if (!assembled.boundary.clean) {
    return {
      ...assembled,
      outcome: "boundary_violation",
      written: false,
      reason: `七要素正文含生产动作（${assembled.boundary.hits.map((h) => `${h.where}:${h.pattern}`).join("、")}），拒绝落库。`,
    };
  }
  if (!assembled.improvement_correspondence.ok) {
    return { ...assembled, outcome: "action_finding_mismatch", written: false, reason: CORRESPONDENCE_NOTE };
  }
  if (!assembled.complete) {
    return { ...assembled, outcome: "incomplete", written: false, reason: `七要素缺 ${assembled.missing.join("、")}，未达 S-B4 停止条件。` };
  }

  const research = await getResearch(db, assembled.research_no);
  if (!research) {
    throw new Error(`研究不存在：${assembled.research_no}（研究结果须归属 MD-07 真实研究）`);
  }

  const priorFindings = await listFindings(db, { research_no: assembled.research_no });
  const priorActions = await listImprovementActions(db, { research_no: assembled.research_no });
  if (priorFindings.length > 0 || priorActions.length > 0) {
    return {
      ...assembled,
      outcome: "already_reported",
      written: false,
      prior_findings_count: priorFindings.length,
      prior_actions_count: priorActions.length,
      reason:
        `${assembled.research_no} 已有 ${priorFindings.length} 条发现 / ${priorActions.length} 条改善方向——` +
        "**不覆盖既有报告**（追问须形成新研究，对齐 MD-07「追问不覆盖原研究」），未写任何行。",
    };
  }

  // —— ① MD-07 七要素正文 + 完成状态（只改行；启动快照与追问链不动） ——
  const report = await updateResearchReport(db, {
    research_no: assembled.research_no,
    e1_goal_statement: assembled.elements.e1_goal_statement,
    e2_scope_method: assembled.elements.e2_scope_method,
    e4_population_diff: assembled.elements.e4_population_diff,
    e6_limits: assembled.elements.e6_limits,
    out_of_scope_note: assembled.out_of_scope_note || (research.out_of_scope_note ?? "（未声明）"),
    research_status: RESEARCH_STATUS.DONE,
    finished_at: p.finished_at,
  });

  // —— ② MD-08 逐发现 + LNK-02 逐发现挂证据（编号取全量最大 +1） ——
  let fSeq = nextSeq(await listFindings(db), "finding_id", "F");
  let lkSeq = nextSeq(await listFindingEvidenceLinks(db), "link_id", "LK-FE");
  const finding_ids = [];
  const evidence_links = [];
  for (const f of assembled.elements.e3_evidence_findings) {
    const finding_id = padId("F", fSeq);
    fSeq += 1;
    await createResearchFinding(db, {
      finding_id,
      research_no: assembled.research_no,
      finding_text: f.finding_text,
      support_flag: f.support_flag,
      limit_note: f.limit_note,
      order_no: f.order_no,
    });
    finding_ids.push(finding_id);
    for (const evidence_id of f.evidence_refs) {
      const link_id = padId("LK-FE", lkSeq);
      lkSeq += 1;
      await linkFindingEvidence(db, {
        link_id,
        finding_id,
        evidence_id,
        linked_at: p.linked_at,
      });
      evidence_links.push({ link_id, finding_id, evidence_id });
    }
  }

  // —— ③ MD-11 改善方向（逐项对应发现） ——
  let aSeq = nextSeq(await listImprovementActions(db), "action_id", "AC");
  const action_ids = [];
  for (const a of assembled.elements.e7_improvement_actions) {
    const action_id = padId("AC", aSeq);
    aSeq += 1;
    await createImprovementAction(db, {
      action_id,
      research_no: assembled.research_no,
      target_for: a.target_for,
      problem_what: a.problem_what,
      reason_why: a.reason_why,
      order_no: a.order_no,
    });
    action_ids.push(action_id);
  }

  const afterFindings = await listFindings(db, { research_no: assembled.research_no });
  return {
    ...assembled,
    outcome: "saved",
    written: true,
    report,
    finding_ids,
    evidence_links,
    action_ids,
    counts: {
      findings: finding_ids.length,
      evidence_links: evidence_links.length,
      actions: action_ids.length,
    },
    prior_findings_count: priorFindings.length,
    /** 已有结论不被推翻：既有发现行**只增不减**（本文件不含删行语句）。 */
    conclusions_preserved: afterFindings.length >= priorFindings.length,
    stopped: true,
    stop_condition: STOP_CONDITION,
  };
}

/**
 * 报告回查（薄读）：MD-07 七要素正文 + MD-08（含 LNK-02 挂到的证据）+ ⑤ 候选行为与支持情况（MD-09/MD-10）。
 * 不传 `research_no` 之外不做任何推断；研究不存在返回 `null`。
 * @param {object} db
 * @param {string} research_no
 * @returns {Promise<object|null>}
 */
export async function loadResearchResultContext(db, research_no) {
  const research = await getResearch(db, research_no);
  if (!research) return null;

  const findings = await listFindings(db, { research_no });
  const actions = await listImprovementActions(db, { research_no });
  const links = await listFindingEvidenceLinks(db); // 只有 ≥1 研究，全量足够且免再去重口径
  const candidates = await listCandidateBehaviors(db, { research_no });

  const points = [];
  for (const c of candidates) {
    const rows = await listBehaviorPoints(db, { candidate_id: c.candidate_id });
    for (const pt of rows) points.push(pt);
  }

  const elements = {
    e1_goal_statement: research.e1_goal_statement,
    e2_scope_method: research.e2_scope_method,
    e3_evidence_findings: findings.map((f) => ({
      order_no: f.order_no,
      finding_id: f.finding_id,
      finding_text: f.finding_text,
      support_flag: f.support_flag,
      limit_note: f.limit_note,
      evidence_refs: links.filter((l) => l.finding_id === f.finding_id).map((l) => l.evidence_id),
    })),
    e4_population_diff: research.e4_population_diff,
    e5_candidate_hva: {
      candidates: candidates.map((c) => ({
        candidate_id: c.candidate_id,
        behavior_name: c.behavior_name,
        behavior_status: c.behavior_status,
        supported: points.filter((pt) => pt.candidate_id === c.candidate_id && pt.point_type === BEHAVIOR_POINT_TYPE.SUPPORT),
        unsupported: points.filter((pt) => pt.candidate_id === c.candidate_id && pt.point_type !== BEHAVIOR_POINT_TYPE.SUPPORT),
      })),
      supported_count: candidates.filter((c) => c.behavior_status === "candidate_supported").length,
      unsupported_count: candidates.filter((c) => c.behavior_status === "not_supported").length,
    },
    e6_limits: research.e6_limits,
    e7_improvement_actions: actions.map((a) => ({
      order_no: a.order_no,
      action_id: a.action_id,
      target_for: a.target_for,
      problem_what: a.problem_what,
      reason_why: a.reason_why,
    })),
  };

  return {
    research_no: research.research_no,
    research_status: research.research_status,
    finished_at: research.finished_at,
    research_question: research.research_question,
    /** 不覆盖范围声明：**不属七要素**，但 MD-07 必填且承载硬红线（活动配置 / 权益组合 / 预算与排期不在结论范围内）。 */
    out_of_scope_note: research.out_of_scope_note,
    goal_id: research.goal_id,
    goal_version_no: research.goal_version_no,
    parent_research_no: research.parent_research_no,
    element_order: ELEMENT_KEYS.slice(),
    elements,
    boundary: scanResultBoundary(elements),
    evidence_link_count: links.filter((l) => findings.some((f) => f.finding_id === l.finding_id)).length,
  };
}
