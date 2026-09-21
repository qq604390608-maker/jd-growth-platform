/**
 * F-04 HVA 研究任务调度（`server/task-runner/hva.js`）
 * -----------------------------------------------------------------------------
 * 职责（承接 `docs/02-prd/PRD-M1-平台任务程序.md` §3 F-04，阶段3 · M1）：
 *   研究建议（MD-12，F-03 已落库）提交后，组织二阶段上下文、调度 HVA 分析 Agent。
 *   输入 → 输出：建议记录 → hva_research 任务 + 二阶段上下文（PD-06） + 工具权限（CFG-03） + Agent 启动。
 *
 * 关联 schema（`docs/03-locks/schema.md` §12 关联表 L861）：
 *   ｜ `PD-01 task`（`task_type=hva_research`/`hva_followup`，状态机写入面在 `../tool-executor/task-state.js`，本文件经 `./step-plan.js` 复用）
 *   ｜ `PD-06 context_injection`（二阶段上下文留痕，写入面在 `../shared-context/index.js`，本文件调用 `initTaskContext`）
 *   ｜ `MD-07 research`（**研究壳建行**，写入面在 `../shared-context/index.js` 的 F-11 `createResearch`，本文件调用；2026-09-21 补齐）
 *   ｜ `MD-12 research_proposal`（建议，读取面在 `./proposal.js`）
 *   ｜ `MD-06 opportunity`（机会及版本，写入面在 F-10，本文件只读）
 *   ｜ `LNK-04 task_object`（启动对象锚点，写入面在 `./step-plan.js`）
 *   ｜ `CFG-03 tool_permission`（按所用 Agent 授权，读取面在 `../tool-executor/index.js`）
 *
 * 关键口径（白盒，逐条可测）：
 *   ① **第二阶段启动时点 = 建议提交时刻**（TC-I-M1-001 / MD-12 表注）：任务 `started_at` 与 `created_at`
 *      一律取 `research_proposal.submitted_at`，**不另取时钟**（建议已自带 `second_stage_start_at`）。
 *   ② **版本冲突以机会为准 + 提示**（用户口径，2026-09-19 确认）：HVA 任务的 `goal_version_no` 取
 *      **机会当前** `opportunity.goal_version_no`（不以建议登记时的旧版本为准）；若建议登记版本与机会当前版本
 *      不一致，仍正常建任务，但回带 `version_conflict=true` + `version_warning`（不作否定、不阻断）。
 *   ③ **二阶段上下文按 `CFG-06` hva_research 模板装配并落 PD-06**（goal / background / source /
 *      selected_opp / product_question / existing_evidence）——直接复用 `initTaskContext`，上下文现读、不入消息。
 *   ④ **工具权限按所用 Agent 授权**（CFG-03 `grantee_type=agent`）：HVA 任务用 `AGP-HVA`（`agent_code=hva-agent`），
 *      取该 Agent 被授权的工具清单供阶段4 调度校验；无授权时回带 `tool_permissions_pending=true`（不阻断，
 *      权限登记属 M5 职责，查询零写红线由 M5 守）。
 *   ⑤ **幂等守卫**：同一建议不得重复启动任务（`MD-12.triggered_task_id` 已由 F-03 `markProposalTriggered` 守）——重复调用报错。
 *      **F-39（2026-09-22）守卫前移**：本函数**在建任何行之前**先走 F-03 `ensureProposalNotTriggered`
 *      **只读预检**——原实现把守卫排在最后，重复调用虽最终报错却已留下**孤儿任务 + 孤儿研究壳**。
 *   ⑥ **Queue 消息恰 `{task_id, step_no}` 两键**（≤1KB，与 F-02 同款），上下文从 D1 现读；Agent 只在任务内被调用
 *      （`delegateToAgent` 守卫，阶段4 接入真实 HVA Agent）。
 *   ⑦ **hva_followup（追问任务）的创建归 F-05**（`../task-runner/followup.js` 的 `createFollowupTask`，
 *      复用本文件的 `resolveHvaToolPermissions` 与 `HVA_AGENT_PROFILE_ID`）；本文件不写未建文件名。
 *   ⑧ **建任务同时建 MD-07 研究壳**（2026-09-21 补齐）：`start_task_id = 本任务`、`created_at = 建议提交时刻`、
 *      `research_status = 'running'`（字典 **item_code**）；① 由「已应用目标版本业务目标 + 建议问题」逐字派生，
 *      ②④⑥ 与「不覆盖范围」四处 NOT NULL 列写**显式「尚未开展」初值**（见 `RESEARCH_SHELL_INITIAL`，不预填结论），
 *      落报告时由 F-21 整体覆盖。归属依据＝`schema.md` MD-07 字段表 `start_task_id`/`created_at` 的「服务功能点」列含 F-04；
 *      **幂等键＝`start_task_id`**（重复调用不新建第二行，与 ⑤ 的建议级守卫互补）。
 *
 * 硬红线：本文件**零外部调用**、**生产零写**——改行/建行只落在 PD-01 / LNK-04 / PD-06 / MD-07 / MD-12.triggered_task_id，
 *   且 PD-06 写入经 `initTaskContext` 单一写入面、**MD-07 建行经 F-11 `createResearch` 单一写入面**（本文件不写 SQL）、
 *   MD-12 触发标记经 F-03 `markProposalTriggered` 单一写入面。研究取号经 `./step-plan.js` 的 `nextResearchNo`（唯一一份）。
 * -----------------------------------------------------------------------------
 */

