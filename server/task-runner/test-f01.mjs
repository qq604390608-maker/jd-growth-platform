#!/usr/bin/env node
/**
 * 文档卡（阶段3 · M1 · F-01 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（**TC-I-M1-005 = F-01 验收 oracle**：目标中途更新 → 同一研究
 *        不因目标更新被悄悄替换、新版本落 `MD-02`、历史研究保留启动时口径快照；
 *        **TC-I-M1-006** = 版本切换 / 状态跃迁写库（每个跃迁是一行可查数据）；
 *        **TC-D-M1-001** = `PD-01` 的 NOT NULL；**TC-D-M1-002** = `PD-01.goal_id` FK；
 *        **TC-D-M1-006** = `PD-04` 三外键）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-01（三条验收要点）
 *   ｜ `../../docs/01-brd/BRD.md` §4 F-01（六要素；**不替业务方另定指标定义**）
 *   ｜ `../../docs/03-locks/schema.md` MD-01 / MD-02（定版式快照、`is_applied` 至多一行为 1）/ MD-03（逻辑删除）/
 *        PD-04（`raised_by_task_id` NOT NULL FK）/ CFG-05（`match_pattern` 命中即视为已写清）
 *   ｜ `../../prototype/assets/data.js` L105-125（**`gapRules` / `checkGaps` 钉死需求**）
 *   ｜ `./goal.js`（被测模块）｜ `./step-plan.js`（任务骨架）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-01 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构、语义、字典值域与版本隔离）。
 * 边界：本执行器只验 F-01；F-02 的调度与 F-06 的异常恢复各自的执行器覆盖。
 * 反向清单：登记 `./README.md` 与 `../README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f01.mjs`）。
 *
 * 用法：node server/task-runner/test-f01.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  GOAL_FIELDS,
  normalizeGoalField,
  registerGoal,
  listGoals,
  getGoal,
  getGoalVersion,
  listGoalVersions,
  saveGoalVersion,
  applyGoalVersion,
  getAppliedGoalVersion,
  registerGoalMaterial,
  listGoalMaterials,
  deactivateGoalMaterial,
  checkGoalGaps,
  listGoalGaps,
  fillGoalGap,
  runGoalCheckTask,
  getGoalRecord,
} from "./goal.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./goal.js", import.meta.url);

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

/** 建库：载入真实 DDL + 真实种子；种子自带 FK pragma，先剥离再载入，之后开 FK。 */
function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  sqlite.exec(mock);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

const Q3 = "GOAL-2026Q3-01"; // 种子：current_version_no=3，v3 已 is_applied=1
const NEW_GOAL = "GOAL-2026Q3-09"; // 本执行器新建，避开种子目标
const AT = "2026-09-19 12:00:00";
const SIX = {
  business_goal: "提升京东超市新客 30 天复购率",
  metric_definition: "新客＝考察期内首次在京东超市下单的用户；30 天复购＝首单后 30 个自然日内再次下单（已剔除退款与取消订单）",
  business_scope: "京东超市主站频道；品类限粮油调味、乳品烘焙、个护清洁",
  focus_period: "2026-07-01 ~ 2026-09-15",
  known_constraints: "Q3 大促（8/18–8/20）期间流量结构偏移，该时段需单独观察，不与日常合并",
  provider: "超市事业部运营组 · 张运营",
};

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

function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

