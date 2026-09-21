/**
 * 文档卡（阶段4 接线 · M1 · 发现任务步骤执行体 · 2026-09-21）
 * 上游：`../../docs/04-plan/dev-plan.md`（M3/F-14~F-16 编排已落地；本文件把「调度回路」与「编排」接通——
 *        2026-09-21 用户线上实测发现 discovery 任务 running 0/5 步挂起：runner 的 queue consumer 只调
 *        `delegateToAgent` 契约占位，真 Queues 未接、D1 痕迹无人消费）
 *   ｜ `./schedule.js`（F-02：`createDiscoveryTask` 五步计划 + `createLocalEnqueue` 投递即置步 1 active）
 *   ｜ `./step-plan.js`（PD-02 步骤计划/推进/进度串唯一写入面；`TYPE_STEPS.discovery` 五步名逐字钉死）
 *   ｜ `../tool-executor/task-state.js`（F-26 任务态写入面：blocked/done 跃迁、PD-03 受阻留痕、done_part）
 *   ｜ `../tool-executor/index.js`（F-25 `listQueryRecords`：EXT-01 逐任务回查——步 4/5 的确定性事实来源）
 *   ｜ `../agent-orchestrator/discovery.js`（F-14：`loadDiscoveryContext` / `assembleDiscoveryPlan` /
 *        `summarizeCluesAsJourney`——确定性编排，不调 LLM）
 *   ｜ `../agent-orchestrator/verification.js`（F-15：`runMetricVerification` 经 M5 真实查询、五项检查、
 *        证据草稿；`recordVerificationEvidence` 落 EXT-02）
 *   ｜ `../agent-orchestrator/opportunity.js`（F-16：`formOpportunityOrGap`——依据足够落 MD-06，不足记缺口，
 *        **不产机会是合法产出**；unknown_item 由 Agent 路径显式评估，不得纯空白）
 *   ｜ `./goal.js`（`getGoalVersion`：任务快照版本的六要素读取）
 * 职责：**discovery 任务的按步执行体**——把 PD-02 的五个步骤名逐个落到真实动作：
 *   ① 载入目标与时间窗（读任务快照版本 + CFG-06 注入清单）
 *   ② 规划采集范围（S-A1 确定性查证计划：CDP→HJE→MKT→ACT）
 *   ③ 采集入口与流量（按计划逐源经 M5 真实查询并落 EXT-01——**查询失败/受限一律留痕**）
 *   ④ 识别与聚合线索（EXT-01 ok 记录回查 → 五项检查 → 证据四要素齐则落 EXT-02 → 旅程归属归纳）
 *   ⑤ 生成机会候选（F-16 逐线索判定：足够→MD-06 机会；不足→缺口记录；汇总进 done_part）
 * 边界：本文件是**按 `task_type` 分派的调度外壳**——`discovery` 走本文件的 `runDiscoveryStep`，
 *   `hva_research` 走 `./research.js` 的 `runResearchStep`（F-33 接线，2026-09-21）；`hva_followup` 与
 *   `goal_check` 的消费仍是 `delegateToAgent` 占位（接线归后续 PR，登记 dev-plan）。已接线类型清单的**唯一真源**
 *   是 `./research.js` 的 `WIRED_TASK_TYPES`，本文件的选取条件与分派守卫都从它取，**不复制第二份**。
 *   步间状态不落新表——步骤 4/5 以 EXT-01/EXT-02 已落库事实做**确定性重算**（编排无随机，重算结果一致），不改 schema。
 * 投递通道：真 Queues 未接，驱动方式＝runner cron 每分钟顺带执行 `runPendingWork`
 *   （扫描 step_state='active' 且任务 running 的**已接线类型**步骤；旧名 `runPendingDiscoveryWork` 保留为别名）；
 *   `queue` consumer 接入后走同一执行体，判定逻辑不动。
 * 单 tick 守卫（**F-34**，2026-09-21）：驱动回路套 `./tick-guard.js` 的三道轻量守卫——**步数配额**
 *   （每 tick 至多 `TICK_QUOTA` 步，把批次摊到多个 tick）＋**同 tick 去重**（同一 `(task_id, step_no)`
 *   在本 tick 内只执行一次，兼作「超时步骤仍为 active」时的死循环闸）＋**单步超时**（超时只放弃等待，
 *   不落 PD-03、不改 `task_status`、不落 done，步骤保持 active 交下个 tick 重试）。
 *   守卫本身**纯计算**（零数据库访问、零 SQL、零写）；配额与超时分别派生自 `TYPE_STEPS` 与
 *   `DEFAULT_TIMEOUT_MS`，**不复制第二份口径**。
 *   边界：**不是真独占**——并发 tick 仍可能同时选中同一步；真独占需 2b 租约（已否决）或期 3 真 Queues。
 * 红线落实：查询失败/受限 → 真实原因进 done_part（**失败不否定结论**）；不编造事实、
 *   不以模型预期代替查询；机会写入只经 F-10（formOpportunityOrGap 内部）。
 * 反向清单：被 `./index.js`（scheduled 顺带驱动 + queue consumer）引用；登记 `./README.md`；
 *   测试 `./test-stage4.mjs`（外加 F-33 的 `./test-f33.mjs` 覆盖分派与 M4 五步、F-34 的 `./test-f34.mjs` 覆盖单 tick 守卫）。
 */
