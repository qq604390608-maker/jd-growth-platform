#!/usr/bin/env node
/**
 * 文档卡（阶段3 · M1 · F-02 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（**TC-U-M1-001 = `run_frequency` 解析 oracle**：合法 Cron、
 *        最小粒度 ≥ 1 分钟、超限报错；**TC-U-M1-002 = `retry_limit` 封顶 ≤ 100 且超限显式报错**；
 *        **TC-I-M1-001 = 任务程序决定何时启动、Agent 只在任务内被调用**；
 *        **TC-I-M1-006 = 消息只带 `task_id`+`step_no`、上下文现读**；**TC-D-M1-003 = `PD-02` 复合 UK**）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-02（验收要点两则）
 *   ｜ `../../docs/03-locks/tech-stack.md` §2.4（消息瘦、状态厚）｜§4.2（Cron 1 分钟 / Paid 250 条 / Queues ≤100 / 单步 ≤15 分钟）｜§5（CFG-04 映射）
 *   ｜ `../../docs/03-locks/schema.md` CFG-04 / MD-13 / MD-14 / PD-01 / PD-02 / PD-06 / LNK-04
 *   ｜ `../../prototype/pages/tasks.html`（**`TYPE_STEPS` 中「机会发现」5 步，钉死需求**）
 *   ｜ `./schedule.js`（被测模块）｜`./step-plan.js`（任务骨架）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-02 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构、语义、字典值与平台上限口径）。
 * 边界：本执行器只验 F-02；F-03/F-04 的建议与启动、F-06 的异常恢复各自的执行器覆盖。
 * 反向清单：登记 `./README.md` 与 `../README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f02.mjs`）。
 *
 * 用法：node server/task-runner/test-f02.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  parseRunFrequency,
  assertCronExpression,
  saveRunPolicy,
  listRunPolicies,
  resolveRunPolicy,
  agentSnapshotOf,
  assertStepMessage,
  createLocalEnqueue,
  delegateToAgent,
  createDiscoveryTask,
  getTaskDispatch,
  CRON_TRIGGER_LIMIT,
  MIN_GRANULARITY_MIN,
  MAX_DURATION_MIN_LIMIT,
  RETRY_LIMIT_PLATFORM_MAX,
  STEP_MESSAGE_MAX_BYTES,
} from "./schedule.js";
import { listTaskObjects, listTaskSteps, getTask, planTaskSteps } from "./step-plan.js";
import { retryLimitOf } from "../tool-executor/index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./schedule.js", import.meta.url);

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

const Q3 = "GOAL-2026Q3-01";
const AT = "2026-09-19 12:00:00";
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

/** spy 版 enqueue：只记录，不落任何痕迹。 */
function spyEnqueue() {
  const spy = async (message) => {
    spy.calls.push(JSON.parse(JSON.stringify(message)));
    return { message_id: `spy#${message.task_id}`, message, size_bytes: Buffer.byteLength(JSON.stringify(message), "utf8") };
  };
  spy.calls = [];
  return spy;
}