// ==================================================== ① 六要素必填口径 + 值域不内联
console.log("① 六要素必填（缺键即拒、值可为空串）+ 字段名归一");
{
  const { db } = freshDb();
  assert(GOAL_FIELDS.length === 6 && GOAL_FIELDS[0] === "business_goal", `六要素共 6 项，首项为 business_goal（实测 ${GOAL_FIELDS.join("/")}）`);
  assert(normalizeGoalField("business_scope") === "business_scope", "规范字段名原样通过");
  assert(normalizeGoalField("scope") === "business_scope", "种子别名 scope → business_scope（显式映射，非静默吞）");
  assert(normalizeGoalField("period") === "focus_period", "种子别名 period → focus_period");
  assert(normalizeGoalField("metricDef") === "metric_definition", "原型字段名 metricDef → metric_definition");
  assert(normalizeGoalField("nope") === null, "未登记字段名不映射（由调用方显式报错）");

  await assertThrows(() => registerGoal(db, { ...SIX, metric_definition: undefined, created_by: "张运营", at: AT }),
    "六要素缺 metric_definition → 拒（MD-02 六列皆 NOT NULL）", "六要素必填");
  await assertThrows(() => registerGoal(db, { ...SIX, created_by: "" }), "缺 created_by → 拒", "created_by 必填");

  const ok = await registerGoal(db, { goal_id: NEW_GOAL, ...SIX, metric_definition: "", created_by: "张运营", at: AT });
  assert(ok.version.version_no === 1, "登记目标同时落 v1 快照");
  assert(ok.version.metric_definition === "", "六要素值可为空串（留空即产生口径待补项，平台不代填）");
  assert(ok.goal.current_version_no === 1, "MD-01.current_version_no 指向最新保存的版本");
  assert(ok.goal.goal_status === "active", "goal_status 默认 active（值域取自 dict:GOAL_STATUS）");
  await assertThrows(() => registerGoal(db, { goal_id: NEW_GOAL, ...SIX, created_by: "张运营" }),
    "同一 goal_id 重复登记 → 拒（目标身份跨版本稳定）", "目标已存在");
  await assertThrows(() => registerGoal(db, { ...SIX, goal_status: "nope", created_by: "张运营" }),
    "goal_status 不在 dict:GOAL_STATUS → 拒（值域不内联）", "不在 dict:GOAL_STATUS 值域内");
}

// ==================================================== ② 版本化：定版快照 + is_applied 至多一行 1
console.log("② TC-I-M1-005 版本切换不混期：旧快照逐字不动 + is_applied 至多一行 1");
{
  const { db } = freshDb();
  const v3 = await getGoalVersion(db, Q3, 3);
  const v3Before = JSON.stringify(v3);

  const saved = await saveGoalVersion(db, {
    goal_id: Q3, ...SIX,
    business_scope: "京东超市主站频道（APP + 小程序）；品类限粮油调味、乳品烘焙、个护清洁",
    change_note: "业务范围补充渠道口径", impact_note: "影响 1 个在研研究（R-007）", created_by: "张运营", at: AT,
  });
  assert(saved.version_no === 4, `新版本号取库内最大值 +1（实测 v${saved.version_no}）`);
  assert(saved.goal_version_id === `${Q3}-v4`, "goal_version_id 形如 goal_id + '-v' + version_no");
  assert(saved.is_applied === 0 && saved.applied_at === null, "新版本默认未生效（须显式「应用配置」）");
  assert((await getGoalVersion(db, Q3, 3)).business_scope === JSON.parse(v3Before).business_scope,
    "保存 v4 后 v3 的业务范围逐字未变（更新不改旧行）");
  assert(JSON.stringify(await getGoalVersion(db, Q3, 3)) === v3Before, "v3 整行逐字节未变（历史快照只读）");
  await assertThrows(() => saveGoalVersion(db, { goal_id: Q3, ...SIX, business_scope: "x", created_by: "张运营" }),
    "缺 change_note → 拒（本版本变更说明必填）", "change_note 必填");
  await assertThrows(() => saveGoalVersion(db, { goal_id: "GOAL-NOPE", ...SIX, change_note: "x", created_by: "y" }),
    "目标不存在 → 拒", "目标不存在");

  await applyGoalVersion(db, { goal_id: Q3, version_no: 4, applied_at: AT });
  assert((await getAppliedGoalVersion(db, Q3)).version_no === 4, "应用配置后 v4 生效");
  const applied1 = (await listGoalVersions(db, Q3)).filter((v) => v.is_applied === 1);
  assert(applied1.length === 1 && applied1[0].version_no === 4, `同 goal 生效版本恰 1 行（实测 ${applied1.length} 行，型号 v${applied1.length ? applied1[0].version_no : "-"}）`);
  assert((await getGoalVersion(db, Q3, 3)).is_applied === 0, "旧生效版本被清零（先清零再置一）");

  await applyGoalVersion(db, { goal_id: Q3, version_no: 1, applied_at: AT });
  const applied2 = (await listGoalVersions(db, Q3)).filter((v) => v.is_applied === 1);
  assert(applied2.length === 1 && applied2[0].version_no === 1, "再次应用配置仍恒 1 行生效（可回退到旧版本）");
  assert((await getGoalVersion(db, Q3, 1)).applied_at === AT, "applied_at 记录应用时点");
  await assertThrows(() => applyGoalVersion(db, { goal_id: Q3, version_no: 99 }), "应用不存在的版本 → 拒", "目标版本不存在");
  await assertThrows(() => applyGoalVersion(db, { goal_id: "GOAL-NOPE", version_no: 1 }), "应用不存在的目标 → 拒", "目标不存在");
}

