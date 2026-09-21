/**
 * 远程业务闭环冒烟（go-live §2 验证项，2026-09-21）
 *
 * 背景：远程库启用 4 个计划工具 + ACT 恢复后，需验证「discovery 任务由 runner 自驱动
 * 跑完五步 → EXT-01/EXT-02 落痕 → 机会落库」的业务闭环（test-stage4.mjs 的 ok 路径
 * 在真实远程环境的等价复测）。本机网络对 *.workers.dev 阻断（runbook §7），但
 * GitHub Actions runner（境外出口）可达——故本脚本只在 CI deploy 之后运行
 * （ci.yml 以 commit message 含 `[e2e]` 门控，避免每次 push 都造业务数据）。
 *
 * 流程：
 *   ① GET  /api/health            —— Worker 就绪（重试等待 deploy 生效）
 *   ② POST /api/discovery-tasks   —— 对 GOAL-2026Q3-01 手动建一次发现任务（F-02 到点创建语义）
 *   ③ 轮询 GET /api/task-dispatch —— runner cron 每分钟自驱动一步，五步全 done 为止
 *   ④ GET  /api/opportunities     —— 断言机会 > 0
 *
 * 用法（CI 内，凭证不需要——全走公网 API）：
 *   node scripts/remote-e2e-smoke.mjs
 * 可覆盖：E2E_GOAL_ID（默认 GOAL-2026Q3-01）、WORKERS_SUBDOMAIN（默认 dongzhuo）。
 */

const SUBDOMAIN = process.env.WORKERS_SUBDOMAIN || "dongzhuo";
const BASE = `https://jd-growth-platform.${SUBDOMAIN}.workers.dev`;
const GOAL_ID = process.env.E2E_GOAL_ID || "GOAL-2026Q3-01";
const POLL_INTERVAL_MS = 20_000;
const POLL_MAX_TRIES = 30; // 30 × 20s = 10 分钟（五步 × cron 1/min 留足余量）

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (msg) => console.log(`[e2e] ${new Date().toISOString()} ${msg}`);

async function fetchJSON(path, init, tries = 3) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const resp = await fetch(`${BASE}${path}`, {
        ...init,
        headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
        signal: AbortSignal.timeout(20_000),
      });
      const body = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} ${path}: ${JSON.stringify(body).slice(0, 300)}`);
      }
      return body;
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(5_000);
    }
  }
  throw lastErr;
}

async function waitWorkerReady() {
  for (let i = 1; i <= 10; i++) {
    try {
      const h = await fetchJSON("/api/health", { method: "GET" }, 1);
      log(`health ok：${JSON.stringify(h).slice(0, 200)}`);
      return;
    } catch (e) {
      log(`health 未就绪（${i}/10）：${e.message.slice(0, 120)}`);
      await sleep(10_000);
    }
  }
  throw new Error("Worker /api/health 持续不可达");
}

async function main() {
  await waitWorkerReady();

  // ② 建发现任务（F-02：建任务 → LNK-04 → 五步 → CFG-06 上下文 → createLocalEnqueue 落投递痕迹）
  const created = await fetchJSON("/api/discovery-tasks", {
    method: "POST",
    body: JSON.stringify({ goal_id: GOAL_ID, trigger_basis: "go-live §2 远程闭环冒烟（CI [e2e]）" }),
  });
  const task_id = created?.task?.task_id;
  if (!task_id) throw new Error(`建任务未返回 task_id：${JSON.stringify(created).slice(0, 300)}`);
  log(`发现任务已创建：${task_id}（goal=${GOAL_ID}，策略来源=${created.policy_source}）`);

  // ③ 轮询五步：runner cron 每分钟自驱动；blocked/stopped 提前失败并打印现场
  let steps = null;
  for (let i = 1; i <= POLL_MAX_TRIES; i++) {
    await sleep(POLL_INTERVAL_MS);
    const d = await fetchJSON(`/api/task-dispatch?task_id=${encodeURIComponent(task_id)}`, { method: "GET" });
    steps = d.steps || [];
    const status = d.task?.task_status;
    const doneCount = steps.filter((s) => s.step_state === "done").length;
    const progress = steps
      .map((s) => `#${s.step_no}:${s.step_state}`)
      .join(" ");
    log(`（${i}/${POLL_MAX_TRIES}）task_status=${status} · ${doneCount}/5 done · ${progress}`);
    if (status === "blocked" || status === "stopped") {
      throw new Error(`任务被处置为 ${status}（详情查 /api/task-blocks?task_id=${task_id}），闭环未走通`);
    }
    if (status === "done" && doneCount === steps.length && steps.length === 5) {
      log(`五步全部 done：${progress}`);
      break;
    }
    if (i === POLL_MAX_TRIES) {
      throw new Error(`轮询超时（10 分钟）未完成：task_status=${status}，${progress}`);
    }
  }

  // ④ 机会落库断言
  const opp = await fetchJSON(`/api/opportunities?goal_id=${encodeURIComponent(GOAL_ID)}`, { method: "GET" });
  const count = (opp.items || []).length;
  log(`目标 ${GOAL_ID} 现有机会：${count} 条`);
  if (count === 0) throw new Error("任务五步 done 但机会为 0——闭环断裂（查 EXT-01/EXT-02/MD-06 落痕）");

  log(`✅ 远程业务闭环走通：建任务 → 五步自驱动 done → 机会 ${count} 条`);
}

main().catch((e) => {
  console.error(`[e2e] ❌ ${e.message}`);
  process.exit(1);
});
