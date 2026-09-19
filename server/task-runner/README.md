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
> ｜ `../../prototype/pages/tasks.html`（**`TYPE_STEPS` 钉死需求**）｜`../../prototype/assets/data.js`（**`gapRules`/`checkGaps` 钉死需求**）｜`../../prototype/pages/goal.html`｜`../../prototype/pages/propose.html`（**F-29 页：研究问题检查三条提示、幂等键四字段、「只补问题不重填材料」、拒空问题——钉死需求**）
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
| `proposal.js` | **F-03 研究建议管理（人工节点）**：`MD-12` 建议登记（研究问题**必需**、两个可选列按 `varchar(300)` 口径拒超长）、**幂等键**（机会+问题+假设+限制 → SHA-256 摘要，`UK` 落地「同键不新建、不重复启动相同任务」）、**建议与机会版本绑定**（版本号从机会现读、入参不符即拒）、研究问题的**不明确提示**（只补问题、不重填材料，**不阻断**）、机会状态迁移「候选→已提交研究」并留 `PD-05`（改行经 F-10 单一写入面）、`markProposalTriggered` 触发登记守卫 | ✅ F-03 已建 2026-09-19（82 断言全绿） |
| `test-f01.mjs` | F-01 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子） | ✅ 已建（**88 断言全绿**） |
| `test-f02.mjs` | F-02 用例执行器（注入 spy `enqueue`；断言频率解析四式与反例、平台上限、策略选取、消息形状、五步与上下文装配） | ✅ 已建（**86 断言全绿**） |
| `test-f03.mjs` | F-03 用例执行器（断言幂等键确定性/空白不敏感/区分度与分隔符歧义反例、问题检查、版本绑定、幂等提交、状态迁移与 `PD-05` 留痕、`PD-05` 外键 L3 反例、触发登记守卫、读模型、写入面静态核验） | ✅ 已建（**82 断言全绿**） |

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

> 幂等命中回 **200 而非 409**：重复提交不是错误，是「同一份建议」的正常结局（`TC-I-M1-002` 要的是
> 「不重复启动相同任务」，不是「报错」）。故用 `created` 字段区分，让调用方能分辨「新建了」与「命中了既有」。

> `GET /api/run-policy`（单数）是 **F-26 在 M5 侧的重试口径入口**，与本模块的 `/api/run-policies`（复数、管理面）
> **并存不冲突**：前者回答「这次重试几次」，后者回答「这条策略怎么配、翻成什么 Cron」。

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
  由本模块写入；`task` 7 行、`task_object` 11 行、`followup_message` 2 行为只读基线。
- **本模块零外部调用**：`test-f01.mjs` / `test-f02.mjs` / `test-f03.mjs` 静态断言本目录不出现 `fetch(` / `http(s):`。
- **建议的写入口径**：F-03 的登记（`submitProposal`）**只新增** `MD-12` 行、**从不改**已有建议行
  （改行仅用于 `triggered_task_id` 的登记，且带主键条件）；「事后改建议」不在需求内——
  要改研究问题，就是**另一份建议**（新键、新行），历史建议与它触发的任务都保留。
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
- **下游（我被谁引用）**：`../api/index.js`（**F-01 / F-02 / F-03 路由**）｜阶段4 `../agent-orchestrator`（消费任务与上下文）｜
  阶段5 `frontend/`（F-27 目标配置页经 `api` 取数）
  > 反向清单**只记既有事实**：本目录内 F-04~F-06 的引用关系在各自落地时补记（避免出现对未建文件的悬空引用）。
- **文件间引用（本目录内，既有）**：`./step-plan.js` 被 `./goal.js`、`./schedule.js` 与 `./proposal.js` 引用；
  `./schedule.js` 与 `./proposal.js` 被 `../api/index.js` 引用
- **共用件（我复用谁）**：`../tool-executor/task-state.js`（任务态 / 受阻 / 已完成部分的**唯一写入面**，F-26 已落地）｜
  `../shared-context/index.js`（F-12 上下文注入，F-02/F-04 调用；**F-03 另复用其 F-10 的 `changeOpportunityStatus` /
  `listOpportunityStatusLog`**——机会状态的改行只此一处，本目录不重写）
- **登记**：`.github/workflows/ci.yml`（`validate` 步骤）｜`../../docs/03-locks/schema.md` §12（Q-13/Q-14）
