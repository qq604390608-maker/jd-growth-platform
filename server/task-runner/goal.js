/**
 * 文档卡（阶段3 · M1 · F-01 研究目标登记与口径管理 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（**TC-I-M1-005 = F-01 版本切换不混期**；
 *        TC-D-M1-001/002 = `PD-01` 的 NOT NULL 与 `goal_id` FK；TC-D-M1-006 = `PD-04` 三外键；TC-I-M1-006 = 跃迁留痕）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-01（验收要点：① 同一研究不因目标中途更新被悄悄替换；
 *        ② 待补项清晰列给业务方；③ 版本切换不污染历史研究的口径快照）
 *   ｜ `../../docs/01-brd/BRD.md` §4 F-01（六要素；**Agent 和 PM 不能替业务方另定指标定义**）+ F-06 受阻矩阵第 1 行
 *        （目标或指标口径不清 → 列出需明确的内容、保留已有目标信息）
 *   ｜ `../../docs/03-locks/schema.md` MD-01 `research_goal`（`goal_seq` UK、`current_version_no` 指向最近一次保存）、
 *        MD-02 `research_goal_version`（**定版式快照**：更新不改旧行；`is_applied` 同 `goal_id` 至多一行为 1；
 *        `metric_definition`「留空即产生口径待补项，**平台不代填**」）、MD-03 `goal_material`（**移除是逻辑删除**）、
 *        PD-04 `goal_gap`（`raised_by_task_id` **NOT NULL FK→PD-01**；`filled_*` 补充后并入六要素并**形成目标新版本**）、
 *        CFG-05 `gap_rule`（`match_pattern` 命中即视为该口径已写清）
 *   ｜ `../../docs/07-decisions/ADR-001-业务背景不与目标版本联动.md`（§3：目标版本只由六要素驱动，业务背景不联动）
 *   ｜ `../../prototype/pages/goal.html` + `../../prototype/assets/data.js` L105-125 **`gapRules` / `checkGaps`**
 *        （**钉死需求**：规则逐条照录；`checkGaps` = 滤出「未 solved 且 pattern 不命中」的规则）
 *   ｜ `./step-plan.js`（任务骨架：取号 / 建行 / 步骤 / 进度）｜ `../tool-executor/task-state.js`（任务态写入面）
 * 职责：目标身份与六要素**版本化**（保存为新版本、应用配置、历史快照只读）、材料登记与逻辑删除、
 *   口径检查（按 `CFG-05` 规则产出 `PD-04` 待补项）、待补项补充（并入六要素并 bump 新版本）、
 *   以及**口径检查任务**（`goal_check` 2 步）的创建与完成。
 * 边界：目标口径的**判定规则来自 `CFG-05`，本文件不内置任何业务口径**（BRD：不替业务方定指标）；
 *   业务背景（`MD-04`）不联动版本（ADR-001）；材料是引用登记，**不含内容**。
 * 门禁状态：无外部依赖（纯本地库读写）。
 *
 * 反向清单：被 `../api/index.js`（F-01 路由）引用；被后续 F-02（发现任务调度，应用配置后触发）与
 *   F-03（研究建议，消费目标版本号）的实现引用（**各自落地时补记**，反向清单只记既有事实）；
 *   登记 `./README.md` 与 `../README.md`；测试 `./test-f01.mjs`。
 */
import {
  createTask,
  planTaskSteps,
  advanceStep,
  dictCodes,
  setTaskStatus,
  appendDonePart,
} from "./step-plan.js";

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** 六要素字段名，**与 `dict:GOAL_FIELD` 的 `item_code` 一一对应**。 */
export const GOAL_FIELDS = [
  "business_goal",
  "metric_definition",
  "business_scope",
  "focus_period",
  "known_constraints",
  "provider",
];

