# AGENTS.md · 用户增长机会挖掘平台 · 项目宪法

> 全程使用中文。
> 本文件是项目区唯一默认加载的宪法：索引置顶、行数从简。
> **版本：v3**（2026-09-19）。改版须 bump 版本号，旧版移入 `.trash/`，不直接删除。
>
> v3 变更：编号体系新增四类前缀登记——`TS-xx`（tech-stack §8 待确认项）/ `T-xx`（external-deps §7 待确认项）/ `DS-xx`（决策请示包 DEC-PACK）/ `Q-xx`（schema §12 待决议项）。此前这些命名空间跨文件共用却不登记，与「编号是主键」原则冲突（见 `docs/03-locks/external-deps.md` §7 与 `docs/03-locks/tech-stack.md` §8 的撞号 T-10/T-20/T-21/T-22）；本次在宪法层统一登记，不改动任何既有编号。旧版见 `.trash/AGENTS.md-v2.md`。
> v2 变更：索引表「状态」列按**实际磁盘状态**校正——`docs/` 与 `db/` 由「待建」改为「🟡 部分」（两者均已有产物，原状态失实；该缺陷曾登记于 `docs/07-decisions/DEC-PACK-001.md` §5.3 与 `db/README.md` 已知缺口 1，均标「未擅自改宪法」，本次收口）；`db/` 于 v3 进一步翻为「✅ 已建」。旧版见 `.trash/AGENTS.md-v1.md`。
> v1 变更：① 编号体系 `R-xx 需求条目` → `REQ-xx 需求条目`（`R-xx` 让给研究结果对外编号）；② 硬红线标题由「两条」收敛为「一条」，与正文实际条数一致。旧版见 `.trash/AGENTS.md-v0.md`。


## 索引