function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==================================================== ① TC-U-M1-001 运行频率四式
console.log("① TC-U-M1-001 运行频率解析：四式受支持、其余显式报错、最小粒度 1 分钟");
{
  const daily = parseRunFrequency("每日 02:00");
  assert(daily.kind === "daily" && daily.cron.length === 1 && daily.cron[0] === "0 2 * * *",
    `「每日 02:00」→ 0 2 * * *（实测 ${daily.cron.join(" | ")}）`);

  const multi = parseRunFrequency("每日 02:00,14:00");
  assert(multi.kind === "daily_multi" && multi.cron.length === 2, "多时点展开为多条 Trigger（每日两条）");
  assert(multi.cron[0] === "0 2 * * *" && multi.cron[1] === "0 14 * * *", "多时点各自成条、顺序稳定");

  const hourly = parseRunFrequency("每 2 小时");
  assert(hourly.kind === "hourly" && hourly.cron[0] === "0 */2 * * *", `「每 2 小时」→ 0 */2 * * *（实测 ${hourly.cron[0]}）`);

  const weekly = parseRunFrequency("每周一 09:30");
  assert(weekly.kind === "weekly" && weekly.cron[0] === "30 9 * * 1", `「每周一 09:30」→ 30 9 * * 1（实测 ${weekly.cron[0]}）`);
  assert(parseRunFrequency("每周日 08:00").cron[0] === "0 8 * * 0", "周日映射为 cron 的 0（星期日）");

  for (const [text, why] of [
    ["每天 02:00", "非受支持写法（缺「每」字表式）"],
    ["每日 25:00", "小时越界"],
    ["每日 02:70", "分钟越界"],
    ["每日 2:00:30", "含秒位 → 最小粒度 1 分钟"],
    ["每 0 小时", "N 越界（<1）"],
    ["每 24 小时", "N 越界（须写「每日 HH:MM」）"],
    ["每周八 09:00", "星期非法"],
    ["", "空串"],
  ]) {
    await assertThrows(() => parseRunFrequency(text), `反例：'${text}' → 报错（${why}）`);
  }
  assert(MIN_GRANULARITY_MIN === 1, "最小调度粒度常量为 1 分钟（tech-stack §4.2）");

  const many = Array.from({ length: CRON_TRIGGER_LIMIT + 1 }, (_, i) => `${String(i % 24).padStart(2, "0")}:00`).join(",");
  await assertThrows(() => parseRunFrequency(`每日 ${many}`),
    `超限：展开 > ${CRON_TRIGGER_LIMIT} 条 → 报错（账号 Triggers 上限）`, "超出账号上限");

  await assertThrows(() => assertCronExpression("0 2 * *"), "Cron 段数不为 5 → 报错", "须为 5 段");
  await assertThrows(() => assertCronExpression("0 2 * 1 *"), "日 / 月位非 * → 报错", "日 / 月位须为");
  assert(assertCronExpression("30 9 * * 6") === true, "合法 Cron 通过校验");
}

// ==================================================== ② TC-U-M1-002 策略写入侧从严
console.log("② TC-U-M1-002 `retry_limit` 封顶与平台上限：写入侧显式报错，不静默截断");
{
  const { db } = freshDb();
  assert(RETRY_LIMIT_PLATFORM_MAX === 100, "Queues max_retries 平台上限常量 = 100");
  assert(MAX_DURATION_MIN_LIMIT === 15, "Queue Consumer 单步上限常量 = 15 分钟");

  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "platform", run_frequency: "每日 02:00", retry_limit: 150 }),
    "retry_limit=150 → 报错（显式拒绝，不静默截断）", "超出 Queues max_retries 平台硬上限");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "platform", run_frequency: "每日 02:00", retry_limit: 3, max_duration_min: 30 }),
    "max_duration_min=30 → 报错（超单步 15 分钟上限）", "超出 Queue Consumer 单步上限");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "platform", run_frequency: "每日 02:00", retry_limit: 3, call_limit: 0 }),
    "call_limit=0 → 报错", "call_limit 须为");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "platform", run_frequency: "每天 2 点", retry_limit: 3 }),
    "run_frequency 不可解析 → 报错（不落库）", "无法解析的运行频率");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "nope", run_frequency: "每日 02:00", retry_limit: 3 }),
    "policy_scope 不在 dict:POLICY_SCOPE → 报错（值域不内联）", "不在 dict:POLICY_SCOPE 值域内");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "platform", goal_id: Q3, run_frequency: "每日 02:00", retry_limit: 3 }),
    "平台级策略带 goal_id → 报错", "goal_id 须为空");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "goal", run_frequency: "每日 02:00", retry_limit: 3 }),
    "目标级策略缺 goal_id → 报错", "必须带 goal_id");
  await assertThrows(() => saveRunPolicy(db, { policy_id: "P-BAD", policy_scope: "goal", goal_id: "GOAL-NOPE", run_frequency: "每日 02:00", retry_limit: 3 }),
    "目标级策略指向不存在目标 → 报错", "目标不存在");

  const ok = await saveRunPolicy(db, { policy_id: "P-OK", policy_scope: "goal", goal_id: Q3, run_frequency: "每日 03:00,15:00", max_duration_min: 10, call_limit: 20, retry_limit: 5 });
  assert(ok.retry_limit === 5 && ok.max_duration_min === 10 && ok.call_limit === 20, "合法策略可落库（新增）");
  const upd = await saveRunPolicy(db, { policy_id: "P-OK", policy_scope: "goal", goal_id: Q3, run_frequency: "每 6 小时", retry_limit: 5 });
  assert(upd.run_frequency === "每 6 小时" && upd.max_duration_min === null, "同一 policy_id 覆盖更新（改行带主键条件）");
  assert((await listRunPolicies(db, { activeOnly: true })).length === 3, "策略列表可按生效过滤（种子 2 + 新增 1）");
  assert((await listRunPolicies(db, { policy_scope: "platform" })).length === 1, "策略列表可按作用域过滤");

  // 消费侧兜底与写入侧从严的分工：F-26 的 retryLimitOf 对历史脏值截断并标注。
  const dirty = retryLimitOf({ retry_limit: 150 });
  assert(dirty.retry_limit === 100 && dirty.clamped === true,
    `消费侧对历史脏值截断并标注（实测 retry_limit=${dirty.retry_limit}, clamped=${dirty.clamped}）——写入侧拒绝、消费侧兜底，两侧分工不同`);
}

