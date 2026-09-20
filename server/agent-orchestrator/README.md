# server/agent-orchestrator/ 模块文档卡

> 模块定位：阶段4 · **M3 机会发现 Agent + M4 HVA 分析 Agent** 的运行期能力底座（`docs/04-plan/dev-plan.md` 阶段4）。
> ｜ `../../docs/02-prd/PRD-M3-机会发现Agent.md`（F-13~F-17）｜ `../../docs/02-prd/PRD-M4-HVA分析Agent.md`（F-18~F-22）
> ｜ `../../docs/01-brd/BRD.md` §3 M3/M4、§4 F-13~F-22、§5.3 硬红线、§7 验收总则
> ｜ `../../docs/03-locks/schema.md`（MD-13 agent_profile、MD-14 skill_registry、§12 Q-07 已决 S-A1↔clue-scan↔AGP-DISC）
> ｜ `../../docs/03-locks/external-deps.md`（A-1 LLM ⬜ 未提供（最大风险）；A-2 MCP 客户端 ✅；A-3 指令加载与版本管理 ✅；A-4 Skill 加载 ✅）
> ｜ `../../docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle；其中 TC-C-M3-001 / TC-C-M4-001 为 LLM 产出契约，受 A-1 门禁未关闭限制）
>
> **本模块硬红线（与全局一致）**：生产零写（本目录只写 **MD-13/MD-14**（经 `profile.js`）、**MD-09/MD-10**（经 `behavior-store.js`）与 **MD-07 内容填充 / MD-08 / MD-11**（经 `result-store.js`）三处业务面，且各表只经本 README 列出的**唯一写入面**；`LNK-02 finding_evidence` 的写入不在本模块、归 `../shared-context/index.js`）、真实返回禁模型替代、证据四要素、失败不否定结论；外部依赖门禁（A-1）未关闭前，推理相关用例一律 mock/demo、demo 值不进断言。**F-22 起新增一处跨模块只读面**：`followup-intake.js` 经 `../task-runner/step-plan.js` 读 `PD-01 task`（M1 读面——阶段4 dev-plan「把真 Agent 接进 M1 的调度回路」），本模块**不含自有写语句**。**2026-09-20 新增两处（收编并发改动）**：① `discovery.js` 经同目录 `./llm-client.js` 调 Workers AI 做线索推理（BR-04：LLM 只做推理判断，不代替 tool-executor 的真实返回；A-1 门禁未关闭前不进断言）；② `discovery.js` 经 `../tool-executor/recordQuery` 触发 `EXT-01 query_trace` 落痕——属**委托写面**（写入语句仍只在 tool-executor 侧，本目录零自有 `INSERT`/`UPDATE`），故「唯一写入面」口径不变。

## 文件清单

| 文件 | 职责（F-xx 归属） | 状态 |
| ---- | ---- | ---- |
| `profile.js` | **F-13 角色指令配置**：MD-13/MD-14 **唯一写入面**（本模块首个写面）；`registerAgentProfile`（INSERT MD-13，agent_code UNIQUE 库级强制）、`getAgentProfile`（读）、`bumpAgentProfileVersion`（版本管理：同 agent_code 单行推进 current_version/doc_revision，**不新建行**）、`registerSkill`（INSERT MD-14，PK/UK/FK 库级强制）、`listAgentSkills`（读生效 Skill）、`composeAgentVersionSnapshot`（组装 F-06 任务态冻结用的 `agent_version_snapshot` 串） | ✅ F-13 已建 2026-09-20（**30 断言全绿**） |
| `test-f13.mjs` | F-13 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；断言读全字段 / 版本推进单行 / 注册 Skill 成功 / MD-14 PK-UK-FK 三反例 / MD-13 agent_code UNIQUE 反例 / 快照串形态对齐种子 / 静态零外部调用 + 唯一写入面） | ✅ 已建（**30 断言全绿**） |
| `discovery.js` | **F-14 围绕目标寻找线索**：编排层（**零自有写语句**——查询落痕 EXT-01 **委托** `../tool-executor` 的 `recordQuery` 单一写面，本文件无 INSERT/UPDATE/DELETE 与裸 SQL；**A-1 门禁**：无 `ai` binding 时默认**拒跑**（响亮抛错，防生产漏配静默伪造结果——2026-09-20 查证 ci.yml 部署原样用 wrangler.toml、无追加机制）；本地零密钥调试须**显式**传 `opts.mock = true` 才走 mock 路径（输出带 `_mock` 标记 + `stopped_by=mock_mode`，mock 工具执行不触注入执行器、**零写库**））。**2026-09-20 收编**新增 A-1 接入：`runDiscoveryWithLLM`（LLM 驱动路径：`chatWithTools` + 6 个工具的 function calling，返回结构化线索/机会/缺口；非法 JSON 兜底记 `_parse_error`+`gaps`，不静默丢）、`createDiscoveryToolExecutor`（工具名→`tool_code` 映射，未知工具**在 import 之前短路**返回 error）、`DISCOVERY_TOOLS` / `DISCOVERY_SYSTEM_PROMPT`（工具定义与系统指令） |`normalizeIntentionScore`（意向分归一 min(raw/threshold,1)，TC-U-M3-001）、`assembleDiscoveryPlan`（S-A1 发现任务调度：一阶段注入清单→确定性查证计划，含停止条件表达）、`summarizeCluesAsJourney`（S-A3 旅程线索归纳：按「谁在什么环节遇到什么现象」归类，每条须有人群/环节归属、拒裸变化）、`loadDiscoveryContext`（薄读：复用 shared-context 读面装配注入清单，不新增写面） | ✅ F-14 已建 2026-09-20；**57 断言**（⑦ 组 A-1 LLM 路径 19 条含 mock 显式选择语义），本轮回调后 **61 断言** |
| `test-f14.mjs` | F-14 用例执行器（纯函数段不依赖 D1；`loadDiscoveryContext` 用 fake-db stub 验「复用读面 + 零写」；断言意向分归一（含封顶/除零防护）/ S-A1 计划有序+停止条件+sources 过滤 / S-A3 归属+拒裸变化+evidence 透传 / 零写 / 静态零外部调用 + 单一读面 import） | ✅ 已建（**33 断言全绿**） |
| `verification.js` | **F-15 基础查证**：S-A2 指标查证闭环 + 五项检查（**零自有写语句**——EXT-01 归 M5、EXT-02 归 F-09）。`runMetricVerification`（经 M5 `runQueryWithRecovery` 真实查询→查询事实；**硬红线：只有真实 ok 才 `verified=true`，`model_expectation`/`expected_summary` 被显式忽略**）、`verifyFiveChecks`（来源/适用范围/信息时点/已有机会/信息缺口；缺口口径读 CFG-05、已有机会比对读 MD-06）、`isolateContradictedEvidence`（TC-A-M3-006 倒挂隔离）、`resolveMissingFields`（TC-A-M3-005 退回请补）、`buildTentativeExplanation`（标「尚未验证」、不下 HVA 判断）、`buildEvidenceDraft`/`recordVerificationEvidence`（EXT-02 草稿 + 复用 F-09 `createEvidence` 落库）、`verifyClueAndDraftEvidence`（一步编排）、`parseStamp`（时点抽取，倒挂判定基础） | ✅ F-15 已建 2026-09-20（**87 断言全绿**） |
| `test-f15.mjs` | F-15 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子 + **注入式 transport**（复用 `prototype/mock/scenarios.js`）；断言经 M5 真实查询透传（含哨兵串证「模型预期不进事实」）/ 五项检查齐备与缺口标注 / 倒挂隔离非整包失败 / 缺字段退回请补 / 证据草稿四要素 + 落 EXT-02 回查 / 一步编排成败两路 / `parseStamp` / 静态零外部调用 + 零写语句 + 读语句仅 CFG-05） | ✅ 已建（**87 断言全绿**） |
| `opportunity.js` | **F-16 机会形成与去重**：S-A4 整理（**零自有写语句、零裸 SQL**——MD-06 归 F-10 `createOpportunity`、LNK-03 归 F-10 `linkOpportunityRelation`，取号/判重走读面）。`nextOpportunityId`/`nextOpportunityRelationId`（`OPP-NNN`/`LK-OR-NNN` 库内最大+1）、`buildOpportunitySixElements`（六要素组装 + 二态判定）、`hasEnoughBasis`（依据足够性：真实返回/来源可回查/未倒挂/六要素**已评估**齐备/标题可派生；适用范围未判定**不阻断**记 caveat）、`buildGapRecord`（缺口记录：检查范围+信息缺口+影响判断，**不落表**）、`formOpportunityOrGap`（S-A4 编排：足够→机会记录(+判重关联 `same_issue`)；不足→缺口记录且**不写任何表**） | ✅ F-16 已建 2026-09-20（**73 断言全绿**） |
| `test-f16.mjs` | F-16 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子 + 结构性注入的 F-15 查证结果；断言依据足够→落 MD-06 六要素+二态 / 依据不足→缺口记录且**行数不变** / unknown 未评估判不齐 / unknown 纯空白串显式拒 / 判重命中→LNK-03 `same_issue` 方向 / 取号推进 / 缺口记录结构 / 纯函数与 caveat / 静态零外部调用 + 零写语句 + 零裸 SQL + 唯一依赖 shared-context） | ✅ 已建（**73 断言全绿**） |
| `handoff.js` | **F-17 两步衔接**（M3 收尾）：确定性衔接编排/契约层（**零写库、零裸 SQL、零外部调用，且绝不触发 M4**）。`assemblePmDecisionContext`（M3 产出→PM 决策上下文：机会六要素＋评定＋**初步依据四要素**（来源/条件/时点/适用范围）＋未知项＋缺口＋「尚不构成 HVA 结论」声明）、`evaluateHandoffGate`（**人工节点守卫**：完成判据＝MD-12 有无该机会的真实建议行——**不看 `opportunity_status`**，防状态假通过；`auto_handoff` 恒 false）、`collectSupplementRequests`（**反向问 PM**：必要信息缺失→请补项，不静默回退不编造）、`composeHandoffPackage`（交接包**只组装不触发**：未过守卫 `handoff:null`＋`blocked_by='human_node'`；已过则给「供 M1 F-04 消费」的输入前提） | ✅ F-17 已建 2026-09-20（**66 断言全绿**） |
| `test-f17.mjs` | F-17 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子 + 夹具「无证据+未知项 NULL」机会；用 F-03 `submitProposal` **造人工节点产物**。断言 PM 上下文四要素透传+性质声明 / **状态为 submitted 但 MD-12 无建议 → 仍不得交接**（防假通过）/ 提交建议后放行但 `auto_handoff` 仍 false / 反向问 PM 请补项 / 交接包只组装（**`task` 与 `hva_research` 行数不变**）/ 机会不存在报错 / 常量口径 / 静态零外部调用+零写库+零裸 SQL+**不 import hva.js 且不出现 M4 建任务函数名**） | ✅ 已建（**66 断言全绿**） |
| `role.js` | **F-18 角色指令配置**（M4 开局；**零写库、零裸 SQL**——MD-13/MD-14 读面全复用 F-13 `profile.js`）：`loadAgentRole`（装载运行期角色指令包：MD-13 登记＋生效 Skill＋版本快照＋`agent.md` 段落骨架 5 段＋`business-rules.md` 编号 8 条＋结束条件与边界声明；**叙述文本本体在 `agent-runtime/`，本文件只持编号与判据键**）、`evaluateResearchClosure`（结束条件二选一：有依据的研究回答 / 说明无法完成判断的原因＝**合法结束**；无依据不构成回答、产品假设不得当回答、失败导致的否定不得作依据——BRD §7 第 4 条）、`labelProductHypothesis`（假设性质标注，**不预设结论**）、`scanProductionActions`（输出边界禁词扫描——TC-C-M4-001 硬红线的可运行形式） | ✅ F-18 已建 2026-09-20（**71 断言全绿**） |
| `test-f18.mjs` | F-18 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；断言装载全字段 / 5 段骨架顺序与来源回指 / 8 条业务指令 / 生效 Skill 与版本快照串对齐 F-13 / 本体逐条对齐（`business-rules.md` 有序列表 8 条标题、`hva/agent.md` 五段章节、已去建壳声明）/ 结束条件七路（含两条红线反例）/ 假设标注 / 输出边界扫描 / **运行期零写**（真库行数不变 + fake-db 全 SELECT）/ 静态零外部调用 + 零写语句 + 零裸 SQL + 仅依赖 F-13 读面） | ✅ 已建（**71 断言全绿**） |
| `research-start.js` | **F-19 研究起点处理**（M4 · S-B1；**零写库、零裸 SQL**——纯编排 + shared-context 读面复用）：`judgeResearchSuitability`（适合性判断：**语义判断须 LLM（A-1），可注入覆盖**；未提供时走确定性 fallback 标 `llm_gated=true`，**不硬造「不适合」**）、`assembleResearchStart`（S-B1 主编排：二阶段注入清单→**三分支路径选择** ① 有假设→`verify_hypothesis`／② 只有研究问题→`find_candidate`／③ 问题不适合→`state_limitation`；附比较条件＋查证顺序＋研究计划；**路径确定即停止**）、`resolveComparisonConditions`（比较条件三项「涉及哪些用户 / 观察哪个阶段 / 什么结果口径」：能定则定、**缺则如实登记缺口不编造**）、`assembleResearchCheckSequence`（排查证顺序＝**F-20 五查顺序**，确定性模板；可按来源过滤）、`loadResearchStartContext`（薄读：复用 `getTaskContext`/`listResearch` 装配注入清单——机会及版本 / 产品问题 / 可选假设 / 证据 / 历史） | ✅ F-19 已建 2026-09-20（**94 断言全绿**） |
| `test-f19.mjs` | F-19 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；**夹具用 F-03 `submitProposal` + F-04 `createHvaResearchTask` 造真实任务链**，不手工拼行。断言三分支路由（起点①/②/③）＋路径确定即停止 / 假设经 F-18 口径标注且不进结论位 / 起点②「未找到候选行为也是完整结果」/ 适合性判断可注入＋默认 fallback 不硬下结论＋非法形态显式拒 / 比较条件三项齐与缺项如实列出 / 查证顺序＝五查顺序与来源过滤 / 薄读注入清单（机会及版本、产品问题、可选假设、证据条数＝LNK-01 关联数、历史 R-007、六要素、PD-06 留痕）/ **MD-12 `opportunity_id` 外键反例（TC-D-M4-006）**且不留半截行 / 运行期零写（真库行数不变 + fake-db 全 SELECT）/ 静态零外部调用 + 零写语句 + 零裸 SQL + import 恰 2 条） | ✅ 已建（**94 断言全绿**） |
| `behavior-store.js` | **F-20 写入面**：**MD-09 `candidate_behavior` / MD-10 `behavior_point` 唯一写入面**（本模块第二个写面）。`createCandidateBehavior`（前置守卫研究存在 + INSERT；行为名称不改、只改状态列）、`appendBehaviorPoint`（前置守卫候选行为存在 + INSERT；`(candidate_id, point_type, order_no)` 复合 UK 库级强制）、`updateCandidateBehaviorStatus`（**只改状态列、不改名**）、`listCandidateBehaviors`/`listBehaviorPoints`（读面，`research_no`/`candidate_id` 可省 → 返回全量，供取号） | ✅ F-20 已建 2026-09-20（并入 **138 断言**） |
| `behavior.js` | **F-20 人群比较与行为关系检验**（M4 · S-B2/S-B3；**零写语句、零裸 SQL**——落库全经 `behavior-store.js`）。`judgePoolThreshold`（综合分入池阈值，**闭区间、确定性无随机**，TC-U-M4-001）、`checkPopulationComparability`（S-B2 人群可比性：差异是否已解释 → 结论＋限制；语义判断**可注入**、不可比 / 无法明确时**限制行为作用判断**）、`runBehaviorChecks`（**S-B3 五查**：① 人群可比基础 ② 先后关系 ③ 口径一致 ④ 其他解释 ⑤ 信息充分；**倒挂复用 F-15 仅该条失效**；`existence_only` 不得计为已排除；`due_to_failure` 条目**不作否定依据**、转缺口；`causal_claim_allowed` 恒 false；**未支持亦是完整结果**）、`evaluateComparisonGate`（**TC-A-M4-006** 缺比较条件 → 退回请补，不静默回退）、`assembleBehaviorVerification`（守卫 → 入池 → 五查一步编排，纯计算）、`formCandidateBehavior`（编排 + 经写入面落 MD-09/MD-10；退回请补与未入池**均不写库**）、`queryForBehaviorCheck`（**经 M5 只读**：复用 F-15 `runMetricVerification`）、`nextCandidateId`/`nextBehaviorPointId`（读面全量自算取号） | ✅ F-20 已建 2026-09-20（**138 断言全绿**） |
| `test-f20.mjs` | F-20 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子；夹具＝F-03 `submitProposal` + F-04 `createHvaResearchTask` **真实任务链**，M5 查询用注入式 transport + 自造授权。断言入池阈值（含 `null`/非法拒）/ 人群可比性（可注入 + 确定性推导 + 非法形态显式拒）/ 五查与倒挂隔离（仅该条失效、非整包失败）＋活动存在 ≠ 用户参与＋未排查维度不默认无关＋因果不臆断＋未支持亦完整 / 缺比较条件退回请补（`draft=null`）＋未入池为合法筛选结果 / 落库（失败与倒挂条目不下沉、**只新增 MD-09/MD-10 行**）+ 状态推进只改状态列 / **TC-D-M4-003 MD-09 FK** 与 **TC-D-M4-004 MD-10 复合 UK** 反例 / **TC-I-M4-002** 经 M5 只读（哨兵串证模型预期不进事实、无授权零外部调用、取号语句全 SELECT）/ 静态核验两文件） | ✅ 已建（**138 断言全绿**） |
| `result-store.js` | **F-21 写入面**：**MD-07 `research` 内容填充（只改行）+ MD-08 `research_finding` / MD-11 `improvement_action` 唯一写入面**（本模块第三个写面）。`createResearchFinding`（前置守卫研究存在 + INSERT；`(research_no, order_no)` 复合 UK 库级强制）、`createImprovementAction`（同上，UK 库级强制）、`updateResearchReport`（**只改 6 个正文 / 状态列**——`e1`/`e2`/`e4`/`e6`/`out_of_scope_note`/`research_status` + `finished_at`；**绝不触碰** `research_no`/`opportunity_id`/`goal_id`/`goal_version_no`/`parent_research_no`/`start_task_id`，**不建行**（建行归 F-11 `createResearch` / F-05 追问壳））、`listFindings`/`listImprovementActions`/`listFindingEvidenceLinks`（读面，过滤参数可省 → 返回全量，供取号） | ✅ F-21 已建 2026-09-20（并入 **136 断言**） |
| `result.js` | **F-21 研究结果生成**（M4 · S-B4；**零 SQL 语句**——读写全经 `result-store.js` / `behavior-store.js` / `shared-context` 既有面）。`RESULT_ELEMENTS`（七要素键 + 条目名 + 落库回指，**唯一真源**）、`assembleResearchResult`（S-B4 组装：逐发现挂证据 → 支持 / 不支持并列 → 限制与改善方向；七要素齐备判定；`due_to_failure` 发现**不进 ③** 转缺口；**未支持亦是完整结果**）、`scanResultBoundary`（硬红线：七要素正文不含活动配置 / 权益组合 / 预算 / 排期；**`out_of_scope_note` 本身不被扫描**——它正是「不覆盖范围」声明）、`validateImprovementCorrespondence`（改善方向与发现**逐项对应**，对不上即 orphan / malformed）、`checkFailureDoesNotNegate`（**失败不否定结论**：转缺口 + 降级保留 warning + 既有结论不推翻）、`saveResearchReport`（落库编排：**前置守卫全过才动笔**——边界 / 对应性 / 齐备 / 研究存在 / 未出过报告）、`loadResearchResultContext`（报告回查：七要素视图 + 证据关联 + ⑤ 支持情况）、`nextFindingId`/`nextActionId`/`nextFindingEvidenceLinkId`（读面全量自算取号） | ✅ F-21 已建 2026-09-20（**136 断言全绿**） |
| `test-f21.mjs` | F-21 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子；夹具＝F-03 `submitProposal` + F-04 `createHvaResearchTask` **真实任务链** + F-11 `createResearch` 建**待出报告的研究壳**。断言七要素键与 **TC-C-M4-001 逐条对齐** / 硬红线扫描（含 `out_of_scope_note` 豁免的反例）/ 逐发现挂证据与缺证据记缺口 / 支持与不支持并列 + **未支持亦完整结果** / 改善方向逐项对应四路 / **失败不否定**（转缺口 + warning 保留 + 不推翻既有结论）+ 非失败「未支持」合法反例 / 取号 / **TC-D-M4-001 MD-07 FK**、**TC-D-M4-002 MD-08 复合 UK**、**TC-D-M4-005 MD-11 UK** 三反例（均不留半截行）/ 落库编排五路前置守卫（未齐 / 违规 / 对不上 / 研究不存在 / 已出报告**均一行未写**）+ 报告回查（只读，语句全 SELECT）/ 静态核验两文件） | ✅ 已建（**136 断言全绿**） |
| `followup-intake.js` | **F-22 继续追问承接**（M4 · 收尾；**零写库、零写语句、零裸 SQL**——只读面全为既有面：F-21 `loadResearchResultContext`（原结果七要素）/ M2 `shared-context`（研究、追问链、证据）/ **M1 `../task-runner/step-plan.js#getTask`**（任务版本与父任务）/ F-18 `role.js`（禁词）/ F-19 `research-start.js`（五查顺序与比较条件口径）/ F-15 `verification.js`（抽时点））。`parseCoverage`（`EXT-02.info_time_point` → 取数时点＋覆盖区间；抽不到即 `null`，**不猜**）、`assessEvidenceReuse`（**依据复用判定**：时间范围 / 查询条件 / 适用范围三类变化 → 沿用 or 补查；**未声明变更 → `undetermined` 且 `llm_gated=true`**；依据缺可比对字段按**保守方向**计入补查）、`assessVersionPinning`（追问可落新版本，**原任务与原研究钉在启动时版本**；`scope_changed` 而未升版 → `new_version_required`，**建版本行归 M1 F-01**）、`assembleNextRound`（新一轮入口：`entry='S-B1'`、`chain=F-19>F-20>F-21`、`check_sequence_keys` **派生自 F-19**、比较条件复用 F-19 口径）、`loadFollowupIntakeContext`（薄读）、`intakeFollowup`（**主入口**：承接 + 保留 + 研判 + 版本 + 入口；带运行期自检 `original_preserved`、`negates_original_conclusion` 恒 false、追问越界文本提示但不拦截、可注入下游派发端口） | ✅ F-22 已建 2026-09-20（**136 断言全绿**） |
| `test-f22.mjs` | F-22 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子；夹具 ① **原型真实剧本**——种子追问任务 `T-1023`＋显式原研究 `R-007`（4 发现 / 4 证据 / 1 候选 / 3 改善方向 / 3 条 PD-07），② **M1 F-05 真实调用链**——F-03→F-04→F-11→F-21 造 done 原研究 → F-05 `createFollowupTask` 造追问任务与带 `parent_research_no` 的研究壳。断言契约与 **TC-I-M4-001 逐条对齐** / `parseCoverage` 与依据复用判定八路（含更窄沿用、更宽补查、晚于取数时点、无法解析、无既有依据、形态非法一律报错）/ 承接主流程（原结果与依据逐项回带、追问链可见、**运行期零写**（7 张表行数 + `research`/`task`/`research_finding` 逐行不变）、`original_preserved=true`）/ 种子剧本（适用范围放宽 → 4 条依据全需补查、原因码可核对）/ 版本口径（沿用 / 升版 v4 / 范围变更未升版 → `new_version_required`、原任务原研究**钉版**、不新建研究行与 MD-02 行）/ 派发端口（未注入不触发、注入恰一次）与禁词提示 / 入口守卫五路 / 静态核验（**import 恰 6 条**、零写语句、零 `SELECT`、零外部调用、不重复实现上游写面、无草稿残留）） | ✅ 已建（**136 断言全绿**） |

