# 开发计划 · 京东超市用户增长机会挖掘平台

> 实施路线图：把 M1~M6 的 32 个功能点（F-01~F-32）按**依赖顺序**拆成可执行的开发阶段。
> 版本：v1.0（2026-09-19，随主子 PRD、三项锁定、db/ 底座一并建立）

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 文档编号 | DEV-PLAN（开发计划主文档） |
| 版本 | v1.0 |
| 上游约束 | `../AGENTS.md`（宪法：M1–M6 模块｜F-xx 功能点｜白盒原则｜双向引用｜索引三层）｜`../01-brd/BRD.md`（F-01~F-32、§2.2 系统形态、§5.2/§5.3 范围与硬红线、§7 验收总则）｜`../02-prd/PRD.md` + `PRD-M1`~`PRD-M6`（功能需求与验收要点）｜`../03-locks/`（schema v1.3 / external-deps v1.1 / tech-stack v1.2）｜`../07-decisions/`（ADR-001~003、DEC-PACK-001）｜`../../prototype/`（钉死需求的可交互原型）｜`../../db/`（迁移与种子，已落地） |
| 适用范围 | 京东超市单一频道，不做全局 |
| 形态边界 | 本计划只排「做什么、按什么顺序、验收什么、依赖谁、卡在哪」，不写代码级实现（代码级归 `server/` 五模块各自的开发文档与子 PRD） |

## 1. 计划定位与原则

1. **白盒原则落地**：以功能点（F-xx）为单位逐点开发、逐点验收、每个功能点一个 PR；每份产物建立双向引用，拒绝孤儿文件（AGENTS.md 一条硬红线）。
2. **验收口径继承**：逐点验收要点来自各子 PRD §5，全局总则来自 BRD §7（白盒逐点验收、证据四要素、失败不否定结论、生产零写操作）。
3. **依赖顺序优先**：底层存储与查询先建，再调度，再研究能力，最后界面——见 §2 排序逻辑。
4. **不在此写实现**：本计划是路线图，不是设计文档；表/工具/技术细节分别指向三项锁定与子 PRD。

## 2. 依赖排序逻辑（为什么是 M2 → M5 → M1 → M3/M4 → M6）

核心约束一句话：**先底层存储与查询，再调度，再研究能力，最后界面**。

```
                   ┌──────────── 阶段 0 · 公共底座 ────────────┐
                   │ db/ 迁移+种子(已建) · mock server · agent-runtime 骨架 · CI │
                   └──────────────────────┬────────────────────┘
                                          │ 数据底座 + 查询契约就绪
                  ┌───────────────────────┴────────────────────────┐
          阶段 1 · M2 共享上下文           阶段 2 · M5 工具执行程序
          （D1 存储中枢 + 上下文注入）      （真实查询 + 留痕，唯一取数源）
                  └───────────────┬───────────────────┬───────────┘
                                  │ 存得下、查得回        │ 查得真、留得痕
                                  └─────────┬───────────┘
                                   阶段 3 · M1 平台任务程序
                          （目标版本化 + 两阶段调度 + 人工节点 + 状态机）
                                  └─────────────┬─────────────┘
                                                │ 能触发、能落库、能授权
                              ┌─────────────────┴──────────────────┐
                      阶段 4 · M3 机会发现 Agent      阶段 4 · M4 HVA 分析 Agent
                      （线索→查证→机会六要素）        （人群比较→候选行为五查→研究七要素）
                                  └─────────────┬─────────────┘
                                                │ 产出机会/研究报告落 M2
                                   阶段 5 · M6 运营端工作台（前端）
                          （六页面，只读消费 server/api，数据来自上述全部）
```

