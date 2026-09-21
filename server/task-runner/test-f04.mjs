#!/usr/bin/env node
/**
 * 文档卡（阶段3 · M1 · F-04 用例执行器 · 2026-09-19；2026-09-21 补 MD-07 研究壳断言）
 * 上游：`../../docs/05-test-cases/test-M1.md`
 *        ｜ **TC-I-M1-001 = 第二阶段启动时点 = 建议提交；任务程序决定何时启动、Agent 只在任务内被调用**（F-02/F-04）
 *        ｜ **TC-I-M1-002 = 建议与机会版本关联；重复提交幂等（同 idempotency_key 不重复启动相同任务）**（F-03/F-04）
 *        ｜ **TC-I-M1-007 = 建议与机会版本关联**（selected_opportunity_id 关联 MD-06）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-04（验收要点：第二阶段启动时点＝建议提交；已允许的查询工具按任务规则执行）
 *   ｜ `../../docs/03-locks/schema.md` PD-01 / PD-06 / **MD-07（研究壳：`start_task_id`/`created_at` 的服务功能点列含 F-04）** / MD-12 / MD-06 / LNK-04 / CFG-03 / CFG-06
 *   ｜ `../../prototype/pages/tasks.html`（**`TYPE_STEPS` 中「HVA 研究」5 步，钉死需求**）
 *   ｜ `./hva.js`（被测模块）｜`./proposal.js`（建议读取面）｜`./step-plan.js`（任务骨架）｜`./schedule.js`（enqueue/Agent 守卫）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-04 用例并断言。
 *   含 **MD-07 研究壳**（A29~A43）：建行归属、`start_task_id`/`created_at` 口径、`research_status` 取**字典 item_code**、
 *   ① 由真源派生、②④⑥ 与不覆盖范围为显式「尚未开展」初值、research 产出锚点、重复调用不留第二行。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义、字典值与平台口径）。
 * 边界：本执行器只验 F-04；F-02 的发现任务、F-03 的建议登记、F-06 的异常恢复各自执行器覆盖。
 * 反向清单：登记 `./README.md` 与 `../README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f04.mjs`）。
 *
 * 用法：node server/task-runner/test-f04.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createHvaResearchTask,
  resolveHvaToolPermissions,
  HVA_AGENT_PROFILE_ID,
  RESEARCH_SHELL_INITIAL,
} from "./hva.js";
import { listTaskObjects, listTaskSteps, getTask } from "./step-plan.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./hva.js", import.meta.url);

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

/** 自包含 fixture：插一个机会 + 两条已提交建议（一条版本一致、一条版本冲突）。 */
function seedHvaFixtures(sqlite) {
  // 机会（MD-06，六要素齐全；goal_version_no = 3）
  sqlite.exec(
    `INSERT INTO opportunity
       (opportunity_id, goal_id, goal_version_no, opportunity_title, opportunity_status,
        target_object, phenomenon, initial_basis_note, research_reason, created_at)
     VALUES ('OPP-TEST-04', '${GOAL}', 3, '测试机会-京东超市家庭装复购', 'submitted',
        '家庭装商品', '家庭装首单转化低于普通装', '近 30 天订单样本', '验证家庭装是否候选 HVA', '2026-09-15 20:00')`,
  );
  // 建议 A：版本一致（goal_version_no = 3）
  sqlite.exec(
    `INSERT INTO research_proposal
       (proposal_id, opportunity_id, goal_version_no, research_question, idempotency_key,
        submitted_at, submitted_by, triggered_task_id)
     VALUES ('PROP-TEST-A', 'OPP-TEST-04', 3, '家庭装首单转化率的差异是否支持候选 HVA？', 'prop-test-a',
        '2026-09-15 20:28', 'PM', NULL)`,
  );
  // 建议 B：版本冲突（goal_version_no = 2，而机会当前为 3）
  sqlite.exec(
    `INSERT INTO research_proposal
       (proposal_id, opportunity_id, goal_version_no, research_question, idempotency_key,
        submitted_at, submitted_by, triggered_task_id)
     VALUES ('PROP-TEST-B', 'OPP-TEST-04', 2, '家庭装首单转化率差异在旧版口径下是否支持候选 HVA？', 'prop-test-b',
        '2026-09-16 09:00', 'PM', NULL)`,
  );
}

