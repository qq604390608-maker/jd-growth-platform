/**
 * 文档卡（阶段1 · M2 共享上下文 · F-07 业务背景管理 / F-08 可用来源与工具登记 / F-09 证据管理 /
 *        F-10 机会记录管理 / F-11 研究结果与历史管理 / **F-12 上下文按任务组织注入** · 2026-09-19）
 * 上游：`../../AGENTS.md`（宪法：白盒原则｜双向引用｜术语口径「共享上下文＝数据库」）
 *   ｜ `../../docs/03-locks/schema.md`（MD-04 `business_context` / MD-05 `touchpoint`；CFG-01 `source_registry`；
 *        EXT-02 `evidence` / LNK-01 `opportunity_evidence` / LNK-02 `finding_evidence`；
 *        MD-06 `opportunity` / PD-05 `opportunity_status_log` / LNK-03 `opportunity_relation`；
 *        MD-07 `research` / MD-08 `research_finding` / EXT-03 `external_validation`；
 *        **CFG-06 `context_template` / PD-06 `context_injection`**；
 *        Q-03 已决「背景不做定版快照」；Q-05 六要素必填见 MD-06 表尾注；证据四要素见 §6 EXT-02 与 §11 应用层校验；
 *        §0.5 第 1 条编号裁决「全库只用 R-xxx，`ST-xxx` 弃用」；MD-07 表注「追问不覆盖原研究」）
 *   ｜ `../../docs/07-decisions/ADR-003-机会六要素必填与未知项二态.md`（§3 六要素清单/判定式、§3.1 两件套约束、§3.2 未加二态 CHECK）
 *   ｜ `../../docs/03-locks/tech-stack.md`（§2.2 服务端 `shared-context` 模块 / DS-01 D1）
 *   ｜ `../../docs/03-locks/external-deps.md`（§2 五系统 can/cannot/status；P0/P1/P2 分级）
 *   ｜ `../../docs/04-plan/dev-plan.md`（阶段1 关键交付物：背景与触点 CRUD + 五类来源登记与缺口语义 +
 *        证据登记与回查链路 + 机会记录与状态留痕，证据四要素：来源/条件/时点/适用范围，新旧依据并存不覆盖）
 *   ｜ `../../docs/02-prd/PRD-M2-共享上下文.md`（F-07 验收要点；F-08 验收要点：缺信息可知、查询仍须真实接入；
 *        F-09 验收要点：证据链完整可回溯、新旧依据并存且关联；F-10 验收要点：机会选择取决于证据与相关性，暂不研究的仍保留；
 *        F-11 验收要点：后续研究可引用历史，避免重复研究）
 *   ｜ `../../docs/05-test-cases/test-M2.md`（TC-D-M2-001/002 = F-07；TC-D-M2-010 + TC-I-M2-003 = F-08；
 *        TC-D-M2-007 + TC-I-M2-001 = F-09；TC-D-M2-003/004/005/012/014 = F-10；
 *        TC-D-M2-006 + TC-D-M2-008 + TC-I-M2-004 = F-11；TC-D-M2-015 标 F-09/F-12）
 *   ｜ `../../db/migrations/0001_init.sql` L36-46（CFG-01）/ L160-181（MD-04/05）/ L446-458（EXT-02）/
 *        L387-404（LNK-01/02）/ L206-227（MD-06）/ L354-363（PD-05）/ L406-414（LNK-03）/
 *        L230-248（MD-07）/ L251-259（MD-08）/ L461-468（EXT-03）（表结构唯一真源）
 * 职责：M2 共享上下文模块——F-07 业务背景库读写（MD-04 + MD-05）；F-08 外部来源登记与缺口语义（CFG-01）；
 *   F-09 证据登记与回查链路（EXT-02 + LNK-01/LNK-02：四要素齐全校验、证据→查询→来源可回查、新旧依据并存不覆盖）；
 *   F-10 机会记录管理（MD-06 六要素 + `unknown_item` 二态；PD-05 状态迁移留痕；LNK-03 机会↔机会关系 + 自环拒绝）；
 *   F-11 研究结果与历史管理（MD-07 `research` + MD-08 `research_finding` 只读 + EXT-03 `external_validation` 登记；
 *        按 `parent_research_no` 链追溯祖先 / 派生，使后续研究可引用历史、避免重复研究）；
 *   **F-12 上下文按任务组织注入**（CFG-06 `context_template` 模板登记 + PD-06 `context_injection` 注入留痕；
 *        两个维度——类型（模板定注入哪些类型）＋范围（只查京东超市有关触点 / 只看业务方负责品类）；
 *        **初始化是确定性程序行为**：同任务同输入 → 同工作空间，不每回随机、不退化为只传一句「继续分析」）。
 * 硬红线（BRD §5.3 / tech-stack §7.2）：只在本平台自有 D1 内增删查（「共享上下文＝数据库」），
 *   **不调任何面向生产环境会改线上数据的接口**；证据一律**只新增行、不覆盖**（EXT-02 头注：新证据加入不覆盖原有依据）；
 *   暂不研究的机会**不删除**（状态置 `deferred`，记录保留后可再选）；
 *   **追问不覆盖原研究**（MD-07 表注 L271：追问形成新的 `research` 行，`parent_research_no` 指向原研究）。
 * 边界（严格只做 F-07/F-08/F-09/F-10/F-11/F-12）：
 *   CFG-02 工具的**写/注册**归 F-23（M5），本文件仅只读交叉引用；
 *   LNK-04 `task_object` 的**写入路径归 M1 task-runner（F-02/F-04/F-06）**，本文件不提供其写接口
 *   （F-12 只**读** LNK-04 取二阶段锚点：所选机会 / 原研究）；
 *   机会的**人工选择**（F-03）与 **Agent 产出**（M3 F-14~F-16）不在本文件，本文件只做记录读写；
 *   MD-08 关键发现与七要素正文的**生成**归 F-20/F-21（M4），本文件只做历史回查时的只读；
 *   外部验证的**执行与效果计算由业务工作完成**，本文件只登记其结论与来源引用（schema EXT-03 表注 L737-738）。
 * 反向清单：被 `../api/index.js`（F-07/F-08/F-09/F-10/F-11/**F-12** 路由）与后续 `../agent-orchestrator`（背景注入/能力边界/
 *   证据回查/机会上下文/历史研究上下文/**任务上下文初始化**）引用；登记 `../README.md`；测试 `./test-f07.mjs`、`./test-f08.mjs`、
 *   `./test-f09.mjs`、`./test-f10.mjs`、`./test-f11.mjs`、**`./test-f12.mjs`**。
 *
 * @typedef {Object} D1Like D1 绑定（`env.DB`），提供 prepare().bind().run()/all()/first()
 */

// TS-16 应用层截断（tech-stack §8 已决 2026-09-21）：EXT-02 `result_summary` 落库前超限截断＋留痕标注。
// 分析面拿到的仍是全量原文，截断只发生在 F-09 单一写入面落库前一刻；纯函数引自 M5 `../tool-executor/text-limit.js`。
import { truncateForStorage } from "../tool-executor/text-limit.js";

const REQUIRED_BUSINESS_CONTEXT = ["context_id", "context_kind", "title", "content", "source_ref"];
const REQUIRED_TOUCHPOINT = ["touchpoint_id", "touchpoint_name", "channel", "position_desc"];

/** 生成 D1 口径的 datetime 串（`YYYY-MM-DD HH:MM`，见 0001_init.sql 头注）。 */
function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

function assertRequired(obj, fields, label) {
  const missing = fields.filter(
    (f) => obj[f] === undefined || obj[f] === null || String(obj[f]).trim() === ""
  );
  if (missing.length) {
    throw new Error(`${label} 缺必填字段：${missing.join(", ")}`);
  }
}

/* ------------------------------------------------------------------ *
 * MD-04 business_context（业务背景条目）
 * ------------------------------------------------------------------ */

/**
 * 新建背景条目。`goal_id` 缺省/为 null＝**平台级通用背景**（TC-D-M2-001 正例，DDL L163 可空 FK）。
 * 传入不存在的 `goal_id` 由库级外键拒绝（TC-D-M2-001 反例）。
 */