// ==================================================== ③ 口径检查（CFG-05 规则驱动，含别名归一）
console.log("③ 口径检查：规则来自 CFG-05、别名归一可见、命中即视为写清");
{
  const { db } = freshDb();
  const { task } = await runGoalCheckTask(db, { goal_id: Q3, goal_version_no: 3, created_by: "张运营", at: AT });
  const gaps = await listGoalGaps(db, { goal_id: Q3, unsolvedOnly: true });
  const ruleIds = gaps.map((g) => g.rule_id);
  assert(ruleIds.includes("GAP-1") && ruleIds.includes("GAP-2") && ruleIds.includes("GAP-3"),
    `GAP-1/2/3 未命中 → 三条待补项（实测 ${ruleIds.join("/")}）`);
  assert(!ruleIds.includes("GAP-4"), "GAP-4（关注时段须写日期）已在 v3 命中 → 不再列为待补");
  assert(gaps.length === 3, `待补项条数＝未命中规则数（实测 ${gaps.length}）`);
  assert(gaps.every((g) => g.is_solved === 0 && g.filled_value === null), "待补项初始未补充（filled_* 为空）");
  assert(gaps.every((g) => g.raised_by_task_id === task.task_id), "每条待补项归属本次口径检查任务（NOT NULL 外键）");
  assert(gaps.every((g) => GOAL_FIELDS.includes(g.target_field)), "PD-04.target_field 全部落在 dict:GOAL_FIELD 值域内");
  const gap3 = gaps.find((g) => g.rule_id === "GAP-3");
  assert(gap3.target_field === "business_scope", "GAP-3 target_field 已为规范值 business_scope（种子已对齐字典，Q-13 已决①）");

  const check = await checkGoalGaps(db, { goal_id: Q3, goal_version_no: 3, task_id: task.task_id, at: AT });
  // 种子 GAP-3/4 已对齐 dict:GOAL_FIELD（Q-13 已决①），使用处不再回报别名偏差；
  // 别名防御本身仍生效（见 ② normalizeGoalField 单元断言 scope→business_scope / period→focus_period）
  assert(check.alias_fields.length === 0, "种子已合规 → 使用处不产生别名回报（偏差已消除，非静默吞）");
  await assertThrows(() => checkGoalGaps(db, { goal_id: Q3, goal_version_no: 3 }),
    "缺 task_id → 拒（待补项须归属一次口径检查任务）", "task_id 必填");
  await assertThrows(() => checkGoalGaps(db, { goal_id: Q3, goal_version_no: 3, task_id: "T-NOPE" }),
    "任务不存在 → 拒", "任务不存在");
  const seeded = await checkGoalGaps(db, { goal_id: Q3, goal_version_no: 3, task_id: task.task_id, at: AT });
  assert(seeded.gaps.every((g) => g.rule_id !== "GAP-4"), "已写清的口径重复检查也不会「复活」成待补项");
}

