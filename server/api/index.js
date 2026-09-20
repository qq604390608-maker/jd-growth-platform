/**
 * 文档卡（阶段0-工程骨架 → 阶段1 F-07~F-12 → 阶段2 F-23~F-26 → **阶段3 · M1 F-01~F-03** 接入 · 2026-09-19）
 * 上游：AGENTS.md（宪法：一条硬红线｜索引三层）｜ docs/03-locks/tech-stack.md（§2.2 服务端 api 模块 / §6 工程结构 / §7.3 部署形态 TS-20 待确认）｜ docs/04-plan/dev-plan.md（阶段0 验收要点；阶段1 · M2 F-07~F-12）｜ docs/03-locks/schema.md（CFG-01 source_registry；EXT-02 evidence / LNK-01 / LNK-02；MD-06 opportunity / PD-05 opportunity_status_log / LNK-03 opportunity_relation；MD-07 research / MD-08 research_finding / EXT-03 external_validation；**CFG-06 context_template / PD-06 context_injection**）｜ docs/07-decisions/ADR-003（六要素必填与未知项二态）｜ docs/07-decisions/ADR-001（背景不做定版快照，以 PD-06 记录为准）｜ ../wrangler.toml（D1 绑定 DB）｜ ../../db/（迁移与种子）｜ ../shared-context/index.js（F-07 业务背景管理 / F-08 来源登记 / F-09 证据管理 / F-10 机会记录 / F-11 研究结果与历史管理 / **F-12 上下文按任务组织注入** 实现）｜ ../tool-executor/index.js（**F-23 工具注册与权限检查** 实现：CFG-02 工具登记 / CFG-03 授权登记 / 调用前权限判定，允许与受限互斥、受限必带原因；**F-24 查询执行与真实返回** 实现：`describeTools` 生成工具描述、`executeQuery` 先判权限再决定是否发请求，返回 EXT-01 字段口径的信封 + 证据四要素，**只返回不落库**（落痕归 F-25））｜ **F-25 查询记录保存** 实现：`recordQuery` 执行 + 落 `EXT-01 query_record`（**失败 / 受限 / 执行中一律留痕**）、`saveQueryRecord` 落痕不变量校验（值域取自 `dict:QUERY_STATUS`、失败须带原因、条件不可为空）、`getQueryRecord` / `listQueryRecords` / `readbackQuery` 提供回查）｜ ../tool-executor/task-state.js（**F-26 任务态写入面**：PD-01 任务态跃迁（含「停止状态不自动重启」守卫）、PD-03 受阻留痕与只读回查；**单独成文件以便写入面可静态验证**——改行语句只落在 `task` 且必带主键条件，`index.js` 因而不含改行 / 删行类 SQL）｜ **F-26 失败重试与受限返回** 实现：`getRunPolicy` / `retryLimitOf` 读 `CFG-04 retry_limit`（封顶 100，越界截断并标注）、`executeQueryWithRetry` 按**代码逻辑**重试（**受限不重试**、**成功不算失败**）、`runQueryWithRecovery` 编排「重试 → 落痕 → 任务态处置」、`handleQueryFailure` 写 `PD-03` + 置 `PD-01.task_status` 并保留 `done_part`）｜ ../tool-executor/mcp-client.js（**DS-06 自建 MCP 客户端传输层**：五项协议面，零 SQL 零写）｜ ../task-runner/goal.js（**F-01 研究目标登记与口径管理**：MD-01/02/03 目标身份与六要素定版式版本化、CFG-05 规则驱动口径检查→PD-04、待补项补充并入并 bump 新版本）｜ ../task-runner/schedule.js（**F-02 机会发现任务调度**：CFG-04 运行策略登记与选取、运行频率四式→Cron Triggers、发现任务五步派发（消息只含 task_id+step_no）、Agent 调用守卫）｜ ../task-runner/proposal.js（**F-03 研究建议管理（人工节点）**：MD-12 建议登记与幂等（同键不新建、不重复启动相同任务）、建议与机会版本绑定（版本号从机会现读）、机会状态迁移留 PD-05；机会改行经 F-10 单一写入面）｜ docs/03-locks/external-deps.md §5（12 工具 TOL-01~12，TOL-12 为「不存在」）+ §6（mock 契约七类行为 + 超时失败 + 执行中）
 * 职责：Worker HTTP 入口（api 模块）。骨架职责＝健康检查 + 只读 D1 探测；**F-07 起**接入 `server/shared-context` 的业务背景库接口（背景条目 MD-04 / 触点清单 MD-05 / 背景简报）；**F-08 起**接入来源登记接口（CFG-01 来源清单/登记/接入能力确认/缺口地图/来源与工具说明）；**F-09 起**接入证据接口（EXT-02 证据登记/回查链路 + LNK-01/LNK-02 证据关联）；**F-10 起**接入机会记录接口（MD-06 机会登记/读模型 + PD-05 状态变更留痕 + LNK-03 机会关系）；**F-11 起**接入研究结果与历史接口（MD-07 研究登记/列表/读模型 + MD-08 发现只读 + EXT-03 外部验证引用登记 + `parent_research_no` 追问链追溯）；**F-12 起**接入上下文注入接口（CFG-06 注入模板登记/列表 + PD-06 按任务装配/初始化/回读，初始化确定性可复现且幂等）；**F-23 起**接入工具注册与权限检查接口（CFG-02 工具登记/列表、CFG-03 授权登记/列表、调用前权限判定与批量判定；判定**不发起任何外部调用**）；**F-24 起**接入真实查询接口（`/api/tool-descriptions` 生成工具描述、`/api/query` 先判权限再取真实返回，受限→403 且不调外部接口，返回体保留条件/来源/时点/限制四要素，**只用外部真实返回、不用模型预期替代**，且**不落 EXT-01**——落痕归 F-25）；**F-25 起**接入查询记录接口（`POST /api/query-records` 执行并落痕（失败/受限/执行中一律落行；无 `source_id` 可写时不冒充已留痕，返回 202 + `persist_skip`）、`GET /api/query-records` 列表组合筛选、`GET /api/query-records/{query_id}` 回查并派生条件/来源/时点）；**F-26 起**接入失败重试与受限返回接口（`POST /api/query-recovery` 按 `CFG-04 retry_limit` 重试（封顶 100）、受限不重试，落 EXT-01 后对失败/受限处置任务态（PD-03 受阻 + PD-01 态，保留已完成部分），`GET /api/run-policy` 看生效策略与上限，`GET /api/task-blocks` 回查受阻记录，`GET /api/tasks/{task_id}` 看任务态）；**阶段3 · M1 起**接入平台任务程序接口——**F-01**（`/api/goals` 登记与列表、`/api/goals/{id}` 读模型、`/versions` 落新版本、`/apply` 应用配置（先清零再置一）、`/check` 跑口径检查任务、`/api/goal-gaps` 待补项列表与 `/fill` 补充）、**F-02**（`/api/run-policies` 策略登记与列表（写入侧从严：retry_limit>100 / max_duration_min>15 / 频率不可解析一律 400）、`/api/effective-run-policy` 生效策略（目标级优先回落平台级）、`/api/discovery-tasks` 到点创建发现任务、`/api/task-dispatch` 派发面回查、`/api/agent-delegations` Agent 调用占位）、**F-03**（`POST /api/research-proposals` 提交建议——同幂等键返回 200 且 `created=false`、新建返回 201；`GET /api/research-proposals` 按机会 / 目标 / 是否已触发过滤；`GET /api/research-proposals/{id}` 读模型；`POST /api/research-proposals/{id}/trigger` 登记触发任务（同任务幂等、异任务拒绝）；`POST /api/research-proposal-checks` 研究问题即时提示（**不阻断**））｜ **F-04**（`POST /api/hva-research-tasks` 由研究建议触发建 HVA 研究任务——第二阶段启动时点＝建议提交、组织二阶段上下文 PD-06、取 HVA 工具权限 CFG-03、发 Queue 消息恰两键；`GET /api/hva-research-tasks/{task_id}` 回查任务态 / 步骤 / 权限）｜ **F-05**（`POST /api/followup-tasks` 在已有研究上提新问题→关联原研究建 hva_followup 任务（parent_task_id 挂原任务）+ 新 MD-07 研究（parent_research_no 指向原研究、start_task_id 指向新任务）+ 写 PD-07 追问消息 + 落 PD-06 上下文（含 related_history）；`GET /api/followup-tasks/{task_id}` 回查派发面 + 权限）；**F-06 任务记录与异常恢复**（`POST /api/task-recovery` 对任务执行 block/stop/resume 处置：block＝保留 `done_part`＋置 `blocked`＋写 `PD-03`、stop＝保留 `done_part`＋置 `stopped`（停止不自动重启）＋写 `PD-03(limit_or_cancel)`、resume＝`blocked`→`running`；复用 F-26 `task-state.js` 写入面，零外部调用、不写 `MD-07`/`EXT-02`，`retry_limit` 封顶 100 显式报错）。**F-13 角色指令配置（agent-orchestrator）**（`GET /api/agent-profiles/{agent_code}` 读角色指令 + 生效 Skills + 版本快照；`POST /api/agent-profiles/{agent_code}/version` 推进 agent.md 版本（单行 UNIQUE、不新建行）；`POST /api/skills` 注册 Skill（PK/UK/FK 库级强制）；MD-13/MD-14 唯一写入面，零外部调用、不调 LLM（A-1 门禁只挡推理））；**F-14 围绕目标寻找线索（agent-orchestrator/discovery.js）**（`POST /api/discovery-plan` S-A1 一阶段注入清单→确定性查证计划（纯计算、零写库）；`GET /api/discovery-context/{task_id}` 装配一阶段注入清单（薄读，复用 shared-context 读面）；`POST /api/clue-summary` S-A3 按「谁在什么环节遇到什么现象」归纳线索（每条须有人群/环节归属、拒裸变化）；`POST /api/intention-score` 意向分归一 min(raw/threshold,1)（TC-U-M3-001）；S-A1/S-A3 真实 LLM 产出受 A-1 门禁，本路由仅暴露确定性编排）。**F-15 基础查证（agent-orchestrator/verification.js）**（`POST /api/metric-verification` S-A2 指标查证一次闭环——经工具执行程序 M5 真实查询（重试 + 落 EXT-01 + 失败/受限处置任务态全部复用 M5）、五项检查、证据草稿与初步解释；**硬红线：result_summary 原样透传自真实返回，失败/受限只回报真实原因，`model_expectation` 被显式忽略**；`POST /api/five-checks` 五项检查（来源/适用范围/信息时点/已有机会/信息缺口，缺口口径读 CFG-05、已有机会比对读 MD-06）；`POST /api/evidence-isolation` 倒挂隔离（TC-A-M3-006：信息时点晚于取数时刻的仅该条失效、非整包失败）；`POST /api/missing-fields` 只松不严不硬映射（TC-A-M3-005：缺字段退回请补，不静默回退、不编造）；`POST /api/verification-evidence` 装配 EXT-02 形态草稿（`persist=true` 时复用 F-09 `createEvidence` 单一写入面落库）；`POST /api/verification-query` 只跑一次真实查询供排查。本模块**零自有写语句**：EXT-01 归 M5、EXT-02 归 F-09；A-1 LLM 未提供，TC-A-M3-002 的真实产出契约登记为「门禁未关闭、非发布门禁」）。**F-16 机会形成与去重（agent-orchestrator/opportunity.js）**（`POST /api/opportunity-formation` S-A4 整理：依据足够→组装六要素（对应目标/涉及对象/观察现象/初步依据/研究理由 + 未知项二态）落 MD-06，判重命中则落 LNK-03 相同问题关联更新；**依据不足→返回缺口记录且不写任何表（「本轮未产生新机会」是合法产出，故回 200 而非错误）**；`POST /api/opportunity-six-elements` 六要素组装 + 二态判定；`POST /api/opportunity-basis` 依据足够性判定（真实返回/来源可回查/未倒挂/六要素已评估齐备/标题可派生；适用范围未判定不阻断、记 caveat）；`POST /api/opportunity-gap-record` 缺口记录（检查范围+信息缺口+影响判断）；`GET /api/opportunity-next-id` 取号。本模块**零自有写语句**：MD-06 归 F-10 `createOpportunity`、LNK-03 归 F-10 `linkOpportunityRelation`；`unknown_item` 纯空白串应用层显式拒（ADR-003）；止于机会、不下 HVA 判断）；**F-17 两步衔接**（`POST /api/pm-decision-context` M3 产出→PM 决策上下文（机会六要素＋初步依据四要素＋未知项＋缺口＋「尚不构成 HVA 结论」声明）、`GET /api/handoff-gate/{opportunity_id}` 人工节点守卫（完成判据＝MD-12 有无真实建议行，不看机会状态；`auto_handoff` 恒 false）、`POST /api/pm-supplement-requests` 反向问 PM 请补项、`POST /api/handoff-package` 交接包**只组装不触发**（未过守卫 `handoff:null`＋`blocked_by='human_node'`）；**绝不触发 M4**——不 import `hva.js`、不调用建任务面）；**F-18 角色指令配置**（`GET /api/agent-roles/{agent_code}` 装载运行期角色指令包（agent.md 段落骨架 5 段＋business-rules 8 条＋结束条件与边界声明，复用 F-13 读面，叙述文本本体在 `agent-runtime/`）、`POST /api/research-closure` 结束条件判定（有依据的研究回答 / 说明无法完成判断的原因——二者皆缺不结束；产品假设不得当回答、失败导致的否定不得作依据）、`POST /api/hypothesis-label` 产品假设性质标注（不预设结论）、`POST /api/output-boundary-scan` 输出边界扫描（禁活动配置 / 权益组合 / 预算 / 排期）；**零写库**）；**F-19 研究起点处理（agent-orchestrator/research-start.js）**（`GET /api/research-start-context/{task_id}` 装配二阶段注入清单（机会及版本 / 产品问题 / 可选假设 / 证据 / 历史，薄读复用 shared-context 读面）；`POST /api/research-start` S-B1 研究任务调度——三分支路径选择（① 有假设→查证假设、② 只有研究问题→寻找候选、③ 问题不适合→说明限制）＋比较条件＋排查证顺序＋研究计划，**路径确定即停止**，产品假设不预先作为结论；`POST /api/research-suitability` 适合性判断（不适合时说明限制而非硬做；语义判断受 A-1 门禁，可注入覆盖）；`POST /api/comparison-conditions` 比较条件装配（涉及哪些用户 / 观察哪个阶段 / 什么结果口径，缺则如实登记缺口）；**纯编排 · 零写库 · 零裸 SQL**，假设性质标注复用 F-18 `./role.js` 单一口径）；**F-20 人群比较与行为关系检验（agent-orchestrator/behavior.js）**（`POST /api/behavior-threshold` 综合分入池阈值（TC-U-M4-001：`composite_raw ≥ pool_threshold` → 入池，确定性无随机）；`POST /api/population-comparability` S-B2 人群可比性检查（取人群特征与原有表现 → 差异是否已解释 → 可比性结论＋限制，差异未解释时**限制行为作用判断**）；`POST /api/behavior-checks` S-B3 候选行为五查（① 人群可比基础 ② 先后关系 ③ 口径一致 ④ 其他解释 ⑤ 信息充分；**倒挂隔离＝信息时点晚于取数时刻的仅该条失效、非整包失败**；活动存在 ≠ 用户参与、未排查维度不得默认无关；因果不臆断；失败导致的条目不作否定依据而是转缺口；**未支持也是完整结果**）；`POST /api/comparison-gate` 比较条件守卫（TC-A-M4-006：缺比较条件 / 查不到已过审素材 → **退回请补，不静默回退**）；`POST /api/behavior-verification` 一步编排（守卫 → 入池 → 五查，纯计算零写库）；`POST /api/candidate-behavior` 落库 MD-09 候选行为 + MD-10 支持/不支持条目（**退回请补与未入池均不写库**；`MD-09/MD-10` 唯一写入面在 `behavior-store.js`，编排层**零写语句 · 零裸 SQL**；取数经 M5 **只读**——复用 F-15 `runMetricVerification`，五查顺序与比较条件复用 F-19，`check_key` 须属五查键）；`POST /api/research-result` 七要素组装（纯计算）、`POST /api/research-result-boundary` 七要素正文硬红线扫描（409）、`POST /api/improvement-correspondence` 改善方向与发现逐项对应校验、`POST /api/research-report` 研究结果落库（**S-B4 七要素齐全并保存**：MD-07 内容填充 + MD-08 + LNK-02 + MD-11，`MD-07/MD-08/MD-11` 唯一写入面在 `result-store.js`，编排层**零 SQL**；**边界违规 409 · 未齐/对不上/已出报告均不写库**）、`GET /api/research-result/{research_no}` 报告回查、`GET /api/research-next-id` 取号（只读）。**F-22 继续追问承接（agent-orchestrator/followup-intake.js）**（`POST /api/followup-intake` 承接一次追问——读追问任务（须 `hva_followup`）与原研究 → **原样保留原结果与依据**（七要素 + 逐发现证据 + 追问链，本步只读不写）→ **检查已有依据是否仍适用**（时间范围 / 查询条件 / 适用范围三类变化 → 沿用 or 补查；**未声明变更 → `undetermined` 且标 `llm_gated`**，依据缺可比对字段按**保守方向**计入补查）→ 版本口径（追问可落新版本，**原任务与原研究钉在启动时版本**）→ 交出新一轮入口（S-B1 → F-19/F-20/F-21）；`POST /api/followup-evidence-reuse` 依据复用判定（纯计算）、`POST /api/followup-version` 版本口径判定（纯计算）、`GET /api/followup-intake/{task_id}` 承接上下文薄读（200/404）；**本模块零写语句 · 零裸 SQL · 零外部调用 · 不调 LLM**——MD-07 建行与 PD-07 写入归 M1 F-05、MD-02 新版本归 M1 F-01、原结果经 F-21 读面取得、抽时点复用 F-15）。其余 F-xx 的真实接口随后续阶段接入。**A-1 起**（2026-09-20 收编）接入 LLM 连通性路由：`GET /api/ai-ping`（AI binding 连通探测，binding 缺失时**自动降级 mock 并如实上报 `ai:"mock"`**，不伪装成 reachable）、`POST /api/ai-tool-test`（function calling 链路验证，同上 mock 降级）——二者均属**研发期探测路由**，模型一律引用 `llm-client.js` 的 `MODELS` 常量、**不在路由内硬编码模型 ID**；`/api/health` 附带上报 `ai: "bound"|"mock_mode"`。业务编排的防静默伪造由 `discovery.js` 的 A-1 门禁把关（探测路由属可观测诊断，mock 降级不影响业务路径）。**2026-09-21 增补**（frontend/README §4 缺口 7/8/12 收口）：`GET /api/dicts/{dict_type_code}` 字典值域只读（真源 `dict_item`）＋ `GET /api/opportunity-readmodels?ids=` 机会批量读模型（复用 F-10 单一读面、`missing_ids` 显式回报、上限 100）——均只读、零写语句。
 * 硬红线落实（BRD §5.3 / tech-stack §7.2）：只读写**本平台自有 D1**（「共享上下文＝数据库」），**不调任何面向生产环境会改线上数据的接口**；证据一律只新增行、不覆盖；暂不研究的机会**只改状态、不删除**；**追问不覆盖原研究**（MD-07 表注：追问新增行、`parent_research_no` 指向原研究）；外部验证**只登记业务侧结论与来源引用**，平台不执行验证、不计算效果。
 * 反向清单：被 AGENTS.md 索引 server/ 行 / server/README.md 引用；后续 task-runner｜agent-orchestrator｜tool-executor 复用本入口或按 TS-20 拆分。
 *
 * @param {Request} request
 * @param {Env} env 含 D1 binding `DB`（见 wrangler.toml）
 */
