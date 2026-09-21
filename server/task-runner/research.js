/**
 * 文档卡（阶段4 接线 · M4 · F-33 · HVA 研究任务步骤执行体 · 2026-09-21）
 * 上游：`../../docs/04-plan/full-flow-wiring-plan.md`（**F-33 = M4 执行体接线**：断点 P0-1「M4 执行体不存在」
 *        ——`executor.js` 非 discovery 即抛、cron 选取硬写 `task_type='discovery'`、`index.js` 走 `delegateToAgent`
 *        占位；七要素组装 F-19~F-21 早已实现，唯一调用者是 HTTP POST，无自动路径）
 *   ｜ `../../docs/04-plan/dev-plan.md`（阶段 4「接线进展」：M4 真实执行体接线归属本工作项）
 *   ｜ `../../docs/05-test-cases/test-M4.md`（**TC-A-M4-001** S-B1 三分支起点；**TC-A-M4-003** S-B3 候选行为五查＋
 *        倒挂隔离；**TC-A-M4-004** S-B4 七要素齐备并保存；**TC-A-M4-005** 失败不否定；**TC-I-M4-002** 查询经 M5 只读；
 *        **TC-I-M4-003** 适合性判断（⚠️门禁 A-1，登记为「门禁未关闭、非发布门禁」））
 *   ｜ `../../docs/03-locks/schema.md`（PD-01 `task`、PD-02 `task_step`＝进度真源、MD-07 `research`、MD-08/MD-09/MD-10/MD-11、
 *        EXT-01 `query_record`、EXT-02 `evidence`、LNK-02/LNK-04；`STEP_STATE` 值域只有 pending/active/done/blocked）
 *   ｜ `../../docs/03-locks/external-deps.md`（A-1 门禁 → 语义判断走「可注入判据 + 确定性 fallback」）
 *   ｜ `../../docs/01-brd/BRD.md` §5.3 硬红线 / §7 第 4 条（失败不否定结论）
 *   ｜ `./step-plan.js`（PD-02 步骤计划/推进/进度串唯一写入面；`TYPE_STEPS.hva_research` 五步名逐字钉死）
 *   ｜ `../tool-executor/task-state.js`（F-26 任务态写入面：blocked/done 跃迁、PD-03 受阻留痕）
 *   ｜ `../tool-executor/index.js`（F-25 `listQueryRecords`：EXT-01 逐任务回查——步 ②/⑤ 的确定性事实来源）
 *   ｜ `../agent-orchestrator/research-start.js`（**F-19**：`loadResearchStartContext` 薄读 + `assembleResearchStart`
 *        三分支路径与查证顺序——只调用、不改其语义）
 *   ｜ `../agent-orchestrator/behavior.js`（**F-20**：`queryForBehaviorCheck`＝唯一取数出口（经 M5）、`formCandidateBehavior`
 *        ＝MD-09/MD-10 落库编排、`assembleBehaviorVerification`＝五查一步编排（纯计算）、`ALTERNATIVE_DIMENSIONS` 维度真源）
 *   ｜ `../agent-orchestrator/behavior-store.js`（**F-20 写入面**：MD-09/MD-10——本文件**只读**复用其读面）
 *   ｜ `../agent-orchestrator/verification.js`（F-15：`buildEvidenceDraft` + `recordVerificationEvidence` 落 EXT-02）
 *   ｜ `../agent-orchestrator/result.js`（**F-21**：`assembleResearchResult` 七要素组装＝纯计算；`saveResearchReport`
 *        ＝MD-07 内容填充 + MD-08 + LNK-02 + MD-11 落库编排）
 *   ｜ `../agent-orchestrator/role.js`（F-18：`evaluateResearchClosure` 结束条件、`FORBIDDEN_PRODUCTION_PATTERNS` 禁词真源）
 *   ｜ `../shared-context/index.js`（读面：`getResearch` / `getEvidence`）
 *   ｜ `./goal.js`（`getGoalVersion`：任务快照版本的六要素读取）
 * 职责：**hva_research 任务的按步执行体**——把 PD-02 的五个步骤名逐个落到真实动作：
 *   ① 载入机会与目标口径（F-19 薄读二阶段注入清单 → 三分支路径 + 比较条件 + 查证顺序；路径确定即停止）
 *   ② 调度工具采集证据（按查证顺序逐源经 **F-20 `queryForBehaviorCheck` → M5** 真实查询 → EXT-01 留痕；
 *      **只有真实 ok 且四要素齐才落 EXT-02**；失败/受限一律留痕、不阻断后续）
 *   ③ 交叉验证候选行为（分析输入＝可注入判据 ▸ `opts.readAnalysisFromAI` ▸ 确定性 fallback；经 F-20
 *      `formCandidateBehavior` 落 MD-09/MD-10——**未支持亦是完整合法产出**）
 *   ④ 形成结论与适用范围（F-20 `assembleBehaviorVerification` 重算五查 → F-18 `evaluateResearchClosure` 结束条件；
 *      **零写库**，结论与范围在步 ⑤ 随报告一并落 MD-07）
 *   ⑤ 产出研究结果与依据（F-21 `assembleResearchResult` 组装七要素 → `saveResearchReport` 落库）
 * 边界：本文件处理**研究类两种**（`hva_research` / `hva_followup`）——**F-41（2026-09-22）**起追问亦接线，
 *   二者同构、共用五步体，差别只在步 ①：追问额外走一次 **F-22 `intakeFollowup`** 承接判定（沿用 / 补查）并
 *   如实写进「已完成部分」；`hva_research` **完全不走**该路径，既有口径逐字不变（用例有正反两侧）。
 *   仍未接线者只剩 `goal_check`（仍走 `delegateToAgent` 占位，另登记）。
 *   步间不落新表——步 ③/④/⑤ 以 **EXT-01/EXT-02/MD-09/MD-10 已落库事实做确定性重算**（编排无随机，重算结果一致），不改 schema。
 *   查询条件与适用范围的口径与 M3 同形（由目标六要素派生），**保留 M5 信封原样**。
 * 硬红线落实（可运行判据，不写在注释里）：
 *   · **不以模型预期代替查询事实**：查询一律经 F-20 `queryForBehaviorCheck` → M5；本文件**不接收**任何模型预期入参，
 *     模型输出只用于「分析输入」（人群差异清单 / 替代解释档位 / 先后时点），**证据与结果摘要一律原样透传 M5 信封**；
 *   · **门禁开闭同一套代码**：语义判断＝`opts.analysis_input`（`source='provided'`）▸ `opts.readAnalysisFromAI`
 *     （`source='llm'`）▸ 确定性 fallback（`source='deterministic_fallback'` 且 `llm_gated=true`）——
 *     **不硬造结论也不硬做**；`analysis_input` 形态非法一律报错（不静默忽略）；
 *   · **失败不否定结论**：非 ok 的查询只留痕、不进证据；失败条目经 F-21 `failure_induced` 转缺口并保留 warning；
 *   · **中断即停手**：任务被 F-26 处置为非 running 后不再向下一个源发起查询（剩余源暂停，等恢复）；
 *   · **计划避开未启用来源**（F-38）：查证计划按「已声明 且 `CFG-02 is_enabled=1` 的工具所属来源」**逐步骤收窄 `data_sources`**，
 *     被排除的来源与整步检查**如实登记**（F-19 输出 `plan_excluded_sources` / `plan_excluded_checks`），不静默丢弃——
 *     否则任一计划源未接入，M4 一动手就被 F-26 判 `source_unavailable` 而停在步 ②（线上 T-0031 即此形）；
 *     边界：此处只判「该来源有无已启用工具」，更细的权限 / 接入态仍由 M5 前置守卫兜底；
 *   · **不覆盖既有报告**：F-21 `saveResearchReport` 前置守卫拦截「已出过报告」（幂等，如实回报）。
 *   受阻原因码映射（步 ⑤ 产出不合规时，`dict:BLOCK_REASON` 六项内选并写进 `PD-03` 备注）：
 *     `incomplete`→`no_data_returned`（研究所需信息未取得）；`boundary_violation`／`action_finding_mismatch`→`target_unclear`
 *     （产出越界 / 对不上，需核对口径后重跑）；`already_reported` 不视为失败（幂等完成）。
 * 反向清单：被 `./executor.js`（按 `task_type` 分派）与 `./index.js`（queue consumer / cron）引用；登记 `./README.md`；
 *   用例 `./test-f33.mjs`。
 */
