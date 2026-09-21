/**
 * 文档卡（阶段3 · M1 · task-runner Worker 入口 · TS-20 部署形态落地 · 2026-09-21）
 * 上游：../../docs/03-locks/tech-stack.md **§7.3（TS-20 已决 2026-09-21，依用户裁决：2 个 Worker）**——
 *       `api` 与 `task-runner`（含 Queue Consumer）**分**（入口性质不同）；`agent-orchestrator` 与
 *       `tool-executor` 与 `shared-context` 随 `api` **合**（调用链紧密，省一次 Service Binding 往返）。
 *       名字与职责边界以 §2.2 为准（宪法索引），拆分不改模块名。
 *   ｜ ../../docs/03-locks/schema.md（CFG-04 `run_policy`：**无 last_run/next_run 列**——到期判定从
 *       PD-01 `task` 推导：`task_type='discovery' AND goal_id=?` 的最大 `started_at`；不擅改 schema）
 *   ｜ ./schedule.js（F-02：`parseRunFrequency` / `resolveRunPolicy` / `createDiscoveryTask` / `createLocalEnqueue` / `delegateToAgent`）
 * 职责：**runner Worker 薄壳入口**（`wrangler.runner.toml` 的 `main`）：
 *   - `scheduled`：到点轮询 → 对每个 `goal_status='active'` 的目标取生效策略（目标级优先回落平台级），
 *     按「距该目标最近一次 discovery 任务 ≥ 频率最小间隔」判定到期 → `createDiscoveryTask`。
 *     **判定口径（显式近似，登记 Q-17）**：以「最小间隔」近似「到点触发」——每日/每周策略的实际触发时刻
 *     可能相对名义时刻漂移（≤ 一个轮询周期）；精确到点挂真 Queues / per-policy cron 接入后修正。
 *   - `queue`：消费 `{ task_id, step_no }`（形状由 `assertStepMessage` 保证）→ `delegateToAgent`
 *     （阶段4 契约占位：真实步骤执行体未落地，消费即如实回报，不臆造执行结果）。
 * 硬红线：生产零写不含——本 Worker 的 scheduled **写的是自有 D1 的 PD-01/PD-02/PD-06**（与 API Worker 同库、
 *   同一套单一写入面），不触碰任何外部系统；凭证不落本文件（CI Secrets 注入）。
 * 边界：投递用 `createLocalEnqueue`（D1 痕迹式投递：pending→active），**真 Queues producer 绑定未接**
 *   （门禁见 external-deps §7）；接入后仅替换 enqueue 工厂，本文件判定逻辑不动。
 * 反向清单：被 `wrangler.runner.toml`（main）与 CI deploy 第二步引用；用例 `./test-ts20.mjs`；
 *   登记 `../README.md`（模块清单 task-runner 行）与 `./README.md`。
 */
import { parseRunFrequency, resolveRunPolicy, createDiscoveryTask, createLocalEnqueue, delegateToAgent } from "./schedule.js";

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

/** Cron Triggers 到点入口（宽 cron 每分钟一次，到期判定在程序侧——CFG-04 频率是数据不是配置）。 */
export default {
  async scheduled(controller, env, ctx) {
    return runDueDiscoveryCalls(env.DB);
  },
  /** Queue Consumer：消息形状两键（`assertStepMessage` 保证）；阶段4 接真实步骤执行体前为契约占位。 */
  async queue(batch, env, ctx) {
    const results = [];
    for (const message of batch.messages) {
      const r = await delegateToAgent(env.DB, message.body);
      results.push(r);
      message.ack();
    }
    return results;
  },
};