// ==================================================== ③ 策略选取：目标级优先、回落平台级
console.log("③ CFG-04 策略选取：目标级优先 → 回落平台级 → 都没有则显式报错");
{
  const { db } = freshDb();
  const a = await resolveRunPolicy(db, { goal_id: Q3 });
  assert(a.source === "goal" && a.policy.policy_id === "POL-Q3", "有目标级策略时取目标级（POL-Q3）");
  const b = await resolveRunPolicy(db, { goal_id: "GOAL-2026Q2-01" });
  assert(b.source === "platform" && b.policy.policy_id === "POL-PLAT", "无目标级策略时回落平台级（POL-PLAT）");
  const unknownGoal = await resolveRunPolicy(db, { goal_id: "GOAL-NOPE" });
  assert(unknownGoal.source === "platform", "目标不存在时仍按平台级回落（策略选取不依赖目标存在性；目标把关交给 createDiscoveryTask）");

  await db.prepare("UPDATE run_policy SET is_active = 0 WHERE policy_id = ?").bind("POL-PLAT").run();
  await assertThrows(() => resolveRunPolicy(db, { goal_id: "GOAL-2026Q2-01" }),
    "平台级停用后该目标无可用策略 → 报错（停用策略不参与选取）", "无可用运行策略");
  const c = await resolveRunPolicy(db, { goal_id: Q3 });
  assert(c.source === "goal" && c.policy.policy_id === "POL-Q3", "目标级策略仍在则不受平台级停用影响");
  await db.prepare("UPDATE run_policy SET is_active = 0 WHERE policy_id = ?").bind("POL-Q3").run();
  await assertThrows(() => resolveRunPolicy(db, { goal_id: Q3 }), "两级都停用 → 报错", "无可用运行策略");
}

// ==================================================== ④ TC-I-M1-006 Queue 消息只带两个键
console.log("④ TC-I-M1-006 Queue 消息：恰好 {task_id, step_no}、<1KB、任务与步骤须真实存在");
{
  const { db } = freshDb();
  const size = assertStepMessage({ task_id: "T-1022", step_no: 3 });
  assert(size.size_bytes < STEP_MESSAGE_MAX_BYTES, `消息体积远小于上限（实测 ${size.size_bytes} B / 上限 ${STEP_MESSAGE_MAX_BYTES} B）`);
  await assertThrows(() => assertStepMessage({ task_id: "T-1022" }), "缺 step_no → 报错", "只能含");
  await assertThrows(() => assertStepMessage({ task_id: "T-1022", step_no: 1, context: { big: "x" } }),
    "多带上下文键 → 报错（上下文不得入消息）", "只能含");
  await assertThrows(() => assertStepMessage({ task_id: "T-1022", step_no: 0 }), "step_no 非正整数 → 报错", "step_no 须为");
  await assertThrows(() => assertStepMessage({ task_id: "", step_no: 1 }), "缺 task_id → 报错", "task_id 必填");
  await assertThrows(() => assertStepMessage({ task_id: `T-${"9".repeat(1500)}`, step_no: 1 }),
    `超大消息 → 报错（> ${STEP_MESSAGE_MAX_BYTES} B）`, "超出设计上限");

  await planTaskSteps(db, "T-1022", "discovery"); // 种子 task_step 为空，投递前须先有计划
  const enq = createLocalEnqueue(db, { at: AT });
  await assertThrows(() => enq({ task_id: "T-NOPE", step_no: 1 }), "为不存在的任务投递 → 报错", "任务不存在");
  const out = await enq({ task_id: "T-1022", step_no: 1 });
  assert(out.message_id === "T-1022#1", "投递返回确定性 message_id");
  assert(enq.delivered.length === 1, "本地实现记录投递（痕迹可回查）");
  const steps = await listTaskSteps(db, "T-1022");
  assert(steps.find((s) => s.step_no === 1).step_state === "active", "投递痕迹 = 该步由 pending 置 active");
  await enq({ task_id: "T-1022", step_no: 1 });
  assert((await listTaskSteps(db, "T-1022")).find((s) => s.step_no === 1).step_state === "active", "重复投递幂等（不重复改态）");
}

