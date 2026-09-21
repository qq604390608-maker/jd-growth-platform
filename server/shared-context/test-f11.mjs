#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · F-11 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M2.md`（TC-D-M2-006 / TC-D-M2-008 / TC-I-M2-004 = F-11 验收 oracle）
 *   ｜ `../../docs/02-prd/PRD-M2-共享上下文.md` F-11（验收要点：后续研究可引用历史，避免重复研究）
 *   ｜ `../../docs/03-locks/schema.md` MD-07（L275-291 研究编号 R-xxx、`opportunity_id` FK→MD-06、
 *        `parent_research_no` 自引用 FK；L270-271 编号裁决「只用 R-xxx」＋「追问不覆盖原研究」）、
 *        MD-08（L300-305 关键发现 `research_no` FK→MD-07）、EXT-03（L742-747 外部验证 `research_no` FK→MD-07）、
 *        §13 F-xx↔表映射（F-11 = MD-07 MD-08 MD-09 MD-10 MD-11 EXT-03）
 *   ｜ `../../db/migrations/0001_init.sql` L230-248（MD-07）/ L251-259（MD-08）/ L461-468（EXT-03）
 *   ｜ `../../db/seed/0001_mock.sql`（MD-07 2 条 R-006/R-007；MD-08 6 条；**EXT-03 种子为空**——原型无数据）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-11 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**数值以契约基准 v1（ADR-004）为准**（只断结构与语义，不断言 29.3% / 8.6pp 等基准 v1 自拟值）。
 * 标注：EXT-03 `external_validation` 种子为 0 行（原型无数据）——先证基线空，再由本项登记正例，
 *        其 FK 反例（`research_no='R-NOPE'`）与种子无关，可独立验证（TC-D-M2-008）。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f11.mjs`）。
 *
 * 用法：node server/shared-context/test-f11.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  createResearch,
  getResearch,
  listResearch,
  listResearchFindings,
  addExternalValidation,
  listExternalValidations,
  getResearchLineage,
  getResearchRecord,
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

/** 构造一份合法研究输入（除 created_at 外的 DDL NOT NULL 列全给值；可选列留空）。 */
function validResearch(over = {}) {
  return {
    research_no: "R-T9001",
    opportunity_id: "OPP-012", // 种子：MD-06 已有机机会（R-007 所属）
    research_question: "探针研究问题：为什么这个人群表现不同？",
    e1_goal_statement: "探针①：业务目标 + 研究问题",
    e2_scope_method: "探针②：研究范围、时间窗、所用方法与排查项",
    e4_population_diff: "探针④：分组后的人群表现差异",
    e6_limits: "探针⑥：未排除的替代解释与数据限制",
    out_of_scope_note: "探针：本研究结论不覆盖的范围声明",
    research_status: "running", // dict:RESEARCH_STATUS
    goal_id: "GOAL-2026Q3-01", // 种子：MD-01 目标
    goal_version_no: 3, // 目标版本快照
    ...over,
  };
}

let pass = 0;
let failed = 0;
async function check(id, title, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✅ ${id} ${title}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${id} ${title}\n     ${e.message}`);
  }
}

console.log("== F-11 研究结果与历史管理（TC-D-M2-006 / TC-D-M2-008 / TC-I-M2-004）==");

/* ---------------- 种子基线（诚实核对，非断言层） ---------------- */
{
  const { sqlite } = freshDb();
  const cnt = (t) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(
    `  · 种子基线：research=${cnt("research")} / research_finding=${cnt("research_finding")} / external_validation=${cnt("external_validation")}`
  );
  console.log(`  · 库Names check：foreign_key_check=${JSON.stringify(sqlite.prepare("PRAGMA foreign_key_check").all())}`);
}

/* ---------------- TC-D-M2-006：MD-07 opportunity_id 外键 ---------------- */

await check("TC-D-M2-006a", "F-11 反例：research.opportunity_id='OPP-NOPE' → 库级外键拒绝", async () => {
  const { db } = freshDb();
  await expectThrow(
    () => createResearch(db, validResearch({ opportunity_id: "OPP-NOPE" })),
    /FOREIGN KEY|constraint/i
  );
});

await check("TC-D-M2-006b", "F-11 正例：opportunity_id 为种子已有机机会 → 落库成功", async () => {
  const { db } = freshDb();
  const r = await createResearch(db, validResearch({ research_no: "R-T9002" }));
  const row = await getResearch(db, "R-T9002");
  assert(row !== null, "新研究应可读回");
  assert(row.opportunity_id === "OPP-012", `opportunity_id 应为 OPP-012，实得 ${row.opportunity_id}`);
  assert(r.parent_research_no === null, "首个研究的 parent_research_no 应为 NULL");
});

