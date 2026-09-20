/**
 * 文档卡（阶段4 · M4 · F-21 研究结果生成 · 写入面 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md（**F-21 研究结果生成**：七要素组装——业务目标与研究问题 / 研究范围与方法 / 证据与关键发现 / 人群差异 / 候选 HVA 及支持情况 / 其他解释与限制 / 改善方向；每项关键发现关联实际取得的证据；**未找到足够依据支持候选 HVA 也可形成完整结果**；改善方向与发现逐项对应；活动配置、权益组合、预算与排期不在其内｜关联 schema＝**MD-07 research / MD-08 research_finding / MD-11 improvement_action**）
 *   ｜ ../../docs/05-test-cases/test-M4.md（**TC-D-M4-002**（L3：`MD-08 research_finding` 重复 `(research_no, order_no)` → 复合 UK 拒绝）｜
 *        **TC-D-M4-005**（L3：`MD-11 improvement_action` 重复 `(research_no, order_no)` → UK 拒绝）｜
 *        **TC-D-M4-001**（L3：`MD-07 research.opportunity_id='OPP-NOPE'` → FK 失败——MD-07 的**建行**归 F-11 `../shared-context/index.js#createResearch`，本文件只做**内容填充**；该反例在 `test-f21` 经 F-11 写面复现，本文件**不复制第二份建行口径**））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-21｜ §5.3 硬红线（生产零写）
 *   ｜ ../../docs/03-locks/schema.md（MD-07 字段表 L267+（`e1_goal_statement`/`e2_scope_method`/`e4_population_diff`/`e6_limits`/`out_of_scope_note`/`research_status`）/ MD-08 L293+（`support_flag` 值域 `dict:FINDING_SUPPORT`、`UK(research_no, order_no)`）/ MD-11 L332+（`UK(research_no, order_no)`）；**DDL 行号 L230 / L251 / L280**）
 * 职责：**F-21 三处写入面 + 其读面**——MD-07 `research` 的**七要素正文与完成状态**（**只改行、不建行**）、MD-08 `research_finding`（只新增行）、MD-11 `improvement_action`（只新增行）。
 * 硬红线：① **值域真源在库**——`research_status` 取值来自 `dict_item`（`RESEARCH_STATUS`）、`support_flag` 来自 `FINDING_SUPPORT`，
 *   本文件**不内联中文枚举**、不复制第二份值域清单；
 *  ② **不改编号、不删行**——`updateResearchReport` 只改 6 个正文 / 状态列，**不改** `research_no`/`opportunity_id`/`goal_id`/`goal_version_no`/`parent_research_no`/`start_task_id`（启动快照与追问链不因出报告而变）；本文件**绝不删除**（研究依据必须可回查）；
 *  ③ **约束失败即抛错**：`run()` 返回失败即抛（PK / UK / FK 由库级强制，不在应用层重造判定——与 F-26 `task-state.js` 同约定）。
 * 边界：只做 MD-07 内容填充 + MD-08/MD-11/LNK-02 的**读**与 MD-08/MD-11 的**写**。
 *   **`LNK-02 finding_evidence` 的行写入仍唯一归** `../shared-context/index.js#linkFindingEvidence`（本文件只提供读面供取号，不代写）；
 *   七要素组装、逐发现挂证据编排、改善方向对应性校验、编号取号（`F-NNN`/`AC-NNN`/`LK-FE-NNN`）在 `./result.js`（与 F-20「写面只管写、编排层算号」同分工）。
 *   **本文件读面与 `../shared-context/index.js#listResearchFindings` 的分工**：后者是「按研究定位」的历史回查只读面（F-11 口径）；
 *   本文件的 `listFindings` 额外支持「不传 `research_no` → 返回全量」，供 F-21 **取号**（编号须库内最大 +1）与组装；
 *   两者读同一张表、服务不同调用方，**不是第二份业务口径**。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 `./result.js` 与 CI `validate` 步骤复用（node server/agent-orchestrator/test-f21.mjs）。
 *
 * 用法：import { createResearchFinding, createImprovementAction, updateResearchReport, listFindings, listImprovementActions, listFindingEvidenceLinks } from "./result-store.js";
 */

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";