import { getTask, listTaskSteps, advanceStep, appendDonePart, recordBlock, setTaskStatus, listTaskObjects, BLOCK_REASON_CODE, TYPE_STEPS } from "./step-plan.js";
import { getGoalVersion } from "./goal.js";
import { listQueryRecords, listTools } from "../tool-executor/index.js";
import { loadResearchStartContext, assembleResearchStart, STOP_CONDITION as START_STOP_CONDITION } from "../agent-orchestrator/research-start.js";
import { queryForBehaviorCheck, formCandidateBehavior, assembleBehaviorVerification, ALTERNATIVE_DIMENSIONS, BEHAVIOR_POINT_TYPE } from "../agent-orchestrator/behavior.js";
import { listCandidateBehaviors, listBehaviorPoints } from "../agent-orchestrator/behavior-store.js";
import { buildEvidenceDraft, recordVerificationEvidence, verifyFiveChecks } from "../agent-orchestrator/verification.js";
import { saveResearchReport } from "../agent-orchestrator/result.js";
import { evaluateResearchClosure, FORBIDDEN_PRODUCTION_PATTERNS, ANSWER_STANCES, STATEMENT_NATURES } from "../agent-orchestrator/role.js";
import { getResearch, getEvidence } from "../shared-context/index.js";
// F-41：`hva_followup` 追问执行体接线——类型常量与承接面**复用 F-22 的既有导出**，不在本文件复制第二份。
import { FOLLOWUP_TASK_TYPE, intakeFollowup } from "../agent-orchestrator/followup-intake.js";

/**
 * 查证顺序里的**来源系统代号 → 实际调度的工具码**（取 `CFG-02 tool_registry` 已注册码，契约基准 v1）。
 * 键与 F-19 `RESEARCH_CHECK_SEQUENCE[].data_sources` 同域（来源系统代号）——**工具名只在服务端持一份**。
 */
export const RESEARCH_SOURCE_TOOL = Object.freeze({
  CDP: "cdp.crowd.query",
  HJE: "hje.traffic.entry",
  PIM: "pim.category.query",
  MKT: "mkt.benefit.issue",
  ACT: "act.activity.list",
});

/**
 * 四查「其他解释」三个业务维度 → 承载来源（PRD-M4 F-20④：商品 / 活动 / 权益）。
 * `Object.keys` 必须与 F-19 `ALTERNATIVE_DIMENSIONS` **逐条相等**（用例断言对齐，不复制第二份清单）。
 */
export const ALTERNATIVE_SOURCE = Object.freeze({ product: "PIM", benefit: "MKT", activity: "ACT" });

/** HVA 任务的调权对象（`CFG-03 tool_permission`：`grantee_type=agent` / `grantee_ref=hva-agent`）。 */
export const HVA_GRANTEE = Object.freeze({ type: "agent", ref: "hva-agent" });

/** 本执行体处理的任务类型（分派真源；`./executor.js` 与本文件共用同一常量）。 */
export const RESEARCH_TASK_TYPE = "hva_research";