// ==================================================== ⑤ F-02 发现任务端到端
console.log("⑤ createDiscoveryTask：建任务 → 关联启动对象 → 五步 → 上下文现读 → 发消息");
{
  const { db, sqlite } = freshDb();
  const spy = spyEnqueue();
  const before = { task: countRows(sqlite, "task"), ci: countRows(sqlite, "context_injection"), to: countRows(sqlite, "task_object") };
  const out = await createDiscoveryTask(db, { goal_id: Q3, at: AT, enqueue: spy });

  assert(out.task.task_type === "discovery" && out.task.task_stage === "M3", "发现的 task_stage 为 M3（对齐种子里 discovery 任务）");
  assert(out.task.task_status === "running" && out.task.ended_at === null, "任务以 running 起步（到点创建即可运行）");
  assert(out.task.goal_version_no === 3, "goal_version_no 缺省取目标当前版本（启动时快照）");
  assert(out.policy_source === "goal" && out.policy.policy_id === "POL-Q3", "策略按目标级优先选取并回带来源");
  assert(out.schedule.cron.length === 1 && out.schedule.cron[0] === "0 2 * * *", "运行频率解析为 Cron 并随任务带出");
  assert(/按运行频率（每日 02:00）自动创建发现任务/.test(out.task.trigger_basis), "trigger_basis 记下启动依据（何时、为何）");
  assert(/clue-scan/.test(out.task.agent_version_snapshot), `agent_version_snapshot 取 MD-13 + MD-14（实测 ${out.task.agent_version_snapshot}）`);

  assert(out.steps.length === 5, `发现任务 5 步（原型 TYPE_STEPS 钉死）（实测 ${out.steps.length}）`);
  assert(out.steps.map((s) => s.step_name).join("/") === "载入目标与时间窗/规划采集范围/采集入口与流量/识别与聚合线索/生成机会候选",
    "步骤名逐字对齐原型 TYPE_STEPS");
  assert(countRows(sqlite, "task") === before.task + 1, "落一行 PD-01");
  assert(countRows(sqlite, "task_step") === 5, "落五行 PD-02（种子基线为 0）");

  const objs = await listTaskObjects(db, { task_id: out.task.task_id });
  assert(objs.length === 1 && objs[0].object_type === "goal" && objs[0].link_role === "trigger" && objs[0].object_id === Q3,
    "LNK-04：启动对象指向目标（task_object 替代原型里无法回认的 task.ref 文本）");

  assert(out.context.sections.length === 4, `一阶段上下文 4 类（discovery 模板：goal/background/source/opp_summary）（实测 ${out.context.sections.length}）`);
  assert(out.context.template.map((t) => t.context_type_code).join("/") === "goal/background/source/opp_summary", "模板顺序取自 CFG-06 order_no");
  assert(out.context.complete === true && out.context.missing_required.length === 0, "必填上下文齐备（complete=true）");
  assert(countRows(sqlite, "context_injection") > before.ci, "上下文落 PD-06（上下文现读、可回查）");

  assert(spy.calls.length === 1, "只发一条消息（一步一条消息、自驱动推进）");
  assert(Object.keys(spy.calls[0]).sort().join(",") === "step_no,task_id", `消息恰含两个键（实测 ${Object.keys(spy.calls[0]).join(",")}）`);
  assert(Buffer.byteLength(JSON.stringify(spy.calls[0]), "utf8") < STEP_MESSAGE_MAX_BYTES, "消息体积 < 1 KB（大上下文不入消息）");
  assert(spy.calls[0].step_no === 1, "首条消息指向第 1 步");

  const disp = await getTaskDispatch(db, out.task.task_id);
  assert(disp.steps.length === 5, "派发面可回查任务步骤现状");
  await assertThrows(() => createDiscoveryTask(db, { goal_id: "GOAL-NOPE" }), "目标不存在 → 报错（不为不存在的目标建任务）", "目标不存在");

  // TC-D-M1-003：PD-02 复合 UK 拒重复步号
  const dup = await db
    .prepare("INSERT INTO task_step (step_id, task_id, step_no, step_name, step_state) VALUES (?, ?, ?, ?, ?)")
    .bind("T-9999-S01", out.task.task_id, 1, "重复步号", "pending")
    .run();
  assert(dup.success === false && /UNIQUE/i.test(String(dup.error)), "TC-D-M1-003 反例：重复 (task_id, step_no) → 复合 UK 拒绝");
}

