/**
 * 文档卡（阶段4 接线 · M1 · **F-33 卡死任务自愈补扫** · 2026-09-21）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md`（断点 **P1-2「建任务与置 `active` 非原子」**：
 *        `schedule.js` 插 task → 落五步 `pending` → enqueue 才把步 1 置 `active`；中间异常即「任务 running、
 *        五步全 pending、无 active 步」→ 永远不被执行体选中 → `0 / N 步` 永久。**与线上 T-0026 / T-0029 同形**。
 *        期 1 · 1.5「顺带堵 P1-2」：cron 侧加自愈补扫）
 *   ｜ `../../docs/03-locks/schema.md`（PD-01 `task.task_status` 走 `dict:TASK_STATUS`；PD-02 `task_step.step_state`
 *        走 `dict:STEP_STATE`，值域只有 `pending/active/done/blocked`——**没有 `running`**，故不得靠置 `running` 做独占）
 *   ｜ `../../docs/05-test-cases/test-M1.md`（TC-I-M1-006：每个状态跃迁是一行可查数据——本件的补扫不新增状态枚举，
 *        只把既有的 `pending → active` 跃迁补上，仍落在 PD-02 上可查）
 *   ｜ `./step-plan.js`（PD-02 推进的唯一写入面 `advanceStep`；`listTaskObjects` 读面）
 *   ｜ `./research.js`（`WIRED_TASK_TYPES` / `RESEARCH_TASK_TYPE`：**已接线任务类型清单的唯一真源**，不复制第二份）
 * 职责：**cron 侧的兜底补扫**——扫出「`task_status='running'`、已有步骤计划、但**没有任何 `active` 步**」的任务，
 *   把最小步号的 `pending` 步置回 `active`，让执行体在下一个 tick 能重新接上。幂等：补扫后该任务已有 active 步，
 *   下一轮不再命中；执行体消费完自然继续推进，**不重复执行已 done 的步**。
 * 边界：**只补「计划在、`active` 丢」这一种**——不建任务、不建步骤、不改 `task_status`、不写 `MD-07`。
 *   特别地：`hva_research` 任务若**连 MD-07 研究壳都没有**（F-04 建壳前的遗留任务），本件**不擅自代建研究壳**
 *   （建壳归 F-04，单一作者），只**如实登记为 skipped 并说明原因**——让缺口可见，而不是被静默「治好」。
 * 硬红线：本文件**零外部调用**；改行只经 `./step-plan.js` 的 `advanceStep`（PD-02 单一写入面），**不含裸 SQL 改行**、
 *   **不含删行语句**；查询语句只读 `task` / `task_step`（本件不写 `task`）。
 * 反向清单：被 `./index.js`（scheduled 兜底调用）引用；登记 `./README.md`；用例 `./test-f33.mjs`。
 */
import { advanceStep, listTaskObjects } from "./step-plan.js";
import { WIRED_TASK_TYPES, RESEARCH_TASK_TYPE } from "./research.js";

/**
 * 自愈补扫（幂等）。
 * @param {object} db D1 形式
 * @returns {Promise<{scanned:number, healed:Array<{task_id:string, step_no:number}>, skipped:Array<{task_id:string, why:string}>}>}
 */
export async function runSelfHealScan(db) {
  const out = { scanned: 0, healed: [], skipped: [] };
  const placeholders = WIRED_TASK_TYPES.map(() => "?").join(", ");
  const rows = (await db
    .prepare(
      `SELECT t.task_id AS task_id, t.task_type AS task_type, MIN(s.step_no) AS step_no
         FROM task t JOIN task_step s ON s.task_id = t.task_id
        WHERE t.task_status = 'running'
          AND s.step_state = 'pending'
          AND t.task_type IN (${placeholders})
          AND NOT EXISTS (
                SELECT 1 FROM task_step a WHERE a.task_id = t.task_id AND a.step_state = 'active'
              )
        GROUP BY t.task_id, t.task_type
        ORDER BY t.task_id`,
    )
    .bind(...WIRED_TASK_TYPES)
    .all()).results || [];
  out.scanned = rows.length;

  for (const row of rows) {
    if (row.task_type === RESEARCH_TASK_TYPE) {
      const links = await listTaskObjects(db, { task_id: row.task_id, link_role: "output" });
      if (!links.some((l) => l.object_type === "research")) {
        out.skipped.push({
          task_id: row.task_id,
          why: "研究壳（MD-07）缺失——建壳归 F-04，本件不擅自代建；需运维按建议提交时刻补建后再补扫",
        });
        continue;
      }
    }
    await advanceStep(db, { task_id: row.task_id, step_no: Number(row.step_no), step_state: "active" });
    out.healed.push({ task_id: row.task_id, step_no: Number(row.step_no) });
  }
  return out;
}