/**
 * **已接线任务类型清单**（唯一真源）——`./executor.js` 的 `runStepMessage` 分派守卫、`runPendingWork` 的
 * 选取条件、`./self-heal.js` 的补扫范围、`./index.js` 的 queue 路由**都从这里取**，不复制第二份。
 * **F-41（2026-09-22）**：`hva_followup` 由「契约占位」转为**已接线**——追问任务此前建行后五步恒 `pending`、
 * 永不被 cron 选中（`0 / 5 步`），是全流程最后一个断点；未列入者只剩 `goal_check`。
 */
export const WIRED_TASK_TYPES = Object.freeze(["discovery", RESEARCH_TASK_TYPE, FOLLOWUP_TASK_TYPE]);

/**
 * 已接线**研究类**类型（discovery 之外的两种：`hva_research` / `hva_followup`）——
 * 二者共用本文件的步骤体（追问与研究同构：① 载入口径 → ② 采集证据 → ③ 交叉验证 → ④ 结论范围 → ⑤ 出报告），
 * 差别只在步 ① 追问要多做一次 **F-22 承接判定**（沿用 / 补查）。
 */
export const RESEARCH_TASK_TYPES = Object.freeze([RESEARCH_TASK_TYPE, FOLLOWUP_TASK_TYPE]);

/**
 * 各已接线研究类型的步数——**派生自** `TYPE_STEPS`（唯一真源，不复制第二份）；
 * 步号越界守卫按任务实际类型取，改步骤模板即自动跟着变。
 */
export const RESEARCH_STEP_COUNT_OF = Object.freeze(
  Object.fromEntries(RESEARCH_TASK_TYPES.map((t) => [t, TYPE_STEPS[t].length])),
);

/**
 * 本执行体的步数——**派生自** F-02 `./step-plan.js` 的 `TYPE_STEPS.hva_research`（唯一真源，不复制第二份）。
 * `runResearchStep` 的步号越界守卫用它判界：改步骤模板即自动跟着变，不可能漏。
 */
export const RESEARCH_STEP_COUNT = TYPE_STEPS[RESEARCH_TASK_TYPE].length;

/**
 * 分析输入的三个来源档位（门禁开闭同一套代码，如实标注本次实际用了哪一档）。
 * `provided`＝调用方注入判据；`llm`＝`opts.readAnalysisFromAI` 真调；`deterministic_fallback`＝确定性推导并标 `llm_gated`。
 */
export const ANALYSIS_SOURCES = Object.freeze({
  PROVIDED: "provided",
  LLM: "llm",
  FALLBACK: "deterministic_fallback",
});

/**
 * 报告落库时的「不覆盖范围」最终声明（MD-07 `out_of_scope_note`）。
 * 禁词表**派生自 F-18 `FORBIDDEN_PRODUCTION_PATTERNS`**（唯一真源，不复制第二份）；
 * 该列本身**不被输出边界扫描**（它正是「不在结论范围内」的声明），故此处列出禁词是设计意图而非违规。
 */
export const OUT_OF_SCOPE_DECLARATION =
  `本研究的结论不覆盖：${FORBIDDEN_PRODUCTION_PATTERNS.join(" / ")} 均不在本研究结论范围内。` +
  `研究输出止于「有依据的判断＋限制＋改善方向」（公共业务指令 7，本体见 agent-runtime/business-rules.md）。`;

const isNonEmptyText = (v) => typeof v === "string" && v.trim() !== "";
const textOrNull = (v) => (isNonEmptyText(v) ? String(v).trim() : null);

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** 结构性受阻（口径缺失、研究壳缺失等）——带 `block_reason_code`，由 `runResearchStep` 兜底记 PD-03。 */
function blockedError(message, block_reason_code) {
  const err = new Error(message);
  err.block_reason_code = block_reason_code;
  return err;
}

/**
 * 当前**可用来源**（F-38）：`CFG-02 tool_registry` 里 `is_enabled = 1` 的工具所属来源，去重。
 * 只读（经 M5 `listTools` 读面，本文件不写 SQL——`test-f33` ① 的「零裸 SQL」断言仍成立）。
 * 口径＝「该来源至少有一个已启用工具」；边界：不判权限 / 接入态（那由 M5 前置守卫兜底），
 * 此处只用于让查证计划避开必然被拒的来源。
 */
async function enabledSourceCodes(db) {
  const tools = (await listTools(db, { is_enabled: 1 })) || [];
  return [...new Set(tools.map((t) => t.source_id).filter(Boolean))];
}

/**
 * 步 ①/②/③/④/⑤ 共用：薄读二阶段注入清单 → F-19 研究起点（路径 + 比较条件 + 查证顺序）。
 * 研究问题缺失 / 目标版本缺失 → 抛结构性受阻（非查询失败，不擅自代拟口径）。
 */
async function loadStartAndPlan(db, task, opts = {}) {
  const injection = await loadResearchStartContext(db, task.task_id);
  if (!injection.research_question) {
    throw blockedError(
      `任务 ${task.task_id} 的二阶段上下文未取到研究问题（PD-06 product_question 缺位）——口径不清，不擅自代拟问题`,
      "target_unclear",
    );
  }
  const version = await getGoalVersion(db, task.goal_id, Number(task.goal_version_no));
  if (!version) {
    throw blockedError(
      `目标版本不存在：${task.goal_id} v${task.goal_version_no}（任务快照版本缺失）`,
      "target_unclear",
    );
  }
  const start = assembleResearchStart({
    research_question: injection.research_question,
    behavior_hypothesis: injection.behavior_hypothesis,
    population_limit: injection.population_limit,
    opportunity: injection.opportunity,
    goal: injection.goal,
    evidence: injection.evidence,
    history: injection.history,
    sources: injection.sources,
    // F-38：现读可用来源（`is_enabled=1` 的工具所属来源），让查证计划避开必然被 M5 判 `source_unavailable` 的来源。
    // `opts.available_sources` 可覆盖（用例注入夹具用）——门禁开闭同一套代码，判定逻辑不复制第二份。
    available_sources: opts.available_sources || (await enabledSourceCodes(db)),
    focus_period: version.focus_period ?? null,
    metric_definition: version.metric_definition ?? null,
    suitability: opts.suitability,
    comparison_conditions: opts.comparison_conditions,
  });
  return { injection, version, start };
}

