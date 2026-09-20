/**
 * F-22 继续追问承接（`server/agent-orchestrator/followup-intake.js`）
 * -----------------------------------------------------------------------------
 * 文档卡（阶段4 · M4 第五点 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md F-22（**继续追问承接**：PM 在已有研究上提新问题；
 *          Agent **检查已有依据是否仍适用**（时间范围、查询条件变化时补查），再决定**沿用或补查**；
 *          输入 → 输出：新问题＋原研究 → **新一轮结果**；验收要点：**追问形成新任务但保留原结果与依据**；
 *          关联 schema：MD-07 / PD-01 / PD-07 / MD-02；**依赖与衔接：上游＝M1 F-05，再触发本模块 F-19/F-20/F-21**）｜
 *        ../../docs/01-brd/BRD.md §4 F-22（同上，一行版）｜ §5.2 out of scope（活动配置 / 权益组合 / 预算与排期）｜
 *        §7 第 4 条（失败不否定结论）｜
 *        ../../docs/05-test-cases/test-M4.md **TC-I-M4-001**（L5 · F-22：**继续追问承接**——形成新任务但
 *          **保留原结果与依据**（关联 `parent_research_no`）；问题/范围修改后形成新版本，**已启动任务继续用启动时版本**）｜
 *        `TC-I-M2-004`（后续研究引用历史、避免重复研究 —— 经 M2 读面 `getResearchLineage`）｜
 *        ../../docs/03-locks/schema.md（MD-07 L230 / MD-08 L251 / MD-09 L262 / MD-10 L270 / MD-11 L280 /
 *          PD-01 L186 / PD-07 L376 / MD-02 L129 / LNK-02 L398 / EXT-02 L447）｜
 *        ../../docs/04-plan/dev-plan.md 阶段4 · M4（「M4 研究七要素……F-22 追问承接」；阶段4「把真 Agent 接进 M1 的调度回路」）｜
 *        ../task-runner/followup.js（**M1 F-05**：追问任务与新研究壳的**建行**面 —— 本文件只承接、不复制）｜
 *        ./result.js（**F-21 读面** `loadResearchResultContext`：原研究七要素与逐发现证据回指）｜
 *        ./role.js（**F-18**：输出边界禁词唯一口径 `FORBIDDEN_PRODUCTION_PATTERNS` + `scanProductionActions`）｜
 *        ./research-start.js（**F-19**：五查顺序 `RESEARCH_CHECK_SEQUENCE` + 比较条件口径 `resolveComparisonConditions`）｜
 *        ./verification.js（**F-15**：自由文本抽时点 `parseStamp`）｜
 *        ../shared-context/index.js（**M2 读面**：`getResearch` / `listResearch` / `listEvidenceByFinding` / `getEvidence`）｜
 *        ../task-runner/step-plan.js（**M1 读面**：`getTask` —— 任务版本 / 父任务 / 任务类型）
 * 职责：把「已有研究上提新问题」承接为**新一轮研究的入口**——① **原样保留**原结果与依据（只读，绝不改写）；
 *   ② **检查已有依据是否仍适用**（时间范围 / 查询条件 / 适用范围三类变化 → 沿用 or 补查）；
 *   ③ **版本口径**：追问可落在新版本，**原任务与原研究始终钉在启动时版本**；④ 交出**新一轮入口参数**
 *   （起点 S-B1 → F-19/F-20/F-21），并给出「沿用 / 补查」清单。
 * 硬红线（逐条做成可运行判据或可静态核对的形式）：
 *   ① **生产零写**：本文件**零写语句、零裸 SQL**（连 `SELECT` 都不写），全部经既有读面；运行期另做**前后自检**
 *      （`original_preserved`）——本步前后原研究读模型逐字节一致。
 *   ② **保留原结果与依据**（F-22 验收）：只读原研究 / 原任务 / 原依据；`preserved` 原样回带七要素、发现、证据、
 *      改善方向与追问链；`negates_original_conclusion` **恒 false** —— 补查 **≠** 否定原结论。
 *   ③ **已启动任务继续用启动时版本**：原任务与原研究的 `goal_version_no` 全步只读；同时校验「任务版本 ↔ 研究版本」
 *      一致（不一致**如实登记**，不静默）。
 *   ④ **失败不否定结论 / 不臆断沿用**（BRD §7 第 4 条）：**追问未声明变更时不做沿用也不做补查**——
 *      该语义判断受 A-1 门禁（LLM 未提供），登记为 `undetermined` 且 `llm_gated=true`；依据缺可比对字段时按
 *      **保守方向**记入补查（`severity='undetermined'`），**不默认沿用**。
 *   ⑤ **输出边界**（BRD §5.2）：追问文本命中禁词（活动配置 / 权益组合 / 预算 / 排期）时**提示但不拦截**
 *      （人工节点的提问不归本步否决），禁词表复用 F-18，不复制第二份。
 *   ⑥ **不在本步执行下游**：新一轮的实际执行自 S-B1 起（F-19→F-20→F-21）；本步只**交出入口参数**，
 *      下游派发走**可注入端口**（未注入＝不触发，与 F-17「只组装不触发」同款）。
 * 边界：MD-07 **建行**归 M1 F-05 `createFollowupTask`；PD-07 **写入**归 M1 F-05 `recordFollowupMessage`；
 *   MD-02 新版本行**建行**归 M1 F-01；本文件一概不写。**PD-07 目前无读面** ——
 *   追问问题文本由调用方（M6 F-31 追问对话 / M1）传入，缺省从「追问研究行」的 `research_question` 取，
 *   取不到即 `null`（**不编造**）；已登记为待补读面，见 `./README.md` §9。
 * 反向清单：登记 ./README.md（文件清单 / 用例表 / 路由 / 口径）与 ../../README.md（模块进度 / api 行 / 模块表）；
 *   被 ../api/index.js 的 F-22 路由复用；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f22.mjs）。
 *
 * 用法：import { intakeFollowup, loadFollowupIntakeContext, assessEvidenceReuse, parseCoverage,
 *              REUSE_DECISIONS, CHANGE_DIMENSIONS, NEXT_ROUND_CHAIN } from "./followup-intake.js";
 * -----------------------------------------------------------------------------
 */