| `llm-client.js` | **A-1 LLM 推理服务客户端**（2026-09-20 收编；**非 F-xx，属 A-1 基础设施**）：封装 Workers AI binding —— `chat`（单次调用）、`chatWithTools`（function calling 循环，`MAX_TOOL_ROUNDS=10` 防无限循环）、`chatJSON`（强制 JSON mode）、`extractContent`/`extractToolCalls`/`needsToolExecution`（纯函数）、`MODELS`（模型 ID 常量池，**唯一真源**）、`isMockMode` / mock 兜底（`ai` 缺失时返回确定性假数据：模型名 `mock-model`、工具结果带 `-MOCK` 来源标记、结论带 `_mock:true`；**mock 分支不调注入的 toolExecutor，零写库**）。**硬红线**：零写库、零外部 HTTP、零凭证（只依赖注入的 `env.AI`）、不替代查询结果。**编排层唯一 LLM 推理入口**——仅 `discovery.js` 的 `runDiscoveryWithLLM` import 它（A-1 门禁：无 binding 默认拒跑、显式 `opts.mock=true` 放行）；其余编排文件（F-13/F-15~F-22）仍零调 LLM | ✅ 已收编 2026-09-20（含 mock 模式） |
| `test-llm-client.mjs` | A-1 客户端用例执行器（**mock AI binding，不触真实推理、无需账号**）：断言参数校验 / options 透传（含 `temperature:0` 假值不得被吞）/ 三种纯函数 / **两种结束态语义**（自然结束→`model_end`、用尽轮次→`max_rounds`）/ 工具抛错与非法 JSON 容错 / `chatJSON` 解析与报错 / `MODELS` 冻结与形态 / 静态核验（零 fetch、零 http、零写语句、零凭证，且 `api/index.js` **无硬编码模型 ID**） | ✅ 已建 2026-09-20（**56 断言全绿**） |

## F-13 已通过用例（`test-f13.mjs`，30 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 读角色指令 | 种子 `AGP-DISC`/`AGP-HVA` | 全字段形态正确；不存在的 agent_code → null（只读不报错） |
| ② 版本管理 | F-13 版本管理口径 | `bumpAgentProfileVersion` 推进 v1.3/r10，行数不变（UNIQUE 单行）；不存在的 agent_code → 影响 0 行不报错 |
| ③ 注册 Skill | F-13 能力登记 | 插新 `S-A2` 绑 discovery-agent 成功；discovery-agent 现有 2 个生效 Skill；hva-agent 仅 `S-B1` |
| ④ MD-14 三反例 | **TC-D-M3-002** | 重复 `skill_no='S-A1'` → PK 拒绝（UNIQUE constraint failed: skill_registry.skill_no）；重复 `skill_code='clue-scan'` → UK 拒绝；错 `bound_agent_code` → FK 失败 |
| ⑤ MD-13 UNIQUE 反例 | **TC-D-M3-001** | 重复 `agent_code='discovery-agent'` → UNIQUE 拒绝（该 UK 承载 MD-14 外键）；新 agent_code 可正常注册 |
| ⑥ 版本快照 | F-06 任务态冻结口径 | `composeAgentVersionSnapshot(discovery-agent)` ＝ `discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0`，与种子 `task.agent_version_snapshot` 逐字一致 |
| ⑦ 静态核验 | 单一写入面纪律 | 零外部 HTTP 调用；写语句目标仅限 `agent_profile`/`skill_registry`；`profile.js` 不 import 任何其它模块 |

## F-14 已通过用例（`test-f14.mjs`，33 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 意向分归一 | **TC-U-M3-001** | `1.3/1.0→1.0`（封顶）、`0.5/1.0→0.5`、`0.8/1.0→0.8`、`1.0/1.0→1.0`、`2.5/2.0→1.0`；`threshold=0` 除零防护回退 raw 本身（不崩） |
| ② S-A1 查证计划 | **TC-A-M3-001** | 缺 `goal` 抛错；默认 4 步、`step_no` 1..4 连续递增（先查/后查有序）；每项含 `check_item`/`data_source`/`tool`/`reason`/`stop_when_enough`；数据源顺序 `CDP>HJE>MKT>ACT`；停止条件＝计划内查证完成或依据已足够、且「不强制跑满」；`sources` 过滤（仅 CDP→1 步）；未命中数据源抛错 |
| ③ S-A3 线索归纳 | **TC-A-M3-003** | 有效线索 3 条（含人群/环节归属）；裸变化（无归属）被排除且计入 `unattributed_count=1`；每条有效线索 `attribution` 以 `audience:`/`journey:` 开头；无 `unattributed` 伪归属混入；`evidence_refs` 透传；同 fact 有人群+环节时以 `audience` 前缀归并 |
| ④ 注入清单装配 | F-14 薄读口径 | `loadDiscoveryContext` 返回六键注入清单；fake-db stub 下 prepare 语句**无 INSERT/UPDATE/DELETE（零写）**；确实经 prepare 调用了读面 |
| ⑤ 静态核验 | 零写 / 零外部调用纪律 | 无 `fetch` / 无 http(s) 字面；本文件无裸写语句字面（零写库）；唯一业务 `import` 来自 `../shared-context/index.js`；不 import `node:sqlite` / `tool-executor` / `task-runner` |