/** 时点戳：与 `../shared-context/index.js` / `../task-runner/*.js` 同形态（各模块自带一枚，不跨模块耦合）。 */
function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** 必填项校验：缺项即抛（不隐式取默认、不静默降级）。 */
function assertRequired(obj, fields, label) {
  const src = obj && typeof obj === "object" ? obj : {};
  const missing = fields.filter((f) => src[f] === undefined || src[f] === null || String(src[f]).trim() === "");
  if (missing.length > 0) {
    throw new Error(`${label} 缺必填项：${missing.join("、")}`);
  }
}

/**
 * 正序位校验：`order_no` 是展示顺序，须为正整数。
 * 数值列的空串库级拦不住（SQLite/D1 里 `'' >= 1` 求值为 TRUE），故「拒空串 / 拒 null / 拒布尔」在应用层兜底。
 */
function assertOrderNo(raw, label) {
  if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") {
    throw new Error(`${label} order_no 须为正整数（实测 ${JSON.stringify(raw)}）`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${label} order_no 须为正整数（实测 ${JSON.stringify(raw)}）`);
  }
  return n;
}

const REQUIRED_FINDING = ["finding_id", "research_no", "finding_text", "support_flag", "limit_note", "order_no"];
const REQUIRED_ACTION = ["action_id", "research_no", "target_for", "problem_what", "reason_why", "order_no"];
const REQUIRED_REPORT = [
  "research_no",
  "e1_goal_statement",
  "e2_scope_method",
  "e4_population_diff",
  "e6_limits",
  "out_of_scope_note",
  "research_status",
];

/** 读单份研究是否存在（前置守卫用；研究不存在即抛，不让库级 FK 兜底）。 */
async function assertResearchExists(db, research_no) {
  const row = await db.prepare("SELECT research_no FROM research WHERE research_no = ?").bind(research_no).first();
  if (!row) throw new Error(`研究不存在：${research_no}（研究结果须归属 MD-07 真实研究）`);
}

/** 构造「可选过滤」的列表语句（不传过滤条件即全量，供取号）。 */
async function listRows(db, table, key, { filter, order }) {
  const where = [];
  const params = [];
  if (isNonEmptyText(filter)) {
    where.push(`${key} = ?`);
    params.push(filter);
  }
  const sql =
    `SELECT * FROM ${table}` +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    ` ORDER BY ${order}`;
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/**
 * 登记一条关键发现（MD-08，七要素 ③ 的条目）。**每项发现单独成行**，才能逐条挂证据（LNK-02）与逐条写限制。
 * 只新增行：本函数不含改行 / 删行语句。
 * `research_no` 指向不存在的行由库级外键拒绝；重复 `(research_no, order_no)` 由库级复合 UNIQUE 拒绝（TC-D-M4-002 反例）。
 */
export async function createResearchFinding(db, input) {
  assertRequired(input, REQUIRED_FINDING, "关键发现");
  const orderNo = assertOrderNo(input.order_no, "关键发现");
  await assertResearchExists(db, input.research_no);
  const res = await db
    .prepare(
      `INSERT INTO research_finding
         (finding_id, research_no, finding_text, support_flag, limit_note, order_no)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.finding_id,
      input.research_no,
      input.finding_text,
      input.support_flag,
      input.limit_note,
      orderNo
    )
    .run();
  if (res && res.success === false) throw new Error(res.error || "关键发现登记失败");
  return {
    finding_id: input.finding_id,
    research_no: input.research_no,
    support_flag: input.support_flag,
    order_no: orderNo,
  };
}

