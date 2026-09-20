#!/usr/bin/env node
/**
 * 文档卡（阶段4 · M3 · F-17 用例执行器 · 2026-09-20）
 * 上游：../../docs/05-test-cases/test-M3.md（**TC-I-M3-001**（L5·F-17：机会发现 → HVA 分析衔接，经**人工节点**
 *        （M1 F-03/F-04，PM 选机会、提研究问题）转交；**不自动交接**；**无人工节点时 M4 不被调用**））
 *   ｜ ../../docs/02-prd/PRD-M3-机会发现Agent.md（F-17 两步衔接：机会＋初步依据作为 PM 输入前提；拿到结果后的
 *        对话过程作为第二个 Agent 的输入；必要信息可能由 Agent 反过来问 PM｜§4 红线 1/3/4）
 *   ｜ ../../docs/01-brd/BRD.md §3.1 流程主线、§6 术语口径「人工节点」、§4 F-03（PM 选机会＋提研究问题，必需）
 *   ｜ ../../docs/03-locks/schema.md（MD-06 opportunity 六要素、MD-12 research_proposal、LNK-01 opportunity_evidence；
 *        §12 Q-16：`linked_at` 种子值形式——本文件只断「原样透传」不解析）
 *   ｜ ../task-runner/proposal.js（F-03 `submitProposal`——本用例用它**造人工节点产物** fixture）
 *   ｜ ./handoff.js（F-17 本体）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-17 用例并断言。
 * 硬红线：本地内存库，**零真实外部调用、零 LLM 调用**（A-1 门禁只挡推理）；**demo 数值一律不进断言**——
 *   只断「人工节点守卫以 MD-12 实行为准（不看机会状态）/ 四要素透传 / 不自动交接 / 不建 M4 任务」等结构性事实。
 * 边界：只验 F-17 的衔接守卫与交接物组装；M4（F-18~F-22）归阶段4 后半，本文件**不触发**。
 * 反向清单：登记 ../agent-orchestrator/README.md 与 ../../server/README.md；被 CI `validate` 复用（node server/agent-orchestrator/test-f17.mjs）。
 *
 * 用法：node server/agent-orchestrator/test-f17.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  assemblePmDecisionContext,
  evaluateHandoffGate,
  collectSupplementRequests,
  composeHandoffPackage,
  HANDOFF_NODE,
  NO_AUTO_HANDOFF_NOTE,
  PM_CONTEXT_NOTICE,
  EVIDENCE_FOUR_ELEMENTS,
} from "./handoff.js";
import { listProposals, submitProposal } from "../task-runner/proposal.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const HANDOFF_SRC = new URL("./handoff.js", import.meta.url);

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
  seedFixture(sqlite);
  return { sqlite, db: d1From(sqlite) };
}

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const countRows = (sqlite, table) => sqlite.prepare(`SELECT COUNT(*) c FROM ${table}`).get().c;
const countHvaTasks = (sqlite) =>
  sqlite.prepare("SELECT COUNT(*) c FROM task WHERE task_type = 'hva_research'").get().c;

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
function finish() {
  console.log(`\nVERIFY ${fail === 0 ? "PASS" : "FAIL"} · ${pass} 断言通过 / ${fail} 失败`);
  process.exit(fail === 0 ? 0 : 1);
}

/* ------------------------------------------------------------------ *
 * 夹具：新增一个「六要素齐、有产出任务、但**无关联证据**且 `unknown_item=NULL`」的机会，
 * 用于断言「反向问 PM」为真（不动任何种子行）。OPP-012（submitted、2 条证据）与
 * OPP-014（candidate、1 条证据、无建议）直接复用种子。
 * ------------------------------------------------------------------ */
const OPP = {
  WITH_BASIS: "OPP-012", // 种子：submitted、2 条证据（EV-1041/EV-1038）
  NO_PROPOSAL: "OPP-014", // 种子：candidate、1 条证据
  NEEDS_SUPPLEMENT: "OPP-F17-A", // 夹具：无证据、unknown_item=NULL
};
const FIXTURE_TASK = "T-F17-001";

function seedFixture(sqlite) {
  sqlite
    .prepare(
      `INSERT INTO task (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
                         agent_version_snapshot, progress_text, done_part, started_at, created_at)
       VALUES (?, 'discovery', 'M3', 'GOAL-2026Q3-01', 3, 'done', 'F-17 夹具任务（不参与真实链路）',
               'fixture', 'fixture', 'fixture', ?, ?)`
    )
    .run(FIXTURE_TASK, "2026-09-20 00:00", "2026-09-20 00:00");
  sqlite
    .prepare(
      `INSERT INTO opportunity (opportunity_id, goal_id, goal_version_no, opportunity_title, opportunity_status,
                                target_object, phenomenon, initial_basis_note, research_reason, unknown_item,
                                defer_reason, producing_task_id, created_at)
       VALUES (?, 'GOAL-2026Q3-01', 3, 'F-17 夹具：待补依据的机会', 'candidate',
               '人群：夹具人群 ｜ 旅程环节：夹具环节', '夹具现象（结构性占位，不进真实数值断言）',
               '夹具依据说明', '夹具研究理由（仅用于断言请补项）', NULL, NULL, ?, '2026-09-20 00:00')`
    )
    .run(OPP.NEEDS_SUPPLEMENT, FIXTURE_TASK);
}

