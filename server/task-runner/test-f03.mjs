#!/usr/bin/env node
/**
 * 文档卡（阶段3 · M1 · F-03 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（**TC-I-M1-002 = 建议与机会版本关联 + 重复提交幂等 +
 *        缺研究问题拒绝提交**；**TC-D-M1-007 = `PD-05` 的机会外键反例**）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-03（验收要点两则 + §5 验收总则「重复提交须幂等」）
 *   ｜ `../../docs/03-locks/schema.md` MD-12（`idempotency_key` UK / `varchar(128)`；
 *        `research_question` 必需；两个可选列 `varchar(300)`；`submitted_at`＝第二阶段启动时点）
 *   ｜ `../../prototype/pages/propose.html`（**钉死需求**：问题检查三条提示 + 幂等键四字段 + 拒空问题）
 *   ｜ `./proposal.js`（被测模块）｜`../shared-context/index.js`（F-10 的 PD-05 写入面）
 * 职责：以 `node:sqlite` 建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-03 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构、语义、字典值与列长口径）。
 * 边界：本执行器只验 F-03；HVA 任务的创建与派发（F-04）的用例执行器在其落地时另行补记（**不预告未建文件名**）。
 * 反向清单：登记 `./README.md` 与 `../README.md`；被 CI `validate` 步骤复用（`node server/task-runner/test-f03.mjs`）。
 *
 * 用法：node server/task-runner/test-f03.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  canonicalProposalKey,
  idempotencyKeyOf,
  checkResearchQuestion,
  submitProposal,
  getProposal,
  listProposals,
  markProposalTriggered,
  markOpportunitySubmitted,
  getProposalRecord,
  nextProposalId,
  SUBMITTED_OPP_STATUS,
  PROPOSAL_LIMITS,
  IDEMPOTENCY_KEY_PREFIX,
  IDEMPOTENCY_ALGORITHM,
  QUESTION_MIN_LENGTH,
  QUESTION_CHECK_HINT,
} from "./proposal.js";
import { listOpportunityStatusLog } from "../shared-context/index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);
const MODULE_SRC = new URL("./proposal.js", import.meta.url);

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
const AT = "2026-09-19 13:00:00";
// 机会基线（种子）：OPP-014 candidate / OPP-013 candidate / OPP-010 submitted / OPP-011 deferred；皆为 GOAL-2026Q3-01 v3。
const OPP_CANDIDATE = "OPP-014";
const OPP_SUBMITTED = "OPP-010";
const Q_FULL = "搜索进入的新客复购更低，是行为差异还是人群结构差异";
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

// ==================================================== ① 幂等键：确定性、空白不敏感、区分度、列长合规
console.log("① 幂等键：同输入同键、空白不敏感、任一字段不同即不同键、落在 varchar(128) 内");
{
  const keyOf = (o) => idempotencyKeyOf(o);

  const a = await keyOf({ opportunity_id: OPP_CANDIDATE, research_question: Q_FULL });
  const b = await keyOf({ opportunity_id: OPP_CANDIDATE, research_question: Q_FULL });
  assert(a.key === b.key && a.key.startsWith(IDEMPOTENCY_KEY_PREFIX),
    `确定性：同输入两次得同键（实测 ${a.key.slice(0, 16)}…）`);
  assert(a.key.length <= PROPOSAL_LIMITS.idempotency_key,
    `键长 ${a.key.length} ≤ varchar(${PROPOSAL_LIMITS.idempotency_key})`);
  assert(a.algorithm === IDEMPOTENCY_ALGORITHM, "算法标识随键回带（可复核、跨环境一致）");

  const padded = await keyOf({ opportunity_id: ` ${OPP_CANDIDATE} `, research_question: `  ${Q_FULL}  ` });
  assert(padded.key === a.key, "空白不敏感：前后空格不产生新键（先 trim 再摘要）");

  const diffQ = await keyOf({ opportunity_id: OPP_CANDIDATE, research_question: `${Q_FULL}？` });
  assert(diffQ.key !== a.key, "研究问题不同 → 不同键");
  const diffH = await keyOf({ opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, behavior_hypothesis: "首单后 7 日内二次找品" });
  assert(diffH.key !== a.key, "候选行为假设不同 → 不同键");
  const diffL = await keyOf({ opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, population_limit: "仅限 APP 端" });
  assert(diffL.key !== a.key, "人群限制不同 → 不同键");
  const diffOpp = await keyOf({ opportunity_id: "OPP-013", research_question: Q_FULL });
  assert(diffOpp.key !== a.key, "机会不同 → 不同键");

  // 键用 JSON 序列化而非分隔符拼接：证明「问题里含分隔符」不会与别的字段组合撞键
  const c1 = canonicalProposalKey({ opportunity_id: "OPP-X", research_question: "a::b", behavior_hypothesis: "c" });
  const c2 = canonicalProposalKey({ opportunity_id: "OPP-X", research_question: "a", behavior_hypothesis: "b::c" });
  const k1 = await keyOf({ opportunity_id: "OPP-X", research_question: "a::b", behavior_hypothesis: "c" });
  const k2 = await keyOf({ opportunity_id: "OPP-X", research_question: "a", behavior_hypothesis: "b::c" });
  assert(c1 !== c2 && k1.key !== k2.key,
    "分隔符歧义反例：('a::b' + 'c') 与 ('a' + 'b::c') 不同键（JSON 序列化对定长数组是单射）");
  assert(a.canonical === JSON.stringify([OPP_CANDIDATE, Q_FULL, "", ""]), "规范形式可复核（四字段 trim 后的 JSON 数组）");
}

// ==================================================== ② 研究问题检查：必需阻断 + 不明确只提示
console.log("② 研究问题检查：空则阻断；不明确只列「需补充的要点」且不要求重填已有材料");
{
  const empty = checkResearchQuestion("   ");
  assert(empty.provided === false && empty.blocking === true, "空问题 → blocking（研究问题为必填项）");
  assert(/必填/.test(empty.hint), `空问题提示文案（实测「${empty.hint}」）`);

  const ok = checkResearchQuestion(Q_FULL);
  assert(ok.ok === true && ok.blocking === false && ok.missing.length === 0,
    "人群 + 行为齐备且长度足够 → 无待补要点");
  assert(/研究起点/.test(ok.hint), "明确的问题给出「可作为第二阶段研究起点」的正向反馈");

  const thin = checkResearchQuestion("为什么复购低");
  assert(thin.ok === false && thin.blocking === false, "不明确 → 只提示，**不阻断提交**");
  assert(thin.missing.some((m) => /人群/.test(m)), "未指明针对哪个人群 → 列出");
  assert(thin.missing.some((m) => /过短/.test(m)), `问题短于 ${QUESTION_MIN_LENGTH} 字 → 列出`);
  assert(thin.hint === QUESTION_CHECK_HINT && /无需重填机会材料/.test(thin.hint),
    "提示明确「只补问题、无需重填机会材料」（PRD-M1 F-03 功能描述）");

  const noBehavior = checkResearchQuestion("新客这个人群最近的表现怎么样呀");
  assert(noBehavior.missing.some((m) => /行为或结果/.test(m)), "未指明要检验的行为或结果 → 列出");
}

// ==================================================== ③ 提交校验：必填、机会存在、版本绑定、列长口径
console.log("③ 提交校验：必填与机会把关、版本号从机会现读、可选列超长拒绝不截断");
{
  const { db } = freshDb();
  await assertThrows(() => submitProposal(db, { research_question: Q_FULL, submitted_by: "PM" }),
    "缺机会 → 报错（人工节点须先选机会）", "opportunity_id 必填");
  await assertThrows(() => submitProposal(db, { opportunity_id: OPP_CANDIDATE, submitted_by: "PM" }),
    "缺研究问题 → 报错（研究问题必需）", "研究问题为必填项");
  await assertThrows(() => submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: "   ", submitted_by: "PM" }),
    "研究问题为空白 → 同样报错（trim 后为空）", "研究问题为必填项");
  await assertThrows(() => submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: Q_FULL }),
    "缺提交人 → 报错", "submitted_by 必填");
  await assertThrows(() => submitProposal(db, { opportunity_id: "OPP-NOPE", research_question: Q_FULL, submitted_by: "PM" }),
    "机会不存在 → 报错（MD-12 外键）", "机会不存在");

  // 版本绑定：机会 OPP-014 实为 v3，入参写 v2 → 拒绝（不混淆不同版本）
  await assertThrows(() => submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, submitted_by: "PM", goal_version_no: 2 }),
    "入参版本与机会版本不符 → 报错（版本号从机会现读）", "建议与机会版本必须一致");
  await assertThrows(() => submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, submitted_by: "PM", behavior_hypothesis: "甲".repeat(PROPOSAL_LIMITS.behavior_hypothesis + 1) }),
    `候选行为假设超 varchar(${PROPOSAL_LIMITS.behavior_hypothesis}) → 报错（不静默截断）`, "拒绝落库，不静默截断");
  await assertThrows(() => submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, submitted_by: "PM", population_limit: "乙".repeat(PROPOSAL_LIMITS.population_limit + 1) }),
    `人群限制超 varchar(${PROPOSAL_LIMITS.population_limit}) → 报错`, "拒绝落库，不静默截断");
}

// ==================================================== ④ TC-I-M1-002 幂等：同键不新建、不重复启动
console.log("④ TC-I-M1-002 重复提交幂等：建议与机会版本关联、同键不新建行、不重复启动相同任务");
{
  const { db, sqlite } = freshDb();
  const logBefore = countRows(sqlite, "opportunity_status_log");

  const first = await submitProposal(db, {
    opportunity_id: OPP_CANDIDATE, research_question: Q_FULL,
    behavior_hypothesis: "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）",
    population_limit: "仅限 APP 端", submitted_by: "PM", at: AT,
  });
  assert(first.created === true && first.idempotent === false, "首次提交 → 新建建议");
  assert(first.proposal.proposal_id === "PROP-001" && first.proposal.goal_version_no === 3,
    `建议号取号 + 绑定机会版本 v3（实测 ${first.proposal.proposal_id} / v${first.proposal.goal_version_no}）`);
  assert(first.proposal.research_question === Q_FULL, "研究问题原样保存（trim 后）");
  assert(first.proposal.submitted_at === AT, "submitted_at ＝提交时点（＝第二阶段启动时点）");
  assert(first.second_stage_start_at === AT, "第二阶段启动时点随返回值带出（F-04 取此处，不另取时钟）");
  assert(first.proposal.triggered_task_id === null, "触发任务由 F-04 登记，F-03 落行时为空");
  assert(countRows(sqlite, "research_proposal") === 1, "落一行 MD-12");
  assert(countRows(sqlite, "opportunity_status_log") === logBefore + 1, "PD-05 追加一行（机会状态变更留痕）");
  assert(first.status_changed === true && first.status.to_status === SUBMITTED_OPP_STATUS,
    `机会状态迁移为「已提交研究」（实测 ${first.status.from_status} → ${first.status.to_status}）`);

  const again = await submitProposal(db, {
    opportunity_id: OPP_CANDIDATE, research_question: `  ${Q_FULL}  `,
    behavior_hypothesis: "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）",
    population_limit: "仅限 APP 端", submitted_by: "PM", at: AT,
  });
  assert(again.created === false && again.idempotent === true, "同键再提 → 幂等（created=false）");
  assert(again.proposal.proposal_id === first.proposal.proposal_id, "幂等返回的是**既有**建议（同一行）");
  assert(countRows(sqlite, "research_proposal") === 1, "不新建建议行");
  assert(countRows(sqlite, "opportunity_status_log") === logBefore + 1, "不重复留痕（机会状态不重复刷）");
  assert(again.status_changed === false, "幂等路径不做状态迁移");
  assert(/不重复启动相同任务/.test(again.note), "幂等提示明说「不重复启动相同任务」");
  assert(again.idempotency_key === first.idempotency_key, "幂等键随返回值带出，可复核判定依据");

  // 不同问题 → 不同键 → 允许再提一份（这是「新的研究」，不是幂等命中）
  const another = await submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: `${Q_FULL}（第二问：入口×品类交叉）`, submitted_by: "PM", at: AT });
  assert(another.created === true && countRows(sqlite, "research_proposal") === 2, "改研究问题后 → 视为新建议，可再落一行");
  assert(another.status_changed === false, "机会已是「已提交研究」→ 不再重复迁移状态");

  // 反例：可选列留空 → 存 NULL（不是空串）
  const blank = await submitProposal(db, { opportunity_id: "OPP-013", research_question: Q_FULL, behavior_hypothesis: "   ", population_limit: "", submitted_by: "PM", at: AT });
  assert(blank.proposal.behavior_hypothesis === null && blank.proposal.population_limit === null,
    "可选列留空 → 存 NULL（可选列不写空串）");
  assert(blank.question_check.ok === true, "问题检查结果随提交返回值带出（提示不阻断，提交仍成功）");
}

// ==================================================== ⑤ 机会状态迁移与 PD-05 留痕
console.log("⑤ 机会状态迁移：候选→已提交研究（PD-05 一行）；已是该状态则跳过");
{
  const { db, sqlite } = freshDb();
  const before = countRows(sqlite, "opportunity_status_log");

  const sub = await submitProposal(db, { opportunity_id: OPP_SUBMITTED, research_question: Q_FULL, submitted_by: "PM", at: AT });
  assert(sub.created === true, "对已是「已提交研究」的机会提新建议 → 仍可落建议行");
  assert(sub.status_changed === false && sub.status.log_id === null,
    "机会状态已是「已提交研究」→ 跳过迁移、不重复留痕");

  const moved = await markOpportunitySubmitted(db, { opportunity_id: OPP_CANDIDATE, proposal_id: "PROP-999", by: "PM", at: AT });
  assert(moved.status_changed === true && moved.from_status === "candidate" && moved.to_status === SUBMITTED_OPP_STATUS,
    "candidate → submitted：迁移成立并回带前后状态");
  assert(/^LG-OPP-014-\d{3}$/.test(String(moved.log_id)), `留痕号确定性派生（实测 ${moved.log_id}）`);
  assert(countRows(sqlite, "opportunity_status_log") === before + 1, "只追加一行 PD-05（不改不删历史行）");

  const chain = await listOpportunityStatusLog(db, OPP_CANDIDATE);
  assert(chain.length === 1 && chain[0].to_status === SUBMITTED_OPP_STATUS, "状态变更链可回查（人工节点完成有据）");
  assert(/PROP-999/.test(chain[0].change_reason) && /人工节点完成/.test(chain[0].change_reason),
    "变更原因写清「谁在什么节点做了什么」");

  const skip = await markOpportunitySubmitted(db, { opportunity_id: OPP_CANDIDATE, proposal_id: "PROP-999", by: "PM", at: AT });
  assert(skip.status_changed === false && countRows(sqlite, "opportunity_status_log") === before + 1,
    "重复调用 → 幂等跳过（不重复刷状态与日志）");
  await assertThrows(() => markOpportunitySubmitted(db, { opportunity_id: "OPP-NOPE", proposal_id: "PROP-999", by: "PM" }),
    "机会不存在 → 报错", "机会不存在");
}

// ==================================================== ⑥ TC-D-M1-007 PD-05 外键反例
console.log("⑥ TC-D-M1-007（L3）`PD-05.opportunity_id` 指向不存在的机会 → FK 拒绝");
{
  const { db } = freshDb();
  const r = await db
    .prepare("INSERT INTO opportunity_status_log (log_id, opportunity_id, from_status, to_status, change_reason, changed_at, changed_by) VALUES (?, ?, NULL, ?, ?, ?, ?)")
    .bind("LG-9001", "OPP-NOPE", SUBMITTED_OPP_STATUS, "反例：不存在的机会", AT, "PM")
    .run();
  assert(r.success === false && /FOREIGN KEY/i.test(String(r.error)),
    `反例：opportunity_id='OPP-NOPE' → FK 失败（实测 ${String(r.error).slice(0, 40)}）`);
}

// ==================================================== ⑦ 触发登记：同一份建议不重复启动任务
console.log("⑦ `markProposalTriggered`：登记触发任务；同任务幂等、异任务拒绝（不重复启动）");
{
  const { db, sqlite } = freshDb();
  const sub = await submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, submitted_by: "PM", at: AT });
  const pid = sub.proposal.proposal_id;

  await assertThrows(() => markProposalTriggered(db, { task_id: "T-1022" }), "缺 proposal_id → 报错", "proposal_id 必填");
  await assertThrows(() => markProposalTriggered(db, { proposal_id: pid }), "缺 task_id → 报错", "task_id 必填");
  await assertThrows(() => markProposalTriggered(db, { proposal_id: "PROP-999", task_id: "T-1022" }),
    "建议不存在 → 报错", "研究建议不存在");
  await assertThrows(() => markProposalTriggered(db, { proposal_id: pid, task_id: "T-NOPE" }),
    "任务不存在 → 报错（不得挂到不存在的任务上）", "任务不存在");

  const t1 = await markProposalTriggered(db, { proposal_id: pid, task_id: "T-1022" });
  assert(t1.triggered === true && t1.already === false, "首次登记触发任务成立");
  assert((await getProposal(db, pid)).triggered_task_id === "T-1022", "MD-12 记下 triggered_task_id");

  const t2 = await markProposalTriggered(db, { proposal_id: pid, task_id: "T-1022" });
  assert(t2.already === true, "同一任务重复登记 → 幂等返回");

  await assertThrows(() => markProposalTriggered(db, { proposal_id: pid, task_id: "T-1023" }),
    "同一份建议换一个任务再登记 → 报错（不重复启动相同任务）", "不得重复启动相同任务");

  const pending = await listProposals(db, { triggered: false });
  assert(pending.length === 0, "已触发的建议不再出现在「未触发」列表");
  assert((await listProposals(db, { triggered: true })).length === 1, "可按已触发过滤");
  assert((await listProposals(db, { opportunity_id: OPP_CANDIDATE })).length === 1, "可按机会过滤");
  assert((await listProposals(db, { goal_id: Q3 })).length === 1, "可按目标过滤（经机会 join）");
  assert(countRows(sqlite, "research_proposal") === 1, "查询不改动建议行数");
}

// ==================================================== ⑧ 读模型
console.log("⑧ 读模型 `getProposalRecord`：建议 + 机会现状 + 状态链 + 版本一致性");
{
  const { db } = freshDb();
  const sub = await submitProposal(db, { opportunity_id: OPP_CANDIDATE, research_question: Q_FULL, submitted_by: "PM", at: AT });
  const rec = await getProposalRecord(db, sub.proposal.proposal_id);
  assert(rec.proposal.proposal_id === sub.proposal.proposal_id && rec.opportunity.opportunity_id === OPP_CANDIDATE,
    "建议与机会一并读出（可点开回查机会）");
  assert(rec.opportunity_status_log.length >= 1, "带出机会状态变更链");
  assert(rec.triggered === false, "未触发 → triggered=false");
  assert(rec.version_matched === true, "版本一致性可核（建议版本 == 机会版本）");
  await assertThrows(() => getProposalRecord(db, "PROP-999"), "建议不存在 → 报错", "研究建议不存在");
  assert((await nextProposalId(db)) === "PROP-002", "下一个建议号确定性递增（库内最大 +1）");
}

// ==================================================== ⑨ 写入面静态核验
console.log("⑨ 写入面静态核验：建行只落 MD-12、改行只落 MD-12 且带主键、机会改行经 F-10、零外部调用");
{
  const src = stripComments(readFileSync(MODULE_SRC, "utf8"));
  const inserts = new Set([...src.matchAll(/INSERT\s+INTO\s+([a-z_]+)/gi)].map((m) => m[1]));
  assert([...inserts].join(",") === "research_proposal", `本文件建行只落在 research_proposal（实测 ${[...inserts].join(",")}）`);
  const updates = [...src.matchAll(/UPDATE\s+([a-z_]+)\s+SET[^;`]*/gi)].map((m) => m[0]);
  assert(updates.length === 1, `本文件只有 1 处改行语句（触发任务登记）（实测 ${updates.length}）`);
  assert(/UPDATE\s+research_proposal\s+SET/.test(updates[0]) && /WHERE\s+proposal_id/.test(updates[0]),
    "该处分行只落在 research_proposal 且带主键条件");
  assert(!/UPDATE\s+opportunity\b/i.test(src), "机会状态改行不落在本文件（经 shared-context 的 F-10 单一写入面）");
  assert(!/\b(DELETE|DROP|TRUNCATE|ALTER)\b/i.test(src), "本文件不含删行 / 改结构语句");
  assert(!/fetch\(|https?:/.test(src), "本文件零外部调用（无 fetch / 无 URL）");
}

finish();
