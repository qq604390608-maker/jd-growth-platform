/**
 * 文档卡（阶段4 接线 · M1 · 单 tick 执行守卫 · **F-34** · 2026-09-21）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md` §四 · 期 2.1（**2a 加固版**：配额 + 去重 + 超时；
 *        用户裁决原文「2a 轻量配额（零 schema 变更）＋加固为配额+去重+超时」）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-02 验收要点（**任务程序决定何时启动**）＋ CFG-04 的
 *        「运行频率 / 时长 / 调用限制」口径｜`../../docs/01-brd/BRD.md` §5.3（生产零写）
 *   ｜ `../../docs/03-locks/schema.md` PD-02 `task_step`（`step_state` ∈ `dict:STEP_STATE`）
 *   ｜ `./step-plan.js`（**`TYPE_STEPS` 唯一真源**——配额由它派生，不复制数值）
 *   ｜ `../tool-executor/index.js`（**`DEFAULT_TIMEOUT_MS` 唯一真源**——单步超时由它派生）
 * 职责：`./executor.js` 的 `runPendingWork` 每 tick 扫描 `active` 步骤时套用的**三道轻量守卫**
 *   （**纯计算**：零数据库访问、零 SQL、零写动作——可用例静态扫死）：
 *   ① **步数配额**：一个 tick 至多执行 `TICK_QUOTA` 步。把大批次摊到多个 tick——
 *      重叠窗口由「一个 tick 跑完整批（12 任务 × 5 步 = 60 步）」缩到「至多 5 步」，
 *      这是 P0-2「93 条重复机会」的直接成因（`for(;;)` 无界重查 + 跨 tick 重叠）。
 *   ② **同 tick 去重**：同一 `(task_id, step_no)` 在本 tick 内**只执行一次**。
 *      两个作用：防重入；以及**防死循环**——步骤超时被放弃后仍是 `active`，
 *      没有去重就会被下一轮重查再次选中，同一 tick 内无限重试。
 *   ③ **单步超时**：单步超过 `STEP_TIMEOUT_MS` 即**放弃等待**（本 tick 不再重复占用）。
 *      超时**不是失败**：不落 PD-03、不改 `task_status`、不落 done——步骤保持 `active`，
 *      下个 tick 自然重试（网络慢与失败必须区分开，否则会误伤真实返回）。
 * 边界（2a 路线的如实登记，勿当成缺陷）：本守卫**不是真独占**——两个并发 tick 仍可能同时选中同一步；
 *   真独占需 2b 租约（`PD-02` 加列，已否决）或期 3 真 Queues 的 `max_batch_size = 1`（本次范围外）。
 *   另：`dict:STEP_STATE` 值域只有 `pending / active / done / blocked`（**没有 running**），
 *   故**不能**靠「置 running」做占位式独占——这是零 schema 变更路线的硬边界。
 * 反向清单：被 `./executor.js` 引用（`runPendingWork` 的唯一使用方）；登记 `./README.md`；
 *   测试 `./test-f34.mjs`（含「派生等式」与「零 SQL」静态断言）。
 * 用法：`const g = createTickGuard(); g.hasCapacity(); g.isDuplicate(id, no); await g.runStep(id, no, workFn)`。
 */
import { DEFAULT_TIMEOUT_MS } from "../tool-executor/index.js";
import { TYPE_STEPS } from "./step-plan.js";

/**
 * 每 tick 步数配额。**派生自** `TYPE_STEPS` 的最大步数（不复制数值、不当魔法数字）：
 * 含义＝「一个 tick 至多跑满**一个任务**的整轮步骤」——
 * 低于它会把单任务切得过碎（五次调用才推进一轮），高于它则失去「摊薄批次」的作用。
 * 与 `STEP_TIMEOUT_MS` 的关系受 `./test-f34.mjs` 的派生断言约束。
 */
export const TICK_QUOTA = Math.max(...Object.values(TYPE_STEPS).map((steps) => steps.length));