// ==================================================== ④ 口径检查任务（2 步、留痕、总是建任务）
console.log("④ 口径检查任务：goal_check 2 步、跃迁留痕、无待补项也留任务");
{
  const { db, sqlite } = freshDb();
  const beforeTasks = countRows(sqlite, "task");
  const out = await runGoalCheckTask(db, { goal_id: Q3, goal_version_no: 3, created_by: "张运营", at: AT });
  assert(out.task.task_type === "goal_check", "任务类型为 goal_check");
  assert(out.task.task_stage === "M1", "口径检查归属 M1（对齐 TASK_TYPE_STAGE）");
  assert(out.task.task_status === "done" && out.task.ended_at === AT, "检查完成即置 done 并记 ended_at");
  assert(out.task.progress_text === "2 / 2 步", `progress_text 形如 n / m 步（实测 ${out.task.progress_text}）`);
  assert(out.task.is_auto_restart === 0, "is_auto_restart 恒 0");
  assert(out.task.agent_profile_id === null && /CFG-05/.test(out.task.agent_version_snapshot),
    "不调 Agent 的任务：agent_profile_id 为空，但 agent_version_snapshot 显式写明能力来源（不留空）");
  assert(countRows(sqlite, "task") === beforeTasks + 1, "口径检查任务落一行 PD-01（即使待补项为 0 也留痕）");
  const steps = (await db.prepare("SELECT * FROM task_step WHERE task_id = ? ORDER BY step_no").bind(out.task.task_id).all()).results;
  assert(steps.length === 2, `步骤计划 2 步（原型 TYPE_STEPS 口径检查）（实测 ${steps.length}）`);
  assert(steps[0].step_name === "按规则校验六要素口径" && steps[1].step_name === "产出待补项", "步骤名逐字对齐原型 TYPE_STEPS");
  assert(steps.every((s) => s.step_state === "done"), "两步均已完成（每个跃迁是一行可查数据）");
  assert(String(out.task.done_part).includes("3 项口径待补"), `done_part 记下已完成部分（实测含「3 项口径待补」）`);
  await assertThrows(() => runGoalCheckTask(db, { goal_id: "GOAL-NOPE", goal_version_no: 1 }), "目标不存在 → 拒", "目标不存在");
}

// ==================================================== ⑤ 待补项补充 → 并入六要素并 bump 新版本
console.log("⑤ 补充待补项：写 filled_* + 并入六要素 + 形成新版本（不覆盖业务方已写内容）");
{
  const { db } = freshDb();
  const { task } = await runGoalCheckTask(db, { goal_id: Q3, goal_version_no: 3, created_by: "张运营", at: AT });
  const gaps = await listGoalGaps(db, { goal_id: Q3, unsolvedOnly: true });
  const g1 = gaps.find((g) => g.rule_id === "GAP-1");
  assert(g1.target_field === "metric_definition", "GAP-1 归属 metric_definition（规范字段名直接命中）");

  const filled = await fillGoalGap(db, { gap_id: g1.gap_id, filled_value: "复购口径剔除退款与取消订单", filled_by: "张运营", at: AT });
  assert(filled.gap.is_solved === 1 && filled.gap.filled_by === "张运营" && filled.gap.filled_at === AT,
    "补充后 filled_* 落库、is_solved=1");
  const v3Row = await getGoalVersion(db, Q3, 3);
  assert(filled.version.version_no === 4, "补充后形成目标新版本（bump）");
  assert(filled.version.metric_definition === `${v3Row.metric_definition}；复购口径剔除退款与取消订单`,
    "补充内容并入对应六要素字段（原值保留 + 追加，不覆盖）");
  assert((await getGoalVersion(db, Q3, 3)).metric_definition === "新客 = 考察期内首次在京东超市下单的用户；30 天复购 = 首单后 30 个自然日内再次下单（≥1 单）",
    "产生待补项的那一版快照逐字未变（历史只读）");
  assert((await listGoalGaps(db, { goal_id: Q3, unsolvedOnly: true })).some((g) => g.rule_id === "GAP-1") === false,
    "补充后该规则不再列为待补（is_solved 过滤）");
  const g2 = gaps.find((g) => g.rule_id === "GAP-2");
  await assertThrows(() => fillGoalGap(db, { gap_id: g2.gap_id, filled_value: "   ", filled_by: "张运营" }),
    "补充内容为空白 → 拒（filled_value 必填）", "filled_value 必填");
  await assertThrows(() => fillGoalGap(db, { gap_id: g2.gap_id, filled_value: "x", filled_by: "" }),
    "缺补充人 → 拒", "filled_by 必填");
  await assertThrows(() => fillGoalGap(db, { gap_id: g1.gap_id, filled_value: "x", filled_by: "张运营" }),
    "同一待补项重复补充 → 拒（不产生重复新版本）", "已补充");
  await assertThrows(() => fillGoalGap(db, { gap_id: "GAP-999", filled_value: "x", filled_by: "y" }), "待补项不存在 → 拒", "待补项不存在");
  const recheck = await checkGoalGaps(db, { goal_id: Q3, goal_version_no: 4, task_id: task.task_id, at: AT });
  assert(recheck.gaps.every((g) => g.rule_id !== "GAP-1"), "新版本重跑检查：已补充的 GAP-1 仍不复活（solved 记忆跨版本）");
}