import { loadResearchResultContext } from "./result.js";
import { FORBIDDEN_PRODUCTION_PATTERNS, scanProductionActions } from "./role.js";
import { RESEARCH_CHECK_SEQUENCE, resolveComparisonConditions } from "./research-start.js";
import { parseStamp } from "./verification.js";
import { getEvidence, getResearch, getResearchLineage, listEvidenceByFinding, listResearch } from "../shared-context/index.js";
import { getTask } from "../task-runner/step-plan.js";

const norm = (s) => (s == null ? "" : String(s).trim());
const isNonEmptyText = (s) => norm(s).length > 0;

/** 承接入口守卫用：追问任务的 `PD-01.task_type`（与 M1 F-05 `createFollowupTask` 同款值）。 */
export const FOLLOWUP_TASK_TYPE = "hva_followup";

/** 依据复用判定三态：沿用 / 补查 / 未决（「缺信息」不等于「可沿用」）。 */
export const REUSE_DECISIONS = Object.freeze({
  REUSE: "reuse",
  SUPPLEMENT: "supplement",
  UNDETERMINED: "undetermined",
});

/** 追问可能改变的三类维度（BRD F-22：「时间范围、查询条件变化时补查」）。 */
export const CHANGE_DIMENSIONS = Object.freeze([
  { key: "time_range", label: "时间范围" },
  { key: "query_condition", label: "查询条件" },
  { key: "applicability_scope", label: "适用范围" },
]);

/**
 * 适用范围的相对关系（**能定则定**）：新范围「更窄」时原依据仍在覆盖内 → 可沿用；
 * 更宽 / 不相交 / 未声明关系 → 一律保守记补查（不猜）。
 */
export const SCOPE_RELATIONS = Object.freeze({
  SAME: "same",
  NARROWER: "narrower",
  WIDER: "wider",
  DISJOINT: "disjoint",
});

/** 依据复用判定的严重度：`required`＝必补查；`undetermined`＝无法判定（保守补查）；`ok`＝沿用。 */
export const REUSE_SEVERITIES = Object.freeze({ OK: "ok", REQUIRED: "required", UNDETERMINED: "undetermined" });

/** 再做一轮的下游链（PRD-M4 F-22「再触发本模块 F-19/F-20/F-21」）。 */
export const NEXT_ROUND_CHAIN = Object.freeze(["F-19", "F-20", "F-21"]);

