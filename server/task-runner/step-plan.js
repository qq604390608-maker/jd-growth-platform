/**
 * 文档卡（阶段3 · M1 · 步骤计划与进度写入面 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（TC-D-M1-003 = `PD-02` 复合 UK 拒重复步号；
 *        TC-I-M1-006 = 每个状态跃迁是一行可查数据）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-02 / F-04 / F-06（步骤进度）
 *   ｜ `../../docs/03-locks/schema.md` PD-02 `task_step`（`step_id` PK、`task_id` FK→PD-01、
 *        `UK(task_id, step_no)`、`step_state` 走 `dict:STEP_STATE`）＋ PD-01 `task.progress_text`（形如 `2 / 5 步`）
 *   ｜ `../../docs/03-locks/tech-stack.md` §2.4（一步一条消息、步骤粒度＝`PD-02`）
 *   ｜ `../../prototype/pages/tasks.html` L81-87 **`TYPE_STEPS`**（**钉死需求**：四类任务的步骤名逐字照抄；
 *        口径检查 2 步、机会发现 5 步、HVA 研究 5 步、追问 5 步）
 * 职责：四类任务的**步骤计划**（`PD-02` 落行）与**进度串**（`PD-01.progress_text`）的唯一写入面。
 *   为 F-01（口径检查 2 步）、F-02（发现 5 步）、F-04（研究 5 步）、F-05（追问 5 步）、F-06（推进与回查）共用。
 *   另承载本模块的**取号**（`nextTaskId` ＝ `PD-01`、`nextResearchNo` ＝ `MD-07`）——两者同款形态、各只有一份；
 *   `nextResearchNo` 于 2026-09-21 由 `./followup.js` 下沉至此（F-04 建研究壳亦需取号，而 `hva.js` 引用
 *   `followup.js` 会构成环），`followup.js` 改为再导出以保持既有调用面不变。
 *   **F-35 起两者均改走原子取号**——委托 `../shared-context/id-sequence.js`（CFG-09 `id_sequence`，
 *   `UPDATE ... RETURNING` **一条语句**完成「自增 + 取值」），本文件**不再含取号类裸 SQL**；
 *   原「读全量自算最大 +1」的**读后写**正是 P0-3 的成因（并发撞主键 → 任务 `blocked`）。调用面与形态不变。
 * 边界：本文件只管「步骤与进度」这两件事；任务态跃迁（`task_status`）、受阻留痕（`PD-03`）、
 *   已完成部分（`done_part`）的写入面在 `../tool-executor/task-state.js`，本文件**再导出**而不重写。
 *   改行语句一律带 `WHERE task_id = ?`（**禁全表更新**）；本文件**不含删行语句**。
 * 门禁状态：无外部依赖（纯本地库写入）。
 *
 * 反向清单：被本目录后续 F-01~F-06 的各实现件引用（**各自落地时补记**，反向清单只记既有事实）；
 *   登记 `./README.md` 与 `../README.md`；测试 `./test-f01.mjs`。
 */
import { dictCodes } from "../tool-executor/task-state.js";
// F-35：取号改走 CFG-09 `id_sequence` 的**唯一写入面**（原子取号）——本文件不再自己「读全量自算最大 +1」。
// 依赖方向安全：`../shared-context` 只 import `../tool-executor/text-limit.js`，不反向依赖 task-runner，无环。
import { issueId } from "../shared-context/id-sequence.js";

/**
 * 四类任务的步骤名。**逐字照抄** `prototype/pages/tasks.html` 的 `TYPE_STEPS`
 * （原型是钉死需求，不作同义改写）。
 */
export const TYPE_STEPS = {
  goal_check: ["按规则校验六要素口径", "产出待补项"],
  discovery: ["载入目标与时间窗", "规划采集范围", "采集入口与流量", "识别与聚合线索", "生成机会候选"],
  hva_research: ["载入机会与目标口径", "调度工具采集证据", "交叉验证候选行为", "形成结论与适用范围", "产出研究结果与依据"],
  hva_followup: ["关联原研究与依据", "调度工具采集证据", "重算并校验差异", "更新结论适用范围", "产出新一轮结果"],
};

