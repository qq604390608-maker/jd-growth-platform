#!/usr/bin/env node
/**
 * 文档卡（阶段3 · M1 · F-05 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`
 *        ｜ **TC-I-M1-003 = 已有研究上提新问题：关联原研究建立新任务（parent_research_no/start_task_id 指向原）；
 *            原研究结果与依据继续保留；新旧版本不混**（F-05）
 *        ｜ **TC-D-M1-004 = `PD-01` 自引用：子行先于父行插入 → FK 失败（须父行先落）**（F-05 落 parent_task_id）
 *        ｜ **TC-D-M1-008 = `PD-07 followup_message.research_no`/`task_id` 缺失 → FK 失败**（F-05）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-05（验收要点：原研究结果与依据继续保留；新旧版本不混）
 *   ｜ `../../docs/03-locks/schema.md` PD-01（parent_task_id 自引用）/ PD-07（followup_message 双 FK）/
 *        MD-07（parent_research_no 追问链）/ MD-02（goal_version_no 版本快照）/ CFG-03 / CFG-06 / LNK-04
 *   ｜ `../../prototype/pages/tasks.html`（**`TYPE_STEPS.hva_followup` 5 步，钉死需求**）
 *   ｜ `./followup.js`（被测模块）｜`./hva.js`（HVA 权限读取面）｜`./step-plan.js`（任务骨架）｜`./schedule.js`（enqueue/Agent 守卫）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-05 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构、语义、字典值与平台口径）。
 * 边界：本执行器只验 F-05；F-02/F-03/F-04/F-06 各自执行器覆盖。
 * 反向清单：登记 `./README.md` 与 `../README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f05.mjs`）。
 *
 * 用法：node server/task-runner/test-f05.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { createFollowupTask, nextResearchNo, nextFollowupMessageId } from "./followup.js";
import { listTaskObjects, listTaskSteps, getTask } from "./step-plan.js";
import { getResearch } from "../shared-context/index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./followup.js", import.meta.url);

/** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      try {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      } catch (e) {
        return { success: false, error: String(e.message || e) };
      }
    },
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: (col) => {
      const row = sqlite.prepare(sql).get(...params) ?? null;
      if (row === null) return null;
      return col === undefined ? row : row[col];
    },
  });
  return { prepare: (sql) => makeStmt(sql, []) };
}

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  sqlite.exec(mock);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const GOAL = "GOAL-2026Q3-01";
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

let pass = 0;
let fail = 0;
function assert(cond, label) {
  if (cond) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}`); }
}
async function assertThrows(fn, label, match = null) {
  try {
    await fn();
    fail++; console.log(`  ✗ ${label}（未抛错）`);
  } catch (e) {
    const ok = !match || String(e.message).includes(match);
    if (ok) { pass++; console.log(`  ✓ ${label}`); }
    else { fail++; console.log(`  ✗ ${label}（错误信息不含「${match}」：${String(e.message)}）`); }
  }
}
const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;

/**
 * 自包含 fixture：插一个父 HVA 研究任务（T-TEST-2001）+ 一份已有的原研究（R-TEST-001，挂在该任务上，
 * 机会 OPP-012、goal_version_no=3）。R-TEST-001 即「被追问的原研究」。
 * 不碰种子已有行（R-007 / T-1023 等），避免 PK 冲突。
 */
