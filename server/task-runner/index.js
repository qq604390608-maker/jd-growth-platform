/**
 * 文档卡（阶段3 · M1 · task-runner Worker 入口 · TS-20 部署形态落地 · 2026-09-21）
 * 上游：../../docs/03-locks/tech-stack.md **§7.3（TS-20 已决 2026-09-21，依用户裁决：2 个 Worker）**——
 *       `api` 与 `task-runner`（含 Queue Consumer）**分**（入口性质不同）；`agent-orchestrator` 与
 *       `tool-executor` 与 `shared-context` 随 `api` **合**（调用链紧密，省一次 Service Binding 往返）。
 *       名字与职责边界以 §2.2 为准（宪法索引），拆分不改模块名。
 *   ｜ ../../docs/03-locks/schema.md（CFG-04 `run_policy`：**无 last_run/next_run 列**——到期判定从
 *       PD-01 `task` 推导：`task_type='discovery' AND goal_id=?` 的最大 `started_at`；不擅改 schema）
 *   ｜ ./schedule.js（F-02：`parseRunFrequency` / `resolveRunPolicy` / `createDiscoveryTask` / `createLocalEnqueue` / `delegateToAgent`）
 *   ｜ ../../docs/04-plan/full-flow-wiring-plan.md 期 2.3（**F-36**：轮询与执行体的异常隔离）
 * 职责：**runner Worker 薄壳入口**（`wrangler.runner.toml` 的 `main`）：
 *   - `scheduled`＝一个 tick 三相位（顺序真源 `TICK_PHASES`，固定 `due → heal → work`），**各自异常隔离**（F-36）：
 *     ① `runDueDiscoveryCalls` 到期轮询：对每个 `goal_status='active'` 的目标取生效策略（目标级优先回落平台级），
 *        按「距该目标最近一次 discovery 任务 ≥ 频率最小间隔」判定到期 → `createDiscoveryTask`。
 *        **判定口径（显式近似，登记 Q-17）**：以「最小间隔」近似「到点触发」——每日/每周策略的实际触发时刻
 *        可能相对名义时刻漂移（≤ 一个轮询周期）；精确到点挂真 Queues / per-policy cron 接入后修正。
 *     ② `runSelfHealScan` 自愈补扫（F-33 / 堵 P1-2）：把「running 但丢了 active 步」的任务补回 active（幂等）。
 *     ③ `runPendingWork` 驱动执行体（阶段4 接线）：按 `WIRED_TASK_TYPES` 消费 active 步骤跑真实编排。
 *     **隔离口径（F-36 / 堵 P1-1）**：任一相位抛错**只影响该相位**——其余相位照跑；失败**如实回报**在返回体的
 *     `phases.<相位>.{ok,why}` 并呼叫 `onError`（默认 `console.error`，供 `wrangler tail` 观测），**不静默吞错**。
 *     修的是原实现：`runDueDiscoveryCalls` 排在执行体之前且无 try/catch，任一目标抛错（如无生效策略）
 *     → 整个 `scheduled` reject → 本 tick 所有 `active` 步永不执行，且**每分钟重演**。
 *     **顺序刻意不重排**：保持 `due → heal → work` 是为了**同 tick 流水线**——本轮新建任务的步 1（`active`）
 *     与本轮自愈补回的 `active` 步，都在**同一 tick** 被 ③ 拾起执行；把 ③ 提到最前只会把它们推迟一个 tick。
 *   - `queue`：消费 `{ task_id, step_no }`（形状由 `assertStepMessage` 保证）→ **按 `task_type` 分派**：
 *     `discovery` 走 `./executor.js`、`hva_research` 走 `./research.js`（F-33 接线 2026-09-21），
 *     其余类型（`hva_followup` / `goal_check`）仍走 `delegateToAgent` 契约占位（消费即如实回报，不臆造执行结果）。
 * 硬红线：生产零写不含——本 Worker 的 scheduled **写的是自有 D1 的 PD-01/PD-02/PD-06**（与 API Worker 同库、
 *   同一套单一写入面），不触碰任何外部系统；凭证不落本文件（CI Secrets 注入）。
 * 边界：投递用 `createLocalEnqueue`（D1 痕迹式投递：pending→active），**真 Queues producer 绑定未接**
 *   （门禁见 external-deps §7）；接入后仅替换 enqueue 工厂，本文件判定逻辑不动。
 *   **`queue()` 的逐消息隔离不在 F-36 范围**：该路径当前是 D1 痕迹式投递、真 Queues 未接（P1-4）；
 *   接入后按「一条消息失败不阻塞同批其余消息」单独登记处理（本项只做三相位的相位级隔离）。
 *   执行体驱动（`./executor.js` 的 `runPendingWork`）自 2026-09-21 起套**单 tick 守卫**（F-34：步数配额 +
 *   同 tick 去重 + 单步超时，本体在 `./tick-guard.js`）——`scheduled` 的返回体因此多带
 *   `timed_out` / `exhausted` / `quota` 三个观测字段（**纯增量**，既有键不动）。
 * 反向清单：被 `wrangler.runner.toml`（main）与 CI deploy 第二步引用；用例 `./test-ts20.mjs`（入口装配与判定矩阵）、
 *   `./test-f33.mjs`（分派）与 `./test-f36.mjs`（**相位隔离**）；登记 `../README.md`（模块清单 task-runner 行）与 `./README.md`。
 */
