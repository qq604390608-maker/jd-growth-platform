/**
 * 文档卡（阶段3 · M1 · **F-06 任务记录与异常恢复** · 2026-09-19）
 * 上游：../../AGENTS.md（宪法：白盒原则｜编号体系｜双向引用）
 *   ｜ ../../docs/01-brd/BRD.md §4 F-06（**任务受阻处理矩阵 + 状态流**；验收要点：状态机／停止状态不自动重启／
 *        研究内容与运行状态分别记录）
 *   ｜ ../../docs/02-prd/PRD-M1-平台任务程序.md F-06（任务记录与异常恢复：保存启动依据／指令与能力版本／查询及返回记录／
 *        已形成内容／当前状态；失败按配置限制重试、持续失败暂停受影响研究、真卡死保留已完成部分停止；
 *        **运行失败本身不能作为否定某项 HVA 的研究依据**）
 *   ｜ ../../docs/03-locks/schema.md PD-01 `task`（`task_status` 走 `dict:TASK_STATUS`＝running/blocked/stopped/done；
 *        `done_part` 已完成部分、**受阻或停止时保留的已有工作**；`retry_count`；`is_auto_restart` 停止状态一律 0、`ended_at`）、
 *        PD-03 `task_block`（`block_id` PK、`block_reason_code` 走 `dict:BLOCK_REASON` 六项、`block_note`／`resume_condition`／`is_resolved`）、
 *        CFG-04 `run_policy`（`retry_limit` 平台硬上限 100）
 *   ｜ ../../docs/03-locks/tech-stack.md §4.2（Queues `max_retries`≤100）、DS-03（重试＝代码逻辑非 AI 决策）
 *   ｜ ../tool-executor/task-state.js（**F-26 任务态写入面**：F-06 全部 PD-01/PD-03 写入均复用此面，本文件**不出现任何裸 SQL**）
 *   ｜ ./step-plan.js（**F-02/F-04 步骤计划与进度写入面**：PD-02；resume 重建 active 步复用其 `advanceStep`，不另立写面）
 *   ｜ ./research.js（**F-33**：`RESEARCH_TASK_TYPES` 单一真源——resume 判定「研究类任务须有 MD-07 研究壳」复用此常量，不复制第二份）
 *   ｜ ./test-f06.mjs（F-06 oracle：U 封顶报错｜D PD-03 FK 反例｜A blocked＋done_part 保留｜B resume｜
 *        C stopped 不自动重启｜D done 不可改写｜E 失败不否定 HVA（静态无 MD-07/EXT-02 写入）｜F done_part 幂等｜S 静态零写）
 * 职责：M1 恢复编排层。复用 F-26 `task-state.js`（PD-01/PD-03）与 `./step-plan.js` 的 `advanceStep`（PD-02 步骤推进写入面）
 *   两个单一写入面，本文件**不写任何 SQL**、**不发起任何外部调用**、
 *   不写 `MD-07`（研究结论）/ `EXT-02`（证据）/ `EXT-01`（查询留痕，那归 F-25/F-26）。
 *   实现：① `capRetryLimit` —— `run_policy.retry_limit` 封顶 100，**超限显式报错而非静默截断**（TC-U-M1-002，与 F-02 写入侧 400 一致）；
 *   ② `recordTaskBlock` —— 受阻矩阵「处理调用失败／来源未接入／口径不清／接口未返回／无足够依据」→ 保留 `done_part`（已完成部分）
 *        ＋ 置 `blocked` ＋ 写 `PD-03`；③ `handleTaskFailure` —— 处理调用失败的便捷编排（`call_failed`）；
 *   ④ `stopTask` —— 矩阵「达到运行限制或人工取消」→ 保留 `done_part` ＋ 置 `stopped`（**停止状态不自动重启**，由 `task-state` 守卫）＋ 写 `PD-03(limit_or_cancel)`；
 *   ⑤ `resumeTask` —— `blocked`→`running`（状态流「检查继续条件满足 → 恢复原任务」），受阻记录（`PD-03`）为追加式历史缺口日志，本函数不改动它；
 *        **P1 修复（2026-09-22）**：resume 同步重建 active 步（调用 `rebuildActiveStepOnResume`），保证 resume 后「running 任务有且仅有一个 active 步」，
 *        否则 work 相位只消费 `active` 步 → 任务 running 却无 active 步 → 永久僵尸（线上 T-0026/T-0029 同形）；
 *        并按 schema PD-01 `ended_at` 列口径「任务结束时点；**进行中为空**」**显式清空 `ended_at`**（`clear_ended_at: true`，F-37）——
 *        受阻侧的两个写入方（F-26 对 `blocked` 留空 / 执行体 `catch` 落时刻）口径不一，不清空则恢复后成「`running` + `ended_at` 非空」脏态。
 * 不变量：运行失败**不作为否定 HVA 的依据**——F-06 只动 PD-01/PD-03（任务态与受阻留痕），绝不触碰 `MD-07 research` 结论或 `EXT-02 evidence`；
 *   此不变量由 `test-f06.mjs` 静态断言（本文件不 `import` shared-context 研究写面／tool-executor 证据写面、无 `fetch`／裸 SQL）共同证明。
 *
 * 反向清单：被 ../api/index.js（F-06 `POST /api/task-recovery`）引用；登记 ./README.md 与 ../README.md、AGENTS.md、ci.yml。
 */