/** 查询条件＝契约基准 v1 统一入参：由目标六要素派生，不编造数值（与 M3 步 ③ 同口径）。 */
function buildQueryCondition(version, start) {
  return {
    scope: version.business_scope || null,
    period: version.focus_period || null,
    metric: version.metric_definition || null,
    goal: version.business_goal || null,
    question: start.research_question,
  };
}

/**
 * 步 ②：按查证顺序逐源真实查询（唯一取数出口＝F-20 `queryForBehaviorCheck` → M5）。
 * 只有真实 `ok` 且证据四要素齐才落 EXT-02；失败/受限**原样留痕**、**不阻断**后续。
 * 任务被 F-26 处置为非 running 时立即停手（剩余源暂停，等恢复后继续）。
 */
async function collectEvidence(db, task, { version, start }, stamp, opts = {}) {
  const condition = buildQueryCondition(version, start);
  const results = [];
  for (const step of start.plan) {
    for (const source of step.data_sources) {
      const tool_code = RESEARCH_SOURCE_TOOL[source];
      if (!tool_code) {
        results.push({ check_key: step.check_key, source_id: source, ok: null, restricted: false, reason: `未登记该来源的工具码（${source}）` });
        continue;
      }
      const fact = await queryForBehaviorCheck(db, {
        task_id: task.task_id,
        check_key: step.check_key,
        tool_code,
        source_id: source,
        grantee_type: HVA_GRANTEE.type,
        grantee_ref: HVA_GRANTEE.ref,
        query_condition: condition,
        at: stamp,
        transport: opts.transport,
      });
      let evidence_id = null;
      let evidence_ok = false;
      if (fact.ok) {
        // 适用范围＝本次查询实际声明的范围（目标六要素③派生）——可回查、不编造（与 M3 步 ④ 同口径）
        const withScope = { ...fact, applicability_scope: version.business_scope || null };
        // 五项检查（F-15，**不另立一套**）：证据草稿的「缺失说明」由 CFG-05 gap_rule 驱动；
        // `missing_note` 是 F-09 证据写入面的必填列——本轮无命中缺口时须显式说明（不留空、不编造缺口）。
        const checks = await verifyFiveChecks(db, {
          fact: withScope,
          goal: {
            goal_id: task.goal_id,
            goal_version_no: Number(task.goal_version_no),
            business_goal: version.business_goal,
            business_scope: version.business_scope,
            metric_definition: version.metric_definition,
          },
          at: stamp,
        });
        const drafted = buildEvidenceDraft({ fact: withScope, checks });
        if (drafted.ok) {
          const draft = { ...drafted.draft };
          if (!isNonEmptyText(draft.missing_note)) {
            draft.missing_note = "本次查询本身未命中口径规则缺口；研究层面的未决项与限制汇总见报告「其他解释与限制」。";
          }
          evidence_id = `EV-${fact.query_id}`;
          await recordVerificationEvidence(db, { ...draft, evidence_id, created_at: stamp });
          evidence_ok = true;
        }
      }
      results.push({
        check_key: step.check_key,
        source_id: source,
        tool_code,
        ok: fact.ok,
        restricted: Boolean(fact.restricted),
        query_id: fact.query_id ?? null,
        result_status: fact.result_status ?? null,
        result_summary: fact.result_summary ?? null,
        info_time_point: fact.info_time_point ?? null,
        evidence_id,
        evidence_ok,
        reason: fact.ok ? null : fact.fail_reason,
      });
      const cur = await getTask(db, task.task_id);
      if (cur && cur.task_status !== "running") {
        results.push({ check_key: step.check_key, source_id: "剩余计划", ok: null, restricted: false, reason: `任务已被处置为 ${cur.task_status}，剩余源暂停` });
        return results;
      }
    }
  }
  return results;
}

/** EXT-01 逐任务回查（步 ②/③/⑤ 的确定性事实来源，重算一致）。 */
async function allQueryRecords(db, task_id) {
  return listQueryRecords(db, { task_id });
}

/** 已落 EXT-02 的证据号（幂等回查：步 ② 未落成证据的条目不挂引用，如实记缺口）。 */
async function evidenceRefsOf(db, records) {
  const map = new Map();
  for (const r of records) {
    const id = `EV-${r.query_id}`;
    const done = await getEvidence(db, id);
    if (done) map.set(r.query_id, id);
  }
  return map;
}

/**
 * **确定性 fallback 分析输入**（A-1 门禁未开时的合法路径，标 `llm_gated=true`）。
 * 逐项都取自可回查真源，**不编造**：能给结论的给结论，给不了的**如实留空**，由 F-20 记缺口。
 */
