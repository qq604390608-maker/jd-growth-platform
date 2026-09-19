# task-runner · M1 平台任务程序（server/task-runner）

> 文档卡（阶段3 · M1 · 2026-09-19）
> 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径）
> ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md`（F-01~F-06 验收要点）
> ｜ `../../docs/01-brd/BRD.md` §3.1 流程主线｜§4 F-01~F-06（**含 F-06 受阻处理矩阵与状态流两张表，须逐条实现**）｜§5.3 硬红线｜§7 验收总则（**第 4 条：运行失败不作为否定研究的依据**）
> ｜ `../../docs/03-locks/schema.md`（MD-01/02/03｜MD-12｜PD-01/02/03/04/05/06/07｜LNK-04 `task_object`｜CFG-04 `run_policy`｜CFG-05 `gap_rule`｜CFG-06 `context_template`｜§12 Q-13）
> ｜ `../../docs/03-locks/tech-stack.md` §2.4（Cron Triggers + Queues + 自建状态机；**消息只带 `task_id` + `step_no`**，上下文从 D1 现读）｜§4.2（Cron 最小粒度 1 分钟、账号 Triggers 上限 250；Queues `max_retries` ≤ 100；单步 ≤ 15 分钟）
> ｜ `../../docs/03-locks/external-deps.md`（本模块**不直接调外部**，查询经 `../tool-executor`）
> ｜ `../../docs/04-plan/dev-plan.md`（阶段 3 · M1：目标与口径版本化 / 两阶段任务调度 / 人工节点 / 追问与版本派生 / 任务记录与异常恢复）
> ｜ `../../docs/05-test-cases/test-M1.md`（TC-U-M1-001/002｜TC-D-M1-001~008｜TC-I-M1-001~006）
> ｜ `../../prototype/pages/tasks.html`（**`TYPE_STEPS` 钉死需求**）｜`../../prototype/assets/data.js`（**`gapRules`/`checkGaps` 钉死需求**）｜`../../prototype/pages/goal.html`
> ｜ `../../docs/07-decisions/ADR-001-业务背景不与目标版本联动.md`（目标版本只由六要素驱动）
> ｜ `../../db/migrations/0001_init.sql`｜`../../db/seed/0001_mock.sql`
>
> 职责：M1 的**组织者 / 调度层**。目标与口径版本化（F-01）、两阶段任务调度（F-02 / F-04）、
> 人工节点研究建议（F-03）、追问与版本派生（F-05）、任务记录与异常恢复（F-06）。
> **自身不做研究判断**，只做确定性的调度、存储与状态流转；查询一律经 `../tool-executor`。
> 边界：本模块**不调外部接口**（无 `fetch`、无 URL——可由静态扫描验证）；`EXT-01` 的落痕由
> `../tool-executor` 承担，本模块只**聚合**其记录；任务态跃迁、受阻留痕、已完成部分的写入面
> **不在本目录**，在 `../tool-executor/task-state.js`（F-26 已落地，本目录 `import` 复用而非重写）。

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `step-plan.js` | **本目录共用骨架件**：四类任务的步骤模板（`TYPE_STEPS`，逐字对齐原型）、`TASK_TYPE_STAGE`、任务取号（`nextTaskId`）与建行（`createTask`）、步骤计划与推进（`planTaskSteps` / `advanceStep` / `refreshProgress`）、`LNK-04 task_object` 关联（`linkTaskObject` / `listTaskObjects`）；再导出 `../tool-executor/task-state.js` 的任务态写入面 | ✅ 已建 2026-09-19 |
| `goal.js` | **F-01 研究目标登记与口径管理**：`MD-01` 身份 + `MD-02` 六要素**定版式版本化**（保存为新版本 / 应用配置 / 历史只读）、`MD-03` 材料登记与**逻辑删除**、`CFG-05` 规则驱动的**口径检查** → `PD-04` 待补项、待补项补充后**并入六要素并 bump 新版本**、`goal_check` 任务（2 步）创建与完成 | ✅ F-01 已建 2026-09-19（88 断言全绿） |
| `schedule.js` | **F-02 机会发现任务调度**：`CFG-04` 运行策略登记（**写入侧从严**）与选取（目标级优先 → 回落平台级）、运行频率 → **Cron Triggers 表达式**解析与校验（四式 / 最小粒度 1 分钟 / 250 条上限）、`MD-13`+`MD-14` 能力版本快照、Queue 消息守卫与**可注入 `enqueue` 端口**、`createDiscoveryTask`（建任务 → `LNK-04` → 五步 → `CFG-06` 上下文 → 发消息）、`delegateToAgent` 调用守卫 | ✅ F-02 已建 2026-09-19（86 断言全绿） |
| `test-f01.mjs` | F-01 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子） | ✅ 已建（**88 断言全绿**） |
| `test-f02.mjs` | F-02 用例执行器（注入 spy `enqueue`；断言频率解析四式与反例、平台上限、策略选取、消息形状、五步与上下文装配） | ✅ 已建（**86 断言全绿**） |

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

### 8. HTTP 路由面（F-01 / F-02，经 `../api/index.js`）

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

> `GET /api/run-policy`（单数）是 **F-26 在 M5 侧的重试口径入口**，与本模块的 `/api/run-policies`（复数、管理面）
> **并存不冲突**：前者回答「这次重试几次」，后者回答「这条策略怎么配、翻成什么 Cron」。

## 已知口径 / 实测注意（本模块相关）

- **`task_stage` 由 `task_type` 推出**（`TASK_TYPE_STAGE`）：`goal_check`→`M1`、`discovery`→`M3`、
  `hva_research`/`hva_followup`→`M4`——对齐种子既有任务的 `task_stage` 取值。
- **`progress_text` 由 `PD-02` 现状重算**（`<已完成步数> / <总步数> 步`），不是手工维护的字符串。
- **种子基线**：`task_step` / `goal_gap` / `research_proposal` / `context_injection` 四表种子均为 **0 行**，
  由本模块写入；`task` 7 行、`task_object` 11 行、`followup_message` 2 行为只读基线。
- **本模块零外部调用**：`test-f01.mjs` / `test-f02.mjs` 静态断言本目录不出现 `fetch(` / `http(s):`。
- **发现任务的 `opp_summary` 首次为空是正常的、不阻断**：一个刚登记、还没跑过发现的目标，`CFG-06` 的
  `opp_summary`（已有机会摘要）自然为空 → `buildTaskContext` 会把它记进 `missing_required`。本模块**如实回报、
  不阻断启动**（否则新目标永远起不了第一次发现）。这是有意的：`missing_required` 是**提示面**，不是门禁面。
- **`createLocalEnqueue` 的投递痕迹落在 `PD-02` 的 `step_state`**（`pending→active`），不在新表——
  `task_step` 的步骤流转本身就是「这一步被投递出去了」的白盒证据（阶段3 的表清单里没有投递表，未擅自增表）。

## 反向清单

- **上游（我来自哪）**：`../README.md`（server 枝杈登记）｜`AGENTS.md`（`server/` 状态位）｜
  `../../docs/04-plan/dev-plan.md` 阶段 3 · M1｜`../../docs/02-prd/PRD-M1-平台任务程序.md`｜
  `../../docs/03-locks/schema.md`｜`../../docs/03-locks/tech-stack.md` §2.4 / §4.2｜
  `../../docs/05-test-cases/test-M1.md`｜`../../prototype/pages/tasks.html` / `../../prototype/assets/data.js`（钉死需求）
- **下游（我被谁引用）**：`../api/index.js`（**F-01 与 F-02 路由**）｜阶段4 `../agent-orchestrator`（消费任务与上下文）｜
  阶段5 `frontend/`（F-27 目标配置页经 `api` 取数）
  > 反向清单**只记既有事实**：本目录内 F-03~F-06 的引用关系在各自落地时补记（避免出现对未建文件的悬空引用）。
- **文件间引用（本目录内，既有）**：`./step-plan.js` 被 `./goal.js` 与 `./schedule.js` 引用；
  `./schedule.js` 被 `../api/index.js` 引用
- **共用件（我复用谁）**：`../tool-executor/task-state.js`（任务态 / 受阻 / 已完成部分的**唯一写入面**，F-26 已落地）｜
  `../shared-context/index.js`（F-12 上下文注入，F-02/F-04 调用）
- **登记**：`.github/workflows/ci.yml`（`validate` 步骤）｜`../../docs/03-locks/schema.md` §12（Q-13）