// ----------------------------------------------------------------- 用例

console.log("== F-04 HVA 研究任务调度 ==");
// 原型钉死的 HVA 研究 5 步（逐字照抄 prototype/pages/tasks.html TYPE_STEPS.hva_research）
const HVA_RESEARCH_STEPS = [
  "载入机会与目标口径",
  "调度工具采集证据",
  "交叉验证候选行为",
  "形成结论与适用范围",
  "产出研究结果与依据",
];

// ---- 场景A：无版本冲突，完整建任务 ----
{
  const { sqlite, db } = freshDb();
  seedHvaFixtures(sqlite);
  const before = countRows(sqlite, "task");
  const r = await createHvaResearchTask(db, { proposal_id: "PROP-TEST-A" });
  assert(countRows(sqlite, "task") === before + 1, "A1 新建一条 hva_research 任务（PD-01 +1）");
  assert(r.task.task_type === "hva_research", "A2 任务类型为 hva_research");
  assert(r.task.task_stage === "M4", "A3 task_stage 由 task_type 推出 = M4");

  // TC-I-M1-001：第二阶段启动时点 = 建议提交时刻（不另取时钟）
  assert(r.task.started_at === "2026-09-15 20:28", "A4 started_at = 建议提交时刻（TC-I-M1-001）");
  assert(r.task.created_at === "2026-09-15 20:28", "A5 created_at = 建议提交时刻（不另取时钟）");
  assert(r.task.started_at === r.proposal.submitted_at, "A6 启动点与建议 submitted_at 一致");

  // 五步计划逐字对齐原型
  assert(r.steps.length === 5, "A7 步骤计划 5 步");
  const names = r.steps.map((s) => s.step_name);
  assert(JSON.stringify(names) === JSON.stringify(HVA_RESEARCH_STEPS), "A8 步骤名逐字对齐原型 TYPE_STEPS.hva_research");

  // LNK-04 启动对象锚点
  const objs = await listTaskObjects(db, { task_id: r.task.task_id });
  const byType = (t) => objs.find((o) => o.object_type === t);
  assert(byType("proposal") && byType("proposal").link_role === "trigger", "A9 LNK-04：proposal = trigger 锚点");
  assert(byType("opportunity") && byType("opportunity").link_role === "output", "A10 LNK-04：opportunity = output 锚点（被研究的作用对象）");

  // 二阶段上下文落 PD-06（CFG-06 hva_research 模板）
  assert(r.context.task_type === "hva_research", "A12 上下文装配按 hva_research 模板");
  const codes = r.context.sections.map((s) => s.context_type_code);
  for (const c of ["goal", "background", "source", "selected_opp", "product_question", "existing_evidence"]) {
    assert(codes.includes(c), `A13 模板含上下文类型 ${c}`);
  }
  assert(r.context.injections_written >= 3, `A14 PD-06 至少落 goal/selected_opp/product_question 三条（实测 ${r.context.injections_written}）`);
  const inj = r.context.injections;
  const selOpp = inj.find((i) => i.context_type_code === "selected_opp");
  assert(selOpp && selOpp.ref_object_id === "OPP-TEST-04", "A15 PD-06 selected_opp 指向机会 OPP-TEST-04（TC-I-M1-007 关联机会）");
  const pq = inj.find((i) => i.context_type_code === "product_question");
  assert(pq && pq.ref_object_id === "PROP-TEST-A", "A16 PD-06 product_question 指向建议 PROP-TEST-A（二阶段产品问题）");

  // CFG-03 工具权限（按 hva-agent 授权，种子 PERM-H-01~10）
  assert(r.tool_permission_source === "agent", "A17 工具权限来源 = agent（CFG-03 grantee_type=agent）");
  assert(r.tool_permissions_pending === false, "A18 工具权限非空（不为 pending）");
  const expPermA = sqlite.prepare("SELECT COUNT(*) c FROM tool_permission WHERE grantee_type='agent' AND grantee_ref='hva-agent'").get().c;
  assert(r.tool_permissions.length === expPermA, `A19 HVA 取到 ${expPermA} 条工具授权（实测 ${r.tool_permissions.length}，按种子动态期望）`);
  assert(r.tool_permissions.every((p) => p.grantee_ref === "hva-agent"), "A20 授权对象均为 hva-agent");

  // 版本无冲突
  assert(r.version_conflict === false, "A21 版本一致时 version_conflict = false");
  assert(r.version_warning === null, "A22 版本一致时 version_warning = null");
  assert(r.effective_goal_version_no === 3 && r.task.goal_version_no === 3, "A23 HVA 任务 goal_version_no = 机会当前 3");

  // Queue 消息恰两键 + dispatch（阶段4 启动 Agent）
  assert(r.dispatch && r.dispatch.message && r.dispatch.message.task_id === r.task.task_id, "A24 dispatch 消息带 task_id");
  assert(r.dispatch.message.step_no === 1, "A25 dispatch 消息 step_no = 1");
  assert(Object.keys(r.dispatch.message).length === 2, "A26 消息恰好 {task_id, step_no} 两键");
  assert(r.delegated && r.delegated.delegated === true, "A27 delegateToAgent 守卫返回 delegated=true（Agent 只在任务内被调用）");

  // 幂等守卫：同一建议重复启动报错（TC-I-M1-002 后半：不重复启动相同任务）
  await assertThrows(
    () => createHvaResearchTask(db, { proposal_id: "PROP-TEST-A" }),
    "A28 同一建议重复启动任务 → 报错（已触发，不得重复）",
    "已触发任务",
  );

  // ---- MD-07 研究壳（2026-09-21 补齐：F-04 建任务同时建研究壳，建行经 F-11 `createResearch`）----
  const shells = sqlite.prepare("SELECT * FROM research WHERE start_task_id = ?").all(r.task.task_id);
  assert(shells.length === 1, `A29 新建 1 行 MD-07 研究壳（实测 ${shells.length}）`);
  const rs = shells[0];
  assert(rs.opportunity_id === "OPP-TEST-04", "A30 研究壳归属被研究的机会");
  assert(rs.research_question === r.proposal.research_question, "A31 research_question 逐字取自建议（真源，不重写）");
  assert(rs.created_at === "2026-09-15 20:28", "A32 created_at = 建议提交时刻（schema MD-07 口径，不另取时钟）");
  assert(rs.start_task_id === r.task.task_id, "A33 start_task_id = 本任务（schema MD-07「服务功能点」列含 F-04）");
  assert(rs.parent_research_no === null, "A34 首个研究无追问链上游（parent_research_no 为空）");
  assert(rs.goal_id === GOAL && rs.goal_version_no === 3, "A35 启动快照＝机会当前 v3（版本冲突以机会为准）");
  assert(r.research_no === rs.research_no && r.research_created === true, "A36 返回值回带研究号与「本次建行」标记");
  const statusCodes = sqlite
    .prepare("SELECT item_code FROM dict_item WHERE dict_type_code = 'RESEARCH_STATUS'")
    .all()
    .map((x) => x.item_code);
  assert(
    statusCodes.includes(rs.research_status),
    `A37 research_status 落在 dict:RESEARCH_STATUS 值域内（实测 ${JSON.stringify(rs.research_status)}，值域 ${statusCodes.join("/")}）`,
  );
  assert(rs.research_status !== "研究中", "A38 反例：不得写 item_name「研究中」（值域真源是 item_code）");
  assert(rs.behavior_hypothesis === null, "A39 建议未提供假设时 behavior_hypothesis 为空（不写空串）");
  assert(
    /^业务目标：.+｜研究问题：.+$/.test(String(rs.e1_goal_statement)),
    `A40 ① 由「业务目标 + 研究问题」逐字派生（实测 ${JSON.stringify(String(rs.e1_goal_statement).slice(0, 32))}…）`,
  );
  for (const [k, v] of Object.entries(RESEARCH_SHELL_INITIAL)) {
    assert(rs[k] === v, `A41 ${k} 写显式「尚未开展」初值（四处 NOT NULL 不留空、不预填结论）`);
  }
  assert(
    byType("research") && byType("research").link_role === "output" && byType("research").object_id === r.research_no,
    "A42 LNK-04：research = output 锚点（与 F-05 追问建壳写法一致）",
  );
  assert(
    sqlite.prepare("SELECT COUNT(*) c FROM research WHERE start_task_id = ?").get(r.task.task_id).c === 1,
    "A43 研究壳幂等键（start_task_id）有效：同一任务恰好 1 行研究壳",
  );
  /**
   * A44 **现状登记（不是期望行为）**——如实固定「幂等守卫位置偏晚」的后果：
   * 守卫 ⑤ `markProposalTriggered` 排在**建任务 / LNK-04 / 建研究壳 / PD-06 之后**，故重复调用虽最终报错，
   * 却已留下**孤儿任务 + 孤儿研究壳**（`triggered_task_id` 只指回最后一次的那条）。
   * 这正是线上 `PROP-001 → T-0026 + T-0029` 双任务的同形机制（登记 `README.md` §8.1 ⑨，本次**不擅改**
   * F-03/F-04 的守卫顺序）。**修复（守卫前移）后本断言应改为总数 3**——红即信号。
   */
  const researchTotal = sqlite.prepare("SELECT COUNT(*) c FROM research").get().c;
  assert(
    researchTotal === 4,
    `A44 现状登记：种子 2 行 + 正常 1 行 + 被拦下的重复调用留下的孤儿 1 行 = 4（实测 ${researchTotal}；守卫前移后应为 3）`,
  );
}