export function deriveAnalysisFallback({ records, version, opportunity }) {
  const ok = records.filter((r) => r.result_status === "ok");
  const bySource = new Map(ok.map((r) => [r.source_id, r]));
  const points = ok.map((r) => ({
    point_id: r.query_id,
    point_type: Number(r.returned_rows) > 0 ? BEHAVIOR_POINT_TYPE.SUPPORT : BEHAVIOR_POINT_TYPE.UNSUPPORT,
    point_text: r.result_summary,
    info_time_point: r.queried_at,
  }));
  const alternatives = ALTERNATIVE_DIMENSIONS.map((dimension) => {
    const hit = bySource.get(ALTERNATIVE_SOURCE[dimension]);
    if (!hit) return null; // 该维度未取到事实 → 交给 F-20 记「未排查」缺口（不默认无关）
    return {
      dimension,
      // 三类来源只提供**存在性 / 发放记录**，均无用户参与明细 → 不得据此排除（BRD §4 F-20 验收）
      evidence_kind: "existence_only",
      summary: hit.result_summary,
      concluded_excluded: false,
    };
  }).filter(Boolean);
  return {
    population: {
      candidate_group: opportunity?.target_object ?? null,
      comparison_group: null,
      features: [],
      prior_performance: null,
      // 未取得差异清单 → 交给 F-20 判「可比性无法明确」并限制行为作用判断（不硬下「可比」）
      differences: [],
    },
    points,
    behavior_at: null,
    result_at: null,
    metric: { expected: version.metric_definition ?? null, observed: version.metric_definition ?? null },
    alternatives,
    gaps: [],
    llm_gated: true,
    note:
      "确定性 fallback：差异清单 / 先后时点 / 替代解释档位这类语义判断受 A-1 门禁，未取得处**如实留空**，" +
      "由 F-20 记缺口、不给确定判断（不硬造结论，也不硬做）。",
  };
}

/**
 * 分析输入的三档取值：`provided` ▸ `llm` ▸ `deterministic_fallback`。
 * 比较条件三口径一并带上（F-20 `evaluateComparisonGate` 复用 F-19 `resolveComparisonConditions`，单一口径）：
 * `comparison_conditions` 直接取 F-19 已解析结果，不让 F-20 再解析一遍入参形态。
 * `opts.analysis_input` 形态非法一律报错（不静默忽略——与 F-19 `suitability` 同纪律）。
 */
export async function resolveAnalysisInput({ start, records, version, opportunity, stamp, opts = {} }) {
  const comparison = {
    comparison_conditions: start.comparison_conditions,
    focus_period: version.focus_period ?? null,
    metric_definition: version.metric_definition ?? null,
  };
  const given = opts.analysis_input;
  if (given !== undefined && given !== null) {
    if (typeof given !== "object" || Array.isArray(given)) {
      throw new Error("分析输入入参不合法：analysis_input 若提供须为对象（不静默忽略）");
    }
    return { source: ANALYSIS_SOURCES.PROVIDED, llm_gated: false, input: { ...given, ...comparison } };
  }
  if (typeof opts.readAnalysisFromAI === "function") {
    const fromAi = await opts.readAnalysisFromAI({ start, records, version, opportunity, stamp });
    if (fromAi && typeof fromAi === "object" && !Array.isArray(fromAi)) {
      return { source: ANALYSIS_SOURCES.LLM, llm_gated: false, input: { ...fromAi, ...comparison } };
    }
    throw new Error("分析输入入参不合法：readAnalysisFromAI 若提供须返回对象（不静默忽略）");
  }
  return {
    source: ANALYSIS_SOURCES.FALLBACK,
    llm_gated: true,
    input: { ...deriveAnalysisFallback({ records, version, opportunity }), ...comparison },
  };
}

/** 步 ③/⑤ 共用：候选行为（MD-09）与其条目（MD-10）现读——⑤ 的七要素 ⑤ 与 ③ 的产物同源。 */
async function readCandidates(db, research_no) {
  const candidates = await listCandidateBehaviors(db, { research_no });
  const out = [];
  for (const c of candidates) {
    const points = await listBehaviorPoints(db, { candidate_id: c.candidate_id });
    out.push({
      candidate_id: c.candidate_id,
      behavior_name: c.behavior_name,
      behavior_status: c.behavior_status,
      points: points.map((p) => ({ point_id: p.point_id, point_type: p.point_type, point_text: p.point_text })),
    });
  }
  return out;
}

/** 任务关联的 MD-07 研究壳（F-04 建壳时落的 LNK-04 `research=output` 锚点）。 */
async function researchNoOf(db, task_id) {
  const links = await listTaskObjects(db, { task_id, link_role: "output" });
  const hit = links.find((l) => l.object_type === "research");
  return hit ? hit.object_id : null;
}

/** 七要素 ⑥：其他解释与限制（可比性 + 未排除维度 + 因果口径 + 缺口 + 失败降级 + 门禁标注，逐条可回指）。 */
function buildLimitsText({ analysis, behavior }) {
  const parts = [];
  const checks = behavior?.checks || {};
  const comparability = checks.population_comparability || {};
  parts.push(
    `人群可比性：${comparability.comparable === true ? "可比基础成立" : `未成立 / 无法明确——${comparability.reason || "未取得差异清单"}`}。`,
  );
  const alt = checks.alternative_explanations || {};
  const unexcluded = Array.isArray(alt.unexcluded) ? alt.unexcluded : [];
  parts.push(
    unexcluded.length === 0
      ? "其他解释：三个业务维度均已排除。"
      : `其他解释：${unexcluded.map((u) => `${u.dimension}（${u.reason}）`).join("、")} 未排除，限制行为作用判断。`,
  );
  if (behavior?.causal_note) parts.push(behavior.causal_note);
  const gaps = Array.isArray(behavior?.open_gaps) ? behavior.open_gaps : [];
  if (gaps.length > 0) parts.push(`信息缺口 ${gaps.length} 项：${gaps.map((g) => `${g.gap_key}（影响：${g.affects}）`).join("；")}。`);
  if (behavior?.negation_allowed === false) {
    parts.push("本次存在由查询失败 / 受限导致的未完成条目——不能当否定结论（BRD §7 第 4 条）。");
  }
  if (analysis?.llm_gated) parts.push("语义判断受 A-1 门禁，未取得处如实留空（登记为「门禁未关闭、非发布门禁」）。");
  return parts.join("");
}

