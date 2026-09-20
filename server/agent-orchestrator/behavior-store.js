/**
 * 文档卡（阶段4 · M4 · F-20 人群比较与行为关系检验 · 写入面 · 2026-09-20）
 * 上游：../../docs/02-prd/PRD-M4-HVA分析Agent.md（F-20：候选行为五查；**关联 schema＝MD-09 candidate_behavior（候选行为）、MD-10 behavior_point（候选行为支持情况条目，逐条对应五查）**；§4 红线 1 术语口径「研究完成前一律称候选行为」）
 *   ｜ ../../docs/05-test-cases/test-M4.md（**TC-D-M4-003**（L3：`MD-09 candidate_behavior.research_no='R-NOPE'` → FK 失败）｜**TC-D-M4-004**（L3：`MD-10 behavior_point` 重复 `(candidate_id, point_type, order_no)` → 复合 UK 拒绝））
 *   ｜ ../../docs/01-brd/BRD.md §4 F-20｜ §5.3 硬红线（生产零写）
 *   ｜ ../../docs/03-locks/schema.md（MD-09 / MD-10 字段表与值域 `dict:BEHAVIOR_STATUS` / `dict:BEHAVIOR_POINT_TYPE`；**DDL 行号 L262 / L270**）
 *   ｜ ./behavior.js（F-20 编排层——本文件是它的落库出口，编排层自身零写语句）
 * 职责：**MD-09 `candidate_behavior` / MD-10 `behavior_point` 的唯一写入面**（F-20 产出归属）。
 *   `MD-08 research_finding` 的写入**不属本文件**（其 L3 oracle 归 F-21；只读面见 `../shared-context/index.js` 的 `listResearchFindings`）。
 * 硬红线：① **值域真源在库**——`behavior_status` / `point_type` 的取值来自 `dict_item`（`BEHAVIOR_STATUS` / `BEHAVIOR_POINT_TYPE`），
 *   本文件**不内联中文枚举**、也不复制第二份值域清单；
 *   ② **只新增行 / 只改状态列**——除 `updateCandidateBehaviorStatus` 外不含任何改行语句，且**绝不删除**（候选行为与研究依据必须可回查）；
 *   ③ 约束失败与 F-26 `task-state.js` 一致：`run()` 失败即抛错（UNIQUE / PK / FK 由库级强制，不在应用层重造）。
 * 边界：只做 MD-09 / MD-10 的读写；五查判定、倒挂隔离、比较条件守卫等编排逻辑在 `./behavior.js`。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 `./behavior.js` 与 CI `validate` 步骤复用（node server/agent-orchestrator/test-f20.mjs）。
 *
 * 用法：import { createCandidateBehavior, appendBehaviorPoint, updateCandidateBehaviorStatus, listCandidateBehaviors, listBehaviorPoints } from "./behavior-store.js";
 */

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";

/** 必填项校验：缺项即抛（不隐式取默认、不静默降级）。 */
function assertRequired(obj, fields, label) {
  const src = obj && typeof obj === "object" ? obj : {};
  const missing = fields.filter((f) => src[f] === undefined || src[f] === null || String(src[f]).trim() === "");
  if (missing.length > 0) {
    throw new Error(`${label} 缺必填项：${missing.join("、")}`);
  }
}

const REQUIRED_CANDIDATE = ["candidate_id", "research_no", "behavior_name", "behavior_status"];
const REQUIRED_POINT = ["point_id", "candidate_id", "point_type", "point_text", "order_no"];

/** 读单份研究是否存在（前置守卫用；研究不存在即抛，不让库级 FK 兜底）。 */
async function assertResearchExists(db, research_no) {
  const row = await db.prepare("SELECT research_no FROM research WHERE research_no = ?").bind(research_no).first();
  if (!row) throw new Error(`研究不存在：${research_no}（候选行为须归属 MD-07 真实研究）`);
}

/**
 * 登记一条候选行为（MD-09）。**研究完成前一律称「候选行为」**（PRD-M4 §4 红线 1）——
 * 即使最终获得支持，本表也只改 `behavior_status`、**不改名**（DDL L262 注释）。
 * 只新增行：本函数不含改行 / 删行语句。
 * `research_no` 指向不存在的行由库级外键拒绝（TC-D-M4-003 反例）。
 */