import { getTask } from "./step-plan.js";
import { listTaskSteps, advanceStep, appendDonePart, recordBlock, setTaskStatus, BLOCK_REASON_CODE } from "./step-plan.js";
import { getGoalVersion } from "./goal.js";
import { listQueryRecords } from "../tool-executor/index.js";
import { loadDiscoveryContext, assembleDiscoveryPlan, summarizeCluesAsJourney } from "../agent-orchestrator/discovery.js";
import { runMetricVerification, verifyFiveChecks, buildEvidenceDraft, recordVerificationEvidence } from "../agent-orchestrator/verification.js";
import { formOpportunityOrGap, OPPORTUNITY_OUTCOMES } from "../agent-orchestrator/opportunity.js";
import { runResearchStep, RESEARCH_TASK_TYPE, RESEARCH_TASK_TYPES, WIRED_TASK_TYPES } from "./research.js";
import { createTickGuard, STEP_TIMED_OUT, TICK_QUOTA, STEP_TIMEOUT_MS } from "./tick-guard.js";

/** 计划数据源 → 实际调度的工具码（**取自 CFG-02 tool_registry 实际注册码**，契约基准 v1；
 *  注意 F-14 `createDiscoveryToolExecutor` 的旧映射 mkt.feedback.query / act.campaign.touch
 *  在库中不存在——已随本接线一并订正）。 */
const SOURCE_TOOL = {
  CDP: "cdp.crowd.query",
  HJE: "hje.traffic.entry",
  MKT: "mkt.benefit.issue",
  ACT: "act.activity.list",
};

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/**
 * 步骤 1/2 共用：载入任务快照版本与注入清单，装配确定性查证计划。
 * 目标不存在 / 版本不存在 → 抛 `StepBlockedError`（结构性受阻，非查询失败）。
 */
async function loadGoalAndPlan(db, task) {
  const version = await getGoalVersion(db, task.goal_id, Number(task.goal_version_no));
  if (!version) {
    const err = new Error(`目标版本不存在：${task.goal_id} v${task.goal_version_no}（任务快照版本缺失）`);
    err.block_reason_code = "target_unclear";
    throw err;
  }
  const injection = await loadDiscoveryContext(db, task.task_id);
  const goalText = version.business_goal || `（目标 ${task.goal_id} 未填写业务目标）`;
  const sources = (injection.sources || [])
    .map((s) => (typeof s === "string" ? s : s?.data_source || s?.source_id))
    .filter((s) => SOURCE_TOOL[s]);
  const plan = assembleDiscoveryPlan({
    goal: goalText,
    scope: version.business_scope || null,
    sources: sources.length ? sources : ["CDP", "HJE", "MKT", "ACT"],
  });
  return { version, injection, plan };
}