/**
 * 字段名别名归一表。起因：`CFG-05 gap_rule.target_field` 的种子里，GAP-3/GAP-4 写的是原型字段名
 * （`scope` / `period`），**不在 `dict:GOAL_FIELD` 值域**——这是上游种子的值域偏差（已登记 `schema.md` §12 Q-13）。
 * 本表只做「已知别名 → 规范字段名」的**显式**映射，映射结果才落 `PD-04.target_field`（保证值域合法）；
 * 未登记的名字**一律抛错**，不静默跳过（否则「规则没生效」会被伪装成「口径已写清」）。
 */
export const GOAL_FIELD_ALIAS = {
  businessGoal: "business_goal",
  metricDef: "metric_definition",
  scope: "business_scope",
  period: "focus_period",
  constraints: "known_constraints",
  business_goal: "business_goal",
  metric_definition: "metric_definition",
  business_scope: "business_scope",
  focus_period: "focus_period",
  known_constraints: "known_constraints",
  provider: "provider",
};

/** 归一字段名；不可归一返回 `null`。 */
export function normalizeGoalField(raw) {
  return GOAL_FIELD_ALIAS[String(raw ?? "").trim()] || null;
}

/** 从入参里取六要素。**缺键即拒**（MD-02 六列皆 NOT NULL）；**值可为空串**——留空即产生口径待补项。 */
function pickSixElements(input) {
  const missing = [];
  const fields = {};
  for (const f of GOAL_FIELDS) {
    if (input[f] === undefined || input[f] === null) missing.push(f);
    else fields[f] = String(input[f]);
  }
  if (missing.length) {
    throw new Error(`六要素必填，缺：${missing.join(", ")}（MD-02 六列皆 NOT NULL；值可为空串，空串即产生口径待补项）`);
  }
  return fields;
}

async function dictHas(db, dict_type_code, item_code, label) {
  const codes = await dictCodes(db, dict_type_code);
  if (!codes.includes(item_code)) {
    throw new Error(`${label} '${String(item_code)}' 不在 dict:${dict_type_code} 值域内（${codes.join(" / ")}）`);
  }
}

/** 下一个目标展示序号（`MD-01.goal_seq` 为 UK，取库内最大值 +1）。 */
export async function nextGoalSeq(db) {
  const rows = (await db.prepare("SELECT goal_seq FROM research_goal").all()).results || [];
  let max = 0;
  for (const r of rows) max = Math.max(max, Number(r.goal_seq) || 0);
  return max + 1;
}

/**
 * 登记研究目标（`MD-01`）并同时落 **v1 六要素快照**（`MD-02`）。
 * `goal_id` 可由业务侧显式给出（如 `GOAL-2026Q3-01`）；不给则按 `GOAL-<年>Q<季>-<两位序号>` 生成。
 */