- **M2 先于 M5**：M2 定义「共享上下文本体是数据库」——背景/来源/证据/机会/研究/历史的存储语义（MD-04/05/06/07/08、EXT-02/03、CFG-01/06、LNK、PD-06）。M5 查回的结果要转 `EXT-02 evidence` 落库、按 `CFG-01 source_registry` 的来源语义登记缺口；二者还共享 CFG 配置表（来源/工具/权限）。先定存储语义，再定查询执行与留痕，逻辑自洽。
- **M5 先于 M1**：M1 调度任务时须按 `CFG-03 tool_permission` 对任务授权、调 M5 执行真实查询；M1 的 `CFG-04 run_policy`、`CFG-06 context_template` + `PD-06 context_injection` 也依赖 M2/M5 的配置与留痕。"真实返回"能力具备后，M1 才能驱动 Agent 取数。
- **M1 先于 M3/M4**：M3/M4 是被被动调度的研究能力——由 M1 创建发现/HVA 任务、加载 `agent.md`、组装上下文、收集结果落库。没有 M1，Agent 无处被触发、无处落库。M1 是"组织者"，M3/M4 是"被组织者"。
- **M3/M4 先于 M6**：前端六页面展示机会/研究/任务状态，必须有后端真实数据（来自 M2+M3/M4+M1 的串联）。且硬红线「真实返回、前端不直连外部系统」决定了前端数据必须经 `server/api` 来自真实后端，不能依赖 mock 直出。

> 两阶段 Agent（M3→M4）之间经**人工节点**（M1 F-03/F-04，PM 选机会、提研究问题），不自动交接——故 M3 与 M4 在阶段 4 内可先后或并行，但都必须等 M1 就绪。

## 3. 阶段划分（按依赖顺序）

> 每个阶段给出：覆盖模块与功能点、涉及 schema 表、涉及 server 模块 / 工具 / 基础设施、关键交付物、验收要点、依赖前序、风险与待确认。

### 阶段 0 · 公共底座（前置，部分已完成）

- **目标**：打通"能建库、能跑 mock、能部署、能加载指令"的最小组装。
- **覆盖**：无独立功能点，但支撑全部阶段。
- **已完成**：`db/migrations/0001_init.sql`（36 表 DDL，含真实外键、Q-05 六要素 CHECK、建议索引）、`db/seed/0001_mock.sql`（31 表有种子 / 5 表按裁决留空（`context_injection` / `external_validation` / `goal_gap` / `research_proposal` / `task_step` 由执行期写入，不预置基线），已通过外键校验）、`db/seed/generate_mock.py`（可重跑生成器）、`db/probes/`（D1 类型/外键/排序实测证据）。
- **本阶段待建**：
  - `prototype/mock/` mock server（契约见 `external-deps.md` §6 七类行为 ＋ 超时/执行中两类）：让 F-14/F-15/F-24/F-26 在真实接口未接入时也能真实测试失败路径（D-6）。
  - `agent-runtime/` 骨架：目录与版本管理机制（`MD-13 agent_profile` / `MD-14 skill_registry` 的登记载体），先于 M3/M4 落地 agent.md 与 skills 本体。
  - CI：GitHub Actions → `wrangler deploy`；D1 迁移 `wrangler d1 migrations apply`；每 F-xx 一个 PR 的分支保护（tech-stack §1.3 / §7）。
- **验收要点**：`wrangler dev` 本地起 D1 + 迁移应用成功；mock server 七类行为可返回并映射到 `EXT-01` 字段；一次 PR 流水线跑通。
- **依赖前序**：无（起点）。但 mock server 的真实契约依赖 `external-deps.md` §7 的 T-01/T-02/T-05 关闭——研发期先用 demo 占位（`*`）跑通，真实契约到位再替换（红线：demo 值不得进断言）。
- **风险与待确认**：TS-18（mock/ 归属）、TS-19（预览环境）、TS-20（Worker 打包形态）、T-32（external-deps 是否需先于种子定稿——**已解除**：种子已落）。

### 阶段 1 · M2 共享上下文（信息存储中枢）

- **覆盖模块 / 功能点**：M2 · F-07~F-12。
- **涉及 schema 表**：`MD-04 business_context`、`MD-05 touchpoint`、`CFG-01 source_registry`、`EXT-02 evidence`、`LNK-01 opportunity_evidence`、`LNK-02 finding_evidence`、`MD-06 opportunity`、`LNK-03 opportunity_relation`、`PD-05 opportunity_status_log`、`MD-07 research`、`MD-08 research_finding`、`EXT-03 external_validation`、`PD-06 context_injection`、`CFG-06 context_template`。
- **涉及 server 模块**：`server/shared-context`（被 api / orchestrator 调用）。
- **关键交付物**：
  - 背景与触点 CRUD（`MD-04`/`MD-05`）+ 五类来源登记与缺口语义（`CFG-01`，与种子对齐）。
  - 证据登记与回查链路（`EXT-02` + `LNK-01`/`LNK-02`，证据四要素：来源/条件/时点/适用范围；新旧依据并存不覆盖）。
  - 机会记录与六要素写入（`MD-06` + `LNK-03` + `PD-05`；`unknown_item` 二态，见 ADR-003 / Q-05）。
  - 上下文按任务注入（`PD-06` + `CFG-06`）：一/二阶段注入模板，确定性可复现（同任务同输入→同工作空间）。