## F-15 已通过用例（`test-f15.mjs`，87 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① S-A2 真实查询 | **TC-A-M3-002** / **TC-I-M3-002** | 缺 `task_id`/`tool_id` 抛错；真实 ok → `verified=true`、`result_summary` 与注入返回体**逐字一致**（原样透传）、带 `query_id`/`source_id`/`queried_at`、EXT-01 已落痕；**哨兵串证硬红线**：传 `model_expectation` 后输出任何字段都**不含该串**且 `used_model_expectation=false`；失败 → `verified=false`、`result_summary=null`、`fail_reason` 原样透传（含真实错误码）；无授权 → 受限且 **transport 零调用**（不发起外部调用） |
| ② 五项检查 | **BRD §4 F-15**（L191-195）| 五项齐备（`source`/`applicability`/`info_time_point`/`existing_opportunity`/`gap`）；来源可回查（`query_id`）；适用范围命中目标范围→通过；信息时点未晚于取数时刻→不倒挂；已有机会命中（带 `hits`/`hit_count`）；缺口按 CFG-05 **4 条规则逐条核对**（每条带 `rule_id`/`target_field`/`gap_text`/`impact_note`），文本含渠道 → GAP-3 视为已写清、文本未提退款 → GAP-1 如实列为待补（**不静默放过**）；`all_present=true`；初步解释含「尚未验证」「值得进一步研究」「不下 HVA 判断」且**不含结论性措辞**；目标未声明范围 → 适用范围记**未知**且 `all_present=false` |
| ③ 倒挂隔离 | **TC-A-M3-006** | 3 条证据中 1 条晚于取数时刻 → **仅该条** `isolated`（原因 `info_time_point_after_fetch`）、其余 2 条照常参与、`batch_failed=false`（**非整包失败**）；无倒挂 → 全部参与；缺 `at` / 入参非数组抛错；倒挂事实在五项检查里 `contradicted=true` 且**不予采用**为证据草稿（`reason=contradicted_evidence_isolated`） |
| ④ 缺字段退回请补 | **TC-A-M3-005** | 缺 `missing_note` → `action='request_supplement'`、精确列出缺项、**`draft=null`（不返回半成品）**、口径含「不静默回退」「不编造」、含补齐指引；齐备 → `accept`；`required_fields` 为空抛错（**不隐式取默认**） |
| ⑤ 证据草稿与落库 | EXT-02 四要素 / F-09 单一写入面 | 四要素齐 → `completeness.valid=true`；草稿含来源/条件/时点/适用范围 + `missing_note`（缺口随依据留痕）；经 `recordVerificationEvidence` **复用 F-09 `createEvidence`** 落 EXT-02 并回查（挂真实 `query_id`/`source_id`）；四要素不齐 → 由 F-09 拒绝落库（实际未落行） |
| ⑥ 一步编排 | F-15 输入→输出契约 | 真实返回 → `verified=true` + 五项检查 + 证据草稿 + 初步解释，且**全链路不出现模型预期哨兵串**；未取得真实返回 → `checks`/`evidence` 均空、失败原因原样、口径含「不编造」且给出「退回请补」 |
| ⑦ 时点抽取 | 倒挂判定基础 | 从自由文本抽**首个**可识别时点（取数时刻优先）；`2026-9-6`→`2026-09-06 00:00`（补零）；无可识别时点 → `null`（**不猜**） |
| ⑧ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零写语句**（实测命中 0）；外部访问**只经 M5**（import `../tool-executor/index.js`）；读语句**仅面向 CFG-05** `gap_rule`；证据落库走 F-09 `createEvidence`；不 import `node:sqlite`/`node:fs`/`task-runner` |

## F-16 已通过用例（`test-f16.mjs`，73 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 依据足够→机会记录 | **TC-A-M3-004** | `outcome=opportunity`、取号 `OPP-015`（库内最大 014 +1）；MD-06 新增 1 行且**MD-07/EXT-02 行数不变**（F-16 止于机会）；六要素逐项落库（对应目标两列 / 涉及对象来自线索归属 / 观察现象 / 研究理由 / 初步依据含可回查查询号+来源）；`unknown_item=''`（二态·确无）且 `six_elements_complete=true`、`pending_supplement=false`；默认状态 `candidate` |
| ② 依据不足→缺口记录 | **TC-A-M3-004**（合法产出） | 未取得真实返回 → `outcome=gap`、`opportunity_id=null`；**MD-06 与 LNK-03 行数均不变（零写库）**；`basis.required.real_return=false` |
| ③ unknown 未评估 | **ADR-003**（Q-05） | `unknown_item` 未提供 → `not_assessed`、`pending_supplement=true`、`six_elements_complete=false` → 判**不齐**退回缺口（**不放过漏评估**）；不写库 |
| ④ unknown 纯空白串 | **ADR-003**（应用层须拒） | `'   '` → 抛错（**不静默降级**）；有实义未知项 → 正常形成机会且计入齐全（`has_unknown` 是合法态） |
| ⑤ 判重命中→关联更新 | **TC-A-M3-004** | 命中已有机会 → 仍形成新机会（新现象有独立价值）且落 LNK-03 `LK-OR-003`：`from=OPP-013`（已有机会）`to=OPP-015`（新机会）`kind=same_issue`（**方向对齐种子 LK-OR-002**）；关联可按机会反查；再跑一次按新机会逐个登记（`OPP-016`）方向口径稳定 |
| ⑥ 取号 | 全库口径 | `nextOpportunityId=OPP-015`、`nextOpportunityRelationId=LK-OR-003`（确定性、可回查） |
| ⑦ 缺口记录结构 | **PRD-M3** F-16 | `scope_checked`（目标 id / 业务范围 / 比对关键词）；`info_gaps` 非空且区分来源（`query_failed` / `evidence_isolated` / `cfg05_gap_rule` / `six_elements`）；`affected_judgements` 非空；倒挂 → 判依据不足（`not_contradicted=false`） |
| ⑧ 纯函数与 caveat | F-16 判据口径 | 标题派生（取现象 / 显式优先 / 无来源→null / 截断 80）；六要素装配含 `unknown_item`；**适用范围未判定不阻断**（`caveats.scope_decided=false` 而 `enough=true`，仍形成机会由人工节点复核）；`hasEnoughBasis` 返回结构稳定 |
| ⑨ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零自有写语句**（实测命中 0）；**零裸 SQL**（`SELECT` 实测 0，取号/判重走读面）；唯一 `import` 来自 `../shared-context/index.js`；不反向依赖 `task-runner`/`tool-executor` |

## F-17 已通过用例（`test-f17.mjs`，66 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① PM 决策上下文 | **PRD-M3** F-17 | 锚定机会；现象原样透传；依据条数＝LNK-01 关联数（`OPP-012`→2 条）；每条四要素（来源/条件/时点/适用范围）**逐项非空**且可回查；`linked_at` **原样透传不解析**（值形式见 `schema.md` §12 Q-16）；未知项二态正确；**性质声明**「尚不构成 HVA 结论」；下一步＝人工节点且 `auto:false`；**不含生产动作类内容**（BRD §5.3） |
| ② 人工节点守卫（**防假通过**） | **TC-I-M3-001** | 前置：种子 `OPP-012` 状态为 `submitted`、且 MD-12 **零建议行**；→ `human_node_completed=false`、**`can_handoff=false`（状态为 submitted 也不放行）**、`auto_handoff=false`、`blocked_by='human_node'`、`reasons` 引「MD-12 无建议行」、`required_node` 指 M1 F-03、`proposal_ids=[]` |
| ③ 完成人工节点后放行 | **TC-I-M3-001** | 经 F-03 `submitProposal` 后 MD-12 出现 1 行 → `can_handoff=true`、`blocked_by=null`、`proposal_ids` 指向真实建议、研究问题透传；**但 `auto_handoff` 仍 false**；守卫本身**不建任何 M4 任务** |
| ④ 反向问 PM | **PRD-M3** F-17 | 夹具机会（无证据 + 未知项 `NULL`）→ `ask_pm=true`、`to='PM'`，请补项含 `initial_basis`（无 LNK-01 关联）与 `unknown_item`（未评估）、每条含「为何请补」与「请补什么」、不越界为生产动作；六要素齐且有证据的机会 → `ask_pm=false`（不无病呻吟） |
| ⑤ 交接包（只组装不触发） | **PRD-M3** F-17 / **TC-I-M3-001** | 未过守卫 → `handoff:null`＋`blocked_by='human_node'`＋`no_auto_handoff:true`，但 PM 上下文仍完整；过守卫 → `handoff` 带 `research_question`/`goal_version_no`/`already_triggered:false`＋**入口提示文字**（指向 M1 F-04）；**关键红线**：组装前后 **`task` 行数不变、`hva_research` 行数不变**（不代为启动 M4） |
| ⑥ 前置校验 | 确定性编排纪律 | 机会不存在 → 三个入口一律报错（不静默造上下文）；必填缺失 → 报错 |
| ⑦ 常量口径 | BRD §3.1 / §6 | `HANDOFF_NODE.auto === false`、指向 M1 F-03→F-04、常量冻结；四要素常量 4 项且冻结 |
| ⑧ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零写库**（实测命中 0）；**零裸 SQL**（`SELECT` 实测 0）；**不 import `../task-runner/hva.js`**、**代码中不出现 M4 建任务函数名**（TC-I-M3-001）；import 恰 2 条＝`../shared-context/index.js` ＋ `../task-runner/proposal.js`；不依赖 `tool-executor` |

## F-18 已通过用例（`test-f18.mjs`，71 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 装载角色指令 | **PRD-M4 §1.1.1/§1.1.2** | `loadAgentRole(db,'hva-agent')` 全字段取自 MD-13（`agent_stage=M4`、`v1.3`/`r12`）；版本快照串与 F-13/种子**逐字一致**；生效 Skill 取自 MD-14（仅 `S-B1 hva-five-checks`）；段落骨架 5 段且顺序＝职责→输入→工作方式→输出→结束条件，每段 `source` 回指 `agent.md`；业务指令 8 条（`BR-01`~`BR-08`）；两条红线与边界声明随装载暴露；反例：不存在 / 空 `agent_code` → 报错 |
| ② 本体逐条对齐（**回指不重述**） | F-18 口径 | `business-rules.md` 有序列表恰 8 条、标题与 `BUSINESS_RULE_IDS` **逐条一致**；`hva/agent.md` 含五个章节标题与「产品假设不预先作为研究结论」；两本体**已去建壳声明** |
| ③ 结束条件 | **PRD-M4 F-18 验收要点** | 有依据回答 → `closed/kind=research_answer`（依据条数如实）；**无依据 → 不结束**（原因回指 `BR-01`）；说明限制 → `kind=limitation_stated`（**合法结束**、原因原样透传、`negation_allowed=false`）；二者皆无 → 不结束并列 `missing` 两项；**红线①**：`answer_nature=hypothesis` → 拒绝（须先经查证）；**红线②**：`unsupport + due_to_failure` → 拒绝（BRD §7 第 4 条），而**非失败的「未支持」是完整结果**；入参非对象 → 报错 |
| ④ 假设性质标注 | **PRD-M4 红线 2 / BRD §6** | `nature=hypothesis`、`is_conclusion=false`、`must_verify=true`；字符串入参可、去空白；空白 / 缺文本 → 报错（不静默降级） |
| ⑤ 输出边界扫描 | **TC-C-M4-001**（硬红线可运行形式） | 合规文本 → `clean=true`、扫描项数＝禁词表长度（恰 4 项：活动配置 / 权益组合 / 预算 / 排期）；含生产动作 → `clean=false` 且**逐个列出命中与位置**；非字符串 → 报错 |
| ⑥ 运行期零写 | **TC-I-M4-002** | 装载前后 `agent_profile`/`skill_registry` 行数不变；fake-db 记录到的语句**全为 `SELECT`**（实测 4 条、非 SELECT 0 条） |
| ⑦ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零写语句**（实测 0）；**零裸 SQL**（`SELECT` 实测 0）；import **恰 1 条**＝`./profile.js`；不依赖 `node:sqlite`/`node:fs`/`tool-executor`/`task-runner`/`shared-context`；不出现下游建任务 / 查询入口函数名 |

## F-19 已通过用例（`test-f19.mjs`，94 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 三分支路径选择 | **TC-A-M4-001** | 入参非对象／缺 `research_question` → 报错；**起点①** 有假设 → `path=verify_hypothesis`、首步 `hypothesis_check`、假设经 F-18 口径标注（`nature=hypothesis`/`is_conclusion=false`/`must_verify=true`）；**起点②** 无假设 → `path=find_candidate`、首步 `candidate_search`、`hypothesis=null`（不编造）、`allow_no_candidate=true`、明示「未找到有足够依据的候选行为也是完整结果」；**起点③** 不适合 → `path=state_limitation`、计划只含 `state_*` 步（不安排五查取数）、`limitation.hard_run=false`、研究问题原样带出、既有发现条数如实；三条路径**均 `stopped=true` 且停止条件含「路径确定」**（S-B1）；查证顺序模板＝五查顺序、`evidence_order` 与之一致、计划＝首步＋五查共 6 步且 `step_no` 连续、每步含 `check_item`/`reason`/`stop_when_enough`/`data_sources`；来源过滤（仅 CDP → 1 来源步 + 2 无来源步；无来源步恒保留） |
| ② 适合性判断 | **TC-I-M4-003** | 缺／空白 `research_question` → 报错；**未提供判断 → 按「适合」继续**（`source=default_no_llm`）并标 `llm_gated=true`、口径声明含 A-1 门禁与「不硬下不适合结论」；上游判定被采纳（`source=provided`）、信号如实透传（可扩展结构，**不硬编码个数**）；不适合时给「说明限制而非硬做」口径；`suitability` 形态非法（字符串 / `suitable` 非布尔）→ 报错（**不静默忽略**） |
| ③ 比较条件装配 | **PRD-M4 F-20**（比较条件三项） | 恰 3 项且键名＝`audience`/`observation_stage`/`result_metric`、每项含标题与来源回指；三项齐 → `declared=true` 且三项分别取自 `population_limit`／目标版本关注时段／目标版本指标口径；缺项**如实列出**（`observation_stage,result_metric`）且口径含「不编造」；全缺 → 三项全列（不静默回退）；**缺失不阻断「路径确定」停止**（缺口由 F-20 承接） |
| ④ 薄读二阶段注入清单 | **TC-A-M4-001**（注入清单） | 真实任务链夹具（F-03 建议 + F-04 任务）：`task_type=hva_research`；机会及版本取自 LNK-04 锚点（`OPP-012`，v3）；目标版本快照已装配（MD-02 v3）；产品问题取自 MD-12 **真实建议行**（非种子）；可选假设／人群限制随清单带入；证据条数＝LNK-01 关联数（2）且每条带 `evidence_id`；历史按机会现读 MD-07（`R-007`）；所选机会附六要素判定；CFG-06 `hva_research` 必需类型齐备；PD-06 留痕非空；一步编排（清单→路径）→ 起点①且比较条件从清单现读；**前置守卫**：任务不存在／空 `task_id` → 报错 |
| ⑤ MD-12 外键反例 | **TC-D-M4-006** | 直插 `research_proposal.opportunity_id='OPP-NOPE'` → `FOREIGN KEY constraint failed`，且**反例不留半截行**（行数仍 0）；应用层同步守卫：F-03 写入面对不存在机会报错（库级 + 应用层双保险） |
| ⑥ 运行期零写 | **TC-I-M4-002** | 薄读 + 纯编排前后 `task`/`context_injection`/`research_proposal`/`research` 行数不变（实测 8/3/1/2 → 8/3/1/2）；fake-db 记录到的语句**全为 `SELECT`**（非 SELECT 0 条） |
| ⑦ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零写语句**（实测 0）；**零裸 SQL**（`SELECT` 实测 0）；import **恰 2 条**＝`./role.js`（复用 F-18 假设标注口径）＋`../shared-context/index.js`（读面）；不依赖 `node:sqlite`/`node:fs`/`tool-executor`/`task-runner`；不出现建任务 / 查询入口函数名 |

