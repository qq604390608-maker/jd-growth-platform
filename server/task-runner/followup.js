/**
 * F-05 追问与版本管理（`server/task-runner/followup.js`）
 * -----------------------------------------------------------------------------
 * 职责（承接 `docs/02-prd/PRD-M1-平台任务程序.md` §3 F-05，阶段3 · M1）：
 *   PM 在**已有研究**上提新问题 → 关联原研究建立**新的 HVA 研究·追问**任务。
 *   输入 → 输出：新问题＋原研究 → 新 hva_followup 任务（关联原研究）+ 新 MD-07 研究行（追问链）。
 *
 * 关联 schema（`docs/03-locks/schema.md` §12 关联表 L862）：
 *   ｜ `PD-01 task`（`parent_task_id` 自引用：追问任务挂**原任务**；`task_type=hva_followup`）——经 `./step-plan.js` 复用
 *   ｜ `MD-07 research`（`parent_research_no` 自引用：新研究指向**原研究**；`start_task_id` 指向**新任务**）——经 `../shared-context/index.js` 复用
 *   ｜ `PD-07 followup_message`（追问对话消息：逐条留痕，PM/Agent 双向）——本文件 `recordFollowupMessage` 单一写入面
 *   ｜ `MD-02 research_goal_version`（问题/范围变更落新版本：本文件**只读取/消费** goal_version_no 快照，不新建版本行——版本创建归 F-01）
 *   ｜ `PD-06 context_injection`（二阶段上下文，含 `related_history` 关联原研究）——经 `../shared-context/index.js` 复用
 *   ｜ `CFG-03 tool_permission`（按所用 Agent 授权）——经 `../tool-executor/index.js` 复用（同 F-04 取 hva-agent）
 *   ｜ `LNK-04 task_object`（启动对象锚点，追问任务指向新研究 + 机会）——经 `./step-plan.js` 复用
 *
 * 关键口径（白盒，逐条可测）：
 *   ① **关联原研究建立新任务**：新任务 `parent_task_id` = 原研究的 `start_task_id`（原任务）；
 *      新研究 `parent_research_no` = 原研究、`start_task_id` = 新任务（追问链）。
 *   ② **原研究结果与依据继续保留**：全程**只读**原研究与原任务，绝不改写其任何字段（goal_version_no 等快照沿用）；
 *      新旧版本不混。
 *   ③ **版本管理**：新任务/新研究默认沿用原研究的 `goal_version_no` 快照；若追问引入范围/口径变更，
 *      可显式传入新的 `goal_version_no`（如从 v3 升到 v4）——原研究与原任务**维持启动时的版本不变**
 *      （「已有任务继续使用启动时的版本」）。MD-02 新版本行的创建属 F-01 职责，本文件不越权。
 *   ④ **二阶段上下文按 `CFG-06` hva_followup 模板装配并落 PD-06**（含 `related_history`，自动带上原研究链）；
 *      上下文现读、不入消息。
 *   ⑤ **工具权限按所用 Agent 授权**（CFG-03 `grantee_type=agent`，同 F-04 取 `hva-agent`）。
 *   ⑥ **Queue 消息恰 `{task_id, step_no}` 两键**（≤1KB，与 F-02/F-04 同款），上下文从 D1 现读；
 *      Agent 只在任务内被调用（`delegateToAgent` 守卫，阶段4 介入真实 HVA Agent）。
 *   ⑦ **追问对话逐条留痕**（PD-07）：PM 的新问题 + 可选 Agent 应答，均挂在**原研究** `research_no` 下、
 *      归属**新任务** `task_id`（对齐种子 MSG-001~003 的 `research_no='R-007'` + `task_id='T-1023'` 口径）。
 *
 * 硬红线：本文件**零外部调用**、**生产零写**——改行只落在 PD-01 / LNK-04 / PD-06 / MD-07 / PD-07，且：
 *   PD-01 写入经 `createTask`（step-plan）；LNK-04 经 `linkTaskObject`（step-plan）；
 *   PD-06 写入经 `initTaskContext`（shared-context）；MD-07 写入经 `createResearch`（shared-context）；
 *   PD-07 写入经本文件 `recordFollowupMessage`（单一写入面）。本文件不直接写其它任何表。
 * -----------------------------------------------------------------------------
 */

import {
  createTask,
  linkTaskObject,
  planTaskSteps,
  listTaskSteps,
  listTaskObjects,
  getTask,
} from "./step-plan.js";
import { agentSnapshotOf, createLocalEnqueue, delegateToAgent } from "./schedule.js";
import { HVA_AGENT_PROFILE_ID, resolveHvaToolPermissions } from "./hva.js";
import { createResearch, getResearch, initTaskContext } from "../shared-context/index.js";

const norm = (s) => (s == null ? "" : String(s).trim());
const nowStamp = () => new Date().toISOString().slice(0, 19).replace("T", " ");