const NEW_QUESTION = "搜索进入的新客与推荐位进入的新客，在后续复购行为上是否存在可观察的差异？";

// ==================================================== ① PM 决策上下文（M3 产出 → PM 输入前提）
console.log("\n① `assemblePmDecisionContext` · 机会＋初步依据（四要素）＋未知项＋缺口＋性质声明");
{
  const { db } = freshDb();
  const ctx = await assemblePmDecisionContext(db, { opportunity_id: OPP.WITH_BASIS });

  assert(ctx.opportunity_id === OPP.WITH_BASIS, "① 上下文锚定机会");
  assert(ctx.opportunity.phenomenon === "搜索进入新客复购率 18.4%，推荐位进入 26.1%，差 7.7pp", "① 现象来自库（原样透传）");
  assert(ctx.basis_count === 2, `① 初步依据条数＝该机会的 LNK-01 关联数（实测 ${ctx.basis_count}）`);
  assert(ctx.initial_basis.every((e) => e.four_elements_complete === true), "① 每条证据的四要素齐（DDL NOT NULL 保证）");
  assert(
    ctx.initial_basis.every((e) => EVIDENCE_FOUR_ELEMENTS.every((f) => e[f] !== null && String(e[f]).trim() !== "")),
    "① 四要素（来源/条件/时点/适用范围）逐项非空"
  );
  assert(ctx.initial_basis.every((e) => e.retrievable === true), "① 每条依据可回查（evidence_id + source_id 均在）");
  assert(ctx.initial_basis.every((e) => e.linked_at !== undefined), "① `linked_at` 原样透传（不解析；值形式见 schema.md §12 Q-16）");
  assert(ctx.six_elements.unknown_state === "has_unknown", "① 未知项二态＝有未知（种子 OPP-012 为文本）");
  assert(ctx.notice === PM_CONTEXT_NOTICE && /尚不构成 HVA 结论/.test(ctx.notice), "① **性质声明**：尚不构成 HVA 结论（红线 1/3）");
  assert(ctx.next_step.auto === false && ctx.next_step.feature.includes("F-03"), "① 下一步＝人工节点且 `auto:false`");
  assert(!/权益组合|预算|排期|creative|review|deliver/.test(JSON.stringify(ctx)), "① 不输出生产动作类内容（BRD §5.3）");
}

// ==================================================== ② 人工节点守卫：以 MD-12 实行为准（防「状态假通过」）
console.log("\n② `evaluateHandoffGate` · **机会状态为 submitted 但 MD-12 无建议行 → 仍不得交接**（TC-I-M3-001）");
{
  const { sqlite, db } = freshDb();
  const st = sqlite.prepare("SELECT opportunity_status FROM opportunity WHERE opportunity_id = ?").get(OPP.WITH_BASIS);
  assert(st.opportunity_status === "submitted", "② 前置：种子该机会状态确为 `submitted`（状态不可作判据）");
  assert(countRows(sqlite, "research_proposal") === 0, "② 前置：种子 MD-12 无任何建议行（该表为有意留空表）");

  const gate = await evaluateHandoffGate(db, { opportunity_id: OPP.WITH_BASIS });
  assert(gate.human_node_completed === false, "② 人工节点**未完成**（无真实建议行）");
  assert(gate.can_handoff === false, "② **不得交接**——状态为 submitted 也不放行（防假通过）");
  assert(gate.auto_handoff === false, "② `auto_handoff` 恒 false");
  assert(gate.blocked_by === "human_node", "② 受阻原因＝人工节点");
  assert(gate.reasons.length > 0 && /MD-12/.test(gate.reasons[0]), "② 给出明确理由（引 MD-12 无建议行）");
  assert(gate.required_node.feature.includes("M1 F-03") && gate.required_node.auto === false, "② 明示必需节点＝M1 F-03");
  assert(Array.isArray(gate.proposal_ids) && gate.proposal_ids.length === 0, "② `proposal_ids` 为空数组");
}