await check("TC-D-M2-006c", "F-11 正例：MD-07 必填齐备（DDL NOT NULL 全集）→ 缺任一必填被应用层拒", async () => {
  const { db } = freshDb();
  await expectThrow(
    () => createResearch(db, validResearch({ research_question: "  " })),
    /缺必填字段/
  );
});

await check("TC-D-M2-006d", "F-11 补充：parent_research_no 不存在的自引用 FK → 库级拒绝（DDL L244）", async () => {
  const { db } = freshDb();
  await expectThrow(
    () => createResearch(db, validResearch({ parent_research_no: "R-NOPE" })),
    /FOREIGN KEY|constraint/i
  );
});

/* ---------------- TC-D-M2-008：EXT-03 research_no 外键 ---------------- */

await check("TC-D-M2-008a", "F-11 基线：EXT-03 种子为空（原型无外部验证数据）", async () => {
  const { db } = freshDb();
  const rows = await listExternalValidations(db, { research_no: "R-007" });
  assert(rows.length === 0, `EXT-03 种子应为 0 行，实得 ${rows.length}`);
});

await check("TC-D-M2-008b", "F-11 反例：external_validation.research_no='R-NOPE' → 库级外键拒绝", async () => {
  const { db } = freshDb();
  await expectThrow(
    () =>
      addExternalValidation(db, {
        validation_id: "EV-V9001",
        research_no: "R-NOPE",
        conclusion: "探针：业务侧验证结论",
        source_ref: "探针：来源引用",
        validated_at: "2026-09-19 10:00",
      }),
    /FOREIGN KEY|constraint/i
  );
});

await check("TC-D-M2-008c", "F-11 正例：research_no 为种子已有研究 → 外部验证引用登记成功", async () => {
  const { db } = freshDb();
  await addExternalValidation(db, {
    validation_id: "EV-V9001",
    research_no: "R-007",
    conclusion: "探针：业务侧验证得出的结论（原样引用，平台不改写）",
    source_ref: "探针：业务材料 / 系统出处",
    validated_at: "2026-09-19 10:00",
  });
  const rows = await listExternalValidations(db, { research_no: "R-007" });
  assert(rows.length === 1, `应有 1 条外部验证，实得 ${rows.length}`);
  assert(rows[0].validation_id === "EV-V9001", "validation_id 应为 EV-V9001");
  assert(String(rows[0].source_ref).length > 0, "source_ref 非空（schema EXT-03 要求来源引用）");
});

await check("TC-D-M2-008d", "F-11 正例：外部验证可多条并存（不覆盖，按 validated_at 倒序）", async () => {
  const { db } = freshDb();
  for (const [id, at] of [
    ["EV-V9002", "2026-09-19 08:00"],
    ["EV-V9003", "2026-09-19 12:00"],
  ]) {
    await addExternalValidation(db, {
      validation_id: id,
      research_no: "R-007",
      conclusion: `探针结论 ${id}`,
      source_ref: `探针来源 ${id}`,
      validated_at: at,
    });
  }
  const rows = await listExternalValidations(db, { research_no: "R-007" });
  assert(rows.length === 2, `应并存 2 条，实得 ${rows.length}`);
  assert(rows[0].validation_id === "EV-V9003", "较晚的验证应排在前面");
});

/* ---------------- TC-I-M2-004：历史研究可回查 + 避免重复研究 ---------------- */

await check("TC-I-M2-004a", "F-11 正例：追问形成新研究行，parent_research_no 指向原研究（不覆盖）", async () => {
  const { db } = freshDb();
  const before = await getResearch(db, "R-007");
  await createResearch(db, validResearch({ research_no: "R-T9010", parent_research_no: "R-007" }));
  const after = await getResearch(db, "R-007");
  const child = await getResearch(db, "R-T9010");
  assert(child !== null && child.parent_research_no === "R-007", "追问应新增行并指向原研究");
  for (const k of ["research_question", "e1_goal_statement", "out_of_scope_note"]) {
    assert(before[k] === after[k], `原研究 ${k} 不应被追问改变（追问不覆盖，MD-07 表注）`);
  }
});

