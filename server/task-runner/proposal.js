/**
 * 文档卡（阶段3 · M1 · F-03 研究建议管理（人工节点） · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（**TC-I-M1-002 = PM 选机会＋提研究问题：建议与机会版本关联、
 *        重复提交幂等、缺研究问题拒绝提交**；**TC-D-M1-007 = `PD-05 opportunity_status_log` 的机会外键**）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-03（验收要点：① 建议与机会版本关联；② 重复提交幂等
 *        ——不重复启动相同任务）+ §4 关键规则 2（**人工节点不可越权**：M3→M4 之间必须由 PM 选机会、提问题，
 *        平台不自动交接）+ §5 验收总则（重复提交须幂等）
 *   ｜ `../../docs/01-brd/BRD.md` §3.1（人工节点是必需节点，不自动交接）+ §4 F-03
 *   ｜ `../../docs/03-locks/schema.md` MD-12 `research_proposal`（`proposal_id` PK；`opportunity_id` FK→MD-06；
 *        `goal_version_no` 逻辑关联 MD-02；`research_question` **必需**；`behavior_hypothesis` / `population_limit`
 *        可选且 `varchar(300)`；**`idempotency_key` UK，`varchar(128)`**；`submitted_at`＝提交时点＝第二阶段启动时点；
 *        `submitted_by`；`triggered_task_id` FK→PD-01）｜ MD-06 `opportunity.goal_version_no`（机会版本）
 *        ｜ PD-05 `opportunity_status_log`（机会状态变更逐次留痕）
 *   ｜ `../../prototype/pages/propose.html`（**钉死需求**：① 机会来自 F-28、**此处不可改**；② 研究问题必需、
 *        为空即拒；③ 不明确时列出「需补充的要点」（未指明人群 / 未指明行为或结果 / 过短），**只补问题、
 *        不要求重填已有材料**，且**不阻断提交**；④ 幂等键 = 机会 + 问题 + 假设 + 限制；⑤ 重复提交给出
 *        「已提交过、不会重复启动相同任务」提示）
 *   ｜ `../shared-context/index.js`（F-10 的机会读模型与 **PD-05 写入面**——本文件复用而不重写）
 * 职责：人工节点的产物登记与管理——校验「研究问题必需」→ **把建议绑定到机会的当前版本**（版本号从机会现读，
 *   不由入参决定）→ 按「机会 + 问题 + 假设 + 限制」的规范化摘要做**幂等**（同键不新建、不重复启动）→
 *   落 `MD-12` 一行 → 机会状态迁移为「已提交研究」并留 `PD-05` 一行；另含建议回查、
 *   「已触发任务」的**幂等守卫**（同一份建议不得重复启动任务）。
 * 边界：**不创建 HVA 任务**（调度归 F-04，本文件只提供 `markProposalTriggered` 的守卫与登记口）；
 *   机会的状态改行**经 F-10 的 `changeOpportunityStatus`**（单一写入面），本文件因而不含改 `opportunity` 的 SQL；
 *   不调外部接口（无 `fetch`）；平台**不替 PM 拟研究问题**（问题由人工给定，本文件只做提示）。
 * 门禁状态：无外部依赖（纯本地库读写 + Web Crypto 摘要）。
 *
 * 反向清单：被 `../api/index.js`（F-03 路由）引用；被本目录 F-04（HVA 研究任务调度）的「建议提交后启动」
 *   复用（**落地时补记**，反向清单只记既有事实）；登记 `./README.md` 与 `../README.md`；测试 `./test-f03.mjs`。
 */
import { getOpportunity, changeOpportunityStatus, listOpportunityStatusLog } from "../shared-context/index.js";
import { dictCodes } from "./step-plan.js";

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** 机会状态：已提交研究（值域仍在库内校验，不内联放行）。 */
export const SUBMITTED_OPP_STATUS = "submitted";

/**
 * `MD-12` 的列长口径（取自 `schema.md` MD-12「类型」列）。
 * `research_question` 为 `text`、不设长度；两个可选列 `varchar(300)`；幂等键 `varchar(128)`。
 */
export const PROPOSAL_LIMITS = {
  behavior_hypothesis: 300,
  population_limit: 300,
  idempotency_key: 128,
};

/** 幂等键前缀（`prop-` + SHA-256 十六进制 = 69 字符，落在 `varchar(128)` 内）。 */
export const IDEMPOTENCY_KEY_PREFIX = "prop-";

/** 幂等键算法标识（写进返回值，便于回查与跨环境一致）。 */
export const IDEMPOTENCY_ALGORITHM = "sha256(JSON[opportunity_id, research_question, behavior_hypothesis, population_limit])";

// ---------------------------------------------------------------- 幂等键

function norm(v) {
  return String(v ?? "").trim();
}

