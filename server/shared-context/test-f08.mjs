#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · F-08 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M2.md`（TC-D-M2-010 + TC-I-M2-003 = F-08 验收 oracle）
 *   ｜ `../../docs/03-locks/schema.md`（CFG-01 字段/值域：PK source_id、dict:SOURCE_STATUS）
 *   ｜ `../../docs/03-locks/external-deps.md` §2（五系统 can/cannot/status）
 *   ｜ `../../db/migrations/0001_init.sql` L36-46（真实 DDL，本文件载入跑约束）
 *   ｜ `../../db/seed/0001_mock.sql`（CFG-01 五来源种子，用于「种子齐全」正例）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-08 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构与语义，不断言 3.2 万行等基准 v1 自拟值）。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f08.mjs`）。
 *
 * 用法：node server/shared-context/test-f08.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  registerSource,
  updateSourceCapability,
  listSources,
  getSource,
  getSourceGaps,
  getSourceToolBriefing,
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
 * 建库。`seed=true` 时载入真实 mock 种子（用于「5 来源种子齐全」正例）。
 * 种子文件自带 `PRAGMA foreign_keys = ON`——为在 FK-off 下完成整包载入（避开插入顺序依赖），
 * 载入前剥离该 pragma，载入后开 FK 跑 `foreign_key_check` 单独验完整性。
 */
function freshDb({ seed = false } = {}) {
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

const results = [];
async function check(id, desc, fn) {
  try {
    await fn();
    results.push({ id, desc, ok: true, msg: "" });
  } catch (e) {
    results.push({ id, desc, ok: false, msg: e?.message || String(e) });
  }
}

/* ---------------- TC-D-M2-010（F-08 · CFG-01 source_registry） ---------------- */

await check("TC-D-M2-010", "F-08 CFG-01 正例：5 来源（CDP/HJE/PIM/MKT/ACT）种子齐全", async () => {
  const { db, sqlite } = freshDb({ seed: true });
  const rows = await listSources(db);
  const ids = rows.map((r) => r.source_id).sort();
  assert(
    JSON.stringify(ids) === JSON.stringify(["ACT", "CDP", "HJE", "MKT", "PIM"]),
    `五来源应齐全，实得 ${JSON.stringify(ids)}`
  );
  // 种子完整性（FK 零违例）
  assert(sqlite.prepare("PRAGMA foreign_key_check").all().length === 0, "种子应无外键违例");
  // 结构断言（不断言 demo 数值）
  for (const r of rows) {
    assert(typeof r.capability_can === "string" && r.capability_can.length > 0, `${r.source_id} 应有 capability_can`);
    assert(
      typeof r.capability_cannot === "string" && r.capability_cannot.length > 0,
      `${r.source_id} 应有 capability_cannot（缺口来源）`
    );
    assert(["ok", "degraded", "unauthorized"].includes(r.availability_status), `${r.source_id} 状态应在 dict:SOURCE_STATUS`);
  }
});

await check("TC-D-M2-010", "F-08 CFG-01 反①：source_id=NULL → 库级 NOT NULL 拒绝", async () => {
  const { sqlite } = freshDb();
  await expectThrow(
    () =>
      sqlite
        .prepare(
          "INSERT INTO source_registry (source_id, source_name, capability_can, capability_cannot, availability_status, is_mcp_ready, registered_at, updated_at) VALUES (?,?,?,?,?,?,?,?)"
        )
        .run(null, "无名", "a", "b", "ok", 0, "2026-09-19 10:00", "2026-09-19 10:00"),
    /NOT NULL|constraint/i
  );
});

await check("TC-D-M2-010", "F-08 CFG-01 反②：重复 source_id → 库级 PK 拒绝", async () => {
  const { db } = freshDb();
  const src = {
    source_id: "CDP",
    source_name: "CDP 用户标签系统",
    capability_can: "人群圈选",
    capability_cannot: "完整用户行为序列",
    availability_status: "ok",
  };
  await registerSource(db, src);
  await expectThrow(() => registerSource(db, src), /UNIQUE|PRIMARY KEY|constraint/i);
  const all = await listSources(db);
  assert(all.length === 1, "重复登记后应仅保留一条");
});

await check("TC-D-M2-010", "F-08 CFG-01：registerSource 缺必填 → 应用层先拒绝（不落库）", async () => {
  const { db } = freshDb();
  await expectThrow(
    () => registerSource(db, { source_id: "CDP", source_name: "x" }),
    /缺必填字段/
  );
});

/* ---------------- TC-I-M2-003（F-08 · 缺口如实 / 来源名不代替证据） ---------------- */

await check(
  "TC-I-M2-003",
  "F-08 缺口如实：getSourceGaps 每条 is_evidence=false（系统名不代替实际证据），ACT 降级如实呈现",
  async () => {
    const { db } = freshDb({ seed: true });
    const gaps = await getSourceGaps(db);
    assert(gaps.length > 0, "应产出缺口（capability_cannot 非空即缺口）");
    assert(gaps.every((g) => g.is_evidence === false), "缺口一律 is_evidence=false：来源名不得充当证据");
    assert(gaps.every((g) => typeof g.cannot === "string" && g.cannot.length > 0), "每条缺口应带「不可查内容」说明");
    // ACT 为 P2 降级（原型唯一非 ok 来源）：应出现在缺口中且按 capability_limit 归类
    const act = gaps.find((g) => g.source_id === "ACT");
    assert(act && act.gap_kind === "capability_limit", "ACT（degraded）应如实登记为能力边界缺口");
  }
);

await check(
  "TC-I-M2-003",
  "F-08 未接入来源如实登记：availability_status=unauthorized → gap_kind=source_unavailable",
  async () => {
    const { db } = freshDb();
    await registerSource(db, {
      source_id: "CDP",
      source_name: "CDP 用户标签系统",
      capability_can: "人群圈选",
      capability_cannot: "完整用户行为序列",
      availability_status: "unauthorized", // 未接入
    });
    const gaps = await getSourceGaps(db);
    const cdp = gaps.find((g) => g.source_id === "CDP");
    assert(cdp && cdp.gap_kind === "source_unavailable", "未接入来源应登记为整源不可用");
    // 接入能力变化后（确认接入），该源按 ok 归入能力边界缺口
    await updateSourceCapability(db, { source_id: "CDP", availability_status: "ok" });
    const after = (await getSourceGaps(db)).find((g) => g.source_id === "CDP");
    assert(after && after.gap_kind === "capability_limit", "确认接入后缺口应降为能力边界");
    assert((await getSource(db, "CDP")).availability_status === "ok", "接入能力确认应落库");
  }
);

/* ---------------- F-08 验收：来源与工具说明（确定性可复现） ---------------- */

await check("F-08-定向", "F-08 验收：来源与工具说明（CFG-01×CFG-02 按源分组）确定性可复现", async () => {
  const { db } = freshDb({ seed: true });
  const a = await getSourceToolBriefing(db);
  const b = await getSourceToolBriefing(db);
  assert(a.sources.length === 5, "应含五类来源");
  assert(a.sources.every((s) => Array.isArray(s.tools)), "每来源应附工具列表（CFG-02 只读交叉引用）");
  assert(a.sources.some((s) => s.tools.length > 0), "种子工具应挂到对应来源");
  assert(Array.isArray(a.gaps) && a.gaps.length > 0, "说明中应含缺口地图");
  assert(JSON.stringify(a) === JSON.stringify(b), "同库状态两次读取应完全一致（确定性）");
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
    ? `VERIFY PASS: F-08 用例全绿（${results.length} 条断言组，CFG-01 PK/NOT NULL + 缺口语义 + 来源与工具说明确定性）`
    : `VERIFY FAIL: ${failed}/${results.length} 组失败`
);
process.exit(failed === 0 ? 0 : 1);