/** 新一轮起点（S-B1 研究起点处理，F-19）。 */
export const NEXT_ROUND_ENTRY = "S-B1";

/** 停止条件：承接完成即停（与 F-19「路径确定即停止」同精神，本步不越界执行）。 */
export const STOP_CONDITION =
  "承接完成即停止：本轮只判定「沿用 / 补查」并交出新一轮入口（S-B1），实际执行由 F-19→F-20→F-21 承接。";

/**
 * 从 `EXT-02.info_time_point` 自由文本里抽「取数时点」与「覆盖区间」。
 * - `fetch_time` 复用 F-15 `parseStamp`（自由文本抽时点的**唯一口径**，不复制第二份）。
 * - `coverage` 只在文本显式写「覆盖 A ~ B」时给出；抽不到即 `null`（**不猜**）。
 * 返回 `{ text, fetch_time, coverage }`；`coverage = { from, to }`（`YYYY-MM-DD HH:MM`，可直接字典序比较）。
 */
export function parseCoverage(info_time_point) {
  const text = norm(info_time_point);
  const fetch_time = parseStamp(text);
  const m = /覆盖\s*(\d{4}-\d{1,2}-\d{1,2})\s*[~～\-—－]\s*(\d{4}-\d{1,2}-\d{1,2})/.exec(text);
  const from = m ? parseStamp(m[1]) : null;
  const to = m ? parseStamp(m[2]) : null;
  const coverage = from && to ? { from, to } : null;
  return { text, fetch_time, coverage };
}

/** 归一化文本用于「是否变化」比对（去首尾与内部多余空白；大小写不动，中文无大小写）。 */
const canon = (s) => norm(s).replace(/\s+/g, " ");

/** 追问的「时间范围」声明归一化；形态不全即**报错**（不静默忽略，与 F-19 入参口径同款）。 */
function normalizeRequestedTimeRange(tr) {
  if (tr == null) return null;
  if (typeof tr !== "object" || Array.isArray(tr)) {
    throw new Error("依据复用判定：requested_changes.time_range 须为 { from, to } 对象");
  }
  const from = parseStamp(tr.from);
  const to = parseStamp(tr.to);
  if (!from || !to) {
    throw new Error("依据复用判定：requested_changes.time_range 须为 { from, to } 且 from / to 均可解析（YYYY-MM-DD）");
  }
  if (to < from) throw new Error("依据复用判定：requested_changes.time_range 的 to 不得早于 from");
  return { from, to };
}

/**
 * **依据复用判定**（F-22 的核心判据）：逐条既有依据（`EXT-02` 行）判断「追问后是否仍适用」。
 *
 * 声明语义（**显式**，避免「没填」与「声明无变更」混淆）：
 *   - `requested_changes` **未提供**（`undefined` / `null`）＝**未声明** → 顶层 `undetermined`（受 A-1 门禁，不臆断）。
 *   - `requested_changes` **提供了**（含 `{}`）＝已声明；`{}` 表示「明确无变更」→ 全部沿用。
 *
 * 逐维度判据（只对**已声明**的维度生效）：
 *   - `time_range`：依据有覆盖区间且新范围落在区间内 → 沿用；落在区间外 → **补查**（`time_range_outside_coverage`）；
 *       无覆盖区间但可解析取数时点、且新范围上限**晚于**取数时点 → **补查**（`time_range_beyond_fetch_time`）；
 *       两样都抽不到 → **未决**（`coverage_unparsed`，保守计入补查）。
 *   - `query_condition`：归一化后不等 → **补查**（`query_condition_changed`）。
 *   - `applicability_scope`：相等 → 沿用；不等且声明 `applicability_relation='narrower'` → 沿用
 *       （`scope_narrowed_still_applicable`，原依据仍在其覆盖内）；其余 → **补查**（`applicability_scope_changed`）。
 *
 * @param {Array<object>} evidenceRows EXT-02 行（**须含全字段**：`query_condition` / `info_time_point` / `applicability_scope`）
 * @param {object|undefined|null} requested_changes 追问的变更声明
 */