| 位置               | 职责                                                                          | 状态   |
| ---------------- | --------------------------------------------------------------------------- | ---- |
| `docs/`          | 产品与规约：业务背景、BRD（`01-brd/`）、主子 PRD（`02-prd/`）、三项锁定（`03-locks/`）、开发计划（`04-plan/`）、测试用例（`05-test-cases/`）、runbook、决策留档（`07-decisions/`）                           | 🟡 部分：BRD（`01-brd/`）／三项锁定／决策留档／主子 PRD（`02-prd/`）／开发计划（`04-plan/`）／测试用例（`05-test-cases/`） 已有；业务背景、runbook 待建 |
| `agent-runtime/` | 运行时资产：公共业务指令、两个 Agent 的 agent.md 与 skills、工具注册表                             | ✅ 工程骨架已建（2026-09-19；目录 + 版本管理机制 `VERSIONS.md`（MD-13/MD-14 登记载体）；`agent.md`/`business-rules.md`/`S-A1~S-A4`/`S-B1~S-B4` 建壳、本体待阶段4 填充；T-23/T-24 待确认） |
| `prototype/`     | 可交互前端原型，钉死需求即完成使命，保留作证据                                                     | ✅ 已有 |
| `frontend/`      | 前端（前后端分离），六页面 F-27~F-32                                                     | 待建   |
| `server/`        | 服务端：task-runner / shared-context / agent-orchestrator / tool-executor / api | 🟡 部分已建（2026-09-19；单 Worker 入口 `server/api/index.js` + D1 绑定 `DB`；**`shared-context` F-07 业务背景管理、F-08 可用来源与工具登记、F-09 证据管理、F-10 机会记录管理、F-11 研究结果与历史管理已落地**（MD-04/MD-05 + 背景简报；CFG-01 来源登记 + 缺口语义 + 来源与工具说明；EXT-02 证据四要素 + 回查链路 + LNK-01/LNK-02 证据关联 + 新旧依据并存不覆盖；MD-06 六要素 + `unknown_item` 二态 + PD-05 状态链留痕 + LNK-03 关系与自环拒；MD-07 研究登记 + 追问不覆盖 + `parent_research_no` 追问链追溯 + MD-08 发现只读 + EXT-03 外部验证引用；**F-12 上下文按任务组织注入已落地**（CFG-06 注入模板 + PD-06 按任务装配/初始化/回读；类型＋范围两维度；确定性可复现、重复初始化幂等；**Q-08 待裁决**见 `docs/03-locks/schema.md` §12）；**M2 阶段1 六点全收口、用例全绿 2026-09-19**；**阶段2 起：`tool-executor` F-23 工具注册与权限检查已落地 2026-09-19**（CFG-02 12 工具 + CFG-03 按 Agent×工具授权；判定链七步互斥、受限必带原因、降级只作限制不阻断；38 断言全绿；**F-24 查询执行与真实返回已落地 2026-09-19**（DS-06 自建 MCP 客户端五项协议面落在 `server/tool-executor/mcp-client.js`——工具描述格式/调用回传/超时/错误码映射/权限拒绝形态；`executeQuery` 先判权限、允许才发请求；返回 EXT-01 字段口径信封 + 证据四要素，**`data` 与 `result_summary` 逐字节原样、不用模型预期替代**；九类行为映射齐；实体级隔离；传输层零 SQL 零写；74 断言全绿；**只返回不落 EXT-01，落痕归 F-25**；**F-25 查询记录保存已落地 2026-09-19**（`EXT-01 query_record` 落痕：`recordQuery`＝执行+落痕，成功/失败/受限/执行中**一律留痕**，`result_status` 值域取自 `dict:QUERY_STATUS`；落痕不变量 6 条——失败须带原因、条件不可为空、`task_id` 必填等；`getQueryRecord`/`listQueryRecords`/`readbackQuery` 可回查并派生条件/来源/时点；`query_id` 取号确定性递增；53 断言全绿；**F-26 失败重试与受限返回已落地 2026-09-19**（重试上限取 `CFG-04 run_policy.retry_limit`、**封顶 100**（tech-stack §4.2 Queues 最大重试），越界截断并标注；`executeQueryWithRetry` 的**重试是代码逻辑不是 AI 决策**，**成功不算失败**、**受限返回不重试**；`runQueryWithRecovery` 编排「重试 → 落痕（一次执行一行 EXT-01，行内 `retry_count` 记本层重试） → 任务态处置」；持续失败 → 写 `PD-03`(`call_failed`) + `task_status=blocked` 并保留 `done_part`，同类受阻再犯 → `stopped`（**停止状态不自动重启**、`is_auto_restart=0`），受限 → `PD-03`(`source_unavailable`)+受阻（BRD F-06 受阻矩阵第 3/4 行）；**任务态写入面单独落在 `task-state.js`**，故 `index.js` 仍不含改行/删行类 SQL（`test-f23.mjs` 的生产零写断言**未改一字**），写入面由 `test-f26.mjs` 静态+运行期双重收紧（改行只落在 `task` 且带主键条件、不动 `EXT-02`/`MD-07`）；**前置守卫**：已 `stopped`/`done` 的任务在执行前即被拒（无半截状态）；100 断言全绿；**M5 阶段2 四点全收口**；**阶段3 起：`task-runner` F-01 研究目标登记与口径管理已落地 2026-09-19**（`MD-01/02/03` 目标身份与六要素**定版式版本化**——保存为新版本、应用配置先清零再置一使 `is_applied` 同 goal 恒至多一行 1、历史快照逐字节只读；`CFG-05` 规则驱动的**口径检查**产出 `PD-04` 待补项（`raised_by_task_id` NOT NULL 故必归属一次 `goal_check` 任务）；待补项补充后**并入六要素并 bump 新版本**、不覆盖业务方已写内容；材料**逻辑删除**；`goal_check` 任务 2 步逐跃迁留痕；**不替业务方定指标**，别名归一（种子 `gap_rule.target_field` 的 `scope`/`period` 越值域）**显式可见且未登记名字一律抛错**；88 断言全绿；**F-02~F-06 待建** → **F-02 机会发现任务调度已落地 2026-09-19**（`CFG-04` 运行策略登记与选取（目标级优先 → 回落平台级）；运行频率 **四式** 解析为 Cron Triggers 表达式（`每日 HH:MM` / 多时点 / `每 N 小时` / `每周<一~日> HH:MM`，其余显式报错；**最小粒度 1 分钟**、展开 > **250 条**报错）；`retry_limit` / `max_duration_min` **写入侧从严拒绝**（对齐 `TC-U-M1-002`），与 F-26 消费侧兜底截断分工；`createDiscoveryTask`＝建任务 → `LNK-04` 启动对象 → 五步计划 → `CFG-06` 上下文（**现读**） → 发 Queue 消息（**恰好 `{task_id, step_no}` 两键、< 1 KB**）；`enqueue` 为可注入端口，本机投递痕迹落 `PD-02` 的 `step_state`；`delegateToAgent` 守卫「**Agent 只在任务内被调用**」；86 断言全绿；**F-03 研究建议管理（人工节点）已落地 2026-09-19**（`MD-12 research_proposal` 建议登记：**研究问题必需**、两个可选列按 `varchar(300)` 口径拒超长；**幂等键 = 机会+问题+假设+限制 的 SHA-256 摘要**（恒定 69 字符落 `varchar(128)` 内），`UK` 落地「**同键不新建行、不重复启动相同任务**」——**用 JSON 序列化而非分隔符拼接**，避免「字段含分隔符重组出同键」导致漏启动一次研究（对原型键形态的有意偏离，理由与反例断言在案）；**建议与机会版本绑定**：`goal_version_no` **从机会现读**、入参写别的版本即拒（不混淆不同版本）；研究问题检查照录原型三条判定，**不明确只提示、不阻断**且明示「无需重填机会材料」，唯一阻断是问题为空；落 `MD-12` 后机会 `candidate→submitted` 并留**一行** `PD-05`（**改 `opportunity` 的 SQL 不在本目录**，经 `shared-context` 的 F-10 单一写入面，故本文件改行仅「登记触发任务」一处且带主键条件）；`markProposalTriggered` 守住「同一份建议不得换任务重复启动」（幂等与二次启动是两个口子，两侧都堵）；82 断言全绿；**F-04 HVA 研究任务调度已落地 2026-09-19**（`hva_research` 任务：建议提交后→`LNK-04` 锚点→五步→按 `CFG-06` hva_research 模板落 `PD-06` 二阶段上下文（selected_opp 关联机会、product_question 关联建议）；取 `CFG-03` 按 `hva-agent` 工具权限；幂等守卫同一建议不重复启动；**第二阶段启动时点＝建议提交**、**版本冲突以机会为准并提示**、`hva_followup` 创建归 F-05；45 断言全绿）；**F-05 追问与版本管理已落地 2026-09-19**（在已有研究上提新问题→关联原研究建 `hva_followup` 任务（`parent_task_id` 挂原任务）→新 `MD-07` 研究壳（`parent_research_no` 指原研究、`start_task_id` 指新任务、七要素从原研究承接）→`LNK-04` 锚点→五步→按 `CFG-06 hva_followup` 模板落 `PD-06`（含 `related_history`）→取 `CFG-03` 按 `hva-agent` 工具权限→写 `PD-07` 追问消息（双外键库级强制）→发 Queue 消息恰两键+`delegateToAgent` 守卫；原研究/原任务维持启动版本不变、可显式升版不混旧、零外部调用；57 断言全绿）；**F-06 已建 2026-09-19**（任务态复用 F-26 `task-state.js` 写入面；受阻矩阵映射 + `retry_limit` 封顶显式报错 + blocked/stopped/resume 状态机；**47 断言全绿**））；**Q-09~Q-15 待裁决**见 `docs/03-locks/schema.md` §12（**Q-13/Q-14/Q-15 由阶段3 实施发现并登记，未擅自改上游**）；**F-13 角色指令配置已落地 2026-09-20**（MD-13/MD-14 唯一写入面；角色指令读＋生效 Skills＋版本快照；agent.md 版本推进（UNIQUE 单行不新建行）；Skill 注册 PK/UK/FK 库级强制；**30 断言全绿**）；F-14~F-22 待建（阶段4）；TS-20 待确认拆分） |
| `db/`            | 建表迁移与全 mock 种子数据                                                            | ✅ 已建 |
| `scripts/`       | 引用自检脚本（孤儿/悬空/重号）                                                            | ✅ 已建（2026-09-19；`scripts/ref-check.mjs` + `scripts/ref-check-allowlist.json` + `scripts/tests/test-ref-check.mjs` 骨架 18 断言全绿；全仓三类命中 0，20 条「路径不精确」软偏差与 2 条悬空已登记待修、未擅改） |
| `.github/`      | CI/CD：GitHub Actions 流水线（D1 迁移 apply + wrangler deploy + PR 标题白盒约定校验）  | ✅ 已建（2026-09-19；`.github/workflows/ci.yml`：pr-title-check + validate + deploy；分支保护/Secrets 为仓库设置项，见 `.github/README.md`） |
| `.trash/`        | 废弃产物只移不删                                                                    | ✅ 已有 |

