#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · F-07 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M2.md`（TC-D-M2-001 / TC-D-M2-002 = F-07 验收 oracle）
 *   ｜ `../../db/migrations/0001_init.sql`（表结构唯一真源，本文件载入其真实 DDL 跑约束）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入真实迁移 DDL，实跑 F-07 两条用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f07.mjs`）。
 *
 * 用法：node server/shared-context/test-f07.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createBusinessContext,
  listBusinessContext,
  createTouchpoint,
  listTouchpoints,
  getBackgroundBriefing,
} from "./index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);

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

function freshDb() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec("PRAGMA foreign_keys = ON;");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
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

const results = [];
async function check(id, desc, fn) {
  try {
    await fn();
    results.push({ id, desc, ok: true, msg: "" });
  } catch (e) {
    results.push({ id, desc, ok: false, msg: e?.message || String(e) });
  }
}

/* ---------------- TC-D-M2-001（F-07 · MD-04 business_context） ---------------- */

await check("TC-D-M2-001", "F-07 MD-04：平台级 goal_id=NULL 允许写入并回查", async () => {
  const { db } = freshDb();
  await createBusinessContext(db, {
    context_id: "CTX-001",
    goal_id: undefined, // 平台级：不挂目标
    context_kind: "BUSINESS_KNOWLEDGE",
    title: "超市频道背景",
    content: "只做京东超市单一频道",
    source_ref: "业务方材料 M-01",
  });
  const rows = await listBusinessContext(db, { goal_id: null });
  assert(rows.length === 1, "平台级背景应可写入并按 goal_id IS NULL 查到");
  assert(rows[0].goal_id === null, "平台级背景 goal_id 应为 NULL");
});

await check("TC-D-M2-001", "F-07 MD-04：挂有效 goal_id 可写入（FK 通过）", async () => {
  const { sqlite, db } = freshDb();
  sqlite
    .prepare(
      "INSERT INTO research_goal (goal_id, goal_seq, current_version_no, goal_status, created_at, created_by) VALUES (?,?,?,?,?,?)"
    )
    .run("GOAL-2026Q3-01", 1, 1, "ACTIVE", "2026-09-19 10:00", "tester");
  await createBusinessContext(db, {
    context_id: "CTX-002",
    goal_id: "GOAL-2026Q3-01",
    context_kind: "BUSINESS_CONSTRAINT",
    title: "品类边界",
    content: "品类限粮油调味、乳品烘焙",
    source_ref: "业务方材料 M-02",
  });
  const rows = await listBusinessContext(db, { goal_id: "GOAL-2026Q3-01" });
  assert(rows.length === 1, "挂有效 goal_id 的背景应可查到");
});

await check("TC-D-M2-001", "F-07 MD-04：不存在 goal_id → 库级外键拒绝（反例）", async () => {
  const { db } = freshDb();
  await expectThrow(
    () =>
      createBusinessContext(db, {
        context_id: "CTX-003",
        goal_id: "GOAL-NOPE",
        context_kind: "BUSINESS_KNOWLEDGE",
        title: "x",
        content: "y",
        source_ref: "z",
      }),
    /FOREIGN KEY|constraint/i
  );
});

/* ---------------- TC-D-M2-002（F-07 · MD-05 touchpoint） ---------------- */

await check("TC-D-M2-002", "F-07 MD-05：重复 touchpoint_name → UNIQUE 拒绝（反例）", async () => {
  const { db } = freshDb();
  await createTouchpoint(db, {
    touchpoint_id: "TP-001",
    touchpoint_name: "首页推荐位",
    channel: "京东超市频道",
    position_desc: "首页首屏推荐位",
  });
  await expectThrow(
    () =>
      createTouchpoint(db, {
        touchpoint_id: "TP-002",
        touchpoint_name: "首页推荐位", // 重复名称
        channel: "京东超市频道",
        position_desc: "另一处位置",
      }),
    /UNIQUE|constraint/i
  );
  const tps = await listTouchpoints(db, {});
  assert(tps.length === 1, "重复触点应仅保留第一条");
});

/* ---------------- F-07 验收：背景简报（确定性可复现） ---------------- */

await check("F-07-定向", "F-07 验收：背景简报返回背景条目 + 触点清单，且确定性可复现", async () => {
  const { db } = freshDb();
  await createBusinessContext(db, {
    context_id: "CTX-010",
    context_kind: "BUSINESS_KNOWLEDGE",
    title: "增长框架",
    content: "找信息→找问题→拆旅程",
    source_ref: "内部方法论",
  });
  await createTouchpoint(db, {
    touchpoint_id: "TP-010",
    touchpoint_name: "搜索结果页",
    channel: "京东超市频道",
    position_desc: "搜索结果列表",
  });
  const a = await getBackgroundBriefing(db, { goal_id: null });
  const b = await getBackgroundBriefing(db, { goal_id: null });
  assert(a.business_contexts.length === 1 && a.touchpoints.length === 1, "简报应含 1 背景 + 1 触点");
  assert(JSON.stringify(a) === JSON.stringify(b), "同输入两次读取应完全一致（确定性）");
  assert(a.directions.length === 1, "应给出「该往哪个方向查」的方向摘要");
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
    ? `VERIFY PASS: F-07 用例全绿（${results.length} 条断言组，MD-04/MD-05 约束 + 背景简报确定性）`
    : `VERIFY FAIL: ${failed}/${results.length} 组失败`
);
process.exit(failed === 0 ? 0 : 1);