/** 任务类型 → 所在模块阶段（对齐种子口径：`discovery`→M3、HVA 两类→M4、口径检查→M1）。 */
export const TASK_TYPE_STAGE = {
  goal_check: "M1",
  discovery: "M3",
  hva_research: "M4",
  hva_followup: "M4",
};

/** 步骤号两位数（`T-1023` → `T-1023-S01`）。 */
export function stepIdOf(task_id, step_no) {
  return `${task_id}-S${String(step_no).padStart(2, "0")}`;
}

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 下一个任务号（`PD-01 task.task_id`，`T-####`）。
 * **F-35 起改为原子取号**：委托 `../shared-context/id-sequence.js` 的 CFG-09 `id_sequence`——
 * `UPDATE id_sequence SET next_val = next_val + 1 ... RETURNING next_val` **一条语句**完成「自增 + 取值」，
 * 不再「读全量自算最大 +1」（后者是 **P0-3** 的成因：并发读到同一个 `max` → 同一个号 → 撞主键 → 任务 `blocked`）。
 * **调用面与返回形态不变**（仍返回 `T-####` 字符串）。冷路径的种子由下面的 thunk 现读提供，
 * **热路径完全不读全表**——故不把全表扫描带进每次建任务。
 */
export async function nextTaskId(db) {
  const { id } = await issueId(db, "task", async () => {
    const rows = (await db.prepare("SELECT task_id FROM task").all()).results || [];
    return rows.map((r) => r.task_id);
  });
  return id;
}

/**
 * 下一个研究号（`MD-07 research.research_no`，`R-###`）。
 * **取号真源（唯一一份）**：F-04 建 HVA 研究壳与 F-05 追问建新研究壳共用同一实现——`./followup.js`
 * 改为再导出本函数（`hva.js` 引用 `followup.js` 会成环，故取号下沉到本共用件）。
 * **F-35 起与 `nextTaskId` 同走原子取号**（`../shared-context/id-sequence.js`），调用面与形态不变。
 */
export async function nextResearchNo(db) {
  const { id } = await issueId(db, "research", async () => {
    const rows = (await db.prepare("SELECT research_no FROM research").all()).results || [];
    return rows.map((r) => r.research_no);
  });
  return id;
}

/**
 * 建任务主记录（`PD-01`）。四个功能点共用（F-01 口径检查 / F-02 发现 / F-04 研究 / F-05 追问）。
 * 不变量：`task_status` 值域**从 `dict:TASK_STATUS` 读**；`task_stage` 由 `task_type` 推出；
 *   `is_auto_restart` 一律 0（停止状态不自动重启）；`progress_text` 初值按步骤模板给出；
 *   `agent_version_snapshot` 为 NOT NULL——**不调 Agent 的任务（口径检查）也须显式写明能力来源**，不留空。
 */