/**
 * 幂等键的**规范形式**（规范化原文，便于复核与调试）：四个字段各自 `trim` 后的 JSON 数组。
 * 用 JSON 而非 `A::B` 这类拼接，是为了**避免分隔符歧义**造出「不同建议算出同键」
 * （例如问题里本身含分隔符时，拼接式会与别的字段组合撞键；JSON 序列化对定长数组是单射）。
 */
export function canonicalProposalKey({
  opportunity_id,
  research_question,
  behavior_hypothesis = "",
  population_limit = "",
} = {}) {
  return JSON.stringify([norm(opportunity_id), norm(research_question), norm(behavior_hypothesis), norm(population_limit)]);
}

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * 由「机会 + 研究问题 + 假设 + 限制」算幂等键。
 * **确定性**：同输入必得同键（跨进程、跨环境一致）；**区分度**：任一字段不同即不同键；
 * 空白差异（前后空格）不产生新键（先 `trim` 再摘要）。
 */
export async function idempotencyKeyOf(input = {}) {
  const canonical = canonicalProposalKey(input);
  const key = `${IDEMPOTENCY_KEY_PREFIX}${await sha256Hex(canonical)}`;
  return { key, canonical, algorithm: IDEMPOTENCY_ALGORITHM, max_len: PROPOSAL_LIMITS.idempotency_key };
}

// ---------------------------------------------------------------- 研究问题检查

/** 人群 / 行为两组提示词（**逐字照录** `prototype/pages/propose.html` 的 `check()`，原型是钉死需求）。 */
export const QUESTION_CHECK_PATTERNS = {
  crowd: /人群|用户|新客|客群/,
  behavior: /行为|找品|搜索|加购|访问|复购|购买|下单/,
};

/** 问题过短的判定阈值（原型 `v.length < 15`）。 */
export const QUESTION_MIN_LENGTH = 15;

/** 「只补问题、不重填材料」的提示语（原型原文）。 */
export const QUESTION_CHECK_HINT = "只需在问题中补清这些内容，无需重填机会材料。";

/**
 * 研究问题的**不明确提示**（原型 `check()` 的同一套规则）：
 *   `blocking=false` 的提示**不阻断提交**——它只告诉 PM「还需要在问题里补清什么」，
 *   并明确「不要求重填已有材料」（PRD-M1 F-03 功能描述）。
 *   `blocking=true` 只有一种：问题为空（「研究问题为必填项」，原型提交时的拒收分支）。
 */
export function checkResearchQuestion(question) {
  const text = norm(question);
  if (!text) {
    return {
      provided: false,
      ok: false,
      blocking: true,
      missing: [],
      hint: "研究问题为必填项，请先填写后再提交。",
    };
  }
  const missing = [];
  if (!QUESTION_CHECK_PATTERNS.crowd.test(text)) missing.push("未指明针对哪个人群");
  if (!QUESTION_CHECK_PATTERNS.behavior.test(text)) missing.push("未指明要检验的行为或结果");
  if (text.length < QUESTION_MIN_LENGTH) missing.push("问题描述过短，难以确定查证方向");
  return {
    provided: true,
    ok: missing.length === 0,
    blocking: false,
    missing,
    hint: missing.length
      ? QUESTION_CHECK_HINT
      : "问题指向了明确的人群与行为，可作为第二阶段的研究起点。",
  };
}

// ---------------------------------------------------------------- MD-12 建议登记

/** 可选列：`trim` 后为空即存 `NULL`（可选列不写空串）；超 `varchar` 口径即报错，不静默截断。 */
function optionalField(raw, max, name) {
  const text = norm(raw);
  if (!text) return null;
  if (text.length > max) {
    throw new Error(`${name} 长 ${text.length} 字，超出 schema.md MD-12 的 varchar(${max}) 口径——拒绝落库，不静默截断`);
  }
  return text;
}