// ==================================================== ⑥ 材料登记与逻辑删除（MD-03）
console.log("⑥ 目标材料：登记即引用、移除是逻辑删除（保留历史行）");
{
  const { db, sqlite } = freshDb();
  const mat = await registerGoalMaterial(db, {
    goal_id: Q3, material_name: "9/18 业务方补充说明", material_kind: "doc",
    material_at: "2026-09-18", material_from: "tenant", registered_at: AT,
  });
  assert(mat.is_active === 1, "材料登记默认为仍关联");
  assert((await listGoalMaterials(db, { goal_id: Q3 })).length === 3, "v3 目标的材料数为 3（种子 2 + 新增 1）");
  const off = await deactivateGoalMaterial(db, mat.material_id);
  assert(off.is_active === 0, "移除后 is_active=0");
  assert(countRows(sqlite, "goal_material") === 6, "逻辑删除不物理删除（行数不减）");
  assert((await listGoalMaterials(db, { goal_id: Q3 })).length === 2, "默认查询不含已移除材料");
  assert((await listGoalMaterials(db, { goal_id: Q3, includeInactive: true })).length === 3, "含失效查询可看到历史行");
  await assertThrows(() => registerGoalMaterial(db, { goal_id: Q3, material_name: "x", material_kind: "nope", material_from: "tenant" }),
    "material_kind 不在 dict:MATERIAL_KIND → 拒（值域不内联）", "不在 dict:MATERIAL_KIND 值域内");
  await assertThrows(() => registerGoalMaterial(db, { goal_id: Q3, material_name: "x", material_kind: "doc", material_from: "nope" }),
    "material_from 不在 dict:MATERIAL_FROM → 拒", "不在 dict:MATERIAL_FROM 值域内");
  await assertThrows(() => deactivateGoalMaterial(db, "MAT-NOPE"), "材料不存在 → 拒", "材料不存在");
}