## F-20 已通过用例（`test-f20.mjs`，138 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 入池阈值 | **TC-U-M4-001** | `0.62/0.6 → in_pool=true`；`0.55/0.6 → false`；**边界闭区间**（等于阈值即入池、口径冻结 `POOL_BOUNDARY='inclusive'`）；标记 `deterministic` 并给出与阈值的差值；重复调用结果一致（无随机）；缺 `composite_raw`/`pool_threshold` → 报错（**不隐式取默认**）；`null` → 报错（`Number(null)=0` 不静默放行）；非数值 → 报错 |
| ② 人群可比性（S-B2） | **TC-A-M4-002** | 差异均已解释 → `comparable=true`（`basis=derived_from_differences`）、不限制行为作用判断、停止条件含「可比性明确」；存在未解释差异 → `comparable=false` 且**限制行为作用判断**（红线可运行，含原文口径）；**无差异清单 → 可比性「无法明确」**（不硬下「可比」结论）同样限制判断；语义判断**可注入并采纳**（`basis=provided`、`gated=true`、信号如实透传且不硬编码个数）；`comparability` 形态非法 / `differences` 非数组 / 差异项缺 `feature` → 报错（不静默忽略） |
| ③ 五查与倒挂（S-B3） | **TC-A-M4-003** | 五查键序＝**F-19 查证顺序派生**（不复制第二份清单）、维度＝商品/活动/权益；缺 `at` → 报错；① 可比成立 ② 行为在结果之前且 `batch_failed=false` ③ 口径一致 ⑤ 依据不足 → **不给确定判断**（含原文口径）；**倒挂隔离**：信息时点晚于取数时刻的**仅该条失效**（`info_time_point_after_fetch`）、其余照常参与、倒挂条目不进可用条目；**失败不否定**：`due_to_failure` 条目 `usable_as_negation=false`、转信息缺口、口径明示「不能当否定结论」；**活动存在 ≠ 用户参与**（`existence_only` 不计为已排除，回指 BRD 原文）＋**未排查维度不得默认无关**（`not_checked`）＋有参与侧记录才可排除；**因果不臆断**（`causal_claim_allowed` 恒 false）；依据不足 → `not_supported` 且 **`complete_result=true`/`is_failure=false`**（含「完整结果」口径）；停止条件＝五查完成或信息缺口已说明；反例三路：把结果当行为影响（violation）、结果不晚于行为、口径不一致；**正例**：五查全通过 → `candidate_supported` 且仍称「候选行为」 |
| ④ 缺比较条件守卫 | **TC-A-M4-006** | 三项齐 → `proceed`；缺项 → `request_supplement` 且**精确列出缺项**、**`draft=null`（不返回半成品）**、逐项请补理由、口径含「不静默回退、不编造」、给补齐指引；**查不到已过审素材**同样退回请补；三项全缺 → 三项全列；一步编排在比较条件不全时**优先退回请补**（不含五查结果）；**未入池为合法筛选结果**（不进入五查、不写库、口径含「不是失败」） |
| ⑤ 落库（MD-09/MD-10） | **PRD-M4** F-20 / schema MD-09·MD-10 | 夹具＝F-03 建议 + F-04 任务链；取号＝库内最大 +1（`CB-003`/`BP-011`）；MD-09 行落库（研究归属 + 状态列 + **只改状态不改名**）；MD-10 支持 / 不支持**并列成行**且同立场 `order_no` 从 1 连续；**失败条目与倒挂条目不落库**（分别转缺口、该条失效）；**只新增 MD-09/MD-10 行**，`research`/`task`/`evidence`/`opportunity`/`research_proposal` 行数不变；状态推进影响 1 行且不新增行；读面可按研究 / 候选行为反查；前置守卫（缺 `research_no`/`behavior_name` → 报错、研究不存在 → 应用层报错）；**退回请补与未入池均不写库**（行数不变） |
| ⑥ 库级约束反例 | **TC-D-M4-003** / **TC-D-M4-004** | `MD-09.research_no='R-NOPE'` → `FOREIGN KEY constraint failed` 且**不留半截行**；重复 `candidate_id` → PK 拒绝；撞种子既有 `(CB-001, support, 1)` → **复合 UK 拒绝**；同候选行为 + 同立场 + 新 `order_no` → 允许（UK 只卡三元组）；重复三元组 → `UNIQUE constraint failed: behavior_point.(candidate_id, point_type, order_no)`；`MD-10.candidate_id='CB-NOPE'` → FK 拒绝；写入面对不存在研究同步报错 |
| ⑦ 查询链路与零写 | **TC-I-M4-002** | 经 **M5 只读**取得真实返回 → `verified=true`、标注 `via='M5（runQueryWithRecovery）'`/`read_only=true`、带 `query_id`（可回查）/来源/工具、EXT-01 留痕由 M5 承接、确实发起 1 次外部调用；**哨兵串**证 `model_expectation` 不出现在任何输出字段（`used_model_expectation=false`）；`check_key` 不属五查键 → 报错；**无授权 → 不做「已验证」判定且 transport 零调用**；纯编排与退回请补前后 MD-09/MD-10 行数不变；fake-db 下取号发出的语句**全为 SELECT**（零写） |
| ⑧ 静态核验 | 硬红线纪律 | `behavior.js`：零 `fetch(`/无 http(s) 字面；**零写语句**、**零裸 SQL**（`SELECT` 实测 0）；import **恰 3 条**＝`./behavior-store.js`（写面）＋`./verification.js`（经 M5 的唯一查询出口与倒挂口径）＋`./research-start.js`（五查顺序与比较条件）；不直接依赖 `node:sqlite`/`node:fs`/`tool-executor`；确实委托 `runMetricVerification`/`isolateContradictedEvidence`/`resolveComparisonConditions`（可静态核对，不重写一份）；五查键序**派生**自 F-19 常量。`behavior-store.js`：写语句目标**仅限** `candidate_behavior`/`behavior_point`、唯一改行语句只落在 `candidate_behavior`、**绝无删行**、不写取号 SQL、**零 import** |

## F-21 已通过用例（`test-f21.mjs`，136 断言）

| 组 | 覆盖用例 | 实测要点 |
| ---- | ---- | ---- |
| ① 七要素契约与上游对齐 | **TC-C-M4-001**（结构部分） | 七要素恰 7 项、序号 1~7、键序由 `RESULT_ELEMENTS` **派生**、每项带 `storage` 回指；**读 `test-M4.md` 抽七要素名逐条相等**（业务目标与研究问题 / 研究范围与方法 / 证据与关键发现 / 人群差异 / 候选 HVA 及支持情况 / 其他解释与限制 / 改善方向）；禁词与用例文档**逐项覆盖**（用例简写「权益」↔ 实现「权益组合」，差异已在文档卡登记）；`dict:RESEARCH_STATUS` / `dict:FINDING_SUPPORT` 只持键名 |
| ② 组装与硬红线 | **TC-C-M4-001**（硬红线部分） | 组装带 7 键且键序＝`ELEMENT_KEYS`；七要素齐 → `complete=true`；正文含「权益组合 / 排期」→ `clean=false` 且**命中回指具体字段**；**`out_of_scope_note` 含这些词不影响 clean**（扫描对象只有七要素正文）；缺要素如实列出 6 项且 `complete_result=false`；无候选行为须给 `candidate_absent_reason`（给了则 ⑤ 成立） |
| ③ S-B4 组装 | **TC-A-M4-004** | ③ 逐条保留发现（正文 + 限制说明）；逐发现挂接证据（`evidence_refs` 随条目保留）；**无证据的发现记 `finding_without_evidence` 缺口、不编造**且不阻断齐备；⑤ 支持与不支持**并列成行**；⑦ 与发现逐项对应（3 条全 linked）；改善方向三要素齐；⑦ 空列表须给 `no_action_reason`；**未支持候选 HVA 仍 `complete_result=true` / `is_failure=false`**；`causal_claim_allowed` 恒 false；对应校验四路（按 id / 按序号 / 缺 ref / 未知 ref / 三要素缺项 / 空列表） |
| ④ 失败不否定 | **TC-A-M4-005** | `due_to_failure` 发现**不进 ③**、单列且 `usable_as_conclusion=false`；`negation_allowed=false`；`degraded=true` 且 `warnings_kept=true`，warning 明写「不能当否定结论」；转 `due_to_failure` 缺口；`conclusions_preserved=true` / `existing_conclusions_overturned=false`；**失败不把报告判成不完整**；**合法反例**：非失败的「未支持」照常进 ③、`negation_allowed=true`、仍是完整结果 |
| ⑤ 取号 | —（F-21 编排约定） | `F-007` / `AC-005` / `LK-FE-009`＝种子最大 +1；取号不写库（种子行数 6 / 4 不变） |
| ⑥ 库级约束反例 | **TC-D-M4-001** / **TC-D-M4-002** / **TC-D-M4-005** | `MD-07.research.opportunity_id='OPP-NOPE'` → `FOREIGN KEY constraint failed` 且**不留半截行**（该反例走 F-11 建行面所依赖的库级约束，F-21 **不复制建行口径**）；`MD-08` 重复 `(research_no, order_no)` → 复合 UK 拒绝（经 F-21 写入面，`run()` 失败即抛）；`MD-11` 重复 `(research_no, order_no)` → UK 拒绝；写入面应用层守卫：研究不存在 / `order_no` 空串 / `null` / `0` / 布尔 / 缺必填 各拒一次 |
| ⑦ 落库与回查 | **TC-A-M4-004**（保存部分） | 夹具＝F-03 建议 + F-04 任务链 + F-11 研究壳；**前置守卫五路（未齐 / 违规 / 对不上 / 研究不存在 / 已出报告）全部一行未写**；正常落库 **201**：发现 3 / 证据关联 4 / 改善方向 3，编号接种子最大 +1；**只新增 MD-08 / MD-11 / LNK-02 行**（`6→9` / `4→6` / `8→12`），MD-07 **只改行**且 `research` / `task` 行数不变；`research_status='done'` + `finished_at` 写入，而 **`opportunity_id`/`goal_version_no`/`start_task_id`/`parent_research_no` 启动快照原样**；MD-08 顺序连续、`support_flag` 域内；**同一研究二次出报告被拒（防覆盖、防半截）**；回查（语句**全为 SELECT**）得 3 发现 / 4 证据关联 / 3 改善方向 / 七要素视图；研究不存在回查返回 `null`；种子 `R-007` 可直接回查（4 发现 + ⑤ 支持 3 / 不支持 3） |
| ⑧ 静态核验 | 硬红线纪律 | `result.js`：零 `fetch(`/无 http(s) 字面；**零 SQL 语句**（含读语句，实测 0）；不依赖 `node:sqlite`/`node:fs`/`tool-executor`；import **恰 5 条**＝`./result-store.js`（写面）＋`../shared-context/index.js`（MD-07 读面 + LNK-02 唯一写入面）＋`./behavior-store.js` + `./behavior.js`（F-20 ⑤ 真源与口径常量）＋`./role.js`（F-18 禁词唯一口径）；确实复用 `scanProductionActions`/`FORBIDDEN_PRODUCTION_PATTERNS`/`linkFindingEvidence`/`getResearch`/`listCandidateBehaviors`/`listBehaviorPoints`（可静态核对）；不写 `SELECT MAX`。`result-store.js`：写语句目标**仅限** `research_finding`/`improvement_action`、唯一改行语句只落在 `research`、**绝无删行**、**不写 `finding_evidence`**（该表唯一写入面＝F-11）、**零 import** |

## F-22 已通过用例（`test-f22.mjs`，136 断言）

| 组 | 覆盖用例 | 实测要点 |
| ---- | ---- | ---- |
| ① 契约与上游对齐 | **TC-I-M4-001** | 读 `test-M4.md` 断言 oracle 行含「F-22 / `parent_research_no` / 启动时版本 / 保留原结果与依据」；读 `PRD-M4` F-22 章节断言「检查已有依据是否仍适用」「时间范围、查询条件变化时补查」「沿用或补查」「再触发本模块 F-19/F-20/F-21」四句在案；三态 `REUSE_DECISIONS`、三维度 `CHANGE_DIMENSIONS`、四态 `SCOPE_RELATIONS`、三档 `REUSE_SEVERITIES`、下游链 `F-19>F-20>F-21`、起点 `S-B1`、任务类型 `hva_followup` 逐项成立 |
| ② 纯函数：抽区间与依据复用 | **TC-I-M4-001**（判定部分） | `parseCoverage`：`覆盖 A ~ B` 抽出区间、无覆盖不猜（`coverage=null`）、空文本双空；`assessEvidenceReuse`：**未声明 → `undetermined` + `llm_gated`**（既不沿用也不补查）／`{}` → 全部沿用／查询条件变与不变（含归一化去空白）／适用范围相同与**更窄沿用**（带原因码 `scope_narrowed_still_applicable`）与更宽补查与**未声明关系不猜**／时间范围在区内沿用、超区补查、晚于取数时点补查、无法解析记 `undetermined` 并保守计入补查／无既有依据必补查；七类形态非法（数组、`time_range` 非对象 / 缺 `to` / 倒挂、声明空串、关系值域外）**一律抛错**，非数组入参不崩 |
| ③ 承接主流程（F-05 链） | **TC-I-M4-001** | 夹具走 F-03→F-04→F-11→F-21→F-05 真实调用链；断言回带任务身份 / 追问研究编号 / 原研究编号 / 研究壳存在 / 问题来源可追溯 / 原任务编号；`preserved` 逐项回带（七要素、发现逐条带证据回指、改善方向、依据**全字段**、**追问链 `descendants` 含本轮追问研究**）；`negates_original_conclusion=false`；`original_preserved=true`；版本沿用且**任务版本 ↔ 研究版本一致**；新一轮入口（起点 / 链 / 编号 / **`check_sequence_keys` 派生自 F-19** / 比较条件「能定则定」/ 缺项如实登记 / 不覆盖范围声明 / 停止条件）；边界自述与**运行期零写**（7 张表行数不变、`research`/`task`/`research_finding` 逐行未变） |
| ④ 种子原型剧本 | **TC-I-M4-001** | `T-1023`（`hva_followup`）＋显式 `R-007`：研究壳缺失**如实回带 `null`**（不编造）；R-007 的 4 发现 / 3 改善方向 / 候选 `CB-001` / **4 条去重依据**（`EV-1038/1041/1027/1031`）全部回带；`ancestors=0`（链的根）；PM 问「渠道结构（APP / 小程序）」→ 适用范围放宽 → **4 条依据全部 `applicability_scope_changed`**（对齐 `EV-1041` 原范围「仅主站 APP 端；不含小程序」）；补查清单逐条带证据编号与严重度；未声明 → `undetermined` 不产出清单；`{}` → 4 条沿用；更窄 → 沿用 |
| ⑤ 版本口径 | **TC-I-M4-001** | 追问 **升版 v4** 而原研究仍 v3（钉版）、`new_version_required=false`；本轮追问前后原任务与原研究版本**逐字未变**；原任务继续用启动版本 v3；**声明范围变更但未升版 → `new_version_required=true`**（建版本行归 M1 F-01，本步不建）；本步不新建研究行、不改写 MD-02 行 |
| ⑥ 下游派发与边界 | 硬红线纪律 | 派发端口**未注入 → 不触发**（`reason='not_injected'`，不重复发 Queue 消息）；注入 → **恰调用一次**且载荷带 `entry=S-B1`、`chain=F-19>F-20>F-21`、追问任务与新研究编号；追问文本含「预算 / 排期」→ **提示命中项**（口径项数复用 F-18）且**不拦截提问**；未越界时不产出警告（无误报） |
| ⑦ 入口守卫 | 承接前置条件 | 缺 `task_id` / 任务不存在 / **非 `hva_followup` 任务**（防把普通研究或发现任务当追问）/ 原研究不存在 / **既无研究行又未给原研究编号 → 无法解析** 五路即拒；薄读对不存在任务返回 `null` |
| ⑧ 静态核验 | 硬红线纪律 | `followup-intake.js`：import **恰 6 条**且全为既有读面；**零写语句**、**零 `SELECT`**（连读语句都不写）、零外部调用；不出现 M1 建行 / F-21 落库函数名（**不重复实现上游写面**）；确实复用 `loadResearchResultContext` / `getResearchLineage` / `parseStamp` / F-18 禁词口径（可静态核对）；不在本文件重新定义禁词表；下游链常量冻结；无 `TODO`/占位/`&& false` 残留 |