/**
 * 登记一条改善方向（MD-11，七要素 ⑦）。**逐项对应发现**——针对什么人群、什么问题、为什么值得改善；
 * 活动配置、权益组合、预算与排期不在其内（由 MD-07 `out_of_scope_note` 声明不覆盖）。
 * 只新增行。重复 `(research_no, order_no)` 由库级 UNIQUE 拒绝（TC-D-M4-005 反例）。
 */
export async function createImprovementAction(db, input) {
  assertRequired(input, REQUIRED_ACTION, "改善方向");
  const orderNo = assertOrderNo(input.order_no, "改善方向");
  await assertResearchExists(db, input.research_no);
  const res = await db
    .prepare(
      `INSERT INTO improvement_action
         (action_id, research_no, target_for, problem_what, reason_why, order_no)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.action_id,
      input.research_no,
      input.target_for,
      input.problem_what,
      input.reason_why,
      orderNo
    )
    .run();
  if (res && res.success === false) throw new Error(res.error || "改善方向登记失败");
  return {
    action_id: input.action_id,
    research_no: input.research_no,
    order_no: orderNo,
  };
}

/**
 * 把七要素正文与完成状态填回既有研究行（MD-07，**只改行、不建行**）。
 * 建行归 F-11 `../shared-context/index.js#createResearch`（**不复制第二份建行口径**）；追问壳的建行归 F-05 `../task-runner/followup.js`。
 * 本函数只改这 6 个正文 / 状态列，**绝不触碰** `research_no` / `opportunity_id` / `goal_id` /
 * `goal_version_no` / `parent_research_no` / `start_task_id`——启动快照与追问链不因出报告而变。
 * 前置守卫：研究不存在即抛（**不静默 upsert**，避免把「填错编号」写成新建研究）。
 */
export async function updateResearchReport(db, input) {
  assertRequired(input, REQUIRED_REPORT, "研究报告");
  await assertResearchExists(db, input.research_no);
  const finishedAt = isNonEmptyText(input.finished_at) ? String(input.finished_at).trim() : nowStamp();
  const res = await db
    .prepare(
      `UPDATE research
          SET e1_goal_statement = ?,
              e2_scope_method   = ?,
              e4_population_diff = ?,
              e6_limits         = ?,
              out_of_scope_note = ?,
              research_status   = ?,
              finished_at       = ?
        WHERE research_no = ?`
    )
    .bind(
      input.e1_goal_statement,
      input.e2_scope_method,
      input.e4_population_diff,
      input.e6_limits,
      input.out_of_scope_note,
      input.research_status,
      finishedAt,
      input.research_no
    )
    .run();
  if (res && res.success === false) throw new Error(res.error || "研究报告填充失败");
  const changes = res && res.meta ? Number(res.meta.changes) : 0;
  return { research_no: input.research_no, research_status: input.research_status, finished_at: finishedAt, changed: changes };
}

/** 列关键发现（MD-08 原样）。`research_no` 省略时返回**全量**——取号（库内最大 +1）据此计算。 */
export async function listFindings(db, { research_no } = {}) {
  return listRows(db, "research_finding", "research_no", { filter: research_no, order: "research_no, order_no" });
}

/** 列改善方向（MD-11 原样）。`research_no` 省略时返回**全量**——取号据此计算。 */
export async function listImprovementActions(db, { research_no } = {}) {
  return listRows(db, "improvement_action", "research_no", { filter: research_no, order: "research_no, order_no" });
}

/**
 * 列「发现 ↔ 证据」关联（LNK-02 只读）。`finding_id` 省略时返回**全量**——取号据此计算。
 * **行写入不属本文件**（唯一写入面＝`../shared-context/index.js#linkFindingEvidence`）。
 */
export async function listFindingEvidenceLinks(db, { finding_id } = {}) {
  return listRows(db, "finding_evidence", "finding_id", { filter: finding_id, order: "finding_id, link_id" });
}