// ---- 场景B：版本冲突以机会为准 + 提示 ----
{
  const { sqlite, db } = freshDb();
  seedHvaFixtures(sqlite);
  const r = await createHvaResearchTask(db, { proposal_id: "PROP-TEST-B" });
  assert(r.version_conflict === true, "B1 建议 v2 vs 机会 v3 → version_conflict = true");
  assert(typeof r.version_warning === "string" && r.version_warning.length > 0, "B2 version_warning 非空（提示不阻断）");
  assert(r.proposal_goal_version_no === 2 && r.effective_goal_version_no === 3, "B3 以机会当前版本 3 为准（不看建议旧版 2）");
  assert(r.task.goal_version_no === 3, "B4 HVA 任务 goal_version_no = 机会当前 3（版本冲突以机会为准）");
  assert(r.task.task_status === "running", "B5 版本冲突仍正常建任务（不否定、不阻断）");
  // 冲突场景同样落了完整上下文与权限
  assert(r.context.injections_written >= 3, "B6 冲突场景仍落二阶段上下文 PD-06");
  const expPermB = sqlite.prepare("SELECT COUNT(*) c FROM tool_permission WHERE grantee_type='agent' AND grantee_ref='hva-agent'").get().c;
  assert(r.tool_permissions.length === expPermB, `B7 冲突场景仍取 HVA 工具权限（${expPermB} 条）`);
}

