/**
 * 文档卡（阶段4 · M3 · F-15 基础查证 · 2026-09-20）
 * 上游：../../../docs/02-prd/PRD-M3-机会发现Agent.md（F-15 §「基础查证」L78-85：五项检查＝来源 / 适用范围 / 信息时点 / 已有机会 / 信息缺口；
 *         L27 工作方式「请求工具查询（经工具执行程序 M5）→ 对返回结果做基础查证」；L83 关联 schema＝CFG-05 gap_rule 落库五查口径；
 *         L84 数据源＝CDP/HJE/PIM（+必要基础统计））
 *   ｜ ../../../docs/01-brd/BRD.md §4 F-15（L191-195：Agent 选择需核对的信息 → 程序实际执行查询或必要基础统计 → 结果及来源返回；
 *         验收＝对现象的解释必须标明尚未验证的部分，支持「值得进一步研究」，不给完整人群对照与 HVA 结论）
 *   ｜ ../../../docs/05-test-cases/test-M3.md（**TC-A-M3-002**（L4·F-15：S-A2 经 M5 真实查询→分析返回→记录任务；**禁止以模型预期内容代替查询结果**）｜
 *        **TC-A-M3-005**（L4·F-15/F-16：边界·missing-field——缺字段按只松不严不硬映射，退回请补而非静默回退或编造）｜
 *        **TC-A-M3-006**（L4·F-15：边界·price-conflict 倒挂隔离——证据信息时点晚于取数时刻→仅该证据失效，非整包失败）｜
 *        **TC-I-M3-002**（L5·F-15：所有外部查询经 M5，只读、不调生产写接口））
 *   ｜ ../../../docs/03-locks/schema.md（CFG-05 gap_rule；EXT-02 evidence 四要素；§12 Q-10/Q-11）
 *   ｜ ../../../docs/04-plan/dev-plan.md（阶段4 · M3：F-13~F-17）
 * 职责：F-15 基础查证——M3 机会发现 Agent 的「查证」核心。
 *   - `runMetricVerification`（S-A2 指标查证一次闭环：识别工具 → 经 M5 真实请求执行 → 分析返回 → 记录任务，输出「带来源与时点的查询事实」）
 *   - `verifyFiveChecks`（五项检查：来源 / 适用范围 / 信息时点 / 已有机会 / 信息缺口）
 *   - `isolateContradictedEvidence`（TC-A-M3-006 倒挂隔离：只让倒挂那条失效，不整包失败）
 *   - `resolveMissingFields`（TC-A-M3-005 只松不严不硬映射：缺字段退回请补，不静默回退、不编造）
 *   - `buildTentativeExplanation`（初步解释：一律标明「尚未验证」，支持「值得进一步研究」，不下 HVA 判断）
 *   - `buildEvidenceDraft` / `recordVerificationEvidence`（装配 EXT-02 形态草稿；落库复用 F-09 `createEvidence` 单一写入面）
 *   - `verifyClueAndDraftEvidence`（F-15 一步编排：线索 → 查证后的初步依据）
 *
 * 硬红线（与 `server/README.md` / `AGENTS.md` 同一口径）：
 *   ① **禁止以模型预期内容代替查询结果**（TC-A-M3-002）：`result_summary` 一律原样透传自 M5 信封；
 *      只有 `result_status='ok'` 才置 `verified=true`。调用方传入的 `model_expectation` / `expected_summary` 被**显式忽略**，
 *      并在返回值里留 `used_model_expectation:false` 供静态/运行期核查。
 *   ② **零外部调用**：本文件不含 `fetch(`；所有外部访问一律经 M5（`../tool-executor/index.js`）——TC-I-M3-002「查询经 M5、只读」。
 *   ③ **零写语句**：本文件不含任何 `INSERT` / `UPDATE` / `DELETE`；
 *      EXT-01 落痕由 M5 的 `runQueryWithRecovery` 承接，EXT-02 证据由 F-09 `createEvidence` 承接（**单一写入面复用**）。
 *   ④ 不复制中文枚举：口径规则来自库内 CFG-05（`is_active=1`），不内联业务字典。
 * 边界（mock/demo 推进，demo 值不进断言）：真实推理（把自然语言线索转成待查指标＋范围）须 LLM（`external-deps` A-1 ⬜ 未提供），
 *   本文件提供**确定性编排**并在门禁关闭前只用**注入返回体**（transport 注入）验证结构契约；TC-A-M3-002 的真实产出契约登记为「门禁未关闭、非发布门禁」。
 * 反向清单：登记 `./README.md` 与 `../../server/README.md`；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f15.mjs）。
 *
 * 用法：import { runMetricVerification, verifyFiveChecks, isolateContradictedEvidence } from "./verification.js";
 */