import { parseRunFrequency, resolveRunPolicy, createDiscoveryTask, createLocalEnqueue, delegateToAgent } from "./schedule.js";
import { getTask } from "./step-plan.js";
import { runStepMessage, runPendingWork } from "./executor.js";
import { runSelfHealScan } from "./self-heal.js";
import { WIRED_TASK_TYPES } from "./research.js";

/** 每日 → 1440 分钟；每周 → 10080；每 N 小时 → N*60（取各频率的最小触发间隔）。 */
export function freqIntervalMin(text) {
  const { kind, points } = parseRunFrequency(text);
  if (kind === "hourly") return points[0].everyHours * 60;
  if (kind === "weekly") return 7 * 24 * 60;
  return 24 * 60; // daily / daily_multi
}

const MINUTE_MS = 60_000;

/**
 * 到期轮询（scheduled 的可测本体）。
 * @returns {Promise<{checked:number, due:string[], created:string[], skipped:{goal_id:string, why:string}[]}>}
 */
export async function runDueDiscoveryCalls(db, { now = new Date(), enqueue } = {}) {
  const goals = (await db.prepare("SELECT goal_id FROM research_goal WHERE goal_status = 'active'").all()).results || [];
  const out = { checked: 0, due: [], created: [], skipped: [] };
  for (const { goal_id } of goals) {
    out.checked++;
    const { policy } = await resolveRunPolicy(db, { goal_id });
    if (!policy) {
      out.skipped.push({ goal_id, why: "无生效运行策略" });
      continue;
    }
    const intervalMin = freqIntervalMin(policy.run_frequency);
    const lastRows = (await db
      .prepare("SELECT MAX(started_at) AS last_at FROM task WHERE task_type = 'discovery' AND goal_id = ?")
      .bind(goal_id)
      .all()).results || [];
    const lastAt = lastRows[0]?.last_at ?? null;
    if (lastAt) {
      const elapsedMin = (now.getTime() - new Date(String(lastAt).replace(" ", "T")).getTime()) / MINUTE_MS;
      if (elapsedMin < intervalMin) {
        out.skipped.push({ goal_id, why: `距上次发现任务 ${Math.floor(elapsedMin)} 分钟 < 最小间隔 ${intervalMin} 分钟` });
        continue;
      }
    }
    out.due.push(goal_id);
    const r = await createDiscoveryTask(db, {
      goal_id,
      trigger_basis: `runner 到期轮询（${policy.policy_scope} 级策略 ${policy.policy_id}，${policy.run_frequency}）`,
      at: stamp(now),
      enqueue,
    });
    out.created.push(r.task.task_id);
  }
  return out;
}