/** 查询条件＝契约基准 v1 统一入参：由目标六要素（范围/时段/口径/目标文本）派生，不编造数值。 */
function buildQueryCondition(version) {
  return {
    scope: version.business_scope || null,
    period: version.focus_period || null,
    metric: version.metric_definition || null,
    goal: version.business_goal || null,
  };
}

/**
 * 步骤 4/5 共用：从 EXT-01 已落库的 ok 记录做确定性重算——五项检查 + 证据草稿 + 线索。
 * 不写库（落 EXT-02 与 MD-06 是步骤 4/5 各自的动作）。
 */
async function rebuildVerifiedFacts(db, task, version, plan) {
  const records = (await listQueryRecords(db, { task_id: task.task_id })).filter((r) => r.result_status === "ok");
  const checkBySource = new Map(plan.plan.map((p) => [p.data_source, p.check_item]));
  const goal = {
    goal_id: task.goal_id,
    goal_version_no: Number(task.goal_version_no),
    business_goal: version.business_goal,
    business_scope: version.business_scope,
    metric_definition: version.metric_definition,
  };
  const facts = records.map((r) => ({
    ok: true,
    verified: true,
    result_status: r.result_status,
    result_summary: r.result_summary,
    returned_rows: r.returned_rows,
    query_id: r.query_id,
    source_id: r.source_id,
    tool_code: r.tool_code,
    query_condition: r.query_condition,
    queried_at: r.queried_at,
    info_time_point: r.queried_at,
    // 适用范围＝本次查询实际声明的范围（query_condition.scope，目标六要素③派生）——可回查、不编造；
    // 与目标声明是否一致的判定交给五项检查，不由这里下结论。
    applicability_scope: version.business_scope || null,
    missing_note: null,
  }));
  const verified = [];
  for (const fact of facts) {
    const at = fact.queried_at || nowStamp();
    const checks = await verifyFiveChecks(db, { fact, goal, at });
    const draft = buildEvidenceDraft({ fact, checks });
    verified.push({
      // 与 F-15 `verifyClueAndDraftEvidence` 的返回形态对齐：verified 是**顶层键**
      //（hasEnoughBasis 的 real_return 读 verification.verified，漏了会静默判「依据不足」）
      fact,
      checks,
      draft,
      verified: true,
      check_item: checkBySource.get(fact.source_id) || fact.source_id,
      goal,
    });
  }
  return { goal, verified };
}