/** 下一个建议号：`PROP-` + 3 位补零（库内最大 +1，确定性、不撞号）。 */
export async function nextProposalId(db) {
  const rows = (await db.prepare("SELECT proposal_id FROM research_proposal").all()).results || [];
  let max = 0;
  for (const r of rows) {
    const m = /^PROP-(\d+)$/.exec(String(r.proposal_id || "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `PROP-${String(max + 1).padStart(3, "0")}`;
}

/**
 * 提交研究建议（`MD-12`，人工节点）。
 *
 * 顺序固定、每步都有明确拒绝理由：
 *   ① 必填校验——机会、**研究问题**、提交人（问题为空即拒：PRD-M1 F-03 / 原型拒收分支）；
 *   ② 机会必须真实存在（`MD-12.opportunity_id` 是 FK）；
 *   ③ **版本绑定**：`goal_version_no` 一律**从机会现读**；入参若给了别的版本 → 报错（不混淆不同版本）；
 *   ④ 可选列 `trim`（空→`NULL`）、超 `varchar` 口径报错；
 *   ⑤ **幂等**：同幂等键已存在 → 返回既有建议，`created=false`，**不新建行、不重复启动相同任务**；
 *   ⑥ 落一行 `MD-12`；再把机会状态迁移为「已提交研究」并留 `PD-05`（已是该状态则跳过，不重复留痕）。
 *
 * 返回值带回 `question_check`（不明确提示）与幂等键规范形式，让「为什么拒 / 为什么判为同一份」可见可核。
 */
export async function submitProposal(db, input = {}) {
  const opportunity_id = norm(input.opportunity_id);
  const research_question = norm(input.research_question);
  const submitted_by = norm(input.submitted_by);

  if (!opportunity_id) throw new Error("submitProposal：opportunity_id 必填（人工节点须先选机会；机会来自 F-28，此处不可改）");
  if (!research_question) throw new Error("submitProposal：研究问题为必填项，请先填写后再提交（research_question）");
  if (!submitted_by) throw new Error("submitProposal：submitted_by 必填（提交人＝产品经理）");

  const opportunity = await getOpportunity(db, opportunity_id);
  if (!opportunity) throw new Error(`机会不存在：${opportunity_id}（建议必须挂在真实机会上，MD-12 外键）`);

  const goal_version_no = Number(opportunity.goal_version_no);
  if (input.goal_version_no !== undefined && input.goal_version_no !== null && Number(input.goal_version_no) !== goal_version_no) {
    throw new Error(
      `建议与机会版本必须一致：入参 goal_version_no=${input.goal_version_no}，而机会 ${opportunity_id} 实为 v${goal_version_no}——` +
        "版本号从机会现读，不接受入参改写（不混淆不同版本）",
    );
  }

  const behavior_hypothesis = optionalField(input.behavior_hypothesis, PROPOSAL_LIMITS.behavior_hypothesis, "behavior_hypothesis");
  const population_limit = optionalField(input.population_limit, PROPOSAL_LIMITS.population_limit, "population_limit");

  const question_check = checkResearchQuestion(research_question);
  const { key, canonical } = await idempotencyKeyOf({
    opportunity_id,
    research_question,
    behavior_hypothesis,
    population_limit,
  });

  const existing = await db.prepare("SELECT * FROM research_proposal WHERE idempotency_key = ?").bind(key).first();
  if (existing) {
    return {
      created: false,
      idempotent: true,
      proposal: existing,
      idempotency_key: key,
      key_canonical: canonical,
      question_check,
      status_changed: false,
      note: "同一份研究建议已提交过：不新建建议行、不重复启动相同任务；如需新的研究，请修改研究问题或补充信息后再提交",
    };
  }

  const stamp = norm(input.at) || nowStamp();
  const proposal_id = norm(input.proposal_id) || (await nextProposalId(db));
  const r = await db
    .prepare(
      `INSERT INTO research_proposal
       (proposal_id, opportunity_id, goal_version_no, research_question, behavior_hypothesis, population_limit,
        idempotency_key, submitted_at, submitted_by, triggered_task_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
    )
    .bind(
      proposal_id, opportunity_id, goal_version_no, research_question, behavior_hypothesis, population_limit,
      key, stamp, submitted_by,
    )
    .run();
  if (r && r.success === false) throw new Error(r.error || "research_proposal 插入失败");

  const status = await markOpportunitySubmitted(db, { opportunity_id, proposal_id, by: submitted_by, at: stamp });

  return {
    created: true,
    idempotent: false,
    proposal: await getProposal(db, proposal_id),
    idempotency_key: key,
    key_canonical: canonical,
    question_check,
    opportunity_version: { goal_id: opportunity.goal_id, goal_version_no },
    status_changed: status.status_changed,
    status,
    // 第二阶段启动时点＝建议提交时刻（TC-I-M1-001 / MD-12 表注）——F-04 取本字段，不另取时钟。
    second_stage_start_at: stamp,
  };
}

/**
 * 机会进入「已提交研究」（人工节点完成的留痕）。
 * 复用 F-10 的 `changeOpportunityStatus`（**单一写入面**：改 `MD-06` + 追加 `PD-05`）——
 * 本文件因此不含改 `opportunity` 的 SQL。已是「已提交研究」时**跳过**（同一机会再提新建议不重复刷状态）。
 */
export async function markOpportunitySubmitted(db, { opportunity_id, proposal_id, by, at } = {}) {
  const statuses = await dictCodes(db, "OPP_STATUS");
  if (!statuses.includes(SUBMITTED_OPP_STATUS)) {
    throw new Error(`dict:OPP_STATUS 中不存在 '${SUBMITTED_OPP_STATUS}'——机会状态值域以库为准（实测：${statuses.join(" / ")}）`);
  }
  const opp = await getOpportunity(db, opportunity_id);
  if (!opp) throw new Error(`机会不存在：${opportunity_id}`);
  if (opp.opportunity_status === SUBMITTED_OPP_STATUS) {
    return {
      status_changed: false,
      from_status: opp.opportunity_status,
      to_status: SUBMITTED_OPP_STATUS,
      log_id: null,
      note: "机会已是「已提交研究」：不重复留痕",
    };
  }
  const out = await changeOpportunityStatus(db, {
    opportunity_id,
    to_status: SUBMITTED_OPP_STATUS,
    change_reason: `PM 提交研究建议（${proposal_id}，机会 ${opportunity_id}）：人工节点完成（选机会＋提研究问题），可启动二阶段 HVA 研究`,
    changed_by: by,
    changed_at: at || nowStamp(),
  });
  return { status_changed: true, ...out };
}

/** 建议回查（`MD-12`）。 */
export async function getProposal(db, proposal_id) {
  return db.prepare("SELECT * FROM research_proposal WHERE proposal_id = ?").bind(proposal_id).first();
}

/** 建议列表（`MD-12`），可按机会 / 目标 / 是否已触发任务过滤。 */
export async function listProposals(db, { opportunity_id, goal_id, triggered } = {}) {
  const where = [];
  const args = [];
  if (opportunity_id !== undefined) { where.push("p.opportunity_id = ?"); args.push(opportunity_id); }
  if (goal_id !== undefined) { where.push("o.goal_id = ?"); args.push(goal_id); }
  if (triggered === true) where.push("p.triggered_task_id IS NOT NULL");
  if (triggered === false) where.push("p.triggered_task_id IS NULL");
  const sql =
    "SELECT p.* FROM research_proposal p JOIN opportunity o ON o.opportunity_id = p.opportunity_id" +
    (where.length ? ` WHERE ${where.join(" AND ")}` : "") +
    " ORDER BY p.submitted_at, p.proposal_id";
  return (await db.prepare(sql).bind(...args).all()).results;
}

/**
 * 登记「本次建议触发了哪个 HVA 任务」（`MD-12.triggered_task_id`），并**守住幂等**：
 *   已有触发任务且与本次相同 → 幂等返回；已有且不同 → **报错**（同一份建议不得重复启动任务）。
 * `F-04` 启动任务后调用本函数；`task_id` 必须真实存在（`MD-12.triggered_task_id` 是 FK）。
 */
export async function markProposalTriggered(db, { proposal_id, task_id } = {}) {
  const pid = norm(proposal_id);
  const tid = norm(task_id);
  if (!pid) throw new Error("markProposalTriggered：proposal_id 必填");
  if (!tid) throw new Error("markProposalTriggered：task_id 必填（触发任务必须真实存在）");

  const proposal = await getProposal(db, pid);
  if (!proposal) throw new Error(`研究建议不存在：${pid}`);
  const task = await db.prepare("SELECT task_id FROM task WHERE task_id = ?").bind(tid).first();
  if (!task) throw new Error(`任务不存在：${tid}（不得把建议挂到不存在的任务上）`);

  if (proposal.triggered_task_id) {
    if (proposal.triggered_task_id === tid) {
      return { triggered: true, already: true, proposal_id: pid, task_id: tid };
    }
    throw new Error(
      `建议 ${pid} 已触发任务 ${proposal.triggered_task_id}，不得重复启动相同任务（本次请求 ${tid}）`,
    );
  }

  const r = await db
    .prepare("UPDATE research_proposal SET triggered_task_id = ? WHERE proposal_id = ?")
    .bind(tid, pid)
    .run();
  if (r && r.success === false) throw new Error(r.error || "research_proposal.triggered_task_id 更新失败");
  return { triggered: true, already: false, proposal_id: pid, task_id: tid };
}

// ---------------------------------------------------------------- 读模型

/** 建议一页读取（F-29 / F-04 消费）：建议行 + 机会现状 + 机会状态变更链 + 是否已触发任务。 */
export async function getProposalRecord(db, proposal_id) {
  const proposal = await getProposal(db, proposal_id);
  if (!proposal) throw new Error(`研究建议不存在：${proposal_id}`);
  const opportunity = await getOpportunity(db, proposal.opportunity_id);
  return {
    proposal,
    opportunity,
    opportunity_status_log: await listOpportunityStatusLog(db, proposal.opportunity_id),
    triggered: Boolean(proposal.triggered_task_id),
    version_matched: opportunity ? Number(opportunity.goal_version_no) === Number(proposal.goal_version_no) : false,
  };
}
