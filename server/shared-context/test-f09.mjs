#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · F-09 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M2.md`（TC-D-M2-007 + TC-I-M2-001 = F-09 验收 oracle；TC-D-M2-015 标 F-09/F-12）
 *   ｜ `../../docs/02-prd/PRD-M2-共享上下文.md`（F-09 验收要点：证据链完整可回溯；新旧依据并存且关联）
 *   ｜ `../../docs/03-locks/schema.md` §6 EXT-02（来源/条件/时点/适用范围 + 缺失说明）、§5 LNK-01/LNK-02/LNK-04
 *   ｜ `../../db/migrations/0001_init.sql` L446-458（EXT-02）/ L387-404（LNK-01/02）/ L416-425（LNK-04）
 *   ｜ `../../db/seed/0001_mock.sql`（EXT-02 7 条 / EXT-01 11 条 / LNK-01/02/04 种子，用于回查链路与「并存不覆盖」）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-09 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构与语义，不断言 18.4% / 3.2 万行等 demo 值）。
 * 边界：LNK-04 `task_object` 的**写入路径归 M1 task-runner（F-02/F-04/F-06）**——本执行器只按 oracle 断言其**库级复合 UK**（TC-D-M2-015）。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f09.mjs`）。
 *
 * 用法：node server/shared-context/test-f09.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createEvidence,
  getEvidence,
  listEvidence,
  getEvidenceTrace,
  validateEvidenceCompleteness,
  EVIDENCE_FOUR_ELEMENTS,
  linkOpportunityEvidence,
  linkFindingEvidence,
  listEvidenceByOpportunity,
  listEvidenceByFinding,
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

/** 构造一条四要素齐全的合法证据输入（引用种子里的 query/source）。 */
function validEvidence(over = {}) {
  return {
    evidence_id: "EV-T9001",
    query_id: "Q-90217", // 种子：T-1022 × HJE
    source_id: "HJE", // 种子：CFG-01 五来源之一
    evidence_title: "探针证据：入口维度复购差异",
    query_condition: "入口类型 ∈ {搜索结果页, 首页推荐位}",
    info_time_point: "2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15",
    applicability_scope: "仅京东超市主站 APP 端；不含小程序",
    result_summary: "探针：文本原样保留，不拆数值",
    missing_note: "探针：无法确认用户后续是否改用其他入口",
    ...over,
  };
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

/* ---------------- TC-D-M2-007（F-09 · EXT-02 外键：query_id / source_id） ---------------- */

await check("TC-D-M2-007", "F-09 EXT-02 反①：query_id 不存在 → 库级外部键拒绝", async () => {
  const { db } = freshDb({ seed: true });
  await expectThrow(() => createEvidence(db, validEvidence({ query_id: "Q-NOPE" })), /FOREIGN KEY|constraint/i);
  assert((await listEvidence(db)).length === 7, "被拒后证据表应保持种子的 7 条（未落库）");
});

await check("TC-D-M2-007", "F-09 EXT-02 反②：source_id 不存在 → 库级外部键拒绝", async () => {
  const { db } = freshDb({ seed: true });
  await expectThrow(() => createEvidence(db, validEvidence({ source_id: "NOPE" })), /FOREIGN KEY|constraint/i);
});

await check("TC-D-M2-007", "F-09 EXT-02 正例：四要素齐全 + 合法 query_id/source_id → 落库并可回查", async () => {
  const { db } = freshDb({ seed: true });
  await createEvidence(db, validEvidence());
  const ev = await getEvidence(db, "EV-T9001");
  assert(ev && ev.query_id === "Q-90217" && ev.source_id === "HJE", "证据应落库且回指查询与来源");
});

/* ---------------- TC-I-M2-001（F-09 · 证据四要素齐全 / 不可作有效依据） ---------------- */

await check("TC-I-M2-001", "F-09 四要素齐全校验（纯函数）：任一缺失 → valid=false 并列出缺失", async () => {
  assert(EVIDENCE_FOUR_ELEMENTS.length === 4, "证据四要素应为 来源/条件/时点/适用范围 四项");
  assert(validateEvidenceCompleteness(validEvidence()).valid === true, "齐全时应 valid=true");
  for (const f of EVIDENCE_FOUR_ELEMENTS) {
    for (const bad of [undefined, null, "", "   "]) {
      const r = validateEvidenceCompleteness(validEvidence({ [f]: bad }));
      assert(r.valid === false, `${f}=${JSON.stringify(bad)} 应判为不齐`);
      assert(r.missing.includes(f), `${f}=${JSON.stringify(bad)} 应列入缺失字段`);
    }
  }
});

await check("TC-I-M2-001", "F-09 四要素不齐的证据 → 不可作为有效依据（createEvidence 直接 fail、不落库）", async () => {
  const { db } = freshDb({ seed: true });
  const before = (await listEvidence(db)).length;
  for (const f of EVIDENCE_FOUR_ELEMENTS) {
    await expectThrow(() => createEvidence(db, validEvidence({ [f]: "" })), /四要素不齐/);
  }
  assert((await listEvidence(db)).length === before, "四要素不齐不得落库");
});

await check("TC-I-M2-001", "F-09 种子既有证据四要素均齐（对照：脏证据不进入库）", async () => {
  const { db } = freshDb({ seed: true });
  const rows = await listEvidence(db);
  assert(rows.length === 7, `种子应有 7 条证据，实得 ${rows.length}`);
  for (const r of rows) {
    const c = validateEvidenceCompleteness(r);
    assert(c.valid === true, `${r.evidence_id} 四要素应齐全（缺：${c.missing_labels.join("、")}）`);
  }
});

/* ---------------- TC-I-M2-001（F-09 · 证据链完整可回溯） ---------------- */

await check("TC-I-M2-001", "F-09 回查链路：证据 → 查询记录 → 来源，可完整回溯「证据是怎样取得的」", async () => {
  const { db } = freshDb({ seed: true });
  const trace = await getEvidenceTrace(db, "EV-1041");
  assert(trace !== null, "应能取到证据");
  assert(trace.traceable === true, "四要素齐全 + 可回指查询与来源 → traceable");
  assert(trace.query_record && trace.query_record.query_id === trace.evidence.query_id, "应回指到对应查询记录");
  assert(trace.source && trace.source.source_id === trace.evidence.source_id, "应回指到对应来源");
  assert(trace.query_record.query_condition && trace.source.capability_cannot, "查询条件与来源能力边界应在链路中可见");
  assert((await getEvidenceTrace(db, "EV-NOPE")) === null, "不存在的证据应返回 null");
});

await check("TC-I-M2-001", "F-09 回查链路：证据自洽副本与查询记录可各自独立（条件/时点在 EXT-02 冗余一份）", async () => {
  const { db } = freshDb({ seed: true });
  const trace = await getEvidenceTrace(db, "EV-1038");
  // 证据自洽：EXT-02 自带 query_condition / info_time_point，不依赖查询记录是否补录
  assert(typeof trace.evidence.query_condition === "string" && trace.evidence.query_condition.length > 0, "证据应自带条件副本");
  assert(typeof trace.evidence.info_time_point === "string" && trace.evidence.info_time_point.length > 0, "证据应自带时点副本");
});

/* ---------------- TC-I-M2-001（F-09 · 新证据加入不覆盖原有依据） ---------------- */

await check("TC-I-M2-001", "F-09 新旧依据并存：新增证据关联到同一发现，原依据仍保留（不覆盖）", async () => {
  const { db } = freshDb({ seed: true });
  const before = await listEvidenceByFinding(db, "F-001");
  assert(before.length === 1 && before[0].evidence_id === "EV-1038", "起点：F-001 仅挂 EV-1038（种子）");

  await createEvidence(
    db,
    validEvidence({
      evidence_id: "EV-NEW01",
      query_id: "Q-90241", // 种子：T-1023 × CDP
      source_id: "CDP",
      evidence_title: "探针：新证据（新条件新时点）",
      info_time_point: "2026-09-18 09:13 取数，覆盖 2026-08-01 ~ 2026-09-17",
      applicability_scope: "京东超市 APP + 小程序（范围已变）",
    })
  );
  await linkFindingEvidence(db, { link_id: "LK-FE-NEW", finding_id: "F-001", evidence_id: "EV-NEW01" });

  const after = await listEvidenceByFinding(db, "F-001");
  assert(after.length === 2, "新证据加入后应并存 2 条关联（不覆盖）");
  assert(after.some((r) => r.evidence_id === "EV-1038"), "原依据 EV-1038 关联应仍保留");
  assert(after.some((r) => r.evidence_id === "EV-NEW01"), "新证据 EV-NEW01 关联应在");

  const old = await getEvidence(db, "EV-1038");
  assert(old.info_time_point === "2026-09-15 21:40 取数，标签快照 2026-09-14", "旧证据原文表述不得漂移（自洽）");
});

await check("TC-I-M2-001", "F-09 LNK-01 语义区分：同一机会的「初步依据 / 关联更新」并存可辨（link_kind）", async () => {
  const { db } = freshDb({ seed: true });
  const before = await listEvidenceByOpportunity(db, "OPP-014");
  assert(before.length === 1 && before[0].link_kind === "initial_basis", "起点：OPP-014 仅 initial_basis 关联");

  await createEvidence(
    db,
    validEvidence({
      evidence_id: "EV-UPD01",
      query_id: "Q-90241",
      source_id: "CDP",
      evidence_title: "探针：同问题的新证据",
    })
  );
  await linkOpportunityEvidence(db, {
    link_id: "LK-OE-NEW",
    opportunity_id: "OPP-014",
    evidence_id: "EV-UPD01",
    link_kind: "related_update",
  });

  const after = await listEvidenceByOpportunity(db, "OPP-014");
  const kinds = after.map((r) => r.link_kind).sort();
  assert(after.length === 2, "新旧依据应并存");
  assert(JSON.stringify(kinds) === JSON.stringify(["initial_basis", "related_update"]), "两种语义应可辨");
});

/* ---------------- TC-D-M2-015（LNK-04 复合 UK · 标 F-09/F-12；写路径归 M1 task-runner） ---------------- */

await check("TC-D-M2-015", "F-09/F-12 LNK-04：重复 (task_id, object_type, object_id, link_role) → 复合 UK 拒绝", async () => {
  const { db, sqlite } = freshDb({ seed: true });
  const ins = (id) =>
    db
      .prepare(
        `INSERT INTO task_object (link_id, task_id, object_type, object_id, link_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .bind(id, "T-1022", "opportunity", "OPP-012", "output", "2026-09-19 12:00")
      .run();
  // 种子已有 (T-1022, opportunity, OPP-012, output) = LK-TO-002 → 同四元组应被拒
  await expectThrow(() => ins("LK-TO-DUP"), /UNIQUE|constraint/i);
  assert(sqlite.prepare("PRAGMA foreign_key_check").all().length === 0, "种子应无外键违例");
  // 换 link_role 即视为不同关联，应允许
  await db
    .prepare(
      `INSERT INTO task_object (link_id, task_id, object_type, object_id, link_role, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind("LK-TO-NEW", "T-1022", "opportunity", "OPP-012", "trigger", "2026-09-19 12:00")
    .run();
  const n = (await db.prepare("SELECT COUNT(*) AS c FROM task_object WHERE task_id='T-1022'").first()).c;
  assert(n === 3, `换 role 应新增一行（T-1022 由 2 行变 3 行），实得 ${n}`);
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
    ? `VERIFY PASS: F-09 用例全绿（${results.length} 条断言组，EXT-02 外键 + 证据四要素齐全 + 回查链路 + 新旧依据并存不覆盖 + LNK-04 复合 UK）`
    : `VERIFY FAIL: ${failed}/${results.length} 组失败`
);
process.exit(failed === 0 ? 0 : 1);
