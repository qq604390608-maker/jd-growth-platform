/**
 * 文档卡（阶段2 · M5 工具执行程序 · **F-26 任务态处置写入面** · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用）
 *   ｜ `../../docs/03-locks/schema.md` PD-01 `task`（`task_status` 走 `dict:TASK_STATUS`＝running/blocked/stopped/done；
 *        `done_part` 已完成部分，**受阻或停止时保留的已有工作**；`retry_count` 本任务已重试次数；
 *        `is_auto_restart` **停止状态一律 0**；`ended_at` 任务结束时点、进行中为空）｜
 *        PD-03 `task_block`（`block_id` PK 形如 `BL-001`、`block_reason_code` 走 `dict:BLOCK_REASON` 六项、
 *        `block_note` 受阻具体说明、`resume_condition` 继续研究的条件、`is_resolved` 0/1）｜§12 Q-12（卡死门槛待裁决）
 *   ｜ `../../docs/01-brd/BRD.md` §4 F-06 **任务受阻处理矩阵 + 状态流**（F-26 与之共用状态机口径：
 *        第 3 行「来源未接入或权限不足」→ 记录接口不可用原因；第 4 行「查询或服务调用失败」→ 保留失败原因、按配置限制重试、
 *        持续失败暂停受影响研究；「达到运行限制或人工取消」→ **停止状态不自动重启**）
 *   ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md` F-26（**实在卡死保留状态停止**）、§5 验收总则（状态口径与 M1 F-06 / M6 F-32 一致）
 *   ｜ `../../docs/04-plan/dev-plan.md` 阶段 3（完整状态机归 `server/task-runner`，本文件只按共用口径写任务态）
 * 职责：F-26 的**本平台自有 D1 写入面**——`PD-01 task` 的任务态与已完成部分、`PD-03 task_block` 的受阻留痕，
 *   以及只读回查。**只写本平台库**，不碰任何外部系统、不碰 `EXT-02 evidence` / `MD-07 research`
 *   （运行失败**不作为否定研究结论的依据**）。
 * 边界：单独成文件的理由与 `mcp-client.js` 同：让**写入面可被静态验证**——
 *   `test-f23.mjs` 的「模块 SQL 无 UPDATE / DELETE」断言**逐字不动**（`index.js` 仍不含 UPDATE/DELETE），
 *   本文件的写入面由 `test-f26.mjs` 单独收紧断言：`UPDATE` **只落在 `task`**、必带 `WHERE task_id = ?`（禁全表更新）、
 *   无 `DELETE / DROP / ALTER / TRUNCATE`、无任何外部 HTTP 调用。这样「生产零写」这条硬红线
 *   仍是**可由静态扫描证明**的，而不是靠人工保证。
 * 不变量：`block_reason_code` / `task_status` 的值域**一律从 `dict_item` 读**（不内联复制）；
 *   `assertTaskRunnable` 前置守卫（已 `stopped`/`done` 不进入执行，避免「先执行、后拒写」留半截状态）；
 *   停止状态不自动重启；已完成任务不改写；`done_part` 只追加、绝不覆盖。
 *
 * 反向清单：被 `./index.js`（F-26 `handleQueryFailure` 调用本文件的受阻留痕与任务态处置）引用；
 *   被 `./test-f26.mjs` 直接引用并断言写入面；登记 `./README.md` 与 `../README.md`。
 */

const nowStamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** 受阻原因只取 `dict:BLOCK_REASON` 的 `item_code`（写入前逐条校验值域）。 */
export const BLOCK_REASON_CODE = {
  call_failed: "call_failed", // 受阻矩阵第 4 行「查询或服务调用失败」
  source_unavailable: "source_unavailable", // 受阻矩阵第 3 行「来源未接入或权限不足」
};

/** 任务态守卫失败（「停止状态不自动重启」等）——与库级约束错误区分，供路由映射为 400。 */
export class TaskStateError extends Error {
  constructor(message, { reason_code = null } = {}) {
    super(message);
    this.name = "TaskStateError";
    this.reason_code = reason_code;
  }
}

/** 通用字典取值：`dict_item.item_code` 按 `order_no` 取。值域一律从库读，不在代码里内联复制。 */
export async function dictCodes(db, dict_type_code) {
  const rows = await db
    .prepare("SELECT item_code FROM dict_item WHERE dict_type_code = ? ORDER BY order_no")
    .bind(dict_type_code)
    .all();
  return (rows.results || []).map((r) => r.item_code);
}

// ---------------------------------------------------------------- PD-01 任务态

export async function getTask(db, task_id) {
  return db.prepare("SELECT * FROM task WHERE task_id = ?").bind(task_id).first();
}

/**
 * **前置守卫**：已结束的任务不再接受新的执行——`stopped`（**停止状态不自动重启**）与 `done`（已结束不重开）。
 * 放在任何执行 / 写入**之前**调用，避免「先执行、后拒写」留下半截状态（一条无主 EXT-01 / 一条多余 PD-03）。
 */