// ==================================================== ⑥ TC-I-M1-001 Agent 只在任务内被调用
console.log("⑥ TC-I-M1-001 调用守卫：Agent 只在任务内被调用（须带 task_id + step_no）");
{
  const { db } = freshDb();
  const out = await createDiscoveryTask(db, { goal_id: Q3, at: AT, enqueue: spyEnqueue() });
  const del = await delegateToAgent(db, { task_id: out.task.task_id, step_no: 1 });
  assert(del.delegated === true && del.task_id === out.task.task_id && del.step_no === 1,
    "任务内调用 Agent：带 task_id + step_no，回带能力版本快照");
  assert(/阶段4/.test(del.note), "阶段3 为契约占位（真实 Agent 归阶段4）");
  await assertThrows(() => delegateToAgent(db, { step_no: 1 }), "任务外调用（缺 task_id）→ 报错", "task_id 必填");
  await assertThrows(() => delegateToAgent(db, { task_id: "T-NOPE", step_no: 1 }), "任务不存在 → 报错", "任务不存在");
  await assertThrows(() => delegateToAgent(db, { task_id: out.task.task_id, step_no: 9 }), "步骤不存在 → 报错", "步骤不存在");

  const snap = await agentSnapshotOf(db, "AGP-HVA");
  assert(snap.snapshot === "hva-agent v1.3 / agent.md r12 / skills: hva-five-checks v1.1, crowd-compare v1.0, behavior-check v1.0, result-assembly v1.0",
    `能力版本快照 = MD-13 版本 + 修订 + MD-14 skills（T-24 裁决后 4 Skill，实测 ${snap.snapshot}）`);
  await assertThrows(() => agentSnapshotOf(db, "AGP-NOPE"), "角色指令不存在 → 报错", "Agent 角色指令不存在");
}

// ==================================================== ⑦ 写入面静态核验
console.log("⑦ 写入面静态核验：本文件改行只落在 CFG-04、必带主键条件、无删行、零外部调用");
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  const updates = [...src.matchAll(/UPDATE\s+([a-z_]+)\s+SET[^;`]*/gi)].map((m) => m[0]);
  assert(updates.length === 1, `本文件只有 1 处改行语句（CFG-04 策略覆盖）（实测 ${updates.length}）`);
  assert(/UPDATE\s+run_policy\s+SET/.test(updates[0]) && /WHERE\s+policy_id/.test(updates[0]),
    "该处分行只落在 run_policy 且带主键条件");
  const inserts = new Set([...src.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)].map((m) => m[1]));
  assert([...inserts].join(",") === "run_policy", `本文件建行只落在 run_policy（实测 ${[...inserts].join(",")}）`);
  assert(!/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i.test(src), "本文件不含删行 / 改结构语句");
  assert(!/fetch\(|https?:/.test(src), "本文件零外部调用（无 fetch / 无 URL）");
}

finish();