import {
  createTask,
  linkTaskObject,
  planTaskSteps,
  listTaskSteps,
  getTask,
  nextResearchNo,
} from "./step-plan.js";
import {
  agentSnapshotOf,
  createLocalEnqueue,
  delegateToAgent,
} from "./schedule.js";
import {
  getProposal,
  markProposalTriggered,
  ensureProposalNotTriggered,
} from "./proposal.js";
import { getGoalVersion } from "./goal.js";
import { createResearch, getResearch, listResearch, initTaskContext } from "../shared-context/index.js";
import { listPermissions } from "../tool-executor/index.js";

/** HVA 研究用的 Agent 角色（`agent_profile.profile_id`）；其 `agent_code = hva-agent` 用于 CFG-03 权限检索。 */
export const HVA_AGENT_PROFILE_ID = "AGP-HVA";

/**
 * 研究壳（`MD-07`）四处 NOT NULL 正文列的**首建初值**。
 * 建任务时研究尚未开展，②④⑥ 与「不覆盖范围」确实还不存在——此处**显式写「尚未开展」**而非留空、
 * 也**不预填任何研究结论**（`MD-07` 的 `research_status='running'` 与此自洽）；
 * 落报告时由 F-21 `saveResearchReport` 整体覆盖这四列，故不是第二个口径、也不是假数据。
 * ① 不在此列：它由**已应用目标版本 + 建议问题**逐字派生（真源可追溯，见主入口）。
 */
export const RESEARCH_SHELL_INITIAL = Object.freeze({
  e2_scope_method: "研究范围与方法：尚未开展（待研究任务执行后填写）",
  e4_population_diff: "人群差异：尚未计算（待研究任务执行后填写）",
  e6_limits: "其他解释与限制：尚未评估（待研究任务执行后填写）",
  out_of_scope_note: "本研究的结论不覆盖范围尚未判定（待研究任务执行后声明）",
});

/** 本地时间工具（与 `task-state.js` / `step-plan.js` 同款形态：`YYYY-MM-DD HH:MM:SS`）。 */
const norm = (s) => (s == null ? "" : String(s).trim());
const nowStamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/**
 * 取 HVA 任务可调用的工具权限清单（CFG-03，按所用 Agent 授权）。
 * 验收要点「已允许的查询工具按任务规则执行」——本函数给出该 HVA 任务实际被授权的工具，供阶段4 调度时校验。
 * 无授权时不报错，回带 `tool_permissions_pending=true`（权限登记属 M5 职责）。
 */
export async function resolveHvaToolPermissions(db, { agent_code } = {}) {
  const code = agent_code || "hva-agent";
  const perms = await listPermissions(db, { grantee_type: "agent", grantee_ref: code });
  return {
    tool_permissions: perms,
    tool_permission_source: perms.length ? "agent" : "none",
    tool_permissions_pending: perms.length === 0,
  };
}

/**
 * 创建 HVA 研究任务（F-04 主入口）。
 * @param {object} db D1 适配层
 * @param {object} args
 *   - proposal_id：触发本任务的研究建议（MD-12，须已提交；不存在即报错）
 *   - at：可选，本机 enqueue 投递时点的可注入覆盖（测试用）；缺省贴建议提交时刻
 *   - enqueue：可选，可注入的 Queue 投递端口（spy 断言）；缺省用 `createLocalEnqueue`
 *   - created_by：可选，创建人（默认 task-runner）
 */