## HTTP 路由面（`server/api/index.js`，F-13/F-14/F-15/F-16/F-17/F-18/F-19/F-20/F-21/F-22 接入）

| 路由 | 职责 | 成功 / 错误码 |
| ---- | ---- | ---- |
| `GET /api/agent-profiles/{agent_code}` | 读角色指令 + 生效 Skills + 版本快照 | 200；角色指令不存在 404 |
| `POST /api/agent-profiles/{agent_code}/version` | 推进 agent.md 版本（单行 UNIQUE、不新建行） | 200；版本号必填缺失 400 |
| `POST /api/skills` | 注册 Skill（PK/UK/FK 库级强制） | 201；必填缺失 400；约束冲突 409 |
| `POST /api/discovery-plan` | F-14 · S-A1 一阶段注入清单→确定性查证计划（纯计算、零写库） | 200；缺 `goal` 400；`sources` 未命中 400 |
| `GET /api/discovery-context/{task_id}` | F-14 · 装配一阶段注入清单（薄读，复用 shared-context 读面） | 200；task 不存在 404 |
| `POST /api/clue-summary` | F-14 · S-A3 查证事实集合→按人群/旅程环节归类（纯计算、拒裸变化） | 200；入参非数组 400 |
| `POST /api/intention-score` | F-14 · 意向分归一 min(raw/threshold,1)（TC-U-M3-001，纯计算） | 200；`intention_raw` 非数值 400 |
| `POST /api/metric-verification` | F-15 · S-A2 指标查证一次闭环（经 M5 真实查询 + 五项检查 + 证据草稿 + 初步解释） | 201（真实返回）；失败/受限 202（只回报真实原因，不编造） |
| `POST /api/five-checks` | F-15 · 五项检查（来源/适用范围/信息时点/已有机会/信息缺口） | 200；缺 `fact`/`at` 400 |
| `POST /api/evidence-isolation` | F-15 · 倒挂隔离（TC-A-M3-006，纯计算，非整包失败） | 200；缺 `at` 400 |
| `POST /api/missing-fields` | F-15 · 只松不严不硬映射（TC-A-M3-005，纯计算，缺字段退回请补） | 200；`required_fields` 为空 400 |
| `POST /api/verification-evidence` | F-15 · 装配 EXT-02 形态证据草稿；`persist=true` 时复用 F-09 落库 | 200（仅草稿）/ 201（已落库）；四要素不齐 409 |
| `POST /api/verification-query` | F-15 · 只跑一次真实查询供排查（不含五项检查与草稿） | 201（真实返回）；202（失败/受限） |
| `POST /api/opportunity-formation` | F-16 · S-A4 整理：依据足够→机会记录（MD-06）+ 判重关联（LNK-03）；不足→缺口记录且不写库 | 201（形成机会）/ 200（缺口记录，合法产出）；缺 `verification` 400；未知项非法 400；约束冲突 409 |
| `POST /api/opportunity-six-elements` | F-16 · 六要素组装 + 二态判定（纯计算，不写库） | 200 |
| `POST /api/opportunity-basis` | F-16 · 依据足够性判定（纯计算：真实返回/来源可回查/未倒挂/六要素已评估齐备/标题可派生） | 200 |
| `POST /api/opportunity-gap-record` | F-16 · 缺口记录（检查范围 + 信息缺口 + 影响判断，纯计算，不落表） | 200 |
| `GET /api/opportunity-next-id` | F-16 · 取号（`OPP-NNN` / `LK-OR-NNN`，库内最大 +1） | 200 |
| `POST /api/pm-decision-context` | F-17 · M3 产出→PM 决策上下文（六要素＋初步依据四要素＋未知项＋缺口＋性质声明；只读纯计算） | 200；机会不存在 404；缺 `opportunity_id` 400 |
| `GET /api/handoff-gate/{opportunity_id}` | F-17 · **人工节点守卫**（完成判据＝MD-12 有无真实建议行；`auto_handoff` 恒 false） | 200；机会不存在 404 |
| `POST /api/pm-supplement-requests` | F-17 · **反向问 PM**（必要信息缺失→请补项；不静默回退不编造） | 200；机会不存在 404；缺 `opportunity_id` 400 |
| `POST /api/handoff-package` | F-17 · 交接包**只组装不触发**（未过守卫 `handoff:null`＋`blocked_by='human_node'`） | 200；机会不存在 404；缺 `opportunity_id` 400 |
| `GET /api/agent-roles/{agent_code}` | F-18 · 装载运行期角色指令包（`agent.md` 段落骨架 5 段＋`business-rules.md` 8 条＋生效 Skill＋版本快照；只读 F-13 读面） | 200；角色指令不存在 404 |
| `POST /api/research-closure` | F-18 · 结束条件判定（有依据的研究回答 / 说明无法完成判断的原因；二者皆缺 → 不结束） | 201（可结束）/ 200（未结束——只回报判定，不算错误） |
| `POST /api/hypothesis-label` | F-18 · 产品假设性质标注（**不预设结论**，纯计算） | 200；假设内容为空 400 |
| `POST /api/output-boundary-scan` | F-18 · 输出边界扫描（禁活动配置 / 权益组合 / 预算 / 排期，纯计算） | 200（clean）/ 409（含生产动作）；入参非字符串 400 |
| `GET /api/research-start-context/{task_id}` | F-19 · 装配二阶段注入清单（机会及版本 / 产品问题 / 可选假设 / 证据 / 历史；薄读，复用 shared-context 读面） | 200；task 不存在 404 |
| `POST /api/research-start` | F-19 · S-B1 研究任务调度：三分支路径选择＋比较条件＋查证顺序＋研究计划（**路径确定即停止**，纯编排） | 201（路径确定）；缺 `research_question` 400 |
| `POST /api/research-suitability` | F-19 · 适合性判断（不适合时说明限制而非硬做；A-1 门禁下走确定性 fallback，可注入覆盖） | 200；缺 `research_question` 400；`suitability` 形态非法 400 |
| `POST /api/comparison-conditions` | F-19 · 比较条件装配（涉及哪些用户 / 观察哪个阶段 / 什么结果口径；缺则如实登记缺口） | 200 |
| `POST /api/behavior-threshold` | F-20 · 综合分入池阈值（TC-U-M4-001，纯计算、确定性无随机） | 200；缺 `composite_raw`/`pool_threshold` 400 |
| `POST /api/population-comparability` | F-20 · S-B2 人群可比性检查（差异是否已解释 → 结论＋限制，纯计算） | 200；入参形态非法 400 |
| `POST /api/behavior-checks` | F-20 · S-B3 候选行为五查（含倒挂隔离、其他解释排查、因果不臆断，纯计算） | 200；缺 `at` 400 |
| `POST /api/comparison-gate` | F-20 · 比较条件守卫（TC-A-M4-006 缺条件 / 无已过审素材 → 退回请补） | 200（`action` 决定，退回不是错误） |
| `POST /api/behavior-verification` | F-20 · 一步编排（守卫 → 入池 → 五查，纯计算零写库） | 200 |
| `POST /api/candidate-behavior` | F-20 · 落库 MD-09 候选行为 + MD-10 支持/不支持条目（经 F-20 写入面） | 201（已落库）/ 200（退回请补、未入池——**合法产出，不写库**）；研究不存在 404；缺必填 400 |
| `POST /api/research-result` | F-21 · S-B4 七要素组装（逐发现挂证据 + 支持/不支持并列 + 限制与改善方向，纯计算零写库） | 200；缺 `research_no` 400 |
| `POST /api/research-result-boundary` | F-21 · 七要素正文输出边界扫描（TC-C-M4-001 硬红线；`out_of_scope_note` 豁免） | 200（clean）/ 409（含生产动作） |
| `POST /api/improvement-correspondence` | F-21 · 改善方向与发现逐项对应校验（纯计算，对不上列 orphan / malformed） | 200（`ok` 决定，对不上不是错误） |
| `POST /api/research-report` | F-21 · 研究结果落库（S-B4「七要素齐全并保存」：MD-07 内容填充 + MD-08 + LNK-02 + MD-11） | 201（已保存）/ 409（边界违规）/ 200（未齐、对不上、已出报告——**不写库**）；研究不存在 404；缺 `research_no` 400 |
| `GET /api/research-result/{research_no}` | F-21 · 研究报告回查（七要素视图 + 证据关联 + ⑤ 支持情况；薄读） | 200；研究不存在 404 |
| `GET /api/research-next-id` | F-21 · 取号（`F-NNN` / `AC-NNN` / `LK-FE-NNN`，库内最大 +1，只读） | 200 |
| `POST /api/followup-evidence-reuse` | F-22 · 依据复用判定（时间范围 / 查询条件 / 适用范围 → 沿用 or 补查；未声明 → `undetermined` + `llm_gated`，纯计算） | 200；入参形态非法 400 |
| `POST /api/followup-version` | F-22 · 版本口径判定（追问可落新版本，原任务与原研究钉在启动时版本；纯计算） | 200 |
| `POST /api/followup-intake` | F-22 · **承接主入口**（保留原结果与依据 → 沿用/补查 → 版本口径 → 新一轮入口 S-B1；零写库） | 200；非 `hva_followup` 任务 / 缺 `task_id` / 无法解析原研究 400；追问任务或原研究不存在 404 |
| `GET /api/followup-intake/{task_id}` | F-22 · 承接上下文薄读（追问任务 + 追问研究壳 + 原研究 + 原结果与依据 + 追问链） | 200；追问任务不存在 404 |

## 口径（本模块已定，含登记在案的取舍）

### 1. F-13 角色指令配置（M3/M4 共用领域能力底座）

**① 单一写入面**：`profile.js` 是 **MD-13 `agent_profile` / MD-14 `skill_registry` 的首个（也是唯一）写入面**；零外部调用、不调 LLM（A-1 门禁只挡推理，不挡本文件的配置与版本管理）。

**② 版本管理＝同 agent_code 单行版本号推进**：`agent_profile.agent_code` 为 UNIQUE（DDL L120，承载 MD-14 外键），故版本升级只 `UPDATE` 同行的 `current_version`/`doc_revision`，**不新建行**、历史版本不落表——任务启动时由 F-06 落 `task.agent_version_snapshot` 冻结快照（见⑥）。

**③ Skill 编号对齐宪法（Q-07 已决 2026-09-19）**：`skill_no`（`S-Ax`/`S-Bx`）作主键、`skill_code`（`clue-scan`/`hva-five-checks`）降为 UK；`bound_agent_code` FK → `agent_profile.agent_code`。三反例（PK/UK/FK）由库级强制，断言见④。

**④ LLM 门禁边界（明确登记）**：**TC-C-M3-001 / TC-C-M4-001（Agent 产出结构化 JSON，response_format=json_schema 强制；strict 只卡外层可解析性）属 A-1 LLM 推理契约，A-1（LLM 推理服务）当前 ⬜ 未提供（external-deps §7 最大风险）**——本文件不实现推理，`test-f13` 只验能力登记与版本管理；该 oracle 项**登记为「门禁未关闭、非发布门禁」**，待 A-1 落实后由 F-14~F-22 补验。

**⑤ 不复制中文枚举**：`agent_code` 值域（discovery-agent/hva-agent）由 `dict:AGENT_CODE`（种子 DI-083/084）承担，本文件不内联字典；约束失败（UNIQUE/PK/FK）抛出 Error，与 F-26 `task-state.js` 一致（`run()` 失败即抛）。

### 2. F-14 围绕目标寻找线索（M3 找线索核心 · 纯编排）

**① 零写库 + 单读面复用**：`discovery.js` 所有导出均为**纯计算**（`normalizeIntentionScore` / `assembleDiscoveryPlan` / `summarizeCluesAsJourney`）或**读面复用**（`loadDiscoveryContext` 调 `shared-context.getTaskContext`/`getResearch`），**不 INSERT/UPDATE/DELETE 任何表**；唯一业务 `import` 来自 `../shared-context/index.js`。与 F-13 不同，F-14 无独立写面（M3 的写面由 M2 shared-context 承担）。

**② LLM 门禁边界（mock/demo 推进，明确登记）**：S-A1/S-A3 的**真实运行须 LLM（A-1）**，A-1 当前 ⬜ 未提供——本文件在门禁关闭前提供**确定性 fallback 编排**；**`TC-A-M3-001`/`TC-A-M3-003` 的 LLM 产出契约登记为「门禁未关闭、非发布门禁」**，`test-f14` 只验「输出结构契约」（计划有序 / 每条线索有归属），**不验真实 LLM 产出、demo 值不进断言**。

**③ 确定性领域规则（查证顺序与停止条件）**：默认查证顺序 `CDP（人群差异）> HJE（行为/转化）> MKT（反馈）> ACT（业务信息）`，与 `PRD-M3` L74-75 数据源及 TOL-01~06 一一对应；停止条件＝**计划内查证完成 或 依据已足够**（`stop_when_enough` 命中），**不强制跑满全部步骤**（S-A1 验收）。

**④ 线索须关联人群/旅程（PRD-M3 约束 2）**：`summarizeCluesAsJourney` 每条有效线索的 `attribution` 均以 `audience:` 或 `journey:` 开头；**裸变化（既无人群也无环节归属）不进有效线索**，单独计入 `unattributed_count`（对应「禁止仅罗列一组变化」）。

**⑤ 意向分归一（TC-U-M3-001）**：`min(raw/threshold, 1)` 封顶 1，确定性无随机；`threshold≤0` 除零防护回退 `raw` 本身。该函数为 F-14/F-15 共用。

**⑥ 实施发现（2026-09-20 做 F-19 时实测 · 未擅自改）**：`loadDiscoveryContext` 的 `goal`/`background`/`capabilities`/`sources` 四键**恒为空**——它读的是 `getTaskContext()` 返回对象的**顶层键** `ctx.goal`/`ctx.background`/`ctx.capabilities`/`ctx.sources`，而 `getTaskContext` 实际只返回 `sections`（按 CFG-06 模板分组）、`scope`、`template`、`missing_required`、`complete`、`injections` 等，**没有这四个顶层键**。实测（真实任务链夹具）返回 `{goal:null, background:null, capabilities:[], sources:[]}`，而同一任务 `sections` 里 `goal`/`background`/`source` 三类**确有条目**。`test-f14` ④ 组只用 fake-db 断言「六键存在」，故该偏差**静默通过**。**F-19 按正确方式实现**（从 `sections` 取值，见 §7 ⑦）。该缺陷已于 2026-09-20 修复：`discovery.js` 改从 `sections` 按 `context_type_code` 取值（对齐 F-19），`test-f14` ⑥ 组新增真实 D1「值非空」断言锁定。

### 3. F-15 基础查证（M3 查证核心 · 经 M5 真实查询）

**① 零自有写语句 + 双面复用**：`verification.js` 自己**不含任何 `INSERT`/`UPDATE`/`DELETE`**（`test-f15` ⑧ 静态断言）——查询与留痕（EXT-01）**全经 M5** `runQueryWithRecovery`，证据（EXT-02）**全经 F-09** `createEvidence`。外部访问也**只经 M5**（唯一出口），对应 `TC-I-M3-002`「所有外部查询经 M5、只读」。