import {
  runQueryWithRecovery,
  RETRY_OUTCOME,
} from "../tool-executor/index.js";
import {
  createEvidence,
  listOpportunities,
  validateEvidenceCompleteness,
} from "../shared-context/index.js";

/** 五查的字段名（本文件唯一的「结构契约」常量，非业务值域——值域在库内 CFG-05 / dict）。 */
export const FIVE_CHECKS = [
  "source",
  "applicability",
  "info_time_point",
  "existing_opportunity",
  "gap",
];

/**
 * 从自由文本里抽出可比较的时点戳（`YYYY-MM-DD HH:MM`，缺时刻补 `00:00`）。
 * 用途：判断「证据信息时点」是否晚于「取数时刻」（倒挂）。
 * 返回 `null` 表示文本里没有可识别时点（此时**不做倒挂判定**，不猜）。
 */
export function parseStamp(text) {
  if (text === null || text === undefined) return null;
  const m = /(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(text));
  if (!m) return null;
  const mo = String(m[2]).padStart(2, "0");
  const da = String(m[3]).padStart(2, "0");
  const hh = m[4] === undefined ? "00" : String(m[4]).padStart(2, "0");
  const mi = m[5] === undefined ? "00" : m[5];
  return `${m[1]}-${mo}-${da} ${hh}:${mi}`;
}

/** `match_pattern` 按 CFG-05 口径当正则用（与 `task-runner/goal.js` 的 `checkGoalGaps` 同语义）；正则不合法时退化为子串匹配。 */
function patternHit(text, pattern) {
  try {
    return new RegExp(pattern).test(text);
  } catch {
    return String(text).includes(String(pattern));
  }
}

/** 读 CFG-05 生效口径规则（`is_active=1`）。**只读**，与 `goal.js` 同一真源（库），不内联字典。 */
async function listActiveGapRules(db) {
  if (!db) return [];
  const rows = await db
    .prepare("SELECT rule_id, target_field, match_pattern, gap_text, impact_note FROM gap_rule WHERE is_active = 1 ORDER BY rule_id")
    .all();
  return rows.results || [];
}

// ================================================================== S-A2 指标查证一次闭环

/**
 * S-A2 指标查证（TC-A-M3-002）：识别工具 → **经工具执行程序（M5）真实请求执行** → 分析返回 → 记录任务。
 *
 * 「记录任务」由 M5 的 `runQueryWithRecovery` 承接（EXT-01 落痕 + 失败/受限时 PD-01/PD-03 任务态处置），
 * 本函数不重复落库——这正是「查询经 M5」的单一入口。
 *
 * @param {object} db D1 形态
 * @param {object} p { task_id(必填), tool_id|tool_code(二选一), grantee_type, grantee_ref, query_condition,
 *                     at, transport, retry_limit, source_id, message_id,
 *                     model_expectation, expected_summary ← 二者**显式忽略**（白盒证明：不以模型预期代替查询结果） }
 * @returns {Promise<object>} 查询事实（`verified` 只在真实 `ok` 时为 true；`result_summary` 原样透传）
 */