function seedFollowupFixtures(sqlite) {
  // 父 HVA 研究任务（追问任务的 parent_task_id 指向它）
  sqlite.exec(
    `INSERT INTO task
       (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
        agent_profile_id, agent_version_snapshot, progress_text, done_part, started_at, ended_at,
        parent_task_id, retry_count, is_auto_restart, created_at)
     VALUES ('T-TEST-2001', 'hva_research', 'M4', '${GOAL}', 3, 'done', 'PM 于 2026-09-15 20:28 提交研究建议（OPP-012）',
        'AGP-HVA', 'hva-agent v1.2 / agent.md r11', '5 / 5 步', '形成研究结果 R-TEST-001',
        '2026-09-15 20:30', '2026-09-16 15:10', NULL, 0, 0, '2026-09-15 20:30')`,
  );
  // 原研究（R-TEST-001）：start_task_id = T-TEST-2001、opportunity_id=OPP-012、goal_version_no=3、parent_research_no 空
  sqlite.exec(
    `INSERT INTO research
       (research_no, opportunity_id, research_question, e1_goal_statement, e2_scope_method,
        e4_population_diff, e6_limits, out_of_scope_note, research_status, goal_id, goal_version_no,
        behavior_hypothesis, population_limit, parent_research_no, start_task_id, finished_at, created_at)
     VALUES ('R-TEST-001', 'OPP-012',
        '搜索进入与推荐位进入的人群，渠道结构是否一致？',
        '业务目标：提升复购率｜研究问题：渠道结构差异',
        '范围：京东超市主站 APP 端；方法：入口维度分组比较',
        '搜索进入 APP 占 71.2%，推荐位进入 APP 占 84.6%，差 13.4pp',
        'CDP 仅聚合标签，无用户级明细',
        '活动玩法配置不在结论范围内',
        'done', '${GOAL}', 3, NULL, NULL, NULL, 'T-TEST-2001', '2026-09-17 18:42', '2026-09-15 20:28')`,
  );
}

// 原型钉死的 HVA 研究·追问 5 步（逐字照抄 prototype/pages/tasks.html TYPE_STEPS.hva_followup）
const FOLLOWUP_STEPS = [
  "关联原研究与依据",
  "调度工具采集证据",
  "重算并校验差异",
  "更新结论适用范围",
  "产出新一轮结果",
];