**② 硬红线「禁止以模型预期内容代替查询结果」（TC-A-M3-002）**：`result_summary` 一律**原样透传**自 M5 信封（`mapResponseToResult` 本就不生成业务结论）；**只有 `result_status='ok'` 才置 `verified=true`**。调用方若传 `model_expectation`/`expected_summary`，本文件**显式忽略**并留 `used_model_expectation:false` / `model_expectation_ignored` 供核查；`test-f15` 用**哨兵串**证明该串不出现在任何输出字段里（含全链路一步编排）。

**③ 五项检查（BRD §4 F-15）**：`source`（哪份资料哪次查询，`query_id`/`source_id` 可回查）、`applicability`（人群/渠道/旅程环节是否对应当前目标；**目标未声明范围时记「未知」，不猜**）、`info_time_point`（业务条件是否已变化 + **倒挂判定**）、`existing_opportunity`（是否记录过相同问题：按关键词与 MD-06 已有机会的标题/现象比对，命中列出并**建议关联更新而非新建**）、`gap`（还缺什么、缺失影响哪项判断：**规则来自库内 CFG-05 `gap_rule`**（`is_active=1`，`match_pattern` 未命中即开放缺口），**不内联口径字典**）。`all_present` ＝ 五项都给出了肯定判定，**不把「未知」当通过**。

**④ 倒挂隔离（TC-A-M3-006，ADR-003 二态精神）**：证据**信息时点晚于取数时刻** → 视为倒挂 → **仅该条失效**（`isolateContradictedEvidence` 返回 `kept`/`isolated`），**其余证据照常参与**、`batch_failed=false`（**不污染全量**）；倒挂事实**不予采用**为证据草稿。时点抽取由 `parseStamp` 承担，抽不到时点则**不做倒挂判定**（不猜）。

**⑤ 缺字段只松不严不硬映射（TC-A-M3-005）**：`resolveMissingFields` 缺必填字段即返回 `action='request_supplement'` 且 **`draft=null`（不返回半成品）**——**不静默回退、不编造**；「素材已过审但查不到」同样退回请补（见 `guidance`）。必填字段须**显式传入**，不隐式取默认。

**⑥ 初步解释口径（BRD §4 验收）**：`buildTentativeExplanation` 一律标明「尚未验证」的部分、支持「值得进一步研究」，并明示**不给完整人群对照、不下 HVA 判断**；`FORBIDDEN_CONCLUSION_PATTERNS`（已确认/已证实/可以确认/必然/结论为/证明该）为**可静态核对的禁词表**，`test-f15` ② 断言解释文本不含之。

**⑦ LLM 门禁边界（mock/demo 推进，明确登记）**：把自然语言线索转成「待查指标＋范围」须 LLM（**A-1 ⬜ 未提供**）——本文件提供**确定性编排**，门禁关闭前只用**注入返回体**（`transport` 注入，复用 `prototype/mock/scenarios.js`）验证结构契约；**`TC-A-M3-002` 的真实 LLM 产出契约登记为「门禁未关闭、非发布门禁」**，demo 值不进断言。

### 4. F-16 机会形成与去重（M3 整理核心 · 止于机会）

**① 零自有写语句 + 双面复用**：`opportunity.js` 自己**不含任何 `INSERT`/`UPDATE`/`DELETE`**、**不含 `SELECT`**（`test-f16` ⑨ 静态断言）——MD-06 经 F-10 `createOpportunity`、LNK-03 经 F-10 `linkOpportunityRelation`，**取号与判重也走读面**（`listOpportunities` / `listOpportunityRelations`）。唯一业务 `import` 来自 `../shared-context/index.js`。

**② 「依据足够」的确定性判据（必要条件全满足）**：`real_return`（**拿到真实返回**：`fact.ok` 且 `verified`——不允许以模型预期代替查询结果）＋ `source_traceable`（来源可回查）＋ `not_contradicted`（未倒挂）＋ `six_elements_complete`（六要素**都被评估过**，ADR-003）＋ `title_present`（`opportunity_title` 是 NOT NULL 列）。任缺其一 → **退回缺口记录**（不硬凑）。

**③ 依据不足是合法产出（TC-A-M3-004）**：`outcome='gap'` 时返回**缺口记录**（`scope_checked` 检查范围 + `info_gaps` 信息缺口 + `affected_judgements` 影响哪项判断）且**不写任何表**——「允许本轮不产生新机会」。HTTP 层据此回 **200 而非错误**（缺口不是失败）。缺口**不落表**：schema 无缺口专表，缺口的出处是 `EXT-02.missing_note` 与 `CFG-01.capability_cannot`。

**④ 六要素二态（ADR-003 / Q-05）**：`unknown_item` `NULL`＝未评估（→ 不齐、触发待补）／`''`＝已评估且确无（→ 计入齐全）／文本＝有未知项（→ 亦计入齐全，留待后续核对）；**纯空白串→应用层显式拒**（库级 `NOT NULL` 拦不住空白串）。六要素之外的 `opportunity_title` 单独派生（显式优先，否则取现象、截断 80）。

**⑤ 去重＝「对照已有机会判重」+ 相同问题关联更新**：判重**复用 F-15 五项检查的 `existing_opportunity.matches`**（不另造一套关键词逻辑）；命中 → 仍形成新机会（新现象有独立价值）**并**落 LNK-03「相同问题关联」。**关系方向对齐种子 `LK-OR-002`**：`from`＝已有机会（原机会）、`to`＝新机会，`kind=same_issue`。

**⑥ 止于机会、不下 HVA 判断（PRD-M3 §4 红线 1）**：本文件只产出「机会＋初步依据」或「缺口记录」，**不输出生产动作**、不下 HVA 结论（该项归 M4）。

**⑦ 适用范围未判定不阻断**：目标未声明业务范围时，F-15 五项检查的 `applicability` 记「未知」——本文件把它作为 **caveat**（`caveats.scope_decided=false`）随机会记录一并暴露，**不因此丢弃已成立的证据**，由后续人工节点（F-03）复核。

### 5. F-17 两步衔接（M3 收尾 · 衔接经人工节点、不自动交接）

**① 零写库 + 零裸 SQL + 零外部调用**：`handoff.js` 自己**不含任何 `INSERT`/`UPDATE`/`DELETE`**、**不含 `SELECT`**（`test-f17` ⑧ 静态断言），一律走 `../shared-context/index.js`（读面）与 `../task-runner/proposal.js`（F-03 只读 `listProposals`）。

**② 绝不触发 M4（TC-I-M3-001）**：**不 import `../task-runner/hva.js`**、代码里**不出现 M4 建任务函数名 `createHvaResearchTask`**（⑧ 静态断言）；交接物非空时也只给**入口提示文字**（指向 M1 F-04），不代为启动。`test-f17` ⑤ 以「组装前后 `task` / `hva_research` 行数不变」实测证明。

**③ 人工节点完成判据＝MD-12 真实建议行（不看机会状态）**：`evaluateHandoffGate` 只认「该机会在 `MD-12 research_proposal` 是否有真实行」——**种子 `OPP-012` 状态为 `submitted` 却无建议行**（该表在「有意留空」清单内），若以状态为判据会造成**假通过**；本文件故明确以**建议实行为准**（`test-f17` ② 断言）。

**④ `auto_handoff` 恒 false**：无论守卫是否通过，`auto_handoff` 一律 `false`，并附 `NO_AUTO_HANDOFF_NOTE` 声明——机会 → 研究建议 → HVA 任务之间必须经 PM（BRD §3.1 / §6）。

**⑤ PM 上下文只含机会＋初步依据（PRD-M3 §4 红线 1/3）**：`assemblePmDecisionContext` 输出恒带 `PM_CONTEXT_NOTICE`（「尚不构成 HVA 结论」），不下 HVA 判断、不含生产动作类内容；证据四要素逐一透传，**`linked_at` 只原样带出、不解析为时点**（Q-16 已决①：种子现写真实时点，见 `schema.md` §12）。

**⑥ 反向问 PM 只补要查清的内容**：`collectSupplementRequests` 在六要素不齐 / 未知项未评估 / 无关联证据时列出请补项（含「为何请补」与「请补什么」），**不静默回退、不编造**，也不要求重填已有材料（承接 M1 F-03 口径）。

### 6. F-18 角色指令配置（M4 开局 · 装载与结束条件；**本体归 `agent-runtime/`**）

**① 零写库 + 零裸 SQL + 复用 F-13 读面**：`role.js` 不含任何 `INSERT`/`UPDATE`/`DELETE`、不含 `SELECT`（`test-f18` ⑦ 静态断言）——MD-13/MD-14 一律经 `./profile.js` 的 `getAgentProfile`/`listAgentSkills`/`composeAgentVersionSnapshot`；**MD-13/MD-14 的写入面仍唯一属于 `profile.js`**，本文件不新增写面。运行期零写另有实测：装载前后 `agent_profile`/`skill_registry` 行数不变，fake-db 记录到的语句全为 `SELECT`（⑥ 组）。

**② 不复制第二个口径（回指不重述）**：角色指令与公共业务指令的**叙述文本本体在 `agent-runtime/`**（`hva/agent.md`、`business-rules.md`），`role.js` 只持「段落键 / 指令编号 / 判据键 + 来源回指」；`ROLE_SECTIONS`（5 段）与 `BUSINESS_RULE_IDS`（8 条 `BR-01`~`BR-08`）在 `test-f18` ② 组与本体**逐条对齐断言**——本体改了标题而服务端未跟随，用例立刻失败。版本号同理：不内联，一律从 MD-13 现读（`v1.3`/`r12` 只在断言里与种子比对一致性）。

**③ 结束条件二选一做成确定性判据（PRD-M4 F-18 验收要点）**：`evaluateResearchClosure`——①「有依据的研究回答」须**同时**有回答正文与 `evidence_refs`（无依据不算「有依据」）；②「说明无法完成判断的原因」（`limitation_reason`）**同样是合法结束**（BRD §7 第 4 条精神：不硬做）；③ 二者皆缺 → `closed=false` 并列出 `missing`。这是「角色指令的结束条件」在运行期的**可运行形态**，不是注释。

**④ 两条红线做成判据（而非注释）**：**产品假设不预先作为结论**——`answer_nature='hypothesis'` 时拒绝当研究回答（联动 `labelProductHypothesis`：假设一律 `is_conclusion=false`、`must_verify=true`）；**失败不否定结论**——`answer_stance='unsupport'` 且 `due_to_failure=true` 时拒绝结束并置 `negation_allowed=false`，而**非失败的「未支持」是完整结果**（PRD-M4 F-21 口径）。

**⑤ 输出边界扫描＝硬红线的可运行形式（TC-C-M4-001）**：`FORBIDDEN_PRODUCTION_PATTERNS` 恰 4 项（活动配置 / 权益组合 / 预算 / 排期，取自 PRD-M4 §1.1.2 第 7 条与 BRD §5.2），`scanProductionActions` 返回 `clean`/`hits`（带位置）；HTTP 层据此把「含生产动作」回 **409**。该 oracle 的「七要素结构化 JSON」部分属 A-1 LLM 推理契约，**登记为「门禁未关闭、非发布门禁」**。

**⑥ LLM 门禁边界（明确登记）**：本文件只做**装载与确定性判定**（不推理、不调 LLM）——`TC-C-M4-001` 的推理产出契约受 A-1（LLM ⬜ 未提供）门禁，待 A-1 落实后由 F-19~F-22 补验；`test-f18` 只验结构契约与红线扫描，**demo 值不进断言**。

**⑦ 本体落地（`agent-runtime/` 侧，F-18 一并交付）**：`agent-runtime/business-rules.md`（公共业务指令 8 条）与 `agent-runtime/hva/agent.md`（角色指令五段）由「建壳」升级为「本体」，状态位同步 `agent-runtime/VERSIONS.md` §2.1/§2.2 与 `agent-runtime/README.md`。**实施中发现**：`discovery/agent.md` 仍为建壳（F-13 只落服务端登记、未落本体），**已登记未擅自改**，见 `agent-runtime/README.md` §状态。

### 7. F-19 研究起点处理（M4 · S-B1 路径选择 · 纯编排 + 薄读）

**① 零写库 + 零裸 SQL + 双面复用**：`research-start.js` 不含任何 `INSERT`/`UPDATE`/`DELETE`、不含 `SELECT`（`test-f19` ⑦ 静态断言）；注入清单经 `../shared-context/index.js`（`getTaskContext`/`listResearch`）读面，**假设性质标注复用 F-18 `./role.js` 的 `labelProductHypothesis`**（import 恰 2 条，不复制第二份口径）。MD-12 的写入面仍唯一属于 F-03 `proposal.js`（本文件只读）。

**② 三分支路由是确定性的（TC-A-M4-001）**：优先级从高到低——③ 适合性判定为「不适合」→ `state_limitation`（说明限制而非硬做）；① 有候选行为假设 → `verify_hypothesis`；② 只有研究问题 → `find_candidate`。**停止条件＝路径确定**（S-B1），三条路径一律 `stopped=true`；后续取数归 F-20，本文件不发起任何查询。

**③ 两条红线做成可运行判据（不写在注释里）**：**产品假设不预先作为结论**——假设经 `labelProductHypothesis` 标注（`is_conclusion=false`/`must_verify=true`），输出恒带 `hypothesis_is_conclusion=false`，起点③ 即便带假设也不进结论位，且起点① 计划首步即「检验假设」；**允许找不到有足够依据的候选行为**——起点② 置 `allow_no_candidate=true` 并明示「未找到足够依据支持候选 HVA 也是完整结果」（`complete_result_possible=true`），不把「未支持」当失败（呼应 F-18 的 `evaluateResearchClosure`）。

**④ 适合性判断的 A-1 门禁边界（明确登记）**：「问题是否适合开展 HVA 研究」须语义判断（`external-deps.md` §5 A-1 ⬜ 未提供、§7 T-21 未关）。本文件把它做成**可注入判据**：调用方（或未来的 LLM 适配层）可传 `suitability={suitable,reason,signals}`；**未传时走确定性 fallback**（`suitable=true`/`source='default_no_llm'`）并标 `llm_gated=true`——**不硬造「不适合」也不硬做**。`suitability` 形态非法（非对象 / `suitable` 非布尔）→ 报错，不静默忽略。**TC-I-M4-003 登记为「门禁未关闭、非发布门禁」**（判据已可运行、真实语义判断待 A-1）。

**⑤ 比较条件「能定则定、缺则如实登记」**：三项（涉及哪些用户 / 观察哪个阶段 / 什么结果口径）优先取显式入参，否则分别回落到 `population_limit`／目标版本 `focus_period`／目标版本 `metric_definition`；缺项列入 `missing` 且**不编造、不静默回退**，但**不阻断「路径确定」**（补齐动作在 F-20）。

**⑥ 排查证顺序＝F-20 五查顺序（确定性领域规则）**：`population_comparability(CDP) > temporal_order(HJE) > metric_alignment(口径) > alternative_explanations(PIM/MKT/ACT) > information_sufficiency(汇总)`。`data_sources` 只填**来源系统代号**（与 `CFG-01.source_id` 同域）；**具体工具契约的真源在 `external-deps.md` §5，本文件不内联工具名**（避免第二个口径）。可按来源过滤（不含来源的「口径校验 / 信息充分」两步恒保留）。