export async function runMetricVerification(db, params = {}) {
  const {
    task_id,
    tool_id = null,
    tool_code = null,
    grantee_type = "hva-agent",
    grantee_ref = null,
    query_condition = {},
    at = null,
    transport,
    retry_limit,
    source_id = null,
    message_id = null,
    // —— 以下两项**刻意接收后丢弃**：用于证明「模型预期不参与查询事实的构造」
    model_expectation = null,
    expected_summary = null,
  } = params;

  if (!task_id) {
    throw new Error("runMetricVerification 缺必填项：task_id（查询事实须归属真实任务，EXT-01 每条查询须有归属）");
  }
  if (!tool_id && !tool_code) {
    throw new Error("runMetricVerification 缺必填项：tool_id 或 tool_code（S-A2 须先识别要调度的工具）");
  }

  const res = await runQueryWithRecovery(db, {
    task_id,
    source_id,
    message_id,
    tool_id,
    tool_code,
    grantee_type,
    grantee_ref,
    query_condition,
    at: at || undefined,
    transport,
    retry_limit,
  });

  const env = res.envelope || {};
  const ok = env.result_status === "ok";
  const restricted = res.outcome === RETRY_OUTCOME.restricted || env.restricted_flag === 1;
  const four = env.four_elements || {};
  const hadModelExpectation = model_expectation !== null && model_expectation !== undefined
    || expected_summary !== null && expected_summary !== undefined;

  return {
    // —— 真实查询事实：来源 + 时点，**全部来自 M5 信封**
    ok,
    verified: ok, // 硬红线：只有真实 ok 才敢说「已验证」
    result_status: env.result_status ?? null,
    result_summary: ok ? env.result_summary ?? null : null, // 失败时 schema 规定为空，原因进 fail_reason
    returned_rows: env.returned_rows ?? null,
    query_id: res.query_id ?? null,
    persisted: res.persisted === true,
    persist_skip: res.persist_skip ?? null,
    task_id,
    tool_code: (env.tool && env.tool.tool_code) || tool_code || null,
    source_id: env.source_id ?? source_id ?? null,
    query_condition: four.condition ?? null,
    queried_at: env.queried_at ?? at ?? null, // 取数时刻（倒挂判定的基准）
    info_time_point: four.time_point ?? null,
    limits: four.limits ?? [],
    restricted,
    fail_reason: ok ? null : (env.fail_reason ?? "未给出具体原因"),
    attempts: res.attempts ?? [],
    retried: res.retried ?? 0,
    retry_limit: res.retry_limit ?? null,
    outcome: res.outcome ?? null,
    recovery: res.recovery ?? null,
    // —— 硬红线自我声明（可被静态/运行期核查）
    used_model_expectation: false,
    model_expectation_ignored: hadModelExpectation,
    note: ok
      ? "查询事实来自工具执行程序（M5）的真实返回：result_summary 原样透传，未做任何模型填充"
      : `未取得可用数据（${env.result_status ?? "未知"}）：只回报真实原因，不用模型预期填充（失败不否定研究，但也不替代查询结果）`,
  };
}

// ================================================================== 五项检查

/**
 * 五项检查（BRD §4 F-15 / PRD-M3 L80）：来源 / 适用范围 / 信息时点 / 已有机会 / 信息缺口。
 *
 * - 来源：哪份资料哪次查询（`query_id` + `source_id`，可回查）
 * - 适用范围：人群、渠道、旅程环节是否对应当前目标（目标未声明范围时记为**未知**，不猜）
 * - 信息时点：业务条件是否已变化；**倒挂判定**（证据信息时点晚于取数时刻 → 该证据失效）
 * - 已有机会：是否记录过相同问题（按关键词与已有机会标题/现象比对，命中的列出并建议关联更新）
 * - 信息缺口：还缺什么、缺失影响哪项判断（口径取自 CFG-05 `gap_rule`，未命中的规则即开放缺口）
 *
 * 所有解释都是**结构性标注**，不下 HVA 判断（BRD §4 验收）。
 *
 * @param {object} db D1 形态（可传 null：则「已有机会」比对跳过）
 * @param {object} p { fact(必填，查询事实或含分析字段的线索事实), goal, at(必填，取数时刻) }
 */