import {
  createBusinessContext,
  listBusinessContext,
  createTouchpoint,
  listTouchpoints,
  getBackgroundBriefing,
  registerSource,
  updateSourceCapability,
  listSources,
  getSourceGaps,
  getSourceToolBriefing,
  createEvidence,
  getEvidence,
  listEvidence,
  getEvidenceTrace,
  linkOpportunityEvidence,
  linkFindingEvidence,
  listEvidenceByOpportunity,
  listEvidenceByFinding,
  createOpportunity,
  listOpportunities,
  changeOpportunityStatus,
  linkOpportunityRelation,
  listOpportunityRelations,
  getOpportunityRecord,
  createResearch,
  listResearch,
  listResearchFindings,
  addExternalValidation,
  listExternalValidations,
  getResearchLineage,
  getResearchRecord,
  registerContextTemplate,
  listContextTemplates,
  recordContextInjection,
  listContextInjections,
  buildTaskContext,
  initTaskContext,
  getTaskContext,
  listDictItems,
  listOpportunityReadModels,
} from "../shared-context/index.js";
import {
  registerGoal,
  listGoals,
  getGoalRecord,
  saveGoalVersion,
  applyGoalVersion,
  runGoalCheckTask,
  listGoalGaps,
  fillGoalGap,
} from "../task-runner/goal.js";
import {
  parseRunFrequency,
  saveRunPolicy,
  listRunPolicies,
  resolveRunPolicy,
  createDiscoveryTask,
  getTaskDispatch,
  delegateToAgent,
} from "../task-runner/schedule.js";
import {
  submitProposal,
  listProposals,
  getProposalRecord,
  markProposalTriggered,
  checkResearchQuestion,
} from "../task-runner/proposal.js";
import {
  createHvaResearchTask,
  resolveHvaToolPermissions,
} from "../task-runner/hva.js";
import {
  createFollowupTask,
} from "../task-runner/followup.js";
import {
  capRetryLimit,
  recordTaskBlock,
  stopTask,
  resumeTask,
  handleTaskFailure,
} from "../task-runner/recovery.js";
import {
  registerTool,
  listTools,
  registerPermission,
  listPermissions,
  checkToolPermission,
  checkToolPermissions,
  describeTools,
  executeQuery,
  recordQuery,
  readbackQuery,
  listQueryRecords,
  runQueryWithRecovery,
  getRunPolicy,
  retryLimitOf,
  listTaskBlocks,
  getTask,
  RESTRICTED_NOTE,
} from "../tool-executor/index.js";
import {
  getAgentProfile,
  listAgentSkills,
  bumpAgentProfileVersion,
  registerSkill,
  composeAgentVersionSnapshot,
} from "../agent-orchestrator/profile.js";
import {
  normalizeIntentionScore,
  assembleDiscoveryPlan,
  summarizeCluesAsJourney,
  loadDiscoveryContext,
  runDiscoveryWithLLM,
} from "../agent-orchestrator/discovery.js";
import {
  runMetricVerification,
  verifyFiveChecks,
  isolateContradictedEvidence,
  resolveMissingFields,
  buildEvidenceDraft,
  verifyClueAndDraftEvidence,
  recordVerificationEvidence,
} from "../agent-orchestrator/verification.js";
import {
  formOpportunityOrGap,
  nextOpportunityId,
  nextOpportunityRelationId,
  hasEnoughBasis,
  buildOpportunitySixElements,
  buildGapRecord,
} from "../agent-orchestrator/opportunity.js";