// ---- 场景C：边界 —— 建议不存在 ----
{
  const { sqlite, db } = freshDb();
  seedHvaFixtures(sqlite);
  await assertThrows(
    () => createHvaResearchTask(db, { proposal_id: "PROP-NOPE" }),
    "C1 建议不存在 → 报错（HVA 只由真实建议触发）",
    "研究建议不存在",
  );
}

// ---- 场景D：resolveHvaToolPermissions 直接取权限（按 agent_code） ----
{
  const { sqlite, db } = freshDb();
  seedHvaFixtures(sqlite);
  const p = await resolveHvaToolPermissions(db, { agent_code: "hva-agent" });
  const expPermD = sqlite.prepare("SELECT COUNT(*) c FROM tool_permission WHERE grantee_type='agent' AND grantee_ref='hva-agent'").get().c;
  assert(p.tool_permissions.length === expPermD && p.tool_permission_source === "agent", `D1 按 hva-agent 取到 ${expPermD} 条授权`);
  const none = await resolveHvaToolPermissions(db, { agent_code: "no-such-agent" });
  assert(none.tool_permissions.length === 0 && none.tool_permissions_pending === true, "D2 未知 agent → 无授权且 pending（不阻断）");
}

// ---- 静态核验：零外部调用 + 生产零写（本文件不直写库） ----
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "S1 hva.js 零外部调用（无 fetch / 无 URL）");
  assert(!/db\.prepare\(/.test(src), "S2 hva.js 不直接写库（全部委托给 step-plan/proposal/shared-context 单一写入面）");
  const tsrc = stripComments(readFileSync(new URL("./test-f04.mjs", import.meta.url), "utf8"));
  assert(!/fetch\s*\(/.test(tsrc) && !/https?:\/\//.test(tsrc), "S3 本执行器零外部调用");
}

console.log(`\nVERIFY PASS · ${pass} 断言通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