export async function verifyFiveChecks(db, { fact, goal = {}, at } = {}) {
  if (!fact || typeof fact !== "object") {
    throw new Error("verifyFiveChecks 缺必填项：fact（待查证的查询事实）");
  }
  const when = at || fact.queried_at || null;
  if (!when) {
    throw new Error("verifyFiveChecks 缺必填项：at（取数时刻——倒挂判定与「信息时点」检查的基准）");
  }

  const scopeText = [fact.applicability_scope, fact.query_condition].filter(Boolean).join("；");

  // ① 来源（哪份资料哪次查询）
  const source = {
    ok: Boolean(fact.query_id && fact.source_id),
    query_id: fact.query_id ?? null,
    source_id: fact.source_id ?? null,
    tool_code: fact.tool_code ?? null,
    detail: fact.query_id
      ? `来源 ${fact.source_id ?? "未登记"} 的第 ${fact.query_id} 次查询（工具 ${fact.tool_code ?? "未登记"}）`
      : "未取得查询记录——来源不可回查，不构成有效依据",
  };

  // ② 适用范围（人群、渠道、旅程环节是否对应当前目标）
  const wanted = [goal.business_scope, goal.scope].filter((v) => v !== null && v !== undefined && String(v).trim() !== "");
  const scopeHit = wanted.length === 0 ? null : wanted.some((w) => scopeText.includes(String(w)));
  const applicability = {
    ok: scopeHit === true,
    decided: scopeHit !== null,
    goal_scope: wanted[0] ?? null,
    fact_scope_text: scopeText || null,
    detail: scopeHit === null
      ? "目标未声明业务范围 / 渠道，无法判定适用范围是否对应（记为未知，不猜测）"
      : scopeHit
        ? `适用范围与目标范围一致（命中「${wanted.join("、")}」）`
        : `适用范围未命中目标范围（目标声明：${wanted.join("、")}）——须回到目标口径确认`,
  };

  // ③ 信息时点（业务条件是否已变化 / 倒挂）
  const infoStamp = parseStamp(fact.info_time_point);
  const fetchStamp = parseStamp(when);
  const inverted = Boolean(infoStamp && fetchStamp && infoStamp > fetchStamp);
  const info_time_point = {
    ok: Boolean(infoStamp) && !inverted,
    inverted,
    info_stamp: infoStamp,
    fetched_at: fetchStamp,
    detail: inverted
      ? `信息时点（${infoStamp}）晚于取数时刻（${fetchStamp}）——证据倒挂，按隔离模式仅该条失效`
      : infoStamp
        ? `信息时点 ${infoStamp}，未晚于取数时刻（${fetchStamp}）；业务条件是否已变化仍须确认`
        : "证据未标注可识别的信息时点——时点无法对齐",
  };

  // ④ 已有机会（是否记录过相同问题）
  const keywords = Array.isArray(fact.keywords) ? fact.keywords.filter((k) => k !== null && k !== undefined && String(k).trim() !== "") : [];
  const minHits = keywords.length >= 2 ? 2 : 1;
  const matches = [];
  if (keywords.length > 0 && db) {
    const opps = await listOpportunities(db, { goal_id: goal.goal_id ?? null });
    for (const o of opps) {
      const hay = `${o.opportunity_title || ""} ${o.phenomenon || ""}`;
      const hits = keywords.filter((k) => hay.includes(String(k)));
      if (hits.length >= minHits) {
        matches.push({ opportunity_id: o.opportunity_id, opportunity_status: o.opportunity_status ?? null, hits, hit_count: hits.length });
      }
    }
    matches.sort((a, b) => b.hit_count - a.hit_count || String(a.opportunity_id).localeCompare(String(b.opportunity_id)));
  }
  const existing_opportunity = {
    ok: true, // 比对动作本身不做对错判定；重复与否只是结论
    duplicate_suspected: matches.length > 0,
    matches,
    keywords,
    min_hits: minHits,
    detail: matches.length > 0
      ? `疑似与已有机会重复：${matches.map((m) => m.opportunity_id).join("、")}（命中关键词 ${matches[0].hits.join("、")}）——应关联更新而非新建`
      : keywords.length > 0
        ? "按关键词比对，未发现与已有机会重复"
        : "未提供关键词，未做重复比对（缺口：无法判断是否记录过相同问题）",
  };

  // ⑤ 信息缺口（还缺什么、缺失影响哪项判断）—— 口径取自 CFG-05
  const rules = await listActiveGapRules(db);
  const gapText = [goal.business_goal, goal.metric_definition, scopeText, fact.missing_note]
    .filter((v) => v !== null && v !== undefined && String(v).trim() !== "")
    .join("；");
  const open_gaps = [];
  for (const r of rules) {
    if (!patternHit(gapText, r.match_pattern)) {
      open_gaps.push({ rule_id: r.rule_id, target_field: r.target_field, gap_text: r.gap_text, impact_note: r.impact_note });
    }
  }
  const gap = {
    ok: true, // 「缺口已标注」——开放缺口一律显式列出（空数组也是显式结论）
    rules_checked: rules.length,
    open_gaps,
    missing_note: fact.missing_note ?? null,
    detail: open_gaps.length > 0
      ? `仍有 ${open_gaps.length} 项待补：${open_gaps.map((g) => g.gap_text).join("；")}`
      : rules.length > 0
        ? "按口径规则逐条核对，未发现待补项（仍需人工确认）"
        : "未读取到生效口径规则（CFG-05 为空），缺口无法按规则核对",
  };

  const checks = { source, applicability, info_time_point, existing_opportunity, gap };
  const decided = {
    source: source.ok,
    applicability: applicability.decided ? applicability.ok : false,
    info_time_point: info_time_point.ok,
    existing_opportunity: true,
    gap: true,
  };

  return {
    checks,
    decided,
    // 「五项检查齐全」＝ 五项都给出了肯定判定（来源可回查 / 范围对得上 / 时点不倒挂 / 已比过已有机会 / 缺口已标注）
    all_present: Object.values(decided).every(Boolean),
    contradicted: inverted,
    verified: Boolean(fact.verified),
    note: "五项检查为结构性标注：只说明依据的来源与边界，不下 HVA 判断",
  };
}