export async function assertTaskRunnable(db, task_id) {
  const task = await getTask(db, task_id);
  if (!task) throw new TaskStateError(`任务不存在：${task_id}`, { reason_code: "task_not_found" });
  if (task.task_status === "stopped") {
    throw new TaskStateError(
      `停止状态不自动重启：${task_id} 已是「已停止」，不接受新的执行（BRD F-06 状态流）`,
      { reason_code: "stopped_no_auto_restart" },
    );
  }
  if (task.task_status === "done") {
    throw new TaskStateError(`任务已完成：${task_id} 已结束，不接受新的执行（不改写已结束的任务态）`, {
      reason_code: "done_immutable",
    });
  }
  return task;
}

/** 下一个受阻记录号：`BL-` + 3 位数字（形如 `BL-001`），取库内已用最大值 +1，确定性可复现不撞号。 */
export async function nextBlockId(db) {
  const rows = (await db.prepare("SELECT block_id FROM task_block").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = /^BL-(\d+)$/.exec(String(r.block_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `BL-${String(max + 1).padStart(3, "0")}`;
}

/** 受阻记录回查（`PD-03`）：可按任务 / 是否已解除过滤，排序稳定（`block_id`）。 */
export async function listTaskBlocks(db, { task_id, is_resolved } = {}) {
  const where = [];
  const args = [];
  if (task_id !== undefined) { where.push("task_id = ?"); args.push(task_id); }
  if (is_resolved !== undefined) { where.push("is_resolved = ?"); args.push(Number(is_resolved)); }
  const sql = `SELECT * FROM task_block ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY block_id`;
  return (await db.prepare(sql).bind(...args).all()).results;
}

/** 写一条受阻记录（`PD-03`）。`block_reason_code` 必须落在 `dict:BLOCK_REASON` 值域内。 */
export async function recordBlock(db, { task_id, block_reason_code, block_note, resume_condition, blocked_at, is_resolved = 0 } = {}) {
  const codes = await dictCodes(db, "BLOCK_REASON");
  if (!codes.includes(block_reason_code)) {
    throw new Error(
      `block_reason_code '${String(block_reason_code)}' 不在 dict:BLOCK_REASON 值域内（${codes.join(" / ")}）`,
    );
  }
  if (!task_id) throw new TaskStateError("recordBlock：task_id 必填（受阻记录须归属真实任务）", { reason_code: "missing_task" });

  const block_id = await nextBlockId(db);
  const r = await db
    .prepare(
      `INSERT INTO task_block
       (block_id, task_id, block_reason_code, block_note, resume_condition, blocked_at, is_resolved)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(block_id, task_id, block_reason_code, block_note, resume_condition, blocked_at || nowStamp(), Number(is_resolved))
    .run();
  if (r && r.success === false) throw new Error(r.error || "task_block 插入失败");
  return db.prepare("SELECT * FROM task_block WHERE block_id = ?").bind(block_id).first();
}

/**
 * 置任务态（`PD-01`）。两条守卫来自 BRD F-06：
 * ① **停止状态不自动重启**——`task_status='stopped'` 的任务不允许被改回运行中 / 受阻；
 * ② 已完成任务不改写——`done` 不允许被改回受阻（不改写已结束的任务态）。
 * `is_auto_restart` 一律写 0（schema PD-01 口径：停止状态一律 0）。
 */
export async function setTaskStatus(db, task_id, status, { ended_at = null } = {}) {
  const statuses = await dictCodes(db, "TASK_STATUS");
  if (!statuses.includes(status)) {
    throw new Error(`task_status '${String(status)}' 不在 dict:TASK_STATUS 值域内（${statuses.join(" / ")}）`);
  }
  const task = await getTask(db, task_id);
  if (!task) throw new TaskStateError(`任务不存在：${task_id}`, { reason_code: "task_not_found" });
  if (task.task_status === "stopped") {
    throw new TaskStateError(
      `停止状态不自动重启：${task_id} 已是「已停止」终态，不接受状态变更（目标「${status}」）——后续是否继续须人工明确（BRD F-06 受阻矩阵）`,
      { reason_code: "stopped_no_auto_restart" },
    );
  }
  if (task.task_status === "done") {
    throw new TaskStateError(`任务已完成：不允许把 ${task_id} 改回「${status}」（不改写已结束的任务态）`, {
      reason_code: "done_immutable",
    });
  }
  const r = await db
    .prepare("UPDATE task SET task_status = ?, is_auto_restart = 0, ended_at = COALESCE(?, ended_at) WHERE task_id = ?")
    .bind(status, ended_at, task_id)
    .run();
  if (r && r.success === false) throw new Error(r.error || "task 状态更新失败");
  return getTask(db, task_id);
}

/** 保留已完成部分：**只追加、绝不覆盖**；空片段不写、重复片段不重复追加（幂等）。 */
export async function appendDonePart(db, task_id, fragment) {
  const task = await getTask(db, task_id);
  if (!task) throw new TaskStateError(`任务不存在：${task_id}`, { reason_code: "task_not_found" });
  const text = String(fragment ?? "").trim();
  if (!text) return task;
  const cur = String(task.done_part ?? "");
  if (cur.includes(text)) return task;
  const next = cur ? `${cur}；${text}` : text;
  const r = await db.prepare("UPDATE task SET done_part = ? WHERE task_id = ?").bind(next, task_id).run();
  if (r && r.success === false) throw new Error(r.error || "task done_part 更新失败");
  return getTask(db, task_id);
}