// ---- 场景A：默认继承版本，完整建追问任务 ----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  const beforeTask = countRows(sqlite, "task");
  const beforeResearch = countRows(sqlite, "research");
  const beforeMsg = countRows(sqlite, "followup_message");

  const NEW_Q = "乳品方向再补查一下：搜索进入和推荐位进入的人群，渠道结构（APP / 小程序）是不是一致的？";
  const r = await createFollowupTask(db, {
    research_no: "R-TEST-001",
    new_question: NEW_Q,
  });

  // TC-I-M1-003：关联原研究建立新任务
  assert(countRows(sqlite, "task") === beforeTask + 1, "A1 新建一条 hva_followup 任务（PD-01 +1）");
  assert(r.task.task_type === "hva_followup", "A2 任务类型为 hva_followup");
  assert(r.task.task_stage === "M4", "A3 task_stage 由 task_type 推出 = M4");
  assert(r.task.parent_task_id === "T-TEST-2001", "A4 parent_task_id 挂原任务 T-TEST-2001（关联原研究建立新任务）");

  // 新研究壳（MD-07）：parent_research_no 指向原研究、start_task_id 指向新任务
  assert(countRows(sqlite, "research") === beforeResearch + 1, "A5 新建一条研究行（MD-07 +1，追问链）");
  assert(r.research.parent_research_no === "R-TEST-001", "A6 新研究 parent_research_no 指向原研究 R-TEST-001");
  assert(r.research.start_task_id === r.task.task_id, "A7 新研究 start_task_id 指向新任务");
  assert(r.research.research_question === NEW_Q, "A8 新研究 research_question = 追问新问题");

  // ② 原研究结果与依据继续保留：原研究整行未被改动
  const origAfter = await getResearch(db, "R-TEST-001");
  assert(origAfter.research_question === "搜索进入与推荐位进入的人群，渠道结构是否一致？", "A9 原研究的研究问题未被改");
  assert(origAfter.goal_version_no === 3, "A10 原研究的 goal_version_no 仍为 3（版本不混）");
  assert(origAfter.parent_research_no === null, "A11 原研究的 parent_research_no 仍为空（未被覆盖）");
  assert(origAfter.start_task_id === "T-TEST-2001", "A12 原研究的 start_task_id 仍指向原任务（未被覆盖）");
  // 原任务也未被改动
  const parentAfter = await getTask(db, "T-TEST-2001");
  assert(parentAfter.goal_version_no === 3, "A13 原任务 goal_version_no 仍为 3（已有任务继续使用启动时的版本）");

  // ③ 默认继承版本：新任务/新研究沿用原研究快照 v3
  assert(r.task.goal_version_no === 3, "A14 新任务 goal_version_no = 原研究快照 3（默认继承）");
  assert(r.research.goal_version_no === 3, "A15 新研究 goal_version_no = 原研究快照 3");
  assert(r.version_changed === false, "A16 未传新版本时 version_changed = false");

  // 五步计划逐字对齐原型
  assert(r.steps.length === 5, "A17 步骤计划 5 步");
  const names = r.steps.map((s) => s.step_name);
  assert(JSON.stringify(names) === JSON.stringify(FOLLOWUP_STEPS), "A18 步骤名逐字对齐原型 TYPE_STEPS.hva_followup");

  // LNK-04：追问任务指向新研究（output）+ 机会（output）
  const objs = await listTaskObjects(db, { task_id: r.task.task_id });
  const byType = (t) => objs.find((o) => o.object_type === t);
  assert(byType("research") && byType("research").object_id === r.research.research_no && byType("research").link_role === "output", "A19 LNK-04：research = output 锚定新研究");
  assert(byType("opportunity") && byType("opportunity").link_role === "output", "A20 LNK-04：opportunity = output 锚定被追问机会");

  // ④ 二阶段上下文落 PD-06（CFG-06 hva_followup 模板，含 related_history 带出原研究链）
  assert(r.context.task_type === "hva_followup", "A21 上下文装配按 hva_followup 模板");
  const codes = r.context.sections.map((s) => s.context_type_code);
  for (const c of ["goal", "background", "source", "selected_opp", "product_question", "existing_evidence", "related_history"]) {
    assert(codes.includes(c), `A22 模板含上下文类型 ${c}`);
  }
  assert(r.context.injections_written >= 3, `A23 PD-06 至少落 goal/selected_opp/related_history 等（实测 ${r.context.injections_written}）`);
  const relHist = r.context.sections.find((s) => s.context_type_code === "related_history");
  assert(relHist && relHist.items.some((i) => i.ref_object_id === "R-TEST-001"), "A24 related_history 带出原研究 R-TEST-001（关联原研究）");
  const selOpp = r.context.injections.find((i) => i.context_type_code === "selected_opp");
  assert(selOpp && selOpp.ref_object_id === "OPP-012", "A25 PD-06 selected_opp 指向机会 OPP-012");

  // ⑤ CFG-03 工具权限（按 hva-agent 授权，种子 PERM-H-01~12）
  assert(r.tool_permission_source === "agent", "A26 工具权限来源 = agent（CFG-03 grantee_type=agent）");
  const expPermA = sqlite.prepare("SELECT COUNT(*) c FROM tool_permission WHERE grantee_type='agent' AND grantee_ref='hva-agent'").get().c;
  assert(r.tool_permissions.length === expPermA, `A27 HVA 取到 ${expPermA} 条工具授权（按种子动态期望）`);

  // ⑦ 追问对话落 PD-07：首条 pm 消息挂在原研究 research_no 下、归属新任务
  assert(countRows(sqlite, "followup_message") === beforeMsg + 1, "A28 落一条 pm 追问消息（PD-07 +1）");
  const msg = r.followup_messages[0];
  assert(msg && msg.message_role === "pm" && msg.research_no === "R-TEST-001" && msg.task_id === r.task.task_id, "A29 追问消息挂原研究 R-TEST-001 + 新任务 task_id");

  // ⑥ Queue 消息恰两键 + dispatch + delegateToAgent 守卫
  assert(r.dispatch && r.dispatch.message && r.dispatch.message.task_id === r.task.task_id, "A30 dispatch 消息带 task_id");
  assert(r.dispatch.message.step_no === 1, "A31 dispatch 消息 step_no = 1");
  assert(Object.keys(r.dispatch.message).length === 2, "A32 消息恰好 {task_id, step_no} 两键");
  assert(r.delegated && r.delegated.delegated === true, "A33 delegateToAgent 守卫返回 delegated=true（Agent 只在任务内被调用）");
}