// ================================================================== 倒挂隔离（TC-A-M3-006）

/**
 * 边界·price-conflict（倒挂隔离模式）：证据的信息时点**晚于取数时刻** → 视为倒挂。
 * 处置：**仅该条证据失效**（商品/实体级隔离），**其余证据照常参与**，**不整包失败**。
 *
 * @param {Array} items 每条 { evidence_id?, info_time_point?, ... }
 * @param {object} opts { at(必填，取数时刻) }
 * @returns {{ kept:Array, isolated:Array, batch_failed:boolean, note:string }}
 */
export function isolateContradictedEvidence(items, { at } = {}) {
  if (!Array.isArray(items)) {
    throw new Error("isolateContradictedEvidence 入参须为证据数组");
  }
  if (!at) {
    throw new Error("isolateContradictedEvidence 缺必填项：at（取数时刻——倒挂判定的基准）");
  }
  const base = parseStamp(at);
  const kept = [];
  const isolated = [];
  for (const it of items) {
    const item = it && typeof it === "object" ? it : {};
    const s = parseStamp(item.info_time_point ?? item.info_time ?? null);
    if (s && base && s > base) {
      isolated.push({
        ...item,
        isolated: true,
        isolate_reason: "info_time_point_after_fetch",
        info_stamp: s,
        fetched_at: base,
        note: "该条证据信息时点晚于取数时刻，按倒挂隔离模式单独失效",
      });
    } else {
      kept.push({ ...item, isolated: false });
    }
  }
  return {
    kept,
    isolated,
    batch_failed: false, // 倒挂是「单条失效」而非「整包失败」
    note: isolated.length > 0
      ? `倒挂隔离：${isolated.length} 条证据的信息时点晚于取数时刻，已单独失效；其余 ${kept.length} 条照常参与`
      : "无倒挂证据，全部照常参与",
  };
}

// ================================================================== missing-field 只松不严不硬映射（TC-A-M3-005）

/**
 * 边界·missing-field：输出缺某字段时按**只松不严不硬映射**处置——
 * 退回请补（`action='request_supplement'`），**不静默回退、不编造**。
 *
 * @param {object} draft 待采用的草稿
 * @param {Array<string>} requiredFields 必填字段名（须显式列出，不隐式取默认）
 * @returns {{ action:'accept'|'request_supplement', missing:string[], draft:object|null, note:string, guidance?:string }}
 */