import {
  assemblePmDecisionContext,
  evaluateHandoffGate,
  collectSupplementRequests,
  composeHandoffPackage,
} from "../agent-orchestrator/handoff.js";
import {
  loadAgentRole,
  evaluateResearchClosure,
  labelProductHypothesis,
  scanProductionActions,
} from "../agent-orchestrator/role.js";
import {
  judgeResearchSuitability,
  assembleResearchStart,
  resolveComparisonConditions,
  loadResearchStartContext,
} from "../agent-orchestrator/research-start.js";
import {
  judgePoolThreshold,
  checkPopulationComparability,
  runBehaviorChecks,
  evaluateComparisonGate,
  assembleBehaviorVerification,
  formCandidateBehavior,
} from "../agent-orchestrator/behavior.js";
import {
  assembleResearchResult,
  validateImprovementCorrespondence,
  scanResultBoundary,
  saveResearchReport,
  loadResearchResultContext,
  nextFindingId,
  nextActionId,
  nextFindingEvidenceLinkId,
} from "../agent-orchestrator/result.js";
import {
  intakeFollowup,
  loadFollowupIntakeContext,
  assessEvidenceReuse,
  assessVersionPinning,
} from "../agent-orchestrator/followup-intake.js";

/**
 * 把模块抛出的错误映射为 HTTP 状态：
 * 目标行不存在→404；库级约束冲突（NOT NULL/UNIQUE/FK/CHECK）→409；
 * 应用层校验不通过（缺必填 / 四要素不齐 / 六要素不齐 / 未知项非法 / 自环 / 字典值域外 / 任务态守卫）→400；其余→500。
 */