/**
 * 步 ⑤ 的七要素装配（纯计算；落库交 F-21 `saveResearchReport`）。逐项回指真源：
 * ① 沿用研究壳既有文本（F-04 由真源派生，**不重写第二份**）；② 由起点路径/比较条件/查证顺序装配；
 * ③ 逐发现挂**真实证据号**（未挂到即如实记缺口）；⑤ 与步 ③ 同源（MD-09/MD-10 现读）；
 * ⑥ 由五查缺口与降级情况汇总；⑦ 逐项对应发现（对应不到的由 F-21 整体拒落，不半落）。
 */
export function assembleSevenElements({ research, start, records, evidenceMap, candidates, behavior, analysis, failures, stamp }) {
  const findings = [];
  for (const r of records) {
    const checkItem = (start.plan.find((s) => s.data_sources.includes(r.source_id)) || {}).check_item || r.source_id;
    const ev = evidenceMap.get(r.query_id) || null;
    findings.push({
      finding_text: `在「${checkItem}」环节，${r.source_id} 经 ${r.tool_code} 真实返回：${r.result_summary}`,
      support_flag: Number(r.returned_rows) > 0 ? "supported" : "unsupported",
      // 限制说明是 MD-08 的必填列（F-21 写入面 `createResearchFinding`）：两种情形都要写明，不留空。
      limit_note: ev
        ? "证据四要素齐、可按 query_id 回查；本轮为观察性比较、未做干预验证，因果方向不作结论。"
        : "该条尚未关联实际取得的证据（四要素不齐），如实登记缺口。",
      evidence_refs: ev ? [ev] : [],
    });
  }
  const improvement_actions = [];
  findings.forEach((f, i) => {
    if (f.support_flag === "supported") return;
    improvement_actions.push({
      target_for: "研究覆盖环节",
      problem_what: f.finding_text,
      reason_why: "该发现未获支持或证据不齐，值得补充可比较的依据后再判断。",
      related_finding_ref: `#${i + 1}`,
    });
  });

  return {
    research_no: research.research_no,
    e1_goal_statement: research.e1_goal_statement,
    e2_scope_method:
      `研究范围与方法：机会「${research.opportunity_id}」；目标 ${research.goal_id} v${research.goal_version_no}；` +
      `起点路径 ${start.path}（${start.path_reason}）；` +
      `比较条件 ${start.comparison_conditions_declared ? "三项已定" : `缺 ${start.comparison_conditions_missing.join("、")}（如实登记，不编造）`}；` +
      `查证顺序 ${start.plan.map((s) => s.check_key).join(" > ")}；停止条件＝${START_STOP_CONDITION}。`,
    e4_population_diff: (() => {
      const c = behavior?.checks?.population_comparability;
      if (!c) return "人群差异：本轮未取得可比性判定。";
      return (
        `人群差异：${c.comparable === true ? "两组人群可比基础成立" : `可比性未成立 / 无法明确（${c.reason}）`}，` +
        `未解释项 ${(c.unexplained || []).length} 项。`
      );
    })(),
    e6_limits: buildLimitsText({ analysis, behavior }),
    out_of_scope_note: OUT_OF_SCOPE_DECLARATION,
    findings,
    candidates,
    improvement_actions,
    failure_induced: failures,
    open_gaps: Array.isArray(behavior?.open_gaps) ? behavior.open_gaps : [],
    warnings: [
      ...(Array.isArray(behavior?.failure_induced) ? behavior.failure_induced.map((f) => f.note) : []),
      ...(analysis?.llm_gated ? ["语义判断受 A-1 门禁：本次为确定性 fallback（登记为门禁未关闭、非发布门禁）。"] : []),
    ],
    finished_at: stamp,
    linked_at: stamp,
    no_action_reason:
      improvement_actions.length === 0 ? "本轮全部发现均获支持，未产生待改善方向（改善方向为空是合法产出）。" : null,
  };
}