export function resolveMissingFields(draft, requiredFields) {
  if (!draft || typeof draft !== "object") {
    throw new Error("resolveMissingFields 缺必填项：draft（待采用的草稿对象）");
  }
  if (!Array.isArray(requiredFields) || requiredFields.length === 0) {
    throw new Error("resolveMissingFields 缺必填项：requiredFields（须显式列出必填字段，不隐式取默认）");
  }
  const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";
  const missing = requiredFields.filter((f) => isBlank(draft[f]));
  if (missing.length === 0) {
    return { action: "accept", missing: [], draft, note: "必填字段齐全，可直接采用" };
  }
  return {
    action: "request_supplement",
    missing,
    draft: null, // 不返回半成品——避免「静默回退」把缺项伪装成已完成
    note: `缺 ${missing.length} 个必填字段（${missing.join("、")}）——退回请补，不静默回退、不编造`,
    guidance: "按公共业务指令「引用证据须带来源/条件/时点/适用范围」补齐；若素材虽已过审但查不到，同样退回请补",
  };
}

// ================================================================== 初步解释与证据草稿

/** 结论性措辞（本文件产出的初步解释里**不得**出现——BRD §4 F-15 验收：不下 HVA 判断 / 不给完整人群对照）。 */
export const FORBIDDEN_CONCLUSION_PATTERNS = ["已确认", "已证实", "可以确认", "必然", "结论为", "证明该"];

/**
 * 初步解释（BRD §4 F-15 验收）：一律标明「尚未验证」的部分，支持「值得进一步研究」，
 * **不给完整人群对照、不下 HVA 判断**。
 */
export function buildTentativeExplanation(fact, checks) {
  const f = fact || {};
  const c = checks && checks.checks ? checks.checks : {};
  const phenomenon = f.verified && f.result_summary ? f.result_summary : "本轮未取得可用数据，现象无法描述";
  const src = c.source?.detail || "来源未登记";
  const scope = c.applicability?.fact_scope_text || f.applicability_scope || "未标注适用范围";
  const when = c.info_time_point?.detail || "时点未标注";
  const gaps = c.gap?.open_gaps || [];
  const dup = c.existing_opportunity?.duplicate_suspected
    ? `已有机会里存在疑似同一问题（${(c.existing_opportunity.matches || []).map((m) => m.opportunity_id).join("、")}）。`
    : "";

  return [
    `现象：${phenomenon}`,
    `依据来源：${src}；适用范围：${scope}；信息时点：${when}。`,
    dup ? `${dup}` : "",
    gaps.length > 0
      ? `尚未验证 / 信息缺口：${gaps.map((g) => `${g.gap_text}（影响：${g.impact_note}）`).join("；")}。`
      : "尚未验证：本轮未按口径规则发现待补项，但现象与人群差异的关系仍未经验证。",
    "性质标注：以上为初步解释（尚未验证的部分已如上述），支持「值得进一步研究」；本轮不给完整人群对照、不下 HVA 判断。",
  ].filter((s) => s !== "").join("");
}

/**
 * 装配 EXT-02 `evidence` 形态的证据草稿（供 F-16 采用；**本函数不落库**）。
 * 倒挂证据**不予采用**（返回 `ok:false` + 原因），以免把失效证据写成依据。
 */
export function buildEvidenceDraft({ fact, checks, evidence_id = null, evidence_title = null, created_at = null } = {}) {
  const f = fact || {};
  const c = checks && checks.checks ? checks.checks : {};
  if (checks && checks.contradicted) {
    return {
      ok: false,
      draft: null,
      completeness: { valid: false, missing: [], missing_labels: [] },
      reason: "contradicted_evidence_isolated",
      note: "证据倒挂（信息时点晚于取数时刻）——单条失效，不写成依据",
    };
  }
  const draft = {
    evidence_id,
    query_id: f.query_id ?? null,
    source_id: f.source_id ?? null,
    evidence_title: evidence_title || (f.result_summary ? String(f.result_summary).slice(0, 40) : "（待补标题）"),
    query_condition: f.query_condition ?? "",
    info_time_point: f.info_time_point ?? "",
    applicability_scope: f.applicability_scope ?? c.applicability?.fact_scope_text ?? "",
    result_summary: f.result_summary ?? "",
    missing_note: f.missing_note ?? (c.gap?.open_gaps?.length ? c.gap.open_gaps.map((g) => g.gap_text).join("；") : ""),
    created_at,
  };
  const completeness = validateEvidenceCompleteness(draft);
  return {
    ok: completeness.valid,
    draft,
    completeness,
    reason: completeness.valid ? null : "evidence_four_elements_incomplete",
    note: completeness.valid
      ? "证据四要素齐全，可交 F-09 单一写入面落 EXT-02"
      : `证据四要素不齐（缺：${completeness.missing_labels.join("、")}）——不可作为有效依据`,
  };
}