export function assessEvidenceReuse(evidenceRows, requested_changes) {
  const rows = Array.isArray(evidenceRows) ? evidenceRows.filter((r) => r && typeof r === "object") : [];
  const declared = requested_changes !== undefined && requested_changes !== null;

  if (!declared) {
    return {
      declared: false,
      decision: REUSE_DECISIONS.UNDETERMINED,
      checked: rows.length,
      checked_dimensions: [],
      reusable: [],
      refresh_list: [],
      llm_gated: true,
      note:
        "追问**未声明**「时间范围 / 查询条件 / 适用范围」是否变化——该语义判断须由 A-1（LLM，未提供）确认，" +
        "本步**既不自动沿用、也不自动补查**（不臆断），登记为未决；补查范围待门禁关闭后回填。",
    };
  }

  const p = requested_changes;
  if (typeof p !== "object" || Array.isArray(p)) {
    throw new Error("依据复用判定：requested_changes 须为对象（时间范围 / 查询条件 / 适用范围）");
  }
  const tr = normalizeRequestedTimeRange(p.time_range);
  const qcDeclared = p.query_condition !== undefined && p.query_condition !== null;
  const qc = qcDeclared ? norm(p.query_condition) : null;
  if (qcDeclared && !isNonEmptyText(qc)) {
    throw new Error("依据复用判定：requested_changes.query_condition 声明后不得为空串（要么不声明，要么给出条件）");
  }
  const asDeclared = p.applicability_scope !== undefined && p.applicability_scope !== null;
  const as = asDeclared ? norm(p.applicability_scope) : null;
  if (asDeclared && !isNonEmptyText(as)) {
    throw new Error("依据复用判定：requested_changes.applicability_scope 声明后不得为空串");
  }
  const relation = p.applicability_relation == null ? null : norm(p.applicability_relation);
  if (relation !== null && !Object.values(SCOPE_RELATIONS).includes(relation)) {
    throw new Error(
      `依据复用判定：applicability_relation 须为 {${Object.values(SCOPE_RELATIONS).join(" / ")}} 之一（实测「${relation}」）`,
    );
  }

  const checked_dimensions = [];
  if (tr) checked_dimensions.push("time_range");
  if (qcDeclared) checked_dimensions.push("query_condition");
  if (asDeclared) checked_dimensions.push("applicability_scope");

  const reusable = [];
  const refresh_list = [];

  for (const ev of rows) {
    const reasons = [];
    const cover = parseCoverage(ev.info_time_point);

    if (tr) {
      if (cover.coverage) {
        if (tr.from >= cover.coverage.from && tr.to <= cover.coverage.to) {
          reasons.push({ code: "time_range_within_coverage", severity: REUSE_SEVERITIES.OK });
        } else {
          reasons.push({ code: "time_range_outside_coverage", severity: REUSE_SEVERITIES.REQUIRED });
        }
      } else if (cover.fetch_time && tr.to > cover.fetch_time) {
        reasons.push({ code: "time_range_beyond_fetch_time", severity: REUSE_SEVERITIES.REQUIRED });
      } else {
        reasons.push({ code: "coverage_unparsed", severity: REUSE_SEVERITIES.UNDETERMINED });
      }
    }

    if (qcDeclared) {
      if (canon(qc) === canon(ev.query_condition)) {
        reasons.push({ code: "query_condition_unchanged", severity: REUSE_SEVERITIES.OK });
      } else {
        reasons.push({ code: "query_condition_changed", severity: REUSE_SEVERITIES.REQUIRED });
      }
    }

    if (asDeclared) {
      if (canon(as) === canon(ev.applicability_scope)) {
        reasons.push({ code: "applicability_scope_unchanged", severity: REUSE_SEVERITIES.OK });
      } else if (relation === SCOPE_RELATIONS.NARROWER) {
        reasons.push({ code: "scope_narrowed_still_applicable", severity: REUSE_SEVERITIES.OK });
      } else {
        reasons.push({ code: "applicability_scope_changed", severity: REUSE_SEVERITIES.REQUIRED });
      }
    }

    const item = {
      evidence_id: ev.evidence_id ?? null,
      source_id: ev.source_id ?? null,
      evidence_title: ev.evidence_title ?? null,
      info_time_point: ev.info_time_point ?? null,
      applicability_scope: ev.applicability_scope ?? null,
      coverage: cover.coverage,
      reasons,
    };
    const blocking = reasons.filter((r) => r.severity !== REUSE_SEVERITIES.OK);
    if (blocking.length === 0) reusable.push(item);
    else refresh_list.push({ ...item, refresh_reasons: blocking });
  }

  if (rows.length === 0) {
    refresh_list.push({
      evidence_id: null,
      source_id: null,
      evidence_title: null,
      info_time_point: null,
      applicability_scope: null,
      coverage: null,
      reasons: [{ code: "no_prior_evidence", severity: REUSE_SEVERITIES.REQUIRED }],
      refresh_reasons: [{ code: "no_prior_evidence", severity: REUSE_SEVERITIES.REQUIRED }],
    });
  }

  const need = refresh_list.some((r) => (r.refresh_reasons || []).some((x) => x.severity === REUSE_SEVERITIES.REQUIRED));
  const unsure = refresh_list.some((r) =>
    (r.refresh_reasons || []).some((x) => x.severity === REUSE_SEVERITIES.UNDETERMINED),
  );

  const decision = need || unsure ? REUSE_DECISIONS.SUPPLEMENT : REUSE_DECISIONS.REUSE;
  const note =
    decision === REUSE_DECISIONS.REUSE
      ? `已声明维度（${checked_dimensions.join(" / ") || "无"}）对全部 ${rows.length} 条既有依据均在覆盖内 → **沿用**，无需补查。`
      : `已声明维度（${checked_dimensions.join(" / ") || "无"}）下 ${refresh_list.length} / ${rows.length} 条依据需补查` +
        (unsure ? "（其中含**无法判定**项，按保守方向计入）" : "") +
        "——补齐后并入新一轮研究，**原结论与限制原样保留**（补查 ≠ 否定）。";

  return {
    declared: true,
    decision,
    checked: rows.length,
    checked_dimensions,
    reusable,
    refresh_list,
    llm_gated: false,
    note,
  };
}