/** nowStamp 同形：YYYY-MM-DD HH:MM（与库内 started_at 口径一致）。 */
function stamp(d) {
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ==================================================== 三相位异常隔离（F-36）

/**
 * 一个 tick 的相位清单与**顺序真源**（F-36）。用例断言它的值即锁死「顺序不被静默重排」。
 * 顺序＝流水线顺序：先「造出待办」（到期建任务 / 自愈补步），再「消费待办」（驱动执行体），
 * 使本轮新建与补回的 `active` 步在**同一 tick** 内被执行。
 */
export const TICK_PHASES = Object.freeze(["due", "heal", "work"]);

/** 相位失败时执行体结果的空形态：**键齐、值空**——下游按键读取不会因相位失败而崩。 */
const EMPTY_WORK = Object.freeze({ executed: [], finished: [], timed_out: [], exhausted: false, quota: 0 });

/**
 * 跑单个相位并隔离其异常（F-36）。
 * 成功 → `{ok:true, value}`；失败 → `{ok:false, why}`（**错误不吞、不外抛**，交由 `runTick` 回报）。
 */
async function runPhase(fn) {
  try {
    return { ok: true, value: await fn() };
  } catch (e) {
    return { ok: false, why: e && e.message ? String(e.message) : String(e) };
  }
}

/** 相位回报的对外形态：只留 `ok` / `why`（不把整包结果塞进 `phases`）。 */
function briefPhase(r) {
  return r.ok ? { ok: true } : { ok: false, why: r.why };
}

/**
 * 一个 tick 的调度本体（`scheduled` 的可测本体，F-36）。
 * 三相位按 `TICK_PHASES` 顺序执行，**各自 try/catch 隔离**：任一抛错只影响自己，其余照跑；
 * 失败如实回报在 `phases.<相位>.why` 并呼叫 `onError`（不静默吞错）。
 * @param {object} db D1 句柄
 * @param {{due?:Function, heal?:Function, work?:Function, onError?:Function}} [opts]
 *   相位覆盖（用例注入以**确定性**验证隔离，不必真造库级异常）；`onError(phase, why)` 默认 `console.error`。
 * @returns {Promise<{executed:Array, finished:Array, timed_out:Array, exhausted:boolean, quota:number,
 *   healed:string[], phases:{due:object, heal:object, work:object}}>}
 */
export async function runTick(db, opts = {}) {
  const real = {
    due: () => runDueDiscoveryCalls(db),
    heal: () => runSelfHealScan(db),
    work: () => runPendingWork(db),
  };
  const onError = typeof opts.onError === "function" ? opts.onError : (phase, why) => console.error(`[runner] 相位 ${phase} 失败：${why}`);
  const phases = {};
  const results = {};
  for (const name of TICK_PHASES) {
    const fn = typeof opts[name] === "function" ? opts[name] : real[name];
    const r = await runPhase(fn);
    results[name] = r;
    phases[name] = briefPhase(r);
    if (!r.ok) onError(name, r.why);
  }
  const worked = results.work.ok ? results.work.value : EMPTY_WORK;
  return {
    ...worked,
    healed: results.heal.ok ? (results.heal.value && results.heal.value.healed) || [] : [],
    phases,
  };
}

export default {
  /** Cron Triggers 到点入口（宽 cron 每分钟一次，到期判定在程序侧——CFG-04 频率是数据不是配置）。 */
  async scheduled(controller, env, ctx) {
    return runTick(env.DB);
  },
  /**
   * Queue Consumer：消息形状两键（`assertStepMessage` 保证）。
   * 已接线类型（`WIRED_TASK_TYPES`：discovery / hva_research）→ 真实步骤执行体
   * （`executor.js` 的 `runStepMessage`：按类型分派 → 执行 + 跃迁 + 推进）；
   * 其余类型（hva_followup / goal_check）仍走 `delegateToAgent` 契约占位（接线归后续 PR）。
   * 注：**逐消息隔离不在 F-36 范围**（本路径真 Queues 未接，见文件头「边界」段）。
   */
  async queue(batch, env, ctx) {
    const results = [];
    for (const message of batch.messages) {
      const body = message.body || {};
      let task = null;
      try {
        task = body.task_id ? await getTask(env.DB, body.task_id) : null;
      } catch (e) {
        task = null;
      }
      const r = task && WIRED_TASK_TYPES.includes(task.task_type)
        ? await runStepMessage(env.DB, { task_id: body.task_id, step_no: Number(body.step_no) })
        : await delegateToAgent(env.DB, body);
      results.push(r);
      message.ack();
    }
    return results;
  },
};