function errorResponse(e) {
  const msg = String((e && e.message) || e);
  let status = 500;
  if (/不存在/.test(msg)) status = 404;
  else if (/NOT NULL|UNIQUE|FOREIGN KEY|CHECK|constraint/i.test(msg)) status = 409;
  else if (/已存在|已补充|重复/.test(msg)) status = 409;
  else if (/必填|四要素不齐|六要素不齐|未知项|自环|不自动重启|不改写已结束|不在 dict:|无法解析|超出|须为|只能含|不得|拒绝落库|必须一致/.test(msg)) status = 400;
  return Response.json({ error: msg }, { status });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // 健康检查：证明 Worker 已加载、可响应；含 AI binding 状态
      if (pathname === "/api/health") {
        return Response.json({
          status: "ok",
          ts: new Date().toISOString(),
          ai: env.AI ? "bound" : "mock_mode",
        });
      }

      // 只读 D1 连通探测：证明 D1 binding 已接通、迁移已应用（无任何写操作）
      if (pathname === "/api/db-ping") {
        try {
          const { results } = await env.DB.prepare("SELECT 1 AS ok").all();
          return Response.json({ d1: "reachable", ok: results[0] && results[0].ok });
        } catch (e) {
          return Response.json({ d1: "error", message: String(e) }, { status: 500 });
        }
      }

      // A-1 LLM 连通探测：证明 AI binding 已接通（mock 模式自动降级）
      if (pathname === "/api/ai-ping" && request.method === "GET") {
        try {
          const { chat, extractContent, isMockMode, MODELS } = await import("../agent-orchestrator/llm-client.js");
          const mock = isMockMode(env.AI);
          const completion = await chat(env.AI, [{ role: "user", content: "回复 ok" }], { max_tokens: 10 });
          const content = extractContent(completion) || "";
          return Response.json({ ai: mock ? "mock" : "reachable", model: mock ? "mock-model" : MODELS.MAIN, response: content.trim() });
        } catch (e) {
          return Response.json({ ai: "error", message: String(e) }, { status: 500 });
        }
      }

      // A-1 LLM function calling 测试：验证工具调用链路（mock 模式自动降级）
      if (pathname === "/api/ai-tool-test" && request.method === "POST") {
        try {
          const { chatWithTools, isMockMode, MODELS } = await import("../agent-orchestrator/llm-client.js");
          const mock = isMockMode(env.AI);
          const result = await chatWithTools(
            env.AI,
            "你是测试助手。当用户问天气时，调用 get_weather 工具。",
            "北京今天天气怎么样？",
            [{ type: "function", function: { name: "get_weather", description: "查询天气", parameters: { type: "object", properties: { city: { type: "string" } }, required: ["city"] } } }],
            async (toolName, args) => ({ city: args.city, weather: "晴", temp: "22°C" }),
            { model: MODELS.MAIN },
          );
          return Response.json({ ai: mock ? "mock" : "tool_call_ok", ...result });
        } catch (e) {
          return Response.json({ ai: "tool_call_error", message: String(e) }, { status: 500 });
        }
      }

      // ---------------- F-07 业务背景管理（M2 共享上下文） ----------------

      // 背景条目：列表 / 新建（MD-04）
      if (pathname === "/api/business-context") {
        if (request.method === "GET") {
          const goal_id = url.searchParams.has("goal_id")
            ? url.searchParams.get("goal_id") || null // 空串＝平台级（goal_id IS NULL）
            : undefined; // 不传＝全部
          return Response.json({ items: await listBusinessContext(env.DB, { goal_id }) });
        }
        if (request.method === "POST") {
          return Response.json(await createBusinessContext(env.DB, await request.json()), { status: 201 });
        }
      }

      // 触点清单：列表 / 新建（MD-05）
      if (pathname === "/api/touchpoints") {
        if (request.method === "GET") {
          const channel = url.searchParams.get("channel") || undefined;
          return Response.json({ items: await listTouchpoints(env.DB, { channel }) });
        }
        if (request.method === "POST") {
          return Response.json(await createTouchpoint(env.DB, await request.json()), { status: 201 });
        }
      }

      // 背景简报：F-07 验收「Agent 查询前可获知能查哪些、该往哪个方向查」
      if (pathname === "/api/background-briefing" && request.method === "GET") {
        const goal_id = url.searchParams.has("goal_id") ? url.searchParams.get("goal_id") || null : null;
        return Response.json(await getBackgroundBriefing(env.DB, { goal_id }));
      }

      // ---------------- F-08 可用来源与工具登记（M2 共享上下文 · CFG-01） ----------------

      // 来源清单：列表 / 登记（CFG-01）
      if (pathname === "/api/sources") {
        if (request.method === "GET") {
          const status = url.searchParams.get("status") || undefined;
          const mcpReadyOnly = url.searchParams.get("mcp_ready") === "1";
          return Response.json({ items: await listSources(env.DB, { status, mcpReadyOnly }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerSource(env.DB, await request.json()), { status: 201 });
        }
      }

      // 接入能力确认（F-08「实际可查内容需通过接入能力确认」）
      if (pathname === "/api/sources/capability" && request.method === "PATCH") {
        return Response.json(await updateSourceCapability(env.DB, await request.json()));
      }

      // 来源缺口地图：F-08 验收「Agent 能知道缺少什么信息」（缺口 is_evidence=false）
      if (pathname === "/api/source-gaps" && request.method === "GET") {
        return Response.json({ gaps: await getSourceGaps(env.DB) });
      }

      // 来源与工具说明：F-08 输入→输出「接入能力 → 来源与工具说明」
      if (pathname === "/api/source-tool-briefing" && request.method === "GET") {
        return Response.json(await getSourceToolBriefing(env.DB));
      }

      // ---------------- F-09 证据管理（M2 共享上下文 · EXT-02 + LNK-01/LNK-02） ----------------

      // 证据：列表（可按来源/查询/机会/发现过滤）/ 登记（EXT-02）
      if (pathname === "/api/evidence") {
        if (request.method === "GET") {
          const opportunity_id = url.searchParams.get("opportunity_id");
          const finding_id = url.searchParams.get("finding_id");
          if (opportunity_id) {
            // 某机会的全部证据关联（新旧依据并存，按 link_kind 区分）
            return Response.json({ items: await listEvidenceByOpportunity(env.DB, opportunity_id) });
          }
          if (finding_id) {
            return Response.json({ items: await listEvidenceByFinding(env.DB, finding_id) });
          }
          const source_id = url.searchParams.get("source_id") || undefined;
          const query_id = url.searchParams.get("query_id") || undefined;
          return Response.json({ items: await listEvidence(env.DB, { source_id, query_id }) });
        }
        if (request.method === "POST") {
          // 四要素不齐 → 400（不可作为有效依据）；query_id/source_id 不存在 → 409（FK）
          return Response.json(await createEvidence(env.DB, await request.json()), { status: 201 });
        }
      }

      // 证据回查链路：证据 → 查询记录 → 来源（F-09「证据链完整可回溯」）
      if (pathname.startsWith("/api/evidence-trace/") && request.method === "GET") {
        const evidence_id = decodeURIComponent(pathname.slice("/api/evidence-trace/".length));
        const trace = await getEvidenceTrace(env.DB, evidence_id);
        if (trace === null) return Response.json({ error: `证据不存在：${evidence_id}` }, { status: 404 });
        return Response.json(trace);
      }

      // 单条证据（原样，EXT-02 自洽副本）
      if (pathname.startsWith("/api/evidence/") && request.method === "GET") {
        const evidence_id = decodeURIComponent(pathname.slice("/api/evidence/".length));
        const ev = await getEvidence(env.DB, evidence_id);
        if (ev === null) return Response.json({ error: `证据不存在：${evidence_id}` }, { status: 404 });
        return Response.json(ev);
      }

      // 证据关联：LNK-01（机会）/ LNK-02（发现）
      if (pathname === "/api/evidence-links/opportunity" && request.method === "POST") {
        return Response.json(await linkOpportunityEvidence(env.DB, await request.json()), { status: 201 });
      }
      if (pathname === "/api/evidence-links/finding" && request.method === "POST") {
        return Response.json(await linkFindingEvidence(env.DB, await request.json()), { status: 201 });
      }

      // ---------------- F-10 机会记录管理（M2 共享上下文 · MD-06 + PD-05 + LNK-03） ----------------

      // 机会：列表（可按目标/状态过滤；`pending_supplement=1` 只看未评估待补）/ 登记（MD-06）
      if (pathname === "/api/opportunities") {
        if (request.method === "GET") {
          const goal_id = url.searchParams.get("goal_id") || undefined;
          const status = url.searchParams.get("status") || undefined;
          const pendingSupplementOnly = url.searchParams.get("pending_supplement") === "1";
          return Response.json({
            items: await listOpportunities(env.DB, { goal_id, status, pendingSupplementOnly }),
          });
        }
        if (request.method === "POST") {
          // 六要素不齐 / unknown_item 纯空白串 → 400（应用层拒）；库级 NOT NULL/CHECK → 409
          return Response.json(await createOpportunity(env.DB, await request.json()), { status: 201 });
        }
      }

      // 机会状态变更（F-10：暂不研究者置 deferred、记录保留；PD-05 逐次留痕）
      if (pathname === "/api/opportunity-status" && request.method === "PATCH") {
        return Response.json(await changeOpportunityStatus(env.DB, await request.json()));
      }

      // 机会关系：列表 / 登记（LNK-03；自环 → 400 应用层拒，复合 UK → 409 库级拒）
      if (pathname === "/api/opportunity-relations") {
        if (request.method === "GET") {
          const opportunity_id = url.searchParams.get("opportunity_id") || undefined;
          return Response.json({ items: await listOpportunityRelations(env.DB, { opportunity_id }) });
        }
        if (request.method === "POST") {
          return Response.json(await linkOpportunityRelation(env.DB, await request.json()), { status: 201 });
        }
      }

      // 机会读模型：本体 + 六要素/二态判定 + 状态链 + 关系 + 证据关联（F-28 列表与详情页的存储读取面）
      if (pathname.startsWith("/api/opportunities/") && request.method === "GET") {
        const opportunity_id = decodeURIComponent(pathname.slice("/api/opportunities/".length));
        const rec = await getOpportunityRecord(env.DB, opportunity_id);
        if (rec === null) return Response.json({ error: `机会不存在：${opportunity_id}` }, { status: 404 });
        return Response.json(rec);
      }

      // 机会批量读模型（frontend/README §4 缺口 8/12 收口，2026-09-21）：列表页一次取全，
      // 替代逐条 N 次请求。只读；ids 必填、上限 100（从严拒绝）；不存在的 id 进 missing_ids 显式回报。
      if (pathname === "/api/opportunity-readmodels" && request.method === "GET") {
        const idsParam = new URL(request.url).searchParams.get("ids") || "";
        const ids = idsParam.split(",").map((s) => s.trim()).filter(Boolean);
        try {
          return Response.json(await listOpportunityReadModels(env.DB, ids));
        } catch (e) {
          return Response.json({ error: (e && e.message) || String(e) }, { status: 400 });
        }
      }

      // 字典值域只读路由（frontend/README §4 缺口 7 收口，2026-09-21）：展示文案从库读，
      // 值域唯一真源在 dict_item。只读；未知 dict_type_code 返回空 items（不报错，展示兜底由前端静态表承担）。
      if (pathname.startsWith("/api/dicts/") && request.method === "GET") {
        const code = decodeURIComponent(pathname.slice("/api/dicts/".length));
        if (!code) return Response.json({ error: "dict_type_code 必填" }, { status: 400 });
        return Response.json({ dict_type_code: code, items: await listDictItems(env.DB, code) });
      }

      // ---------------- F-11 研究结果与历史管理（M2 共享上下文 · MD-07 + MD-08 + EXT-03） ----------------

      // 研究：列表（可按机会 / 状态过滤）/ 登记（MD-07）
      if (pathname === "/api/research") {
        if (request.method === "GET") {
          const opportunity_id = url.searchParams.get("opportunity_id") || undefined;
          const research_status = url.searchParams.get("research_status") || undefined;
          return Response.json({ items: await listResearch(env.DB, { opportunity_id, research_status }) });
        }
        if (request.method === "POST") {
          // 必填缺失 → 400（应用层拒）；opportunity_id / parent_research_no 不存在 → 409（库级 FK）
          return Response.json(await createResearch(env.DB, await request.json()), { status: 201 });
        }
      }

      // 追问链追溯： ancestors / descendants / chain_from_root（TC-I-M2-004「历史可回查、避免重复研究」）
      if (pathname.startsWith("/api/research-lineage/") && request.method === "GET") {
        const research_no = decodeURIComponent(pathname.slice("/api/research-lineage/".length));
        const lineage = await getResearchLineage(env.DB, research_no);
        if (lineage === null) return Response.json({ error: `研究不存在：${research_no}` }, { status: 404 });
        return Response.json(lineage);
      }

      // 关键发现：MD-08 **只读**（发现与七要素正文的生成归 F-20/F-21 M4）
      if (pathname.startsWith("/api/research/") && pathname.endsWith("/findings") && request.method === "GET") {
        const research_no = decodeURIComponent(pathname.slice("/api/research/".length, -"/findings".length));
        return Response.json({ items: await listResearchFindings(env.DB, research_no) });
      }

      // 研究读模型：本体 + 关键发现 + 外部验证引用 + 追问链（F-30 研究结果页的存储读取面）
      if (pathname.startsWith("/api/research/") && request.method === "GET") {
        const research_no = decodeURIComponent(pathname.slice("/api/research/".length));
        const rec = await getResearchRecord(env.DB, research_no);
        if (rec === null) return Response.json({ error: `研究不存在：${research_no}` }, { status: 404 });
        return Response.json(rec);
      }

      // 外部验证引用：列表（可按研究过滤）/ 登记（EXT-03；平台只登记结论与来源，不执行验证、不计算效果）
      if (pathname === "/api/external-validations") {
        if (request.method === "GET") {
          const research_no = url.searchParams.get("research_no") || undefined;
          return Response.json({ items: await listExternalValidations(env.DB, { research_no }) });
        }
        if (request.method === "POST") {
          // research_no 不存在 → 409（TC-D-M2-008 库级 FK）
          return Response.json(await addExternalValidation(env.DB, await request.json()), { status: 201 });
        }
      }

      // ---------------- F-12 上下文按任务组织注入（M2 共享上下文 · CFG-06 + PD-06） ----------------

      // 注入模板：列表（可按任务类型过滤）/ 登记（CFG-06；重复 (task_type, context_type_code) → 409）
      if (pathname === "/api/context-templates") {
        if (request.method === "GET") {
          const task_type = url.searchParams.get("task_type") || undefined;
          return Response.json({ items: await listContextTemplates(env.DB, { task_type }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerContextTemplate(env.DB, await request.json()), { status: 201 });
        }
      }

      // 任务上下文**初始化**（写）：按模板装配 + 落 PD-06 注入记录（幂等，重复调用不重复落行）
      if (pathname === "/api/task-context/init" && request.method === "POST") {
        return Response.json(await initTaskContext(env.DB, await request.json()), { status: 201 });
      }

      // 任务上下文**装配 / 回读**（只读）：GET 同一任务两次返回一致（确定性；TC-I-M2-002）
      if (pathname.startsWith("/api/task-context/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/task-context/".length));
        const ctx = await getTaskContext(env.DB, task_id);
        return Response.json(ctx);
      }

      // 注入记录：列表（可按任务 / 信息类型过滤）/ 单条登记（PD-06；task_id 不存在 → 409 FK）
      if (pathname === "/api/context-injections") {
        if (request.method === "GET") {
          const task_id = url.searchParams.get("task_id") || undefined;
          const context_type_code = url.searchParams.get("context_type_code") || undefined;
          return Response.json({ items: await listContextInjections(env.DB, { task_id, context_type_code }) });
        }
        if (request.method === "POST") {
          return Response.json(await recordContextInjection(env.DB, await request.json()), { status: 201 });
        }
      }

      // ---------------- F-23 工具注册与权限检查（M5 工具执行程序 · CFG-02 + CFG-03） ----------------

      // 工具注册：列表（可按来源 / 启用状态过滤）/ 登记（CFG-02；重复 tool_id 或 tool_code → 409）
      if (pathname === "/api/tools") {
        if (request.method === "GET") {
          const source_id = url.searchParams.get("source_id") || undefined;
          const is_enabled = url.searchParams.get("is_enabled");
          return Response.json({
            items: await listTools(env.DB, {
              source_id,
              is_enabled: is_enabled === null ? undefined : Number(is_enabled),
            }),
          });
        }
        if (request.method === "POST") {
          return Response.json(await registerTool(env.DB, await request.json()), { status: 201 });
        }
      }

      // 授权记录：列表（可按工具 / 授权对象过滤）/ 登记（CFG-03；tool_id 不存在 → 409 FK）
      if (pathname === "/api/tool-permissions") {
        if (request.method === "GET") {
          const tool_id = url.searchParams.get("tool_id") || undefined;
          const grantee_type = url.searchParams.get("grantee_type") || undefined;
          const grantee_ref = url.searchParams.get("grantee_ref") || undefined;
          return Response.json({ items: await listPermissions(env.DB, { tool_id, grantee_type, grantee_ref }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerPermission(env.DB, await request.json()), { status: 201 });
        }
      }

      // 权限判定（每次调用前先查）：允许 / 受限互斥；受限必带 reason_code + restrict_reason
      if (pathname === "/api/tool-permission/check" && request.method === "POST") {
        return Response.json(await checkToolPermission(env.DB, await request.json()));
      }

      // 批量判定：逐条独立，单条受限不影响其它条（实体级隔离，非整包失败）
      if (pathname === "/api/tool-permission/check-batch" && request.method === "POST") {
        return Response.json(await checkToolPermissions(env.DB, await request.json()));
      }

      // F-24 工具描述（DS-06 协议面 1）：按 CFG-02 生成描述结构（demo 契约，见 mcp-client.js 文档卡）
      if (pathname === "/api/tool-descriptions" && request.method === "GET") {
        const source_id = url.searchParams.get("source_id") || undefined;
        const is_enabled = url.searchParams.get("is_enabled");
        const grantee_type = url.searchParams.get("grantee_type") || undefined;
        const grantee_ref = url.searchParams.get("grantee_ref") || undefined;
        return Response.json({
          items: await describeTools(env.DB, {
            source_id,
            is_enabled: is_enabled === null ? undefined : Number(is_enabled),
            grantee_type,
            grantee_ref,
          }),
        });
      }

      // F-24 真实查询：**先判权限再决定要不要发请求**；允许才取真实返回，受限则不调外部接口。
      // 只返回不落 EXT-01（落痕归 F-25）；返回体保留四要素（条件/来源/时点/限制）。
      if (pathname === "/api/query" && request.method === "POST") {
        const body = await request.json();
        const result = await executeQuery(env.DB, {
          ...body,
          // 研发期默认打本机 mock server（external-deps §6）；真实契约到手后由调用方注入 endpoint / transport
          transport: undefined,
        });
        // 受限返回用 403（对应 §6.2），其余按 200 + 信封内的 result_status 表达（含 ok / fail / running）
        if (result.decision === "restricted") return Response.json(result, { status: 403 });
        return Response.json(result);
      }

      // F-25 查询记录回查：按 query_id 取单条（含派生四要素）；`limits_not_persisted` 提示 Q-10 方向②
      if (pathname.startsWith("/api/query-records/") && request.method === "GET") {
        const readback = await readbackQuery(env.DB, decodeURIComponent(pathname.slice("/api/query-records/".length)));
        if (!readback) return new Response("Not Found", { status: 404 });
        return Response.json(readback);
      }

      // F-25 查询记录列表：可按 task_id / source_id / result_status / message_id 组合筛选（失败也留痕，故失败行同样可查）
      if (pathname === "/api/query-records" && request.method === "GET") {
        const pick = (k) => url.searchParams.get(k) || undefined;
        return Response.json({
          items: await listQueryRecords(env.DB, {
            task_id: pick("task_id"),
            source_id: pick("source_id"),
            result_status: pick("result_status"),
            message_id: pick("message_id"),
          }),
        });
      }

      // F-25 执行 + 落痕：**每一次执行（含失败 / 受限 / 执行中）都写一行 EXT-01**。
      // 与 `/api/query` 的区别：`/api/query` 只返回不落痕（F-24）；本路由落痕（F-25）。
      // 留痕不了时（工具/来源未登记，无 source_id 可写）返回 202 + `persist_skip`，**不冒充已留痕**。
      if (pathname === "/api/query-records" && request.method === "POST") {
        const out = await recordQuery(env.DB, await request.json());
        if (!out.persisted) return Response.json(out, { status: 202 });
        if (out.envelope && out.envelope.decision === "restricted") return Response.json(out, { status: 403 });
        return Response.json(out, { status: 201 });
      }

      // ---------------- F-26 失败重试与受限返回（M5 · CFG-04 + EXT-01 + PD-01/PD-03） ----------------

      // 生效运行策略（CFG-04）：目标级优先、回落平台级；带出本次生效的重试上限（封顶 100）
      if (pathname === "/api/run-policy" && request.method === "GET") {
        const goal_id = url.searchParams.get("goal_id") || null;
        const policy = await getRunPolicy(env.DB, { goal_id });
        return Response.json({ effective: policy, retry: retryLimitOf(policy) });
      }

      // 受阻记录回查（PD-03）：可按任务 / 是否已解除过滤（逐次留痕，不覆盖）
      if (pathname === "/api/task-blocks" && request.method === "GET") {
        const task_id = url.searchParams.get("task_id") || undefined;
        const resolved = url.searchParams.get("is_resolved");
        return Response.json({
          items: await listTaskBlocks(env.DB, { task_id, is_resolved: resolved === null ? undefined : Number(resolved) }),
        });
      }

      // 单任务态（PD-01）：F-26 处置结果的回查面（状态跃迁是白盒事实，可逐条查）
      if (pathname.startsWith("/api/tasks/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/tasks/".length));
        const task = await getTask(env.DB, task_id);
        if (task === null) return Response.json({ error: `任务不存在：${task_id}` }, { status: 404 });
        return Response.json(task);
      }

      // F-26 执行入口：按 CFG-04 `retry_limit` **重试**（代码逻辑，非 AI 决策）→ 落 `EXT-01`（F-25）
      // → 失败/受限处置任务态（写 `PD-03` + 置 `PD-01.task_status`，保留 `done_part`）。
      // 受限返回 → 403（`external-deps` §6.2「受限返回，非失败」，且**不重试**），响应带 `note` 供前端按同口径措辞；
      // 无处留痕（工具/来源未登记）→ 202 + `persist_skip`（Q-11 方向②，不冒充已留痕）；
      // 用尽仍失败 → 201（本次执行已如实留痕，任务受阻/停止的事实写在 `recovery` 里）。
      if (pathname === "/api/query-recovery" && request.method === "POST") {
        const out = await runQueryWithRecovery(env.DB, await request.json());
        if (!out.persisted) return Response.json(out, { status: 202 });
        if (out.outcome === "restricted") return Response.json({ ...out, note: RESTRICTED_NOTE }, { status: 403 });
        return Response.json(out, { status: 201 });
      }

      // ---------------------------------------- F-01 研究目标登记与口径管理（阶段3 · M1）
      // 目标身份跨版本稳定：登记只落一次 MD-01；口径变更一律经 `/versions` 落新版本，旧版本只读。
      if (pathname === "/api/goals") {
        if (request.method === "GET") {
          return Response.json({ items: await listGoals(env.DB, { status: url.searchParams.get("status") || undefined }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerGoal(env.DB, await request.json()), { status: 201 });
        }
      }
      if (pathname === "/api/goal-gaps" && request.method === "GET") {
        return Response.json({
          items: await listGoalGaps(env.DB, {
            goal_id: url.searchParams.get("goal_id"),
            unsolvedOnly: url.searchParams.get("unsolved") === "1",
          }),
        });
      }
      // 补充待补项：写 filled_* + is_solved=1，并把补充内容并入六要素、**形成目标新版本**（不覆盖已写内容）。
      if (pathname.startsWith("/api/goal-gaps/") && pathname.endsWith("/fill") && request.method === "POST") {
        const gap_id = decodeURIComponent(pathname.slice("/api/goal-gaps/".length, -"/fill".length));
        return Response.json(await fillGoalGap(env.DB, { ...(await request.json()), gap_id }));
      }
      if (pathname.startsWith("/api/goals/")) {
        const rest = pathname.slice("/api/goals/".length);
        for (const [suffix, fn] of [["/versions", saveGoalVersion], ["/apply", applyGoalVersion], ["/check", runGoalCheckTask]]) {
          if (rest.endsWith(suffix) && request.method === "POST") {
            const goal_id = decodeURIComponent(rest.slice(0, -suffix.length));
            const body = await request.json().catch(() => ({}));
            return Response.json(await fn(env.DB, { ...body, goal_id }), { status: 201 });
          }
        }
        // `/check` 执行一次口径检查任务并产出/回写待补项；有缺失时任务与待补项都留痕，无缺失也留任务行。
        if (request.method === "GET" && !rest.includes("/")) {
          return Response.json(await getGoalRecord(env.DB, decodeURIComponent(rest)));
        }
      }

      // ---------------------------------------- F-02 机会发现任务调度（阶段3 · M1）
      // 运行策略登记**写入侧从严**：retry_limit > 100、max_duration_min > 15、频率不可解析一律 400（不静默截断）。
      if (pathname === "/api/run-policies") {
        if (request.method === "GET") {
          const items = await listRunPolicies(env.DB, {
            policy_scope: url.searchParams.get("scope") || undefined,
            goal_id: url.searchParams.get("goal_id") || undefined,
            activeOnly: url.searchParams.get("active") === "1",
          });
          // 附频率解析预览：把自然语言频率翻成 Cron Triggers 表达式，让「后端持有的运行频率」可见可核。
          return Response.json({ items: items.map((p) => ({ ...p, schedule: parseRunFrequency(p.run_frequency) })) });
        }
        if (request.method === "POST") {
          return Response.json(await saveRunPolicy(env.DB, await request.json()), { status: 201 });
        }
      }
      if (pathname === "/api/effective-run-policy" && request.method === "GET") {
        const picked = await resolveRunPolicy(env.DB, { goal_id: url.searchParams.get("goal_id") });
        return Response.json({ ...picked, schedule: parseRunFrequency(picked.policy.run_frequency) });
      }
      // 到点创建发现任务：建任务 → 关联启动对象 → 五步计划 → 按 CFG-06 装配上下文 → 发 Queue 消息（只带两个键）。
      if (pathname === "/api/discovery-tasks" && request.method === "POST") {
        return Response.json(await createDiscoveryTask(env.DB, await request.json()), { status: 201 });
      }
      if (pathname === "/api/task-dispatch" && request.method === "GET") {
        return Response.json(await getTaskDispatch(env.DB, url.searchParams.get("task_id")));
      }
      // 「Agent 只在任务内被调用」的契约入口（阶段3 为占位，真实 Agent 归阶段4）。
      if (pathname === "/api/agent-delegations" && request.method === "POST") {
        return Response.json(await delegateToAgent(env.DB, await request.json()));
      }

      // ---------------------------------------- F-03 研究建议管理（人工节点，阶段3 · M1）
      // 人工节点不可越权：M3→M4 之间必须由 PM 选机会、提研究问题，平台不自动交接（PRD-M1 §4）。
      if (pathname === "/api/research-proposals") {
        if (request.method === "GET") {
          const triggered = url.searchParams.get("triggered");
          const items = await listProposals(env.DB, {
            opportunity_id: url.searchParams.get("opportunity_id") || undefined,
            goal_id: url.searchParams.get("goal_id") || undefined,
            triggered: triggered === null ? undefined : triggered === "1",
          });
          return Response.json({ items });
        }
        // 提交建议：缺研究问题、版本与机会不符、可选列超 varchar 口径 → 400；
        // 同幂等键 → 200（created=false，不新建行、不重复启动相同任务；同键重复提交不是错误）。
        if (request.method === "POST") {
          const out = await submitProposal(env.DB, await request.json());
          return Response.json(out, { status: out.created ? 201 : 200 });
        }
      }
      // 研究问题即时检查（F-29 页边填边看）：只给「需补充的要点」，**不阻断提交**（原型钉死需求）。
      if (pathname === "/api/research-proposal-checks" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(checkResearchQuestion(body.research_question));
      }
      if (pathname.startsWith("/api/research-proposals/") && pathname.endsWith("/trigger") && request.method === "POST") {
        const proposal_id = decodeURIComponent(pathname.slice("/api/research-proposals/".length, -"/trigger".length));
        const body = await request.json().catch(() => ({}));
        return Response.json(await markProposalTriggered(env.DB, { ...body, proposal_id }));
      }
      if (pathname.startsWith("/api/research-proposals/") && request.method === "GET") {
        return Response.json(await getProposalRecord(env.DB, decodeURIComponent(pathname.slice("/api/research-proposals/".length))));
      }

      // ---------------------------------------- F-04 HVA 研究任务调度（阶段3 · M1）
      // 第二阶段启动时点 = 建议提交时刻；组织二阶段上下文（PD-06）+ 取 HVA 工具权限（CFG-03）+ 启动 Agent。
      // 「研究建议不存在」→ 404、「已触发任务…不得重复启动」→ 409（由 errorResponse 映射）。
      if (pathname === "/api/hva-research-tasks" && request.method === "POST") {
        return Response.json(await createHvaResearchTask(env.DB, await request.json()), { status: 201 });
      }
      if (pathname.startsWith("/api/hva-research-tasks/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/hva-research-tasks/".length));
        const dispatch = await getTaskDispatch(env.DB, task_id); // { task, steps }；task 不存在 → 404
        const perms = await resolveHvaToolPermissions(env.DB); // 默认 hva-agent
        return Response.json({ ...dispatch, permissions: perms });
      }

      // ---------------------------------------- F-05 追问与版本管理（阶段3 · M1）
      // PM 在已有研究上提新问题 → 关联原研究建立新 hva_followup 任务（parent_task_id 挂原任务）+ 新 MD-07 研究
      // （parent_research_no 指向原研究、start_task_id 指向新任务）+ 写 PD-07 追问消息 + 落 PD-06 上下文。
      // 「原研究不存在」/「未关联启动任务」→ 400（应用层校验）；双外键（research_no/task_id）缺失 → 409（库级 FK）。
      if (pathname === "/api/followup-tasks" && request.method === "POST") {
        return Response.json(await createFollowupTask(env.DB, await request.json()), { status: 201 });
      }
      if (pathname.startsWith("/api/followup-tasks/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/followup-tasks/".length));
        const dispatch = await getTaskDispatch(env.DB, task_id); // { task, steps }；task 不存在 → 404
        const perms = await resolveHvaToolPermissions(env.DB); // 默认 hva-agent
        return Response.json({ ...dispatch, permissions: perms });
      }

      // ---------------------------------------- F-06 任务记录与异常恢复（阶段3 · M1）
      // 复用 F-26 task-state.js 写入面（PD-01/PD-03）：block＝保留 done_part＋置 blocked＋写 PD-03；
      // stop＝保留 done_part＋置 stopped（停止状态不自动重启）＋写 PD-03(limit_or_cancel)；resume＝blocked→running。
      // 「任务不存在」→ 404（errorResponse 映射）；「停止状态不自动重启」/「不改写已结束」→ 400；双外键/约束 → 409；retry_limit 超限 → 400。
      if (pathname === "/api/task-recovery" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { action } = body;
        let out;
        if (action === "block") out = await recordTaskBlock(env.DB, body);
        else if (action === "stop") out = await stopTask(env.DB, body);
        else if (action === "resume") out = await resumeTask(env.DB, body);
        else throw new Error(`task-recovery action 非法：${String(action)}（须为 block/stop/resume）`);
        return Response.json(out, { status: 201 });
      }

      // ===== F-13 角色指令配置（agent-orchestrator/profile.js；MD-13/MD-14 唯一写入面）=====
      // 「角色指令不存在」→ 404；约束冲突（UNIQUE/PK/FK）→ 409；版本号必填缺失 → 400。
      if (pathname.startsWith("/api/agent-profiles/") && request.method === "GET") {
        const agent_code = decodeURIComponent(pathname.slice("/api/agent-profiles/".length));
        const profile = await getAgentProfile(env.DB, agent_code);
        if (!profile) throw new Error(`角色指令不存在：${agent_code}`);
        const skills = await listAgentSkills(env.DB, agent_code);
        const snapshot = await composeAgentVersionSnapshot(env.DB, agent_code);
        return Response.json({ ...profile, skills, agent_version_snapshot: snapshot });
      }
      if (pathname.startsWith("/api/agent-profiles/") && pathname.endsWith("/version") && request.method === "POST") {
        const agent_code = decodeURIComponent(pathname.slice("/api/agent-profiles/".length, -"/version".length));
        const body = await request.json().catch(() => ({}));
        const { current_version, doc_revision } = body;
        if (!current_version || !doc_revision) throw new Error(`版本推进必填：current_version 与 doc_revision 均须提供`);
        const changes = await bumpAgentProfileVersion(env.DB, { agent_code, current_version, doc_revision });
        return Response.json({ agent_code, current_version, doc_revision, changes }, { status: 200 });
      }
      if (pathname === "/api/skills" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { skill_no, skill_code, skill_name, version, bound_agent_code } = body;
        if (!skill_no || !skill_code || !skill_name || !version || !bound_agent_code)
          throw new Error(`Skill 注册必填：skill_no / skill_code / skill_name / version / bound_agent_code`);
        const r = await registerSkill(env.DB, { skill_no, skill_code, skill_name, version, bound_agent_code });
        return Response.json(r, { status: 201 });
      }

      // ===== F-14 围绕目标寻找线索（agent-orchestrator/discovery.js；纯编排 · 零写库）=====
      // S-A1 发现任务调度：一阶段注入清单 → 确定性查证计划（纯计算，不写库）
      if (pathname === "/api/discovery-plan" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const plan = assembleDiscoveryPlan(body);
        return Response.json(plan, { status: 200 });
      }
      // 从任务装配一阶段注入清单（薄读，复用 shared-context 读面；task 不存在 → 404）
      if (pathname.startsWith("/api/discovery-context/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/discovery-context/".length));
        const injection = await loadDiscoveryContext(env.DB, task_id);
        return Response.json(injection, { status: 200 });
      }
      // S-A3 旅程线索归纳：查证事实集合 → 按人群/旅程环节归类（纯计算）
      if (pathname === "/api/clue-summary" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = summarizeCluesAsJourney(body.factSet);
        return Response.json(out, { status: 200 });
      }
      // TC-U-M3-001 意向分归一（纯计算）
      if (pathname === "/api/intention-score" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        if (typeof body.intention_raw !== "number")
          throw new Error("意向分归一须为：intention_raw 必须为数值");
        const threshold = body.threshold ?? 1.0;
        const score = normalizeIntentionScore(body.intention_raw, threshold);
        return Response.json(
          { intention_raw: body.intention_raw, threshold, intention_score: score },
          { status: 200 }
        );
      }

      // ===== F-14 LLM 驱动版：A-1 接入后的正式机会发现路径 =====
      // POST /api/discovery-run：传入 task_id，LLM 规划查证 → 工具查询 → 线索归纳 → 机会形成
      // mock 模式（env.AI 不存在）自动降级为确定性假数据，零密钥可跑
      if (pathname === "/api/discovery-run" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const { task_id, model } = body;
        if (!task_id) throw new Error("discovery-run 必填：task_id");
        const result = await runDiscoveryWithLLM(env.AI, env.DB, task_id, { model });
        return Response.json(result, { status: 200 });
      }

      // ===== F-15 基础查证（agent-orchestrator/verification.js；经 M5 真实查询 · 五项检查 · 零自有写语句）=====
      // S-A2 指标查证一次闭环：经工具执行程序（M5）真实请求执行 → 查询事实（来源 + 时点）
      // 硬红线：result_summary 原样透传自 M5 信封；失败/受限只回报真实原因，**不用模型预期替代**（model_expectation 被忽略）
      if (pathname === "/api/metric-verification" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = await verifyClueAndDraftEvidence(env.DB, body);
        if (!out.verified) return Response.json({ ...out, note: (out.note || "") + "（失败/受限不否定研究，但也不以模型预期代替查询结果）" }, { status: 202 });
        return Response.json(out, { status: 201 });
      }
      // 五项检查：来源 / 适用范围 / 信息时点 / 已有机会 / 信息缺口（纯读 + 判定，不写库）
      if (pathname === "/api/five-checks" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = await verifyFiveChecks(env.DB, { fact: body.fact, goal: body.goal || {}, at: body.at });
        return Response.json(out, { status: 200 });
      }
      // TC-A-M3-006 倒挂隔离：证据信息时点晚于取数时刻 → 仅该条失效（纯计算）
      if (pathname === "/api/evidence-isolation" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(isolateContradictedEvidence(body.items, { at: body.at }), { status: 200 });
      }
      // TC-A-M3-005 只松不严不硬映射：缺字段 → 退回请补（纯计算）
      if (pathname === "/api/missing-fields" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(resolveMissingFields(body.draft, body.required_fields), { status: 200 });
      }
      // 装配 EXT-02 形态证据草稿（不落库）；`persist=true` 时复用 F-09 `createEvidence` 单一写入面落库
      if (pathname === "/api/verification-evidence" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const draft = buildEvidenceDraft({
          fact: body.fact, checks: body.checks || null,
          evidence_id: body.evidence_id ?? null, evidence_title: body.evidence_title ?? null, created_at: body.created_at ?? null,
        });
        if (!draft.ok || body.persist !== true) return Response.json(draft, { status: draft.ok ? 200 : 409 });
        const written = await recordVerificationEvidence(env.DB, draft.draft);
        return Response.json({ ...draft, persisted: true, written }, { status: 201 });
      }
      // 只跑一次真实查询（不含五项检查与证据草稿），供排查「取到了什么」
      if (pathname === "/api/verification-query" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const fact = await runMetricVerification(env.DB, body);
        return Response.json(fact, { status: fact.ok ? 201 : 202 });
      }

      // ===== F-16 机会形成与去重（agent-orchestrator/opportunity.js；S-A4 · 零自有写语句）=====
      // S-A4 编排：依据足够 → 形成机会记录（MD-06，经 F-10 `createOpportunity`）+ 判重命中则关联更新（LNK-03）；
      // 依据不足 → **返回缺口记录且不写库**（「本轮未产生新机会」是合法产出，故 gap 回 200 而非错误）。
      if (pathname === "/api/opportunity-formation" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = await formOpportunityOrGap(env.DB, body);
        return Response.json(out, { status: out.outcome === "opportunity" ? 201 : 200 });
      }
      // 组装六要素 + 二态判定（纯计算，不写库）
      if (pathname === "/api/opportunity-six-elements" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(buildOpportunitySixElements({ goal: body.goal || {}, clue: body.clue || {}, verification: body.verification || {} }), { status: 200 });
      }
      // 依据足够性判定（纯计算：真实返回 / 来源可回查 / 未倒挂 / 六要素已评估齐备 / 标题可派生）
      if (pathname === "/api/opportunity-basis" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(hasEnoughBasis({ verification: body.verification || {}, sixElements: body.six_elements || {} }), { status: 200 });
      }
      // 缺口记录组装（纯计算：检查范围 + 信息缺口 + 影响哪项判断）
      if (pathname === "/api/opportunity-gap-record" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(buildGapRecord({ goal: body.goal || {}, clue: body.clue || {}, verification: body.verification || {}, sixElements: body.six_elements || {} }), { status: 200 });
      }
      // 取号（确定性、可回查：库内最大 +1）
      if (pathname === "/api/opportunity-next-id" && request.method === "GET") {
        return Response.json(
          { opportunity_id: await nextOpportunityId(env.DB), relation_id: await nextOpportunityRelationId(env.DB) },
          { status: 200 },
        );
      }

      // —— F-17 两步衔接（M3 收尾，**只组装不触发**；衔接经人工节点，绝不自动交接）——
      // PM 决策上下文（M3 产出 → PM 输入前提：六要素 + 初步依据四要素 + 未知项 + 缺口 + 性质声明）
      if (pathname === "/api/pm-decision-context" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(await assemblePmDecisionContext(env.DB, body), { status: 200 });
      }
      // 人工节点守卫（完成判据＝MD-12 有无该机会的真实建议行；`auto_handoff` 恒 false）
      if (pathname.startsWith("/api/handoff-gate/") && request.method === "GET") {
        const opportunity_id = decodeURIComponent(pathname.slice("/api/handoff-gate/".length));
        return Response.json(await evaluateHandoffGate(env.DB, { opportunity_id }), { status: 200 });
      }
      // 反向问 PM（必要信息缺失 → 请补项；不静默回退、不编造）
      if (pathname === "/api/pm-supplement-requests" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(await collectSupplementRequests(env.DB, body), { status: 200 });
      }
      // 交接包（只组装不触发；未过守卫 → `handoff:null` + `blocked_by='human_node'`）
      if (pathname === "/api/handoff-package" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(await composeHandoffPackage(env.DB, body), { status: 200 });
      }

      // ===== F-18 角色指令配置（agent-orchestrator/role.js；M4 起 · 装载与结束条件判定 · 零写库）=====
      // 装载运行期角色指令包：agent.md 段落骨架（5 段）+ business-rules.md 指令编号（8 条）+ 结束条件与边界声明
      // （复用 F-13 读面读 MD-13/MD-14；叙述文本本体在 agent-runtime/，本层只持编号与判据键）
      if (pathname.startsWith("/api/agent-roles/") && request.method === "GET") {
        const agent_code = decodeURIComponent(pathname.slice("/api/agent-roles/".length));
        return Response.json(await loadAgentRole(env.DB, agent_code), { status: 200 });
      }
      // 结束条件判定（PRD-M4 F-18）：有依据的研究回答 / 说明无法完成判断的原因——二者皆缺则不结束（纯计算）
      if (pathname === "/api/research-closure" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = evaluateResearchClosure(body);
        return Response.json(out, { status: out.closed ? 201 : 200 });
      }
      // 产品假设性质标注：假设不预先作为研究结论（纯计算）
      if (pathname === "/api/hypothesis-label" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(labelProductHypothesis(body), { status: 200 });
      }
      // 输出边界扫描（TC-C-M4-001 硬红线的可运行形式）：禁活动配置 / 权益组合 / 预算 / 排期（纯计算）
      if (pathname === "/api/output-boundary-scan" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = scanProductionActions(body.text);
        return Response.json(out, { status: out.clean ? 200 : 409 });
      }

      // ===== F-19 研究起点处理（agent-orchestrator/research-start.js；M4 · S-B1 · 纯编排/薄读）=====
      // 二阶段注入清单（机会及版本 / 产品问题 / 可选假设 / 证据 / 历史）：薄读，复用 shared-context 读面（零写库）
      if (pathname.startsWith("/api/research-start-context/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/research-start-context/".length));
        return Response.json(await loadResearchStartContext(env.DB, task_id), { status: 200 });
      }
      // S-B1 研究任务调度：三分支路径选择（① 查证假设 / ② 寻找候选 / ③ 说明限制）→ 研究计划；**路径确定即停止**
      if (pathname === "/api/research-start" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = assembleResearchStart(body);
        return Response.json(out, { status: out.stopped ? 201 : 200 });
      }
      // 适合性判断（判断问题是否适合 HVA 研究；不适合时说明限制而非硬做）——语义判断受 A-1 门禁，可注入覆盖（纯计算）
      if (pathname === "/api/research-suitability" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(judgeResearchSuitability(body), { status: 200 });
      }
      // 比较条件装配（涉及哪些用户 / 观察哪个阶段 / 什么结果口径）：能定则定、缺则如实登记缺口（纯计算）
      if (pathname === "/api/comparison-conditions" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(resolveComparisonConditions(body), { status: 200 });
      }

      // ===== F-20 人群比较与行为关系检验（agent-orchestrator/behavior.js；M4 · S-B2/S-B3 · 纯编排/落库经写入面）=====
      // 综合分入池阈值（TC-U-M4-001：composite_raw ≥ pool_threshold → 入池；确定性、无随机）
      if (pathname === "/api/behavior-threshold" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(judgePoolThreshold(body), { status: 200 });
      }
      // S-B2 人群可比性检查（取人群特征与原有表现 → 差异是否已解释 → 结论＋限制，纯计算）
      if (pathname === "/api/population-comparability" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(checkPopulationComparability(body), { status: 200 });
      }
      // S-B3 候选行为五查（① 人群可比基础 ② 先后关系 ③ 口径一致 ④ 其他解释 ⑤ 信息充分；含倒挂隔离，纯计算）
      if (pathname === "/api/behavior-checks" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = runBehaviorChecks(body);
        return Response.json(out, { status: 200 });
      }
      // 比较条件守卫（TC-A-M4-006）：缺比较条件 / 查不到已过审素材 → 退回请补，不静默回退（纯计算）
      if (pathname === "/api/comparison-gate" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(evaluateComparisonGate(body), { status: 200 });
      }
      // 一步编排：比较条件守卫 → 入池筛选 → 五查 → 支持情况（纯计算、零写库）
      if (pathname === "/api/behavior-verification" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(assembleBehaviorVerification(body), { status: 200 });
      }
      // 落库：MD-09 候选行为 + MD-10 支持情况条目（经 F-20 写入面；退回请补 / 未入池均不写库）
      if (pathname === "/api/candidate-behavior" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = await formCandidateBehavior(env.DB, body);
        return Response.json(out, { status: out.outcome === "candidate_behavior" ? 201 : 200 });
      }

      // ===== F-21 研究结果生成（agent-orchestrator/result.js；M4 · S-B4 · 编排零 SQL / 落库经写入面）=====
      // 七要素组装（逐发现挂证据 → 并列支持 / 不支持 → 限制与改善方向；纯计算、零写库）
      if (pathname === "/api/research-result" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(assembleResearchResult(body), { status: 200 });
      }
      // 七要素正文的输出边界扫描（TC-C-M4-001 硬红线：不含活动配置 / 权益组合 / 预算 / 排期；纯计算）
      if (pathname === "/api/research-result-boundary" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = scanResultBoundary(body.elements ?? body);
        return Response.json(out, { status: out.clean ? 200 : 409 });
      }
      // 改善方向与发现逐项对应校验（纯计算；对不上即列出 orphan / malformed）
      if (pathname === "/api/improvement-correspondence" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(validateImprovementCorrespondence(body.actions, body.findings), { status: 200 });
      }
      // 研究结果落库（S-B4「七要素齐全并保存」）：MD-07 内容填充 + MD-08 + LNK-02 + MD-11
      if (pathname === "/api/research-report" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        const out = await saveResearchReport(env.DB, body);
        const status = out.outcome === "saved" ? 201 : out.outcome === "boundary_violation" ? 409 : 200;
        return Response.json(out, { status });
      }
      // 研究报告回查（薄读：七要素 + 证据关联 + ⑤ 候选行为支持情况）
      if (pathname.startsWith("/api/research-result/") && request.method === "GET") {
        const researchNo = decodeURIComponent(pathname.slice("/api/research-result/".length));
        const out = await loadResearchResultContext(env.DB, researchNo);
        if (!out) return Response.json({ error: `研究不存在：${researchNo}` }, { status: 404 });
        return Response.json(out, { status: 200 });
      }
      // 取号（F-NNN / AC-NNN / LK-FE-NNN，库内最大 +1；只读）
      if (pathname === "/api/research-next-id" && request.method === "GET") {
        return Response.json(
          {
            next_finding_id: await nextFindingId(env.DB),
            next_action_id: await nextActionId(env.DB),
            next_finding_evidence_link_id: await nextFindingEvidenceLinkId(env.DB),
          },
          { status: 200 }
        );
      }

      // ===== F-22 继续追问承接（agent-orchestrator/followup-intake.js；M4 · 承接与依据复用判定 · 零写库）=====
      // 依据复用判定（纯计算：时间范围 / 查询条件 / 适用范围 → 沿用 or 补查；未声明变更 → undetermined + llm_gated）
      if (pathname === "/api/followup-evidence-reuse" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(assessEvidenceReuse(body.evidence, body.requested_changes), { status: 200 });
      }
      // 版本口径判定（纯计算：追问可落新版本，原任务与原研究钉在启动时版本）
      if (pathname === "/api/followup-version" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(assessVersionPinning(body), { status: 200 });
      }
      // 承接主入口：读追问任务 + 原研究 → 保留原结果与依据 → 沿用/补查 → 版本口径 → 新一轮入口（零写库）
      if (pathname === "/api/followup-intake" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));
        return Response.json(await intakeFollowup(env.DB, body), { status: 200 });
      }
      // 承接上下文薄读（追问任务 + 追问研究壳 + 原研究 + 原结果与依据 + 追问链）
      if (pathname.startsWith("/api/followup-intake/") && request.method === "GET") {
        const taskId = decodeURIComponent(pathname.slice("/api/followup-intake/".length));
        const out = await loadFollowupIntakeContext(env.DB, { task_id: taskId });
        if (!out) return Response.json({ error: `追问任务不存在：${taskId}` }, { status: 404 });
        return Response.json(out, { status: 200 });
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      return errorResponse(e);
    }
  },
};