- **验收要点**：证据链完整可回溯；机会六要素齐全且未知项二态正确；上下文注入确定性可复现（子 PRD-M2 §5）。
- **依赖前序**：阶段 0（D1 表已建、mock 可用）。
- **风险与待确认**：TS-12（哪些中文列需排序键，影响 F-27/F-28 列表）；F-11 外部验证的"执行与效果计算"由业务方完成，本阶段只登记与关联（`EXT-03`）。

### 阶段 2 · M5 工具执行程序（查询执行与留痕）

- **覆盖模块 / 功能点**：M5 · F-23~F-26。
- **涉及 schema 表**：`CFG-02 tool_registry`、`CFG-03 tool_permission`、`CFG-04 run_policy`、`CFG-05 gap_rule`、`EXT-01 query_record`、`EXT-03 external_validation`（结果登记）。
- **涉及 server 模块**：`server/tool-executor`（自建 MCP 客户端）。
- **涉及外部工具**：12 个工具 TOL-01~12（`external-deps.md` §5：CDP TOL-01/02/03、HJE TOL-04/05/06、PIM TOL-07/08、MKT TOL-09/10、ACT TOL-11 降级 / TOL-12 不存在）。
- **关键交付物**：
  - 工具注册与权限检查（`CFG-02`/`CFG-03`，每次调用前判定，分支互斥：允许/受限并留原因）。
  - 自建 MCP 客户端（DS-06）：协议面 = 工具描述格式 / 调用与回传 / 超时 / 错误码映射 / 权限拒绝形态（tech-stack §2.6）；对接 `external-deps.md` §6 mock 契约。
  - 真实查询返回（`F-24`）：绝不用模型预期替代结果，返回带条件/来源/时点/限制。
  - 查询记录留痕（`EXT-01`：条件/来源/时点/结果或失败原因/重试次数/受限标记）+ 失败重试与受限返回（F-26，重试为代码逻辑、卡死保留状态停止，与 M1 F-06 共用状态机口径）。
- **验收要点**：每次查询（含失败）可回查；权限分支互斥；失败也留痕；状态口径与 M1 F-06 / M6 F-32 一致（子 PRD-M5 §5）。
- **依赖前序**：阶段 0（mock server 七类行为就绪，否则失败路径无法测）+ 阶段 1（来源/证据/缺口语义已定，`CFG-01` 已种）。
- **风险与待确认**：`external-deps.md` §7 的 T-01/T-02/T-05（真实工具名/条件字段/返回结构）关闭前，MCP 客户端只能以 demo 契约对接 mock；T-06（HJE/PIM/MKT 失败语义）、T-07（ACT 降级常态/临时）、T-08（ACT 是否确无参与明细）；**TS-10（模型选型已于 2026-09-21 收口：Free 池 qwen3-30b 默认）**/TS-22（MCP 协议版本，影响 A-2 工具调用能力）。

### 阶段 3 · M1 平台任务程序（组织者 / 调度层）