**⑦ 薄读口径（不新增写面）**：`loadResearchStartContext` 从 `getTaskContext().sections` 取 CFG-06 `hva_research` 模板的 6 类（goal/background/source/selected_opp/product_question/existing_evidence），历史研究另按机会现读 MD-07；**不手工拼任务行**（`test-f19` ④ 的夹具走 F-03 + F-04 真实调用链）。

### 8. F-20 人群比较与行为关系检验（M4 · S-B2/S-B3 · 最脆弱功能点）

**① 双文件拆分：编排零写、写面单独成文件**：`behavior-store.js` 是 **MD-09/MD-10 唯一写入面**（本模块第二个写面，与 F-13 `profile.js` 并列）；`behavior.js` 为编排层，**零写语句、零裸 SQL**（`test-f20` ⑧ 静态断言）——落库一律经 `behavior-store.js`，**取号也不写 `SELECT MAX`**（用该文件的读面返回全量自己算库内最大 +1）。拆分的第一目的：扩写面时不去动既有 oracle。

**② 五查键序与文案**：`BEHAVIOR_CHECK_KEYS` 由 **F-19 `RESEARCH_CHECK_SEQUENCE` 派生**（`RESEARCH_CHECK_SEQUENCE.map(s => s.check_key)`）——**不复制第二份键表**；`test-f20` ③ 断言两者逐条相等。五查 = ① 人群可比基础 ② 先后关系 ③ 口径一致 ④ 其他解释 ⑤ 信息充分。

**③ 四条红线做成判据（不写在注释里）**：
- **因果不臆断**（PRD-M4 §4 红线 3）：`causal_claim_allowed` **恒 false**，即便五查全通过也只输出「存在关联」；`status_reason` 明示「仍属候选」。
- **活动存在 ≠ 用户参与**（BRD §4 F-20 验收）：其他解释的 `evidence_kind='existence_only'`（如活动报名清单）**不计为已排除**；`evidence_kind='none'`（无参与明细，对应 TOL-12 ❌ 不存在）同样不得据此排除；**未排查的维度记 `not_checked` 且不默认无关**——只有 `participation`（参与侧记录）才能排除。
- **未支持也是完整结果**：`not_supported` 时 `complete_result=true`、`is_failure=false`，仍写 MD-09（状态列）与不支持条目（PRD-M4 F-21）。
- **失败不否定结论**（BRD §7 第 4 条）：`due_to_failure` 的条目 `usable_as_negation=false`、**不落库为不支持条目**、转信息缺口登记（`gap_key='due_to_failure'`），`negation_allowed=false`。

**④ 倒挂隔离复用 F-15**：条目的信息时点晚于取数时刻 → **仅该条失效**（`isolateContradictedEvidence`，`isolate_reason='info_time_point_after_fetch'`）、其余照常参与、`batch_failed=false`（TC-A-M4-003 与 TC-A-M3-006 同语义，故**不重写一份**）。条目身份用 `point_id`、缺失时以序号兜底（`point_ref`），保证「仅该条失效」可逐条核对。

**⑤ 入池筛选（TC-U-M4-001）与缺条件守卫（TC-A-M4-006）**：`judgePoolThreshold` 取**闭区间**（`composite_raw ≥ pool_threshold` 入池）、确定性无随机、`pool_threshold` **不隐式取默认**；不传入池两参则**不预筛**（调用方已筛）。`evaluateComparisonGate` 复用 **F-19 `resolveComparisonConditions`**（比较条件三项口径唯一），缺项或 `materials_available=false` → `action='request_supplement'` + **`draft=null`** + 逐项理由 + 指引，**不静默回退、不编造**。守卫在编排里**优先于五查**，且退回与未入池**都不写库**。

**⑥ 经 M5 只读查询（TC-I-M4-002）**：`queryForBehaviorCheck` 是 F-20 唯一取数出口，**委托 F-15 `runMetricVerification`**（其内部经 M5 `runQueryWithRecovery`：重试 + 落 EXT-01 + 失败/受限处置任务态）——`test-f20` ⑦ 以「哨兵串不进事实」「无授权 transport 零调用」「EXT-01 由 M5 落痕」实测。`check_key` 若提供须属五查键（不静默忽略）。**本模块因此不直连 `tool-executor`**（外部访问只经 F-15 出口）。

**⑦ 门禁边界（明确登记）**：本文件**不调 LLM**——「差异是否已解释」「问题语义」这类判断受 **A-1（LLM ⬜ 未提供）** 与 **T-03（历史深度未定）/ T-08（活动参与明细是否确缺）/ T-10（最小样本与截断）** 门禁：`checkPopulationComparability` 的语义结论做成**可注入判据**（`comparability={comparable,reason,signals}`），未注入时按差异清单的 `explained` 标记做**确定性推导**，**推导不出就记「无法明确」并限制判断，不硬下结论**。`test-f20` 只验结构契约与判据，**demo 值不进断言**；TC-A-M4-002 / TC-A-M4-003 的 ⚠️待确认维度登记为「门禁未关闭、非发布门禁」（`external-deps.md` §2 五系统缺口：CDP/HJE 仅聚合无用户级明细、ACT 仅有报名信息无参与明细）。

### 9. F-21 研究结果生成（M4 · S-B4 七要素组装 · 编排零 SQL）

**① 双文件拆分延续「写面单独成文件」**：`result-store.js` 是 **MD-07 内容填充 + MD-08 / MD-11 唯一写入面**（本模块第三个写面）；`result.js` 为编排层，**零 SQL 语句**（`test-f21` ⑧ 静态断言，含读语句）——读写一律经 `./result-store.js`、`./behavior-store.js`、`../shared-context/index.js` 的既有面，**取号也不写 `SELECT MAX`**（用读面返回的全量自己算库内最大 +1，`Math.max` 只用于编号计算、不是 SQL）。

**② MD-07 的「建行 / 填充」分工（不复制第二份口径）**：**建行**归 F-11 `../shared-context/index.js#createResearch`（追问壳归 F-05 `../task-runner/followup.js`）；F-21 只做**内容填充**——`updateResearchReport` 只改 6 个正文 / 状态列，**绝不触碰** `research_no`/`opportunity_id`/`goal_id`/`goal_version_no`/`parent_research_no`/`start_task_id`（启动快照与追问链不因出报告而变，`test-f21` ⑦ 逐字核对）。**TC-D-M4-001** 的 MD-07 外键反例即在此建行面上复现。

**③ 七要素是真源常量，不是散落字符串**：`RESULT_ELEMENTS` 持「序号 + 键 + 条目名 + 落库回指」，`ELEMENT_KEYS` 由它**派生**；`test-f21` ① 读 `test-M4.md` TC-C-M4-001 **抽七要素名并逐条相等断言**——上游改了说法而本文件未跟随，用例立刻红。

**④ 硬红线做成判据（不写在注释里）**：**输出不含生产动作**——`scanResultBoundary` 逐字段扫七要素正文，禁词表**复用 F-18 `FORBIDDEN_PRODUCTION_PATTERNS`**（唯一口径）；命中即 `clean=false` 且回指字段与位置，HTTP 层 **409** 且**拒绝落库**。**`out_of_scope_note` 不被扫描**——它本身就是「活动配置 / 权益组合 / 预算与排期不在结论范围内」的声明，扫它必然误报（该豁免在 ② 组有显式反例断言）。

**⑤ 「未支持亦是完整结果」与「失败不否定」分开表达**：`complete_result` **只由七要素是否齐全决定**（未找到候选行为、候选行为未获支持都不影响）；失败导致的否定另由 `negation_allowed=false` + `degraded=true` + `warnings` 表达——`due_to_failure` 的发现**不进 ③**、转 `due_to_failure` 缺口，报告照常保存（BRD §7 第 4 条）。**合法反例**同时保留：非失败的「未支持」照常进 ③ 且 `negation_allowed=true`。

**⑥ 逐发现挂证据与逐项对应**：每条发现的 `evidence_refs` 随条目保留，落库时经 **F-11 `linkFindingEvidence`** 逐条写 `LNK-02`（**该表唯一写入面不在本模块**）；**无证据的发现记 `finding_without_evidence` 缺口**（如实登记、不编造）。改善方向须带 `related_finding_ref` 命中某条发现（`F-00x` / `#n` / 数字），否则 `orphans`/`malformed` 非空 → **整批不落库**；该字段是**组装期校验字段**，MD-11 无此列，对应关系由 `reason_why` 正文承载（schema 口径「为什么值得改善：与哪项发现对应」）。

**⑦ 落库前置守卫（防半截状态）**：`saveResearchReport` 在动笔前依次判——边界合规 → 对应性 → 七要素齐备 → 研究存在（404）→ **该研究未出过报告**（MD-08/MD-11 已有行即 `already_reported`，对齐 MD-07 表注「追问不覆盖原研究」）。五路任一不过**一行未写**（`test-f21` ⑦ 以行数不变实测）。

**⑧ 门禁边界（明确登记）**：本文件**不调 LLM**——「七要素正文怎么写」属 A-1（LLM ⬜ 未提供）推理产出契约。本文件交付的是**可运行的七要素结构契约 + 边界扫描 + 组装与落库判据**；`TC-C-M4-001` 的推理产出部分与 `TC-A-M4-005` 的 ⚠️待确认(§7-T06) 维度登记为「门禁未关闭、非发布门禁」，**demo 值不进断言**。

### 10. F-22 继续追问承接（M4 · 收尾 · 零写只读承接）

**① 本体零写只读（含跨模块只读面首次落地）**：`followup-intake.js` **零写语句、零裸 SQL、零外部调用、不调 LLM**（`test-f22` ⑧ 静态断言）——承接已有研究上的新问题、检查既有依据是否仍适用、给出版本口径、交出下一轮入口，**全程不落任何行**（`test-f22` ③ 以 7 张表行数 + `research`/`task`/`research_finding` 逐行不变实测）。与 F-19~F-21「各管一段写面」不同，F-22 是**纯读面编排器**：跨模块只读面经 **M1 `../task-runner/step-plan.js#getTask`**（PD-01 任务版本与父任务）与 **M2 `../shared-context/index.js`**（研究 / 追问链 `getResearchLineage` / 证据）——**本模块首次经 `../task-runner` 读任务态**（此前只由 `../api/index.js` 消费目录内模块），该依赖是阶段4 dev-plan「把真 Agent 接进 M1 的调度回路」的落点，**只读不写、不新增写面**。

**② 依据复用判定三态（未决 ≠ 沿用）**：`assessEvidenceReuse` 对既有依据逐条判「沿用 or 补查」——`reuse` / `supplement` / `undetermined`。**未声明任何变化的依据不变更**（默认沿用，`{}` → 全部沿用）；**声明了变化但无法判定是否仍适用 → `undetermined` 且 `llm_gated=true`，既不沿用也不补查**（不硬猜、不静默沿用、不默认失效）。三维度 `CHANGE_DIMENSIONS`＝时间范围 / 查询条件 / 适用范围；四态 `SCOPE_RELATIONS`（相同 / 更窄 / 更宽 / 未声明）；三档 `REUSE_SEVERITIES`。

**③ 保守方向优先（更窄沿用、更宽或无法判定一律补查）**：适用范围**更窄仍适用**（`scope_narrowed_still_applicable`——范围收窄不使既有依据失效）；**更宽 / 未声明关系 / 无法解析**一律计入补查（宁可多查、不漏查）；`parseCoverage` 从 `EXT-02.info_time_point` 抽「取数时点 + 覆盖区间」，**抽不到即 `coverage=null` 不猜**，相应依据保守计入补查。

**④ 原结果与原研究逐字节保留、不否定原结论**：`intakeFollowup` 在承接前后对原研究（七要素 + 发现逐条带证据回指 + 改善方向 + 依据全字段）取快照并**逐字节比对**（运行期自检 `original_preserved` 恒 true）；`negates_original_conclusion` **恒 false**——追问**不否定、不覆盖**原研究结论（对齐 MD-07 表注「追问不覆盖原研究」，与 F-21 ⑦「该研究未出过报告」守卫互为正反面）。

**⑤ 版本口径：原任务与原研究钉在启动版本**：`assessVersionPinning` 判「追问是否需落新版本」——追问**可**落新版本，但**原任务与原研究始终钉在启动时的版本**（`test-f22` ⑤ 实测本轮追问升 v4 而原研究仍 v3、逐字未变）；**声明范围变更而未升版 → `new_version_required=true`**（提示需升版），**建版本行归 M1 F-01**（本步不建、不改写 MD-02 行）。

**⑥ 一轮承接 → 下一轮入口（S-B1）**：`assembleNextRound` 交出「新一轮入口」——`entry='S-B1'`、`chain=F-19>F-20>F-21`、`check_sequence_keys` **派生自 F-19 `RESEARCH_CHECK_SEQUENCE`**（不复制第二份键表）、比较条件**复用 F-19 `resolveComparisonConditions` 口径**（能定则定、缺项如实登记、不编造）。追问链经 M2 `getResearchLineage` 呈现（`ancestors` / `descendants`），使「新问题挂在旧研究上」可追溯。

**⑦ 追问越界只提示不拦截**：追问文本含生产动作禁词（活动配置 / 权益组合 / 预算 / 排期）→ **提示命中项**（口径项数**复用 F-18 `FORBIDDEN_PRODUCTION_PATTERNS`**，不在本文件重定义）且**不拦截提问**——追问是用户输入、不是产出，故与 F-21 对产出正文的 **409 拒绝**不同。

**⑧ 下游派发可控（可注入端口）**：把新一轮交给调度的动作做成**可注入 `dispatch` 端口**——**未注入即不触发**（`reason='not_injected'`，不重复发 Queue 消息），注入则**恰调用一次**且载荷带入口 / 链 / 追问任务与新研究编号。

**⑨ 入口守卫（防把普通任务当追问）**：缺 `task_id` / 任务不存在 / **非 `hva_followup` 任务** / 原研究不存在 / **既无研究行又未给原研究编号 → 无法解析** 五路**前置拒**（`test-f22` ⑦ 五路）；薄读 `loadFollowupIntakeContext` 对不存在任务返回 `null`。

**⑩ 门禁边界（明确登记）**：「新问题是否仍落在原研究口径内」「既有依据是否仍适用」的部分判断属语义判断，受 **A-1（LLM ⬜ 未提供）** 门禁：本文件把**可确定性判定**的部分做全（时间范围 / 查询条件 / 适用范围三类可获得客观比对），**未声明变更一律 `undetermined` 并标 `llm_gated=true`**——不硬猜、不静默沿用。`TC-I-M4-001` 的语义判定部分登记为「门禁未关闭、非发布门禁」，**demo 值不进断言**。

## 反向清单