// ================================================================== 一步编排

/**
 * F-15 一步编排：**线索 → 经 M5 真实查询 → 五项检查 → 查证后的初步依据**。
 *
 * 只在**真实 `ok`** 时才产出证据草稿；失败 / 受限只回报真实原因与缺口（失败不否定研究，
 * 但也**不以模型预期代替查询结果**——即使调用方传了 `model_expectation`）。
 *
 * @param {object} db D1 形态
 * @param {object} p { clue:{ applicability_scope?, missing_note?, keywords?, phenomenon?, evidence_title? },
 *                     goal:{ goal_id?, business_scope?, business_goal?, metric_definition? },
 *                     at, evidence_id, created_at, ...其余透传 runMetricVerification }
 */
export async function verifyClueAndDraftEvidence(db, params = {}) {
  const { clue = {}, goal = {}, evidence_id = null, created_at = null, ...queryParams } = params;

  const fact0 = await runMetricVerification(db, queryParams);
  // 分析字段（范围 / 缺口 / 关键词 / 更精确的覆盖时点）来自线索侧；**测量值**来自 M5 信封——两者不互相顶替。
  // `info_time_point` 允许线索侧覆盖：分析步骤可从返回体 `data.coverage.actual` 读出**实际覆盖区间**，
  //   比信封里的取数时刻更贴近「信息时点」；未提供时沿用信封时点（倒挂与否由五项检查判定，不由调用方说了算）。
  const fact = {
    ...fact0,
    applicability_scope: clue.applicability_scope ?? null,
    missing_note: clue.missing_note ?? null,
    keywords: clue.keywords ?? [],
    phenomenon: clue.phenomenon ?? null,
    info_time_point: clue.info_time_point ?? fact0.info_time_point,
  };

  if (!fact.ok) {
    return {
      verified: false,
      fact,
      checks: null,
      evidence: null,
      explanation: buildTentativeExplanation(fact, null),
      missing: resolveMissingFields(
        { query_id: fact.query_id, source_id: fact.source_id, info_time_point: fact.info_time_point, applicability_scope: fact.applicability_scope, result_summary: fact.result_summary, missing_note: fact.missing_note },
        ["query_id", "source_id", "info_time_point", "applicability_scope", "result_summary", "missing_note"],
      ),
      note: "未取得真实返回：只回报真实原因与缺口，不产出依据（不编造）",
    };
  }

  const checks = await verifyFiveChecks(db, { fact, goal, at: params.at || fact.queried_at });
  const evidence = buildEvidenceDraft({
    fact,
    checks,
    evidence_id,
    evidence_title: clue.evidence_title ?? null,
    created_at,
  });
  return {
    verified: true,
    fact,
    checks,
    evidence,
    explanation: buildTentativeExplanation(fact, checks),
    note: "已取得真实返回：五项检查完成，证据草稿待 F-16 采用",
  };
}

/**
 * 把证据草稿落 EXT-02。**复用 F-09（M2）的 `createEvidence` 单一写入面**——
 * 本文件不含任何写语句（四要素不齐时由 `createEvidence` 直接 fail，不落库）。
 */
export async function recordVerificationEvidence(db, draft) {
  if (!draft || typeof draft !== "object") {
    throw new Error("recordVerificationEvidence 缺必填项：draft（EXT-02 形态证据草稿）");
  }
  return createEvidence(db, draft);
}