import {
  getTask,
  assertTaskRunnable,
  recordBlock,
  setTaskStatus,
  appendDonePart,
  listTaskBlocks,
  TaskStateError,
  BLOCK_REASON_CODE,
} from "../tool-executor/task-state.js";
// F-06（P1 修复 2026-09-22）：resume 须重建 active 步，故复用 step-plan.js 的 PD-02 写入面 `advanceStep`
// （与 research.js 同款形态）；研究类任务是否需研究壳判定复用 research.js 的 `RESEARCH_TASK_TYPES` 单一真源。
import {
  advanceStep,
  listTaskSteps,
  listTaskObjects,
} from "./step-plan.js";
import { RESEARCH_TASK_TYPES } from "./research.js";

/** `CFG-04 run_policy.retry_limit` 平台硬上限（Queues `max_retries`，tech-stack §4.2）。 */
export const RETRY_LIMIT_CAP = 100;

const nowStamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/** 受阻矩阵（BRD §4 F-06）六类情况 → `dict:BLOCK_REASON` 枚举（值域从库读，此处仅做语义映射，校验仍在 `recordBlock` 内联字典口径）。 */
export const BLOCK_REASON = {
  target_unclear: "target_unclear", // 目标或指标口径不清
  no_data_returned: "no_data_returned", // 接口未返回研究所需信息
  source_unavailable: "source_unavailable", // 来源未接入或权限不足
  call_failed: "call_failed", // 查询或服务调用失败
  limit_or_cancel: "limit_or_cancel", // 达到运行限制或人工取消
  insufficient_basis: "insufficient_basis", // 研究完成但没有足够依据
};

/** 重导出，便于调用方统一从 F-06 取受限原因常量（避免跨模块重复引用）。 */
export { BLOCK_REASON_CODE };

/**
 * `run_policy.retry_limit` 封顶（TC-U-M1-002）：超限**显式报错**而非静默截断。
 * 与 F-02 写入侧「`retry_limit>100` 一律 400」口径一致——配置根本不会以 >100 落库，此处为恢复编排层的防御性守卫。
 */
export function capRetryLimit(limit) {
  if (!Number.isInteger(limit) || limit < 0) {
    throw new TaskStateError(`retry_limit 须为 ≥0 整数（收到：${String(limit)}）`, { reason_code: "invalid_retry_limit" });
  }
  if (limit > RETRY_LIMIT_CAP) {
    throw new TaskStateError(
      `retry_limit ${limit} 超过平台硬上限 ${RETRY_LIMIT_CAP}（Queues max_retries）；须调整运行策略配置后重试，平台不静默截断`,
      { reason_code: "retry_limit_exceeds_cap" },
    );
  }
  return limit;
}

/**
 * 受阻处理（BRD F-06 受阻矩阵「处理调用失败 / 来源未接入 / 口径不清 / 接口未返回 / 无足够依据」）：
 * ① 前置守卫（`assertTaskRunnable`：stopped/done 不进入，避免「先执行后拒写」留半截）；
 * ② 保留已完成部分（`appendDonePart` 只追加、不覆盖、幂等）；
 * ③ 写 `PD-03` 受阻留痕；
 * ④ 置 `PD-01.task_status = blocked`（`running→blocked` 允许；`stopped`/`done` 由 `task-state` 守卫拦截）。
 * 不写 `MD-07` / `EXT-02`（运行失败不作为否定 HVA 的依据）。
 */
export async function recordTaskBlock(
  db,
  { task_id, block_reason_code, block_note, resume_condition, done_part_fragment } = {},
) {
  if (!task_id) throw new TaskStateError("recordTaskBlock：task_id 必填（受阻记录须归属真实任务）", { reason_code: "missing_task" });
  await assertTaskRunnable(db, task_id); // 前置守卫：在写入之前判，不进执行
  if (done_part_fragment) await appendDonePart(db, task_id, done_part_fragment); // 保留已完成部分
  const block = await recordBlock(db, {
    task_id,
    block_reason_code,
    block_note: block_note ?? "",
    resume_condition: resume_condition ?? "",
  });
  const task = await setTaskStatus(db, task_id, "blocked"); // 置受阻
  return { task, block };
}

/** 处理调用失败的便捷编排：受阻矩阵第 4 行「查询或服务调用失败」。 */
export async function handleTaskFailure(
  db,
  { task_id, block_note, resume_condition, done_part_fragment } = {},
) {
  return recordTaskBlock(db, {
    task_id,
    block_reason_code: BLOCK_REASON.call_failed,
    block_note: block_note ?? "查询或服务调用失败（受阻矩阵第 4 行）",
    resume_condition: resume_condition ?? "服务恢复且满足任务继续条件",
    done_part_fragment,
  });
}