export async function createHvaResearchTask(db, {
  proposal_id,
  at,
  enqueue,
  created_by = "task-runner",
} = {}) {
  const pid = norm(proposal_id);
  if (!pid) throw new Error("createHvaResearchTask：proposal_id 必填（HVA 任务由研究建议提交触发）");

  const proposal = await getProposal(db, pid);
  if (!proposal) throw new Error(`研究建议不存在：${pid}（HVA 任务只由真实建议触发）`);

  // —— ⑤ 幂等守卫**前移**（F-39）：在任何建行之前先判「该建议是否已触发过任务」——
  // 原实现把守卫排在「建任务 / LNK-04 / 建研究壳 / PD-06」之后（因 `markProposalTriggered` 的 `task_id`
  // 必须是已存在任务），重复调用虽最终报错，却**已留下孤儿任务 + 孤儿研究壳**——线上
  // `PROP-001 → T-0026 + T-0029` 双任务的同形机制。前置版是**只读预检**（`ensureProposalNotTriggered`），
  // 不需要 task_id，故可排在最前；判据与 `markProposalTriggered` 一致，不引入第二套口径。
  await ensureProposalNotTriggered(db, pid);

  const opportunity = await db
    .prepare("SELECT * FROM opportunity WHERE opportunity_id = ?")
    .bind(proposal.opportunity_id)
    .first();
  if (!opportunity) throw new Error(`机会不存在：${proposal.opportunity_id}（建议的外键机会缺失）`);

  // —— ② 版本冲突以机会为准 + 提示（用户口径 2026-09-19 确认） ——
  const effective_version_no = Number(opportunity.goal_version_no);
  const proposal_version_no = Number(proposal.goal_version_no);
  const version_conflict = proposal_version_no !== effective_version_no;
  const version_warning = version_conflict
    ? `建议登记于目标 v${proposal_version_no}，但机会 ${opportunity.opportunity_id} 当前为 v${effective_version_no}；` +
      `HVA 任务以机会当前版本为准，不混用旧版。`
    : null;

  // —— ① 第二阶段启动时点 = 建议提交时刻（不另取时钟） ——
  const started_at = proposal.submitted_at;

  const snap = await agentSnapshotOf(db, HVA_AGENT_PROFILE_ID);
  const trigger_basis = `PM 于 ${proposal.submitted_at} 提交研究建议（${pid}，机会 ${opportunity.opportunity_id}）`;

  // 建 hva_research 任务（PD-01）；goal_version_no 以机会当前版本为准
  const task = await createTask(db, {
    task_type: "hva_research",
    goal_id: opportunity.goal_id,
    goal_version_no: effective_version_no,
    trigger_basis,
    agent_profile_id: snap.profile.profile_id,
    agent_version_snapshot: snap.snapshot,
    task_status: "running",
    started_at,
  });

  // LNK-04 启动对象锚点（proposal=触发，opportunity=被研究的作用对象）；created_at 与任务一致，锚定建议提交时刻。
  // 注：`dict:TASK_LINK_ROLE` 值域仅 `trigger`/`output`，故机会用 `output`（任务作用/关联对象）；
  // `goal` 由 `opportunity.goal_id` 关联、且 `initTaskContext` 取 `task.goal_id`，不再单独 link 避免冗余。
  await linkTaskObject(db, { task_id: task.task_id, object_type: "proposal", object_id: pid, link_role: "trigger", created_at: started_at });
  await linkTaskObject(db, { task_id: task.task_id, object_type: "opportunity", object_id: opportunity.opportunity_id, link_role: "output", created_at: started_at });

  // —— ⑦ MD-07 研究壳（2026-09-21 补齐；建行经 F-11 `createResearch` 单一写入面，本文件不写 SQL） ——
  // 归属依据（`docs/03-locks/schema.md` MD-07 字段表）：`start_task_id` 与 `created_at` 两行的「服务功能点」
  // 列**均含 F-04**，且 `created_at` 口径写明「＝研究建议提交时刻」——除本函数外无人天然持有该时点；
  // 与 F-05 追问（`followup.js` 建新研究壳）**对称**。此前 F-04 漏建，导致 `research` 表在 hva_research
  // 路径上恒零行（线上实测），M4 出报告时 `saveResearchReport` 会撞「研究不存在」。
  // 幂等：以 `start_task_id = 本任务` 为键查已有壳，重复调用不新建第二行（与 ⑤ 的建议级幂等守卫互补）。
  const goalVersion = await getGoalVersion(db, opportunity.goal_id, effective_version_no);
  const priorResearch = (await listResearch(db, { opportunity_id: opportunity.opportunity_id }))
    .find((x) => x.start_task_id === task.task_id);
  let researchCreated = false;
  let research_no = priorResearch ? priorResearch.research_no : null;
  if (!priorResearch) {
    research_no = await nextResearchNo(db);
    await createResearch(db, {
      research_no,
      opportunity_id: opportunity.opportunity_id,
      research_question: proposal.research_question,
      // ① 逐字派生自**真源**：已应用目标版本的业务目标 + PM 提交的研究问题（未取到目标文本时只写问题，不编造）
      e1_goal_statement: goalVersion && goalVersion.business_goal
        ? `业务目标：${goalVersion.business_goal}｜研究问题：${proposal.research_question}`
        : `研究问题：${proposal.research_question}`,
      e2_scope_method: RESEARCH_SHELL_INITIAL.e2_scope_method,
      e4_population_diff: RESEARCH_SHELL_INITIAL.e4_population_diff,
      e6_limits: RESEARCH_SHELL_INITIAL.e6_limits,
      out_of_scope_note: RESEARCH_SHELL_INITIAL.out_of_scope_note,
      research_status: "running", // dict:RESEARCH_STATUS 的 **item_code**（不是 item_name「研究中」）
      goal_id: opportunity.goal_id,
      goal_version_no: effective_version_no,
      behavior_hypothesis: proposal.behavior_hypothesis ?? null,
      population_limit: proposal.population_limit ?? null,
      parent_research_no: null, // 首个研究：无追问链上游
      start_task_id: task.task_id,
      created_at: started_at, // 与任务一致＝建议提交时刻（不另取时钟）
    });
    researchCreated = true;
    // 研究产出锚点（output）——与 F-05 追问建壳后的 LNK-04 写法一致
    await linkTaskObject(db, { task_id: task.task_id, object_type: "research", object_id: research_no, link_role: "output", created_at: started_at });
  }

  // 五步计划（hva_research 步骤名逐字对齐 `prototype/pages/tasks.html` TYPE_STEPS）
  const plan = await planTaskSteps(db, task.task_id, "hva_research");

  // —— ③ 二阶段上下文：按 CFG-06 hva_research 模板落 PD-06（上下文现读、不入消息） ——
  const context = await initTaskContext(db, {
    task_id: task.task_id,
    opportunity_id: opportunity.opportunity_id,
    injected_at: started_at,
  });

  // —— ④ CFG-03 工具权限（按所用 Agent 授权） ——
  const perms = await resolveHvaToolPermissions(db, { agent_code: snap.profile.agent_code });

  // —— ⑤ 幂等守卫的**登记**（F-39 后：判缺已前移到函数开头，此处只做落 `triggered_task_id` 的写）——
  const trigger = await markProposalTriggered(db, { proposal_id: pid, task_id: task.task_id });

  // —— ⑥ Queue 消息恰两键 → 启动 Agent（delegateToAgent 守卫） ——
  const doEnqueue = typeof enqueue === "function" ? enqueue : createLocalEnqueue(db, { at: at || started_at });
  const dispatch = await doEnqueue({ task_id: task.task_id, step_no: 1 });
  const delegated = await delegateToAgent(db, {
    task_id: task.task_id,
    step_no: 1,
    note: "阶段4 接入真实 HVA Agent；本阶段为契约占位",
  });

  return {
    task: await getTask(db, task.task_id),
    proposal: await getProposal(db, pid),
    opportunity,
    // MD-07 研究壳（2026-09-21 补齐）：建行经 F-11 单一写入面；`research_created=false` 表示复用既有壳（幂等）
    research: research_no ? await getResearch(db, research_no) : null,
    research_no,
    research_created: researchCreated,
    steps: await listTaskSteps(db, task.task_id),
    plan,
    context,
    tool_permissions: perms.tool_permissions,
    tool_permission_source: perms.tool_permission_source,
    tool_permissions_pending: perms.tool_permissions_pending,
    version_conflict,
    version_warning,
    effective_goal_version_no: effective_version_no,
    proposal_goal_version_no: proposal_version_no,
    trigger,
    dispatch,
    delegated,
    created_by,
  };
}
