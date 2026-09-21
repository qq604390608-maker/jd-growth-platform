# task-runner · M1 平台任务程序（server/task-runner）

> 文档卡（阶段3 · M1 · 2026-09-19）
> 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径）
> ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md`（F-01~F-06 验收要点）
> ｜ `../../docs/01-brd/BRD.md` §3.1 流程主线｜§4 F-01~F-06（**含 F-06 受阻处理矩阵与状态流两张表，须逐条实现**）｜§5.3 硬红线｜§7 验收总则（**第 4 条：运行失败不作为否定研究的依据**）
> ｜ `../../docs/03-locks/schema.md`（MD-01/02/03｜MD-06 `opportunity`（机会版本，供 F-03 绑定）｜MD-12 `research_proposal`｜PD-01/02/03/04/05/06/07｜LNK-04 `task_object`｜CFG-04 `run_policy`｜CFG-05 `gap_rule`｜CFG-06 `context_template`｜§12 Q-13/Q-14）
> ｜ `../../docs/03-locks/tech-stack.md` §2.4（Cron Triggers + Queues + 自建状态机；**消息只带 `task_id` + `step_no`**，上下文从 D1 现读）｜§4.2（Cron 最小粒度 1 分钟、账号 Triggers 上限 250；Queues `max_retries` ≤ 100；单步 ≤ 15 分钟）
> ｜ `../../docs/03-locks/external-deps.md`（本模块**不直接调外部**，查询经 `../tool-executor`）
> ｜ `../../docs/04-plan/dev-plan.md`（阶段 3 · M1：目标与口径版本化 / 两阶段任务调度 / 人工节点 / 追问与版本派生 / 任务记录与异常恢复）
> ｜ `../../docs/05-test-cases/test-M1.md`（TC-U-M1-001/002｜TC-D-M1-001~008｜TC-I-M1-001~006）
> ｜ **M4 接线（F-33）另加**：`../../docs/02-prd/PRD-M4-HVA分析Agent.md`｜`../../docs/05-test-cases/test-M4.md`（TC-A-M4-001/003/004/005｜TC-I-M4-002）｜`../../docs/04-plan/full-flow-wiring-plan.md`（**F-33~F-36 的编号与范围依据**）
> ｜ `../../prototype/pages/tasks.html`（**`TYPE_STEPS` 钉死需求**）｜`../../prototype/assets/data.js`（**`gapRules`/`checkGaps` 钉死需求**）｜`../../prototype/pages/goal.html`｜`../../prototype/pages/propose.html`（**F-29 页：研究问题检查三条提示、幂等键四字段、「只补问题不重填材料」、拒空问题——钉死需求**）
> ｜ `../../docs/07-decisions/ADR-001-业务背景不与目标版本联动.md`（目标版本只由六要素驱动）
> ｜ `../../db/migrations/0001_init.sql`｜`../../db/seed/0001_mock.sql`
>
> 职责：M1 的**组织者 / 调度层** + **阶段4 的两种执行体宿主**。目标与口径版本化（F-01）、两阶段任务调度（F-02 / F-04）、
> 人工节点研究建议（F-03）、追问与版本派生（F-05）、任务记录与异常恢复（F-06）；阶段4 接线后另承载
> **M3 发现执行体**（`./executor.js` `runDiscoveryStep`）与 **M4 研究执行体**（`./research.js` `runResearchStep`，F-33）。
> **自身不做研究判断**，只做确定性的调度、存储与状态流转；查询一律经 `../tool-executor`。
> 边界：本模块**不调外部接口**（无 `fetch`、无 URL——可由静态扫描验证）；`EXT-01` 的落痕由
> `../tool-executor` 承担，本模块只**聚合**其记录；任务态跃迁、受阻留痕、已完成部分的写入面
> **不在本目录**，在 `../tool-executor/task-state.js`（F-26 已落地，本目录 `import` 复用而非重写）。
> **M4 执行体（F-33）同理零自有写入面**：`MD-09`/`MD-10` 归 F-20 `behavior-store.js`、`MD-07` 内容填充 / `MD-08` / `MD-11`
> 归 F-21 `result-store.js`、`EXT-02` 归 F-09、`PD-02/03` 归 `./step-plan.js` 与 `task-state.js`——`./research.js` 只编排，
> **零裸 SQL、零自有写语句**（可由静态扫描验证）。

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `index.js` | **TS-20 runner Worker 入口薄壳**（`wrangler.runner.toml` 的 `main`）：`runDueDiscoveryCalls` 到期轮询（active 目标 → 生效策略 → PD-01 推导 last_run → 最小间隔近似判定，**Q-17** 登记）+ `scheduled` = **一个 tick 三相位**（顺序真源 `TICK_PHASES`：`runDueDiscoveryCalls` → `runSelfHealScan`（自愈补扫，F-33）→ `runPendingWork`（按 `WIRED_TASK_TYPES` 扫描 active 步骤自驱动）），**三相位各自异常隔离**（F-36：本体 `runTick`；失败如实回报 `phases.<相位>.{ok,why}` 并呼叫 `onError`，**不静默吞错**；**顺序刻意不重排**以维持「本轮新建 / 补回的 active 步在同一 tick 被消费」的流水线）+ default export `{ scheduled, queue }`（queue 消费 `{task_id, step_no}`：**已接线类型（discovery / hva_research）→ `executor.js` 的 `runStepMessage` 真实执行体；其余类型（`hva_followup` / `goal_check`）→ `delegateToAgent` 契约占位**） | ✅ 已建 2026-09-19（**2026-09-21 F-33 接线**：queue 路由改按 `WIRED_TASK_TYPES` 分派、cron 增自愈补扫；**2026-09-21 F-36**：`scheduled` 退化为一行薄壳 + 抽出三相位异常隔离本体 `runTick`，`test-f36.mjs` **45 断言全绿**；`test-ts20.mjs` 15 断言全绿） |
| `executor.js` | **阶段4 执行体分派与驱动器**：`runStepMessage` **按 `task.task_type` 分派**——`hva_research` → `./research.js` 的 `runResearchStep`（M4 五步），`discovery` → `runDiscoveryStep`（M3 五步：① 载入目标与时间窗 ② 规划采集范围（F-14）③ 采集入口与流量（**真实查询**经 `../tool-executor`：CDP/HJE/MKT/ACT 四源，失败按 **F-26** `handleQueryFailure` 处置、任务非 running 即停手）④ 识别与聚合线索（F-14 / EXT-01 确定性重算）⑤ 生成机会候选（F-16：依据足够落 **MD-06**、不足记缺口））；`runStepMessage` 统一负责步骤跃迁（当前步落 done + 推进下一步 + 任务完成落 done）；`runPendingWork` 供 cron 按 **`WIRED_TASK_TYPES`** 选取自驱动（`runPendingDiscoveryWork` 保留为别名）。证据落 **EXT-02**（证据号 `EV-<query_id>`，F-09 不自动取号） | ✅ 已建 2026-09-21（`test-stage4.mjs` 45 断言全绿；**F-33 增按类型分派与 `runPendingWork` 全类型选取**；工具码映射订正同步 `../agent-orchestrator/discovery.js` 4 处） |
| `research.js` | **F-33 M4 执行体（研究任务五步接线本体）**：`runResearchStep` 按 `hva_research` 五步执行（零自有写语句、零裸 SQL；步号/判据入参形态越界与非法**在 try 外直接抛错**——程序性错误不落 `PD-02`/`PD-03`）：① `loadStartAndPlan`（F-19 研究起点三分支，**只读**）② `collectEvidence`（F-20 `queryForBehaviorCheck` **经 M5** → F-15 `verifyFiveChecks` + `buildEvidenceDraft` + `recordVerificationEvidence` 落 EXT-02）③ `resolveAnalysisInput` ▸ F-20 `formCandidateBehavior`（**MD-09/MD-10 经 F-20 写入面**）④ F-20 `assembleBehaviorVerification` + F-18 `evaluateResearchClosure` ⑤ `assembleSevenElements` ▸ F-21 `saveResearchReport`（**MD-07 内容填充 / MD-08 / MD-11 经 F-21 写入面**）；`resolveAnalysisInput` **三档门禁**＝`provided` ▸ `readAnalysisFromAI`（`llm`）▸ **确定性 fallback**（`llm_gated=true`），门禁开闭同一套代码；`OUT_OF_SCOPE_DECLARATION` 须词表**派生自 F-18 `FORBIDDEN_PRODUCTION_PATTERNS`**；`WIRED_TASK_TYPES` / `RESEARCH_STEP_COUNT` 为**唯一真源**（后者派生自 `./step-plan.js` `TYPE_STEPS`）；结构性受阻（缺研究壳 / 目标快照版本缺失）→ 兜底记 `PD-03` + 任务 `blocked` 并保留已完成部分；**F-38 增**：`enabledSourceCodes` 现读可用来源（经 M5 `listTools` 读面，本文件仍零裸 SQL），注入 F-19 让**查证计划避开未启用来源**（逐步骤收窄 `data_sources`），排除项写进步 ① 的 `done_part` 与返回体（`plan_excluded_sources` / `sources_available`）——依据缺口可回查、不静默丢弃 | ✅ 已建 2026-09-21（`test-f33.mjs` **2026-09-22 F-38 后 99 断言全绿**） |
| `self-heal.js` | **F-33 自愈补扫**：`runSelfHealScan` 扫「`running` + 已接线类型 + 有 pending 步但无 active 步」的卡死任务（P1-2 同形），把最小 pending 步推进为 active（幂等）。**唯一写动作经 `./step-plan.js` `advanceStep`**（零裸 SQL、零删行）；`hva_research` 缺 `MD-07` 研究壳（LNK-04 output）者**不擅自代建**（建壳归 F-04），跳过并如实登记 `why` 原因 | ✅ 已建 2026-09-21（`test-f33.mjs` ⑨ 六断言全绿） |
| `tick-guard.js` | **F-34 单 tick 执行守卫（纯计算件）**：`runPendingWork` 每 tick 扫 `active` 步时套的三道轻量守卫——**步数配额**（`TICK_QUOTA` 步/tick，**派生自** `./step-plan.js` 的 `TYPE_STEPS` 最大步数）＋**同 tick 去重**（同一 `(task_id, step_no)` 在本 tick 内只执行一次，兼作「超时步骤仍是 active」时的**死循环闸**）＋**单步超时**（`withStepTimeout`；`STEP_TIMEOUT_MS` **派生自** `../tool-executor/index.js` 的 `DEFAULT_TIMEOUT_MS` ×2；超时**只放弃等待**——不取消、不落 `PD-03`、不改 `task_status`、不落 done，步骤保持 active 交下个 tick 重试）。**零数据库访问、零 SQL、零写**（静态可扫死）；零 schema 变更（`dict:STEP_STATE` 无 `running`，故不做占位式独占） | ✅ 已建 2026-09-21（`test-f34.mjs` **56 断言全绿**，进 CI；**不是真独占**——并发 tick 仍可能选中同一步，边界如实登记于文件头） |
| `step-plan.js` | **本目录共用骨架件**：四类任务的步骤模板（`TYPE_STEPS`，逐字对齐原型）、`TASK_TYPE_STAGE`、**取号**（`nextTaskId`＝`PD-01`、`nextResearchNo`＝`MD-07`，各自唯一一份）与建行（`createTask`）、步骤计划与推进（`planTaskSteps` / `advanceStep` / `refreshProgress`）、`LNK-04 task_object` 关联（`linkTaskObject` / `listTaskObjects`）；再导出 `../tool-executor/task-state.js` 的任务态写入面 | ✅ 已建 2026-09-19（2026-09-21 `nextResearchNo` 由 `./followup.js` 下沉至此——F-04 建研究壳亦需取号，而 `hva.js` 引用 `followup.js` 会成环） |
| `goal.js` | **F-01 研究目标登记与口径管理**：`MD-01` 身份 + `MD-02` 六要素**定版式版本化**（保存为新版本 / 应用配置 / 历史只读）、`MD-03` 材料登记与**逻辑删除**、`CFG-05` 规则驱动的**口径检查** → `PD-04` 待补项、待补项补充后**并入六要素并 bump 新版本**、`goal_check` 任务（2 步）创建与完成 | ✅ F-01 已建 2026-09-19（88 断言全绿） |
| `schedule.js` | **F-02 机会发现任务调度**：`CFG-04` 运行策略登记（**写入侧从严**）与选取（目标级优先 → 回落平台级）、运行频率 → **Cron Triggers 表达式**解析与校验（四式 / 最小粒度 1 分钟 / 250 条上限）、`MD-13`+`MD-14` 能力版本快照、Queue 消息守卫与**可注入 `enqueue` 端口**、`createDiscoveryTask`（建任务 → `LNK-04` → 五步 → `CFG-06` 上下文 → 发消息）、`delegateToAgent` 调用守卫 | ✅ F-02 已建 2026-09-19（86 断言全绿） |
| `proposal.js` | **F-03 研究建议管理（人工节点）**：`MD-12` 建议登记（研究问题**必需**、两个可选列按 `varchar(300)` 口径拒超长）、**幂等键**（机会+问题+假设+限制 → SHA-256 摘要，`UK` 落地「同键不新建、不重复启动相同任务」）、**建议与机会版本绑定**（版本号从机会现读、入参不符即拒）、研究问题的**不明确提示**（只补问题、不重填材料，**不阻断**）、机会状态迁移「候选→已提交研究」并留 `PD-05`（改行经 F-10 单一写入面）、`markProposalTriggered` 触发登记守卫 | ✅ F-03 已建 2026-09-19（82 断言全绿） |
| `hva.js` | **F-04 HVA 研究任务调度**：`createHvaResearchTask`（建议提交后建 `hva_research` 任务 → `LNK-04` 锚点 → 五步 → 按 `CFG-06` hva_research 模板落 `PD-06` 二阶段上下文 → 取 `CFG-03` 按 `hva-agent` 工具权限 → 幂等守卫同一建议不重复启动 → 发 Queue 消息恰两键 + `delegateToAgent` 守卫）；`resolveHvaToolPermissions`（按所用 Agent 授权）；**建任务同时建 `MD-07` 研究壳**（2026-09-21 补齐，详见 §8.1 ⑦~⑨：`start_task_id`＝本任务、`created_at`＝建议提交时刻、`research_status` 取字典 **item_code**、① 由真源派生、②④⑥ 与不覆盖范围为显式「尚未开展」初值、建行经 F-11 `createResearch` 单一写入面、幂等键＝`start_task_id`）；**第二阶段启动时点＝建议提交**、**版本冲突以机会为准并提示**、**hva_followup 创建归 F-05**（调度内核可复用） | ✅ F-04 已建 2026-09-19（**2026-09-21 补建 MD-07 研究壳**：**64 断言全绿**） |
| `followup.js` | **F-05 追问与版本管理**：`nextResearchNo`（2026-09-21 起为**再导出**，真源已下沉 `./step-plan.js`；既有调用面不变）/ `nextFollowupMessageId`（编号取号，库内最大 +1，确定性不撞号）；`recordFollowupMessage`（**PD-07 单一写入面**：追问对话逐条留痕，PM/Agent 双向、双外键由库级强制）；`createFollowupTask`（主入口：校验原研究存在且已关联启动任务 → 建 `hva_followup` 任务（`parent_task_id` 挂原任务）→ 建新 `MD-07` 研究壳（`parent_research_no` 指原研究、`start_task_id` 指新任务、七要素缺省从原研究承接）→ `LNK-04` 锚点 → `planTaskSteps` 五步 → `initTaskContext` 落 `PD-06`（含 `related_history`）→ 取 `CFG-03` hva-agent 权限 → 落 PD-07 追问消息 → 发 Queue 消息恰两键 + `delegateToAgent` 守卫）；版本口径：新任务/新研究默认沿用原研究 `goal_version_no`，可显式传新版本（原研究/原任务维持启动版本不变） | ✅ F-05 已建 2026-09-19（**57 断言全绿**） |
| `recovery.js` | **F-06 任务记录与异常恢复**：复用 F-26 `task-state.js` 单一写入面（PD-01/PD-03），本文件**零裸 SQL、零外部调用、不写 MD-07/EXT-02**；`capRetryLimit`（run_policy.retry_limit 封顶 100、**超限显式报错而非静默截断**，TC-U-M1-002）；`recordTaskBlock`/`handleTaskFailure`（受阻矩阵：保留 `done_part`＋置 `blocked`＋写 `PD-03`）；`stopTask`（「达到运行限制或人工取消」→ 置 `stopped`、停止状态不自动重启、写 `PD-03(limit_or_cancel)`）；`resumeTask`（`blocked`→`running`，PD-03 为追加式历史缺口日志不改写；**并按 schema PD-01 `ended_at` 列口径「任务结束时点；进行中为空」显式清空 `ended_at`**——`clear_ended_at: true`，修法方向经用户裁决＝「resume 清空」，F-37） | ✅ F-06 已建 2026-09-19（**2026-09-22 F-37 加固：51 断言全绿**） |
| `test-f01.mjs` | F-01 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子） | ✅ 已建（**88 断言全绿**） |
| `test-f02.mjs` | F-02 用例执行器（注入 spy `enqueue`；断言频率解析四式与反例、平台上限、策略选取、消息形状、五步与上下文装配） | ✅ 已建（**86 断言全绿**） |
| `test-f03.mjs` | F-03 用例执行器（断言幂等键确定性/空白不敏感/区分度与分隔符歧义反例、问题检查、版本绑定、幂等提交、状态迁移与 `PD-05` 留痕、`PD-05` 外键 L3 反例、触发登记守卫、读模型、写入面静态核验） | ✅ 已建（**82 断言全绿**） |
| `test-f04.mjs` | F-04 用例执行器（自包含 fixture：机会 + 已提交建议；断言第二阶段启动点 / 五步逐字对齐原型 / LNK-04 锚点 / 二阶段上下文 PD-06 / CFG-03 工具权限 / 版本冲突以机会为准 / 重复启动报错 / 消息恰两键 / 零外部调用 / **MD-07 研究壳 A29~A44**：建行归属、`start_task_id`/`created_at` 口径、`research_status` 取**字典 item_code**（含反例「不得写 item_name」）、① 由真源派生、②④⑥ 与不覆盖范围为显式「尚未开展」初值、research 产出锚点、幂等键 = `start_task_id`、**A44 如实固定「幂等守卫位置偏晚 → 重复调用留孤儿任务/孤儿研究壳」现状**） | ✅ 已建（**64 断言全绿**，2026-09-21 由 45 补至 64） |
| `test-f05.mjs` | F-05 用例执行器（自包含 fixture：父任务 `T-TEST-2001`（`hva_research`）+ 原研究 `R-TEST-001`（`start_task_id=T-TEST-2001`、`goal_version_no=3`）；不碰种子行；断言关联原研究建任务 / 继承版本 / 显式新版本 / 原研究不存在报错 / 原研究无启动任务报错 / PD-07 FK 反例 / PD-01 自引用父先落 / 编号推进 / 静态核验零外部调用） | ✅ 已建（**57 断言全绿**） |
| `test-f06.mjs` | F-06 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；断言 retry_limit 封顶报错 / PD-03 FK 反例 / blocked＋done_part 保留 / resume（**F-37：恢复即清空 `ended_at`，含脏态夹具与「清空只发生在 resume 一处」反例**）/ stopped 不自动重启 / done 不可改写 / 失败不否定 HVA 静态 / 零裸 SQL 静态） | ✅ 已建（**2026-09-22 F-37 后 51 断言全绿**） |
| `test-stage4.mjs` | 阶段4 接线用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；夹具前置：启用 TOL-01/04/09/11 + ACT `availability_status=ok`+`is_mcp_ready=1`）：① 静态零删行/改表 ② ok 全链路（5 步全 done → 任务 done → EXT-01/EXT-02/MD-06 逐层落库）③ 全失败路径（F-26 处置 → blocked）④ 幂等 ⑤ 结构受阻 ⑥ queue consumer 路由（discovery → 执行体、非 discovery → 占位） | ✅ 已建 2026-09-21（**45 断言全绿**） |
| `test-f33.mjs` | **F-33 M4 执行体接线用例**（node:sqlite + D1 适配层；夹具＝F-04 真实任务链 `createHvaResearchTask`，查询经**注入 transport** 不 mock 业务语义）：① 静态（`research.js` 零裸 SQL 零删行、零 `SELECT`；`self-heal.js` 改行只经 `advanceStep`；`WIRED_TASK_TYPES` 真源）② 步 ① 单跑（F-19 三分支 + 停止条件）③ **全链路五步**（5 源真实查询 → EXT-01/EXT-02 → MD-09/MD-10 → MD-07 七要素 + MD-08/LNK-02 落库，任务 done）④ 按 `task_type` 分派（`hva_research` 走 M4 体；`hva_followup` 仍占位；`discovery` 拒入 M4 体；越界步号与非法判据入参**抛错不落库**）⑤ 幂等 ⑥ 结构受阻（快照版本缺失 → PD-03 + blocked）⑦ 注入判据档（`provided`）⑧ 门禁档（确定性 fallback + `llm_gated`）⑨ 自愈补扫（补回 active；**缺研究壳者不擅自代建**）⑩ 未接线类型不被选取 ⑪ 查询全失败（失败不当证据、不否定结论）**⑫ 生产同形（F-38）**：只启用 TOL-01/04/09/11（**TOL-07 PIM 未启用**）→ PIM 不进计划、不被查询、**零 `PD-03`**、五步跑到 `done` 且报告落库，排除项在 `done_part` 可回查 | ✅ 已建 2026-09-21（**2026-09-22 F-38 后 99 断言全绿**，进 CI） |
| `test-f34.mjs` | **F-34 单 tick 守卫用例**（node:sqlite + D1 适配层；夹具＝`createDiscoveryTask` 真实任务 + **注入 transport**，不 mock 业务语义）：① 静态（守卫零 SQL / 零数据库句柄 / import 恰两处真源；`executor.js` 不复制第二份默认值；**派生等式** `TICK_QUOTA`←`TYPE_STEPS`、`STEP_TIMEOUT_MS`←`DEFAULT_TIMEOUT_MS`）② 守卫纯单元（配额计数 / 去重位 / 入参严数值化拒绝）③ 单步超时（**可注入 timer → 确定性触发**；未超时原样回传；**迟到的拒绝不变成未处理拒绝**）④ 配额=1 摊薄且**不丢步** ⑤ 两任务 10 步被摊到 ≥5 次驱动（**不跑完整批**、仍幂等）⑥ 步骤卡住（放弃 + **同 tick 只占一次** + 零状态改动 + 下个 tick 重试）⑦ 默认配置语义不变（一次驱动仍跑满五步） | ✅ 已建 2026-09-21（**56 断言全绿**，进 CI） |
| `test-f36.mjs` | **F-36 调度相位异常隔离用例**（node:sqlite + D1 适配层，载真实 DDL + 种子；夹具＝`createDiscoveryTask` 真实任务链 + `muteDuePoll` 顶掉种子既有 discovery 时点，使本 tick 只驱动本用例的任务）：① 静态（`scheduled` 是薄壳 / 顺序真源 `TICK_PHASES`＝`due>heal>work` / `index.js` 零 `throw` / 零 `fetch` / import 集合仍恰 5 条）② **相位隔离**（首 / 中 / 末相位分别抛错——**含 async 拒绝**——只影响自己、其余照跑；三相位全失败时 `scheduled` 整体不抛异常、三条 `why` 互不覆盖）③ **失败如实回报**（`phases.<相位>.{ok,why}` 逐字带原始信息 + `onError` 逐相位留痕且顺序一致 + 未注入时默认 `console.error` 亦留痕、恰 1 条）④ **失败相位返回键齐的空形态**（`executed`/`finished`/`timed_out`/`exhausted`/`quota` 全在，下游按键读取不崩）⑤ 默认相位接线（真实默认配额＝`TICK_QUOTA`；「刚跑过」时到期轮询是 no-op、任务行数不变）+ 真实夹具端到端（**一个 tick 内跑满五步 → 任务 done**，同 tick 流水线未破）+ queue 分派路径未被改动 | ✅ 已建 2026-09-21（**45 断言全绿**，进 CI） |

## F-01 已通过用例（`test-f01.mjs`，88 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **TC-I-M1-005**（版本切换不混期） | 保存 v4 后 v3 整行**逐字节未变**；`is_applied` **同 goal 恒至多一行 1**（应用 → 清零 → 置一，可回退到旧版本）；`current_version_no` 指向最新保存的版本 |
| **TC-I-M1-006**（跃迁写库） | 每次保存 / 应用 / 检查 / 补充都留下一行可查数据；`goal_check` 的两步 `step_state` 逐跃迁落 `PD-02` |
| **TC-D-M1-001 / 002** | `PD-01.task_id=NULL` → `NOT NULL` 拒绝；`goal_id='GOAL-NOPE'` → FK 拒绝；正例成功 |
| **TC-D-M1-006** | `PD-04` 三个外键（`goal_id` / `raised_by_task_id` / `rule_id`）任一不存在均 FK 拒绝 |

## F-02 已通过用例（`test-f02.mjs`，86 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **TC-U-M1-001** | 四式解析（`每日 HH:MM` / 多时点 / `每 N 小时` / `每周<一~日> HH:MM`）；八类反例全部**显式报错**（含秒位 → 「最小粒度 1 分钟」）；展开 > **250 条** → 报错（账号 Triggers 上限） |
| **TC-U-M1-002** | `retry_limit=150` → **报错**（不静默截断）；`max_duration_min>15` → 报错；`call_limit<1` → 报错；`run_frequency` 不可解析 → 不落库 |
| **TC-I-M1-001** | 策略选取目标级优先、回落平台级、停用不参与、两级皆无则报错；`delegateToAgent` 守卫（缺 `task_id` / 任务不存在 / 步骤不存在均拒） |
| **TC-I-M1-006** | Queue 消息**恰好** `{task_id, step_no}` 两键、< 1 KB、任务与步骤须真实存在；`createLocalEnqueue` 的投递痕迹 = 该步 `pending→active` 且重复投递幂等 |
| **TC-D-M1-003** | `PD-02` 重复 `(task_id, step_no)` → 复合 UK 拒绝 |

## F-03 已通过用例（`test-f03.mjs`，82 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **TC-I-M1-002**（建议与机会版本关联 / 重复提交幂等 / 缺研究问题拒绝提交） | 建议落库的 `goal_version_no` **等于机会的版本**（入参写别的版本 → 拒）；同一幂等键二次提交 `created=false`、**建议行数不增**、**机会状态不重复留痕**；研究问题为空/空白 → 拒；改研究问题即为**新建议**（可再落一行） |
| **TC-D-M1-007**（L3） | `PD-05.opportunity_id='OPP-NOPE'` → **FK 失败**（实测 `FOREIGN KEY constraint failed`） |
| 幂等键性质（F-03 本体口径） | **确定性**（同输入同键）、**空白不敏感**（`trim` 前后不产生新键）、**区分度**（四字段任一不同即不同键）、**键长 69 ≤ `varchar(128)`**、**分隔符歧义反例**（`('a::b','c')` 与 `('a','b::c')` 不同键——JSON 序列化对定长数组是单射） |
| 研究问题检查（原型 `propose.html` 钉死） | 空 → **blocking**；不明确 → **只提示不阻断**，三类要点（未指明人群 / 未指明行为或结果 / 过短）逐条命中；提示语含「**无需重填机会材料**」 |
| 提交校验 | 缺机会 / 缺问题 / 缺提交人 → 拒；机会不存在 → 拒；两个可选列超 `varchar(300)` → **拒（不静默截断）**；可选列留空 → 存 `NULL`（非空串） |
| 机会状态迁移 | `candidate → submitted` 留**一行** `PD-05`（留痕号 `LG-<机会>-<序号>`）；已是「已提交研究」→ **跳过、不重复留痕**；重复调用幂等 |
| 触发登记守卫 | 首次登记成立；同一任务重复登记 → 幂等；**同一份建议换任务再登记 → 拒**（不重复启动相同任务） |
| 写入面静态核验 | 建行只落 `research_proposal`；改行**只有 1 处**且落在 `research_proposal` + 带主键条件；**不含改 `opportunity` 的 SQL**（经 F-10 单一写入面）；无删行 / 改结构；零外部调用 |

## F-04 已通过用例（`test-f04.mjs`，64 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **TC-I-M1-001**（第二阶段启动时点＝建议提交；Agent 只在任务内被调用） | `started_at` / `created_at` 等于建议 `submitted_at`（**不另取时钟**）；`delegateToAgent` 守卫返回 `delegated=true`（Agent 只在任务内被调用） |
| **TC-I-M1-002**（建议与机会版本关联 / 重复提交幂等） | `LNK-04`：proposal = `trigger` 锚点、opportunity = `output` 作用对象（`dict:TASK_LINK_ROLE` 仅 `trigger`/`output`）；二阶段上下文 `PD-06` 的 `selected_opp` 指向机会、`product_question` 指向建议；同一建议二次启动 → 报错「已触发任务…不得重复启动」（不重复启动相同任务） |
| **TC-I-M1-007**（建议与机会版本关联） | `PD-06.selected_opp.ref_object_id` = 机会 ID；`PD-06.product_question.ref_object_id` = 建议 ID |
| 二阶段上下文（CFG-06 hva_research 模板） | 模板含 goal / background / source / selected_opp / product_question / existing_evidence；至少落 goal / selected_opp / product_question 三条 `PD-06`（上下文现读、不入消息） |
| CFG-03 工具权限（按 hva-agent 授权） | 按 `agent_code='hva-agent'` 取到 12 条授权（`grantee_type=agent`）；未知 agent → 无授权且 `tool_permissions_pending=true`（不阻断，权限登记属 M5） |
| **版本冲突以机会为准 + 提示**（用户口径 2026-09-19 确认） | 建议 v2 vs 机会 v3 → `version_conflict=true` + `version_warning` 非空；HVA 任务 `goal_version_no` 取**机会当前 3**（不看建议旧版）；冲突仍正常建任务、**不否定不阻断** |
| 步骤名逐字对齐原型 | `hva_research` 五步名与 `prototype/pages/tasks.html` 的 `TYPE_STEPS` 逐一相等 |
| Queue 消息恰两键 | dispatch 消息恰好 `{task_id, step_no}`；`Agent 只在任务内被调用` 守卫 |
| 边界 | 建议不存在 → 报错（HVA 只由真实建议触发） |
| 静态核验 | `hva.js` **不直接写库**（全委托 step-plan / proposal / shared-context 单一写入面）、零外部调用；`test-f04.mjs` 零外部调用 |
| **MD-07 研究壳 A29~A44**（2026-09-21 补建建壳后新增 19 条） | 建行归属依据＝`schema.md` MD-07 字段表 `start_task_id`/`created_at` 两行「服务功能点」列含 F-04；`start_task_id`＝本任务、`created_at`＝建议提交时刻；`research_status` 取**字典 item_code**（含反例「不得写 item_name」）；① 由「已应用目标版本业务目标 + 建议问题」逐字派生；②④⑥ 与不覆盖范围为显式「尚未开展」初值（不预填结论）；幂等键＝`start_task_id`（重复调用不新建第二行）；**A44 如实固定现状**：建议级幂等守卫位置偏晚 → 重复调用留孤儿任务/孤儿研究壳（守卫前移后应改为 3，**红即信号**）。口径详见 §8.1 ⑦~⑩ |

## F-05 已通过用例（`test-f05.mjs`，57 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **A（默认继承版本，完整建任务）** | `createFollowupTask` 在已有研究 `R-TEST-001`（`start_task_id=T-TEST-2001`、`goal_version_no=3`）上提新问题 → ① **原研究存在校验**：原研究须存在（否则报错）② **parent_task_id 挂原任务**（`T-TEST-2001`）③ **新研究壳** `parent_research_no=R-TEST-001`、`start_task_id=新任务`、`research_question=新问题`、七要素从原研究承接 ④ **原研究/原任务未被改写**（research_question / goal_version_no / start_task_id 逐字未变，新旧版本不混）⑤ `LNK-04`：research=output + opportunity=output 两条锚点 ⑥ `PD-06` 二阶段上下文按 `CFG-06 hva_followup` 模板落（含 `related_history`，自动带上原研究链）⑦ `CFG-03` 按 `hva-agent` 取到 12 条权限（`grantee_type=agent`）⑧ **PD-07 追问消息**：PM 新问题挂在**原研究** `research_no` 下、归属**新任务** `task_id`（对齐种子 MSG-001~003 口径）⑨ Queue 消息恰 `{task_id, step_no}` 两键、`delegateToAgent` 守卫 ⑩ 五步名 `TYPE_STEPS.hva_followup` 逐字对齐原型 |
| **B（显式新版本）** | 传 `goal_version_no=4` → `version_changed=true`、新任务/新研究 `goal_version_no=4`；**原研究与原任务仍维持启动版本 3**（「已有任务继续使用启动时的版本」） |
| **C（原研究不存在）** | `research_no` 指向不存在的研究 → 显式报错（追问只能建立在真实存在的研究上） |
| **D（原研究未关联启动任务）** | 原研究 `start_task_id=NULL` → 报错（追问任务无父可挂，且 `MD-07.start_task_id` 是 FK→PD-01） |
| **E（PD-07 双外键，TC-D-M1-008）** | `recordFollowupMessage` 的 `task_id='T-NOPE'` → 库级 FK 失败；`research_no='R-NOPE'` → 库级 FK 失败（双外键由库级强制，缺失即拒绝） |
| **F（PD-01 自引用父先落，TC-D-M1-004）** | 子任务 `parent_task_id` 指向尚未落库的父行 → 库级 FK 失败；父行先落、子行后落 → 成功（追问任务挂原任务成立的前提） |
| **G（编号推进）** | `nextResearchNo` 在种子 R-006/R-007 上返回 `R-008`（库内最大 +1）；`nextFollowupMessageId` 在种子 MSG-001~003 上返回 `MSG-004` |
| **S（静态核验）** | `followup.js` **零外部调用**（无 `fetch(` / 无 URL）；**不直接写 PD-01/MD-07/LNK-04/PD-06**（仅 PD-07 写面 `recordFollowupMessage`）；含 PD-07 单一写入面；`test-f05.mjs` 零外部调用 |

## F-06 已通过用例（`test-f06.mjs`，47 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **①（retry_limit 封顶，TC-U-M1-002）** | `capRetryLimit(100/99/0)` 通过；`capRetryLimit(150/101)` 显式报错「超过平台硬上限 100」（**不静默截断**）；`-1`/`3.5`/`'x'` 非 ≥0 整数报错 |
| **②（PD-03 FK 反例，TC-D-M1-005）** | `recordBlock(task_id='T-NOPE')` → 库级 FK 失败；`recordTaskBlock('T-NOPE')` → 前置守卫「任务不存在」早于 FK 拒 |
| **③（受阻→blocked，TC-I-M1-004）** | `recordTaskBlock(call_failed)`：running→blocked；保留 `done_part`（原内容仍在＋新片段追加，只追加不覆盖）；`research`/`evidence`/`task_step` 行数均不变（**研究内容与运行状态分别记录、失败不否定 HVA**）；新增一行 `PD-03`；改后状态直读 PD-01 可查；受阻记录可按任务＋未解除回查 |
| **④（handleTaskFailure）** | 便捷编排默认 `call_failed`、态＝blocked |
| **⑤（resume，TC-I-M1-006）** | `resumeTask`：blocked→running；受阻记录（PD-03）为追加式历史缺口日志，恢复不改写它（仍留作审计） |
| **⑥（stopped 不自动重启，TC-I-M1-004）** | `stopTask`：→stopped＋写 `ended_at`＋`is_auto_restart=0`＋`limit_or_cancel` 受阻记录＋保留 `done_part`；已停止任务 `resumeTask`/`recordTaskBlock`/`setTaskStatus→running` 均被守卫拒绝 |
| **⑦（done 不可改写）** | 已完成任务 `recordTaskBlock`/`stopTask`/`resumeTask` 均被前置守卫拒 |
| **⑧（done_part 幂等）** | 同一片段二次写入 → `done_part` 不重复追加 |
| **⑨（失败不否定 HVA，静态）** | `recovery.js` 不 `import shared-context`、不引用任何研究/证据写函数、不含任何外部 HTTP 调用 |
| **⑩（生产零写，静态）** | `recovery.js` 不含任何裸 SQL（全部写委托 `task-state.js`）、不发 Queue 消息、唯一 `import` 来自 `../tool-executor/task-state.js`（F-26 写入面） |

## F-33 已通过用例（`test-f33.mjs`，88 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **① 静态** | `./research.js` 零裸 SQL、零 `DELETE`/`UPDATE`/`INSERT`、零 `SELECT`（读全走读面）；`./self-heal.js` 改行只经 `./step-plan.js` `advanceStep`；`WIRED_TASK_TYPES` 恰为 `discovery > hva_research`（分派真源唯一） |
| **② 步 ① 单跑**（TC-A-M4-001） | 有候选行为假设 → 路径 `verify_hypothesis`（路径确定即停止，S-B1）；无假设 → 起点 `find_candidate`；计划＝路径首步 + 五查 = 6；比较条件三项与停止条件写进 `done_part`；**步 ① 零新查询**（前后 EXT-01 行数不变，实测 11/11） |
| **③ 全链路五步**（TC-A-M4-003/004） | 5 源真实查询（transport 恰调 5 次）→ `EXT-01` 5 行 + `EXT-02` 5 行（四要素齐）→ `MD-09` 1 行 + `MD-10` 5 条 → `MD-07` 七要素 + `MD-08` 5 条 + `LNK-02` 5 条；任务 `5 / 5 步` → done；**`MD-07` 只改行不新建（建行归 F-11）**；全部发现获支持时改善方向 0 条（**合法产出不硬凑**）；不覆盖范围为**终版**（非初值）；**未获支持亦是完整结果** |
| **④ 分派** | `runStepMessage` 对 `hva_research` 走 M4 体（回带 `path`）；`hva_followup` 仍走 `delegateToAgent` 占位；`discovery` 任务**拒入** M4 体；**越界步号 0 抛错** |
| **⑤ 幂等** | 无 active 步时重复驱动 `executed=0`；发现/证据关联零新增；任务仍 `done` |
| **⑥ 结构受阻** | 目标快照版本缺失 → 步 blocked + **`PD-03` 恰 1 行** + 任务 blocked（保留已完成部分） |
| **⑦ 注入判据档** | `analysis_input` 采纳并标 `source='provided'`、`llm_gated=false`；**形态非法（字符串 / 数组）一律抛错**——`readAnalysisFromAI` 形态非法同样抛错（**不静默退回 fallback**）；且**程序性错误不落步态、不留 `PD-03`** |
| **⑧ 门禁档**（TC-I-M4-003） | 无 `readAnalysisFromAI` → `deriveAnalysisFallback` 且 `llm_gated=true`；差异清单未取得即**留空**（不硬下「可比」）；候选项点由真实查询派生（`point_id`＝`query_id`）、**非 ok 的查询不入条目**；替代解释维度**取自 F-20 单一真源**（逐条断言 `product>activity>benefit`） |
| **⑨ 自愈补扫** | 卡死任务（五步全 pending、无 active）被补回步 1 active；**缺研究壳的遗留任务不被擅自救活**且 `skipped` 如实说明原因；**补扫幂等**（已有 active 者不再重复补） |
| **⑩ 选取范围** | `hva_followup` 不在 `WIRED_TASK_TYPES` 内 → 不被 cron 选取，其 active 步原样保留 |
| **⑪ 失败路径**（TC-A-M4-005） | 查询全失败 → 失败留痕 `EXT-01`（非 ok ≥1 行）、**零证据落库**（失败不当证据）、任务 blocked、`PD-03` 留痕、`done_part` 不含结论性措辞（**失败不下 HVA 判断**） |

## F-34 已通过用例（`test-f34.mjs`，56 断言）

| 用例 | 断言要点 |
| ---- | ---- |
| **① 静态（守卫零 SQL）** | `./tick-guard.js` 去注释后 `SELECT`/`INSERT`/`UPDATE`/`DELETE`/`DROP`/`ALTER`/`TRUNCATE`/`CREATE`/`REPLACE` 命中 **0**；零 `prepare` 调用；**签名无数据库入参**（纯计算件）；import 恰 2 条且为派生真源（`./step-plan.js` + `../tool-executor/index.js`）；`executor.js` **不复制**配额/超时的第二份定义 |
| **② 派生等式（不复制口径）** | `TICK_QUOTA === max(TYPE_STEPS 各步数)`（实测 5）；`STEP_TIMEOUT_MS === DEFAULT_TIMEOUT_MS × 2`（实测 60000）；且**单步超时 > 传输层超时**（60000 > 30000——否则会误杀传输层本可完成的步骤）；配额 ≥ 单任务最大步数（不被切得过碎）且 < 一批 12 任务 × 5 步 = 60（否则摊薄失效） |
| **③ 守卫纯单元** | 配额计数与 `hasCapacity`；去重位**只标记已执行过**的 `(task, step)`；配额非正整数 / **空串**（严数值化，不把 `''` 当 0）/ 超时非正数 / `work` 非函数**一律报错**，不静默取默认 |
| **④ 单步超时** | 永不 settle 的步骤 → 哨兵且**不挂死**；超时占 1 个配额并记入 `timed_out`；**注入 timer → 超时分支确定性触发**（无需真实等待）；未超时**原样回传**结果（超时只作兜底）；**超时后迟到的拒绝不变成未处理拒绝**（实测 0 条） |
| **⑤ 配额摊薄（不丢步）** | 配额=1 → 一次驱动只 1 步且 `exhausted=true`、返回体回带配额、任务仍 `running`、步 2 已 active；连续 5 次驱动跑满 `5 / 5 步` → done（**配额只摊薄节奏，不丢步**） |
| **⑥ 大批次摊到多 tick** | 两任务 10 步 + 配额=2 → 被摊到 **6 次驱动**（≥5）跑满；两任务均 done；**全完成后再次驱动是 no-op**（守卫不破坏既有幂等） |
| **⑦ 步骤卡住（死循环闸 + 零状态改动）** | 步 3 传输层不响应 → 步 1/2 正常完成，步 3 被放弃且**本 tick 只占用一次**（实测 `timed_out` 恰 1 条；**由去重而非配额终止本轮**）；步 3 仍 `active`、任务仍 `running`、`ended_at` 为空、**零 `PD-03`**、进度停 `2 / 5 步`、步 4/5 未被越级推进；**下个 tick 仍会重试该步**（未被永久跳过） |
| **⑧ 默认语义不变** | 默认配额取自单一真源（实测 5 vs 5）；**一次驱动仍跑满单任务五步**并落 done（**TC-I-M1-001「任务程序决定何时启动」不受影响**）；默认路径零超时、未提前耗尽配额；机会逐条判定仍产出（**守卫不介入业务语义**） |

## 关键口径（本模块已定，含登记在案的取舍）

### 1. 目标版本化：定版式快照 + 应用配置

| 动作 | 落库行为 |
| ---- | ---- |
| `saveGoalVersion` | **新增一行** `MD-02`（`version_no` = 库内最大值 +1），**不触碰任何旧行**；新版本 `is_applied=0`；同步 `MD-01.current_version_no` 指向它 |
| `applyGoalVersion` | 先把同 goal 的 `is_applied=1` 行**全部清零**，再置本版本为 1 + 写 `applied_at` |

> **「同一 `goal_id` 至多一行为 1」由应用层保证**——`0001_init.sql` 只有普通索引 `idx_goal_version_applied`，
> 无部分唯一索引。本实现用「**先清零再置一**」的固定顺序保证，**不改 DDL、不改锁定文件**（已登记 `schema.md` §12 Q-13）。

### 2. 口径检查：规则来自 `CFG-05`，本模块**不内置任何业务口径**

`checkGoalGaps` 逐条读 `gap_rule`（`is_active=1`），对六要素快照做 `match_pattern` 匹配；
**不命中的规则**才产生 `PD-04` 待补项（对齐原型 `checkGaps`：滤出「未 `is_solved` 且 pattern 不命中」的规则）。
平台**只列缺失，不替业务方定义**（BRD F-01 硬要求）。

- **已补充的规则不再复活**：`is_solved=1` 的 `rule_id` 在后续任何版本重跑检查时都被跳过。
- **`PD-04.target_field` 落库值一律是 `dict:GOAL_FIELD` 的规范值**（见下「别名归一」）。
- **`raised_by_task_id` 必填**：`PD-04` 该列是 NOT NULL 外键，故检查**必须**归属一次 `goal_check` 任务
  （`checkGoalGaps` 缺 `task_id` 直接拒，不产生无主待补项）。

#### 别名归一（对上游种子值域偏差的**显式**容错）

`db/seed/0001_mock.sql` 的 `gap_rule.target_field` 里，GAP-3 写 `scope`、GAP-4 写 `period`，
**均不在 `dict:GOAL_FIELD` 值域**（字典只有 `business_scope` / `focus_period`）——这是上游种子的值域偏差
（已登记 `schema.md` §12 Q-13，**未擅自改种子**）。

处理方式：`GOAL_FIELD_ALIAS` 只做**已知别名 → 规范名**的显式映射，映射结果才落库（保证值域合法）；
`checkGoalGaps` 的返回值里带 `alias_fields`（本次用到哪些别名），**让偏差可见而非被吞掉**；
**未登记的名字一律抛错**，不静默跳过——否则「规则没生效」会被伪装成「口径已写清」。

### 3. 待补项补充：并入六要素 + bump 新版本，**不覆盖业务方已写内容**

`fillGoalGap` 写 `filled_value` / `filled_at` / `filled_by` / `is_solved=1`，随后把补充内容并入
**当前版本**的对应字段（原值为空串→直接采用；原值非空→`原值；补充值` **追加**），再 `saveGoalVersion` 形成新版本
（对齐 `PD-04` 口径「补充后并入对应六要素字段并**形成目标新版本**」）。同一待补项重复补充 → **拒**（不产生重复新版本）。

### 4. `goal_check` 任务（2 步）总是留痕

原型口径「每次保存六要素执行一次口径检查任务，**有缺失才展示**待补任务」——**任务本身总是建**，
「有没有待补项」由返回的 `gaps` 是否为空表达（不是靠不建任务）。步骤名逐字取自原型 `TYPE_STEPS`。

> `PD-01.agent_version_snapshot` 为 `NOT NULL`，而口径检查**不调 Agent**——故显式写明能力来源：
> `n/a（口径检查＝确定性程序；规则来自 CFG-05 gap_rule）`，**不留空、不伪造 Agent 版本**。

### 5. 运行频率 → Cron Triggers（F-02）

**只支持四式，其余显式报错**（不自造语法）：`每日 HH:MM`、`每日 HH:MM,HH:MM`（多时点展开为多条 Trigger）、
`每 N 小时`（`N` ∈ 1~23；`24` 报错并提示改用「每日 HH:MM」）、`每周<一~日> HH:MM`。
校验：时分须两位且在合法区间；**含秒位即报错**（最小粒度 1 分钟）；展开条数 > **250** 报错（账号上限）。

### 6. 队列消息与 `enqueue` 端口（F-02）

`tech-stack` §2.4 的设计口径是「**消息瘦、状态厚**」：消息**恰好** `{task_id, step_no}` 两个键、体积 < 1 KB，
**上下文一律从 D1 现读**（`PD-06` 可回查）。本模块把「发消息」抽成**可注入端口** `enqueue`：

| 实现 | 行为 | 用途 |
| ---- | ---- | ---- |
| `createLocalEnqueue(db)` | 校验消息形状 → 校验任务与步骤真实存在 → 把该步 `pending→active`（**这就是投递痕迹**）→ 返回确定性 `message_id`（`T-xxxx#n`） | 本机可跑（无 wrangler / Queues） |
| 用例注入的 spy | 只记录、不落痕迹 | 断言「发了什么、发了几条」（`TC-I-M1-006`） |

> 消息**多一个键就拒**——因为多带的任何字段都可能是「把上下文塞进消息」的开始，而这正是 §2.4 要防的。

### 7. 写入侧从严 / 消费侧兜底（F-02 与 F-26 的分工）

| 侧 | 位置 | 对 `retry_limit` 超限值的处理 |
| ---- | ---- | ---- |
| **写入侧**（策略登记） | `./schedule.js` 的 `saveRunPolicy` | **显式报错、拒绝落库**（对齐 `TC-U-M1-002`「超限须显式报错而非静默截断」） |
| **消费侧**（重试执行） | `../tool-executor/index.js` 的 `retryLimitOf` | 对**历史脏值**截断到 100 并**标注** `clamped: true`（F-26 已落地） |

两侧都不静默：一侧不让你写进去，一侧对已经写进去的旧数据留痕截断。`max_duration_min` 同理（> 15 分钟直接拒，
因为 Queue Consumer 的单步上限被平台钉死）。

### 8. HTTP 路由面（F-01 / F-02 / F-03，经 `../api/index.js`）

| 方法与路径 | 作用 | 状态码约定 |
| ---- | ---- | ---- |
| `POST /api/goals` | 登记目标（`MD-01` + 同步落 v1 快照） | 201；重号 409；缺六要素 400 |
| `GET /api/goals` | 目标列表（可按 `status` 过滤） | 200 |
| `GET /api/goals/{goal_id}` | F-27 读模型（身份 + 版本历史 + 材料 + 未补待补项 + 任务） | 200 / 404 |
| `POST /api/goals/{goal_id}/versions` | 保存六要素为**新版本** | 201 |
| `POST /api/goals/{goal_id}/apply` | 应用配置（`is_applied` 至多一行 1） | 201 |
| `POST /api/goals/{goal_id}/check` | 执行一次**口径检查任务**并产出/回写待补项 | 201 |
| `GET /api/goal-gaps?goal_id=&unsolved=1` | 待补项列表 | 200 |
| `POST /api/goal-gaps/{gap_id}/fill` | 补充待补项（并入六要素 + bump 新版本） | 200；重复补充 409 |
| `GET /api/run-policies?scope=&goal_id=&active=1` | 策略列表，**附频率 → Cron 解析预览** | 200 |
| `POST /api/run-policies` | 登记 / 覆盖策略（**写入侧从严**） | 201；超平台上限 400 |
| `GET /api/effective-run-policy?goal_id=` | 取生效策略（目标级优先）+ Cron 预览 | 200 / 404 |
| `POST /api/discovery-tasks` | 到点创建发现任务（建任务 + 五步 + 上下文 + 发消息） | 201 |
| `GET /api/task-dispatch?task_id=` | 派发面回查（任务 + 步骤现状） | 200 / 404 |
| `POST /api/agent-delegations` | 「Agent 只在任务内被调用」的契约入口（阶段3 占位） | 200；缺 `task_id` 400 |
| `POST /api/research-proposals` | 提交研究建议（F-03：校验 → 版本绑定 → 幂等 → 落 `MD-12` → 机会转「已提交研究」） | **201 新建 / 200 幂等命中**（`created` 字段区分）；缺问题 / 版本不符 / 超列长 400；机会不存在 404 |
| `GET /api/research-proposals?opportunity_id=&goal_id=&triggered=1` | 建议列表（按机会 / 目标 / 是否已触发过滤） | 200 |
| `GET /api/research-proposals/{proposal_id}` | 建议读模型（建议 + 机会现状 + 状态链 + 版本一致性） | 200 / 404 |
| `POST /api/research-proposals/{proposal_id}/trigger` | 登记本次建议触发的 HVA 任务（F-04 调用） | 200；重复启动不同任务 400；建议 / 任务不存在 404 |
| `POST /api/research-proposal-checks` | 研究问题即时检查（F-29 边填边看；**只提示、不阻断**） | 200（`blocking` / `missing` / `hint`） |
| `POST /api/hva-research-tasks` | 由研究建议触发建 HVA 研究任务（F-04：第二阶段启动点＝建议提交、组织二阶段上下文 PD-06、取 CFG-03 工具权限、发 Queue 消息恰两键） | 201；建议不存在 404；已触发任务的重复启动 409 |
| `GET /api/hva-research-tasks/{task_id}` | HVA 任务回查（任务态 + 步骤现状 + 工具权限） | 200 / 404 |
| `POST /api/followup-tasks` | 在已有研究上提新问题→关联原研究建 `hva_followup` 任务（`parent_task_id` 挂原任务）+ 新 `MD-07` 研究（`parent_research_no` 指原研究、`start_task_id` 指新任务）+ 写 `PD-07` 追问消息 + 落 `PD-06` 上下文（含 `related_history`） | 201；原研究不存在 404；缺 `new_question` / 原研究未关联启动任务 400 |
| `GET /api/followup-tasks/{task_id}` | 追问任务回查（派发面：任务态 + 步骤现状 + 工具权限） | 200 / 404；FK 缺失 409 |
| `POST /api/task-recovery` | F-06 任务记录与异常恢复（复用 F-26 `task-state.js` 写入面）：`action=block`（保留 `done_part`＋置 `blocked`＋写 `PD-03`）/ `action=stop`（保留 `done_part`＋置 `stopped`、停止状态不自动重启＋写 `PD-03(limit_or_cancel)`）/ `action=resume`（`blocked`→`running`） | 201；任务不存在 404；`action` 非法 / 停止不自动重启 400；FK 缺失 409 |

> 幂等命中回 **200 而非 409**：重复提交不是错误，是「同一份建议」的正常结局（`TC-I-M1-002` 要的是
> 「不重复启动相同任务」，不是「报错」）。故用 `created` 字段区分，让调用方能分辨「新建了」与「命中了既有」。

> `GET /api/run-policy`（单数）是 **F-26 在 M5 侧的重试口径入口**，与本模块的 `/api/run-policies`（复数、管理面）
> **并存不冲突**：前者回答「这次重试几次」，后者回答「这条策略怎么配、翻成什么 Cron」。

### 8.1 HVA 研究任务调度（F-04）

**① 第二阶段启动时点＝建议提交时刻**（`TC-I-M1-001` / `MD-12` 表注）：任务的 `started_at` 与 `created_at`
**一律取 `research_proposal.submitted_at`**——F-03 在提交时已经把「第二阶段何时启动」定下来了（返回的
`second_stage_start_at`），F-04 **不另取时钟**，避免「建议提交」与「任务启动」被不同时间源割裂。

**② 版本冲突以机会为准 + 提示**（用户口径，2026-09-19 确认）：`MD-12.goal_version_no` 在 F-03 提交时
**从机会现读**（保证当时一致），但机会之后可能被重新版本化。F-04 建任务时取**机会当前**
`opportunity.goal_version_no` 作为任务的 `goal_version_no`（**以机会为准**）；若与建议登记版本不一致，
只回带 `version_conflict=true` + `version_warning`（**提示、不报错、不阻断、不否定**）——对齐
`BRD` §7 第 4 条「运行失败 / 版本偏差本身不能作为否定 HVA 的依据」。

**③ 二阶段上下文按 `CFG-06` hva_research 模板落 `PD-06`**（goal / background / source / selected_opp /
product_question / existing_evidence）——直接复用 `shared-context` 的 `initTaskContext`，上下文现读、不入消息；
`selected_opp` 指向机会、`product_question` 指向建议（`TC-I-M1-007` 建议与机会版本关联的落点）。

**④ 工具权限按所用 Agent 授权**（CFG-03，`grantee_type=agent`）：HVA 任务用 `AGP-HVA`（`agent_code=hva-agent`），
取该 Agent 被授权的工具清单供阶段4 调度校验；无授权时回带 `tool_permissions_pending=true`（不阻断，权限登记属 M5）。

**⑤ 幂等守卫**：同一建议不得重复启动任务（`MD-12.triggered_task_id` 由 F-03 `markProposalTriggered` 守），
重复调用报错「已触发任务…不得重复启动相同任务」。

**⑥ `hva_followup`（追问任务）的创建归 F-05**（追问与版本管理）；本文件提供的调度内核（`createHvaResearchTask`
的骨架）可被 F-05 复用，但不在本文件写未建文件名（避免悬空引用）。

**⑦ 建任务同时建 `MD-07` 研究壳**（2026-09-21 补齐）：建行归属依据＝`schema.md` MD-07 字段表 `start_task_id`
与 `created_at` 两行的「服务功能点」列**均含 F-04**，且 `created_at` 口径写明「＝研究建议提交时刻」——除本入口外
无人天然持有该时点；与 F-05 追问（`followup.js` 建新研究壳）**对称**。此前 F-04 漏建，`research` 表在
`hva_research` 路径上**恒零行**（2026-09-21 线上实测），M4 出报告时 `saveResearchReport` 会撞「研究不存在」。
`research_status` 取字典 **item_code `running`**（**不是** item_name「研究中」）；① 由「已应用目标版本业务目标 +
建议问题」逐字派生；②④⑥ 与「不覆盖范围」四处 NOT NULL 列写**显式「尚未开展」初值**（`RESEARCH_SHELL_INITIAL`，
不预填结论），落报告时由 F-21 整体覆盖。建行经 **F-11 `createResearch` 单一写入面**，本文件不写 SQL。

**⑧ 研究壳幂等键＝`start_task_id`**：重复调用不新建第二行（与 ⑤ 的建议级守卫互补——⑤ 看建议、⑧ 看任务）。

**⑨ ~~现状登记（待裁决）~~ → ✅ 已修（F-39，2026-09-22）**：原 ⑤ 的建议级幂等守卫 `markProposalTriggered` 排在
**建任务 / LNK-04 / 建研究壳 / PD-06 之后**（因它的 `task_id` 入参必须是**已存在**的任务，`MD-12.triggered_task_id`
是外键），故重复调用虽最终报错，**却已留下孤儿任务 + 孤儿研究壳**（`triggered_task_id` 只指回最后一次那条）——
线上 `PROP-001 → T-0026 + T-0029` 双任务即同形机制。修法＝**守卫前移**：`proposal.js` 新增
**只读预检** `ensureProposalNotTriggered(db, proposal_id)`（只判「建议是否已触发过」，不需要 `task_id`，故可排在最前），
`createHvaResearchTask` **在建任何行之前**先调它；靠后的 `markProposalTriggered` 只负责落 `triggered_task_id` 的写。
**判据与原来一致**（仍报「已触发任务」，不引入第二套口径），`test-f04` **A44 由「现状 4 行」翻转为「期望 3 行」**
并新增 A45（孤儿任务 0）/ A46（`triggered_task_id` 指回**首次**那条）；`test-f03` 新增 ⑩ 段 8 条断言（放行 / 零写 / 报错 / 报错路径零建行 / 守卫本体无写语句）。

**⑩ ~~登记（待裁决）~~ → ✅ 已修（F-40，2026-09-22）**：`followup.js` 建追问研究壳时原把 `research_status` 写成
item_name「研究中」，而字典 `RESEARCH_STATUS` 的 item_code 是 `running`（`varchar(16)` 无 CHECK，**库级拦不住**，
故只能由断言守）。已改为 item_code `running`，与 F-04 `hva.js` 建壳**同口径**；`test-f05` 新增 **A34/A35**
正反两侧锁死（值域**取自库**的 `dict_item` + 反例「不得写 item_name」），与 `test-f04` 的 A37/A38 对称。
零 schema 变更、一行改动。

### 8.2 追问与版本管理（F-05）

**① 关联原研究建立新任务**（PRD-M1 §F-05「PM 在已有研究上提新问题」）：新 `hva_followup` 任务的
`parent_task_id` = 原研究的 `start_task_id`（= 原任务）；新 `MD-07` 研究的 `parent_research_no` = 原研究、
`start_task_id` = 新任务——形成「研究追问链」与「任务父子链」两条可追溯链（对齐种子 `R-007 → R-006`、
`T-1023.parent_task_id=T-1021` 口径）。

**② 原研究结果与依据继续保留**（BRD §7 第 4 条「失败不否定结论」的延伸：新追问不抹旧研究）：全程**只读**
原研究与原任务，绝不改写其任何字段；新旧版本不混——原研究的 `research_question` / `goal_version_no` /
`start_task_id` 在 `test-f05.mjs` A4 中逐字断言未变。

**③ 版本管理**（用户口径「已有任务继续使用启动时的版本」）：新任务/新研究的 `goal_version_no` **默认沿用
原研究快照**；若追问引入范围/口径变更，可显式传入新 `goal_version_no`（如 v3→v4，`test-f05.mjs` B 场景）。
**原研究与原任务维持启动时的版本不变**——MD-02 新版本行的创建属 F-01 职责，本文件只读取/消费快照，不越权新建
版本行（`test-f05.mjs` B4/B5 断言原研究/原任务仍为 3）。

**④ 二阶段上下文按 `CFG-06 hva_followup` 模板落 `PD-06`**（含 `related_history`，自动带上原研究链）：直接复用
`shared-context` 的 `initTaskContext`，上下文现读、不入消息——与 F-04 同一根写面。

**⑤ 工具权限按所用 Agent 授权**（CFG-03，`grantee_type=agent`）：追问任务用 `AGP-HVA`（`agent_code=hva-agent`），
取该 Agent 被授权的工具清单（同 F-04，`test-f05.mjs` A7 断言 12 条）。

**⑥ 追问对话逐条留痕**（PD-07，`test-f05.mjs` A8 / E）：PM 的新问题 + 可选 Agent 应答，均挂在**原研究**
`research_no` 下、归属**新任务** `task_id`（对齐种子 MSG-001~003 的 `research_no='R-007'` + `task_id='T-1023'`）。
双外键（research_no→MD-07、task_id→PD-01）由库级强制——缺失即 FK 失败（`TC-D-M1-008`）。

**⑦ Queue 消息恰 `{task_id, step_no}` 两键**（≤1KB，与 F-02/F-04 同款）+ `delegateToAgent` 守卫（`test-f05.mjs`
A9）：Agent 只在任务内被调用（阶段4 介入真实 HVA Agent）。

**⑧ 单一写入面**（硬红线落地）：`followup.js` 经 `test-f05.mjs` S1/S2/S3 静态核验——**零外部调用**、**不直接写
PD-01/MD-07/LNK-04/PD-06**（全部走 step-plan / shared-context 既有写面），仅新增 **PD-07 单一写入面**
`recordFollowupMessage`。本目录的「不直写库」纪律（S2）未被破坏。

### 8.3 任务记录与异常恢复（F-06）

**① 复用 F-26 任务态写入面**（硬红线落地）：`recovery.js` **零裸 SQL、零外部调用、不写 `MD-07`/`EXT-02`**——
全部 PD-01/PD-03 写入经 `../tool-executor/task-state.js`；`test-f06.mjs` ⑨/⑩ 静态断言：唯一 `import` 来自
`task-state.js`、不含任何 `INSERT/UPDATE/DELETE`、不发 Queue 消息、不引用任何研究/证据写函数。

**② `retry_limit` 封顶**（TC-U-M1-002）：`capRetryLimit` 对 `CFG-04 run_policy.retry_limit` 取**显式报错**
（>100 → 「超过平台硬上限 100」，不静默截断），与 F-02 写入侧「`retry_limit>100` 一律 400」口径一致——
配置根本不会以 >100 落库，此处为恢复编排层的防御性守卫。

**③ 受阻处理矩阵映射**（BRD §4 F-06）：六类情况 → `dict:BLOCK_REASON`（target_unclear / no_data_returned /
source_unavailable / call_failed / limit_or_cancel / insufficient_basis）；`recordTaskBlock`/`handleTaskFailure`
执行「保留 `done_part`（已完成部分，只追加不覆盖）＋ 置 `blocked` ＋ 写 `PD-03`」，前置守卫（`assertTaskRunnable`）
保证 stopped/done 不进执行。

**④ 停止状态不自动重启**（BRD 受阻矩阵「达到运行限制或人工取消」）：`stopTask` 置 `stopped`（`ended_at` 落点时点、
`is_auto_restart=0`、写 `PD-03(limit_or_cancel)`）；「停止状态不自动重启」由 `task-state` 守卫——
`stopped` 任务不接受任何后续状态变更（`setTaskStatus` 与 `resumeTask` 双重拒绝）。

**⑤ 恢复＝状态跃迁**（BRD 状态流「检查继续条件满足 → 恢复原任务」）：`resumeTask` 仅 `blocked` 任务可恢复，置 `running`；
受阻记录（`PD-03`）为**追加式历史缺口日志**，恢复**不改写**它（缺口事实仍留作审计）。

**⑥ 运行失败不作为否定 HVA 的依据**（BRD §7 第 4 条）：F-06 只动 PD-01（任务态）/PD-03（受阻留痕），**绝不触碰**
`MD-07 research` 结论或 `EXT-02 evidence`——`test-f06.mjs` ③ 断言受阻处理后 `research`/`evidence`/`task_step`
行数均不变；每个状态跃迁直读 PD-01 即可查（白盒）。

### 9. 人工节点：建议的版本绑定、幂等键与「只补问题」（F-03）

**① 人工节点不可越权**（`PRD-M1` §4 / `BRD` §3.1）：M3→M4 之间**必须**由 PM 选机会、提研究问题，
平台不自动交接。故 F-03 **不替 PM 拟研究问题**——问题由人工给定，本模块只做**提示**；也**不改**机会
（机会来自 F-28，`MD-12` 表注写明「此处不可改」）。

**② 建议与机会版本绑定（不混淆不同版本）**：`MD-12.goal_version_no` **一律从机会现读**
（`opportunity.goal_version_no`），入参若写了别的版本 → **报错**。这样「建议挂在哪一版口径上」
不由调用方口头声明决定，而是由数据决定。

**③ 幂等键的构造（对原型的一处有意偏离，理由在案）**：原型的键是
`机会 + "::" + 问题 + "::" + 假设 + "::" + 限制` 的**字符串拼接**；本实现改为
**`prop-` + `sha256(JSON[机会, 问题, 假设, 限制])`**（69 字符）。理由两条：

| 问题 | 拼接式 | 本实现（JSON + 摘要） |
| ---- | ---- | ---- |
| 长度 | 问题 + 假设 + 限制最长可达数百字，**撑爆 `varchar(128)`** | 恒定 69 字符，稳落列长内 |
| 撞键 | 字段本身含 `::` 时会与相邻字段**重组出同一个键**（不同建议被误判为同一份，进而**漏启动**一次研究） | JSON 序列化对定长数组是**单射**，不会误判 |

原型钉死的是「**同一份建议重复提交幂等**」这条**需求**，键的字面编码是实现细节；两类风险都不接受，
故按上表取右列，并保留 `canonicalProposalKey()` 让**规范形式可复核**、`idempotency_key` 随返回值带出。
（`test-f03.mjs` ① 专测：确定性 / 空白不敏感 / 四字段区分度 / 键长 / **分隔符歧义反例**。）

**④ 问题不明确只提示、不阻断**：`checkResearchQuestion` 逐字照录原型 `check()` 的三条判定
（未指明人群 / 未指明行为或结果 / 过短），返回**不阻断**的要点列表 + 「**无需重填机会材料**」的提示；
唯一阻断是「问题为空」（原型提交分支的拒收）。**平台不因问题写得粗就替 PM 补问题**。

**⑤ 落库后的状态留痕**：建议落一行 `MD-12`，随后机会 `candidate → submitted`（「已提交研究」）并留
**一行** `PD-05`；已是该状态则跳过（同一机会再提新建议不重复刷状态）。**改 `opportunity` 的 SQL 不在本文件**
——走 `../shared-context/index.js` 的 `changeOpportunityStatus`（F-10 单一写入面），故本文件的改行只有
「登记触发任务」一处（落在 `research_proposal` + 带主键条件，`test-f03.mjs` ⑨ 静态断言）。

**⑥ 幂等 vs 二次启动，是两个口子**：幂等由**提交侧**（同键不新建）保证；「不重复启动相同任务」另由
`markProposalTriggered` 守一遍——同一份建议换任务再登记 → **拒**。两侧都堵，避免「建议没重复、任务却重跑」。

- **`task_stage` 由 `task_type` 推出**（`TASK_TYPE_STAGE`）：`goal_check`→`M1`、`discovery`→`M3`、
  `hva_research`/`hva_followup`→`M4`——对齐种子既有任务的 `task_stage` 取值。
- **`progress_text` 由 `PD-02` 现状重算**（`<已完成步数> / <总步数> 步`），不是手工维护的字符串。
- **种子基线**：`task_step` / `goal_gap` / `research_proposal` / `context_injection` 四表种子均为 **0 行**，
  由本模块写入；`task` 7 行、`task_object` 11 行、`followup_message` 3 行（MSG-001~003）为只读基线。
- **本模块零外部调用**：`test-f01.mjs` / `test-f02.mjs` / `test-f03.mjs` 静态断言本目录不出现 `fetch(` / `http(s):`。
- **建议的写入口径**：F-03 的登记（`submitProposal`）**只新增** `MD-12` 行、**从不改**已有建议行
  （改行仅用于 `triggered_task_id` 的登记，且带主键条件）；「事后改建议」不在需求内——
  要改研究问题，就是**另一份建议**（新键、新行），历史建议与它触发的任务都保留。
- **发现任务的 `opp_summary` 首次为空是正常的、不阻断**：一个刚登记、还没跑过发现的目标，`CFG-06` 的
  `opp_summary`（已有机会摘要）自然为空 → `buildTaskContext` 会把它记进 `missing_required`。本模块**如实回报、
  不阻断启动**（否则新目标永远起不了第一次发现）。这是有意的：`missing_required` 是**提示面**，不是门禁面。
- **`createLocalEnqueue` 的投递痕迹落在 `PD-02` 的 `step_state`**（`pending→active`），不在新表——
  `task_step` 的步骤流转本身就是「这一步被投递出去了」的白盒证据（阶段3 的表清单里没有投递表，未擅自增表）。

## 阶段4 接线（执行体：M3 发现 + M4 研究，2026-09-21）

### 共同接线点

- **分派真源**：`./research.js` 的 `WIRED_TASK_TYPES`（`discovery` / `hva_research`，唯一一份）。
  queue consumer（`index.js`）、cron 选取（`executor.js` `runPendingWork`）、自愈补扫（`self-heal.js`）**都从它取**——
  新增一类任务只需改这一处，四处不会互相走失。
- **落地方式**：queue consumer 对已接线类型改调 `executor.js` 的 `runStepMessage`（真实编排），
  未接线类型（`hva_followup` / `goal_check`）维持 `delegateToAgent` 契约占位；
  `scheduled()` = `runDueDiscoveryCalls` + `runSelfHealScan` + `runPendingWork`
  （cron 每分钟驱动，**零新依赖**——真 Queues 接入后仅删 `runPendingWork` 该行）。
- **执行体纪律（M3/M4 共同）**：步骤体只干活，跃迁统一由 `runStepMessage` 负责（实测教训：执行体返回 done 后忘了把
  当前步落 done 会让驱动器死循环重跑步 1）；步骤循环内每次查询前检查任务态，任务被 F-26 处置
  （blocked/stopped）即停手——**前置守卫，不留半截状态**。
- **程序性错误 vs 任务受阻**（F-33 定）：**越界步号 / 判据入参形态非法 / 任务类型不符**一律在 `try` **之外**抛错，
  不落 `PD-02`/`PD-03`；只有**结构性原因**（口径缺失、研究壳缺失、快照版本缺失、产出不合规）才记 `PD-03` +
  任务 `blocked`。否则「调用方写错」会被说成「任务失败」，并留一条永远无法自动恢复的受阻记录。

### M3 发现执行体（`./executor.js`）

- **工具码以库内注册码为准**：CDP→`cdp.crowd.query`、HJE→`hje.traffic.entry`、MKT→`mkt.benefit.issue`、
  ACT→`act.activity.list`。F-14 旧映射 `mkt.feedback.query`/`act.campaign.touch` 在库内不存在，
  已在 `executor.js` 与 `../agent-orchestrator/discovery.js`（4 处）同步订正。
- **确定性重算**：步骤 4/5 从 EXT-01 已落库 ok 记录做确定性重算（编排无随机、不改 schema）；
  重算包装加 `verified: true` 顶层键（`hasEnoughBasis` 的 real_return 读此键，漏加会把「依据足够」
  静默判 false → 机会 0 个）。
- **证据号**：F-09 不自动取号，执行体派生 `EV-<query_id>` 后调 `recordVerificationEvidence` 落 EXT-02。

### M4 研究执行体（`./research.js`，F-33）

- **五步与上游复用**：① F-19 `loadResearchStartContext`/`assembleResearchStart`（**只读**，三分支路径 + 停止条件）
  ② F-20 `queryForBehaviorCheck`（**经 M5**）+ **F-15 `verifyFiveChecks`** ▸ `buildEvidenceDraft` ▸ `recordVerificationEvidence`
  ③ F-20 `formCandidateBehavior` ④ F-20 `assembleBehaviorVerification` + F-18 `evaluateResearchClosure`
  ⑤ F-21 `assembleSevenElements` ▸ `saveResearchReport`。**F-19/F-20/F-21 的语义一行未改**——本文件只做接线与编排，
  它们的 oracle 仍归各自用例（`test-f19/f20/f21`）。
- **步数派生**：`RESEARCH_STEP_COUNT` 由 `./step-plan.js` 的 `TYPE_STEPS.hva_research` **派生**，不写第二次「5」；
  改步骤模板即自动跟上（越界守卫随之变化）。
- **★ 两个上游必填列（实测踩坑，接线必补）**：`EXT-02 evidence.missing_note`（F-09 `REQUIRED_EVIDENCE`）与
  `MD-08 research_finding.limit_note`（F-21 `createResearchFinding` 必填）——M4 体**必须在落库前给足**，
  否则步 ②/⑤ 直接抛「缺必填字段」。做法：步 ② **先** `verifyFiveChecks`（缺口规则会填出 `missing_note`）**再** `buildEvidenceDraft`，
  并在无缺口时显式兜底；步 ⑤ 每条发现（挂证据与不挂证据两种）**都显式带 `limit_note`**。
- **A-1 门禁三档**：`resolveAnalysisInput` 顺序＝`opts.analysis_input`（`source='provided'`）▸
  `opts.readAnalysisFromAI`（`source='llm'`）▸ **确定性 fallback**（`deriveAnalysisFallback`，`llm_gated=true`）。
  **门禁开闭同一套代码**可跑通，`analysis_input` 是**可注入判据**：传入即采纳，不传则 fallback，
  **形态非法一律抛错不静默忽略**（入口守卫）。
  `readAnalysisFromAI` 形态非法同样抛错——**不静默退回 fallback**（静默回退会把「调用方写错」伪装成「门禁未开」）。
- **runner 侧 AI 绑定**：`wrangler.runner.toml` 已补单表 `[ai]`（与 `wrangler.toml` 同款），**它不是跑起来的前提**——
  本地零凭证仍走确定性 fallback，用例全绿。⚠️ Workers AI 绑定是**单一绑定**、写法就是单表 `[ai]`，
  **不是** `[[ai]]`（2026-09-20 曾按 `[[d1_databases]]` 类推误改，已订正；详见 `wrangler.runner.toml` 内注）。
- **自愈补扫（`./self-heal.js`）**：只补「有 pending 步但无 active 步」的卡死态，**不做**任何内容级修复；
  `hva_research` 缺研究壳者**不擅自代建**（建壳归 F-04，本件不越权），跳过并登记 `why`。
- **未接线范围（如实登记，不假装完成）**：`hva_followup`（F-05 建的任务）与 `goal_check` 仍走占位——
  它们的五步执行体不在 F-33 范围内，`test-f33` ⑩ 反向锁死「不被选取」。

### 单 tick 执行守卫（`./tick-guard.js`，F-34）

- **三道守卫与目的**：**步数配额**（`TICK_QUOTA` 步/tick）＋**同 tick 去重**（同一 `(task_id, step_no)` 只执行一次）
  ＋**单步超时**（`withStepTimeout`）。堵的是 P0-2：`runPendingWork` 的 `for(;;)` 无界重查会让**一个 tick 跑完整批**
  （12 任务 × 5 步 = 60 步），把 tick 拖过 60 秒节拍 → 跨 tick 重叠 → 同一 `active` 步被并发执行 → 产物翻倍
  （**93 条重复机会**的直接成因）。配额把重叠窗口由 60 步缩到 5 步。
- **两个派生真源（不复制第二份口径）**：`TICK_QUOTA` ← `./step-plan.js` 的 `TYPE_STEPS` 最大步数
  （＝一个任务的整轮步数，**保证既有语义「一次驱动跑满单任务」不变**）；`STEP_TIMEOUT_MS` ←
  `../tool-executor/index.js` 的 `DEFAULT_TIMEOUT_MS` × 2——**必须大于传输层自身超时**，
  否则会误杀「传输层本可完成」的步骤（把真实返回变成超时放弃）。
- **超时不是失败**（与 F-26 的分工要点）：超时只**放弃等待**（不取消、不落 `PD-03`、不改 `task_status`、不落 done），
  步骤保持 `active` 交给下个 tick 自然重试；被放弃的 Promise 挂空 `catch`，避免其**迟到的拒绝**变成未处理拒绝。
  「慢」与「失败」必须分开——后者才走 F-26 的受阻/停止处置。
- **同 tick 去重兼作死循环闸**：超时被放弃的步骤**仍是 `active`**，没有去重就会被下一轮重查再次选中 →
  同一 tick 内无限重试。`test-f34` ⑦ 以「`timed_out` 恰 1 条且函数正常返回」锁死这一行为。
- **`exhausted` 的准确含义**＝「**配额已尽且仍有待执行的 active 步**」＝下个 tick 还会接着干；
  跑完自然收手时为 `false`。实现上要求**先选批、再判配额**——否则「刚好跑完」会被误报成「被配额拦住」
  （实测踩过：初版把配额判断放在选批之前，`test-f34` ⑧ 立刻红）。
- **边界（2a 零 schema 变更，如实登记）**：**不是真独占**——两个并发 tick 仍可能同时选中同一步。
  真独占需 2b 租约（`PD-02` 加列，已否决）或期 3 真 Queues 的 `max_batch_size = 1`。
  `dict:STEP_STATE` 值域只有 `pending / active / done / blocked`（**无 `running`**），
  故**不能**靠「置 running」做占位式独占——这是本路线的硬边界。

### 调度相位异常隔离（`./index.js`，F-36）

- **一个 tick 三相位、顺序真源 `TICK_PHASES`**：`due`（`runDueDiscoveryCalls` 到期轮询）→ `heal`
  （`runSelfHealScan` 自愈补扫，F-33）→ `work`（`runPendingWork` 驱动执行体，F-34 守卫）。顺序写进
  **导出的常量**而不是三行手抄：用例断言 `TICK_PHASES.join(">") === "due>heal>work"` 即锁死「顺序不被静默重排」。
- **堵 P1-1**：原实现 `runDueDiscoveryCalls` 排在执行体之前且**无 try/catch**——任一目标抛错（如无生效策略）
  → 整个 `scheduled` reject → 本 tick 所有 `active` 步永不执行，且**每分钟重演**。现三相位**各自隔离**：
  任一抛错只影响自己、其余照跑。
- **失败如实回报（不静默吞错）**：`phases.<相位>.{ok, why}` 逐字带原始错误信息，并呼叫 `onError`
  （默认 `console.error`，供 `wrangler tail` 观测）；**成功的相位不触发 `onError`**。用例三向锁死：
  ① `phases` 里 `ok:false` 且 `why` 含哨兵串；② `onError` 的呼叫次数与相位名顺序；③ **未注入 `onError` 时
  默认留痕恰 1 条**（证明默认路径也不吞错）。
- **失败相位返回「键齐的空形态」**（`EMPTY_WORK`）：`executed` / `finished` / `timed_out` / `exhausted` / `quota`
  全在。少了这一层，下游按键读取会在相位失败的 tick 上拿到 `undefined` 而崩——**「不因失败缺键」与「不静默失败」
  同等重要**。
- **顺序刻意不重排（对方案原文两个选项的取舍）**：方案写的是「把 `runPendingDiscoveryWork` 提到前面**或**
  至少让它的失败不被轮询异常吞掉」。本项取**后者**——原文举的失效模式是**抛错**，隔离已足够堵住；
  而重排会失去**同 tick 流水线**：本轮新建任务的步 1（`active`）与本轮自愈补回的 `active` 步，现在都在
  **同一 tick** 被 `work` 拾起；把 `work` 提到最前只会把它们推迟一个 tick。`test-f36` ④ 以「一个 tick 内
  跑满五步 → 任务 `done`」把这条收益固定为断言。
- **相位与留痕均可注入**：`runTick(db, { due, heal, work, onError })`。注入让「相位抛错」变成**确定性**夹具
  （不必真造库级异常），与 F-34 的「可注入 timer」同范式。
- **边界（如实登记）**：`queue()` 的**逐消息隔离不在本项范围**——该路径是 D1 痕迹式投递、真 Queues 未接
  （P1-4），接入后按「一条消息失败不阻塞同批其余消息」单独处理；本项只做**相位级**隔离。

## 反向清单

- **上游（我来自哪）**：`../README.md`（server 枝杈登记）｜`AGENTS.md`（`server/` 状态位）｜
  `../../docs/04-plan/dev-plan.md` 阶段 3 · M1｜`../../docs/02-prd/PRD-M1-平台任务程序.md`｜
  `../../docs/03-locks/schema.md`｜`../../docs/03-locks/tech-stack.md` §2.4 / §4.2｜
  `../../docs/05-test-cases/test-M1.md`｜`../../prototype/pages/tasks.html` / `../../prototype/assets/data.js`（钉死需求）
- **下游（我被谁引用）**：`../api/index.js`（**F-01 / F-02 / F-03 / F-04 / F-05 / F-06 路由**）｜阶段4 `../agent-orchestrator/discovery.js`（**真实编排被 `./executor.js` 消费**；工具码映射已与库内注册码对齐）｜
  **阶段4 M4 接线（F-33，2026-09-21 增）**：`./research.js` 与 `./self-heal.js` **反向消费** `../agent-orchestrator/` 的
  F-19 `research-start.js`、F-20 `behavior.js` / `behavior-store.js`、F-21 `result.js`、F-15 `verification.js`、
  F-18 `role.js`（**只调用，不改其语义**）；`../agent-orchestrator` 侧已在 `../agent-orchestrator/README.md` 反向清单登记本项消费关系｜
  阶段5 `frontend/`（F-27~F-32 六页经 `api` 取数）
  > 反向清单**只记既有事实**：本目录内 F-05~F-06 的引用关系在各自落地时补记（避免出现对未建文件的悬空引用）。
- **文件间引用（本目录内，既有）**：`./step-plan.js` 被 `./goal.js`、`./schedule.js`、`./proposal.js`、`./hva.js`、`./followup.js`、`./recovery.js` 与 **`./research.js`（F-33，取 `TYPE_STEPS`/`advanceStep`/`listTaskSteps`/`recordBlock` 等）** 引用；
  `./schedule.js`、`./proposal.js`、`./hva.js`、`./followup.js` 与 `./recovery.js` 被 `../api/index.js` 引用；`./followup.js` 复用 `../shared-context/index.js` 与 `../tool-executor`（经 `resolveHvaToolPermissions`）；
  **`./hva.js`（F-04，2026-09-21 增）** 新引用 `./goal.js`（取目标版本业务目标，用于派生研究壳 ①）与 `../shared-context/index.js` 的 `createResearch` / `getResearch` / `listResearch`（MD-07 建行与回查，**本文件不写 SQL**）；
  **`./hva.js` 与 `./followup.js` 之间不互相 `import`**——`followup.js` → `hva.js`（复用 `resolveHvaToolPermissions` / `HVA_AGENT_PROFILE_ID`）已是既有方向，反向引用会成环；故 `nextResearchNo` 真源下沉 `./step-plan.js`、`followup.js` 再导出（调用面不变）；`./recovery.js`（F-06）**只复用** `../tool-executor/task-state.js`（F-26 写入面），不引入其它写入面；
  `./executor.js`（阶段4 执行体）被 `./index.js` 引用（queue consumer + cron 驱动），其自身 **import `./research.js`（F-33 增）** 取 `runResearchStep` / `RESEARCH_TASK_TYPE` / `WIRED_TASK_TYPES`，并复用 `../agent-orchestrator/discovery.js`（F-14/F-15/F-16 编排函数）与 `../tool-executor`（查询与 F-26 处置）；
  **F-33 新增的三条目录内引用（2026-09-21）**：`./index.js` → `./executor.js`（`runPendingWork`）与 `./self-heal.js`（`runSelfHealScan`）；
  `./index.js` → `./research.js`（`WIRED_TASK_TYPES`，queue 路由）；`./self-heal.js` → `./step-plan.js`（`advanceStep`，**唯一写动作**）
  与 `./research.js`（`WIRED_TASK_TYPES`）；`./research.js` **不 import** `./executor.js` / `./index.js`（驱动方向单向：入口 → 执行体 → 写入面，无环）；
  **F-34 增（2026-09-21）**：`./tick-guard.js` 被 `./executor.js` 引用（`runPendingWork` 是它的**唯一使用方**），
  其自身 import `./step-plan.js`（取 `TYPE_STEPS` 派生配额）与 `../tool-executor/index.js`（取 `DEFAULT_TIMEOUT_MS` 派生单步超时）——
  **守卫不 import 任何写入面**（纯计算件），故**未新增任何表写面**、模块级硬红线那句「本目录只写 X 表」的清单不变
  **F-36 增（2026-09-21）**：`./index.js` 的相位隔离本体 `runTick` **未新增任何 import**（用例静态断言 import 仍恰 5 条），
  仍只引用 `./schedule.js` / `./step-plan.js` / `./executor.js` / `./self-heal.js` / `./research.js`——
  **纯控制流改动**：既不新增表写面、也不改变目录内既有引用方向；`scheduled` 由「直接连调三相位」改为「委托 `runTick`」，
  故「入口 → 执行体 → 写入面」的单向链不变
  **F-41 增（2026-09-22，追问执行体接线）**：`./research.js` **新增 1 条跨模块 import** ——
  `../agent-orchestrator/followup-intake.js`（取 F-22 的 `FOLLOWUP_TASK_TYPE` 常量与 `intakeFollowup` 承接面，
  **复用不复制**：类型常量与承接判定都只有一份）；`./executor.js` 的 import 由 `RESEARCH_TASK_TYPE` 改为
  `RESEARCH_TASK_TYPES`（清单真源仍在 `./research.js`）。**无环**：`followup-intake.js` 不反向 import 本目录任何文件。
  **未新增任何表写面**——追问与研究同构，落库仍走既有唯一写入面（EXT-01 归 M5、EXT-02 归 F-09、
  MD-09/MD-10 归 F-20、MD-07/MD-08/MD-11 归 F-21）
- **共用件（我复用谁）**：`../tool-executor/task-state.js`（任务态 / 受阻 / 已完成部分的**唯一写入面**，F-26 已落地）｜
  `../shared-context/index.js`（F-12 上下文注入，F-02/F-04 调用；**F-03 另复用其 F-10 的 `changeOpportunityStatus` /
  `listOpportunityStatusLog`**——机会状态的改行只此一处，本目录不重写；**F-04 另复用其 F-11 的 `createResearch` /
  `getResearch` / `listResearch`**——`MD-07` 研究壳建行只此一处，本目录不重写；**F-33 另复用其 `getResearch` / `getEvidence` 读面**）
  ｜ **F-33（2026-09-21 增）跨模块只读/写入面复用清单**（`./research.js` 的 6 条 import，**全部复用不重写**）：
  `../agent-orchestrator/research-start.js`（F-19 起点三分支）｜`../agent-orchestrator/behavior.js`（F-20 五查查询 / 候选落库 / 行为核验装配）｜
  `../agent-orchestrator/behavior-store.js`（F-20 读面）｜`../agent-orchestrator/verification.js`（F-15 五查 + 证据草稿 + EXT-02 落库）｜
  `../agent-orchestrator/result.js`（F-21 报告保存）｜`../agent-orchestrator/role.js`（F-18 结束条件 + 禁词表）｜`../tool-executor/index.js`（`listQueryRecords` 读面）。
  另 `./research.js` 复用 `./goal.js` 的 `getGoalVersion`（目标快照版本）。
  **本目录不新增任何表写入面**——M4 的每一张表都有既有的唯一写入面（见上文「边界」段）。
  **F-34 增（2026-09-21）**：`./tick-guard.js` 复用 `./step-plan.js` 的 `TYPE_STEPS`（派生配额）与
  `../tool-executor/index.js` 的 `DEFAULT_TIMEOUT_MS`（派生单步超时）——两者都是**只读常量**，
  同样**不新增任何表写入面**（守卫本体零数据库访问）。
- **登记**：`.github/workflows/ci.yml`（`validate` 步骤；**F-33 增 `node server/task-runner/test-f33.mjs` 一步**、**F-34 增 `node server/task-runner/test-f34.mjs` 一步**、**F-36 增 `node server/task-runner/test-f36.mjs` 一步**）｜`../../docs/03-locks/schema.md` §12（Q-13/Q-14）｜`../../docs/04-plan/full-flow-wiring-plan.md`（F-33~F-36 编号与范围依据）｜`../../docs/04-plan/dev-plan.md` 阶段4「接线进展」