/**
 * 下一个研究号：`R-` + 3 位补零（库内最大 +1，确定性、不撞号）。
 * 与 `proposal.js` 的 `nextProposalId` 同款形态；MD-07 `research_no` 全库口径 `R-xxx`。
 */
export async function nextResearchNo(db) {
  const rows = (await db.prepare("SELECT research_no FROM research").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = /^R-(\d+)$/.exec(String(r.research_no || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `R-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 下一条追问消息号：`MSG-` + 3 位补零（库内最大 +1，确定性、可回查）。
 * PD-07 `message_id` 全库口径（种子 MSG-001~003）。
 */
export async function nextFollowupMessageId(db) {
  const rows = (await db.prepare("SELECT message_id FROM followup_message").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = /^MSG-(\d+)$/.exec(String(r.message_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `MSG-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 写一条追问消息（`PD-07`，单一写入面）。
 * `research_no` 默认挂在**原研究**下、`task_id` 归属**新追问任务**（对齐种子 MSG-001~003 口径）。
 * 双外键（research_no→MD-07、task_id→PD-01）由库级强制，缺失即 FK 失败（TC-D-M1-008）。
 */
export async function recordFollowupMessage(db, {
  research_no,
  task_id,
  message_role,
  message_text,
  created_at,
}) {
  const role = norm(message_role);
  if (!role) throw new Error("recordFollowupMessage：message_role 必填（pm / agent）");
  const text = norm(message_text);
  if (!text) throw new Error("recordFollowupMessage：message_text 必填（追问消息正文）");
  const message_id = await nextFollowupMessageId(db);
  const at = norm(created_at) || nowStamp();
  const r = await db
    .prepare(
      `INSERT INTO followup_message
         (message_id, research_no, task_id, message_role, message_text, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(message_id, research_no, task_id, role, text, at)
    .run();
  if (r && r.success === false) throw new Error(r.error || "followup_message 插入失败");
  return { message_id, research_no, task_id, message_role: role, message_text: text, created_at: at };
}

/**
 * 创建追问任务（F-05 主入口）。
 * @param {object} db D1 适配层
 * @param {object} args
 *   - research_no：原研究（MD-07），必须存在且已关联启动任务；不存在即报错
 *   - new_question：PM 的追问新问题（必填），同时作为新研究的研究问题 + 首条 pm 追问消息
 *   - research_fields：可选，覆盖新研究壳的七要素字段；缺省从原研究**承接**为起始内容（M4 F-22 再更新）
 *   - messages：可选，额外追问消息数组 `[{ role, text }]`（如 Agent 应答），逐条落 PD-07
 *   - goal_version_no：可选，范围/口径变更后的新版本号；缺省沿用原研究快照（新旧版本不混）
 *   - at：可选，确定性时点（测试用）；缺省取当前时点
 *   - enqueue：可选，可注入的 Queue 投递端口（spy 断言）；缺省用 `createLocalEnqueue`
 *   - created_by：可选，创建人（默认 task-runner）
 */
export async function createFollowupTask(db, {
  research_no,
  new_question,
  research_fields = {},
  messages = [],
  goal_version_no,
  at,
  enqueue,
  created_by = "task-runner",
} = {}) {
  const rno = norm(research_no);
  if (!rno) throw new Error("createFollowupTask：research_no 必填（追问挂在已有研究上）");
  const question = norm(new_question);
  if (!question) throw new Error("createFollowupTask：new_question 必填（PM 的追问新问题）");

  // —— ① 关联原研究：原研究必须存在 ——
  const original = await getResearch(db, rno);
  if (!original) throw new Error(`原研究不存在：${rno}（追问只能建立在真实存在的研究上）`);

  // 原研究必须已关联启动任务（追问任务挂其 parent_task_id；MD-07.start_task_id 是 FK→PD-01）
  if (!original.start_task_id) {
    throw new Error(`原研究 ${rno} 未关联启动任务（start_task_id 为空）：无法建立追问任务`);
  }
  const parent_task = await getTask(db, original.start_task_id);
  if (!parent_task) throw new Error(`原研究关联的启动任务不存在：${original.start_task_id}`);

  // —— ③ 版本管理：新任务/新研究默认沿用原研究 goal_version_no 快照；可显式传入新版本 ——
  //    （绝不改写原任务/原研究的版本——「已有任务继续使用启动时的版本」；MD-02 新版本创建归 F-01）
  const effective_version_no = goal_version_no != null ? Number(goal_version_no) : Number(original.goal_version_no);
  const version_changed = goal_version_no != null && Number(goal_version_no) !== Number(original.goal_version_no);

  const atStamp = norm(at) || nowStamp();
  const snap = await agentSnapshotOf(db, HVA_AGENT_PROFILE_ID);

  // —— 建新 hva_followup 任务（PD-01）：parent_task_id 挂原任务 ——
  const trigger_basis = `PM 于 ${atStamp} 在 ${rno} 上提交追问：「${question}」`;
  const task = await createTask(db, {
    task_type: "hva_followup",
    goal_id: original.goal_id,
    goal_version_no: effective_version_no,
    trigger_basis,
    agent_profile_id: snap.profile.profile_id,
    agent_version_snapshot: snap.snapshot,
    task_status: "running",
    parent_task_id: parent_task.task_id,
    started_at: atStamp,
  });

  // —— ② 新研究壳（MD-07）：parent_research_no 指向原研究、start_task_id 指向新任务 ——
  //    七要素字段缺省从原研究承接为起始内容（M4 F-22 再更新），可由 research_fields 覆盖。
  const build = (k, fallback) => (research_fields && research_fields[k] != null && norm(research_fields[k]) !== "" ? norm(research_fields[k]) : fallback);
  const research_no_new = await nextResearchNo(db);
  const research = await createResearch(db, {
    research_no: research_no_new,
    opportunity_id: original.opportunity_id,
    research_question: question,
    e1_goal_statement: build("e1_goal_statement", original.e1_goal_statement),
    e2_scope_method: build("e2_scope_method", original.e2_scope_method),
    e4_population_diff: build("e4_population_diff", original.e4_population_diff),
    e6_limits: build("e6_limits", original.e6_limits),
    out_of_scope_note: build("out_of_scope_note", original.out_of_scope_note),
    research_status: "研究中",
    goal_id: original.goal_id,
    goal_version_no: effective_version_no,
    behavior_hypothesis: research_fields && research_fields.behavior_hypothesis != null ? research_fields.behavior_hypothesis : original.behavior_hypothesis,
    population_limit: research_fields && research_fields.population_limit != null ? research_fields.population_limit : original.population_limit,
    parent_research_no: rno,
    start_task_id: task.task_id,
    created_at: atStamp,
  });

  // LNK-04 锚点：追问任务的产出（新研究，output）+ 被追问的机会（output）
  await linkTaskObject(db, { task_id: task.task_id, object_type: "research", object_id: research_no_new, link_role: "output", created_at: atStamp });
  await linkTaskObject(db, { task_id: task.task_id, object_type: "opportunity", object_id: original.opportunity_id, link_role: "output", created_at: atStamp });

  // 五步计划（hva_followup 步骤名逐字对齐 prototype/pages/tasks.html TYPE_STEPS）
  const plan = await planTaskSteps(db, task.task_id, "hva_followup");

  // —— ④ 二阶段上下文：按 CFG-06 hva_followup 模板落 PD-06（含 related_history 带上原研究链）——
  const context = await initTaskContext(db, {
    task_id: task.task_id,
    opportunity_id: original.opportunity_id,
    research_no: research_no_new,
    injected_at: atStamp,
  });

  // —— ⑤ CFG-03 工具权限（按所用 Agent 授权，同 hva-agent）——
  const perms = await resolveHvaToolPermissions(db, { agent_code: snap.profile.agent_code });

  // —— ⑦ 追问对话逐条留痕（PD-07）：PM 的新问题（挂在原研究 research_no 下）+ 可选 Agent 应答 ——
  const msgs = [];
  msgs.push(
    await recordFollowupMessage(db, {
      research_no: rno,
      task_id: task.task_id,
      message_role: "pm",
      message_text: question,
      created_at: atStamp,
    }),
  );
  for (const m of messages || []) {
    if (!m || !m.role || !m.text) continue;
    msgs.push(
      await recordFollowupMessage(db, {
        research_no: rno,
        task_id: task.task_id,
        message_role: m.role,
        message_text: m.text,
        created_at: atStamp,
      }),
    );
  }

  // —— ⑥ Queue 消息恰两键 → 启动 Agent（delegateToAgent 守卫）——
  const doEnqueue = typeof enqueue === "function" ? enqueue : createLocalEnqueue(db, { at: atStamp });
  const dispatch = await doEnqueue({ task_id: task.task_id, step_no: 1 });
  const delegated = await delegateToAgent(db, {
    task_id: task.task_id,
    step_no: 1,
    note: "阶段4 接入真实 HVA Agent；本阶段为契约占位",
  });

  return {
    task: await getTask(db, task.task_id),
    parent_task: parent_task,
    original_research: original,
    research: await getResearch(db, research_no_new),
    steps: await listTaskSteps(db, task.task_id),
    plan,
    context,
    tool_permissions: perms.tool_permissions,
    tool_permission_source: perms.tool_permission_source,
    tool_permissions_pending: perms.tool_permissions_pending,
    followup_messages: msgs,
    version_changed,
    effective_goal_version_no: effective_version_no,
    original_goal_version_no: Number(original.goal_version_no),
    dispatch,
    delegated,
    created_by,
  };
}