- **下游（我被谁引用）**：`../api/index.js`（**F-13 / F-14 / F-15 / F-16 / F-17 / F-18 / F-19 / F-20 / F-21 / F-22 路由**）｜阶段4 `../agent-orchestrator` 后续 F-18~F-22（消费 `getAgentProfile` / `composeAgentVersionSnapshot` 装配运行期上下文；`discovery.js` 的 `loadDiscoveryContext` 供 F-15 复用注入清单；`verification.js` 的 `verifyClueAndDraftEvidence`/`buildEvidenceDraft` 供 **F-16 机会形成与去重**消费「查证结果 → 机会或缺口记录」；**F-17 两步衔接**消费 `opportunity.js` 产出的机会记录（经 MD-06 读面）组装 PM 决策上下文，并交出「供 M1 F-04 消费」的输入前提）｜`../task-runner`（F-02 发现任务、F-06 任务态冻结版本快照）复用 `composeAgentVersionSnapshot`；**F-17 反向引用** `../task-runner/proposal.js` 的只读 `listProposals`（人工节点产物）
- **上游（我引用谁）**：`../../db`（DDL/种子，MD-13/MD-14/MD-06/MD-12 真源）｜`discovery.js` 引用 `../shared-context/index.js`（读面：`getTaskContext`/`getResearch`）｜`verification.js` 引用 `../tool-executor/index.js`（**M5**：`runQueryWithRecovery` / `RETRY_OUTCOME`）与 `../shared-context/index.js`（读面 `listOpportunities` + **F-09 写入面** `createEvidence`/`validateEvidenceCompleteness`）｜`opportunity.js` 引用 `../shared-context/index.js`（**F-10 写入面** `createOpportunity`/`linkOpportunityRelation` + 读面 `listOpportunities`/`listOpportunityRelations` + 纯函数 `assessOpportunitySixElements`）｜`handoff.js` 引用 `../shared-context/index.js`（读面 `getOpportunity`/`listEvidenceByOpportunity`/`getEvidence` + 纯函数 `assessOpportunitySixElements`/`UNKNOWN_ITEM_STATES`）与 `../task-runner/proposal.js`（**F-03 只读** `listProposals`）｜`role.js` 引用 `./profile.js`（**F-13 读面**：`getAgentProfile`/`listAgentSkills`/`composeAgentVersionSnapshot`；**不新增写面**）｜`role.js` 的叙述文本回指 `../../agent-runtime/business-rules.md` 与 `../../agent-runtime/hva/agent.md`（本体，**不被 import**、只在 `test-f18` ② 组做逐条对齐断言）｜`research-start.js` 引用 `./role.js`（**F-18 复用**：`labelProductHypothesis`——假设「不预设结论」的唯一口径）与 `../shared-context/index.js`（读面：`getTaskContext`/`listResearch`）；其比较条件三项与五查顺序只持键名 + 来源回指，叙述文本真源在 `PRD-M4` 与 `external-deps.md` §5｜`behavior-store.js` 引用 `../../db`（MD-09/MD-10 真源，**零 import**、只依赖注入的 `db`）｜`behavior.js` 引用 `./behavior-store.js`（**F-20 写入面**：`createCandidateBehavior`/`appendBehaviorPoint`/`listCandidateBehaviors`/`listBehaviorPoints`）、`./verification.js`（**F-15 复用**：`runMetricVerification` 经 M5 的唯一查询出口、`isolateContradictedEvidence` 倒挂口径、`parseStamp` 时点抽取）与 `./research-start.js`（**F-19 复用**：`RESEARCH_CHECK_SEQUENCE` 五查顺序 + `resolveComparisonConditions` 比较条件口径）；五查条目文案与比较条件三项**均不复制第二份**｜**`result-store.js`** 引用 `../../db`（MD-07/MD-08/MD-11 真源，**零 import**、只依赖注入的 `db`）；**`result.js`** 引用 `./result-store.js`（**F-21 写入面**：`createResearchFinding`/`createImprovementAction`/`updateResearchReport`/`listFindings`/`listImprovementActions`/`listFindingEvidenceLinks`）、`./role.js`（**F-18 复用**：`scanProductionActions` + `FORBIDDEN_PRODUCTION_PATTERNS`——输出边界禁词唯一口径）、`./behavior.js`（**F-20 复用**：`BEHAVIOR_POINT_TYPE` 支持 / 不支持两态键名）、`./behavior-store.js`（**F-20 读面**：⑤ 候选行为及支持情况的真源）与 `../shared-context/index.js`（**F-11 复用**：MD-07 读面 `getResearch` + **LNK-02 唯一写入面** `linkFindingEvidence`）；七要素条目名、禁词表、候选行为口径**均不复制第二份**｜**`followup-intake.js`** 引用 `./result.js`（**F-21 读面**：`loadResearchResultContext`——原结果七要素回带）、`./role.js`（**F-18 复用**：`FORBIDDEN_PRODUCTION_PATTERNS` + `scanProductionActions`——追问越界提示的唯一禁词口径）、`./research-start.js`（**F-19 复用**：`RESEARCH_CHECK_SEQUENCE` 派生下一轮五查键 + `resolveComparisonConditions` 比较条件口径）、`./verification.js`（**F-15 复用**：`parseStamp` 抽取数时点，判依据时间覆盖）、`../shared-context/index.js`（**M2 读面**：`getResearch`/`getResearchLineage`/`getEvidence`/`listResearch`/`listEvidenceByFinding`——原研究、追问链、依据）与 **`../task-runner/step-plan.js`**（**M1 读面**：`getTask` 取任务版本与父任务——**本模块首次经 `../task-runner` 读任务态**，只读不写）；六条 import **全为既有读面**，三态判定 / 版本口径 / 下一轮入口**均不复制第二份**
- **文件间引用（本目录内）**：`profile.js` 为底层写面，被 `../api/index.js` 与后续 F-18~F-22 消费；`discovery.js` 为 F-14 纯编排层（零写库），本目录内不被其它文件 import（由 `../api/index.js` 消费）；`verification.js` 为 F-15 编排层（**零自有写语句**），同样只由 `../api/index.js` 消费、不被本目录其它文件 import；`opportunity.js` 为 F-16 编排层（**零自有写语句、零裸 SQL**），同样只由 `../api/index.js` 消费；`handoff.js` 为 F-17 衔接编排层（**零写库、零裸 SQL、绝不触发 M4**），同样只由 `../api/index.js` 消费、不被本目录其它文件 import；`role.js` 为 F-18 装载与判定层（**零写库、零裸 SQL**，**唯一 import 为 `./profile.js` 读面**），同样只由 `../api/index.js` 消费、不被本目录其它文件 import；`research-start.js` 为 F-19 起点编排层（**零写库、零裸 SQL**，import 恰 2 条＝`./role.js`（F-18 假设标注口径）＋`../shared-context/index.js`（读面）），同样只由 `../api/index.js` 消费、不被本目录其它文件 import；**`behavior-store.js` 为 F-20 写入面**（MD-09/MD-10 **唯一写入面**，**零 import**），被 `./behavior.js` 与 F-21 `./result.js` 复用（七要素 ⑤「候选 HVA 及支持情况」读面）；**`behavior.js` 为 F-20 编排层**（**零写语句、零裸 SQL**，import 恰 3 条＝`./behavior-store.js` 写面 ＋ `./verification.js`（F-15：经 M5 查询与倒挂口径）＋ `./research-start.js`（F-19：五查顺序与比较条件））——`./verification.js` 因此**首次被本目录其它文件 import**（此前只由 `../api/index.js` 消费），该依赖是 F-20「经 M5 只读查询」的落点，非旁路；**`result-store.js` 为 F-21 写入面**（MD-07 内容填充 + MD-08/MD-11 **唯一写入面**，**零 import**），被 `./result.js` 与 CI 复用；**`result.js` 为 F-21 编排层**（**零 SQL 语句**，import 恰 5 条＝`./result-store.js`（写面）＋`./role.js`（F-18 禁词唯一口径）＋`./behavior.js`（F-20 两态键名）＋`./behavior-store.js`（F-20 读面）＋`../shared-context/index.js`（F-11：MD-07 读面 + LNK-02 写入面））——`./behavior.js` 因此**首次被本目录其它文件 import**，该依赖只是取 F-20 的两态键名常量，不复制其判定逻辑；**`followup-intake.js` 为 F-22 承接编排层**（**零写语句、零裸 SQL、零外部调用、不调 LLM**，import 恰 6 条＝`./result.js`（F-21 读面）＋`./role.js`（F-18 禁词口径）＋`./research-start.js`（F-19 五查键与比较条件）＋`./verification.js`（F-15 抽时点）＋`../shared-context/index.js`（M2 读面）＋`../task-runner/step-plan.js`（M1 读面：任务版本与父任务））——`./result.js` 因此**首次被本目录其它文件 import**（此前只由 `../api/index.js` 消费），该依赖只是回带原结果七要素，**不复制其落库逻辑**；`test-f13.mjs`/`test-f14.mjs`/`test-f15.mjs`/`test-f16.mjs`/`test-f17.mjs`/`test-f18.mjs`/`test-f19.mjs`/`test-f20.mjs`/`test-f21.mjs`/`test-f22.mjs` 仅用作 CI 验证，不进运行期

## 种子基线（本模块相关，只读参照）

`agent_profile` 2 行（`AGP-DISC`/`AGP-HVA`）、`skill_registry` 2 行（`S-A1`/`S-B1`）已由 `db/seed/0001_mock.sql` 落库，本模块运行期只改行（版本推进）、不增删基线行（新增 Skill 经 `registerSkill` 走业务写入面，非种子）。

**F-15 额外只读参照**（不属本模块写入面、运行期以只读消费）：`gap_rule` 4 行（`GAP-1`~`GAP-4`，口径规则真源，F-15 的「信息缺口」检查逐条读它）、`opportunity` 8 行（「已有机会」比对读它）、`evidence` 7 行（EXT-02，回查链验证用）。F-15 **不新增种子行**：证据由 F-09 写入面按业务写入（`test-f15` ⑤ 落 `EV-9001` 后回查）。

**F-16 额外只读参照 / 基线推进**：`opportunity` 8 行（`OPP-005`~`OPP-014`，判重比对与取号基准读它）、`opportunity_relation` 2 行（`LK-OR-001` `superseded` / `LK-OR-002` `same_issue`，**F-16 的 `same_issue` 方向口径以其为准**）。F-16 **不新增种子行**：机会与关系均由 F-10 写入面按业务写入（`test-f16` ①/⑤ 落 `OPP-015`/`OPP-016` + `LK-OR-003` 后回查）；种子 `opportunity` 的 `unknown_item` **全部非空**（原型只呈现「有未知项」一态），二态中的 `NULL`/`''` 由 ADR-003 补齐、由 F-16 判定与写入侧承担。

**F-17 额外只读参照**（不属本模块写入面、运行期以只读消费）：`opportunity` 8 行（PM 决策上下文与守卫的目标对象）、`opportunity_evidence` **10 行**（`LK-OE-001`~`LK-OE-010`，**初步依据四要素的来源**）、`evidence` 7 行（EXT-02，四要素明细）。**`research_proposal` 种子 0 行**（该表在「有意留空」清单内）——故种子机会 `OPP-012`/`OPP-010` 虽标 `submitted` 却**无建议行**，这正是 F-17「人工节点完成判据＝MD-12 实行为准（不看状态）」的由来；`test-f17` 用 F-03 `submitProposal` 现场造建议（不新增种子行）。另登记 **`schema.md` §12 Q-16**：`opportunity_evidence.linked_at` 种子值为产出任务 ID（`'T-1022'` 等）与该列 `datetime`「关联建立时点」定义不符，F-17 按「只透传不解析」推进、**未擅自改种子**。

**F-19 额外只读参照**（不属本模块写入面、运行期以只读消费）：`research_goal_version`（MD-02，比较条件里的关注时段与指标口径来源）、`opportunity` 8 行（MD-06，机会及版本）、`opportunity_evidence` 10 行（LNK-01，证据条数）、`research` 2 行（MD-07，历史研究）。**`research_proposal` 种子仍 0 行**（「有意留空」清单）——`test-f19` 的夹具同 F-17/F-04 口径：用 F-03 `submitProposal` 造建议、再用 F-04 `createHvaResearchTask` 造任务链（**不新增种子行**）。
**F-20 额外只读参照 / 基线推进**：`candidate_behavior` 种子 **2 行**（`CB-001` 属 `R-007` `candidate_supported`、`CB-002` 属 `R-006` `not_supported`——两态齐备，正对本模块「支持 / 未支持都成立」）、`behavior_point` 种子 **10 行**（`BP-001`~`BP-010`，支持 3＋不支持 3＋支持 1＋不支持 3；`(candidate_id, point_type, order_no)` 元组已用尽 → **新增条目取号必须从库内最大 +1**）、`research` 2 行（`R-007`/`R-006`，候选行为的研究归属来源）、`gap_rule` 4 行（CFG-05，五查⑤缺口口径）。**F-20 新增行由写入面按业务写入**（`test-f20` ⑤ 落 `CB-003` + `BP-011`/`BP-012`/`BP-013` 后回查），**不新增种子行**；`test-f20` 的夹具同 F-19 口径（F-03 建议 + F-04 任务链，**不手工拼任务行**）。另：`MD-08 research_finding` 的写入**不属 F-20**（其 L3 oracle 归 F-21），本模块只经 `../shared-context/index.js` 的 `listResearchFindings` 只读消费。

**F-21 额外只读参照 / 基线推进**：`research` 2 行（`R-007`/`R-006`，**均 `done`**——含七要素 ①②④⑥ 正文与 `out_of_scope_note`，是 F-21 报告回查的现成样本）、`research_finding` 6 行（`F-001`~`F-006`，`UK(research_no, order_no)` 已被 `R-007` 用满 1~4、`R-006` 用满 1~2 → **新增发现取号必须从库内最大 +1**）、`improvement_action` 4 行（`AC-001`~`AC-004`，同理）、`finding_evidence` 8 行（`LK-FE-001`~`LK-FE-008`）、`candidate_behavior` 2 行 + `behavior_point` 10 行（七要素 ⑤ 的真源，经 F-20 读面只读）、`evidence` 7 行（`evidence_refs` 指向的实际证据）。**F-21 新增行由写入面按业务写入**（`test-f21` ⑦ 落 `F-007`~`F-009` + `AC-005`~`AC-007` + `LK-FE-009`~`LK-FE-012` 后回查），**不新增种子行**；`test-f21` 的夹具同 F-19/F-20 口径（F-03 建议 + F-04 任务链，**不手工拼任务行**），另用 **F-11 `createResearch`** 建「待出报告的研究壳」——**MD-07 的建行面属 F-11，F-21 只做内容填充**（`TC-D-M4-001` 的外键反例即在该建行面上复现，见 ⑥ 组）。

**F-22 额外只读参照（不属本模块写入面、运行期以只读消费）**：`task`（PD-01——追问任务 `T-1023`（`hva_followup`）、任务版本与父任务，经 M1 `../task-runner/step-plan.js#getTask`）、`research`（被追问的「原研究」`R-007`）、`research_finding` 6 行 / `improvement_action` 4 行 / `finding_evidence` 8 行（原结果回带，经 F-21 `loadResearchResultContext` 与 M2 读面）、`evidence` 7 行（EXT-02，依据时间覆盖的抽取对象）、`followup_message`（PD-07，追问链 `getResearchLineage` 的链路来源）。**F-22 不新增种子行、运行期一行未写**——`test-f22` 以 7 张表行数 + `research`/`task`/`research_finding` 逐行不变实测；夹具两路：其一即**种子原型真实剧本**（`T-1023` + 显式 `R-007`，**不造任何行**），其二走 **M1 F-05 真实调用链**（F-03→F-04→F-11→F-21 造 `done` 原研究 → F-05 `createFollowupTask` 造追问任务与带 `parent_research_no` 的研究壳，**不手工拼行**）。
