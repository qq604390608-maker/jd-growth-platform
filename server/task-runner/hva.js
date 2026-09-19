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
 *   ⑥ **Queue 消息恰 `{task_id, step_no}` 两键**（≤1KB，与 F-02 同款），上下文从 D1 现读；Agent 只在任务内被调用
 *      （`delegateToAgent` 守卫，阶段4 接入真实 HVA Agent）。
 *   ⑦ **hva_followup（追问任务）的创建归 F-05**（追问与版本管理）；本文件提供的调度内核（`dispatchHvaCore`）可被
 *      F-05 复用，但不在本文件写未建文件名（避免悬空引用）。
 *
 * 硬红线：本文件**零外部调用**、**生产零写**——改行只落在 PD-01 / LNK-04 / PD-06 / MD-12.triggered_task_id，
 *   且 PD-06 写入经 `initTaskContext` 单一写入面；MD-12 触发标记经 F-03 `markProposalTriggered` 单一写入面。
 * -----------------------------------------------------------------------------
 */

import {
  createTask,
  linkTaskObject,
  planTaskSteps,
  listTaskSteps,
  getTask,
} from "./step-plan.js";
import {
  agentSnapshotOf,
  createLocalEnqueue,
  delegateToAgent,
} from "./schedule.js";
import {
  getProposal,
  markProposalTriggered,
} from "./proposal.js";
import { initTaskContext } from "../shared-context/index.js";
import { listPermissions } from "../tool-executor/index.js";

/** HVA 研究用的 Agent 角色（`agent_profile.profile_id`）；其 `agent_code = hva-agent` 用于 CFG-03 权限检索。 */
export const HVA_AGENT_PROFILE_ID = "AGP-HVA";

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

  // —— ⑤ 幂等守卫：同一建议不得重复启动任务 ——
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