// ---- 场景B：版本变更——传入新版本号，新任务用新版本、原研究不变 ----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  const r = await createFollowupTask(db, {
    research_no: "R-TEST-001",
    new_question: "剔除大促时段后重新看入口差异",
    goal_version_no: 4, // 范围/口径变更后的新版本
  });
  assert(r.version_changed === true, "B1 传入新版本号 → version_changed = true");
  assert(r.effective_goal_version_no === 4, "B2 新任务/新研究 goal_version_no = 新版本 4");
  assert(r.task.goal_version_no === 4 && r.research.goal_version_no === 4, "B3 新任务与新研究均用新版本 4");
  // 「已有任务继续使用启动时的版本」：原研究与原任务仍为 3
  const orig = await getResearch(db, "R-TEST-001");
  assert(orig.goal_version_no === 3, "B4 原研究 goal_version_no 仍为 3（未被新版本覆盖）");
  const parent = await getTask(db, "T-TEST-2001");
  assert(parent.goal_version_no === 3, "B5 原任务 goal_version_no 仍为 3（已有任务沿用启动版本）");
  assert(r.research.parent_research_no === "R-TEST-001", "B6 新研究仍正确指向原研究（与新版本无关）");
}

// ---- 场景C：边界 —— 原研究不存在 ----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  await assertThrows(
    () => createFollowupTask(db, { research_no: "R-NOPE", new_question: "x" }),
    "C1 原研究不存在 → 报错",
    "原研究不存在",
  );
}

// ---- 场景D：边界 —— 原研究未关联启动任务（start_task_id 为空）----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  // 造一份没有 start_task_id 的原研究
  sqlite.exec(
    `INSERT INTO research
       (research_no, opportunity_id, research_question, e1_goal_statement, e2_scope_method,
        e4_population_diff, e6_limits, out_of_scope_note, research_status, goal_id, goal_version_no,
        behavior_hypothesis, population_limit, parent_research_no, start_task_id, finished_at, created_at)
     VALUES ('R-TEST-002', 'OPP-012', '问题X', '目标X', '范围X', '差异X', '限制X', '范围X',
        'done', '${GOAL}', 3, NULL, NULL, NULL, NULL, '2026-09-17 18:42', '2026-09-15 20:28')`,
  );
  await assertThrows(
    () => createFollowupTask(db, { research_no: "R-TEST-002", new_question: "y" }),
    "D1 原研究未关联启动任务 → 报错",
    "未关联启动任务",
  );
}