- **覆盖模块 / 功能点**：M1 · F-01~F-06。
- **涉及 schema 表**：`MD-01 research_goal`、`MD-02 research_goal_version`、`MD-03 goal_material`、`PD-04 goal_gap`、`MD-12 research_proposal`、`PD-01 task`、`PD-02 task_step`、`PD-03 task_block`、`PD-05 opportunity_status_log`、`PD-07 followup_message`、`CFG-04 run_policy`、`CFG-06 context_template`、`PD-06 context_injection`、`CFG-03 tool_permission`。
- **涉及 server 模块**：`server/task-runner`（Queue Consumer + Cron 触发入口）、`server/api`（入口）。
- **关键交付物**：
  - 目标与口径版本化（F-01：`MD-01`/`MD-02`/`MD-03`/`PD-04`；六要素必填、待补项提示、版本切换不污染历史——ADR-001）。
  - 两阶段任务调度（F-02 发现 / F-04 HVA：Cron Triggers + Queues 自驱动推进，每步一条消息只带 `task_id`+`step_no`，上下文从 D1 现读——tech-stack §2.4）。
  - 人工节点研究建议（F-03：`MD-12`，选机会+研究问题；重复提交幂等）。
  - 追问与版本派生（F-05：`PD-07` + `PD-01.parent_task_id`）。
  - 任务记录与异常恢复（F-06：状态机 `PD-01/02/03`，重试为代码逻辑、受阻写 `PD-03` 并保留已完成部分、停止不自动重启）。
- **验收要点**：目标/研究版本切换"不混期"有回归验证；重复提交幂等；状态机口径与 M6 F-32 一致；运行失败不作为否定 HVA 依据（子 PRD-M1 §5 + BRD §7 第 4 条）。
- **依赖前序**：阶段 1（上下文注入 `PD-06`/`CFG-06`）+ 阶段 2（按 `CFG-03` 授权调 M5，真实查询可返回）。**M1 不依赖 M3/M4 存在即可先把"调度壳 + 状态机 + 人工节点"跑通**（Agent 调用处先以契约占位，待阶段 4 接真 Agent）。
- **风险与待确认**：TS-17（是否给 `CFG-04` 增补 `retry_delay_sec`/`dead_letter_flag` 使重试可配置化）；TS-16（长文本截断/分段，受 D1 2 MB/行限制）；D1 单线程写入须靠 `max_concurrency` 限流（tech-stack §4.2）。

### 阶段 4 · M3 / M4 研究 Agent（两阶段研究能力）

- **覆盖模块 / 功能点**：M3 · F-13~F-17；M4 · F-18~F-22。
- **涉及 schema 表**：M3→`MD-06 opportunity`、`MD-13 agent_profile`、`MD-14 skill_registry`、`LNK-03 opportunity_relation`、`CFG-05 gap_rule`；M4→`MD-07 research`、`MD-08 research_finding`、`MD-09 candidate_behavior`、`MD-10 behavior_point`、`MD-11 improvement_action`、`MD-12 research_proposal`、`MD-13`、`PD-07`、`LNK-02 finding_evidence`。
- **涉及 server 模块**：`server/agent-orchestrator`（调 Workers AI、装配上下文、工具回路、产出落库）。
- **涉及外部工具**：M3→TOL-01/02/04/05/06（F-14/F-15）；M4→TOL-03/07/08/09/10/11（F-20，最脆弱功能点）。
- **关键交付物**：
  - 把 PRD-M3/M4 §1.1 的 agent 配置落成 `agent-runtime/` 真实文件：`agent.md`（机会发现 / HVA 分析两段）、`business-rules.md`（公共业务指令）、skills `S-A1~S-A4`（机会发现）、`S-B1~S-B4`（HVA 五查）；并登记 `MD-13`/`MD-14`（Q-07 已决 2026-09-19，补种 2 行 `skill_registry`：`S-A1`=clue-scan（bound_agent_code=discovery-agent，profile_id=AGP-DISC）、`S-B1`=hva-five-checks（bound_agent_code=hva-agent，profile_id=AGP-HVA））。
  - M3 线索→查证→机会（F-14 关联人群/旅程、F-15 五查、F-16 六要素组装与去重、F-17 两步衔接）。
  - M4 研究七要素（F-19 三分支起点、F-20 候选行为五查、F-21 七要素组装证据逐项挂接、F-22 追问承接）。