export async function registerGoal(db, input = {}) {
  const { goal_id: givenId, goal_status = "active", created_by, at } = input;
  const fields = pickSixElements(input);
  if (!created_by) throw new Error("registerGoal：created_by 必填（目标登记人）");
  await dictHas(db, "GOAL_STATUS", goal_status, "goal_status");

  const goal_seq = await nextGoalSeq(db);
  const stamp = at || nowStamp();
  const y = Number(String(stamp).slice(0, 4));
  const q = Math.floor((Number(String(stamp).slice(5, 7)) - 1) / 3) + 1;
  const goal_id = givenId || `GOAL-${y}Q${q}-${String(goal_seq).padStart(2, "0")}`;

  const dup = await db.prepare("SELECT goal_id FROM research_goal WHERE goal_id = ?").bind(goal_id).first();
  if (dup) throw new Error(`目标已存在：${goal_id}（目标身份跨版本稳定，变更口径请走 saveGoalVersion）`);

  const r = await db
    .prepare(
      `INSERT INTO research_goal (goal_id, goal_seq, current_version_no, goal_status, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(goal_id, goal_seq, 1, goal_status, stamp, created_by)
    .run();
  if (r && r.success === false) throw new Error(r.error || "research_goal 插入失败");

  const version = await saveGoalVersion(db, {
    goal_id,
    ...fields,
    change_note: "首次登记",
    impact_note: "—",
    created_by,
    at: stamp,
    skip_version_check: true,
  });
  return { goal: await getGoal(db, goal_id), version };
}

/** 读目标身份（`MD-01`）。 */
export async function getGoal(db, goal_id) {
  return db.prepare("SELECT * FROM research_goal WHERE goal_id = ?").bind(goal_id).first();
}

/** 目标列表（`MD-01`），按展示序号排序。 */
export async function listGoals(db, { status } = {}) {
  const where = [];
  const args = [];
  if (status !== undefined) { where.push("goal_status = ?"); args.push(status); }
  const sql = `SELECT * FROM research_goal ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY goal_seq`;
  return (await db.prepare(sql).bind(...args).all()).results;
}

/** 某目标的一个版本快照（`MD-02`）。 */
export async function getGoalVersion(db, goal_id, version_no) {
  return db
    .prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = ?")
    .bind(goal_id, Number(version_no))
    .first();
}

/** 某目标的全部版本快照（`MD-02`），新版本在前。 */
export async function listGoalVersions(db, goal_id) {
  return (
    await db
      .prepare("SELECT * FROM research_goal_version WHERE goal_id = ? ORDER BY version_no DESC")
      .bind(goal_id)
      .all()
  ).results;
}

/**
 * 保存六要素为**新版本**（`MD-02`）。
 * **定版式快照**：不触碰任何旧版本行（历史只读），`version_no` 取库内最大值 +1；
 * 新版本 `is_applied=0`（**尚不生效**，须显式「应用配置」）；同步把 `MD-01.current_version_no` 指向它。
 */
export async function saveGoalVersion(db, input = {}) {
  const { goal_id, change_note, impact_note = "—", created_by, at } = input;
  const fields = pickSixElements(input);
  if (!goal_id) throw new Error("saveGoalVersion：goal_id 必填");
  if (!created_by) throw new Error("saveGoalVersion：created_by 必填（本版本保存人）");
  const goal = await getGoal(db, goal_id);
  if (!goal) throw new Error(`目标不存在：${goal_id}`);
  if (!input.skip_version_check && !change_note) {
    throw new Error("saveGoalVersion：change_note 必填（本版本相对上一版本的变更说明；v1 写「首次登记」）");
  }

  const versions = await listGoalVersions(db, goal_id);
  const version_no = versions.reduce((m, v) => Math.max(m, Number(v.version_no) || 0), 0) + 1;
  const goal_version_id = `${goal_id}-v${version_no}`;
  const stamp = at || nowStamp();

  const r = await db
    .prepare(
      `INSERT INTO research_goal_version
       (goal_version_id, goal_id, version_no, business_goal, metric_definition, business_scope,
        focus_period, known_constraints, provider, change_note, impact_note, is_applied, applied_at,
        created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      goal_version_id, goal_id, version_no, fields.business_goal, fields.metric_definition,
      fields.business_scope, fields.focus_period, fields.known_constraints, fields.provider,
      change_note || "—", impact_note, 0, null, stamp, created_by,
    )
    .run();
  if (r && r.success === false) throw new Error(r.error || "research_goal_version 插入失败");

  const u = await db
    .prepare("UPDATE research_goal SET current_version_no = ? WHERE goal_id = ?")
    .bind(version_no, goal_id)
    .run();
  if (u && u.success === false) throw new Error(u.error || "research_goal.current_version_no 更新失败");

  return getGoalVersion(db, goal_id, version_no);
}

/**
 * 应用配置：把某版本置为**当前生效**（`is_applied=1` + `applied_at`），同目标其他版本一律置 0。
 * `MD-02` 的口径是「同一 `goal_id` 至多一行为 1」——DDL 只有普通索引，故**由本函数保证**：
 * 先清零同目标全部版本，再置一，顺序固定、可复现（不改 DDL，不改锁定文件）。
 */
export async function applyGoalVersion(db, { goal_id, version_no, applied_at } = {}) {
  const goal = await getGoal(db, goal_id);
  if (!goal) throw new Error(`目标不存在：${goal_id}`);
  const version = await getGoalVersion(db, goal_id, version_no);
  if (!version) throw new Error(`目标版本不存在：${goal_id} v${version_no}`);

  const cleared = await db
    .prepare("UPDATE research_goal_version SET is_applied = 0, applied_at = NULL WHERE goal_id = ? AND is_applied = 1")
    .bind(goal_id)
    .run();
  if (cleared && cleared.success === false) throw new Error(cleared.error || "旧生效版本清零失败");

  const stamp = applied_at || nowStamp();
  const r = await db
    .prepare("UPDATE research_goal_version SET is_applied = 1, applied_at = ? WHERE goal_id = ? AND version_no = ?")
    .bind(stamp, goal_id, Number(version_no))
    .run();
  if (r && r.success === false) throw new Error(r.error || "生效版本置位失败");

  const applied = await listGoalVersions(db, goal_id);
  return {
    goal_id,
    applied_version_no: Number(version_no),
    applied_at: stamp,
    applied_count: applied.filter((v) => v.is_applied === 1).length,
    version: await getGoalVersion(db, goal_id, version_no),
  };
}

/** 当前生效版本（`is_applied=1`）；尚未应用配置时返回 `null`。 */
export async function getAppliedGoalVersion(db, goal_id) {
  return db
    .prepare("SELECT * FROM research_goal_version WHERE goal_id = ? AND is_applied = 1")
    .bind(goal_id)
    .first();
}

// ---------------------------------------------------------------- MD-03 目标材料

/** 登记目标材料（`MD-03`）。材料是**引用登记**，本表不存内容。 */
export async function registerGoalMaterial(db, input = {}) {
  const { material_id, goal_id, material_name, material_kind, material_at, material_from, registered_at } = input;
  if (!goal_id) throw new Error("registerGoalMaterial：goal_id 必填");
  if (!material_name) throw new Error("registerGoalMaterial：material_name 必填");
  await dictHas(db, "MATERIAL_KIND", material_kind, "material_kind");
  await dictHas(db, "MATERIAL_FROM", material_from, "material_from");
  const goal = await getGoal(db, goal_id);
  if (!goal) throw new Error(`目标不存在：${goal_id}`);

  let id = material_id;
  if (!id) {
    const rows = (await db.prepare("SELECT material_id FROM goal_material").all()).results || [];
    let max = 0;
    for (const r of rows) {
      const m = /^MAT-(\d+)$/.exec(String(r.material_id || "").trim());
      if (m) max = Math.max(max, Number(m[1]));
    }
    id = `MAT-${String(max + 1).padStart(2, "0")}`;
  }
  const r = await db
    .prepare(
      `INSERT INTO goal_material
       (material_id, goal_id, material_name, material_kind, material_at, material_from, is_active, registered_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`,
    )
    .bind(id, goal_id, material_name, material_kind, material_at || "", material_from, registered_at || nowStamp())
    .run();
  if (r && r.success === false) throw new Error(r.error || "goal_material 插入失败");
  return db.prepare("SELECT * FROM goal_material WHERE material_id = ?").bind(id).first();
}

/** 材料列表（`MD-03`）；`includeInactive=false` 时只看仍关联的。 */
export async function listGoalMaterials(db, { goal_id, includeInactive = false } = {}) {
  const where = ["goal_id = ?"];
  const args = [goal_id];
  if (!includeInactive) where.push("is_active = 1");
  return (await db.prepare(`SELECT * FROM goal_material WHERE ${where.join(" AND ")} ORDER BY material_id`).bind(...args).all()).results;
}

/** 移除材料：**逻辑删除**（`is_active=0`），保留历史行，不物理删除。 */
export async function deactivateGoalMaterial(db, material_id) {
  const row = await db.prepare("SELECT * FROM goal_material WHERE material_id = ?").bind(material_id).first();
  if (!row) throw new Error(`材料不存在：${material_id}`);
  const r = await db.prepare("UPDATE goal_material SET is_active = 0 WHERE material_id = ?").bind(material_id).run();
  if (r && r.success === false) throw new Error(r.error || "goal_material 逻辑删除失败");
  return db.prepare("SELECT * FROM goal_material WHERE material_id = ?").bind(material_id).first();
}

// ---------------------------------------------------------------- PD-04 口径待补项

/** 下一个待补项号：`GAP-` + 3 位补零（与 `CFG-05.rule_id` 的 `GAP-1` 形不同，避免混淆）。 */
export async function nextGapId(db) {
  const rows = (await db.prepare("SELECT gap_id FROM goal_gap").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = /^GAP-(\d+)$/.exec(String(r.gap_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `GAP-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 口径检查：按 `CFG-05 gap_rule`（`is_active=1`）逐条对六要素快照做 `match_pattern` 匹配，
 * **不命中的规则**即产生一条 `PD-04` 待补项；已 `is_solved=1` 的规则**不再重复列**（补充后不再提示）；
 * **仍未补充的规则重跑不重复列**——同 goal 同规则已有 `is_solved=0` 的待补项时跳过（`why=open_gap_exists`），
 * 避免每次重跑都再落一批同规则新行（2026-09-21 裁决：去重）。
 * `raised_by_task_id` 必填——`PD-04` 是 NOT NULL 外键，待补项必须归属一次口径检查任务。
 * 返回值里带 `rules_checked` / `alias_fields`（本次用到的别名），让种子的值域偏差**可见**而非被吞掉。
 */
export async function checkGoalGaps(db, { goal_id, goal_version_no, task_id, at } = {}) {
  if (!task_id) {
    throw new Error("checkGoalGaps：task_id 必填（PD-04.raised_by_task_id 为 NOT NULL 外键，待补项须归属一次口径检查任务）");
  }
  const version = await getGoalVersion(db, goal_id, goal_version_no);
  if (!version) throw new Error(`目标版本不存在：${goal_id} v${goal_version_no}`);
  const task = await db.prepare("SELECT task_id FROM task WHERE task_id = ?").bind(task_id).first();
  if (!task) throw new Error(`任务不存在：${task_id}`);

  const rules = (await db.prepare("SELECT * FROM gap_rule WHERE is_active = 1 ORDER BY rule_id").all()).results;
  const solvedRows = (await db.prepare("SELECT rule_id FROM goal_gap WHERE goal_id = ? AND is_solved = 1").bind(goal_id).all()).results;
  const alreadyFilled = new Set(solvedRows.map((r) => r.rule_id));
  const openRows = (await db.prepare("SELECT rule_id FROM goal_gap WHERE goal_id = ? AND is_solved = 0").bind(goal_id).all()).results;
  const openGaps = new Set(openRows.map((r) => r.rule_id));

  const stamp = at || nowStamp();
  const created = [];
  const skipped = [];
  const alias_fields = [];

  for (const rule of rules) {
    const field = normalizeGoalField(rule.target_field);
    if (!field) {
      throw new Error(
        `gap_rule ${rule.rule_id}.target_field='${rule.target_field}' 既不在 dict:GOAL_FIELD 值域、也无别名可归一——` +
        `拒绝静默跳过（否则「规则未生效」会被伪装成「口径已写清」）`,
      );
    }
    if (field !== rule.target_field) alias_fields.push({ rule_id: rule.rule_id, from: rule.target_field, to: field });
    const text = String(version[field] ?? "");
    const hit = new RegExp(rule.match_pattern).test(text);
    if (hit) { skipped.push({ rule_id: rule.rule_id, why: "pattern_hit" }); continue; }
    if (alreadyFilled.has(rule.rule_id)) { skipped.push({ rule_id: rule.rule_id, why: "already_solved" }); continue; }
    if (openGaps.has(rule.rule_id)) { skipped.push({ rule_id: rule.rule_id, why: "open_gap_exists" }); continue; }

    const gap_id = await nextGapId(db);
    const r = await db
      .prepare(
        `INSERT INTO goal_gap
         (gap_id, goal_id, goal_version_no, rule_id, target_field, gap_text, impact_note,
          raised_at, raised_by_task_id, filled_value, filled_at, filled_by, is_solved)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, 0)`,
      )
      .bind(gap_id, goal_id, Number(goal_version_no), rule.rule_id, field, rule.gap_text, rule.impact_note, stamp, task_id)
      .run();
    if (r && r.success === false) throw new Error(r.error || "goal_gap 插入失败");
    created.push(await db.prepare("SELECT * FROM goal_gap WHERE gap_id = ?").bind(gap_id).first());
  }

  return { goal_id, goal_version_no: Number(goal_version_no), task_id, rules_checked: rules.length, gaps: created, skipped, alias_fields };
}

/** 待补项回查（`PD-04`）。`unsolvedOnly=true` 时只列未补充的。 */
export async function listGoalGaps(db, { goal_id, unsolvedOnly = false } = {}) {
  const where = ["goal_id = ?"];
  const args = [goal_id];
  if (unsolvedOnly) where.push("is_solved = 0");
  return (await db.prepare(`SELECT * FROM goal_gap WHERE ${where.join(" AND ")} ORDER BY gap_id`).bind(...args).all()).results;
}

/**
 * 补充待补项：写 `filled_*` + `is_solved=1`，并把补充内容**并入对应六要素字段、形成目标新版本**
 * （`PD-04` 口径：「补充后并入对应六要素字段并形成目标新版本」）。
 * 并入规则：原字段为空串时直接用补充值；原字段非空时**追加**（`原值；补充值`），**不覆盖业务方已写的内容**。
 */
export async function fillGoalGap(db, { gap_id, filled_value, filled_by, at, change_note } = {}) {
  const gap = await db.prepare("SELECT * FROM goal_gap WHERE gap_id = ?").bind(gap_id).first();
  if (!gap) throw new Error(`待补项不存在：${gap_id}`);
  if (gap.is_solved === 1) throw new Error(`待补项已补充：${gap_id}（补充后不再重复列出，重复提交不产生新版本）`);
  if (!String(filled_value ?? "").trim()) throw new Error("fillGoalGap：filled_value 必填（业务方补充的确认内容）");
  if (!filled_by) throw new Error("fillGoalGap：filled_by 必填（补充人）");

  const stamp = at || nowStamp();
  const r = await db
    .prepare("UPDATE goal_gap SET filled_value = ?, filled_at = ?, filled_by = ?, is_solved = 1 WHERE gap_id = ?")
    .bind(String(filled_value), stamp, filled_by, gap_id)
    .run();
  if (r && r.success === false) throw new Error(r.error || "goal_gap 补充失败");

  const goal = await getGoal(db, gap.goal_id);
  const base = await getGoalVersion(db, gap.goal_id, goal.current_version_no);
  const merged = {};
  for (const f of GOAL_FIELDS) merged[f] = base[f];
  const before = String(merged[gap.target_field] ?? "");
  merged[gap.target_field] = before ? `${before}；${String(filled_value)}` : String(filled_value);

  const version = await saveGoalVersion(db, {
    goal_id: gap.goal_id,
    ...merged,
    change_note: change_note || `补充口径（${gap.gap_id}）：${gap.gap_text}`,
    impact_note: `补充自 ${gap.gap_id}；发现于 v${gap.goal_version_no}`,
    created_by: filled_by,
    at: stamp,
  });

  return {
    gap: await db.prepare("SELECT * FROM goal_gap WHERE gap_id = ?").bind(gap_id).first(),
    version,
    merged_field: gap.target_field,
  };
}

// ---------------------------------------------------------------- 口径检查任务（F-01 的任务侧）

/**
 * 执行一次口径检查任务：建 `goal_check` 任务（2 步）→ 跑检查 → 落 `PD-04` → 任务置 `done`。
 * 原型口径：「每次保存六要素执行一次口径检查任务，有缺失才展示待补任务」——**任务本身总是留痕**，
 * 有没有待补项由 `gaps` 是否为空表达（不是靠不建任务）。
 */
export async function runGoalCheckTask(db, {
  goal_id, goal_version_no, created_by, at, enqueue,
} = {}) {
  const goal = await getGoal(db, goal_id);
  if (!goal) throw new Error(`目标不存在：${goal_id}`);
  const stamp = at || nowStamp();

  const task = await createTask(db, {
    task_type: "goal_check",
    goal_id,
    goal_version_no,
    trigger_basis: `目标配置页「保存为新版本」提交执行（目标 ${goal_id} v${goal_version_no}）`,
    agent_profile_id: null,
    // 口径检查不用 Agent——但 PD-01 该列为 NOT NULL，故显式写明「能力来自 CFG-05 规则」而非留空。
    agent_version_snapshot: "n/a（口径检查＝确定性程序；规则来自 CFG-05 gap_rule）",
    task_status: "running",
    started_at: stamp,
  });
  await planTaskSteps(db, task.task_id, "goal_check");
  await advanceStep(db, { task_id: task.task_id, step_no: 1, step_state: "active" });
  if (typeof enqueue === "function") await enqueue({ task_id: task.task_id, step_no: 1 });

  const check = await checkGoalGaps(db, { goal_id, goal_version_no, task_id: task.task_id, at: stamp });

  await advanceStep(db, { task_id: task.task_id, step_no: 1, step_state: "done" });
  if (typeof enqueue === "function") await enqueue({ task_id: task.task_id, step_no: 2 });
  await advanceStep(db, { task_id: task.task_id, step_no: 2, step_state: "active" });
  await appendDonePart(
    db,
    task.task_id,
    check.gaps.length
      ? `已按 ${check.rules_checked} 条规则校验 v${goal_version_no} 六要素；发现 ${check.gaps.length} 项口径待补（${check.gaps.map((g) => g.gap_id).join("、")}）`
      : `已按 ${check.rules_checked} 条规则校验 v${goal_version_no} 六要素；未发现待补项，口径已锁定`,
  );
  await advanceStep(db, { task_id: task.task_id, step_no: 2, step_state: "done" });
  const done = await setTaskStatus(db, task.task_id, "done", { ended_at: stamp });

  return { task: done, check, gaps: check.gaps, all_gaps: await listGoalGaps(db, { goal_id, unsolvedOnly: true }) };
}

// ---------------------------------------------------------------- 读模型

/** 目标一页读取（F-27 消费）：身份 + 当前版本 + 版本历史 + 材料 + 未补待补项 + 生效版本。 */
export async function getGoalRecord(db, goal_id) {
  const goal = await getGoal(db, goal_id);
  if (!goal) throw new Error(`目标不存在：${goal_id}`);
  const versions = await listGoalVersions(db, goal_id);
  return {
    goal,
    current_version: versions.find((v) => Number(v.version_no) === Number(goal.current_version_no)) || null,
    applied_version: versions.find((v) => v.is_applied === 1) || null,
    versions,
    materials: await listGoalMaterials(db, { goal_id, includeInactive: true }),
    open_gaps: await listGoalGaps(db, { goal_id, unsolvedOnly: true }),
    tasks: (await db.prepare("SELECT * FROM task WHERE goal_id = ? ORDER BY task_id").bind(goal_id).all()).results,
  };
}