/**
 * **版本口径判定**（BRD F-22 / TC-I-M4-001）：
 * 追问可落在新版本上；**原任务与原研究始终钉在启动时版本**（「已启动任务继续使用启动时的版本」）。
 * 同时校验「任务版本 ↔ 研究版本」一致——不一致**如实登记**（`task_research_version_consistent=false`），不静默。
 * @param {object} input { original_task, original_research, followup_task, followup_research, scope_changed }
 */
export function assessVersionPinning({
  original_task,
  original_research,
  followup_task,
  followup_research,
  scope_changed,
} = {}) {
  const numOrNull = (v) => (v === undefined || v === null ? null : Number(v));
  const oT = original_task ? numOrNull(original_task.goal_version_no) : null;
  const oR = original_research ? numOrNull(original_research.goal_version_no) : null;
  const fT = followup_task ? numOrNull(followup_task.goal_version_no) : null;
  const fR = followup_research ? numOrNull(followup_research.goal_version_no) : null;

  const followup_effective = fR ?? fT;
  const version_changed = oR !== null && followup_effective !== null && followup_effective !== oR;
  const mismatch = (oT !== null && oR !== null && oT !== oR) || (fT !== null && fR !== null && fT !== fR);
  const scopeChanged = scope_changed === true;

  return {
    original_task_goal_version_no: oT,
    original_research_goal_version_no: oR,
    followup_task_goal_version_no: fT,
    followup_research_goal_version_no: fR,
    followup_effective_goal_version_no: followup_effective,
    version_changed,
    task_research_version_consistent: !mismatch,
    scope_changed: scopeChanged,
    new_version_required: scopeChanged && !version_changed,
    note: version_changed
      ? `追问落在新版本 v${followup_effective}（原研究 v${oR}）——**原任务与原研究仍钉在启动时版本**，版本不混用。`
      : scopeChanged
        ? `追问声明了问题 / 范围变更，但仍沿用启动版本 v${followup_effective} —— 须由 M1 F-01 建新版本行后再启动，**本步不建版本行**。`
        : `追问沿用原版本 v${followup_effective}，无版本变更。`,
  };
}

/**
 * **新一轮入口参数**（F-22 输出 → S-B1）：把「沿用 / 补查」清单与比较条件交给 F-19 起的新一轮。
 * 比较条件复用 F-19 `resolveComparisonConditions`；查证顺序**派生**自 `RESEARCH_CHECK_SEQUENCE`（不复制第二份）。
 */