export async function createBusinessContext(db, input) {
  assertRequired(input, REQUIRED_BUSINESS_CONTEXT, "business_context");
  const goalId = input.goal_id === undefined ? null : input.goal_id; // 允许 NULL
  await db
    .prepare(
      `INSERT INTO business_context
         (context_id, goal_id, context_kind, title, content, source_ref, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.context_id,
      goalId,
      input.context_kind,
      input.title,
      input.content,
      input.source_ref,
      input.is_active === undefined ? 1 : input.is_active,
      input.created_at || nowStamp()
    )
    .run();
  return { context_id: input.context_id, goal_id: goalId };
}

/**
 * 列背景条目。`goal_id` 不传＝全部；传 `null`＝仅平台级；传具体值＝该目标。
 */
export async function listBusinessContext(db, { goal_id, includeInactive = false } = {}) {
  const where = [];
  const params = [];
  if (goal_id !== undefined) {
    if (goal_id === null) {
      where.push("goal_id IS NULL");
    } else {
      where.push("goal_id = ?");
      params.push(goal_id);
    }
  }
  if (!includeInactive) where.push("is_active = 1");
  const sql =
    "SELECT * FROM business_context" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY context_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/* ------------------------------------------------------------------ *
 * MD-05 touchpoint（触点清单）
 * ------------------------------------------------------------------ */

/** 新建触点。`touchpoint_name` 重复由库级 UNIQUE 拒绝（TC-D-M2-002 反例，DDL L180）。 */
export async function createTouchpoint(db, input) {
  assertRequired(input, REQUIRED_TOUCHPOINT, "touchpoint");
  await db
    .prepare(
      `INSERT INTO touchpoint
         (touchpoint_id, touchpoint_name, channel, position_desc, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.touchpoint_id,
      input.touchpoint_name,
      input.channel,
      input.position_desc,
      input.is_active === undefined ? 1 : input.is_active,
      input.created_at || nowStamp()
    )
    .run();
  return { touchpoint_id: input.touchpoint_id, touchpoint_name: input.touchpoint_name };
}

/** 列触点清单（默认仅在册；触点清单是 F-12「范围」维度的取值集合，Agent 不得自造触点）。 */
export async function listTouchpoints(db, { activeOnly = true, channel } = {}) {
  const where = [];
  const params = [];
  if (activeOnly) where.push("is_active = 1");
  if (channel) {
    where.push("channel = ?");
    params.push(channel);
  }
  const sql =
    "SELECT * FROM touchpoint" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY touchpoint_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/* ------------------------------------------------------------------ *
 * F-07 验收：Agent 查询前可获知「能查哪些、该往哪个方向查」
 * ------------------------------------------------------------------ */

/**
 * 背景简报：把某目标（或平台级）可用的背景条目与触点清单一次取回，
 * 供 M3/M4 在查询前知道「该往哪个方向查」。纯确定性读取（同输入→同输出）。
 */
export async function getBackgroundBriefing(db, { goal_id = null } = {}) {
  const contexts = await listBusinessContext(db, { goal_id, includeInactive: false });
  const touchpoints = await listTouchpoints(db, { activeOnly: true });
  return {
    goal_id,
    business_contexts: contexts,
    touchpoints,
    directions: contexts.map((c) => ({ context_kind: c.context_kind, title: c.title })),
  };
}

/* ------------------------------------------------------------------ *
 * CFG-01 source_registry（外部来源登记 · F-08 可用来源与工具登记）
 *
 * 红线（schema CFG-01 / PRD-M2 F-08 / BRD 术语口径）：
 *   系统名称只确定「信息归属」，**实际可查内容须经接入能力确认**
 *   （线上流量信息 ≠ 完整用户行为序列，活动信息 ≠ 活动效果）。
 *   未接入 / 无法查询的信息是**研究缺口**，须如实登记；
 *   **不得用系统名称代替实际证据**——缺口只登记、不计入证据。
 * 边界：CFG-02 `tool_registry` 的**写/注册（MCP 化、is_enabled）归 F-23（M5 阶段2）**；
 *   本项只做 CFG-01 读写 + 只读交叉引用 CFG-02 产出「来源与工具说明」（F-08 声明的输出形态）。
 * 值域：`availability_status` 走 `dict:SOURCE_STATUS`（ok=可用 / degraded=降级 / unauthorized=未接入）。
 * ------------------------------------------------------------------ */

const REQUIRED_SOURCE = [
  "source_id",
  "source_name",
  "capability_can",
  "capability_cannot",
  "availability_status",
];

/**
 * 登记一个外部来源（CFG-01）。`source_id` 走 `dict:SOURCE_CODE`（CDP/HJE/PIM/MKT/ACT）。
 * PK 冲突 / `NULL` 由库级约束拒绝（TC-D-M2-010 反例）。
 */
export async function registerSource(db, input) {
  assertRequired(input, REQUIRED_SOURCE, "source_registry");
  await db
    .prepare(
      `INSERT INTO source_registry
         (source_id, source_name, capability_can, capability_cannot,
          availability_status, is_mcp_ready, registered_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.source_id,
      input.source_name,
      input.capability_can,
      input.capability_cannot,
      input.availability_status,
      input.is_mcp_ready === undefined ? 0 : input.is_mcp_ready,
      input.registered_at || nowStamp(),
      input.updated_at || input.registered_at || nowStamp()
    )
    .run();
  return { source_id: input.source_id, availability_status: input.availability_status };
}

/**
 * 接入能力确认：更新 `can`/`cannot`/可用性/MCP 就绪。
 * F-08「实际可查内容需通过接入能力确认」——接入能力变化即改本表，不得改系统名口径。
 */
export async function updateSourceCapability(db, input) {
  const fields = [];
  const params = [];
  for (const k of [
    "source_name",
    "capability_can",
    "capability_cannot",
    "availability_status",
    "is_mcp_ready",
  ]) {
    if (input[k] !== undefined) {
      fields.push(`${k} = ?`);
      params.push(input[k]);
    }
  }
  if (!fields.length) throw new Error("updateSourceCapability 无可更新字段");
  fields.push("updated_at = ?");
  params.push(input.updated_at || nowStamp());
  params.push(input.source_id);
  await db
    .prepare(`UPDATE source_registry SET ${fields.join(", ")} WHERE source_id = ?`)
    .bind(...params)
    .run();
  return { source_id: input.source_id };
}

/** 列来源（默认全部；可按 `availability_status` 过滤 / 仅取 MCP 已就绪）。 */
export async function listSources(db, { status, mcpReadyOnly = false } = {}) {
  const where = [];
  const params = [];
  if (status) {
    where.push("availability_status = ?");
    params.push(status);
  }
  if (mcpReadyOnly) where.push("is_mcp_ready = 1");
  const sql =
    "SELECT * FROM source_registry" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY source_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/** 取单个来源（含缺口字段）。 */
export async function getSource(db, source_id) {
  return db.prepare("SELECT * FROM source_registry WHERE source_id = ?").bind(source_id).first();
}

/**
 * 来源缺口地图（F-08 验收要点：Agent 能知道「缺少什么信息」）。
 * 缺口来源＝① 未接入（`unauthorized`，整源不可查）或 ② 能力边界（`capability_cannot` 所记）。
 * 每条缺席均带 `is_evidence: false`——**来源名不代替实际证据**：缺口只能如实登记，不能当依据用。
 */
export async function getSourceGaps(db) {
  const sources = await listSources(db);
  return sources
    .map((s) => ({
      source_id: s.source_id,
      source_name: s.source_name,
      availability_status: s.availability_status,
      cannot: s.capability_cannot,
      gap_kind: s.availability_status === "unauthorized" ? "source_unavailable" : "capability_limit",
      is_evidence: false,
    }))
    .filter((g) => g.availability_status !== "ok" || (g.cannot && g.cannot.trim() !== ""));
}

/**
 * 来源与工具说明（F-08 输入→输出：接入能力 → 来源与工具说明）。
 * CFG-01 五类来源 + 只读交叉引用 CFG-02 工具（按来源分组、附用途与调用条件），
 * 供 M3/M4 查询前知道「能查哪些（哪个工具）、缺什么（哪个来源/能力不可查）」。
 * 纯确定性读取（同库状态→同输出）。
 */
export async function getSourceToolBriefing(db) {
  const sources = await listSources(db);
  const { results: tools } = await db
    .prepare(
      `SELECT tool_id, tool_code, tool_name, source_id, tool_purpose, call_condition, is_enabled
         FROM tool_registry ORDER BY tool_id`
    )
    .all();
  const bySource = sources.map((s) => ({
    source_id: s.source_id,
    source_name: s.source_name,
    availability_status: s.availability_status,
    is_mcp_ready: s.is_mcp_ready,
    capability_can: s.capability_can,
    capability_cannot: s.capability_cannot,
    tools: tools
      .filter((t) => t.source_id === s.source_id)
      .map((t) => ({
        tool_code: t.tool_code,
        tool_name: t.tool_name,
        tool_purpose: t.tool_purpose,
        call_condition: t.call_condition,
        is_enabled: t.is_enabled,
      })),
  }));
  return { sources: bySource, gaps: await getSourceGaps(db) };
}

/* ------------------------------------------------------------------ *
 * EXT-02 evidence（证据 · F-09 证据管理）
 *
 * 红线（schema EXT-02 头注 / BRD §7.3 / PRD-M2 F-09）：
 *   每项证据必须关联 **来源 + 查询条件 + 信息时点 + 适用范围**，
 *   「无论哪个 Agent 引用，都应能回查证据是怎样取得的」。
 *   四要素缺任一 → 该证据**不可作为有效依据**（fail，不落库）。
 *   **新证据加入不覆盖原有依据**：EXT-02 只新增行；旧证据保留当时依据，
 *   靠 LNK-01 的 `link_kind`（initial_basis / related_update）区分。
 * 与 EXT-01 的关系：`query_id` 回指「哪一次查询」；条件与时点在本表**冗余一份**，
 *   是为**证据自洽**——查询记录后来补录，证据表述也不随之漂移。
 * 边界：证据**写入**归本文件（F-09）；`query_record`（EXT-01）的写入归 M5 tool-executor（F-24/F-25）。
 * ------------------------------------------------------------------ */

/**
 * **证据四要素**（BRD §7.3 / PRD-M2 F-09）：来源 / 查询条件 / 信息时点 / 适用范围。
 * 缺任一即「不可作为有效依据」——见 `validateEvidenceCompleteness`。
 */
export const EVIDENCE_FOUR_ELEMENTS = [
  "source_id",
  "query_condition",
  "info_time_point",
  "applicability_scope",
];

/** 四要素的中文名（用于错误信息与回查输出，不改变字段口径）。 */
export const EVIDENCE_ELEMENT_LABELS = {
  source_id: "来源",
  query_condition: "查询条件",
  info_time_point: "信息时点",
  applicability_scope: "适用范围",
};

/**
 * 校验证据四要素齐全（**纯函数**，不触库）。
 * 判据：四要素任一为 `undefined` / `null` / 纯空白串 → `valid=false`，并列出缺失字段。
 * 用途：① `createEvidence` 落库前先卡（fail），② 对既有证据行做「是否仍可作有效依据」复核。
 */
export function validateEvidenceCompleteness(evidence) {
  const missing = EVIDENCE_FOUR_ELEMENTS.filter(
    (f) => evidence[f] === undefined || evidence[f] === null || String(evidence[f]).trim() === ""
  );
  return {
    valid: missing.length === 0,
    missing,
    missing_labels: missing.map((f) => EVIDENCE_ELEMENT_LABELS[f]),
  };
}

const REQUIRED_EVIDENCE = [
  "evidence_id",
  "query_id",
  "evidence_title",
  "result_summary",
  "missing_note",
  ...EVIDENCE_FOUR_ELEMENTS,
];

/**
 * 登记一条证据（EXT-02）。**四要素不齐 → 直接 fail、不落库**（TC-I-M2-001 反例）。
 * `query_id` / `source_id` 指向不存在的行由库级外键拒绝（TC-D-M2-007 反例）。
 * 只新增行：本函数不含任何 UPDATE / DELETE，保证「新证据不覆盖原有依据」。
 */
export async function createEvidence(db, input) {
  const completeness = validateEvidenceCompleteness(input);
  if (!completeness.valid) {
    throw new Error(
      `证据四要素不齐（缺：${completeness.missing_labels.join("、")}），不可作为有效依据`
    );
  }
  assertRequired(input, REQUIRED_EVIDENCE, "evidence");
  await db
    .prepare(
      `INSERT INTO evidence
         (evidence_id, query_id, source_id, evidence_title, query_condition,
          info_time_point, applicability_scope, result_summary, missing_note, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.evidence_id,
      input.query_id,
      input.source_id,
      input.evidence_title,
      input.query_condition,
      input.info_time_point,
      input.applicability_scope,
      // TS-16：超单列上限（1MB 字节）时截断＋文末留痕标注；未超限原样落库
      truncateForStorage(input.result_summary, { field: "evidence.result_summary" }),
      input.missing_note,
      input.created_at || nowStamp()
    )
    .run();
  return { evidence_id: input.evidence_id, source_id: input.source_id, query_id: input.query_id };
}

/** 取单条证据（EXT-02 原样）。 */
export async function getEvidence(db, evidence_id) {
  return db.prepare("SELECT * FROM evidence WHERE evidence_id = ?").bind(evidence_id).first();
}

/** 列证据（可按 `source_id` / `query_id` 过滤）。 */
export async function listEvidence(db, { source_id, query_id } = {}) {
  const where = [];
  const params = [];
  if (source_id) {
    where.push("source_id = ?");
    params.push(source_id);
  }
  if (query_id) {
    where.push("query_id = ?");
    params.push(query_id);
  }
  const sql =
    "SELECT * FROM evidence" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY evidence_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/**
 * **证据回查链路**（F-09 验收要点「证据链完整可回溯」）：
 * 证据（EXT-02 自洽副本）→ 查询记录（EXT-01：我查了什么、真实返回什么）→ 来源（CFG-01：查的是哪个系统）。
 * 无论哪个 Agent 引用该证据，都能据此回查「证据是怎样取得的」。
 * `traceable` 为四要素齐全 **且** 能回指查询记录与来源——不满足则该证据不可作有效依据。
 */
export async function getEvidenceTrace(db, evidence_id) {
  const evidence = await getEvidence(db, evidence_id);
  if (!evidence) return null;
  const query_record = await db
    .prepare("SELECT * FROM query_record WHERE query_id = ?")
    .bind(evidence.query_id)
    .first();
  const source = await getSource(db, evidence.source_id);
  const { results: linked_opportunities } = await db
    .prepare("SELECT * FROM opportunity_evidence WHERE evidence_id = ? ORDER BY link_id")
    .bind(evidence_id)
    .all();
  const { results: linked_findings } = await db
    .prepare("SELECT * FROM finding_evidence WHERE evidence_id = ? ORDER BY link_id")
    .bind(evidence_id)
    .all();
  const completeness = validateEvidenceCompleteness(evidence);
  return {
    evidence,
    completeness,
    traceable: completeness.valid && Boolean(query_record) && Boolean(source),
    query_record,
    source,
    linked_opportunities,
    linked_findings,
  };
}

/* ------------------------------------------------------------------ *
 * LNK-01 / LNK-02（证据关联 · F-09 证据链的关联侧）
 *
 * `link_kind` 区分「初步依据 / 关联更新」——**避免把「新证据」与「旧依据」混为一谈**（schema LNK-01 头注）。
 * 关联一律**只新增行**：同一机会出现新证据时追加 `related_update` 关联，旧 `initial_basis` 关联保留。
 * 边界：机会/发现本身的写入归 F-10 / F-21；本文件只提供「证据↔机会/发现」的关联能力。
 * ------------------------------------------------------------------ */

/** LNK-01：把一条证据关联到某个机会（`link_kind` ∈ dict:EVIDENCE_LINK_KIND）。 */
export async function linkOpportunityEvidence(db, input) {
  assertRequired(input, ["link_id", "opportunity_id", "evidence_id", "link_kind"], "opportunity_evidence");
  await db
    .prepare(
      `INSERT INTO opportunity_evidence (link_id, opportunity_id, evidence_id, link_kind, linked_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      input.link_id,
      input.opportunity_id,
      input.evidence_id,
      input.link_kind,
      input.linked_at || nowStamp()
    )
    .run();
  return {
    link_id: input.link_id,
    opportunity_id: input.opportunity_id,
    evidence_id: input.evidence_id,
    link_kind: input.link_kind,
  };
}

/** LNK-02：把一条证据关联到某项关键发现。 */
export async function linkFindingEvidence(db, input) {
  assertRequired(input, ["link_id", "finding_id", "evidence_id"], "finding_evidence");
  await db
    .prepare(
      `INSERT INTO finding_evidence (link_id, finding_id, evidence_id, linked_at)
       VALUES (?, ?, ?, ?)`
    )
    .bind(input.link_id, input.finding_id, input.evidence_id, input.linked_at || nowStamp())
    .run();
  return { link_id: input.link_id, finding_id: input.finding_id, evidence_id: input.evidence_id };
}

/**
 * 某机会的全部证据关联（**新旧依据并存**）：按 `link_kind` + `linked_at` 全量返回，
 * 不做去重/覆盖。调用方据 `link_kind` 区分「初步依据」与「关联更新」。
 */
export async function listEvidenceByOpportunity(db, opportunity_id) {
  const { results } = await db
    .prepare(
      `SELECT oe.link_id, oe.opportunity_id, oe.evidence_id, oe.link_kind, oe.linked_at,
              e.evidence_title, e.info_time_point, e.applicability_scope, e.source_id
         FROM opportunity_evidence oe
         JOIN evidence e ON e.evidence_id = oe.evidence_id
        WHERE oe.opportunity_id = ?
        ORDER BY oe.linked_at, oe.link_id`
    )
    .bind(opportunity_id)
    .all();
  return results;
}

/** 某项关键发现的全部证据关联（**先证据后覆盖**：全量列举，旧依据保留）。 */
export async function listEvidenceByFinding(db, finding_id) {
  const { results } = await db
    .prepare(
      `SELECT fe.link_id, fe.finding_id, fe.evidence_id, fe.linked_at,
              e.evidence_title, e.info_time_point, e.applicability_scope, e.source_id
         FROM finding_evidence fe
         JOIN evidence e ON e.evidence_id = fe.evidence_id
        WHERE fe.finding_id = ?
        ORDER BY fe.linked_at, fe.link_id`
    )
    .bind(finding_id)
    .all();
  return results;
}

/* ------------------------------------------------------------------ *
 * MD-06 opportunity（机会记录 · F-10 机会记录管理）
 *
 * 六要素（schema MD-06 表尾注 / ADR-003 §3）：「对应目标」占**两列**
 *   （`goal_id` + `goal_version_no`），其余四项为 `target_object` / `phenomenon` /
 *   `initial_basis_note` / `research_reason`——**共六个字段**受必填约束；
 *   `opportunity_title` **不在六要素内**。必填落地＝**两件套**（ADR-003 §3.1）：
 *   `NOT NULL` 拦 `NULL` ＋ `CHECK(length(trim(x)) > 0)` 拦空串（二者不可互相替代：
 *   `length(NULL) > 0` 求值为 `NULL`，故 CHECK 会放行 NULL）。
 * `unknown_item` **二态**（ADR-003 §3）：`NULL` = 未评估（判「不齐」，触发待补）；
 *   `''` = 已评估且确无未知项（**计入齐全**）；非空文本 = 已评估且有未知项。
 *   本表**未加二态库级 CHECK**（ADR-003 §3.2）→ 纯空白串（如 `'   '`）库级拦不住，
 *   须**应用层拒绝**（见 `classifyUnknownItem`）。
 * 红线（PRD-M2 F-10）：**暂不研究的机会仍保留记录**——状态置 `deferred`，不删除，
 *   记录保留后可再选；状态迁移走 PD-05 逐次留痕。
 * 边界：机会**人工选择**（F-03）归 M1；**Agent 产出**机会归 M3（F-14~F-16）；
 *   本文件只提供机会记录（MD-06）＋状态日志（PD-05）＋机会关系（LNK-03）的读写。
 * ------------------------------------------------------------------ */

/** 机会六要素（ADR-003 §3 的准确清单：「对应目标」占 `goal_id` + `goal_version_no` 两列）。 */
export const OPPORTUNITY_SIX_ELEMENTS = [
  "goal_id",
  "goal_version_no",
  "target_object",
  "phenomenon",
  "initial_basis_note",
  "research_reason",
];

/** 六要素的中文名（用于错误信息与待补提示，不改变字段口径）。 */
export const OPPORTUNITY_SIX_ELEMENT_LABELS = {
  goal_id: "对应目标",
  goal_version_no: "对应目标（版本）",
  target_object: "涉及对象",
  phenomenon: "观察现象",
  initial_basis_note: "初步依据",
  research_reason: "研究理由",
};

/**
 * `unknown_item` 二态取值（ADR-003 §3）。
 * `invalid_blank` 为**应用层须拒**的非法态（纯空白串，库级不拦）。
 */
export const UNKNOWN_ITEM_STATES = {
  NOT_ASSESSED: "not_assessed", // NULL = 未评估 → 六要素不齐，触发待补
  NONE_CONFIRMED: "none_confirmed", // ''   = 已评估且确无未知项 → 计入齐全
  HAS_UNKNOWN: "has_unknown", // 非空文本 = 已评估且有未知项
  INVALID_BLANK: "invalid_blank", // 纯空白串（非空）→ 应用层拒绝
};

/**
 * `unknown_item` 二态分类（**纯函数**，不触库）。判定式见 ADR-003 §3。
 * `undefined`/`null` → 未评估；恰为空串 `''` → 已评估且确无；
 * `trim()` 后为空但原串非空（如 `'   '`）→ **非法**（须应用层拒）；其余 → 有未知项。
 */
export function classifyUnknownItem(raw) {
  if (raw === undefined || raw === null) return UNKNOWN_ITEM_STATES.NOT_ASSESSED;
  if (raw === "") return UNKNOWN_ITEM_STATES.NONE_CONFIRMED;
  if (String(raw).trim() === "") return UNKNOWN_ITEM_STATES.INVALID_BLANK;
  return UNKNOWN_ITEM_STATES.HAS_UNKNOWN;
}

/**
 * 机会六要素齐全判定（**纯函数**，不触库）。口径见 ADR-003 §3 第 3 条：
 * 「齐全」＝六项**都被评估过**，**不等于**六项都必须有实义内容。
 * - `pending_supplement` ＝ `unknown_item IS NULL`（未评估）→ **触发待补**；
 * - `six_elements_complete` ＝ 六字段齐备 **且** `unknown_item` 已评估（``''`` 或文本）；
 * - `unknown_item_valid=false` ＝ 纯空白串 → 写入侧必须拒（应用层）。
 */
export function assessOpportunitySixElements(opp) {
  const missing = OPPORTUNITY_SIX_ELEMENTS.filter(
    (f) => opp[f] === undefined || opp[f] === null || String(opp[f]).trim() === ""
  );
  const unknown_state = classifyUnknownItem(opp.unknown_item);
  const unknown_item_valid = unknown_state !== UNKNOWN_ITEM_STATES.INVALID_BLANK;
  const six_elements_present = missing.length === 0;
  return {
    six_elements_present,
    missing,
    missing_labels: missing.map((f) => OPPORTUNITY_SIX_ELEMENT_LABELS[f]),
    unknown_state,
    unknown_item_valid,
    six_elements_complete:
      six_elements_present &&
      unknown_state !== UNKNOWN_ITEM_STATES.NOT_ASSESSED &&
      unknown_state !== UNKNOWN_ITEM_STATES.INVALID_BLANK,
    pending_supplement: unknown_state === UNKNOWN_ITEM_STATES.NOT_ASSESSED,
  };
}

/** 六要素 + 标识/标题/状态（`opportunity_title` 不在六要素内但 NOT NULL）。 */
const REQUIRED_OPPORTUNITY = [
  "opportunity_id",
  "opportunity_title",
  "opportunity_status",
  ...OPPORTUNITY_SIX_ELEMENTS,
];

/**
 * 登记一条机会（MD-06）。**六要素不齐 → 应用层先 fail**（友好提示）；
 * 库级 `NOT NULL` + `CHECK` 是最终防线（TC-D-M2-003 / TC-D-M2-004）。
 * `unknown_item` 纯空白串 → 应用层拒绝（TC-D-M2-005 反例，库级拦不住）。
 */
export async function createOpportunity(db, input) {
  const assessment = assessOpportunitySixElements(input);
  if (!assessment.six_elements_present) {
    throw new Error(`机会六要素不齐（缺：${assessment.missing_labels.join("、")}）`);
  }
  if (!assessment.unknown_item_valid) {
    throw new Error("未知项（unknown_item）不得为纯空白串：未评估写 NULL，已评估且确无写空串");
  }
  assertRequired(input, REQUIRED_OPPORTUNITY, "opportunity");
  const unknownItem = input.unknown_item === undefined ? null : input.unknown_item;
  await db
    .prepare(
      `INSERT INTO opportunity
         (opportunity_id, goal_id, goal_version_no, opportunity_title, opportunity_status,
          target_object, phenomenon, initial_basis_note, research_reason, unknown_item,
          defer_reason, producing_task_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.opportunity_id,
      input.goal_id,
      input.goal_version_no,
      input.opportunity_title,
      input.opportunity_status,
      input.target_object,
      input.phenomenon,
      input.initial_basis_note,
      input.research_reason,
      unknownItem,
      input.defer_reason === undefined ? null : input.defer_reason,
      input.producing_task_id === undefined ? null : input.producing_task_id,
      input.created_at || nowStamp()
    )
    .run();
  return {
    opportunity_id: input.opportunity_id,
    opportunity_status: input.opportunity_status,
    unknown_state: assessment.unknown_state,
  };
}

/** 取单个机会（MD-06 原样）。 */
export async function getOpportunity(db, opportunity_id) {
  return db.prepare("SELECT * FROM opportunity WHERE opportunity_id = ?").bind(opportunity_id).first();
}

/**
 * 列机会（可按目标 / 状态过滤）。
 * `pendingSupplementOnly=true` → 仅取 `unknown_item IS NULL` 的**未评估**机会（F-10 触发待补的清单）。
 */
export async function listOpportunities(db, { goal_id, status, pendingSupplementOnly = false } = {}) {
  const where = [];
  const params = [];
  if (goal_id) {
    where.push("goal_id = ?");
    params.push(goal_id);
  }
  if (status) {
    where.push("opportunity_status = ?");
    params.push(status);
  }
  if (pendingSupplementOnly) where.push("unknown_item IS NULL");
  const sql =
    "SELECT * FROM opportunity" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY opportunity_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/* ------------------------------------------------------------------ *
 * PD-05 opportunity_status_log（机会状态变更留痕 · F-10）
 *
 * 「暂不研究的机会仍保留记录，条件变化或新证据后可再选」需要这条链可回查。
 * 首次登记 `from_status` 为空；此后每次状态迁移逐条追加（**只新增行**）。
 * `defer_reason` 口径（schema MD-06）：**仅 `deferred` 时填写**，其余状态置空。
 * ------------------------------------------------------------------ */

const REQUIRED_STATUS_LOG = ["log_id", "opportunity_id", "to_status", "change_reason", "changed_by"];

/** 追加一条状态变更日志（PD-05）。`from_status` 可空（首次登记为空）。 */
export async function logOpportunityStatus(db, input) {
  assertRequired(input, REQUIRED_STATUS_LOG, "opportunity_status_log");
  const fromStatus = input.from_status === undefined ? null : input.from_status;
  await db
    .prepare(
      `INSERT INTO opportunity_status_log
         (log_id, opportunity_id, from_status, to_status, change_reason, changed_at, changed_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.log_id,
      input.opportunity_id,
      fromStatus,
      input.to_status,
      input.change_reason,
      input.changed_at || nowStamp(),
      input.changed_by
    )
    .run();
  return {
    log_id: input.log_id,
    opportunity_id: input.opportunity_id,
    from_status: fromStatus,
    to_status: input.to_status,
  };
}

/** 某机会的完整状态变更链（按变更时点）。 */
export async function listOpportunityStatusLog(db, opportunity_id) {
  const { results } = await db
    .prepare(
      `SELECT * FROM opportunity_status_log
        WHERE opportunity_id = ?
        ORDER BY changed_at, log_id`
    )
    .bind(opportunity_id)
    .all();
  return results;
}

/**
 * 变更机会状态（F-10）：读当前状态作 `from_status` → 改 MD-06 → **追加** PD-05 日志。
 * **不删除**机会记录（暂不研究者置 `deferred`，保留后可再选）。
 * `defer_reason` 仅 `deferred` 时保留，其余状态清空（schema MD-06 口径）。
 * `log_id` 缺省时按该机会已有日志数派生 `LG-<opportunity_id>-<序号>`（确定性、可回查）。
 */
export async function changeOpportunityStatus(db, input = {}) {
  assertRequired(input, ["opportunity_id", "to_status", "change_reason", "changed_by"], "机会状态变更");
  const { opportunity_id, to_status, change_reason, changed_by } = input;
  const current = await getOpportunity(db, opportunity_id);
  if (!current) throw new Error(`机会不存在：${opportunity_id}`);
  const from_status = current.opportunity_status;

  const nextDeferReason =
    to_status === "deferred"
      ? input.defer_reason === undefined
        ? current.defer_reason ?? null
        : input.defer_reason
      : null; // 非 deferred → 清空（「仅 deferred 时填写」）

  await db
    .prepare("UPDATE opportunity SET opportunity_status = ?, defer_reason = ? WHERE opportunity_id = ?")
    .bind(to_status, nextDeferReason, opportunity_id)
    .run();

  const changed_at = input.changed_at || nowStamp();
  let log_id = input.log_id;
  if (!log_id) {
    const row = await db
      .prepare("SELECT COUNT(*) AS c FROM opportunity_status_log WHERE opportunity_id = ?")
      .bind(opportunity_id)
      .first();
    log_id = `LG-${opportunity_id}-${String(Number(row && row.c) + 1).padStart(3, "0")}`;
  }
  await logOpportunityStatus(db, {
    log_id,
    opportunity_id,
    from_status,
    to_status,
    change_reason,
    changed_at,
    changed_by,
  });
  return { opportunity_id, from_status, to_status, log_id };
}

/* ------------------------------------------------------------------ *
 * LNK-03 opportunity_relation（机会 ↔ 机会 · F-10 去重/关联）
 *
 * 「同一问题出现新证据 → 关联到已有机会；新现象有独立价值 → 新机会记录」。
 * **自环禁止**：`from == to` 是业务上无意义的关系 → **应用层拒绝**
 *   （schema §11：该表无物理约束可拦自环，故由应用层校验）。
 * 重复 `(from, to, relation_kind)` → 由库级**复合 UK** 拒绝（TC-D-M2-014）。
 * 边界：机会形成与去重的**判断**归 M3（F-16）；本文件只提供关系登记/读取。
 * ------------------------------------------------------------------ */

/** 登记一条机会↔机会关系（LNK-03）。自环由应用层拒；复合 UK 由库级拒。 */
export async function linkOpportunityRelation(db, input) {
  assertRequired(
    input,
    ["relation_id", "from_opportunity_id", "to_opportunity_id", "relation_kind"],
    "opportunity_relation"
  );
  if (input.from_opportunity_id === input.to_opportunity_id) {
    throw new Error(`机会关系禁止自环：from 与 to 不得为同一机会（${input.from_opportunity_id}）`);
  }
  await db
    .prepare(
      `INSERT INTO opportunity_relation
         (relation_id, from_opportunity_id, to_opportunity_id, relation_kind, created_at)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      input.relation_id,
      input.from_opportunity_id,
      input.to_opportunity_id,
      input.relation_kind,
      input.created_at || nowStamp()
    )
    .run();
  return {
    relation_id: input.relation_id,
    from_opportunity_id: input.from_opportunity_id,
    to_opportunity_id: input.to_opportunity_id,
    relation_kind: input.relation_kind,
  };
}

/** 列机会关系：传 `opportunity_id` → 该机会相关的全部关系（作为 from 或 to）。 */
export async function listOpportunityRelations(db, { opportunity_id } = {}) {
  const where = [];
  const params = [];
  if (opportunity_id) {
    where.push("(from_opportunity_id = ? OR to_opportunity_id = ?)");
    params.push(opportunity_id, opportunity_id);
  }
  const sql =
    "SELECT * FROM opportunity_relation" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY relation_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/**
 * 机会读模型（M2 存储读取面）：机会本体 + 六要素/二态判定 + 状态链 + 关系 + 证据关联。
 * 供 M1 人工节点（F-03）与 M6 前端（F-28 列表与详情页）消费；**纯确定性读取**。
 */
export async function getOpportunityRecord(db, opportunity_id) {
  const opportunity = await getOpportunity(db, opportunity_id);
  if (!opportunity) return null;
  return {
    opportunity,
    assessment: assessOpportunitySixElements(opportunity),
    status_log: await listOpportunityStatusLog(db, opportunity_id),
    relations: await listOpportunityRelations(db, { opportunity_id }),
    evidences: await listEvidenceByOpportunity(db, opportunity_id),
  };
}

/* ------------------------------------------------------------------ *
 * MD-07 research / MD-08 research_finding / EXT-03 external_validation
 * （F-11 研究结果与历史管理）
 * ------------------------------------------------------------------ */

/**
 * MD-07 `research` 的必填集合 ＝ DDL L230-248 的 `NOT NULL` 列（`created_at` 由本模块生成）。
 * 注意 `goal_version_no` 是数值列——SQLite/D1 的 `CHECK (>= 1)` **拦不住空串**（类型序 TEXT > INTEGER），
 * 故「拒空串」在应用层由 `assertRequired` 兜底（同 `opportunity` 的既有约定）。
 */
const REQUIRED_RESEARCH = [
  "research_no",
  "opportunity_id",
  "research_question",
  "e1_goal_statement",
  "e2_scope_method",
  "e4_population_diff",
  "e6_limits",
  "out_of_scope_note",
  "research_status",
  "goal_id",
  "goal_version_no",
];

/** EXT-03 `external_validation` 的必填集合 ＝ DDL L461-468 的 `NOT NULL` 列（`created_at` 由本模块生成）。 */
const REQUIRED_EXTERNAL_VALIDATION = ["validation_id", "research_no", "conclusion", "source_ref", "validated_at"];

/**
 * 登记一份研究（MD-07）。
 * **`parent_research_no` 非空＝追问形成的新研究行**——按 MD-07 表注（schema.md L271）「追问不覆盖原研究」，
 * 本函数**一律 INSERT**，不提供无条件覆盖更新；填不存在的 `opportunity_id` / `parent_research_no`
 * 由库级外键拒绝（TC-D-M2-006；自引用 FK 见 DDL L244）。
 */
export async function createResearch(db, input) {
  assertRequired(input, REQUIRED_RESEARCH, "research");
  await db
    .prepare(
      `INSERT INTO research
         (research_no, opportunity_id, research_question, e1_goal_statement, e2_scope_method,
          e4_population_diff, e6_limits, out_of_scope_note, research_status, goal_id, goal_version_no,
          behavior_hypothesis, population_limit, parent_research_no, start_task_id, finished_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.research_no,
      input.opportunity_id,
      input.research_question,
      input.e1_goal_statement,
      input.e2_scope_method,
      input.e4_population_diff,
      input.e6_limits,
      input.out_of_scope_note,
      input.research_status,
      input.goal_id,
      input.goal_version_no,
      input.behavior_hypothesis ?? null,
      input.population_limit ?? null,
      input.parent_research_no ?? null,
      input.start_task_id ?? null,
      input.finished_at ?? null,
      input.created_at || nowStamp()
    )
    .run();
  return { research_no: input.research_no, parent_research_no: input.parent_research_no ?? null };
}

/** 读单份研究；不存在返回 `null`。 */
export async function getResearch(db, research_no) {
  return db.prepare("SELECT * FROM research WHERE research_no = ?").bind(research_no).first();
}

/** 研究列表（可按机会 / 状态过滤）。 */
export async function listResearch(db, { opportunity_id, research_status } = {}) {
  const where = [];
  const params = [];
  if (opportunity_id) {
    where.push("opportunity_id = ?");
    params.push(opportunity_id);
  }
  if (research_status) {
    where.push("research_status = ?");
    params.push(research_status);
  }
  const sql =
    "SELECT * FROM research" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY created_at DESC, research_no DESC";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/**
 * MD-08 关键发现**只读**（TC-I-M2-004 历史回查时带上）。
 * 发现的生成与写入归 F-20/F-21（M4），本文件不提供其写接口。
 */
export async function listResearchFindings(db, research_no) {
  const { results } = await db
    .prepare("SELECT * FROM research_finding WHERE research_no = ? ORDER BY order_no")
    .bind(research_no)
    .all();
  return results;
}

/**
 * 登记一条外部验证引用（EXT-03）。
 * **平台不执行验证、不计算效果**——只关联业务侧已得出的结论与来源（schema.md EXT-03 表注 L737-738）。
 * 填不存在的 `research_no` 由库级外键拒绝（TC-D-M2-008，DDL L463）。
 */
export async function addExternalValidation(db, input) {
  assertRequired(input, REQUIRED_EXTERNAL_VALIDATION, "external_validation");
  await db
    .prepare(
      `INSERT INTO external_validation
         (validation_id, research_no, conclusion, source_ref, validated_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.validation_id,
      input.research_no,
      input.conclusion,
      input.source_ref,
      input.validated_at,
      input.created_at || nowStamp()
    )
    .run();
  return { validation_id: input.validation_id, research_no: input.research_no };
}

/** 外部验证引用列表（可按研究过滤）。 */
export async function listExternalValidations(db, { research_no } = {}) {
  const where = research_no ? " WHERE research_no = ?" : "";
  const params = research_no ? [research_no] : [];
  const { results } = await db
    .prepare("SELECT * FROM external_validation" + where + " ORDER BY validated_at DESC, validation_id")
    .bind(...params)
    .all();
  return results;
}

/**
 * 追问链追溯（`MD-07.parent_research_no`，TC-I-M2-004「后续研究引用历史、避免重复研究」）。
 * - `ancestors`：由近及远向上（直接父在前）；`chain_from_root`＝根→本研究的历史链。
 * - `descendants`：广度优先向下收集的派生研究（追问链）。
 * - `has_history` / `has_followup`：供调用方直接判断「是否已有历史可引用」。
 * 自环防御：任何环节若 revisit 已见编号即停（父链）或跳过（派生链），不会死循环。
 */
export async function getResearchLineage(db, research_no) {
  const self = await getResearch(db, research_no);
  if (!self) return null;

  const seen = new Set([research_no]);
  const ancestors = [];
  let cur = self.parent_research_no || null;
  while (cur && !seen.has(cur)) {
    seen.add(cur);
    const row = await getResearch(db, cur);
    if (!row) break;
    ancestors.push(row);
    cur = row.parent_research_no || null;
  }

  const descendants = [];
  const queue = [research_no];
  while (queue.length) {
    const parent = queue.shift();
    const { results } = await db
      .prepare("SELECT * FROM research WHERE parent_research_no = ? ORDER BY created_at, research_no")
      .bind(parent)
      .all();
    for (const row of results) {
      if (seen.has(row.research_no)) continue;
      seen.add(row.research_no);
      descendants.push(row);
      queue.push(row.research_no);
    }
  }

  return {
    research_no,
    ancestors,
    descendants,
    chain_from_root: [...ancestors].reverse().concat([self]),
    has_history: ancestors.length > 0,
    has_followup: descendants.length > 0,
  };
}

/**
 * 研究读模型（M2 存储读取面）：研究本体 + 关键发现 + 外部验证引用 + 追问链。
 * 供 M6 研究结果页（F-30）与 M3/M4 历史上下文消费；**纯确定性读取**。
 */
export async function getResearchRecord(db, research_no) {
  const research = await getResearch(db, research_no);
  if (!research) return null;
  return {
    research,
    findings: await listResearchFindings(db, research_no),
    validations: await listExternalValidations(db, { research_no }),
    lineage: await getResearchLineage(db, research_no),
  };
}

/* ------------------------------------------------------------------ *
 * CFG-06 `context_template` + PD-06 `context_injection`
 * （F-12 上下文按任务组织注入）
 *
 * 口径（schema.md CFG-06 / PD-06 / §11 字典枚举；PRD-M2 F-12；ADR-001）：
 *   两个维度——**类型**（CFG-06 按任务类型定该注入哪些信息类型、顺序如何）＋
 *   **范围**（只查和京东超市有关的触点 / 只看业务方负责品类＝任务现读的 `goal_id` +
 *   目标版本的 `business_scope`/`focus_period` + `is_active=1` 触点清单）。
 *   **初始化是确定性程序行为**：注入内容由 CFG-06 模板 + D1 现状决定，不由 Agent 每回随机；
 *   同任务同输入 → 同工作空间；只传一句「继续分析」无效（空工作空间＝不完整，见 `missing_required`）。
 *   背景不做定版快照（Q-03 / ADR-001）：`background` 注入 `MD-04` **当前生效条目**（`is_active=1`），
 *   PD-06 只记「注入了哪几条对象」，不承担「当时内容是什么」的还原责任。
 * 硬红线：只读写本平台自有 D1；注入记录**只新增、不覆盖**；重复初始化**幂等**（已注入对象跳过）。
 * 边界：LNK-04 `task_object` 的**写入**归 M1 task-runner（F-02/F-04/F-06），本文件只读其锚点；
 *   `research_proposal`（MD-12）的写入归 F-03，本文件只读；证据/机会/研究的**生成**归 M3/M4/M5。
 * ------------------------------------------------------------------ */

/** CFG-06 必填（`template_id` PK、`UK(task_type, context_type_code)`，DDL L95-102）。 */
const REQUIRED_CONTEXT_TEMPLATE = ["template_id", "task_type", "context_type_code", "order_no"];

/** PD-06 必填（`injection_id` PK、`task_id` FK→PD-01，DDL L366-373）。 */
const REQUIRED_CONTEXT_INJECTION = [
  "injection_id",
  "task_id",
  "context_type_code",
  "ref_object_type",
  "ref_object_id",
];

/**
 * 上下文信息类型 → 被注入对象的表类别（`PD-06.ref_object_type`）。
 * 值域真源＝`dict:OBJECT_TYPE`（schema.md §11 字典枚举：goal / opportunity / research / proposal）；
 * 本文件**不内联值域、不做域校验**（与 F-10 `LNK-03` 同款口径：值域真源在 `dict_item`）。
 * ⚠️ **Q-08（本项发现，待裁决，已登记 `docs/03-locks/schema.md` §12）**：
 *   `background`（MD-04 背景条目）/ `source`（CFG-01 来源）/ `existing_evidence`（EXT-02 证据）
 *   三类在 `dict:OBJECT_TYPE` **无对应取值**，故本项**只装配其内容、不落 PD-06 行**；
 *   裁决后按裁决结果补写——改这一张映射表即可，不散落各处。
 */
export const CONTEXT_OBJECT_TYPE = {
  goal: "goal",
  opp_summary: "opportunity",
  selected_opp: "opportunity",
  product_question: "proposal",
  related_history: "research",
};

/** Q-08 涉及的三类：只装配、不落 PD-06 行（理由见 `CONTEXT_OBJECT_TYPE`）。 */
export const CONTEXT_WITHOUT_OBJECT_TYPE = ["background", "source", "existing_evidence"];

/**
 * 登记模板项（CFG-06）。重复 `(task_type, context_type_code)` 由库级 UK 拒绝（TC-D-M2-011，DDL L101）；
 * `template_id` 重复由 PK 拒绝。
 */
export async function registerContextTemplate(db, input) {
  assertRequired(input, REQUIRED_CONTEXT_TEMPLATE, "context_template");
  await db
    .prepare(
      `INSERT INTO context_template
         (template_id, task_type, context_type_code, order_no, is_required)
       VALUES (?, ?, ?, ?, ?)`
    )
    .bind(
      input.template_id,
      input.task_type,
      input.context_type_code,
      input.order_no,
      input.is_required === undefined ? 1 : input.is_required
    )
    .run();
  return {
    template_id: input.template_id,
    task_type: input.task_type,
    context_type_code: input.context_type_code,
  };
}

/** 模板列表（可按任务类型过滤；按 `order_no` 确定性排序——注入顺序即模板顺序）。 */
export async function listContextTemplates(db, { task_type } = {}) {
  const where = task_type ? " WHERE task_type = ?" : "";
  const params = task_type ? [task_type] : [];
  const { results } = await db
    .prepare(
      "SELECT * FROM context_template" + where + " ORDER BY task_type, order_no, context_type_code"
    )
    .bind(...params)
    .all();
  return results;
}

/** 取单条模板项。 */
export async function getContextTemplate(db, template_id) {
  return db.prepare("SELECT * FROM context_template WHERE template_id = ?").bind(template_id).first();
}

/**
 * 落一条注入记录（PD-06）。`task_id` 不存在 → 库级外键拒绝（TC-D-M2-009，DDL L368）。
 * 本文件的 `initTaskContext` 与后续 M1 `task-runner`（按步注入）共用同一写入口。
 */
export async function recordContextInjection(db, input) {
  assertRequired(input, REQUIRED_CONTEXT_INJECTION, "context_injection");
  const at = input.injected_at || nowStamp();
  await db
    .prepare(
      `INSERT INTO context_injection
         (injection_id, task_id, context_type_code, ref_object_type, ref_object_id, injected_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      input.injection_id,
      input.task_id,
      input.context_type_code,
      input.ref_object_type,
      input.ref_object_id,
      at
    )
    .run();
  return { injection_id: input.injection_id, injected_at: at };
}

/** 注入记录列表（可按任务 / 信息类型过滤；确定性排序）。 */
export async function listContextInjections(db, { task_id, context_type_code } = {}) {
  const where = [];
  const params = [];
  if (task_id) {
    where.push("task_id = ?");
    params.push(task_id);
  }
  if (context_type_code) {
    where.push("context_type_code = ?");
    params.push(context_type_code);
  }
  const sql =
    "SELECT * FROM context_injection" +
    (where.length ? " WHERE " + where.join(" AND ") : "") +
    " ORDER BY task_id, context_type_code, ref_object_type, ref_object_id";
  const { results } = await db.prepare(sql).bind(...params).all();
  return results;
}

/** 读任务（PD-01）：上下文的 `goal_id` / `goal_version_no` **一律从任务现读**，不由调用方传。 */
async function readTask(db, task_id) {
  const task = await db.prepare("SELECT * FROM task WHERE task_id = ?").bind(task_id).first();
  if (!task) throw new Error(`task 不存在：${task_id}`);
  return task;
}

/**
 * 二阶段锚点：所选机会 / 原研究。显式传入优先，否则从 LNK-04 `task_object` 现读
 * （其**写入**归 M1 task-runner F-02/F-04/F-06，本文件只读）。
 */
async function readTaskAnchors(db, task_id) {
  const { results } = await db
    .prepare("SELECT object_type, object_id FROM task_object WHERE task_id = ? ORDER BY link_id")
    .bind(task_id)
    .all();
  const pick = (t) => {
    const hit = results.find((r) => r.object_type === t);
    return hit ? hit.object_id : null;
  };
  return { opportunity_id: pick("opportunity"), research_no: pick("research") };
}

/**
 * 各信息类型的装配器：入参＝范围（`scope`），出参＝该类型要注入的条目（**确定性排序**）。
 * 一律只读：机会/证据/研究的**生成**分别归 M3/M5/M4，本文件只做按范围的挑选。
 */
const SECTION_RESOLVERS = {
  /** 目标（MD-01）+ 启动采用的目标版本快照（MD-02，含品类 `business_scope` 与关注时段 `focus_period`）。 */
  async goal(db, scope) {
    const goal = await db.prepare("SELECT * FROM research_goal WHERE goal_id = ?").bind(scope.goal_id).first();
    if (!goal) return [];
    const version =
      scope.goal_version_no == null
        ? null
        : await db
            .prepare(
              "SELECT * FROM research_goal_version WHERE goal_id = ? AND version_no = ?"
            )
            .bind(scope.goal_id, scope.goal_version_no)
            .first();
    return [{ ref_object_id: goal.goal_id, goal, version }];
  },

  /** 背景（MD-04）：**当前生效条目**（`is_active=1`），本目标条目 + 平台级通用条目（`goal_id IS NULL`）。 */
  async background(db, scope) {
    const { results } = await db
      .prepare(
        `SELECT * FROM business_context
          WHERE is_active = 1 AND (goal_id = ? OR goal_id IS NULL)
          ORDER BY context_id`
      )
      .bind(scope.goal_id)
      .all();
    return results.map((row) => ({ ref_object_id: row.context_id, background: row }));
  },

  /** 可用来源（CFG-01，F-08 已登记）：含 `capability_can` / `capability_cannot`（缺口来源）。 */
  async source(db) {
    const rows = await listSources(db);
    return rows.map((row) => ({ ref_object_id: row.source_id, source: row }));
  },

  /** 已有机会摘要（MD-06，该目标下）：逐条附六要素判定（ADR-003）。 */
  async opp_summary(db, scope) {
    const rows = await listOpportunities(db, { goal_id: scope.goal_id });
    return rows.map((row) => ({
      ref_object_id: row.opportunity_id,
      opportunity: row,
      six_elements: assessOpportunitySixElements(row),
    }));
  },

  /** 所选机会（MD-06 单条）。 */
  async selected_opp(db, scope) {
    if (!scope.opportunity_id) return [];
    const row = await getOpportunity(db, scope.opportunity_id);
    if (!row) return [];
    return [
      { ref_object_id: row.opportunity_id, opportunity: row, six_elements: assessOpportunitySixElements(row) },
    ];
  },

  /** 产品问题（MD-12 `research_proposal.research_question`；写入归 F-03，本文件只读）。 */
  async product_question(db, scope) {
    if (!scope.opportunity_id) return [];
    const { results } = await db
      .prepare("SELECT * FROM research_proposal WHERE opportunity_id = ? ORDER BY proposal_id")
      .bind(scope.opportunity_id)
      .all();
    return results.map((row) => ({ ref_object_id: row.proposal_id, proposal: row }));
  },

  /** 已有证据（EXT-02 经 LNK-01 挂到该机会；新旧依据并存，按 `link_kind` 区分）。 */
  async existing_evidence(db, scope) {
    if (!scope.opportunity_id) return [];
    const rows = await listEvidenceByOpportunity(db, scope.opportunity_id);
    return rows.map((row) => ({
      ref_object_id: row.evidence_id,
      evidence: row,
      link_kind: row.link_kind,
    }));
  },

  /** 相关历史研究（MD-07，该机会下的既往研究；`has_history` 供「是否已有历史可引用」判定）。 */
  async related_history(db, scope) {
    if (!scope.opportunity_id) return [];
    const rows = await listResearch(db, { opportunity_id: scope.opportunity_id });
    return rows.map((row) => ({
      ref_object_id: row.research_no,
      research: row,
      has_history: Boolean(row.parent_research_no),
    }));
  },
};

/**
 * 装配某任务的工作空间（**纯读取、不写库**）：按 CFG-06 模板逐类型装配。
 * **确定性**：所有查询显式 ORDER BY、不依赖时间与随机；同任务同库状态 → 同结果（TC-I-M2-002）。
 * `missing_required`＝必需类型（`is_required=1`）却为空的类型编码——**为空即视为上下文不完整**。
 */
export async function buildTaskContext(db, { task_id, opportunity_id, research_no } = {}) {
  if (!task_id) throw new Error("buildTaskContext 缺必填字段：task_id");
  const task = await readTask(db, task_id);
  const anchors = await readTaskAnchors(db, task_id);

  const version =
    task.goal_version_no == null
      ? null
      : await db
          .prepare(
            "SELECT business_scope, focus_period FROM research_goal_version WHERE goal_id = ? AND version_no = ?"
          )
          .bind(task.goal_id, task.goal_version_no)
          .first();

  /** 范围（PRD-M2 F-12 第二个维度）：只看本目标的品类与时段、只查京东超市在册触点。 */
  const scope = {
    goal_id: task.goal_id,
    goal_version_no: task.goal_version_no,
    opportunity_id: opportunity_id || anchors.opportunity_id,
    research_no: research_no || anchors.research_no,
    business_scope: version ? version.business_scope : null,
    focus_period: version ? version.focus_period : null,
    touchpoints: await listTouchpoints(db, { activeOnly: true }),
  };

  const template = await listContextTemplates(db, { task_type: task.task_type });
  const sections = [];
  for (const t of template) {
    const resolver = SECTION_RESOLVERS[t.context_type_code];
    const items = resolver ? await resolver(db, scope) : [];
    sections.push({
      context_type_code: t.context_type_code,
      order_no: t.order_no,
      is_required: t.is_required,
      object_type: CONTEXT_OBJECT_TYPE[t.context_type_code] || null,
      no_object_type_q08: CONTEXT_WITHOUT_OBJECT_TYPE.includes(t.context_type_code),
      status: items.length ? "injected" : "empty",
      items,
    });
  }

  const missing_required = sections
    .filter((s) => s.is_required === 1 && s.status === "empty")
    .map((s) => s.context_type_code);

  return {
    task_id,
    task_type: task.task_type,
    goal_id: task.goal_id,
    goal_version_no: task.goal_version_no,
    template: template.map((t) => ({
      template_id: t.template_id,
      context_type_code: t.context_type_code,
      order_no: t.order_no,
      is_required: t.is_required,
    })),
    sections,
    missing_required,
    complete: missing_required.length === 0,
    scope,
  };
}

/**
 * 初始化任务上下文：装配（见 `buildTaskContext`）＋ 落 PD-06 注入记录。
 * **幂等**：同一 `(task_id, context_type_code, ref_object_type, ref_object_id)` 已存在则跳过，不重复落行。
 * `injected_at` 可由调用方显式传入（测试 / 回放），缺省取当前时点。
 * Q-08 涉及的 `background` / `source` / `existing_evidence` 三类**只装配、不落行**。
 */
export async function initTaskContext(db, { task_id, opportunity_id, research_no, injected_at } = {}) {
  const context = await buildTaskContext(db, { task_id, opportunity_id, research_no });
  const at = injected_at || nowStamp();
  const written = [];
  let skipped = 0;
  let seq = 0;

  for (const section of context.sections) {
    const objectType = CONTEXT_OBJECT_TYPE[section.context_type_code];
    if (!objectType) continue; // Q-08：无 OBJECT_TYPE 取值者只装配、不落行
    for (const item of section.items) {
      const dup = await db
        .prepare(
          `SELECT injection_id FROM context_injection
            WHERE task_id = ? AND context_type_code = ? AND ref_object_type = ? AND ref_object_id = ?`
        )
        .bind(task_id, section.context_type_code, objectType, item.ref_object_id)
        .first();
      if (dup) {
        skipped += 1;
        continue;
      }
      seq += 1;
      const injection_id = `CI-${task_id}-${String(seq).padStart(2, "0")}`;
      await recordContextInjection(db, {
        injection_id,
        task_id,
        context_type_code: section.context_type_code,
        ref_object_type: objectType,
        ref_object_id: item.ref_object_id,
        injected_at: at,
      });
      written.push(injection_id);
    }
  }

  return {
    ...context,
    injected_at: at,
    injections_written: written.length,
    injections_skipped: skipped,
    injections: await listContextInjections(db, { task_id }),
  };
}

/**
 * 回读某任务的工作空间：已落 PD-06 的注入记录 + 按当前 D1 现状装配的内容（**纯读取**）。
 * 供 F-31 追问页与「该任务注入过什么」的回查；不改任何数据。
 */
export async function getTaskContext(db, task_id) {
  const injections = await listContextInjections(db, { task_id });
  const context = await buildTaskContext(db, { task_id });
  return { ...context, injections };
}

/**
 * 字典值域只读面（CFG 族 `dict_type`/`dict_item`）：按 `dict_type_code` 列出启用项
 * （`item_code` / 中文口径 `item_name` / `order_no`），按 `order_no` 排序。
 * 用途：前端状态徽标等**展示文案**从库读（frontend/README §4 缺口 7 的收口）——
 * 值域唯一真源在 `dict_item`，前端不再持有第二份业务口径（静态表仅作取数失败时的展示兜底）。
 * 纯读取，零写语句。
 */
export async function listDictItems(db, dict_type_code) {
  const rows = await db
    .prepare(
      "SELECT item_code, item_name, order_no FROM dict_item " +
      "WHERE dict_type_code = ? AND is_active = 1 ORDER BY order_no",
    )
    .bind(dict_type_code)
    .all();
  return (rows.results || []);
}

/**
 * 机会批量读模型：按 id 列表逐个复用 `getOpportunityRecord`（F-10 单一读面，不复制第二份口径），
 * 返回 `items`（id → 读模型或 null）与 `missing_ids`（不存在的 id，**显式可见而非静默吞**）。
 * 用途：机会列表页一次取全（frontend/README §4 缺口 8/12 的收口），替代逐条 N 次请求。
 * 服务端仍是 N 次单读（D1 无跨语句 JOIN 读模型的既有面），但客户端从 N 次往返并为 1 次。
 * 纯读取，零写语句。ids 上限 100（从严拒绝，与 F-02 写入侧从严同一取向）。
 */
export async function listOpportunityReadModels(db, ids) {
  const list = (ids || []).map((s) => String(s).trim()).filter(Boolean);
  if (list.length === 0) throw new Error("listOpportunityReadModels：ids 必填（至少 1 个机会 id）");
  if (list.length > 100) throw new Error(`listOpportunityReadModels：ids 超上限（${list.length} > 100）`);
  const items = {};
  const missing_ids = [];
  for (const id of list) {
    const rec = await getOpportunityRecord(db, id);
    items[id] = rec;
    if (rec === null) missing_ids.push(id);
  }
  return { items, missing_ids };
}