// ==================================================== ③ 人工节点完成后放行（且仍不自动）
console.log("\n③ 经 F-03 `submitProposal` 完成人工节点 → 放行（但仍 `auto_handoff:false`、仍不建 M4 任务）");
{
  const { sqlite, db } = freshDb();
  const before = countHvaTasks(sqlite);

  const sub = await submitProposal(db, {
    opportunity_id: OPP.WITH_BASIS,
    research_question: NEW_QUESTION,
    submitted_by: "PM-fixture",
    at: "2026-09-20 10:00",
  });
  assert(sub && (sub.created === true || sub.proposal), "③ 建议已提交（F-03 人工节点产物）");
  const rows = await listProposals(db, { opportunity_id: OPP.WITH_BASIS });
  assert(rows.length === 1, `③ MD-12 出现 1 行建议（实测 ${rows.length}）`);

  const gate = await evaluateHandoffGate(db, { opportunity_id: OPP.WITH_BASIS });
  assert(gate.human_node_completed === true, "③ 人工节点**已完成**");
  assert(gate.can_handoff === true && gate.blocked_by === null, "③ 可以交接");
  assert(gate.proposal_ids.length === 1 && gate.proposal_ids[0] === rows[0].proposal_id, "③ `proposal_ids` 指向真实建议");
  assert(gate.proposals[0].research_question === NEW_QUESTION, "③ 建议的研究问题透传（M4 的输入前提）");
  assert(gate.auto_handoff === false, "③ **即便放行，`auto_handoff` 仍为 false**（不自动交接）");
  assert(countHvaTasks(sqlite) === before, "③ 守卫本身**不建任何 M4 任务**");
}

// ==================================================== ④ 反向问 PM（必要信息缺失 → 请补项）
console.log("\n④ `collectSupplementRequests` · 缺口 → 由 Agent 反向问 PM（不静默回退、不编造）");
{
  const { db } = freshDb();

  const need = await collectSupplementRequests(db, { opportunity_id: OPP.NEEDS_SUPPLEMENT });
  assert(need.ask_pm === true, "④ 夹具机会（无证据 + 未知项 NULL）→ `ask_pm:true`");
  assert(need.to === "PM", "④ 收件人＝PM");
  const fields = need.requests.map((r) => r.field);
  assert(fields.includes("initial_basis"), "④ 含「请补初步依据」（无 LNK-01 关联证据）");
  assert(fields.includes("unknown_item"), "④ 含「请补未知项评估」（NULL＝未评估）");
  assert(need.requests.every((r) => r.why && r.ask), "④ 每条含「为何请补」与「请补什么」（可操作）");
  assert(!/权益组合|预算|排期/.test(JSON.stringify(need)), "④ 请补项不越界为生产动作");

  const ok = await collectSupplementRequests(db, { opportunity_id: OPP.WITH_BASIS });
  assert(ok.ask_pm === false, "④ 六要素齐且有证据的机会 → `ask_pm:false`（不无病呻吟）");
  assert(ok.requests.length === 0, "④ 无请补项");
}

// ==================================================== ⑤ 交接包：只组装不触发
console.log("\n⑤ `composeHandoffPackage` · 未过守卫 `handoff:null`；已过则给「供 M1 F-04 消费」的输入前提");
{
  const { sqlite, db } = freshDb();

  // ⑤-1 未过守卫（OPP-014 无建议）
  const pkg0 = await composeHandoffPackage(db, { opportunity_id: OPP.NO_PROPOSAL });
  assert(pkg0.handoff === null, "⑤ 未过守卫 → `handoff:null`（不产出交接物）");
  assert(pkg0.blocked_by === "human_node", "⑤ `blocked_by='human_node'`");
  assert(pkg0.no_auto_handoff === true && pkg0.auto_handoff === false, "⑤ 显式声明不自动交接");
  assert(pkg0.note === NO_AUTO_HANDOFF_NOTE, "⑤ 声明文案与常量一致");
  assert(pkg0.pm_decision_context.basis_count === 1, "⑤ 即便不放行，PM 上下文仍完整（供 PM 决策）");

  // ⑤-2 过守卫（先造建议）
  await submitProposal(db, {
    opportunity_id: OPP.WITH_BASIS,
    research_question: NEW_QUESTION,
    submitted_by: "PM-fixture",
    at: "2026-09-20 10:00",
  });
  const tasksBefore = countRows(sqlite, "task");
  const hvaBefore = countHvaTasks(sqlite);

  const pkg1 = await composeHandoffPackage(db, { opportunity_id: OPP.WITH_BASIS });
  assert(pkg1.handoff !== null, "⑤ 过守卫 → 产出交接物");
  assert(pkg1.handoff.triggered_by === "human_node", "⑤ 交接物由人工节点触发");
  assert(pkg1.handoff.research_question === NEW_QUESTION, "⑤ 交接物带 M4 的输入前提（研究问题）");
  assert(pkg1.handoff.goal_version_no === 3, "⑤ 交接物带机会版本（不混版本）");
  assert(pkg1.handoff.already_triggered === false, "⑤ 尚未触发 M4（`triggered_task_id` 为空）");
  assert(/M1 F-04/.test(pkg1.handoff.downstream_entry), "⑤ 只给入口提示文字（指向 M1 F-04）");

  // ⑤-3 **关键红线**：组装交接包**不产生任何任务行**（证明不自动交接）
  assert(countRows(sqlite, "task") === tasksBefore, "⑤ **组装前后 `task` 行数不变**（不代为启动 M4）");
  assert(countHvaTasks(sqlite) === hvaBefore, "⑤ **`hva_research` 任务行数不变**（TC-I-M3-001：无人工节点时不调用 M4）");
  assert(pkg1.handoff.proposal_ids.length === 1, "⑤ 交接物引用的建议唯一（幂等由 F-03 守）");
}