export async function createTask(db, {
  task_type, goal_id, goal_version_no, trigger_basis,
  agent_profile_id = null, agent_version_snapshot, task_status = "running",
  parent_task_id = null, done_part = "", started_at, ended_at = null,
} = {}) {
  const statuses = await dictCodes(db, "TASK_STATUS");
  if (!statuses.includes(task_status)) {
    throw new Error(`task_status '${String(task_status)}' 不在 dict:TASK_STATUS 值域内（${statuses.join(" / ")}）`);
  }
  const stage = TASK_TYPE_STAGE[task_type];
  if (!stage) throw new Error(`未知 task_type：${String(task_type)}（无法推出 task_stage）`);
  if (!goal_id) throw new Error("createTask：goal_id 必填（任务归属只认本字段，不靠「当前生效目标」兜底）");
  if (!goal_version_no) throw new Error("createTask：goal_version_no 必填（启动时采用的目标版本快照）");
  if (!trigger_basis) throw new Error("createTask：trigger_basis 必填（每次任务保存启动依据）");
  if (!agent_version_snapshot) throw new Error("createTask：agent_version_snapshot 必填（PD-01 为 NOT NULL）");
  if (parent_task_id) {
    const parent = await db.prepare("SELECT task_id FROM task WHERE task_id = ?").bind(parent_task_id).first();
    if (!parent) throw new Error(`父任务不存在：${parent_task_id}（须父行先落，PD-01 自引用外键）`);
  }

  const stepTotal = (TYPE_STEPS[task_type] || []).length;
  const task_id = await nextTaskId(db);
  const at = started_at || nowStamp();
  const r = await db
    .prepare(
      `INSERT INTO task
       (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
        agent_profile_id, agent_version_snapshot, progress_text, done_part, started_at, ended_at,
        parent_task_id, retry_count, is_auto_restart, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      task_id, task_type, stage, goal_id, Number(goal_version_no), task_status, trigger_basis,
      agent_profile_id, agent_version_snapshot, `0 / ${stepTotal} 步`, String(done_part ?? ""),
      at, ended_at, parent_task_id, 0, 0, at,
    )
    .run();
  if (r && r.success === false) throw new Error(r.error || "task 插入失败");
  return db.prepare("SELECT * FROM task WHERE task_id = ?").bind(task_id).first();
}

/** 任务与研究对象关联（LNK-04 `task_object`）：区分**启动对象**与**产出对象**。 */
export async function linkTaskObject(db, { task_id, object_type, object_id, link_role, created_at } = {}) {
  const types = await dictCodes(db, "OBJECT_TYPE");
  if (!types.includes(object_type)) {
    throw new Error(`object_type '${String(object_type)}' 不在 dict:OBJECT_TYPE 值域内（${types.join(" / ")}）`);
  }
  const roles = await dictCodes(db, "TASK_LINK_ROLE");
  if (!roles.includes(link_role)) {
    throw new Error(`link_role '${String(link_role)}' 不在 dict:TASK_LINK_ROLE 值域内（${roles.join(" / ")}）`);
  }
  const dup = await db
    .prepare("SELECT link_id FROM task_object WHERE task_id = ? AND object_type = ? AND object_id = ? AND link_role = ?")
    .bind(task_id, object_type, object_id, link_role)
    .first();
  if (dup) return db.prepare("SELECT * FROM task_object WHERE link_id = ?").bind(dup.link_id).first();
  const rows = (await db.prepare("SELECT link_id FROM task_object").all()).results || [];
  let seq = 0;
  for (const r of rows) {
    const m = /^LK-TO-(\d+)$/.exec(String(r.link_id || "").trim());
    if (m) seq = Math.max(seq, Number(m[1]));
  }
  const link_id = `LK-TO-${String(seq + 1).padStart(3, "0")}`;
  const r = await db
    .prepare("INSERT INTO task_object (link_id, task_id, object_type, object_id, link_role, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(link_id, task_id, object_type, object_id, link_role, created_at || nowStamp())
    .run();
  if (r && r.success === false) throw new Error(r.error || "task_object 插入失败");
  return db.prepare("SELECT * FROM task_object WHERE link_id = ?").bind(link_id).first();
}

/** 任务已关联的研究对象（`LNK-04`），可按角色过滤。 */
export async function listTaskObjects(db, { task_id, link_role } = {}) {
  const where = ["task_id = ?"];
  const args = [task_id];
  if (link_role !== undefined) { where.push("link_role = ?"); args.push(link_role); }
  return (await db.prepare(`SELECT * FROM task_object WHERE ${where.join(" AND ")} ORDER BY link_id`).bind(...args).all()).results;
}

/**
 * 建步骤计划（`PD-02`）。**幂等**：`UK(task_id, step_no)` 已在库级兜底；本函数遇到已存在的步号即跳过，
 * 不重复插入（同一任务重复计划不报错、不产生重号）。
 */
export async function planTaskSteps(db, task_id, task_type) {
  const names = TYPE_STEPS[task_type];
  if (!names) throw new Error(`未知 task_type：${String(task_type)}（步骤模板只有 ${Object.keys(TYPE_STEPS).join(" / ")}）`);
  const existing = await listTaskSteps(db, task_id);
  const have = new Set(existing.map((s) => s.step_no));
  const created = [];
  for (let i = 0; i < names.length; i += 1) {
    const step_no = i + 1;
    if (have.has(step_no)) continue;
    const step_id = stepIdOf(task_id, step_no);
    const r = await db
      .prepare("INSERT INTO task_step (step_id, task_id, step_no, step_name, step_state) VALUES (?, ?, ?, ?, ?)")
      .bind(step_id, task_id, step_no, names[i], "pending")
      .run();
    if (r && r.success === false) throw new Error(r.error || "task_step 插入失败");
    created.push(step_id);
  }
  return { task_id, task_type, planned: names.length, created: created.length, steps: await listTaskSteps(db, task_id) };
}

/** 步骤回查（`PD-02`），按 `step_no` 稳定排序。 */
export async function listTaskSteps(db, task_id) {
  return (await db.prepare("SELECT * FROM task_step WHERE task_id = ? ORDER BY step_no").bind(task_id).all()).results;
}

/** 进度串：`已完成步数 / 总步数 步`（对齐 `PD-01.progress_text` 与种子的 `2 / 5 步`）。 */
export function progressTextOf(steps) {
  const total = steps.length;
  const done = steps.filter((s) => s.step_state === "done").length;
  return `${done} / ${total} 步`;
}

/**
 * 推进一个步骤（`PD-02`），并同步刷新 `PD-01.progress_text`。
 * `step_state` 必须落在 `dict:STEP_STATE` 值域内（**从库读，不内联**）。
 */
export async function advanceStep(db, { task_id, step_no, step_state }) {
  const states = await dictCodes(db, "STEP_STATE");
  if (!states.includes(step_state)) {
    throw new Error(`step_state '${String(step_state)}' 不在 dict:STEP_STATE 值域内（${states.join(" / ")}）`);
  }
  const row = await db
    .prepare("SELECT * FROM task_step WHERE task_id = ? AND step_no = ?")
    .bind(task_id, step_no)
    .first();
  if (!row) throw new Error(`步骤不存在：${task_id} 第 ${step_no} 步（须先 planTaskSteps）`);
  const r = await db
    .prepare("UPDATE task_step SET step_state = ? WHERE task_id = ? AND step_no = ?")
    .bind(step_state, task_id, step_no)
    .run();
  if (r && r.success === false) throw new Error(r.error || "task_step 状态更新失败");
  const progress_text = await refreshProgress(db, task_id);
  return { ...(await db.prepare("SELECT * FROM task_step WHERE task_id = ? AND step_no = ?").bind(task_id, step_no).first()), progress_text };
}

/** 按当前 `PD-02` 现状重算 `PD-01.progress_text`（带主键条件的单行更新）。 */
export async function refreshProgress(db, task_id) {
  const steps = await listTaskSteps(db, task_id);
  const text = progressTextOf(steps);
  const r = await db.prepare("UPDATE task SET progress_text = ? WHERE task_id = ?").bind(text, task_id).run();
  if (r && r.success === false) throw new Error(r.error || "task progress_text 更新失败");
  return text;
}

// 任务态 / 受阻 / 已完成部分的写入面在 `../tool-executor/task-state.js`（F-26 已落地）——此处再导出，
// 让本目录各功能点从同一处取用，**不重写**（单一写入面）。
export {
  BLOCK_REASON_CODE,
  TaskStateError,
  getTask,
  assertTaskRunnable,
  nextBlockId,
  listTaskBlocks,
  recordBlock,
  setTaskStatus,
  appendDonePart,
} from "../tool-executor/task-state.js";

// `dictCodes` 已在上方 import（供 `createTask` / `advanceStep` 直接用），此处按同一出口再导出。
export { dictCodes };