// ==================================================== ⑦ L3 约束（TC-D-M1-001/002/006）
console.log("⑦ L3 约束：PD-01 的 NOT NULL 与 FK、PD-04 的三外键、PD-02 复合 UK");
{
  const { db, sqlite } = freshDb();
  // 注：D1 适配层的 `run()` 把库级错误**收成返回值**（`{success:false, error}`）而非抛出——反例一律看返回值。
  const insertTask = (task_id, goal_id) =>
    db
      .prepare(
        "INSERT INTO task (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis, agent_profile_id, agent_version_snapshot, progress_text, done_part, started_at, ended_at, parent_task_id, retry_count, is_auto_restart, created_at) VALUES (?, 'goal_check', 'M1', ?, 1, 'running', 'x', NULL, 'y', '0 / 2 步', '', ?, NULL, NULL, 0, 0, ?)",
      )
      .bind(task_id, goal_id, AT, AT)
      .run();

  const r1 = await insertTask(null, Q3);
  assert(r1.success === false && /NOT NULL/i.test(String(r1.error)),
    `TC-D-M1-001 反例：task_id=NULL → NOT NULL 拒绝（实测 ${String(r1.error).slice(0, 60)}）`);
  assert((await db.prepare("SELECT task_id FROM task WHERE task_id = 'T-9001'").bind().first()) === null,
    "TC-D-M1-001 正例前提：非法行未落库");

  const r2 = await insertTask("T-9001", "GOAL-NOPE");
  assert(r2.success === false && /FOREIGN KEY/i.test(String(r2.error)),
    `TC-D-M1-002 反例：goal_id='GOAL-NOPE' → FK 拒绝（实测 ${String(r2.error).slice(0, 60)}）`);
  const r2ok = await insertTask("T-9002", Q3);
  assert(r2ok.success === true, "TC-D-M1-001/002 正例：合法 task_id + 存在 goal_id → 插入成功");

  let seq = 0;
  for (const [col, val, label] of [
    ["goal_id", "GOAL-NOPE", "goal_id 不存在"],
    ["raised_by_task_id", "T-NOPE", "raised_by_task_id 不存在"],
    ["rule_id", "GAP-NOPE", "rule_id 不存在"],
  ]) {
    seq += 1;
    const row = { gap_id: `GAP-9${seq}0`, goal_id: Q3, goal_version_no: 3, rule_id: "GAP-1", target_field: "metric_definition", gap_text: "x", impact_note: "y", raised_at: AT, raised_by_task_id: "T-1022" };
    row[col] = val;
    const rr = await db
      .prepare("INSERT INTO goal_gap (gap_id, goal_id, goal_version_no, rule_id, target_field, gap_text, impact_note, raised_at, raised_by_task_id, filled_value, filled_at, filled_by, is_solved) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)")
      .bind(row.gap_id, row.goal_id, row.goal_version_no, row.rule_id, row.target_field, row.gap_text, row.impact_note, row.raised_at, row.raised_by_task_id)
      .run();
    assert(rr.success === false && /FOREIGN KEY/i.test(String(rr.error)),
      `TC-D-M1-006 反例：${label} → FK 拒绝（实测 ${String(rr.error).slice(0, 50)}）`);
  }

  const steps = countRows(sqlite, "task_step");
  assert(steps === 0, "种子 task_step 基线为 0 行（步骤计划由本模块写入）");

  const rec = await getGoalRecord(db, Q3);
  assert(rec.versions.length === 3 && rec.applied_version.version_no === 3, "F-27 读模型：身份 + 3 版历史 + 生效版本（v3）");
  assert(rec.materials.length === 2 && rec.open_gaps.length === 0, "读模型带材料与未补待补项");
  assert((await listGoals(db, { status: "archived" })).length === 1, "目标列表可按状态过滤（归档 1 条）");
  assert((await getGoal(db, Q3)).created_by === "超市事业部运营组 · 张运营", "目标身份含登记人");
}

// ==================================================== ⑧ 写入面静态核验（改行必带主键条件、无删行）
console.log("⑧ 写入面静态核验：只改本模块拥有的表、改行必带 WHERE、无删行语句");
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  const updates = [...src.matchAll(/UPDATE\s+([a-z_]+)\s+SET[^;`]*/gi)].map((m) => m[0]);
  assert(updates.length > 0, `F-01 确需改行写入（实测 ${updates.length} 处）`);
  assert(updates.every((u) => /WHERE\s+(goal_id|material_id|gap_id|task_id|research_goal)/.test(u)),
    "每处改行都带主键 / 归属条件（禁全表更新）");
  const tables = new Set(updates.map((u) => /UPDATE\s+([a-z_]+)/i.exec(u)[1]));
  assert([...tables].every((t) => ["research_goal", "research_goal_version", "goal_material", "goal_gap"].includes(t)),
    `改行只落在 F-01 拥有的四表（实测 ${[...tables].join("/")}）`);
  assert(!/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i.test(src), "本文件不含删行 / 改结构语句");
  assert(!/fetch\(|https?:/.test(src), "本文件零外部调用（无 fetch / 无 URL）");
}

finish();