export function assembleNextRound({
  task_id,
  research_no,
  research_question,
  goal_version_no,
  evidence_reuse,
  comparison_conditions,
  comparison_missing,
  population_limit,
  focus_period,
  metric_definition,
} = {}) {
  const resolved =
    comparison_conditions || comparison_missing
      ? { conditions: comparison_conditions ?? {}, missing: comparison_missing ?? [] }
      : resolveComparisonConditions({ population_limit, focus_period, metric_definition });

  return {
    entry: NEXT_ROUND_ENTRY,
    chain: NEXT_ROUND_CHAIN.slice(),
    chain_note: "再触发本模块 F-19（起点与比较条件）→ F-20（人群比较与五查）→ F-21（七要素结果生成）。",
    task_id: task_id ?? null,
    research_no: research_no ?? null,
    research_question: research_question ?? null,
    goal_version_no: goal_version_no ?? null,
    reuse_decision: evidence_reuse ? evidence_reuse.decision : null,
    refresh_checklist: evidence_reuse
      ? (evidence_reuse.refresh_list || []).map((r) => ({
          evidence_id: r.evidence_id,
          reason_code: (r.refresh_reasons || []).map((x) => x.code).join("+") || null,
          severity: (r.refresh_reasons || []).some((x) => x.severity === REUSE_SEVERITIES.REQUIRED)
            ? REUSE_SEVERITIES.REQUIRED
            : REUSE_SEVERITIES.UNDETERMINED,
        }))
      : [],
    comparison_conditions: resolved.conditions,
    comparison_missing: resolved.missing,
    check_sequence_keys: RESEARCH_CHECK_SEQUENCE.map((s) => s.check_key),
    out_of_scope_note:
      "活动玩法配置、权益组合、预算与排期不在本研究结论范围内——新一轮同样只输出有依据的判断、限制与改善方向。",
    stop_when: STOP_CONDITION,
  };
}

/**
 * 薄读承接上下文（**只读**）：追问任务 → 追问研究行（若有）→ 原研究 → 原结果与依据 → 原任务。
 * 复用 M1 读面（`getTask`）与 M2 读面（`getResearch` / `listResearch`）以及 F-21 读面
 * （`loadResearchResultContext`：七要素 + 逐发现证据回指），**本文件不新增读语句**。
 * @returns {Promise<object|null>} 任务不存在时返回 `null`（由调用方决定错误码）
 */
export async function loadFollowupIntakeContext(db, { task_id, original_research_no } = {}) {
  const tid = norm(task_id);
  if (!isNonEmptyText(tid)) throw new Error("追问承接必填：task_id（追问任务，PD-01）");

  const followup_task = await getTask(db, tid);
  if (!followup_task) return null;

  // 追问研究行：由该任务启动、且带 parent_research_no 的 MD-07（M1 F-05 建行；缺行 = 尚未建壳）
  const allResearch = await listResearch(db, {});
  const followup_research =
    allResearch.find((r) => r.start_task_id === tid && isNonEmptyText(r.parent_research_no)) || null;

  const originalNo = norm(original_research_no) || (followup_research ? norm(followup_research.parent_research_no) : "");
  const original_research = isNonEmptyText(originalNo) ? await getResearch(db, originalNo) : null;
  const original_result = original_research ? await loadResearchResultContext(db, originalNo) : null;

  // 依据（EXT-02）全字段：经 LNK-02 逐发现取证据 id，再去重取全行
  const evidence = [];
  const seen = new Set();
  for (const f of (original_result && original_result.elements && original_result.elements.e3_evidence_findings) || []) {
    for (const evId of f.evidence_refs || []) {
      if (seen.has(evId)) continue;
      seen.add(evId);
      const row = await getEvidence(db, evId);
      if (row) evidence.push(row);
    }
  }
  // 兜底：若发现侧没有链接（研究刚建壳），退回按发现逐条取（同样是 M2 读面）
  if (evidence.length === 0 && original_result) {
    for (const f of original_result.elements.e3_evidence_findings || []) {
      const linked = await listEvidenceByFinding(db, f.finding_id);
      for (const l of linked) {
        if (seen.has(l.evidence_id)) continue;
        seen.add(l.evidence_id);
        const row = await getEvidence(db, l.evidence_id);
        if (row) evidence.push(row);
      }
    }
  }

  const original_task =
    original_research && isNonEmptyText(original_research.start_task_id)
      ? await getTask(db, original_research.start_task_id)
      : null;

  // 追问链（MD-07 `parent_research_no`）：TC-I-M4-001「保留原结果与依据」的链式证据（M2 读面，只读）
  const lineage = original_research ? await getResearchLineage(db, originalNo) : null;

  return {
    task_id: tid,
    followup_task,
    followup_research,
    original_research_no: isNonEmptyText(originalNo) ? originalNo : null,
    original_research,
    original_result,
    original_task,
    lineage,
    evidence,
  };
}