- **验收要点**：线索关联人群/旅程；查证五查齐全且缺口标注；机会六要素齐全、未知项二态；研究七要素齐全、已查明与仍受限视觉/文本可分；未支持候选 HVA 也是完整结果；因果不臆断、假设不预置结论（子 PRD-M3 §5 / M4 §5 + BRD §7）。
- **依赖前序**：阶段 1（上下文注入、证据/机会存储）+ 阶段 2（真实查询）+ 阶段 3（M1 调度壳与人工节点就绪，本阶段把真 Agent 接进 M1 的调度回路）。**M3 先于 M4 接线上**（M3 机会产出 → 人工节点 → M4 HVA 研究），二者共用 `business-rules.md` 与 `CFG-05 gap_rule` 五查口径。
- **接线进展（2026-09-21）**：**M3 discovery 调度回路已接通**——`server/task-runner/executor.js` 执行体（五步确定性编排 + 真实查询 + F-26 处置）接入 runner 的 queue consumer 与 cron 自驱动，`test-stage4.mjs` 45 断言全绿（登记 `server/task-runner/README.md`「阶段4 接线」节）。**M4（hva_research / hva_followup）的真实执行体接线归后续 PR**，当前走 `delegateToAgent` 契约占位。**前置缺口已补（2026-09-21）**：F-04 `createHvaResearchTask` 此前**漏建 `MD-07` 研究壳**（`createResearch` 在生产仅 `POST /api/research` 与 F-05 追问两处调用），线上实测 `research` 在 hva_research 路径上恒零行；已按 `schema.md` MD-07 字段表归属依据（`start_task_id` / `created_at` 两行「服务功能点」列均含 F-04）补齐，与 F-05 追问对称，`test-f04` **64 断言全绿**（登记 `server/task-runner/README.md` §8.1 ⑦~⑩）。
- **新增工作项 F-33~F-36（2026-09-21 登记，用户裁决后开工）**：全流程打通的四期方案见 `./full-flow-wiring-plan.md`（断点清单 + 裁决记录 + 编号映射）。区间裁决＝**期 1 + 期 2**；**F-33**＝M4 执行体接线（`server/task-runner/research.js` 五步 + `executor.js` 按 `task_type` 分派 + `index.js` 路由 + `wrangler.runner.toml` 加 `[ai]` ＋ 自愈补扫）、**F-34**＝步骤配额 + 去重 + 超时（零 schema 变更）、**F-35**＝取号原子化（`id_sequence`）、**F-36**＝轮询与执行体的顺序/异常隔离。另有两项**独立工作项**（未擅自改，已登记）：F-03/F-04 幂等守卫前移（消除孤儿任务 + 孤儿研究壳）、`followup.js` `research_status` 由 item_name 改回字典 item_code。期 3（真 Queues）与期 4（本地一键 e2e）本次不在范围内。
- **F-33 已上线并完成线上验收（2026-09-21，提交 `209c85b`）**：M4 执行体接线随 CI `deploy` 上线（`validate` + `deploy` 双绿，`test-f33` 88 断言进 CI）。部署后 1~3 分钟内**读面回查**到的实测：**T-0029 被自愈补扫救出**并真实执行（`0 / 5` → `2 / 5`，CDP/HJE 真实返回 + EXT-02 2 条）；**T-0026 由执行体自动**置 `blocked` + `PD-03 target_unclear`（PD-06 `product_question` 缺位，不擅自代拟）＝P1-3 证据（无需运维 SQL）；新建 **T-0031**（15:27 由 F-04 建任务 + 建壳 `R-001`）步 ①→② 实跑。**唯一剩余阻塞是外部启用面而非代码**：M4 的计划源含 PIM 而线上只启用 TOL-01/04/09/11，故步 ② 到 PIM 即被 F-26 按受限返回置 `blocked`（`resume_condition＝接入或权限问题解决`），执行体前置守卫随即停手。据此**新登记两项独立工作项**（未擅改）：执行体 catch 在 `blocked` 落 `ended_at` 致恢复后成「`running` + `ended_at` 非空」脏态（干跑实证）、F-19 查证计划是否应避开未启用来源。详见 `./full-flow-wiring-plan.md` §1.6 与编号映射表。
- **风险与待确认**：**TS-10（模型选型已于 2026-09-21 收口：Free 池 qwen3-30b 默认，实测 23/0 满分、honesty 全 0 失败，原最大风险已解除）**；F-20 对外部依赖最脆弱（12 工具中 11 个 `blocks_features` 含 F-20，但模型红线已实测可达）；T-20/T-25（external-deps §3/§4 分类框架是否确认）；T-23（agent.md 版本管理真实形态）；T-24（Skill 加载与编号映射，Q-07 已决）。

### 阶段 5 · M6 运营端工作台（前端）