// ---- 场景E：边界 —— 追问消息 FK 拒绝（TC-D-M1-008：research_no/task_id 缺失）----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  // 直接对 PD-07 插一条 task_id 不存在的行 → 库级 FK 失败
  const res = await db
    .prepare("INSERT INTO followup_message (message_id, research_no, task_id, message_role, message_text, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind("MSG-X", "R-TEST-001", "T-NOPE", "pm", "q", "2026-09-18 09:11")
    .run();
  assert(res && res.success === false, "E1 task_id='T-NOPE' → 库级 FK 失败（TC-D-M1-008）");
  const res2 = await db
    .prepare("INSERT INTO followup_message (message_id, research_no, task_id, message_role, message_text, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind("MSG-Y", "R-NOPE", "T-TEST-2001", "pm", "q", "2026-09-18 09:11")
    .run();
  assert(res2 && res2.success === false, "E2 research_no='R-NOPE' → 库级 FK 失败（TC-D-M1-008）");
}

// ---- 场景F：PD-01 自引用父行先落（TC-D-M1-004）：子任务先于父任务插入 → FK 失败 ----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  // 子行 parent_task_id 指向尚未插入的父行 → 库级 FK 失败
  const res = await db
    .prepare(
      `INSERT INTO task
         (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
          agent_profile_id, agent_version_snapshot, progress_text, done_part, started_at, ended_at,
          parent_task_id, retry_count, is_auto_restart, created_at)
       VALUES ('T-TEST-CHILD', 'hva_followup', 'M4', '${GOAL}', 3, 'running', 'x', 'AGP-HVA', 's', '0 / 5 步', '',
          '2026-09-18 09:12', NULL, 'T-TEST-PARENT', 0, 0, '2026-09-18 09:12')`,
    )
    .run();
  assert(res && res.success === false, "F1 子任务 parent_task_id 指向未落库的父行 → 库级 FK 失败（TC-D-M1-004）");
  // 父行先落、子行后落 → 成功（验证 createTask 的 parent_task_id 守卫生效）
  sqlite.exec(
    `INSERT INTO task
       (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
        agent_profile_id, agent_version_snapshot, progress_text, done_part, started_at, ended_at,
        parent_task_id, retry_count, is_auto_restart, created_at)
     VALUES ('T-TEST-PARENT', 'hva_research', 'M4', '${GOAL}', 3, 'done', 'p', 'AGP-HVA', 's', '5 / 5 步', '',
        '2026-09-15 20:30', '2026-09-16 15:10', NULL, 0, 0, '2026-09-15 20:30')`,
  );
  const ok = await db
    .prepare(
      `INSERT INTO task
         (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
          agent_profile_id, agent_version_snapshot, progress_text, done_part, started_at, ended_at,
          parent_task_id, retry_count, is_auto_restart, created_at)
       VALUES ('T-TEST-CHILD2', 'hva_followup', 'M4', '${GOAL}', 3, 'running', 'x', 'AGP-HVA', 's', '0 / 5 步', '',
          '2026-09-18 09:12', NULL, 'T-TEST-PARENT', 0, 0, '2026-09-18 09:12')`,
    )
    .run();
  assert(ok && ok.success === true, "F2 父行先落、子行后落 → 成功（追问任务挂原任务成立）");
}

// ---- 场景G：nextResearchNo / nextFollowupMessageId 编号推进（确定性、不撞号）----
{
  const { sqlite, db } = freshDb();
  seedFollowupFixtures(sqlite);
  const rn = await nextResearchNo(db);
  assert(/^R-\d{3}$/.test(rn) && rn === "R-008", `G1 下一个研究号 = ${rn}（种子 R-006/R-007，库内最大 +1）`);
  const mn = await nextFollowupMessageId(db);
  assert(/^MSG-\d{3}$/.test(mn), `G2 下一个追问消息号 = ${mn}（种子 MSG-001~003 +1）`);
}

// ---- 静态核验：零外部调用 + 经单一写入面（本文件不直接写除 PD-07 外的表）----
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "S1 followup.js 零外部调用（无 fetch / 无 URL）");
  // 只应有 PD-07 的单一写入面（recordFollowupMessage 内含 INSERT INTO followup_message）；不应有其它表的 INSERT/UPDATE。
  const otherWrites = ["task", "research", "task_object", "context_injection", "research_proposal"].filter(
    (t) => new RegExp(`INSERT INTO ${t}\\b`).test(src) || new RegExp(`UPDATE ${t}\\b`).test(src),
  );
  assert(otherWrites.length === 0, `S2 followup.js 不直接写 PD-01/MD-07/LNK-04/PD-06（仅 PD-07 写面；实测 ${otherWrites.join(",") || "无"}）`);
  assert(/INSERT INTO followup_message\b/.test(src), "S3 followup.js 含 PD-07 单一写入面 recordFollowupMessage");
  const tsrc = stripComments(readFileSync(new URL("./test-f05.mjs", import.meta.url), "utf8"));
  assert(!/fetch\s*\(/.test(tsrc) && !/https?:\/\//.test(tsrc), "S4 本执行器零外部调用");
}

console.log(`\nVERIFY PASS · ${pass} 断言通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