/** 原研究「保留快照」：本步前后各取一次、逐字节比对，把「保留原结果与依据」做成**运行期自检**。 */
async function snapshotOriginal(db, original_research_no, evidence) {
  const result = await loadResearchResultContext(db, original_research_no);
  return JSON.stringify({ result, evidence: evidence.map((e) => e.evidence_id).sort() });
}

/**
 * **F-22 主入口**：承接一次追问，产出「沿用 / 补查」判定、版本口径与新一轮入口参数。
 *
 * @param {object} db D1 形态
 * @param {object} args
 *   - task_id：**必填**，追问任务（`PD-01`，`task_type` 须为 `hva_followup`）
 *   - original_research_no：可选，原研究（`MD-07`）；缺省从「该任务的追问研究行」的 `parent_research_no` 推导
 *   - new_question：可选，PM 的追问问题文本；缺省取追问研究行的 `research_question`，再缺省 `null`（不编造）
 *   - requested_changes：可选，追问对 `time_range` / `query_condition` / `applicability_scope` 的变更声明
 *       （**未提供＝未声明** → 依据复用判定为 `undetermined` 并标 `llm_gated`）
 *   - comparison_conditions / population_limit / focus_period / metric_definition：可选，透传 F-19 比较条件口径
 *   - dispatch：可选，下游派发端口 `(payload) => any`；**未注入＝不触发**（本步不重复发 Queue 消息）
 *   - now：可选，确定性时点（仅回带，不落库）
 */