// ==================================================== ⑥ 前置校验：机会必须真实存在
console.log("\n⑥ 前置校验 · 机会不存在 → 三个入口一律报错（不静默造上下文）");
{
  const { db } = freshDb();
  await assertThrows(() => assemblePmDecisionContext(db, { opportunity_id: "OPP-NOPE" }), "⑥ 上下文：机会不存在 → 报错", "机会不存在");
  await assertThrows(() => evaluateHandoffGate(db, { opportunity_id: "OPP-NOPE" }), "⑥ 守卫：机会不存在 → 报错", "机会不存在");
  await assertThrows(() => composeHandoffPackage(db, { opportunity_id: "OPP-NOPE" }), "⑥ 交接包：机会不存在 → 报错", "机会不存在");
  await assertThrows(() => assemblePmDecisionContext(db, {}), "⑥ 必填缺失 → 报错", "必填");
}

// ==================================================== ⑦ 常量与人工节点口径
console.log("\n⑦ 常量 · 人工节点口径与「不自动交接」声明");
{
  assert(HANDOFF_NODE.auto === false, "⑦ `HANDOFF_NODE.auto === false`");
  assert(HANDOFF_NODE.feature.includes("F-03") && HANDOFF_NODE.trigger.includes("F-04"), "⑦ 指向 M1 F-03（人工节点）→ F-04（启动）");
  assert(Object.isFrozen(HANDOFF_NODE), "⑦ 常量冻结（不可被运行期改写）");
  assert(EVIDENCE_FOUR_ELEMENTS.length === 4 && Object.isFrozen(EVIDENCE_FOUR_ELEMENTS), "⑦ 四要素常量＝4 项且冻结");
}

// ==================================================== ⑧ 静态核验（零外部调用 / 零写库 / 绝不触发 M4）
console.log("\n⑧ 静态核验 · 零外部调用 / 零写库 / 零裸 SQL / 不 import hva.js / 无 M4 建任务调用");
{
  const raw = readFileSync(HANDOFF_SRC, "utf8");
  const src = stripComments(raw);

  assert(!/\bfetch\s*\(/.test(src) && !/https?:\/\//.test(src), "⑧ 无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");

  const writes = src.match(/\b(INSERT\s+INTO|UPDATE\s+[a-z_]+\s+SET|DELETE\s+FROM)\b/gi) || [];
  assert(writes.length === 0, `⑧ **零写库**（实测写语句命中 ${writes.length}）`);

  const selects = src.match(/\bSELECT\b/gi) || [];
  assert(selects.length === 0, `⑧ **零裸 SQL**：一律走读面（实测 SELECT ${selects.length}）`);

  // **绝不触发 M4**：不 import hva.js、不出现 M4 建任务函数名
  assert(!/task-runner\/hva\.js/.test(src), "⑧ **不 import `../task-runner/hva.js`**（M4 建任务面）");
  assert(!/createHvaResearchTask/.test(src), "⑧ 代码中**不出现** M4 建任务函数名（TC-I-M3-001）");

  const importTargets = [...src.matchAll(/import\s*\{[\s\S]*?\}\s*from\s*"([^"]+)"/g)].map((m) => m[1]);
  assert(importTargets.length === 2, `⑧ import 语句恰 2 条（实测 ${importTargets.length}）`);
  assert(
    importTargets.includes("../shared-context/index.js") && importTargets.includes("../task-runner/proposal.js"),
    `⑧ 依赖＝shared-context（读面）＋proposal.js（F-03 只读建议，实测 ${importTargets.join("、")}）`
  );
  assert(!importTargets.some((t) => t.includes("tool-executor")), "⑧ 不依赖 tool-executor（F-17 不发起查询）");
}

finish();