await check("TC-I-M2-004b", "F-11 正例：history lineage 可回查祖先链（chain_from_root 由根到本研究）", async () => {
  const { db } = freshDb();
  await createResearch(db, validResearch({ research_no: "R-T9011", parent_research_no: "R-007" }));
  await createResearch(db, validResearch({ research_no: "R-T9012", parent_research_no: "R-T9011" }));
  const lin = await getResearchLineage(db, "R-T9012");
  assert(lin !== null && lin.has_history === true, "应有历史可引用");
  assert(
    JSON.stringify(lin.ancestors.map((r) => r.research_no)) === JSON.stringify(["R-T9011", "R-007"]),
    `祖先应由近及远 [R-T9011, R-007]，实得 ${lin.ancestors.map((r) => r.research_no)}`
  );
  assert(
    JSON.stringify(lin.chain_from_root.map((r) => r.research_no)) === JSON.stringify(["R-007", "R-T9011", "R-T9012"]),
    "历史链应为 根→本研究"
  );
});

await check("TC-I-M2-004c", "F-11 正例：descendants 可收集派生追问链（避免重复研究）", async () => {
  const { db } = freshDb();
  await createResearch(db, validResearch({ research_no: "R-T9021", parent_research_no: "R-007" }));
  await createResearch(db, validResearch({ research_no: "R-T9022", parent_research_no: "R-T9021" }));
  await createResearch(db, validResearch({ research_no: "R-T9023", parent_research_no: "R-007" }));
  const lin = await getResearchLineage(db, "R-007");
  assert(lin.has_followup === true, "R-007 应有派生追问");
  assert(lin.descendants.length === 3, `派生应为 3 条，实得 ${lin.descendants.length}`);
  const ids = lin.descendants.map((r) => r.research_no).sort();
  assert(
    JSON.stringify(ids) === JSON.stringify(["R-T9021", "R-T9022", "R-T9023"]),
    `派生集合应为 [R-T9021, R-T9022, R-T9023]，实得 ${ids}`
  );
  assert(lin.has_history === false, "根研究本身无历史");
});

await check("TC-I-M2-004d", "F-11 正例：按机会列出历史研究（后续研究可引用而不重复研究）", async () => {
  const { db } = freshDb();
  await createResearch(db, validResearch({ research_no: "R-T9030", parent_research_no: "R-007" }));
  const rows = await listResearch(db, { opportunity_id: "OPP-012" });
  const ids = rows.map((r) => r.research_no);
  assert(ids.includes("R-007") && ids.includes("R-T9030"), `OPP-012 下应同时列出原研究与追问，实得 ${ids}`);
  // 每项都能回查到完整历史链
  const lin = await getResearchLineage(db, "R-T9030");
  assert(lin.chain_from_root.length === 2, "追问链长度应为 2");
});

await check("TC-I-M2-004e", "F-11 正例：研究读模型 getResearchRecord 含发现 + 验证 + 追问链", async () => {
  const { db } = freshDb();
  await addExternalValidation(db, {
    validation_id: "EV-V9010",
    research_no: "R-007",
    conclusion: "探针结论",
    source_ref: "探针来源",
    validated_at: "2026-09-19 10:00",
  });
  const rec = await getResearchRecord(db, "R-007");
  assert(rec !== null, "R-007 应可读回");
  assert(rec.research.research_no === "R-007", "研究本体编号应对");
  assert(rec.findings.length > 0 && rec.findings[0].research_no === "R-007", "MD-08 发现应按 research_no 带出");
  assert(rec.validations.length === 1, "EXT-03 外部验证应带出 1 条");
  assert(rec.lineage.ancestors.length === 0, "R-007 为根研究，无祖先");
  assert(await getResearchRecord(db, "R-NOPE") === null, "不存在的研究应返回 null");
});

await check("TC-I-M2-004f", "F-11 正例：MD-08 发现只读可回查（不含不明主体＝过时的 ST-xxx 编号口径）", async () => {
  const { db } = freshDb();
  const rows = await listResearchFindings(db, "R-007");
  assert(rows.length > 0, "种子 R-007 应有关关键发现");
  for (const f of rows) {
    assert(/^R-/.test(f.research_no), `research_no 应用 R-xxx 口径，实得 ${f.research_no}`);
    assert(typeof f.order_no === "number", "order_no 应为整型");
    assert(String(f.support_flag).length > 0, "support_flag 非空");
  }
  // UK(research_no, order_no)：同一研究内重复 order_no 被拒
  await expectThrow(
    () =>
      db
        .prepare(
          "INSERT INTO research_finding (finding_id, research_no, finding_text, support_flag, limit_note, order_no) VALUES (?,?,?,?,?,?)"
        )
        .bind("F-T9001", "R-007", "重复序号", rows[0].support_flag, "x", rows[0].order_no)
        .run(),
    /UNIQUE|constraint/i
  );
});

console.log("");
if (failed === 0) {
  console.log(`VERIFY PASS：${pass} 组断言全绿（F-11 研究结果与历史管理）`);
} else {
  console.log(`VERIFY FAIL：${pass} 通过 / ${failed} 失败`);
  process.exitCode = 1;
}