/** 步骤体返回 `{ outcome: "done", note }`；结构性受阻抛 `StepBlockedError`（带 block_reason_code）。 */
export async function runDiscoveryStep(db, task_id, step_no, opts = {}) {
  const task = await getTask(db, task_id);
  if (!task) throw new Error(`任务不存在：${task_id}（不得在任务之外调用 Agent）`);
  if (task.task_type !== "discovery") {
    throw new Error(`runDiscoveryStep 只处理 discovery 任务，收到 ${task.task_type}（其余类型仍走占位，接线另登记）`);
  }
  const stamp = opts.at || nowStamp();

  try {
    if (step_no === 1) {
      const { version, plan } = await loadGoalAndPlan(db, task);
      await appendDonePart(db, task_id,
        `① 载入目标与时间窗：${task.goal_id} v${task.goal_version_no}「${version.business_goal || "（业务目标待补）"}」；范围「${version.business_scope || "未声明"}」、时段「${version.focus_period || "未声明"}」；注入清单 ${plan.plan.length} 项计划可装配。`);
      return { outcome: "done", step_no, note: "目标与时间窗已载入" };
    }

    if (step_no === 2) {
      const { plan } = await loadGoalAndPlan(db, task);
      const order = plan.plan.map((p) => `${p.step_no}.${p.data_source}(${p.check_item})`).join(" → ");
      await appendDonePart(db, task_id, `② 规划采集范围：${order}；停止条件＝${plan.stop_condition}。`);
      return { outcome: "done", step_no, note: "查证计划已装配" };
    }

    if (step_no === 3) {
      const { version, plan } = await loadGoalAndPlan(db, task);
      const condition = buildQueryCondition(version);
      const results = [];
      for (const item of plan.plan) {
        const tool_code = SOURCE_TOOL[item.data_source];
        const fact = await runMetricVerification(db, {
          task_id,
          tool_code,
          source_id: item.data_source,
          grantee_type: "agent",
          grantee_ref: "discovery-agent",
          query_condition: condition,
          at: stamp,
          transport: opts.transport,
        });
        results.push({ data_source: item.data_source, ok: fact.ok, restricted: fact.restricted, reason: fact.ok ? null : fact.fail_reason });
        // F-26 语义：持续查询失败会被 M5 处置为任务 blocked/stopped——此时立即停手，
        // 不再向已处置任务继续发起查询（剩余计划留待恢复后继续）。
        const cur = await getTask(db, task_id);
        if (cur && cur.task_status !== "running") {
          results.push({ data_source: "剩余计划", ok: null, restricted: false, reason: `任务已被处置为 ${cur.task_status}，剩余源暂停` });
          break;
        }
      }
      const okCount = results.filter((r) => r.ok === true).length;
      const failText = results.filter((r) => r.ok === false).map((r) => `${r.data_source}=${r.reason}`).join("；");
      await appendDonePart(db, task_id,
        `③ 采集入口与流量：真实返回 ok ${okCount} 源` +
        (failText ? `（未 ok：${failText}）——失败已留痕 EXT-01，不阻断后续步骤` : "") +
        (okCount < results.length ? "。" : "。"));
      return { outcome: "done", step_no, ok_sources: okCount, total: results.length };
    }

    if (step_no === 4) {
      const { version, plan } = await loadGoalAndPlan(db, task);
      const { verified } = await rebuildVerifiedFacts(db, task, version, plan);
      let evidenceSaved = 0;
      const factSet = [];
  for (const v of verified) {
    if (v.draft.ok) {
      // 证据号由调用方派生（F-09 不自动取号）：EV-{query_id} 与查询一一对应、可回查
      const draft = { ...v.draft.draft, evidence_id: `EV-${v.fact.query_id}`, created_at: stamp };
      await recordVerificationEvidence(db, draft);
      evidenceSaved += 1;
    }
        factSet.push({
          fact_id: v.fact.query_id,
          journey_stage: v.check_item,
          phenomenon: v.fact.result_summary,
          evidence_ref: v.fact.query_id,
        });
      }
      const { clues, unattributed_count } = summarizeCluesAsJourney(factSet);
      await appendDonePart(db, task_id,
        `④ 识别与聚合线索：有效查询 ${verified.length} 条，证据四要素齐并落 EXT-02 ${evidenceSaved} 条；` +
        `归纳线索 ${clues.length} 条（裸变化拒收 ${unattributed_count} 条）。`);
      return { outcome: "done", step_no, clues: clues.length, evidence_saved: evidenceSaved };
    }

    if (step_no === 5) {
      const { version, plan } = await loadGoalAndPlan(db, task);
      const { goal, verified } = await rebuildVerifiedFacts(db, task, version, plan);
      let opportunities = 0;
      let gaps = 0;
      for (const v of verified) {
        const caveats = [];
        if (!v.draft.ok) caveats.push(`证据四要素不齐（${v.draft.note}）`);
        const clue = {
          attribution: `journey:${v.check_item}`,
          target_object: `journey:${v.check_item}`,
          phenomenon: v.fact.result_summary,
          keywords: [goal.business_goal].filter(Boolean),
          applicability_scope: v.fact.applicability_scope ?? null,
          missing_note: caveats.join("；") || null,
          // Agent 路径（producing_task_id 非空）不得写空串（ADR-003）——显式给出「已评估」文本：
          // 有未决缺口就写缺口，五查全过就写「确无」，两种都是合法的二态。
          unknown_item: caveats.length
            ? caveats.join("；")
            : "无（五项检查通过，无额外未知项；适用范围由人工节点复核）",
          research_reason: `围绕目标「${goal.business_goal || task.goal_id}」在 ${v.check_item} 环节观察到可查证现象，值得研究`,
        };
        const r = await formOpportunityOrGap(db, {
          goal,
          clue,
          verification: v,
          producing_task_id: task_id,
          created_at: stamp,
        });
        if (r.outcome === OPPORTUNITY_OUTCOMES.OPPORTUNITY) opportunities += 1;
        else gaps += 1;
      }
      await appendDonePart(db, task_id,
        `⑤ 生成机会候选：真实返回 ${verified.length} 条 → 形成机会 ${opportunities} 个、缺口记录 ${gaps} 条` +
        (opportunities === 0 ? "（本轮未产生新机会是合法产出：依据不足只记缺口，不硬凑）" : "") +
        "。");
      return { outcome: "done", step_no, opportunities, gaps };
    }

    throw new Error(`未知步骤号：${step_no}（discovery 计划为 5 步）`);
  } catch (err) {
    // 结构性受阻（目标版本缺失 / 意外异常）：按 F-26 语义留 PD-03 + 任务 blocked，保留已完成部分。
    // 兜底须尊重终态守卫：任务已是 blocked/stopped/done 时不再改状态（「停止状态不自动重启」）。
    const reason = err.block_reason_code || BLOCK_REASON_CODE.call_failed;
    await advanceStep(db, { task_id, step_no, step_state: "blocked" });
    await recordBlock(db, {
      task_id,
      block_reason_code: reason,
      block_note: `第 ${step_no} 步受阻：${String(err?.message || err)}`,
      resume_condition: "修复结构性原因后人工恢复（停止/受阻状态不自动重启）",
      blocked_at: stamp,
    });
    const cur = await getTask(db, task_id);
    if (cur && !["blocked", "stopped", "done"].includes(cur.task_status)) {
      await setTaskStatus(db, task_id, "blocked", { ended_at: stamp });
    }
    return { outcome: "blocked", step_no, reason, message: String(err?.message || err) };
  }
}