/**
 * 停止（BRD F-06 受阻矩阵「达到运行限制或人工取消」）：保留已完成部分 ＋ 置 `stopped` ＋ 写 `PD-03(limit_or_cancel)`。
 * 停止状态**不自动重启**——由 `task-state.setTaskStatus` 守卫：`stopped` 任务不接受任何后续状态变更。
 */
export async function stopTask(
  db,
  { task_id, block_note, resume_condition, done_part_fragment } = {},
) {
  if (!task_id) throw new TaskStateError("stopTask：task_id 必填", { reason_code: "missing_task" });
  await assertTaskRunnable(db, task_id); // 前置守卫
  if (done_part_fragment) await appendDonePart(db, task_id, done_part_fragment);
  const block = await recordBlock(db, {
    task_id,
    block_reason_code: BLOCK_REASON.limit_or_cancel,
    block_note: block_note ?? "达到运行限制或人工取消，停止后续调用（保留已完成部分，不自动重启）",
    resume_condition: resume_condition ?? "后续处理需明确是否继续",
  });
  const task = await setTaskStatus(db, task_id, "stopped", { ended_at: nowStamp() }); // 停止
  return { task, block };
}

/**
 * resume 重建 active 步（P1 修复 2026-09-22）。
 * 原 resume 只翻 `task_status=running`、不重建 active 步；而 work 相位只消费 `step_state='active'` 的步骤，
 * 导致任务 running 却无 active 步 → 永久僵尸（线上 T-0026 / T-0029 同形）。
 * 规则：① 已有 active 步 → 幂等不动；② 研究类任务（`RESEARCH_TASK_TYPES`）缺 MD-07 研究壳（LNK-04 output）
 *   → 不擅自代建（建壳归 F-04，与 self-heal 同纪律），如实回报 `missing_research_shell`；
 *   ③ 优先重试「曾受阻的步」（`blocked`），其次取首条 `pending`（落在最后 done 之后）；
 *   ④ 全 done / 无 pending 也无 blocked → 不重建（返回 `no_pending_or_blocked`）。
 * 改行只经 step-plan.js 的 `advanceStep`（PD-02 单一写入面），不含裸 SQL。
 */
export async function rebuildActiveStepOnResume(db, { task_id, task_type }) {
  const steps = await listTaskSteps(db, task_id);
  if (steps.some((s) => s.step_state === "active")) {
    return { rebuilt: false, reason: "already_active" };
  }
  if (RESEARCH_TASK_TYPES.includes(task_type)) {
    const links = await listTaskObjects(db, { task_id, link_role: "output" });
    if (!links.some((l) => l.object_type === "research")) {
      return { rebuilt: false, reason: "missing_research_shell" };
    }
  }
  const blocked = steps.filter((s) => s.step_state === "blocked").sort((a, b) => a.step_no - b.step_no);
  const pending = steps.filter((s) => s.step_state === "pending").sort((a, b) => a.step_no - b.step_no);
  const target = blocked[0] || pending[0];
  if (!target) {
    return { rebuilt: false, reason: "no_pending_or_blocked" };
  }
  await advanceStep(db, { task_id, step_no: target.step_no, step_state: "active" });
  return { rebuilt: true, active_step: target.step_no, from_state: blocked[0] ? "blocked" : "pending" };
}

export async function resumeTask(db, { task_id } = {}) {
  if (!task_id) throw new TaskStateError("resumeTask：task_id 必填", { reason_code: "missing_task" });
  const task = await getTask(db, task_id);
  if (!task) throw new TaskStateError(`任务不存在：${task_id}`, { reason_code: "task_not_found" });
  if (task.task_status !== "blocked") {
    throw new TaskStateError(
      `resumeTask：仅 blocked 任务可恢复（${task_id} 当前为「${task.task_status}」）——running 无需恢复、stopped/done 为终态不可改`,
      { reason_code: "resume_requires_blocked" },
    );
  }
  // 「进行中为空」（schema PD-01 `ended_at` 列口径）：恢复即回到进行中，故**显式清空**旧值——
  // 受阻时的写入方有两个（F-26 对 `blocked` 留空、执行体 `catch` 落时刻），不清空则恢复后成
  // 「`running` + `ended_at` 非空」的脏态（线上 T-0026 即此形；修法方向经用户裁决＝「resume 清空」）。
  const updated = await setTaskStatus(db, task_id, "running", { clear_ended_at: true });
  // P1 修复：重建 active 步——resume 后须保证「running 任务有且仅有一个 active 步」，否则 work 相位只消费 active 步 → 永久僵尸。
  const rebuild = await rebuildActiveStepOnResume(db, { task_id, task_type: task.task_type });
  const open = await listTaskBlocks(db, { task_id, is_resolved: 0 });
  return { task: updated, open_blocks: open || [], ...rebuild };
}