> 状态取值：`✅ 已有`＝该目录职责已全部兑现；`🟡 部分`＝职责内已有产物但未齐（差额写在同行）；`待建`＝尚无产物。
> 工具层目录（`.workbuddy/` 记忆与技能、`.kilo/` worktrees）不承担项目交付职责，**不列入本表**（`.trash/` 因受「只移不删」规则约束而保留）。

## 项目是什么

京东超市「用户增长机会挖掘平台」：内部运营端**建议型系统**，把产品经理挖掘增长机会的前置调研流程（找信息→找问题→拆旅程→比标杆→定关键行为）沉淀为系统化能力。
半 AI、半流程、半系统化；
六大模块 M1 任务程序 / M2 共享上下文 / M3 机会发现 Agent / M4 HVA 分析 Agent / M5 工具执行 / M6 运营端工作台，共 32 个功能点（F-01~F-32）。
服务对象：京东超市运营同学＋产品经理；只做京东超市单一频道，不做全局。

## 一条硬红线

1. **白盒原则**：以功能点为单位逐点开发、逐点验收；每份产物建立双向引用，拒绝孤儿文件

## 关键规则
- **编号体系**：M1–M6 模块 ｜ F-xx 功能点 ｜ `REQ-xx` 需求条目 ｜ `R-xx` 研究结果对外编号 ｜ S-Ax/S-Bx Skill ｜ PRD-Mx 子 PRD ｜ ADR-xxx 决策 ｜ `TS-xx` 技术栈待确认（tech-stack §8）｜ `T-xx` 外部依赖待确认（external-deps §7）｜ `DS-xx` 决策请示包 ｜ `Q-xx` 锁定文件待决议项（schema §12）。编号是主键，文件名只是载体。
- **双向引用**：每份新文件头部写上游卡（我来自哪、受哪些锁定文件约束），尾部写反向清单（我被谁引用）；同时登记进最近一层目录的 README。
- **索引三层**：本文件是树干，只写一级目录职责；各目录 README 是枝杈；文件引用卡是树叶。本文件不写成全量清单。
- **术语口径**：共享上下文本体是数据库不是文件夹；HVA 在研究完成前一律称"候选行为"；查询证据必须带来源、条件、时点、适用范围。
- **两阶段衔接**：机会发现 Agent 与 HVA 分析 Agent 之间是人工节点（PM 选机会、提研究问题），不自动交接。