export async function intakeFollowup(db, {
  task_id,
  original_research_no,
  new_question,
  requested_changes,
  comparison_conditions,
  population_limit,
  focus_period,
  metric_definition,
  dispatch,
  now,
} = {}) {
  const ctx = await loadFollowupIntakeContext(db, { task_id, original_research_no });
  if (!ctx) throw new Error(`追问任务不存在：${norm(task_id)}（承接须挂在 PD-01 真实任务上）`);
  if (ctx.followup_task.task_type !== FOLLOWUP_TASK_TYPE) {
    throw new Error(
        `追问承接须为 hva_followup 任务：${ctx.task_id} 的实际类型为「${ctx.followup_task.task_type}」` +
        `（误把普通研究 / 发现任务当追问会错置追问链）`,
    );
  }
  if (!ctx.original_research) {
    const hint = ctx.original_research_no
      ? `原研究不存在：${ctx.original_research_no}`
      : `无法解析原研究：任务 ${ctx.task_id} 无对应追问研究行，且未提供 original_research_no`;
    throw new Error(`${hint}（追问只能建立在真实存在的原研究上，F-05 口径）`);
  }

  const before = await snapshotOriginal(db, ctx.original_research_no, ctx.evidence);

  const question =
    norm(new_question) || (ctx.followup_research ? norm(ctx.followup_research.research_question) : "") || null;

  const evidence_reuse = assessEvidenceReuse(ctx.evidence, requested_changes);

  const version = assessVersionPinning({
    original_task: ctx.original_task,
    original_research: ctx.original_research,
    followup_task: ctx.followup_task,
    followup_research: ctx.followup_research,
    scope_changed: requested_changes && typeof requested_changes === "object" ? requested_changes.scope_changed : undefined,
  });

  const next_round = assembleNextRound({
    task_id: ctx.task_id,
    research_no: ctx.followup_research ? ctx.followup_research.research_no : null,
    research_question: question,
    goal_version_no: version.followup_effective_goal_version_no,
    evidence_reuse,
    comparison_conditions,
    comparison_missing: undefined,
    population_limit:
      norm(population_limit) || (ctx.followup_research ? ctx.followup_research.population_limit : null),
    focus_period: norm(focus_period) || null,
    metric_definition: norm(metric_definition) || null,
  });

  // 运行期自检：本步零写 → 原研究读模型与原依据集逐字节一致
  const after = await snapshotOriginal(db, ctx.original_research_no, ctx.evidence);
  const original_preserved = before === after;

  const scopeScan = question === null ? null : scanProductionActions(question);
  const question_scope_warning =
    scopeScan && !scopeScan.clean
      ? {
          hits: scopeScan.hits,
          patterns_checked: scopeScan.patterns_checked,
          note:
            "追问文本命中输出边界禁词（" +
            FORBIDDEN_PRODUCTION_PATTERNS.join(" / ") +
            "）——该范围不在本研究结论内（BRD §5.2）。**本步不拦截 PM 的提问**，仅提示：" +
            "新一轮同样不得把活动配置 / 权益组合 / 预算 / 排期写成研究结论。",
        }
      : null;

  let dispatch_result = { dispatched: false, reason: "not_injected", note: "下游派发端口未注入：本步只交出新一轮入口，不重复发 Queue 消息（M1 F-05 已发）。" };
  if (typeof dispatch === "function") {
    const payload = {
      task_id: ctx.task_id,
      research_no: next_round.research_no,
      entry: next_round.entry,
      chain: next_round.chain.slice(),
      reuse_decision: evidence_reuse.decision,
      refresh_checklist: next_round.refresh_checklist,
    };
    const out = await dispatch(payload);
    dispatch_result = { dispatched: true, reason: "injected", payload, result: out ?? null, note: "下游派发端口已注入：恰调用一次。" };
  }

  return {
    intake: {
      task_id: ctx.task_id,
      task_type: ctx.followup_task.task_type,
      task_status: ctx.followup_task.task_status,
      parent_task_id: ctx.followup_task.parent_task_id ?? null,
      goal_id: ctx.followup_task.goal_id,
      goal_version_no: version.followup_effective_goal_version_no,
      question,
      question_source: norm(new_question)
        ? "provided"
        : ctx.followup_research && isNonEmptyText(ctx.followup_research.research_question)
          ? "followup_research.research_question"
          : "none",
      followup_research_no: ctx.followup_research ? ctx.followup_research.research_no : null,
      followup_research_shell_present: Boolean(ctx.followup_research),
      original_research_no: ctx.original_research_no,
      original_task_id: ctx.original_task ? ctx.original_task.task_id : null,
      now: norm(now) || null,
    },
    preserved: {
      original_research: {
        research_no: ctx.original_research.research_no,
        research_question: ctx.original_research.research_question,
        research_status: ctx.original_research.research_status,
        finished_at: ctx.original_research.finished_at ?? null,
        goal_id: ctx.original_research.goal_id,
        goal_version_no: ctx.original_research.goal_version_no,
        parent_research_no: ctx.original_research.parent_research_no ?? null,
        start_task_id: ctx.original_research.start_task_id ?? null,
        elements: ctx.original_result ? ctx.original_result.elements : null,
        out_of_scope_note: ctx.original_research.out_of_scope_note,
      },
      evidence: ctx.evidence,
      lineage: ctx.lineage ?? null,
      original_preserved,
      negates_original_conclusion: false,
      note:
        "追问**不覆盖**原研究（MD-07 `parent_research_no` 追问链）：原七要素、发现、证据关联与改善方向**原样保留**，" +
        "本步只读不写；补查得到的新依据**并入新一轮研究**，原结论与其限制不被推翻（补查 ≠ 否定）。",
    },
    evidence_reuse,
    version,
    next_round,
    dispatch_result,
    stop_condition: STOP_CONDITION,
    boundaries: {
      zero_write: true,
      external_calls: 0,
      llm_calls: 0,
      note:
        "本步零写语句、零裸 SQL、零外部调用、不调 LLM：全部经 M1/M2/F-21 既有读面；" +
        "MD-07 建行归 M1 F-05、PD-07 写入归 M1 F-05、MD-02 新版本归 M1 F-01。",
    },
    question_scope_warning,
  };
}