/**
 * 单条步骤消息的完整处理（执行 + 跃迁 + 推进）——cron 驱动与 queue consumer 共用：
 * 先按 `task.task_type` **分派**到对应执行体（discovery → 本文件；hva_research → `./research.js`），
 * 再统一做跃迁与推进（跃迁/推进逻辑只有这一份，两份执行体都只干活）。
 * 步骤体 outcome=done → 当前步落 done → 任务仍 running 时推进下一步（无下一步且全 done → 任务落 done）。
 * @returns {Promise<{outcome:string, step_no:number, finished:boolean}>}
 */
export async function runStepMessage(db, { task_id, step_no }, opts = {}) {
  const task = await getTask(db, task_id);
  if (task && !WIRED_TASK_TYPES.includes(task.task_type)) {
    throw new Error(
      `runStepMessage 只处理已接线类型（${WIRED_TASK_TYPES.join(" / ")}），收到 ${task.task_type}——` +
      "其余类型仍走 delegateToAgent 占位（接线另行登记）",
    );
  }
  // 分派（F-41 后）：`discovery` → M3 执行体（本文件）；**研究类两种**（hva_research / hva_followup）→ M4 执行体。
  // 清单取自 `./research.js` 的 `RESEARCH_TASK_TYPES`（单一真源），不在本文件写第二个 `=== "xxx"`。
  const r = task && RESEARCH_TASK_TYPES.includes(task.task_type)
    ? await runResearchStep(db, task_id, step_no, opts)
    : await runDiscoveryStep(db, task_id, step_no, opts);
  let finished = false;
  if (r.outcome === "done") {
    // 当前步落 done（跃迁由本层统一负责；步骤体只干活），随后推进下一步
    await advanceStep(db, { task_id, step_no, step_state: "done" });
    const cur = await getTask(db, task_id);
    if (!cur || cur.task_status !== "running") return { ...r, finished }; // 已被 F-26 处置 → 不再推进
    const steps = await listTaskSteps(db, task_id);
    const next = steps.find((s) => s.step_no === Number(step_no) + 1);
    if (next) {
      if (next.step_state === "pending") {
        await advanceStep(db, { task_id, step_no: next.step_no, step_state: "active" });
      }
    } else if (steps.every((s) => s.step_state === "done")) {
      const task = await getTask(db, task_id);
      await setTaskStatus(db, task_id, "done", { ended_at: opts.at || nowStamp() });
      if (task && !String(task.done_part || "").includes("任务完成")) {
        await appendDonePart(db, task_id, "任务完成：五步全部执行完毕。");
      }
      finished = true;
    }
  }
  return { ...r, finished };
}