/** 步骤体返回 `{ outcome: "done", ... }`；结构性受阻抛带 `block_reason_code` 的错（由本函数兜底记 PD-03）。 */
export async function runResearchStep(db, task_id, step_no, opts = {}) {
  const task = await getTask(db, task_id);
  if (!task) throw new Error(`任务不存在：${task_id}（不得在任务之外调用 Agent）`);
  // F-41：`hva_followup` 与 `hva_research` 同构，共用本执行体（步 ① 追问多做一次 F-22 承接判定）。
  if (!RESEARCH_TASK_TYPES.includes(task.task_type)) {
    throw new Error(
      `runResearchStep 只处理 ${RESEARCH_TASK_TYPES.join(" / ")} 任务，收到 ${task.task_type}（其余类型仍走占位，接线另登记）`,
    );
  }
  // 步号越界＝**程序性错误**（不是任务受阻）：在 try 之外直接抛错——不去动 `PD-02`/`PD-03`，
  // 免得把一个不存在的步号写成幽灵步态（与 `discovery.js` 同款形态）。
  const stepCount = RESEARCH_STEP_COUNT_OF[task.task_type];
  const n = Number(step_no);
  if (!Number.isInteger(n) || n < 1 || n > stepCount) {
    throw new Error(`未知步骤号：${step_no}（${task.task_type} 计划为 ${stepCount} 步）`);
  }
  // 判据入参的形态同属**程序性错误**（调用方写错，不是任务自身受阻）：也在 try 之外挡掉。
  // 若放进 try，会把「调用方传错」说成「任务受阻」，并留一条永远无法自动恢复的 `PD-03`（含误导性的 call_failed）。
  if (opts.analysis_input !== undefined && opts.analysis_input !== null
    && (typeof opts.analysis_input !== "object" || Array.isArray(opts.analysis_input))) {
    throw new Error("分析输入入参不合法：analysis_input 若提供须为对象（不静默忽略）");
  }
  if (opts.readAnalysisFromAI !== undefined && typeof opts.readAnalysisFromAI !== "function") {
    throw new Error("分析输入入参不合法：readAnalysisFromAI 若提供须为函数（不静默退回确定性 fallback）");
  }
  const stamp = opts.at || nowStamp();

  try {
    if (step_no === 1) {
      const { start } = await loadStartAndPlan(db, task, opts);
      // F-41 追问专属：步 ① 额外做一次 **F-22 承接判定**（既有依据是否仍适用 → 沿用 / 补查），
      // 并**如实写进「已完成部分」**——沿用还是补查必须可回查，不能只体现在报告正文里。
      // 非追问任务（hva_research）**完全不走这条路径**，既有口径逐字不变。
      let intakeNote = "";
      let reuseDecision = null;
      if (task.task_type === FOLLOWUP_TASK_TYPE) {
        const it = await intakeFollowup(db, { task_id: task.task_id, now: stamp });
        const reuse = it?.evidence_reuse || {};
        reuseDecision = reuse.decision || null;
        const dims = (reuse.checked_dimensions || []).join("、") || "未声明";
        intakeNote =
          `追问承接：原研究 ${it?.intake?.original_research_no || "—"} 的结果与依据**原样保留**；` +
          `既有依据复用判定＝${reuse.decision || "undetermined"}` +
          `${reuse.llm_gated ? "（未声明变更 → 未决，受 A-1 门禁，不硬猜）" : ""}；` +
          `已核对维度 ${dims}；版本口径 v${it?.version?.followup_effective_goal_version_no ?? task.goal_version_no}。`;
      }
      // 来源排除项**如实写进「已完成部分」**（F-38，仅在确有排除时）：计划避开未启用来源后，
      // 依据缺口在任务记录里可回查，不静默丢弃；五源齐备时本段不产生任何多余文本（既有口径不变）。
      const excludedNote = start.plan_excluded_sources.length > 0
        ? `本轮排除来源 ${start.plan_excluded_sources.map((x) => `${x.source_id}（${x.reason}）`).join("、")}；`
        : "";
      await appendDonePart(db, task_id,
        `① ${task.task_type === FOLLOWUP_TASK_TYPE ? "关联原研究与依据" : "载入机会与目标口径"}：` +
        (intakeNote ? `${intakeNote}；` : "") +
        `研究问题「${start.research_question}」；起点路径 ${start.path}（${start.path_reason}）；` +
        `比较条件 ${start.comparison_conditions_declared ? "三项已定" : `缺 ${start.comparison_conditions_missing.join("、")}（如实登记，不编造）`}；` +
        excludedNote +
        `查证顺序 ${start.plan.map((s) => s.check_key).join(" > ")}；${START_STOP_CONDITION}。`);
      return {
        outcome: "done", step_no, path: start.path, plan_step_count: start.plan_step_count,
        sources_available: start.sources_available, plan_excluded_sources: start.plan_excluded_sources,
        ...(intakeNote ? { followup_intake: true, reuse_decision: reuseDecision } : {}),
      };
    }

    if (step_no === 2) {
      const ctx = await loadStartAndPlan(db, task, opts);
      const results = await collectEvidence(db, task, ctx, stamp, opts);
      const okCount = results.filter((r) => r.ok === true).length;
      const evCount = results.filter((r) => r.evidence_ok).length;
      const failText = results.filter((r) => r.ok === false).map((r) => `${r.source_id}=${r.reason}`).join("；");
      await appendDonePart(db, task_id,
        `② 调度工具采集证据：真实返回 ok ${okCount} 源、证据四要素齐并落 EXT-02 ${evCount} 条` +
        (failText ? `（未 ok：${failText}）——失败已留痕 EXT-01，不阻断后续步骤、不当否定依据` : "") + "。");
      return { outcome: "done", step_no, ok_sources: okCount, evidence_saved: evCount, total: results.length };
    }

    if (step_no === 3) {
      const ctx = await loadStartAndPlan(db, task, opts);
      const research_no = await researchNoOf(db, task_id);
      if (!research_no) {
        throw blockedError(
          `任务 ${task_id} 未关联 MD-07 研究壳（LNK-04 output 缺位）——候选行为须归属真实研究，不擅自建壳`,
          "target_unclear",
        );
      }
      const records = await allQueryRecords(db, task_id);
      const { source, llm_gated, input } = await resolveAnalysisInput({
        start: ctx.start, records, version: ctx.version, opportunity: ctx.injection.opportunity, stamp, opts,
      });
      const behavior_name =
        textOrNull(ctx.injection.behavior_hypothesis) ||
        textOrNull(ctx.injection.opportunity?.opportunity_title) ||
        textOrNull(ctx.start.research_question);
      const written = await formCandidateBehavior(db, { research_no, behavior_name, ...input, at: stamp });
      if (written.written !== true) {
        const why = written.gate?.guidance || written.note || String(written.outcome);
        await appendDonePart(db, task_id, `③ 交叉验证候选行为：未落库（${written.outcome}）——${why}。`);
        return { outcome: "done", step_no, candidate_written: false, analysis_source: source, llm_gated, reason: written.outcome };
      }
      await appendDonePart(db, task_id,
        `③ 交叉验证候选行为：候选行为 ${written.candidate_id}「${written.behavior_name}」支持情况＝${written.behavior_status}，` +
        `条目 ${written.point_ids.length} 条（支持 ${written.support_count} / 不支持 ${written.unsupport_count}）；` +
        `分析输入来源＝${source}${llm_gated ? "（受 A-1 门禁，确定性 fallback）" : ""}；**未获支持亦是完整合法产出**。`);
      return { outcome: "done", step_no, candidate_id: written.candidate_id, behavior_status: written.behavior_status, analysis_source: source, llm_gated };
    }

    if (step_no === 4) {
      const ctx = await loadStartAndPlan(db, task, opts);
      const records = await allQueryRecords(db, task_id);
      const { input } = await resolveAnalysisInput({
        start: ctx.start, records, version: ctx.version, opportunity: ctx.injection.opportunity, stamp, opts,
      });
      const behavior = assembleBehaviorVerification({ ...input, at: stamp });
      const evidenceRefs = [...(await evidenceRefsOf(db, records.filter((r) => r.result_status === "ok"))).values()];
      const supported = behavior.outcome === "candidate_supported";
      const closure = evaluateResearchClosure({
        research_answer: supported
          ? `候选行为「${textOrNull(ctx.injection.behavior_hypothesis) || ctx.start.research_question}」五查均通过，存在关联（仍属候选，未做干预验证）`
          : null,
        answer_stance: ANSWER_STANCES.SUPPORT,
        answer_nature: STATEMENT_NATURES.TENTATIVE,
        due_to_failure: (behavior.failure_induced || []).length > 0,
        evidence_refs: evidenceRefs,
        limitation_reason: supported
          ? null
          : `未找到足够依据支持候选行为——${behavior.note || behavior.status_reason || "依据不足即停止并说明限制"}（说明无法完成判断的原因是合法结束）`,
      });
      await appendDonePart(db, task_id,
        `④ 形成结论与适用范围：五查结果 ${behavior.outcome}；结束条件 ${closure.kind}（closed=${closure.closed}）；` +
        `适用范围＝${ctx.version.business_scope || "未声明"}；限制与缺口写入报告 ⑥。`);
      return { outcome: "done", step_no, behavior_outcome: behavior.outcome, closure_kind: closure.kind, closed: closure.closed };
    }

    if (step_no === 5) {
      const ctx = await loadStartAndPlan(db, task, opts);
      const research_no = await researchNoOf(db, task_id);
      if (!research_no) {
        throw blockedError(
          `任务 ${task_id} 未关联 MD-07 研究壳（LNK-04 output 缺位）——研究结果须归属真实研究，不擅自建壳`,
          "target_unclear",
        );
      }
      const research = await getResearch(db, research_no);
      if (!research) throw blockedError(`研究不存在：${research_no}（任务锚点与 MD-07 不一致）`, "target_unclear");

      const all = await allQueryRecords(db, task_id);
      const records = all.filter((r) => r.result_status === "ok");
      const evidenceMap = await evidenceRefsOf(db, records);
      const failures = all
        .filter((r) => r.result_status !== "ok")
        .map((r) => ({ order_no: null, point_id: r.source_id, note: `条目 ${r.source_id} 由查询失败 / 受限导致未完成——转缺口登记，不作否定依据。` }));
      const { input, source, llm_gated } = await resolveAnalysisInput({
        start: ctx.start, records: all, version: ctx.version, opportunity: ctx.injection.opportunity, stamp, opts,
      });
      const behavior = assembleBehaviorVerification({ ...input, at: stamp });
      const candidates = await readCandidates(db, research_no);
      const elements = assembleSevenElements({
        research, start: ctx.start, records, evidenceMap, candidates, behavior,
        analysis: { llm_gated }, failures, stamp,
      });
      if (candidates.length === 0) {
        elements.candidate_absent_reason =
          behavior.gate?.guidance || behavior.note || "本轮未形成候选行为（依据不足即使其成为合法完整产出）。";
      }
      const report = await saveResearchReport(db, elements);

      if (report.outcome === "already_reported") {
        await appendDonePart(db, task_id, `⑤ 产出研究结果与依据：${research_no} 已有报告，按「追问须形成新研究」不覆盖（幂等完成）。`);
        return { outcome: "done", step_no, report_written: false, report_outcome: report.outcome, research_no };
      }
      if (report.written !== true) {
        const reason = report.outcome === "incomplete" ? "no_data_returned" : "target_unclear";
        throw blockedError(
          `第 5 步产出未达 S-B4 停止条件（${report.outcome}）：${report.reason || "前置守卫拦截"}`,
          reason,
        );
      }
      await appendDonePart(db, task_id,
        `⑤ 产出研究结果与依据：七要素齐备并保存（发现 ${report.counts.findings} 条、证据关联 ${report.counts.evidence_links} 条、` +
        `改善方向 ${report.counts.actions} 条）；边界扫描 clean=${report.boundary.clean}；分析输入来源＝${source}${llm_gated ? "（A-1 门禁）" : ""}。`);
      return { outcome: "done", step_no, report_written: true, research_no, counts: report.counts, llm_gated };
    }

    // 越界步号已在函数入口（try 之外）挡掉，此处只在「模板增步但分支未同步」时兜底。
    throw new Error(`未知步骤号：${step_no}（${task.task_type} 计划为 ${stepCount} 步）`);
  } catch (err) {
    // 结构性受阻 / 意外异常：按 F-26 语义留 PD-03 + 任务 blocked，保留已完成部分（兜底尊重终态守卫）。
    // **未知步号**（程序性错误、无对应 PD-02 行）时不落任何库、原样回报——不制造幽灵步态。
    const reason = err.block_reason_code || BLOCK_REASON_CODE.call_failed;
    const hasStep = (await listTaskSteps(db, task_id)).some((s) => Number(s.step_no) === Number(step_no));
    if (hasStep) {
      await advanceStep(db, { task_id, step_no, step_state: "blocked" });
      await recordBlock(db, {
        task_id,
        block_reason_code: reason,
        block_note: `第 ${step_no} 步受阻：${String(err?.message || err)}`,
        resume_condition: "修复结构性原因后人工恢复（停止/受阻状态不自动重启）",
        blocked_at: stamp,
      });
      const cur = await getTask(db, task_id);
      if (cur && !["blocked", "stopped", "done"].includes(cur.task_status)) {
        await setTaskStatus(db, task_id, "blocked", { ended_at: stamp });
      }
    }
    return { outcome: "blocked", step_no, reason, message: String(err?.message || err) };
  }
}
