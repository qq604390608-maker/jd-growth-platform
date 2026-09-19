#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · F-10 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M2.md`（TC-D-M2-003 / 004 / 005 / 012 / 014 = F-10 验收 oracle）
 *   ｜ `../../docs/02-prd/PRD-M2-共享上下文.md` F-10（验收要点：机会选择取决于证据与相关性；
 *        暂不研究的机会仍保留记录，条件变化或新证据后可再选）
 *   ｜ `../../docs/07-decisions/ADR-003-机会六要素必填与未知项二态.md`（§3 六要素清单与判定式；
 *        §3.1 两件套约束 `NOT NULL` + `CHECK`；§3.2 `unknown_item` 未加库级 CHECK → 应用层拒）
 *   ｜ `../../docs/03-locks/schema.md` MD-06（L244-265：六要素 NOT NULL + CHECK、`unknown_item` 二态）、
 *        PD-05（L470-483 状态日志）、LNK-01（L632-645 复合 UK）、LNK-03（L660-672 复合 UK）、§11 应用层校验（自环）
 *   ｜ `../../db/migrations/0001_init.sql` L206-227（MD-06）/ L354-363（PD-05）/ L387-404（LNK-01）/ L406-414（LNK-03）
 *   ｜ `../../db/seed/0001_mock.sql`（MD-06 8 条 / PD-05 4 条 / LNK-01 10 条 / LNK-03 2 条）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-10 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构与语义，不断言 38.2% / 52 万等 demo 值）。
 * 标注：`goal_version_no` 是数值列（`CHECK (goal_version_no >= 1)`），**空串对它无意义**——
 *   故 TC-D-M2-004 的「空串拒」在**五个文本六要素字段**上验（`goal_id` 除外：它同时是 FK，
 *   本执行器另以 `target_object` / `phenomenon` / `initial_basis_note` / `research_reason` + `goal_id` 全覆盖），
 *   `goal_version_no` 另以数值边界（`0`）验其 CHECK。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f10.mjs`）。
 *
 * 用法：node server/shared-context/test-f10.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createOpportunity,
  getOpportunity,
  listOpportunities,
  assessOpportunitySixElements,
  classifyUnknownItem,
  changeOpportunityStatus,
  logOpportunityStatus,
  listOpportunityStatusLog,
  linkOpportunityRelation,
  listOpportunityRelations,
  getOpportunityRecord,
  linkOpportunityEvidence,
  OPPORTUNITY_SIX_ELEMENTS,
  UNKNOWN_ITEM_STATES,
} from "./index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);

/** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      const r = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
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

/**
 * 建库。`seed=true` 时载入真实 mock 种子。
 * 种子文件自带 `PRAGMA foreign_keys = ON`——载入前剥离该 pragma（避开插入顺序依赖），
 * 载入后开 FK 跑 `foreign_key_check` 单独验完整性。
 */
function freshDb({ seed = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  if (seed) {
    const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
    sqlite.exec(mock);
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

function assert(cond, msg) {
  if (!cond) throw new Error("断言失败：" + msg);
}
async function expectThrow(fn, re) {
  let threw = false;
  let msg = "";
  try {
    await fn();
  } catch (e) {
    threw = true;
    msg = e?.message || String(e);
  }
  if (!threw) throw new Error("期望被拒绝，但操作成功");
  if (re && !re.test(msg)) throw new Error(`拒绝原因不符（期望 ${re}）：${msg}`);
}

/** 构造一条合法、六要素齐备、`unknown_item=''`（已评估且确无）的机会输入。 */
function validOpportunity(over = {}) {
  return {
    opportunity_id: "OPP-T9001",
    goal_id: "GOAL-2026Q3-01", // 种子：MD-01 目标
    goal_version_no: 3, // 种子：该目标当前版本
    opportunity_title: "探针机会：六要素齐备",
    opportunity_status: "candidate",
    target_object: "人群：探针人群 ｜ 旅程环节：首单后 ~ 复购前",
    phenomenon: "探针现象：只写观察到的事实，不下结论",
    initial_basis_note: "探针初步依据：资料或查询的来源与时点（文字说明）",
    research_reason: "探针研究理由：为什么这个问题值得追问",
    unknown_item: "", // 二态之一：已评估且确无未知项（计入齐全）
    ...over,
  };
}

/** 绕过模块、直接按 DDL 列写库——用于验**库级**约束（NOT NULL / CHECK / UNIQUE）。 */
const OPP_COLS = [
  "opportunity_id",
  "goal_id",
  "goal_version_no",
  "opportunity_title",
  "opportunity_status",
  "target_object",
  "phenomenon",
  "initial_basis_note",
  "research_reason",
  "unknown_item",
  "defer_reason",
  "producing_task_id",
  "created_at",
];
function rawInsertOpportunity(db, over = {}) {
  const row = {
    opportunity_id: "OPP-T9002",
    goal_id: "GOAL-2026Q3-01",
    goal_version_no: 3,
    opportunity_title: "探针（裸插）",
    opportunity_status: "candidate",
    target_object: "探针对象",
    phenomenon: "探针现象",
    initial_basis_note: "探针依据",
    research_reason: "探针理由",
    unknown_item: null,
    defer_reason: null,
    producing_task_id: null,
    created_at: "2026-09-19 12:00",
    ...over,
  };
  const vals = OPP_COLS.map((c) => row[c]);
  return db
    .prepare(`INSERT INTO opportunity (${OPP_COLS.join(", ")}) VALUES (${OPP_COLS.map(() => "?").join(", ")})`)
    .bind(...vals)
    .run();
}

const results = [];
async function check(id, desc, fn) {
  try {
    await fn();
    results.push({ id, desc, ok: true, msg: "" });
  } catch (e) {
    results.push({ id, desc, ok: false, msg: e?.message || String(e) });
  }
}

/* ---------------- TC-D-M2-003（F-10 · 六要素任一 NULL → NOT NULL 拒） ---------------- */

await check("TC-D-M2-003", "F-10 六要素逐字段置 NULL → 库级 NOT NULL 拒绝（6 字段全覆盖）", async () => {
  assert(OPPORTUNITY_SIX_ELEMENTS.length === 6, "六要素应为 6 个字段（对应目标占 goal_id + goal_version_no 两列）");
  for (const f of OPPORTUNITY_SIX_ELEMENTS) {
    const { db } = freshDb();
    await expectThrow(() => rawInsertOpportunity(db, { [f]: null }), /NOT NULL|constraint/i);
  }
});

await check("TC-D-M2-003", "F-10 六要素 NULL 反例：被拒后机会表不应留行（脏数据不入库）", async () => {
  const { db } = freshDb({ seed: true });
  const before = (await listOpportunities(db)).length;
  for (const f of OPPORTUNITY_SIX_ELEMENTS) {
    await expectThrow(() => rawInsertOpportunity(db, { [f]: null }), /NOT NULL|constraint/i);
  }
  assert((await listOpportunities(db)).length === before, "六要素不齐不得落库");
});

/* ---------------- TC-D-M2-004（F-10 · 六要素任一 '' → CHECK 拒） ---------------- */

await check("TC-D-M2-004", "F-10 五个文本六要素字段置空串 '' → 库级 CHECK(length(trim(x))>0) 拒绝", async () => {
  const textElements = ["goal_id", "target_object", "phenomenon", "initial_basis_note", "research_reason"];
  for (const f of textElements) {
    const { db } = freshDb();
    await expectThrow(() => rawInsertOpportunity(db, { [f]: "" }), /CHECK|constraint/i);
  }
});

await check("TC-D-M2-004", "F-10 纯空白串 '   ' 亦被 CHECK(length(trim(x))>0) 拒（trim 后为空）", async () => {
  for (const f of ["target_object", "phenomenon", "initial_basis_note", "research_reason"]) {
    const { db } = freshDb();
    await expectThrow(() => rawInsertOpportunity(db, { [f]: "   " }), /CHECK|constraint/i);
  }
});

await check("TC-D-M2-004", "F-10 goal_version_no 是数值列：CHECK(>=1) 拒 0 与负数（空串对其无意义）", async () => {
  for (const bad of [0, -1]) {
    const { db } = freshDb();
    await expectThrow(() => rawInsertOpportunity(db, { goal_version_no: bad }), /CHECK|constraint/i);
  }
  const { db } = freshDb();
  await rawInsertOpportunity(db, { goal_version_no: 1 });
  assert((await getOpportunity(db, "OPP-T9002")) !== null, "合法版本号 1 应可落库");
});

await check("TC-D-M2-004", "F-10 方言兜底：goal_version_no='' 库级不拦（类型序 TEXT > INTEGER），应用层按「缺六要素」拒", async () => {
  const { db } = freshDb();
  // 库级：'' >= 1 在 SQLite 类型序下求值为 TRUE → 数值列空串被放行（实测）
  await rawInsertOpportunity(db, { goal_version_no: "" });
  assert((await getOpportunity(db, "OPP-T9002")) !== null, "库级确未拦数值列空串（故应用层须兜底）");
  // 应用层：assessOpportunitySixElements 以 trim()==='' 判缺失 → 拒
  const { db: db2 } = freshDb();
  await expectThrow(() => createOpportunity(db2, validOpportunity({ goal_version_no: "" })), /六要素不齐/);
});

await check("TC-D-M2-004", "F-10 正例：六要素齐备 + unknown_item='' 经模块 createOpportunity 落库", async () => {
  const { db } = freshDb({ seed: true });
  await createOpportunity(db, validOpportunity());
  const opp = await getOpportunity(db, "OPP-T9001");
  assert(opp !== null, "六要素齐备应可落库");
  assert(opp.unknown_item === "", "unknown_item='' 应原样保存（已评估且确无）");
});

/* ---------------- TC-D-M2-005（F-10 · unknown_item 二态） ---------------- */

await check("TC-D-M2-005", "F-10 二态分类（纯函数）：NULL=未评估 / ''=确无 / 文本=有未知项 / '   '=非法", async () => {
  assert(classifyUnknownItem(undefined) === UNKNOWN_ITEM_STATES.NOT_ASSESSED, "undefined → 未评估");
  assert(classifyUnknownItem(null) === UNKNOWN_ITEM_STATES.NOT_ASSESSED, "NULL → 未评估");
  assert(classifyUnknownItem("") === UNKNOWN_ITEM_STATES.NONE_CONFIRMED, "'' → 已评估且确无");
  assert(classifyUnknownItem("可能转移到其他频道") === UNKNOWN_ITEM_STATES.HAS_UNKNOWN, "文本 → 有未知项");
  assert(classifyUnknownItem("   ") === UNKNOWN_ITEM_STATES.INVALID_BLANK, "'   ' → 非法（应用层须拒）");
});

await check("TC-D-M2-005", "F-10 齐全判定：unknown_item IS NULL → 不齐且触发待补；''/文本 → 计入齐全", async () => {
  const notAssessed = assessOpportunitySixElements(validOpportunity({ unknown_item: null }));
  assert(notAssessed.six_elements_present === true, "六字段本身齐备");
  assert(notAssessed.six_elements_complete === false, "unknown_item IS NULL → 判定为不齐");
  assert(notAssessed.pending_supplement === true, "unknown_item IS NULL → 触发待补");

  const noneConfirmed = assessOpportunitySixElements(validOpportunity({ unknown_item: "" }));
  assert(noneConfirmed.six_elements_complete === true, "'' → 计入齐全");
  assert(noneConfirmed.pending_supplement === false, "'' → 不触发待补");

  const hasUnknown = assessOpportunitySixElements(validOpportunity({ unknown_item: "是否转移到站外未确认" }));
  assert(hasUnknown.six_elements_complete === true, "有未知项 → 已评估，计入齐全");
  assert(hasUnknown.pending_supplement === false, "有未知项 → 不触发待补");

  const blank = assessOpportunitySixElements(validOpportunity({ unknown_item: "   " }));
  assert(blank.unknown_item_valid === false, "'   ' 应判为非法（不可入库）");
});

await check("TC-D-M2-005", "F-10 反例：unknown_item='   ' —— 库级 CHECK 不拦（本表未加二态 CHECK，见 ADR-003 §3.2）", async () => {
  const { db } = freshDb();
  // 裸插：库级放行，证明「须应用层拒绝」是必需的一道
  await rawInsertOpportunity(db, { unknown_item: "   " });
  const opp = await getOpportunity(db, "OPP-T9002");
  assert(opp !== null && opp.unknown_item === "   ", "库级确未拦纯空白串（故应用层必须拒）");
});

await check("TC-D-M2-005", "F-10 反例：unknown_item='   ' —— 应用层 createOpportunity 拒绝，不落库", async () => {
  const { db } = freshDb({ seed: true });
  const before = (await listOpportunities(db)).length;
  await expectThrow(() => createOpportunity(db, validOpportunity({ unknown_item: "   " })), /未知项|空白/);
  assert((await listOpportunities(db)).length === before, "应用层拒绝后不得落库");
});

await check("TC-D-M2-005", "F-10 种子里 8 条机会的 unknown_item 均为「有未知项」一态（原型只覆盖一态，ADR-003 事实三）", async () => {
  const { db } = freshDb({ seed: true });
  const rows = await listOpportunities(db);
  assert(rows.length === 8, `种子应有 8 条机会，实得 ${rows.length}`);
  for (const r of rows) {
    assert(
      classifyUnknownItem(r.unknown_item) === UNKNOWN_ITEM_STATES.HAS_UNKNOWN,
      `${r.opportunity_id} 的 unknown_item 应为有未知项一态`
    );
  }
  // 两种「已评估」态在种子里均未出现 → 待补清单为空
  const pending = await listOpportunities(db, { pendingSupplementOnly: true });
  assert(pending.length === 0, "种子无「未评估」机会，待补清单应为空");
});

/* ---------------- TC-D-M2-012（F-10 · LNK-01 复合 UK） ---------------- */

await check("TC-D-M2-012", "F-10 反例：LNK-01 重复 (opportunity_id, evidence_id, link_kind) → 复合 UK 拒绝", async () => {
  const { db } = freshDb({ seed: true });
  // 种子已有 (OPP-014, EV-1041, initial_basis)；换 link_id 但三元组相同 → 应被拒
  await expectThrow(
    () =>
      db
        .prepare(
          `INSERT INTO opportunity_evidence (link_id, opportunity_id, evidence_id, link_kind, linked_at)
           VALUES (?, ?, ?, ?, ?)`
        )
        .bind("LK-OE-DUP", "OPP-014", "EV-1041", "initial_basis", "2026-09-19 12:00")
        .run(),
    /UNIQUE|constraint/i
  );
});

await check("TC-D-M2-012", "F-10 正例：同机会同证据换 link_kind（initial_basis → related_update）应允许", async () => {
  const { db } = freshDb({ seed: true });
  await linkOpportunityEvidence(db, {
    link_id: "LK-OE-NEW",
    opportunity_id: "OPP-014",
    evidence_id: "EV-1041",
    link_kind: "related_update",
  });
  const n = (
    await db.prepare("SELECT COUNT(*) AS c FROM opportunity_evidence WHERE opportunity_id='OPP-014'").first()
  ).c;
  assert(n === 2, `换 link_kind 应新增一行（OPP-014 由 1 行变 2 行），实得 ${n}`);
});

/* ---------------- TC-D-M2-014（F-10 · LNK-03 自环 + 复合 UK） ---------------- */

await check("TC-D-M2-014", "F-10 反例：LNK-03 自环（from == to）→ 应用层拒绝（schema §11）", async () => {
  const { db } = freshDb({ seed: true });
  for (const kind of ["same_issue", "superseded"]) {
    await expectThrow(
      () =>
        linkOpportunityRelation(db, {
          relation_id: "LK-OR-SELF",
          from_opportunity_id: "OPP-014",
          to_opportunity_id: "OPP-014",
          relation_kind: kind,
        }),
      /自环/
    );
  }
  const n = (await db.prepare("SELECT COUNT(*) AS c FROM opportunity_relation").first()).c;
  assert(n === 2, `自环被拒后关系表应保持种子的 2 条，实得 ${n}`);
});

await check("TC-D-M2-014", "F-10 反例：LNK-03 重复 (from, to, relation_kind) → 复合 UK 拒绝", async () => {
  const { db } = freshDb({ seed: true });
  // 种子已有 (OPP-009, OPP-013, same_issue) = LK-OR-002
  await expectThrow(
    () =>
      linkOpportunityRelation(db, {
        relation_id: "LK-OR-DUP",
        from_opportunity_id: "OPP-009",
        to_opportunity_id: "OPP-013",
        relation_kind: "same_issue",
      }),
    /UNIQUE|constraint/i
  );
});

await check("TC-D-M2-014", "F-10 正例：同 from/to 换 relation_kind（same_issue → superseded）应允许", async () => {
  const { db } = freshDb({ seed: true });
  await linkOpportunityRelation(db, {
    relation_id: "LK-OR-NEW",
    from_opportunity_id: "OPP-009",
    to_opportunity_id: "OPP-013",
    relation_kind: "superseded",
  });
  const rels = await listOpportunityRelations(db, { opportunity_id: "OPP-009" });
  const kinds = rels.map((r) => r.relation_kind);
  assert(rels.length === 3, `OPP-009 相关关系应为 3 条，实得 ${rels.length}`);
  assert(kinds.includes("same_issue") && kinds.includes("superseded"), "同 from/to 的两种关系语义应并存可辨");
  assert(kinds.filter((k) => k === "same_issue").length === 1, "原 same_issue 关系应仍在（不覆盖）");
});

/* ---------------- F-10 PRD 验收（非 oracle 用例，回指 PRD-M2 F-10 验收要点） ---------------- */

await check("F-10(PRD)", "F-10 暂不研究的机会仍保留记录：deferred → candidate 后行不删、defer_reason 清空、状态链留痕", async () => {
  const { db } = freshDb({ seed: true });
  const before = await getOpportunity(db, "OPP-011");
  assert(before.opportunity_status === "deferred", "起点：OPP-011 应为 deferred（种子）");
  assert(before.defer_reason, "起点：deferred 机会应带 defer_reason");
  const totalBefore = (await listOpportunities(db)).length;

  await changeOpportunityStatus(db, {
    opportunity_id: "OPP-011",
    to_status: "candidate",
    change_reason: "探针：条件变化，重新纳入候选",
    changed_by: "probe",
  });

  const after = await getOpportunity(db, "OPP-011");
  assert(after !== null, "状态变更后机会记录应保留（不删除）");
  assert((await listOpportunities(db)).length === totalBefore, "机会总数不变（记录保留）");
  assert(after.opportunity_status === "candidate", "状态应已更新");
  assert(after.defer_reason === null, "非 deferred 状态应清空 defer_reason（仅 deferred 时填写）");

  const log = await listOpportunityStatusLog(db, "OPP-011");
  const last = log[log.length - 1];
  assert(log.length >= 2, "状态链应新增一条（种子 LG-001 + 本次）");
  assert(last.from_status === "deferred" && last.to_status === "candidate", "日志应记 from→to");
  assert(last.changed_by === "probe" && last.change_reason.includes("条件变化"), "日志应记变更人与原因");
});

await check("F-10(PRD)", "F-10 首次登记状态链：from_status 为空（schema PD-05「首次为空」）", async () => {
  const { db } = freshDb({ seed: true });
  await logOpportunityStatus(db, {
    log_id: "LG-T9001",
    opportunity_id: "OPP-014",
    to_status: "candidate",
    change_reason: "探针：首次登记",
    changed_by: "probe",
  });
  const log = await listOpportunityStatusLog(db, "OPP-014");
  assert(log.length === 1 && log[0].from_status === null, "首次登记 from_status 应为空");
});

await check("F-10(PRD)", "F-10 读模型：机会本体 + 六要素判定 + 状态链 + 关系 + 证据关联", async () => {
  const { db } = freshDb({ seed: true });
  const rec = await getOpportunityRecord(db, "OPP-014");
  assert(rec !== null, "应能取到机会读模型");
  assert(rec.assessment.six_elements_present === true, "种子机会六字段应齐备");
  assert(rec.assessment.unknown_state === UNKNOWN_ITEM_STATES.HAS_UNKNOWN, "种子机会为「有未知项」态");
  assert(rec.status_log.length === 0, "OPP-014 种子无状态日志（首登即 candidate）");
  assert(rec.relations.length === 1, "OPP-014 有 1 条机会关系（种子）");
  assert(rec.evidences.length === 1, "OPP-014 有 1 条证据关联（种子）");
  assert((await getOpportunityRecord(db, "OPP-NOPE")) === null, "不存在的机会应返回 null");
});

/* ---------------- 汇总 ---------------- */
let failed = 0;
for (const r of results) {
  const tag = r.ok ? "PASS" : "FAIL";
  if (!r.ok) failed++;
  console.log(`  [${tag}] ${r.id} — ${r.desc}${r.ok ? "" : "\n         ↳ " + r.msg}`);
}
console.log(
  failed === 0
    ? `VERIFY PASS: F-10 用例全绿（${results.length} 条断言组：六要素 NOT NULL + CHECK 拒空串 + unknown_item 二态 + LNK-01/LNK-03 复合 UK + 自环应用层拒 + 状态链留痕）`
    : `VERIFY FAIL: ${failed}/${results.length} 组失败`
);
process.exit(failed === 0 ? 0 : 1);