/**
 * cron 驱动本体：扫描「running 的**已接线类型**任务中 step_state='active' 的步骤」逐个执行。
 * 已接线类型清单取自 `./research.js` 的 `WIRED_TASK_TYPES`（单一真源），行内按类型分派。
 * **单 tick 守卫（F-34）**：配额 + 同 tick 去重 + 单步超时，本体在 `./tick-guard.js`；
 *   `opts.quota` / `opts.step_timeout_ms` / `opts.timer` 可注入（用例据此**确定性**触发超时分支）。
 * 幂等：只消费 active 步骤；重复调用在无 active 步骤时是 no-op；配额用尽即收手（不丢步，留待下个 tick）。
 * @returns {Promise<{executed: Array<{task_id:string, step_no:number, outcome:string}>, finished:string[],
 *   timed_out: Array<{task_id:string, step_no:number}>, exhausted:boolean, quota:number}>}
 *   `exhausted` ＝ **配额已尽且仍有待执行的 active 步**（＝下个 tick 还会接着干）；跑完自然收手时为 false。
 */
export async function runPendingWork(db, opts = {}) {
  const guard = createTickGuard({ quota: opts.quota, timeoutMs: opts.step_timeout_ms, timer: opts.timer });
  const out = { executed: [], finished: [], timed_out: guard.timed_out, exhausted: false, quota: guard.quota };
  const placeholders = WIRED_TASK_TYPES.map(() => "?").join(", ");
  for (;;) {
    const rows = (await db.prepare(
      `SELECT s.task_id AS task_id, MIN(s.step_no) AS step_no
         FROM task_step s JOIN task t ON t.task_id = s.task_id
        WHERE s.step_state = 'active' AND t.task_status = 'running' AND t.task_type IN (${placeholders})
        GROUP BY s.task_id ORDER BY s.task_id`,
    ).bind(...WIRED_TASK_TYPES).all()).results || [];
    // 同 tick 去重：本 tick 已执行过的 (task_id, step_no) 不再入选——超时被放弃的步骤**仍是 active**，
    // 少了这道过滤它会在下一轮重查时被再次选中，同一 tick 内无限重试。
    const fresh = rows.filter(({ task_id, step_no }) => !guard.isDuplicate(task_id, Number(step_no)));
    if (fresh.length === 0) break; // 无活可干：跑完 or 剩下的全是本 tick 已占用过的
    if (!guard.hasCapacity()) {
      out.exhausted = true; // 有活但配额已尽：摊给下个 tick（不是失败、也不丢步）
      break;
    }
    for (const { task_id, step_no } of fresh) {
      if (!guard.hasCapacity()) {
        out.exhausted = true; // 本批没跑完就没配额了——同样是「还有活」，留给下个 tick
        break;
      }
      const no = Number(step_no);
      const r = await guard.runStep(task_id, no, () => runStepMessage(db, { task_id, step_no: no }, opts));
      if (r === STEP_TIMED_OUT) continue; // 本 tick 不再重复占用；步骤保持 active，下个 tick 自然重试
      out.executed.push({ task_id, step_no: no, outcome: r.outcome });
      if (r.finished) out.finished.push(task_id);
    }
  }
  return out;
}

/** 旧名别名：既有调用面（`./index.js` / `test-stage4.mjs` / `test-ts20.mjs`）保持不变，行为＝已接线类型全量。 */
export const runPendingDiscoveryWork = runPendingWork;
