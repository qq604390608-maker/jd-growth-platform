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
 *   ② 前置核对 /api/tools + /api/sources —— 断言 0003 启用步已在远程生效（闸门前移）
 *   ③ POST /api/discovery-tasks   —— 对 GOAL-2026Q3-01 手动建一次发现任务（F-02 到点创建语义）
 *   ④ 轮询 GET /api/task-dispatch —— runner cron 每分钟自驱动一步，五步全 done 为止
 *   ⑤ GET  /api/opportunities     —— 断言机会 > 0
 *
 * 诊断可见性：失败时通过 `::error::` annotation + $GITHUB_STEP_SUMMARY 把根因直接写进
 * Actions 页面摘要（无需展开日志），并区分「0003 未生效 / cron 未触发 / 卡步」三类。
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

// 闸门前移：建任务前先断言 0003 启用步已在远程生效。若未生效，直接报根因，
// 不必等到任务被 F-26 处置为 blocked 再猜（task 表无 block_reason_code 列，原脚本读不到）。
async function preflightCheck() {
  const NEED_TOOLS = ["cdp.crowd.query", "hje.traffic.entry", "mkt.benefit.issue", "act.activity.list"];
  const tools = await fetchJSON("/api/tools?is_enabled=1", { method: "GET" }, 2);
  const enabled = (tools.items || []).map((t) => t.tool_code);
  const missing = NEED_TOOLS.filter((c) => !enabled.includes(c));
  log(`前置核对·工具启用：启用列表 ${enabled.length} 个；计划工具缺失=[${missing.join(",") || "无"}]`);
  if (missing.length) {
    throw new Error(
      `0003 启用步未生效（QUERY_RESTRICTED 前兆）：计划工具未启用 [${missing.join(",")}]；` +
      `去 Cloudflare D1 控制台 SELECT tool_code,is_enabled FROM tool_registry WHERE tool_code IN ('cdp.crowd.query','hje.traffic.entry','mkt.benefit.issue','act.activity.list')，` +
      `并查 ci.yml「出关运维待办」步日志是否成功执行`
    );
  }
  const sources = await fetchJSON("/api/sources?status=ok&mcp_ready=1", { method: "GET" }, 2);
  const ok = (sources.items || []).map((s) => s.source_id);
  log(`前置核对·来源 ok+ready：含 ${ok.length} 个；ACT 在其中=${ok.includes("ACT")}`);
  if (!ok.includes("ACT")) {
    throw new Error(
      `0003 启用步未生效（SOURCE_DEGRADED 前兆）：ACT 来源非 ok/ready；` +
      `去 Cloudflare D1 控制台 SELECT source_id,availability_status,is_mcp_ready FROM source_registry WHERE source_id='ACT'`
    );
  }
  log("前置核对通过：4 个计划工具已启用、ACT 来源 ok+ready，可建发现任务");
}

async function main() {
  await waitWorkerReady();
  await preflightCheck();

  // ③ 建发现任务（F-02：建任务 → LNK-04 → 五步 → CFG-06 上下文 → createLocalEnqueue 落投递痕迹）
  const created = await fetchJSON("/api/discovery-tasks", {
    method: "POST",
    body: JSON.stringify({ goal_id: GOAL_ID, trigger_basis: "go-live §2 远程闭环冒烟（CI [e2e]）" }),
  });
  const task_id = created?.task?.task_id;
  if (!task_id) throw new Error(`建任务未返回 task_id：${JSON.stringify(created).slice(0, 300)}`);
  log(`发现任务已创建：${task_id}（goal=${GOAL_ID}，策略来源=${created.policy_source}）`);

  // ④ 轮询五步：runner cron 每分钟自驱动；blocked/stopped 提前失败并打印现场
  let steps = null;
  for (let i = 1; i <= POLL_MAX_TRIES; i++) {
    await sleep(POLL_INTERVAL_MS);
    const d = await fetchJSON(`/api/task-dispatch?task_id=${encodeURIComponent(task_id)}`, { method: "GET" });
    steps = d.steps || [];
    const status = d.task?.task_status;
    const doneCount = steps.filter((s) => s.step_state === "done").length;
    const progress = steps.map((s) => `#${s.step_no}:${s.step_state}`).join(" ");
    log(`（${i}/${POLL_MAX_TRIES}）task_status=${status} · ${doneCount}/5 done · ${progress}`);
    if (status === "blocked" || status === "stopped") {
      const stuck = steps.filter((s) => s.step_state !== "done").map((s) => `#${s.step_no}:${s.step_state}`).join(" ");
      throw new Error(
        `任务被处置为 ${status}；卡点步骤=[${stuck || "无（全 done 却终态异常）"}]。` +
        `排查：① Cloudflare D1 查 task_block 表 block_reason_code；` +
        `② 核对 tool_registry.is_enabled=1（4 个计划工具）与 source_registry(ACT) availability_status='ok'（0003 是否生效）；` +
        `③ Cron Triggers 是否绑定 runner Worker`
      );
    }
    if (status === "done" && doneCount === steps.length && steps.length === 5) {
      log(`五步全部 done：${progress}`);
      break;
    }
    if (i === POLL_MAX_TRIES) {
      // 超时：区分『cron 没驱动』与『驱动了但卡在某步』
      const stuck = steps.filter((s) => s.step_state !== "done").map((s) => `#${s.step_no}:${s.step_state}`).join(" ");
      const hint =
        status === "running" && steps.every((s) => s.step_state === "active" || s.step_state === "pending")
          ? "（cron 未触发：所有步骤仍 active/pending，任务态 running——查 wrangler.runner.toml [triggers] 与 Cloudflare Cron Triggers 面板）"
          : "（已部分推进说明 cron 在跑，卡点见上方 stuck 步骤——多半某步查询受限被 F-26 处置，但状态未及时刷新，查 PD-03 task_block）";
      throw new Error(`轮询超时（10 分钟）：task_status=${status}，${progress}；stuck=[${stuck}] ${hint}`);
    }
  }

  // ⑤ 机会落库断言
  const opp = await fetchJSON(`/api/opportunities?goal_id=${encodeURIComponent(GOAL_ID)}`, { method: "GET" });
  const count = (opp.items || []).length;
  log(`目标 ${GOAL_ID} 现有机会：${count} 条`);
  if (count === 0) throw new Error("任务五步 done 但机会为 0——闭环断裂（查 EXT-01/EXT-02/MD-06 落痕）");

  log(`✅ 远程业务闭环走通：建任务 → 五步自驱动 done → 机会 ${count} 条`);
}

main().catch((e) => {
  const msg = e.message;
  // GitHub Actions annotation：让失败原因直接显示在 Actions 摘要/日志，无需展开
  console.error(`::error::[e2e] ❌ ${msg}`);
  // 写入 step summary：Actions 页面 Summary tab 直接可读根因
  if (process.env.GITHUB_STEP_SUMMARY) {
    const fs = require("fs");
    fs.appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `## ❌ 远程业务闭环冒烟失败\n\n${msg}\n\n---\n` +
        `自助排查：① Cloudflare D1 控制台查 \`tool_registry.is_enabled\`（4 个计划工具应=1）、\`source_registry\`（ACT 应 ok+ready）——即 0003 是否生效；` +
        `② 查 \`task_block\` 表 block_reason_code；③ Cloudflare Cron Triggers 是否绑定 runner Worker（\`* * * * *\`）。\n`,
    );
  }
  process.exit(1);
});