- **覆盖模块 / 功能点**：M6 · F-27~F-32。
- **涉及 schema 表**：`MD-01/02/03`、`MD-06`、`MD-07/08/09/10/11`、`MD-12`、`PD-01/02/03/05`、`PD-07`、`LNK-01`、`EXT-02`。
- **涉及 server 模块**：`server/api`（只做参数校验与转发，无业务逻辑）；`frontend/`（六页面，与 API 同源，零构建）。
- **关键交付物**：六页面（`prototype/pages/` 已钉死需求，作实证）：F-27 目标配置、F-28 机会列表与详情、F-29 研究建议提交、F-30 研究结果、F-31 追问对话、F-32 任务与状态。把原型的 `assets/data.js` 读取处换成 `fetch` 调 `server/api`，**原型的 mock 数据不复制进前端**（tech-stack §2.1）。
- **验收要点**：六页面逐页对照 BRD F-27~F-32 验收；证据链可点开回查到查询记录；已查明与仍受限视觉可分；三类事实（机会未选中/任务未完成/研究未支持候选行为）分别可见；重复提交幂等；追问关联原研究；状态机口径与 M1 F-06 / M5 F-26 一致（子 PRD-M6 §5）。
- **依赖前序**：阶段 1+2+3+4 全部（后端真实数据齐全，前端只读消费）。**前后端分离判断标准（可验收）**：删掉 `frontend/` 整个目录，`server/api` 与 `db` 仍能独立存在并被任意客户端调用（tech-stack §1.2）。
- **风险与待确认**：TS-13（前端是否需 Web Components 等轻量复用手段）；TS-15（前端与 API 是否长期同源）；TS-12（中文列排序在应用层用 `Intl.Collator('zh-Hans-CN')` 处理，默认走前端/API 层）。

## 4. 里程碑与交付节奏（相对工期，非日历）

| 里程碑 | 阶段 | 建议相对工期 | 出关判据 |
| ---- | ---- | ---- | ---- |
| M0 底座就绪 | 阶段 0 | 1~2 周 | D1 迁移应用成功 + mock server 七类跑通 + 一次 PR 流水线通过 |
| M1 上下文可用 | 阶段 1 | 1~2 周 | 证据可回溯、机会六要素写入、上下文注入确定性可复现 |
| M2 真查询可留痕 | 阶段 2 | 2~3 周 | 含失败路径的查询可回查、权限分支互斥、mock 契约对齐 |
| M3 调度壳跑通 | 阶段 3 | 2~3 周 | 目标版本化不混期、人工节点幂等、状态机与下游口径一致 |
| M4 两 Agent 上线 | 阶段 4 | 3~4 周 | M3 产出机会、人工节点转 M4、研究七要素齐全（TS-10 模型选型已于 2026-09-21 收口，不再阻塞） |
| M5 前端可演示 | 阶段 5 | 2~3 周 | 六页面逐页验收、前后端分离判断成立、证据可回查 |

> 工期为相对量级估算，受 `external-deps.md` §7 与 `tech-stack.md` §8 待确认项关闭节奏影响（TS-10 模型选型已于 2026-09-21 收口；仍受 T-01~T-10 工具契约影响）。每阶段末做一次白盒逐点验收，不跨阶段累计技术债。

## 5. 跨阶段横切事项

1. **CI/CD 纪律**：每 F-xx 一个 PR（白盒）；`wrangler deploy` + `wrangler d1 migrations apply`；凭证只在 GitHub Secrets / Workers Secrets，不落仓库（BRD §5.3 硬红线的技术落实）。
2. **数据库迁移纪律**：D1 外键默认强制（tech-stack §3.3，已实测）；建表/插入先父后子；种子与 `external-deps.md` §5 逐行对齐；长文本受 2 MB/行限制须截断或分段（TS-16）。
3. **mock server 贯穿研发期**：M2/M5/M3/M4 的真实查询与失败路径测试均依赖 D-6，生产接入前用 demo 契约跑通（demo 值不得进断言）。
4. **agent-runtime 落地**：M3/M4 阶段把 PRD §1.1 的 agent 配置落成真实文件并登记 `MD-13`/`MD-14`（Q-07 已决后补种 2 行）。
5. **硬红线贯穿全阶段**：生产环境零写操作；真实返回（禁模型预期替代）；证据四要素；失败不否定结论；不调生产环境写接口。