/**
 * 单步超时。**派生自**传输层自身超时 `DEFAULT_TIMEOUT_MS`（`../tool-executor/mcp-client.js`），
 * 且必须**大于**它——否则会误杀「传输层本可完成」的步骤（那会把真实返回变成超时放弃）。
 * 取 2 倍：留出余量给单步内部的多源循环与重试（`CFG-04.retry_limit`）。
 */
export const STEP_TIMEOUT_MS = DEFAULT_TIMEOUT_MS * 2;

/** 单步被放弃的哨兵（只在本 tick 内用于记账；不进库、不落任何状态）。 */
export const STEP_TIMED_OUT = Symbol("step_timed_out");

/**
 * 单步超时包装：启动 `work`，超过 `timeoutMs` 即放弃等待并返回 `STEP_TIMED_OUT`。
 * **不取消** `work`（编排层无取消通道）——只放弃等待；被放弃的 Promise 挂空 catch，
 * 避免其后来的拒绝变成未处理拒绝（unhandled rejection）而污染运行期。
 * `timer` / `clear` 可注入：用例据此**确定性**触发超时分支，不依赖真实等待。
 */
export async function withStepTimeout(work, { timeoutMs = STEP_TIMEOUT_MS, timer = setTimeout, clear = clearTimeout } = {}) {
  if (typeof work !== "function") throw new Error("withStepTimeout：work 必须是函数（本步的执行体）");
  const pending = Promise.resolve().then(() => work());
  let handle = null;
  const timeout = new Promise((resolve) => {
    handle = timer(() => resolve(STEP_TIMED_OUT), timeoutMs);
  });
  let result;
  try {
    result = await Promise.race([pending, timeout]);
  } finally {
    if (handle !== null) clear(handle); // 正常返回也要清掉定时器，不留悬挂句柄
  }
  if (result === STEP_TIMED_OUT) {
    pending.catch(() => {}); // 放弃等待后不再关心其结局
    return STEP_TIMED_OUT;
  }
  return result;
}

/**
 * 建一个 tick 守卫。用法见 `./executor.js` 的 `runPendingWork`：
 * 每轮选批前问 `hasCapacity()`，每行前问 `isDuplicate()`，执行经 `runStep()` 记账。
 * @returns {{quota:number, timeoutMs:number, executed:number, timed_out:Array, hasCapacity:()=>boolean,
 *            isDuplicate:(task_id:string, step_no:number)=>boolean, runStep:Function}}
 */
export function createTickGuard({ quota = TICK_QUOTA, timeoutMs = STEP_TIMEOUT_MS, timer, clear } = {}) {
  if (!Number.isInteger(quota) || quota < 1) throw new Error(`tick 配额必须是 ≥1 的整数（收到 ${String(quota)}）`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error(`单步超时必须是正数（收到 ${String(timeoutMs)}）`);
  const seen = new Set();
  const timed_out = [];
  let executed = 0;
  return {
    quota,
    timeoutMs,
    get executed() {
      return executed;
    },
    /** 本 tick 被放弃的步骤（`{task_id, step_no}`）；只记账，不落库。 */
    get timed_out() {
      return timed_out;
    },
    /** 是否还有配额。 */
    hasCapacity() {
      return executed < quota;
    },
    /** 本 tick 是否已执行过该 `(task_id, step_no)`（去重判据）。 */
    isDuplicate(task_id, step_no) {
      return seen.has(`${String(task_id)}#${Number(step_no)}`);
    },
    /**
     * 执行一步：**先占配额与去重位**，再跑 `work` 并施加单步超时。
     * 返回 `work` 的结果，或超时哨兵 `STEP_TIMED_OUT`。
     */
    async runStep(task_id, step_no, work) {
      seen.add(`${String(task_id)}#${Number(step_no)}`);
      executed += 1;
      const r = await withStepTimeout(work, { timeoutMs, timer, clear });
      if (r === STEP_TIMED_OUT) timed_out.push({ task_id, step_no: Number(step_no) });
      return r;
    },
  };
}