export async function createCandidateBehavior(db, input) {
  assertRequired(input, REQUIRED_CANDIDATE, "候选行为");
  await assertResearchExists(db, input.research_no);
  await db
    .prepare(
      `INSERT INTO candidate_behavior
         (candidate_id, research_no, behavior_name, behavior_status)
       VALUES (?, ?, ?, ?)`
    )
    .bind(input.candidate_id, input.research_no, input.behavior_name, input.behavior_status)
    .run();
  return { candidate_id: input.candidate_id, research_no: input.research_no, behavior_status: input.behavior_status };
}

/**
 * 追加一条候选行为支持情况条目（MD-10）。
 * 「支持的方面」与「不支持 / 存疑的方面」**并列成行**，**不支持也必须是完整合法的产出**（schema.md MD-10 职责）。
 * 只新增行。`candidate_id` 指向不存在的候选行为由库级外键拒绝；
 * 重复 `(candidate_id, point_type, order_no)` 由库级复合 UNIQUE 拒绝（TC-D-M4-004 反例）。
 */
export async function appendBehaviorPoint(db, input) {
  assertRequired(input, REQUIRED_POINT, "候选行为条目");
  const orderNo = Number(input.order_no);
  if (!Number.isInteger(orderNo) || orderNo < 1) {
    throw new Error(`候选行为条目 order_no 须为正整数（实测 ${JSON.stringify(input.order_no)}）`);
  }
  const owner = await db
    .prepare("SELECT candidate_id FROM candidate_behavior WHERE candidate_id = ?")
    .bind(input.candidate_id)
    .first();
  if (!owner) throw new Error(`候选行为不存在：${input.candidate_id}（条目须归属 MD-09 真实候选行为）`);
  await db
    .prepare(
      `INSERT INTO behavior_point
         (point_id, candidate_id, point_type, point_text, order_no)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(input.point_id, input.candidate_id, input.point_type, input.point_text, orderNo)
    .run();
  return { point_id: input.point_id, candidate_id: input.candidate_id, point_type: input.point_type, order_no: orderNo };
}

/**
 * 推进候选行为的支持情况（MD-09 只改状态列、**不改名**）。
 * 五查跑完后由 `./behavior.js` 调用；`behavior_status` 取值来自 `dict:BEHAVIOR_STATUS`。
 */
export async function updateCandidateBehaviorStatus(db, { candidate_id, behavior_status } = {}) {
  assertRequired({ candidate_id, behavior_status }, ["candidate_id", "behavior_status"], "候选行为状态推进");
  const res = await db
    .prepare("UPDATE candidate_behavior SET behavior_status = ? WHERE candidate_id = ?")
    .bind(behavior_status, candidate_id)
    .run();
  if (res && res.success === false) throw new Error(res.error || "候选行为状态推进失败");
  const changes = res && res.meta ? Number(res.meta.changes) : 0;
  return { candidate_id, behavior_status, changed: changes };
}

/**
 * 列候选行为（MD-09 原样）。
 * `research_no` 省略时返回**全量**——取号（库内最大 +1）据此计算，**不另写 SELECT MAX**（零裸 SQL 的取号范式）。
 */
export async function listCandidateBehaviors(db, { research_no } = {}) {
  const where = [];
  const params = [];
  if (isNonEmptyText(research_no)) {
    where.push("research_no = ?");
    params.push(research_no);
  }
  const sql =
    "SELECT * FROM candidate_behavior" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY candidate_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/** 列候选行为条目（MD-10 原样）。`candidate_id` 省略时返回全量（取号据此计算）。 */
export async function listBehaviorPoints(db, { candidate_id } = {}) {
  const where = [];
  const params = [];
  if (isNonEmptyText(candidate_id)) {
    where.push("candidate_id = ?");
    params.push(candidate_id);
  }
  const sql =
    "SELECT * FROM behavior_point" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY candidate_id, point_type, order_no";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}