## 6. 风险与待确认项（阻塞面梳理）

| 阻塞面 | 来源 | 影响阶段 | 影响功能点 | 说明 |
| ---- | ---- | ---- | ---- | ---- |
| ~~TS-10 模型选型~~ → **✅ 已收口（2026-09-21，Free 池 qwen3-30b 默认，实测 23/0 满分）** | tech-stack §8 | 阶段 4 | F-14/F-15/F-19/F-20/F-21 | 红线（敢说不足/不编造）已实测可达，原最大风险解除 |
| T-01/T-02/T-05 工具契约 | external-deps §7 | 阶段 2 | F-23/F-24/F-15 | 真实工具名/条件/返回结构未定，MCP 客户端只能对接 mock |
| T-06/T-07/T-08 缺口语义 | external-deps §7 | 阶段 2/4 | F-26/F-20 | 失败语义、降级常态/临时、参与明细缺失 |
| **F-20 外部依赖最脆弱** | external-deps §5 | 阶段 4 | F-20 | 12 工具中 11 个 `blocks_features` 含 F-20；五查每查需不同系统 |
| TS-17 重试可配置化 | tech-stack §5.1 | 阶段 3 | F-06 | `CFG-04` 缺 `retry_delay_sec`/`dead_letter_flag`，否则写死代码 |
| TS-12 中文排序 | tech-stack §3.2 | 阶段 1/5 | F-27/F-28 | 默认 BINARY≠拼音序，须应用层排序或加排序键 |
| TS-16 长文本截断 | tech-stack §4.1 | 阶段 1/2 | F-09/F-12/F-24/F-25 | 2 MB/行限制 |
| T-20/T-25 分类框架 | external-deps §7 | 阶段 0/4 | 框架本身 | §3/§4 由我方推导，待 PM 确认是否成立 |
| TS-18/TS-19/TS-20 | tech-stack §8 | 阶段 0 | 工程形态 | mock 归属 / 预览环境 / Worker 打包（不阻塞设计） |

> 未列尽的 `external-deps.md` §7（T-01~T-10、T-20~T-27）与 `tech-stack.md` §8（TS-11~TS-22；**TS-10 已于 2026-09-21 收口**）全文仍为实施前置；**§7 待确认清单关闭前，`external-deps.md` 不应被视为可实施**（其自身诚实说明）。

## 7. 验收总则（承接 BRD §7）

- **逐功能点验收**：F-01~F-32 每点一个 PR、一份可验证结果；拒绝"整体跑通即过关"。
- **前后端分离判断**：删 `frontend/` 后 `server/` + `db/` 仍可独立服务（tech-stack §1.2）。
- **证据可回查**：机会/结果页证据链能点开回查到 `EXT-01` 查询记录（来源/条件/时点/适用范围）。
- **失败不否定结论**：`EXT-01`/`PD-03` 留痕的失败，不得作为否定 HVA 的依据。
- **状态口径一致**：任务状态机在 M1 F-06 / M5 F-26 / M6 F-32 三处展示必须同源一致。
- **双向引用**：每份产物头部写上游卡、尾部写反向清单、登记最近一层目录 README。

## 反向清单

- **上游（我来自哪）**：`../AGENTS.md`（宪法）、`../01-brd/BRD.md`、`../02-prd/PRD.md` 及 `PRD-M1`~`PRD-M6`、`../03-locks/`（schema / external-deps / tech-stack）、`../07-decisions/`（ADR-001~003、DEC-PACK-001）、`../../prototype/`、`../../db/`。
- **下游（我被谁引用）**：`../05-test-cases/`（测试用例，✅ 已建 2026-09-19）、`../06-runbook/`（runbook，待建）、`../../server/`（五模块实现）、`../../frontend/`（六页面）、`../../agent-runtime/`（agent 配置落地）、CI 流水线。
- **登记**：`../README.md`（docs 目录清单，开发计划行）、本目录 `./README.md`（04-plan 枝杈）。
- **被子 PRD 反向引用**：`PRD-M1`~`PRD-M6` 的"下游预计被引用：开发计划"已由本文件兑现。
