# schema.md · 数据库表结构锁定

> 三项锁定之一（另两项：`external-deps.md` 外部依赖、`tech-stack.md` 技术栈）。
> 本文件锁死「哪些概念建表、表怎么切、字段叫什么、字段口径是什么」，是建表迁移与全 mock 种子数据的唯一依据。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 文档编号 | LOCK-SCHEMA-001 |
| 版本 | v1.1（2026-09-18）｜ v1.0 同日首次建立；v1.1 落地宪法编号裁决（`R-xx` 归研究结果编号、宪法升 v1，见 §0.7），并按「双向引用」重写尾部引用卡（区分「已实际引用」与「预计引用」） |
| 状态 | 草稿，待 PM 评审 |
| 上游约束 | `../../AGENTS.md`（白盒原则｜编号体系｜双向引用｜术语口径）｜`../BRD.md`（M1–M6 × F-01~F-32） | 
| 事实来源 | `../../prototype/assets/data.js`（全站唯一 mock 数据源：目标 / 机会 / 证据 / 研究 / 任务 / 追问）｜`../../prototype/assets/app.js`（跨页同口径的解析逻辑） |
| 交付物 | `db/` 建表迁移与全 mock 种子数据（本文件字段表即其字段清单） |
| 适用范围 | 京东超市单一频道，不做全局 |

## 0. 设计总则

### 0.1 三类归属（对应要求 1）

| 归属 | 处理方式 | 本文件落点 | 举例 |
| ---- | ---- | ---- | ---- |
| **本系统原生** | 建表，字段完整 | 维度一 主数据、维度二 过程数据、维度四 关联表 | 目标、机会、研究、任务、发现、改善方向 |
| **外部系统** | **只存来源引用 + 查询快照（来源系统·查询条件·信息时点·适用范围），不建业务主表** | 维度五 外部系统引用快照 | CDP 不建「用户标签主表」，只存「我查过什么、条件是什么、什么时候查的、返回了什么、缺什么」 |
| **本系统维护配置** | 建表（它约束 Agent 能查什么） | 维度三 配置数据 | 来源登记、工具注册、任务权限、运行策略、口径检查规则、上下文注入模板 |

**一句话口径**：外部系统的业务数据**进平台即降级为快照**；平台只对「查过什么」负责，不对「外部世界长什么样」负责。

### 0.2 维度划分（对应要求 2）

```
维度一 主数据 MD   —— 跨任务复用的研究对象（目标、机会、研究、发现、候选行为…）
维度二 过程数据 PD —— 一次运行产生、带时间线的执行痕迹（任务、步骤、受阻、注入、消息）
维度三 配置数据 CFG —— 本系统维护配置，约束 Agent 能查什么、能怎么跑
维度四 关联表 LNK  —— 多对多关系与其上的语义（依据 / 去重 / 归属）
维度五 外部引用 EXT —— 外部系统只存「来源引用 + 查询快照」
```

共 **36 张表**：MD 14 ｜ PD 7 ｜ CFG 8 ｜ LNK 4 ｜ EXT 3。

### 0.3 字段规格说明（对应要求 3）

每张表按固定六列展开，语义如下：

| 列 | 说明 |
| ---- | ---- |
| 字段 | 物理字段名（全库唯一命名，见 §8） |
| 类型 | 通用 SQL 类型；**具体方言与字符集由 `tech-stack.md` 锁定，本文件不裁决** |
| 是否可空 | `N` = NOT NULL；`Y` = NULLABLE |
| 口径 | 用中文说清**这个字段算什么**，不写「见某某」 |
| 唯一性 / 值域 | `PK` 主键 ｜ `FK → 表号` 外键 ｜ `UK(…)` 唯一约束 ｜ `dict:XXX` 走字典表 CFG-07/08 |
| 服务功能点 | F-xx（BRD 功能点编号，是主键） |

### 0.4 四条通用建表约定

1. **业务编号做主键**：`GOAL-` / `OPP-` / `R-` / `T-` / `Q-` / `EV-` / `MAT-` 这类可读编号直接作主键，便于跨目录双向引用与人工回查；字典表与关联表用自增主键。
2. **状态字段一律带实体前缀**：`goal_status` / `task_status` / `opportunity_status` / `research_status` / `source_status`。全库不允许出现裸的 `status`（见 §8.2）。
3. **时点字段一律带语义**：`created_at`（入库）/ `queried_at`（取数）/ `info_time_point`（证据信息时点）/ `focus_period`（目标关注时段）。四者不可互相顶替。
4. **不复制外部指标数值为可计算字段**：证据与查询快照里的结果**以文本原样保留**（如「搜索进入新客复购率 18.4%，推荐位进入 26.1%」），不拆成 decimal。理由：数值口径来自外部系统，拆数会诱导下游「用本地数字重算」，违背「不能用模型预期替代查询结果」。

### 0.5 本轮命名裁决记录（对应要求 2 的「找我确认」）

| 岔路 | 裁决 | 影响面 |
| ---- | ---- | ---- |
| 「研究」实体怎么落 | **统一口径，只用 `R-xxx`**。`ST-xxx` 内部编号**全库弃用**；研究主体表 `research`，主键即 `research_no`（R-007） | 原型的 `studies[ST-007].studyNo = R-007` 双编号收敛为一；所有下游引用改指 R-xxx |
| 「证据」与「查询记录」 | **分两张表**：`query_record`（每次执行留痕，含失败/重试/受限）→ `evidence`（结构化依据，回指 `query_id`） | EXT-01 与 EXT-02 |
| 「目标配置」表名 | **`research_goal` + `research_goal_version`** | MD-01 / MD-02 |
| 状态/枚举值域 | **建字典表** `dict_type` + `dict_item`，所有状态/类型字段走 `dict:XXX` | CFG-07 / CFG-08 |

### 0.6 与原型数据结构的映射与弃用

| 原型（`assets/data.js` / `app.js`） | 落库后 | 理由 |
| ---- | ---- | ---- |
| `goal.version = "v3"` 字符串 | `version_no = 3`（int），展示层拼 `v` | 整数才可比较、可排序 |
| `goal.fields.{businessGoal, metricDef, scope, period, constraints, provider}` | MD-02 的六个具名列 | 字段化后口径可逐列校验（配合 CFG-05） |
| `goal.materials[]` + `materialsRemoved` | MD-03 `is_active` | 移用逻辑删除，保留历史 |
| `task.ref`（文本，如 `ST-007 · 追问（F-22）`） | `goal_id` + LNK-04 `task_object` | 文本引用无法回认，是「任务归属串掉」的根因 |
| `task.agentVersion`（组合串） | `agent_profile_id` + `agent_version_snapshot` | 组合串不可查、不可比对 |
| `evidence.sourceName`（文本） | `source_id` 外键 → CFG-01 | 来源名全库只认一份 |
| `oppStatus` / `navUnread`（localStorage） | 前者 → MD-06 + PD-05；**后者不建表** | 未读绿点是前端会话态，BRD 无对应功能点 |
| `DB.applied`（当前生效配置） | MD-02 `is_applied` + `applied_at` | 生效态落到版本行上 |

### 0.7 与宪法编号体系的冲突（**已裁决，宪法已升 v1**）

`AGENTS.md` 现为 **v1**（2026-09-18）。其关键规则载明：**编号体系**＝ M1–M6 模块 ｜ F-xx 功能点 ｜ `REQ-xx` 需求条目 ｜ `R-xx` 研究结果对外编号 ｜ `S-Ax/S-Bx` Skill ｜ PRD-Mx 子 PRD ｜ ADR-xxx 决策。此前核对出的两处冲突均已裁决：

| 冲突 | 宪法原口径 | 本文件口径 | 裁决与落地 |
| ---- | ---- | ---- | ---- |
| **`R-xx` 被两用** | `R-xx` = **需求条目** | `R-xxx` = 研究结果对外编号（§0.5 第 1 条裁决、MD-07 `research_no`） | **已裁决**（2026-09-18）：`R-xx` 让给研究结果对外编号，宪法侧「需求条目」改用 `REQ-xx`。全库检索确认「需求条目」原用法零实例，仅为保留占位。**宪法已改版至 v1**，旧版归档 `.trash/AGENTS.md-v0.md`。本文件无需改动，口径与 MD-07 一致 |
| **Skill 编号未对齐** | `S-Ax/S-Bx` | 原写自由文本 `clue-scan` / `hva-five-checks` 并作主键 | **已修正**：MD-14 增 `skill_no` 承载 `S-Ax/S-Bx` 并作主键，原型代码名降为 `skill_code`（UK）。具体映射待确认（§12 Q-07）：`clue-scan` → `S-A1`（M3 机会发现 Agent）、`hva-five-checks` → `S-B1`（M4 HVA 分析 Agent） |

> **另注（已裁决）**：`AGENTS.md` 原小节标题为「两条硬红线」，但正文只列出 1 条（白盒原则）。2026-09-18 裁决：**标题收敛为「一条硬红线」，与正文实际条数一致**，不补写第 2 条。宪法 v1 已落地。

## 1. 表清单总览

### 维度一 · 主数据（MD）

| 表号 | 表名 | 职责 | 服务功能点 |
| ---- | ---- | ---- | ---- |
| MD-01 | `research_goal` | 研究目标身份（跨版本稳定） | F-01 F-02 F-27 |
| MD-02 | `research_goal_version` | 目标版本（六要素快照 + 生效标记） | F-01 F-27 |
| MD-03 | `goal_material` | 目标关联材料 | F-01 F-27 |
| MD-04 | `business_context` | 业务背景（知识 / 约束 / 口径说明） | F-07 F-12 |
| MD-05 | `touchpoint` | 触点清单 | F-07 F-12 F-14 |
| MD-06 | `opportunity` | 机会记录（六要素 + 状态） | F-10 F-14 F-16 F-28 F-32 |
| MD-07 | `research` | 研究主体（编号 R-xxx，含七要素中的 ①②④⑥） | F-11 F-19 F-21 F-22 F-30 |
| MD-08 | `research_finding` | 关键发现（七要素 ③ 的条目） | F-20 F-21 F-30 |
| MD-09 | `candidate_behavior` | 候选行为（七要素 ⑤） | F-20 F-21 F-30 |
| MD-10 | `behavior_point` | 候选行为支持 / 不支持条目 | F-20 F-21 F-30 |
| MD-11 | `improvement_action` | 改善方向（七要素 ⑦） | F-21 F-30 |
| MD-12 | `research_proposal` | 研究建议（人工节点产物，含幂等键） | F-03 F-17 F-29 |
| MD-13 | `agent_profile` | Agent 角色指令（agent.md）登记 | F-13 F-18 |
| MD-14 | `skill_registry` | Skill 能力登记 | F-13 F-18 |

### 维度二 · 过程数据（PD）

| 表号 | 表名 | 职责 | 服务功能点 |
| ---- | ---- | ---- | ---- |
| PD-01 | `task` | 任务主体（类型 / 状态 / 启动依据 / 进度） | F-02 F-04 F-06 F-32 |
| PD-02 | `task_step` | 任务步骤（口径检查 2 步、机会发现 5 步…） | F-06 F-32 |
| PD-03 | `task_block` | 任务受阻记录（F-06 受阻矩阵六种情况） | F-06 F-26 F-32 |
| PD-04 | `goal_gap` | 目标口径待补项 | F-01 F-27 F-32 |
| PD-05 | `opportunity_status_log` | 机会状态变更日志 | F-10 F-28 |
| PD-06 | `context_injection` | 上下文注入记录（按任务实际注入了什么） | F-12 F-31 |
| PD-07 | `followup_message` | 追问对话消息 | F-31 F-22 |

### 维度三 · 配置数据（CFG）

| 表号 | 表名 | 职责（**它约束 Agent 能查什么**） | 服务功能点 |
| ---- | ---- | ---- | ---- |
| CFG-01 | `source_registry` | 外部来源登记（可查 / 不可查 / 可用性） | F-08 F-12 F-23 |
| CFG-02 | `tool_registry` | MCP 工具注册（工具 → 来源） | F-23 F-24 |
| CFG-03 | `tool_permission` | 任务 / Agent 的工具权限与调用条件 | F-23 F-26 |
| CFG-04 | `run_policy` | 运行策略（频率 / 时长 / 调用限制 / 重试上限） | F-02 F-06 F-26 |
| CFG-05 | `gap_rule` | 口径检查规则 | F-01 F-27 |
| CFG-06 | `context_template` | 上下文注入模板（按任务类型定注入哪些类型） | F-12 F-31 |
| CFG-07 | `dict_type` | 字典类型 | 全库值域 |
| CFG-08 | `dict_item` | 字典项 | 全库值域 |

### 维度四 · 关联表（LNK）

| 表号 | 表名 | 关系 | 服务功能点 |
| ---- | ---- | ---- | ---- |
| LNK-01 | `opportunity_evidence` | 机会 ↔ 证据（多对多，带语义：初步依据 / 关联更新） | F-09 F-10 F-15 F-28 |
| LNK-02 | `finding_evidence` | 关键发现 ↔ 证据（多对多） | F-09 F-21 F-30 |
| LNK-03 | `opportunity_relation` | 机会 ↔ 机会（去重与取代） | F-16 |
| LNK-04 | `task_object` | 任务 ↔ 研究对象（启动对象 / 产出对象） | F-02 F-04 F-06 F-32 |

### 维度五 · 外部系统引用快照（EXT）

| 表号 | 表名 | 职责 | 服务功能点 |
| ---- | ---- | ---- | ---- |
| EXT-01 | `query_record` | 查询记录：每次工具执行留痕（真实返回 / 失败 / 重试 / 受限） | F-24 F-25 F-26 |
| EXT-02 | `evidence` | 证据：来源 + 查询条件 + 信息时点 + 适用范围 + 缺失说明 | F-09 F-15 F-20 F-21 |
| EXT-03 | `external_validation` | 外部验证结果引用（业务侧验证后回关联） | F-11 |

## 2. 维度一 · 主数据（MD）

### MD-01 `research_goal` 研究目标

> 职责：一套研究目标的身份。跨版本稳定——六要素的每次变化落在 MD-02，不在这里改写历史。
> 对应原型：`DB.goals.list[i].id / seq`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `goal_id` | varchar(32) | N | 研究目标唯一标识，也是页面下拉里展示的「目标 ID」 | PK；形如 `GOAL-2026Q3-01` | F-01 F-27 |
| `goal_seq` | int | N | 目标配置在列表中的展示序号，决定下拉里「1 · / 2 · …」的排序 | UK；全库唯一，正整数 | F-27 |
| `current_version_no` | int | N | 该目标当前生效的版本号，指向最近一次保存的六要素版本 | ≥1；FK 逻辑指向 MD-02 | F-01 F-27 |
| `goal_status` | varchar(16) | N | 目标生命周期状态：是否仍在用，还是已归档 | dict:GOAL_STATUS | F-01 |
| `created_at` | datetime | N | 目标首次登记的时点 | — | F-01 |
| `created_by` | varchar(64) | N | 目标登记人（业务方提供方，如「超市事业部运营组 · 张运营」） | — | F-01 |

### MD-02 `research_goal_version` 研究目标版本（六要素快照）

> 职责：一次保存形成一行完整快照。**目标更新不改旧行**，新版本新增一行——这是 F-01「已有研究保留启动时采用的目标和范围」的存储基础。
> 对应原型：`goal.fields` + `goal.version` + `goal.versions[]`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `goal_version_id` | varchar(40) | N | 目标版本唯一标识 | PK；建议 `goal_id + "-v" + version_no` | F-01 |
| `goal_id` | varchar(32) | N | 所属研究目标 | FK → MD-01 | F-01 |
| `version_no` | int | N | 版本序号，页面展示为 v1 / v2 / v3 | UK(goal_id, version_no) | F-01 F-27 |
| `business_goal` | varchar(200) | N | ① 业务目标：业务方要改善的业务结果，如「提升京东超市新客 30 天复购率」 | — | F-01 F-27 |
| `metric_definition` | text | N | ② 指标口径：指标的精确定义与计算方式（新客怎么算、复购怎么算、是否剔除退款）。**留空即产生口径待补项，平台不代填** | — | F-01 F-27 |
| `business_scope` | varchar(300) | N | ③ 业务范围：频道 / 渠道 / 品类边界，如「主站频道；品类限粮油调味、乳品烘焙、个护清洁」 | — | F-01 F-27 |
| `focus_period` | varchar(100) | N | ④ 关注时段：取数窗口的起止日期，如 `2026-07-01 ~ 2026-09-15` | — | F-01 F-27 |
| `known_constraints` | text | N | ⑤ 已知约束：已知会影响取数或解读的限制，如「大促期间流量结构偏移，需单独观察，不与日常合并」 | — | F-01 F-27 |
| `provider` | varchar(100) | N | ⑥ 提供方：目标与材料的来源方 | — | F-01 F-27 |
| `change_note` | varchar(200) | N | 本版本相对上一版本的变更说明；v1 写「首次登记」 | — | F-01 F-27 |
| `impact_note` | text | N | 变更影响范围：影响哪些在研 / 已归档研究，如「影响 2 个在研研究（R-007、R-006）：新时段需补查流量证据」 | — | F-01 F-27 |
| `is_applied` | tinyint | N | 是否为该目标当前生效配置（点「应用配置」后置 1） | 0/1；同一 `goal_id` 至多一行为 1 | F-02 F-27 |
| `applied_at` | datetime | Y | 该版本被应用（触发机会发现）的时点；未应用为空 | — | F-27 |
| `created_at` | datetime | N | 本版本保存时点 | — | F-01 |
| `created_by` | varchar(64) | N | 本版本保存人 | — | F-01 |

### MD-03 `goal_material` 目标材料

> 职责：目标六要素中 ⑥ 的材料部分。可增删；**移除是逻辑删除**，保留历史。
> 对应原型：`goal.materials[]` + `materialsRemoved`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `material_id` | varchar(32) | N | 材料唯一标识 | PK；形如 `MAT-01` / `MAT-U1726…` | F-01 F-27 |
| `goal_id` | varchar(32) | N | 材料挂在哪套目标下 | FK → MD-01 | F-01 |
| `material_name` | varchar(200) | N | 材料名称，如「Q3 运营目标拆解表 v2」 | — | F-01 F-27 |
| `material_kind` | varchar(16) | N | 材料类型 | dict:MATERIAL_KIND | F-01 F-27 |
| `material_at` | varchar(20) | N | 材料自身日期（业务方口径），区别于入库时间 | — | F-27 |
| `material_from` | varchar(64) | N | 材料来源：业务方提供 / 本地选取 / 手动登记 | dict:MATERIAL_FROM | F-01 F-27 |
| `is_active` | tinyint | N | 是否仍关联；移除后置 0，不物理删除 | 0/1 | F-27 |
| `registered_at` | datetime | N | 材料登记入库时点 | — | F-01 |

### MD-04 `business_context` 业务背景

> 职责：F-07 的背景库——目标与口径之外的业务知识与约束。Agent 查询前据此知道「该往哪个方向查」。
> 平台级背景（不挂目标）`goal_id` 留空。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `context_id` | varchar(32) | N | 业务背景条目唯一标识 | PK | F-07 |
| `goal_id` | varchar(32) | Y | 该背景条目服务的目标；平台级通用背景为空 | FK → MD-01 | F-07 F-12 |
| `context_kind` | varchar(16) | N | 背景类型：业务知识 / 业务约束 / 口径说明 | dict:CONTEXT_KIND | F-07 |
| `title` | varchar(120) | N | 条目标题 | — | F-07 |
| `content` | text | N | 背景正文：业务知识与约束的具体内容 | — | F-07 F-12 |
| `source_ref` | varchar(200) | N | 来源引用：本条目来自哪份材料或哪次查询 | — | F-07 |
| `is_active` | tinyint | N | 是否生效 | 0/1 | F-07 |
| `created_at` | datetime | N | 登记时点 | — | F-07 |

### MD-05 `touchpoint` 触点清单

> 职责：F-07 的触点清单（首页推荐位、搜索结果页、京东超市频道…）。它是 F-12「范围」维度的取值集合——机会与证据的适用范围只能从这份清单里选，Agent 不得自造触点。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `touchpoint_id` | varchar(32) | N | 触点唯一标识 | PK | F-07 |
| `touchpoint_name` | varchar(64) | N | 触点名称，如「首页推荐位」「搜索结果页」 | UK | F-07 F-14 |
| `channel` | varchar(64) | N | 触点所属频道 / 渠道，如「京东超市频道」 | — | F-07 F-12 |
| `position_desc` | varchar(120) | N | 位置说明：该触点在页面或链路中的位置 | — | F-07 |
| `is_active` | tinyint | N | 是否在册 | 0/1 | F-07 |
| `created_at` | datetime | N | 登记时点 | — | F-07 |

### MD-06 `opportunity` 机会记录

> 职责：F-10 机会六要素 + 状态。**暂不研究的机会仍保留记录**（状态置 deferred，不删除）。
> 对应原型：`DB.opportunities[]`。原型里的 `basis`（文本）与 `evidences[]`（数组）在此拆开：文字说明进 `initial_basis_note`，证据关联走 LNK-01。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `opportunity_id` | varchar(24) | N | 机会唯一标识 | PK；形如 `OPP-014` | F-10 F-28 |
| `goal_id` | varchar(32) | N | 该机会对应哪个目标 | FK → MD-01 | F-10 F-28 F-32 |
| `goal_version_no` | int | N | 产出该机会时依据的目标版本号（快照，不随目标更新而变） | 逻辑关联 MD-02 | F-10 F-28 |
| `opportunity_title` | varchar(200) | N | 机会标题（一句话现象概括） | — | F-10 F-28 |
| `opportunity_status` | varchar(16) | N | 机会状态：候选 / 暂不研究 / 已提交研究 | dict:OPP_STATUS | F-10 F-28 F-32 |
| `target_object` | varchar(300) | N | 六要素·涉及对象：人群、品类或旅程环节，如「人群：2026Q3 首次下单新客 ｜ 旅程环节：首单履约后 ~ 复购前」 | — | F-10 F-28 |
| `phenomenon` | text | N | 六要素·观察现象：观察到的事实，只写现象不下结论 | — | F-10 F-28 |
| `initial_basis_note` | text | N | 六要素·初步依据的文字说明（资料或查询的来源与时点）；结构化证据走 LNK-01 | — | F-10 F-28 |
| `research_reason` | text | N | 六要素·研究理由：为什么这个问题值得追问 | — | F-10 F-28 |
| `unknown_item` | text | N | 六要素·未知项：当前查不清、会影响判断的内容 | — | F-10 F-28 |
| `defer_reason` | text | Y | 暂不研究的原因；仅 `opportunity_status = deferred` 时填写，且记录保留后可再选 | — | F-10 F-28 |
| `producing_task_id` | varchar(24) | Y | 产出该机会的机会发现任务；原型 `fromTask` | FK → PD-01 | F-10 F-32 |
| `created_at` | datetime | N | 机会形成时点 | — | F-10 |

### MD-07 `research` 研究

> 职责：F-11 / F-19 / F-21 / F-22。研究主体，承载七要素中的 ①业务目标与研究问题 ②研究范围与方法 ④人群差异 ⑥其他解释与限制。
> **编号口径已裁决**：全库只用 `R-xxx`，原型的 `ST-xxx` 内部编号弃用。
> **追问不覆盖原研究**：追问形成新的 `research` 行，`parent_research_no` 指向原研究。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `research_no` | varchar(24) | N | 研究唯一编号，全库对外唯一口径 | PK；形如 `R-007` | F-11 F-30 |
| `opportunity_id` | varchar(24) | N | 本研究针对哪个机会 | FK → MD-06 | F-11 F-30 |
| `research_question` | text | N | 产品研究问题（PM 提交，必需），即七要素 ① 的问题部分 | — | F-03 F-19 F-30 |
| `e1_goal_statement` | text | N | 七要素 ① 的完整表述：业务目标 + 研究问题 | — | F-21 F-30 |
| `e2_scope_method` | text | N | 七要素 ② 研究范围与方法：研究范围、时间窗、所用方法与排查项 | — | F-21 F-30 |
| `e4_population_diff` | text | N | 七要素 ④ 人群差异：分组后的人群表现差异与差值 | — | F-21 F-30 |
| `e6_limits` | text | N | 七要素 ⑥ 其他解释与限制：未排除的替代解释、数据限制 | — | F-21 F-30 |
| `out_of_scope_note` | text | N | 本研究结论**不覆盖**的范围声明（如「活动玩法、权益组合、预算排期不在结论范围内」） | — | F-21 F-30 |
| `research_status` | varchar(16) | N | 研究状态：研究中 / 已完成 | dict:RESEARCH_STATUS | F-11 F-30 F-32 |
| `goal_id` | varchar(32) | N | 启动时快照的目标（**不随目标更新而变**） | FK → MD-01 | F-11 F-22 |
| `goal_version_no` | int | N | 启动时快照的目标版本号；后续目标更新不影响本研究 | 逻辑关联 MD-02 | F-11 F-22 |
| `behavior_hypothesis` | varchar(300) | Y | PM 提交的候选行为假设（可选）；**产品假设不预先作为研究结论** | — | F-19 |
| `population_limit` | varchar(300) | Y | PM 提交的人群限制（可选），如「仅限 APP 端；剔除大促时段」 | — | F-19 |
| `parent_research_no` | varchar(24) | Y | 追问链上的原研究编号；首个研究为空 | 自引用 FK → MD-07 | F-05 F-22 |
| `start_task_id` | varchar(24) | Y | 启动本研究的研究任务 | FK → PD-01 | F-04 F-11 |
| `finished_at` | datetime | Y | 研究完成时点；未完成为空 | — | F-11 F-30 |
| `created_at` | datetime | N | 研究创建时点（= 研究建议提交时刻） | — | F-04 F-11 |

### MD-08 `research_finding` 关键发现

> 职责：七要素 ③ 的条目化。**每项发现单独成行**，才能逐条挂证据（LNK-02）与逐条写限制。
> 对应原型：`studies[*].e3_findings[]`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `finding_id` | varchar(32) | N | 发现唯一标识 | PK | F-21 F-30 |
| `research_no` | varchar(24) | N | 所属研究 | FK → MD-07 | F-21 F-30 |
| `finding_text` | text | N | 发现正文：本研究查明的一条事实 | — | F-21 F-30 |
| `support_flag` | varchar(16) | N | 该项发现对研究问题是否构成支持 | dict:FINDING_SUPPORT | F-21 F-30 |
| `limit_note` | text | N | 该项发现的限制说明（读者据此分清「已查明」与「仍受限」） | — | F-21 F-30 |
| `order_no` | int | N | 展示顺序 | UK(research_no, order_no) | F-30 |

### MD-09 `candidate_behavior` 候选行为

> 职责：七要素 ⑤。术语红线——**研究完成前一律称「候选行为」**；即使最终获得支持，本表也不改名，只改状态。
> 对应原型：`studies[*].e5_hva`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `candidate_id` | varchar(32) | N | 候选行为唯一标识 | PK | F-20 F-21 F-30 |
| `research_no` | varchar(24) | N | 所属研究 | FK → MD-07 | F-21 F-30 |
| `behavior_name` | varchar(300) | N | 候选行为名称，如「首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）」 | — | F-20 F-21 |
| `behavior_status` | varchar(24) | N | 支持情况：候选行为获得支持 / 未找到足够依据支持 | dict:BEHAVIOR_STATUS | F-21 F-30 F-32 |

### MD-10 `behavior_point` 候选行为支持情况条目

> 职责：把「支持的方面」与「不支持 / 存疑的方面」并列拆成行。**不支持也必须是完整合法的产出**。
> 对应原型：`e5_hva.supported[]` / `e5_hva.unsupported[]`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `point_id` | varchar(32) | N | 条目唯一标识 | PK | F-20 F-21 F-30 |
| `candidate_id` | varchar(32) | N | 所属候选行为 | FK → MD-09 | F-21 F-30 |
| `point_type` | varchar(16) | N | 条目立场：支持的方面 / 不支持或存疑的方面 | dict:BEHAVIOR_POINT_TYPE | F-21 F-30 |
| `point_text` | text | N | 条目正文 | — | F-21 F-30 |
| `order_no` | int | N | 同立场下的展示顺序 | UK(candidate_id, point_type, order_no) | F-30 |

### MD-11 `improvement_action` 改善方向

> 职责：七要素 ⑦。**逐项对应发现**——针对什么人群、什么问题、为什么值得改善。活动配置、权益组合、预算与排期不在其内（属 out of scope）。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `action_id` | varchar(32) | N | 改善方向条目唯一标识 | PK | F-21 F-30 |
| `research_no` | varchar(24) | N | 所属研究 | FK → MD-07 | F-21 F-30 |
| `target_for` | varchar(120) | N | 针对：面向哪个人群、哪个方向或研究本身 | — | F-21 F-30 |
| `problem_what` | varchar(200) | N | 问题：要改善的具体问题 | — | F-21 F-30 |
| `reason_why` | text | N | 为什么值得改善：与哪项发现对应、为什么它是前置环节 | — | F-21 F-30 |
| `order_no` | int | N | 展示顺序 | UK(research_no, order_no) | F-30 |

### MD-12 `research_proposal` 研究建议

> 职责：F-03 人工节点的产物。研究问题必需，假设与人群限制可选。
> **幂等**：同一份建议重复提交不重复启动任务——靠 `idempotency_key` 唯一约束落地。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `proposal_id` | varchar(32) | N | 研究建议唯一标识 | PK | F-03 F-29 |
| `opportunity_id` | varchar(24) | N | 被选中的机会（来自 F-28，此处不可改） | FK → MD-06 | F-03 F-29 |
| `goal_version_no` | int | N | 关联的目标版本号；建议与机会版本绑定，不混淆不同版本 | 逻辑关联 MD-02 | F-03 F-29 |
| `research_question` | text | N | 研究问题（**必需**） | — | F-03 F-29 |
| `behavior_hypothesis` | varchar(300) | Y | 候选行为假设（可选） | — | F-03 F-29 |
| `population_limit` | varchar(300) | Y | 人群限制（可选） | — | F-03 F-29 |
| `idempotency_key` | varchar(128) | N | 幂等键：机会 ID + 研究问题 + 假设 + 限制 的摘要；相同键视为同一份建议 | UK | F-03 F-29 |
| `submitted_at` | datetime | N | 提交时点（= 第二阶段启动时点） | — | F-03 F-04 F-29 |
| `submitted_by` | varchar(64) | N | 提交人（产品经理） | — | F-03 F-29 |
| `triggered_task_id` | varchar(24) | Y | 本次建议触发的 HVA 研究任务 | FK → PD-01 | F-04 F-29 |

### MD-13 `agent_profile` Agent 角色指令

> 职责：F-13 / F-18。agent.md 的登记与版本——定义「你是谁：本阶段职责、输入、输出与结束条件」。
> 对应原型：`task.agentVersion` 里的 `discovery-agent v1.2 / agent.md r9`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `profile_id` | varchar(32) | N | 角色指令唯一标识 | PK | F-13 F-18 |
| `agent_code` | varchar(32) | N | Agent 代码：机会发现 / HVA 分析 | dict:AGENT_CODE | F-13 F-18 |
| `agent_name` | varchar(64) | N | Agent 名称，如「机会发现 Agent」「HVA 分析 Agent」 | — | F-13 F-18 |
| `agent_stage` | varchar(8) | N | 所属模块阶段：M3 / M4 | — | F-13 F-18 |
| `current_version` | varchar(16) | N | 当前生效版本号，如 `v1.2` | — | F-13 F-18 |
| `doc_revision` | varchar(16) | N | agent.md 文档修订号，如 `r9` | — | F-13 F-18 |
| `is_active` | tinyint | N | 是否当前生效 | 0/1 | F-13 F-18 |

### MD-14 `skill_registry` Skill 能力登记

> 职责：与 agent.md（能干什么）、程序（能调什么）一起构成领域能力。任务是「能消费什么」。
> 对应原型：`skills: clue-scan v1.0` / `hva-five-checks v1.1`。
> **编号对齐宪法**：`AGENTS.md` 编号体系规定 Skill 为 `S-Ax/S-Bx`，故编号单独成列并做主键；原型里的 `clue-scan` / `hva-five-checks` 是代码名，降为 `skill_code`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `skill_no` | varchar(16) | N | Skill 编号（宪法编号体系）：S-Ax 归机会发现 Agent、S-Bx 归 HVA 分析 Agent | PK；形如 `S-A1` / `S-B1` | F-13 F-18 |
| `skill_code` | varchar(48) | N | Skill 代码名（运行时标识），如 `clue-scan` / `hva-five-checks` | UK | F-13 F-18 |
| `skill_name` | varchar(64) | N | Skill 名称 | — | F-13 F-18 |
| `version` | varchar(16) | N | Skill 版本号，如 `v1.1` | — | F-13 F-18 |
| `bound_agent_code` | varchar(32) | N | 绑定到哪个 Agent | FK → MD-13 `agent_code` | F-13 F-18 |
| `is_active` | tinyint | N | 是否当前生效 | 0/1 | F-13 F-18 |

## 3. 维度二 · 过程数据（PD）

### PD-01 `task` 任务

> 职责：F-06。每次任务保存启动依据、指令与能力版本、当前状态。
> **研究内容与运行状态分别记录**：本表只记运行状态，研究内容在 MD-07~MD-11。
> **停止状态不自动重启**：`is_auto_restart` 恒为 0。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `task_id` | varchar(24) | N | 任务唯一标识 | PK；形如 `T-1023` | F-02 F-06 F-32 |
| `task_type` | varchar(24) | N | 任务类型：口径检查 / 机会发现 / HVA 研究 / HVA 研究·追问 | dict:TASK_TYPE | F-01 F-02 F-04 F-06 |
| `task_stage` | varchar(8) | N | 所属模块阶段：M1 / M3 / M4 | — | F-32 |
| `goal_id` | varchar(32) | N | 任务归属的目标（**归属只认本字段，不靠「当前生效目标」兜底**） | FK → MD-01 | F-06 F-32 |
| `goal_version_no` | int | N | 启动时采用的目标版本号快照 | 逻辑关联 MD-02 | F-06 F-32 |
| `task_status` | varchar(16) | N | 运行状态：运行中 / 受阻 / 已停止 / 已完成 | dict:TASK_STATUS | F-06 F-32 |
| `trigger_basis` | varchar(300) | N | 启动依据：谁在何时、为何创建本任务 | — | F-06 F-32 |
| `agent_profile_id` | varchar(32) | Y | 启动时使用的角色指令 | FK → MD-13 | F-06 F-13 F-18 |
| `agent_version_snapshot` | varchar(160) | N | 启动时的「指令 + 能力」版本快照（agent 版本 / agent.md 修订 / skills 版本） | — | F-06 F-13 |
| `progress_text` | varchar(16) | N | 进度展示串，如 `2 / 5 步` | — | F-32 |
| `done_part` | text | N | 已完成部分：受阻或停止时保留的已有工作 | — | F-06 F-32 |
| `started_at` | datetime | N | 任务启动时点 | — | F-06 F-32 |
| `ended_at` | datetime | Y | 任务结束时点；进行中为空 | — | F-06 F-32 |
| `parent_task_id` | varchar(24) | Y | 关联的原任务（追问 / 重跑）；首个任务为空 | 自引用 FK → PD-01 | F-05 F-22 F-26 |
| `retry_count` | int | N | 本任务已重试次数（代码驱动的重跑机制，非 AI 决策） | ≥0 | F-06 F-26 |
| `is_auto_restart` | tinyint | N | 是否允许自动重启；停止状态一律 0 | 固定 0 | F-06 |
| `created_at` | datetime | N | 任务创建时点 | — | F-06 |

### PD-02 `task_step` 任务步骤

> 职责：任务的分步计划与进度。口径检查 2 步、机会发现 5 步、HVA 研究 5 步、追问 5 步。
> 对应原型：`tasks.html` 的 `TYPE_STEPS` + `stepPlan()`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `step_id` | varchar(32) | N | 步骤唯一标识 | PK | F-06 F-32 |
| `task_id` | varchar(24) | N | 所属任务 | FK → PD-01 | F-06 F-32 |
| `step_no` | int | N | 步骤序号 | UK(task_id, step_no) | F-06 F-32 |
| `step_name` | varchar(120) | N | 步骤名称，如「载入目标与时间窗」「交叉验证候选行为」 | — | F-06 F-32 |
| `step_state` | varchar(16) | N | 步骤状态：待执行 / 进行中 / 已完成 / 受阻 | dict:STEP_STATE | F-06 F-32 |

### PD-03 `task_block` 任务受阻记录

> 职责：F-06 受阻处理矩阵的六种情况各成一类，逐次留痕（一个任务可多次受阻）。
> **运行失败本身不能作为否定某项研究依据**——本表只记运行侧事实。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `block_id` | varchar(32) | N | 受阻记录唯一标识 | PK | F-06 F-26 F-32 |
| `task_id` | varchar(24) | N | 受阻的任务 | FK → PD-01 | F-06 F-32 |
| `block_reason_code` | varchar(32) | N | 受阻原因（对应 F-06 矩阵「情况」列六种） | dict:BLOCK_REASON | F-06 F-32 |
| `block_note` | varchar(300) | N | 受阻的具体说明，如「等待 CDP 接口恢复（阻塞自 2026-09-16 10:02）」 | — | F-06 F-32 |
| `resume_condition` | varchar(200) | N | 继续研究的条件（矩阵「继续研究的条件」列） | — | F-06 |
| `blocked_at` | datetime | N | 受阻发生时点 | — | F-06 F-32 |
| `is_resolved` | tinyint | N | 是否已解除 | 0/1 | F-06 |

### PD-04 `goal_gap` 目标口径待补项

> 职责：F-01 口径检查任务的产出。**平台只列缺失，不替业务方定义**；补充后并入对应六要素字段并形成目标新版本。
> 对应原型：`checkGaps()` 的返回项 + `goalFixes`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `gap_id` | varchar(32) | N | 待补项唯一标识 | PK | F-01 F-27 F-32 |
| `goal_id` | varchar(32) | N | 所属目标 | FK → MD-01 | F-01 F-27 |
| `goal_version_no` | int | N | 发现该待补项时对应的目标版本号 | 逻辑关联 MD-02 | F-01 F-27 |
| `rule_id` | varchar(24) | N | 由哪条检查规则命中产生 | FK → CFG-05 | F-01 F-27 |
| `target_field` | varchar(24) | N | 待补内容归属的六要素字段 | dict:GOAL_FIELD | F-01 F-27 |
| `gap_text` | varchar(200) | N | 待补内容：需要业务方明确的具体事项 | — | F-01 F-27 |
| `impact_note` | varchar(200) | N | 影响的判断：这项口径不清会影响哪个判断 | — | F-01 F-27 |
| `raised_at` | datetime | N | 提出时点 | — | F-27 |
| `raised_by_task_id` | varchar(24) | N | 由哪次口径检查任务提出 | FK → PD-01 | F-01 F-32 |
| `filled_value` | text | Y | 业务方补充的确认内容；未补为空 | — | F-27 |
| `filled_at` | datetime | Y | 补充时点 | — | F-27 |
| `filled_by` | varchar(64) | Y | 补充人 | — | F-27 |
| `is_solved` | tinyint | N | 是否已补充（补充后不再重复列出） | 0/1 | F-27 |

### PD-05 `opportunity_status_log` 机会状态变更日志

> 职责：F-10 / F-28。机会的状态迁移逐次留痕——「暂不研究的机会仍保留记录，条件变化或新证据后可再选」需要这条链可回查。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `log_id` | varchar(32) | N | 变更日志唯一标识 | PK | F-10 F-28 |
| `opportunity_id` | varchar(24) | N | 被改状态的机会 | FK → MD-06 | F-10 F-28 |
| `from_status` | varchar(16) | Y | 变更前状态；首次登记为空 | dict:OPP_STATUS | F-10 F-28 |
| `to_status` | varchar(16) | N | 变更后状态 | dict:OPP_STATUS | F-10 F-28 |
| `change_reason` | varchar(300) | N | 变更原因，如「经 PM 评估：该现象主要涉及权益配置，不属于候选行为研究范围」 | — | F-10 F-28 |
| `changed_at` | datetime | N | 变更时点 | — | F-10 |
| `changed_by` | varchar(64) | N | 变更人 | — | F-10 |

### PD-06 `context_injection` 上下文注入记录

> 职责：F-12。任务是「需要什么类型的信息 + 范围约束」，本表记录某任务**实际注入**了哪些对象。
> **初始化是确定性程序行为**：注入内容由 CFG-06 模板决定，不由 Agent 每回随机。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `injection_id` | varchar(32) | N | 注入记录唯一标识 | PK | F-12 F-31 |
| `task_id` | varchar(24) | N | 被注入的任务 | FK → PD-01 | F-12 F-31 |
| `context_type_code` | varchar(24) | N | 注入的信息类型 | dict:CONTEXT_TYPE | F-12 F-31 |
| `ref_object_type` | varchar(24) | N | 被注入对象所属的表类别 | dict:OBJECT_TYPE | F-12 F-31 |
| `ref_object_id` | varchar(40) | N | 被注入对象的主键值 | — | F-12 F-31 |
| `injected_at` | datetime | N | 注入时点 | — | F-12 F-31 |

### PD-07 `followup_message` 追问对话消息

> 职责：F-31。追问对话逐条留痕（PM / Agent 双向）。**必要信息可能需要 Agent 反过来问产品经理**——故 `message_role` 双向都在本表。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `message_id` | varchar(32) | N | 消息唯一标识 | PK | F-31 |
| `research_no` | varchar(24) | N | 挂在哪个研究下（追问在原研究上进行） | FK → MD-07 | F-31 F-22 |
| `task_id` | varchar(24) | N | 该消息所属的追问任务 | FK → PD-01 | F-31 F-05 |
| `message_role` | varchar(8) | N | 发言方：产品经理 / 智能体 | dict:MESSAGE_ROLE | F-31 |
| `message_text` | text | N | 消息正文 | — | F-31 |
| `created_at` | datetime | N | 发言时点 | — | F-31 |

## 4. 维度三 · 配置数据（CFG）

> 本维度的共同职责：**约束 Agent 能查什么、能怎么跑**。它是白盒原则在数据层的落点——Agent 的能力边界不写在提示词里，写在这几张表里。

### CFG-01 `source_registry` 外部来源登记

> 职责：F-08。五类外部系统与用途。
> **红线**：系统名称确定了信息归属，**实际可查内容需通过接入能力确认**——线上流量信息 ≠ 完整用户行为序列，活动信息 ≠ 活动效果。
> 对应原型：`DB.sources[]`。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `source_id` | varchar(16) | N | 来源系统唯一标识 | PK；dict:SOURCE_CODE（CDP/HJE/PIM/MKT/ACT） | F-08 F-24 F-25 |
| `source_name` | varchar(64) | N | 来源系统全称，如「CDP 用户标签系统」「黄金眼」「商品中台」「营销中台」「活动报名系统」 | UK | F-08 F-24 |
| `capability_can` | varchar(300) | N | 实际可查内容（经接入能力确认后填写） | — | F-08 F-12 |
| `capability_cannot` | varchar(300) | N | 不可查内容——**这是研究缺口的来源** | — | F-08 F-15 |
| `availability_status` | varchar(16) | N | 可用性：可用 / 降级 / 未接入 | dict:SOURCE_STATUS | F-08 F-23 |
| `is_mcp_ready` | tinyint | N | 是否已完成 MCP 化（未完成则不可被 Agent 调用） | 0/1 | F-23 |
| `registered_at` | datetime | N | 登记时点 | — | F-08 |
| `updated_at` | datetime | N | 最近更新时点 | — | F-08 |

### CFG-02 `tool_registry` 工具注册

> 职责：F-23。MCP 工具注册到 Agent。所有外部接口均已 MCP 化，执行是纯程序。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `tool_id` | varchar(32) | N | 工具唯一标识 | PK | F-23 F-24 |
| `tool_code` | varchar(64) | N | MCP 工具名（Agent 侧调用标识） | UK | F-23 F-24 |
| `tool_name` | varchar(64) | N | 工具中文名 | — | F-23 F-24 |
| `source_id` | varchar(16) | N | 该工具查的是哪个来源系统 | FK → CFG-01 | F-23 F-24 |
| `tool_purpose` | varchar(200) | N | 工具用途说明（供 Agent 判断何时该调它） | — | F-23 F-24 |
| `call_condition` | varchar(200) | N | 调用条件：满足什么前提才允许调 | — | F-23 |
| `is_enabled` | tinyint | N | 是否启用 | 0/1 | F-23 |

### CFG-03 `tool_permission` 任务权限与调用条件

> 职责：F-23。每次请求先检查当前任务权限与调用条件。
> **权限分支互斥**：允许 / 不允许；不允许时保存原因并返回受限原因。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `permission_id` | varchar(32) | N | 授权记录唯一标识 | PK | F-23 |
| `grantee_type` | varchar(16) | N | 授权对象类型：按 Agent / 按任务类型 | dict:GRANTEE_TYPE | F-23 |
| `grantee_ref` | varchar(32) | N | 授权对象取值（agent_code 或 task_type） | — | F-23 |
| `tool_id` | varchar(32) | N | 被授权的工具 | FK → CFG-02 | F-23 |
| `allow_flag` | tinyint | N | 是否允许（与不允许互斥，二者只能其一生效） | 0/1 | F-23 |
| `restrict_reason` | varchar(200) | Y | 不允许时保存的原因；允许时为空 | — | F-23 F-26 |
| `effective_from` | datetime | N | 生效起始 | — | F-23 |
| `effective_until` | datetime | Y | 生效截止；长期有效为空 | — | F-23 |

### CFG-04 `run_policy` 运行策略

> 职责：F-02 / F-06 / F-26。运行频率、时长、调用限制、重试上限——**这些由后端持有，原型不呈现**。
> **重试是代码逻辑不是 AI 决策**，故上限落在本表。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `policy_id` | varchar(32) | N | 策略唯一标识 | PK | F-02 F-06 |
| `policy_scope` | varchar(16) | N | 策略作用域：平台级 / 目标级 | dict:POLICY_SCOPE | F-02 |
| `goal_id` | varchar(32) | Y | 目标级策略所属目标；平台级为空 | FK → MD-01 | F-02 |
| `run_frequency` | varchar(64) | N | 运行频率，如「每日 02:00」 | — | F-02 |
| `max_duration_min` | int | Y | 单次运行时长上限（分钟）；不限为空 | ≥1 | F-02 F-06 |
| `call_limit` | int | Y | 单任务调用次数上限；不限为空 | ≥1 | F-02 F-06 |
| `retry_limit` | int | N | 失败重试次数上限；达到即暂停受影响研究 | ≥0 | F-06 F-26 |
| `is_active` | tinyint | N | 是否生效 | 0/1 | F-02 |

### CFG-05 `gap_rule` 口径检查规则

> 职责：F-01。口径检查任务据此逐条校验六要素。
> 对应原型：`DB.gapRules[]`（4 条规则）。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `rule_id` | varchar(24) | N | 规则唯一标识 | PK；形如 `GAP-1` | F-01 F-27 |
| `target_field` | varchar(24) | N | 校验哪个六要素字段 | dict:GOAL_FIELD | F-01 F-27 |
| `match_pattern` | varchar(200) | N | 命中即视为「已写清」的匹配式（关键词 / 正则） | — | F-01 F-27 |
| `gap_text` | varchar(200) | N | 未命中时产出的待补内容文案 | — | F-01 F-27 |
| `impact_note` | varchar(200) | N | 该项不清会影响哪个判断 | — | F-01 F-27 |
| `is_active` | tinyint | N | 是否启用 | 0/1 | F-01 |

### CFG-06 `context_template` 上下文注入模板

> 职责：F-12。按任务类型定义该注入哪些类型的信息、顺序如何。
> 一阶段给：目标、背景、可用来源、已有机会摘要；二阶段增加：所选机会、产品问题、已有证据、相关历史。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `template_id` | varchar(32) | N | 模板项唯一标识 | PK | F-12 F-31 |
| `task_type` | varchar(24) | N | 适用任务类型 | dict:TASK_TYPE | F-12 F-02 F-04 |
| `context_type_code` | varchar(24) | N | 该任务类型下要注入的信息类型 | dict:CONTEXT_TYPE | F-12 |
| `order_no` | int | N | 注入顺序 | UK(task_type, context_type_code) | F-12 |
| `is_required` | tinyint | N | 是否必需（缺失即视为上下文不完整） | 0/1 | F-12 |

### CFG-07 `dict_type` 字典类型

> 职责：全库值域的唯一登记处。**所有状态 / 类型字段的取值集合只能来自本表注册的类型**。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `dict_type_code` | varchar(32) | N | 字典类型编码（字段里 `dict:XXX` 引用的就是它） | PK | 全库 |
| `dict_type_name` | varchar(64) | N | 字典类型中文名，如「任务状态」「任务受阻原因」 | UK | 全库 |
| `used_by_field` | varchar(120) | N | 主要被哪些表的哪些字段使用（便于改值域时评估影响面） | — | 全库 |

### CFG-08 `dict_item` 字典项

> 职责：字典类型的取值明细。**中文口径写在这里**，代码与展示不脱节。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `dict_item_id` | varchar(32) | N | 字典项唯一标识 | PK | 全库 |
| `dict_type_code` | varchar(32) | N | 所属字典类型 | FK → CFG-07 | 全库 |
| `item_code` | varchar(32) | N | 取值编码（库内实际存储的值） | UK(dict_type_code, item_code) | 全库 |
| `item_name` | varchar(64) | N | 取值中文口径 | — | 全库 |
| `order_no` | int | N | 展示顺序 | — | 全库 |
| `is_active` | tinyint | N | 是否启用（停用不删除，历史数据仍可解释） | 0/1 | 全库 |

## 5. 维度四 · 关联表（LNK）

### LNK-01 `opportunity_evidence` 机会 ↔ 证据

> 职责：F-10「初步依据」与 F-16「相同问题 → 关联到已有机会」的落地。
> `link_kind` 区分两种语义，**避免把「新证据」和「旧依据」混为一谈**。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `link_id` | varchar(32) | N | 关联唯一标识 | PK | F-09 F-10 |
| `opportunity_id` | varchar(24) | N | 机会 | FK → MD-06 | F-10 F-28 |
| `evidence_id` | varchar(24) | N | 证据 | FK → EXT-02 | F-09 F-10 F-28 |
| `link_kind` | varchar(16) | N | 关联语义：初步依据 / 关联更新（新证据关联到已有机会） | dict:EVIDENCE_LINK_KIND | F-10 F-16 |
| `linked_at` | datetime | N | 关联建立时点 | — | F-10 |

**唯一约束**：`UK(opportunity_id, evidence_id, link_kind)`。

### LNK-02 `finding_evidence` 关键发现 ↔ 证据

> 职责：F-21「每项关键发现关联实际取得的证据」。每条发现可挂多条证据，同一证据可支撑多条发现。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `link_id` | varchar(32) | N | 关联唯一标识 | PK | F-09 F-21 |
| `finding_id` | varchar(32) | N | 关键发现 | FK → MD-08 | F-21 F-30 |
| `evidence_id` | varchar(24) | N | 证据 | FK → EXT-02 | F-21 F-30 |
| `linked_at` | datetime | N | 关联建立时点 | — | F-21 |

**唯一约束**：`UK(finding_id, evidence_id)`。

### LNK-03 `opportunity_relation` 机会 ↔ 机会

> 职责：F-16 机会形成与去重。「同一问题出现新证据 → 关联到已有机会；新现象有独立价值 → 新机会记录」。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `relation_id` | varchar(32) | N | 关系唯一标识 | PK | F-16 |
| `from_opportunity_id` | varchar(24) | N | 关系发起方机会 | FK → MD-06 | F-16 |
| `to_opportunity_id` | varchar(24) | N | 关系指向方机会 | FK → MD-06 | F-16 |
| `relation_kind` | varchar(16) | N | 关系语义：相同问题关联 / 被取代 | dict:OPP_RELATION | F-16 |
| `created_at` | datetime | N | 关系建立时点 | — | F-16 |

**唯一约束**：`UK(from_opportunity_id, to_opportunity_id, relation_kind)`。

### LNK-04 `task_object` 任务 ↔ 研究对象

> 职责：F-06 / F-32。任务与目标 / 机会 / 研究 / 建议的关联，并区分「它是任务的启动对象还是产出对象」。
> **本表替代原型里的 `task.ref` 文本字段**——文本引用无法回认目标，是跨目标任务归属串掉的根因。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `link_id` | varchar(32) | N | 关联唯一标识 | PK | F-06 F-32 |
| `task_id` | varchar(24) | N | 任务 | FK → PD-01 | F-06 F-32 |
| `object_type` | varchar(16) | N | 研究对象类型 | dict:OBJECT_TYPE | F-06 F-32 |
| `object_id` | varchar(40) | N | 研究对象主键值 | — | F-06 F-32 |
| `link_role` | varchar(16) | N | 关联角色：启动对象 / 产出对象 | dict:TASK_LINK_ROLE | F-06 F-32 |
| `created_at` | datetime | N | 关联建立时点 | — | F-06 |

**唯一约束**：`UK(task_id, object_type, object_id, link_role)`。

## 6. 维度五 · 外部系统引用快照（EXT）

> **本维度是要求 1.2 的落点**：外部系统只存「来源引用 + 查询快照（来源系统 · 查询条件 · 信息时点 · 适用范围）」，**不建业务主表**。
> 三张表构成完整证据链：`query_record`（我查了什么、真实返回了什么）→ `evidence`（这条返回能作为什么证据）→ `external_validation`（业务侧验证后回关联了什么结论）。

### EXT-01 `query_record` 查询记录

> 职责：F-24 / F-25 / F-26。每次执行的留痕。**失败也留痕**；**不能用模型预期的内容代替查询结果**。
> 对应原型：`task.queries[]`（含 `status: ok/fail/running`）。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `query_id` | varchar(24) | N | 查询记录唯一标识 | PK；形如 `Q-90217` | F-25 |
| `task_id` | varchar(24) | N | 由哪个任务发起 | FK → PD-01 | F-25 F-32 |
| `source_id` | varchar(16) | N | 查的是哪个来源系统 | FK → CFG-01 | F-24 F-25 |
| `query_condition` | text | N | 查询条件（来源系统 · 查询条件），须完整到可复现 | — | F-24 F-25 |
| `queried_at` | datetime | N | 取数（执行）时点 | — | F-24 F-25 |
| `result_status` | varchar(16) | N | 执行结果：成功 / 失败 / 执行中 | dict:QUERY_STATUS | F-24 F-25 F-32 |
| `result_summary` | text | Y | 真实返回的结果摘要（**不得用模型预期替代**）；失败时为空 | — | F-24 F-25 |
| `returned_rows` | bigint | Y | 返回行数（聚合结果也记，便于判断证据强度）；未返回为空 | ≥0 | F-24 |
| `fail_reason` | varchar(200) | Y | 失败的具体原因，如「接口超时（重试 3/3）」「权限未开通」 | — | F-24 F-26 |
| `retry_count` | int | N | 本次执行已重试次数 | ≥0 | F-26 |
| `restricted_flag` | tinyint | N | 是否为受限返回（权限不足 / 条件不允许，返回了受限说明而非数据） | 0/1 | F-23 F-26 |
| `message_id` | varchar(32) | Y | 由哪条追问消息触发；非追问发起为空 | FK → PD-07 | F-31 |
| `created_at` | datetime | N | 记录入库时点 | — | F-25 |

### EXT-02 `evidence` 证据

> 职责：F-09。每项证据关联来源、查询条件、信息时点、适用范围和缺失说明——**无论哪个 Agent 引用，都应能回查证据是怎样取得的**。
> 与 EXT-01 的关系：`query_id` 保证可回查到「哪一次查询」；条件与时点在本表冗余一份，是为了**证据自洽**——即使查询记录后来补录，证据的表述也不随之漂移。
> **新证据加入不覆盖原有依据**：本表只新增行；旧证据保留当时依据，靠 LNK-01 的 `link_kind` 区分。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `evidence_id` | varchar(24) | N | 证据唯一标识 | PK；形如 `EV-1041` | F-09 F-15 |
| `query_id` | varchar(24) | N | 回查依据：本证据来自哪次查询 | FK → EXT-01 | F-09 F-15 |
| `source_id` | varchar(16) | N | 来源系统 | FK → CFG-01 | F-09 F-28 |
| `evidence_title` | varchar(200) | N | 证据标题（一句话说清这条证据在比什么） | — | F-09 F-28 F-30 |
| `query_condition` | text | N | 查询条件（证据自洽的一份，与 EXT-01 同名同口径） | — | F-09 F-15 F-30 |
| `info_time_point` | varchar(80) | N | 信息时点：取数时刻 + 覆盖的业务时段，如「2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15」 | — | F-09 F-15 F-30 |
| `applicability_scope` | varchar(300) | N | 适用范围：人群、渠道、旅程环节是否对应当前目标 | — | F-09 F-15 F-30 |
| `result_summary` | text | N | 结果：查到的实际内容（文本原样保留，不拆数值） | — | F-09 F-28 F-30 |
| `missing_note` | text | N | 缺失说明：这条证据**没能证明**什么、会影响哪项判断（研究缺口的出处） | — | F-09 F-15 F-20 |
| `created_at` | datetime | N | 证据形成时点 | — | F-09 |

### EXT-03 `external_validation` 外部验证结果

> 职责：F-11。后续业务工作形成验证结果时，平台**只关联其结论与来源**供以后研究查阅。
> **执行与效果计算由业务工作完成**，平台不参与、不计算——故本表只有引用，没有指标值。

| 字段 | 类型 | 是否可空 | 口径 | 唯一性 / 值域 | 服务功能点 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| `validation_id` | varchar(32) | N | 外部验证唯一标识 | PK | F-11 |
| `research_no` | varchar(24) | N | 关联到哪份研究 | FK → MD-07 | F-11 |
| `conclusion` | text | N | 业务侧验证得出的结论（原样引用，平台不改写） | — | F-11 |
| `source_ref` | varchar(200) | N | 来源引用：结论来自哪份业务材料或哪个系统 | — | F-11 |
| `validated_at` | datetime | N | 业务侧验证完成时点 | — | F-11 |
| `created_at` | datetime | N | 引用登记时点 | — | F-11 |

## 7. 不建表清单（外部系统业务主表）

> 以下主表**一律不建**。要这些数据时，走 MCP 工具实时查询，结果落 EXT-01 `query_record`，提炼后落 EXT-02 `evidence`。

| 外部系统 | 明确不建的表 | 为什么 | 平台实际存什么 |
| ---- | ---- | ---- | ---- |
| CDP 用户标签系统 | 用户表 / 人群标签表 / 标签分布表 | 平台不做用户级主数据；且 CDP **仅提供标签与聚合结果，无完整用户行为序列** | `query_condition` 里的圈选条件 + `result_summary` 里的标签分布 |
| 黄金眼 | 流量明细表 / 坑位曝光点击表 / 路径转化表 | 数据量大且**仅到渠道 / 坑位聚合，无用户级明细** | 入口维度、时段、品类条件 + 聚合结果 |
| 商品中台 | 商品主数据表 / SKU 表 / 品类归属表 / 价格带表 | 商品主数据归商品中台；平台**不建影子商品库**（否则口径必然漂移） | 品类 / 规格标签 / 在架状态条件 + 占比结果 |
| 营销中台 | 权益发放表 / 核销记录表 | 权益配置属 out of scope；且**券对复购的增量效果需另行测算** | 券类型 / 发放窗口 / 领取人群条件 + 核销率结果 |
| 活动报名系统 | 活动表 / 报名记录表 | 且**只有报名信息，无用户参与明细**——「活动存在」≠「用户参与了」 | 活动时段 / 频道条件 + 已报名活动清单 |

**禁止事项**：不在本系统内建立任何「外部系统数据的镜像表 / 缓存表 / 宽表」。需要新的外部信息时，扩展的是 CFG-01 的 `capability_can` 与 CFG-02 的工具注册，不是新建业务表。

> **交叉引用**：本节的「不建什么表」与 `external-deps.md` 的「外部实际能给什么」是同一约束的两面——**不建表 + 只能靠查询**。外部系统的可查对象、缺口结论、失败语义与 mock 需求，一律以 `external-deps.md` 为准，本文件不重复描述。

## 8. 命名唯一性对照表

### 8.1 同一概念 → 全库唯一命名

| 概念 | **全库唯一命名** | 禁止出现的叫法 |
| ---- | ---- | ---- |
| 研究目标的身份 | `research_goal` / `goal_id` | `goal_config`、`objective` |
| 目标的六要素快照 | `research_goal_version` / `version_no` | `goal_ver`、`goalVersion` |
| 目标侧的范围（③） | `business_scope` | `scope`、`range` |
| 证据的适用范围 | `applicability_scope` | `scope`（与上者撞名，禁止裸用） |
| 目标的关注时段（④） | `focus_period` | `period`、`date_range` |
| 查询 / 取数的时点 | `queried_at` | `query_time`、`fetch_at` |
| 证据的信息时点 | `info_time_point` | `asof`、`dataAt` |
| 机会 | `opportunity` / `opportunity_id` | `chance`、`insight`、`opp` |
| 证据 | `evidence` / `evidence_id` | `proof`、`fact`、`evidenceItem` |
| 查询记录 | `query_record` / `query_id` | `queryLog`、`tool_call` |
| 研究 | `research` / `research_no`（R-xxx） | `study`、`ST-xxx`（**全库弃用**）。原与宪法「需求条目」撞名，宪法 v1 已改用 `REQ-xx`，撞名**已解除**（§0.7） |
| 候选行为 | `candidate_behavior` | `hva`、`key_behavior`（研究完成前禁用 HVA 定性） |
| 关键发现 | `research_finding` | `finding`、`insight_item` |
| 改善方向 | `improvement_action` | `action`、`suggestion` |
| 任务 | `task` / `task_id` | `job`、`run`、`execution` |
| 任务步骤 | `task_step` | `stage`、`phase` |
| 任务受阻记录 | `task_block` / `block_reason_code` | `failure`、`error_log` |
| 外部来源 | `source_registry` / `source_id` | `system`、`datasource`、`sourceName`（文本已弃用） |
| 工具 | `tool_registry` / `tool_code` | `mcp`、`api` |
| 目标材料 | `goal_material` / `material_id` | `attachment`、`file` |
| 触点 | `touchpoint` | `channel_position`、`entry` |
| 幂等键 | `idempotency_key` | `dedup_key`、`submit_key` |

### 8.2 状态字段：一律带实体前缀

| 实体 | 唯一字段名 | 值域 |
| ---- | ---- | ---- |
| 目标 | `goal_status` | dict:GOAL_STATUS |
| 机会 | `opportunity_status` | dict:OPP_STATUS |
| 研究 | `research_status` | dict:RESEARCH_STATUS |
| 任务 | `task_status` | dict:TASK_STATUS |
| 步骤 | `step_state` | dict:STEP_STATE |
| 来源 | `availability_status` | dict:SOURCE_STATUS |
| 查询 | `result_status` | dict:QUERY_STATUS |

> 全库**不允许出现裸 `status` 字段**。历史上原型里机会状态与任务状态都叫 `status`，混用时会算出互相打脸的数。

### 8.3 已裁决的次级命名（如需改，改这一处即可，影响面已列）

| 命名 | 当前取值 | 备选 | 影响面 |
| ---- | ---- | ---- | ---- |
| 研究建议表 | `research_proposal` | `research_request` | MD-12 + LNK-04 的 `proposal` 取值 |
| 追问消息表 | `followup_message` | `research_dialogue` | PD-07 + EXT-01 `message_id` |
| 口径检查任务类型 | `goal_check` | `metric_check` | CFG-08 dict:TASK_TYPE |
| 字典类型命名 | `dict_type` / `dict_item` | `code_table` / `code_value` | CFG-07/08 全库引用 |

## 9. 字典项清单（CFG-07 / CFG-08 种子数据）

| 字典类型 | 字典项（编码 = 中文口径） |
| ---- | ---- |
| `GOAL_STATUS` | `active` = 生效中 ｜ `archived` = 已归档 |
| `GOAL_FIELD` | `business_goal` = ① 业务目标 ｜ `metric_definition` = ② 指标口径 ｜ `business_scope` = ③ 业务范围 ｜ `focus_period` = ④ 关注时段 ｜ `known_constraints` = ⑤ 已知约束 ｜ `provider` = ⑥ 提供方 |
| `MATERIAL_KIND` | `sheet` = 表格 ｜ `mail` = 邮件 ｜ `doc` = 文档 ｜ `manual` = 登记 |
| `MATERIAL_FROM` | `tenant` = 业务方提供 ｜ `local` = 本地选取 ｜ `manual` = 手动登记 |
| `CONTEXT_KIND` | `knowledge` = 业务知识 ｜ `constraint` = 业务约束 ｜ `definition` = 口径说明 |
| `OPP_STATUS` | `candidate` = 候选 ｜ `deferred` = 暂不研究 ｜ `submitted` = 已提交研究 |
| `RESEARCH_STATUS` | `running` = 研究中 ｜ `done` = 已完成 |
| `FINDING_SUPPORT` | `supported` = 已支持 ｜ `unsupported` = 未支持 |
| `BEHAVIOR_STATUS` | `candidate_supported` = 候选行为获得支持（仍属候选） ｜ `not_supported` = 未找到足够依据支持 |
| `BEHAVIOR_POINT_TYPE` | `support` = 支持的方面 ｜ `unsupport` = 不支持或存疑的方面 |
| `TASK_TYPE` | `goal_check` = 口径检查 ｜ `discovery` = 机会发现 ｜ `hva_research` = HVA 研究 ｜ `hva_followup` = HVA 研究·追问 |
| `TASK_STATUS` | `running` = 运行中 ｜ `blocked` = 受阻 ｜ `stopped` = 已停止 ｜ `done` = 已完成 |
| `STEP_STATE` | `pending` = 待执行 ｜ `active` = 进行中 ｜ `done` = 已完成 ｜ `blocked` = 受阻 |
| `BLOCK_REASON` | `target_unclear` = 目标或指标口径不清 ｜ `no_data_returned` = 接口未返回研究所需信息 ｜ `source_unavailable` = 来源未接入或权限不足 ｜ `call_failed` = 查询或服务调用失败 ｜ `limit_or_cancel` = 达到运行限制或人工取消 ｜ `insufficient_basis` = 研究完成但没有足够依据 |
| `QUERY_STATUS` | `ok` = 成功 ｜ `fail` = 失败 ｜ `running` = 执行中 |
| `SOURCE_CODE` | `CDP` = CDP 用户标签系统 ｜ `HJE` = 黄金眼 ｜ `PIM` = 商品中台 ｜ `MKT` = 营销中台 ｜ `ACT` = 活动报名系统 |
| `SOURCE_STATUS` | `ok` = 可用 ｜ `degraded` = 降级 ｜ `unauthorized` = 未接入 |
| `CONTEXT_TYPE` | `goal` = 目标 ｜ `background` = 背景 ｜ `source` = 可用来源 ｜ `opp_summary` = 已有机会摘要 ｜ `selected_opp` = 所选机会 ｜ `product_question` = 产品问题 ｜ `existing_evidence` = 已有证据 ｜ `related_history` = 相关历史 |
| `OBJECT_TYPE` | `goal` = 研究目标 ｜ `opportunity` = 机会 ｜ `research` = 研究 ｜ `proposal` = 研究建议 |
| `TASK_LINK_ROLE` | `trigger` = 启动对象 ｜ `output` = 产出对象 |
| `GRANTEE_TYPE` | `agent` = 按 Agent ｜ `task_type` = 按任务类型 |
| `POLICY_SCOPE` | `platform` = 平台级 ｜ `goal` = 目标级 |
| `MESSAGE_ROLE` | `pm` = 产品经理 ｜ `agent` = 智能体 |
| `EVIDENCE_LINK_KIND` | `initial_basis` = 初步依据 ｜ `related_update` = 关联更新 |
| `OPP_RELATION` | `same_issue` = 相同问题关联 ｜ `superseded` = 被取代 |
| `AGENT_CODE` | `discovery-agent` = 机会发现 Agent ｜ `hva-agent` = HVA 分析 Agent |

## 10. 功能点覆盖矩阵（F-01 ~ F-32）

| 功能点 | 名称 | 涉及表 |
| ---- | ---- | ---- |
| F-01 | 研究目标登记与口径管理 | MD-01 MD-02 MD-03 PD-04 CFG-05 |
| F-02 | 机会发现任务调度 | PD-01 PD-06 CFG-04 LNK-04 |
| F-03 | 研究建议管理（人工节点） | MD-12 |
| F-04 | HVA 研究任务调度 | PD-01 PD-06 MD-12 LNK-04 |
| F-05 | 追问与版本管理 | MD-07 MD-12 PD-01 PD-07 |
| F-06 | 任务记录与异常恢复 | PD-01 PD-02 PD-03 LNK-04 CFG-04 CFG-08 |
| F-07 | 业务背景管理 | MD-04 MD-05 |
| F-08 | 可用来源与工具登记 | CFG-01 CFG-02 |
| F-09 | 证据管理 | EXT-02 LNK-01 LNK-02 |
| F-10 | 机会记录管理 | MD-06 PD-05 LNK-01 LNK-03 |
| F-11 | 研究结果与历史管理 | MD-07 MD-08 MD-09 MD-10 MD-11 EXT-03 |
| F-12 | 上下文按任务组织注入 | CFG-06 PD-06 MD-05 |
| F-13 | 角色指令配置 | MD-13 MD-14 |
| F-14 | 围绕目标寻找线索 | MD-06 MD-05 PD-01 |
| F-15 | 基础查证 | EXT-01 EXT-02 MD-06 |
| F-16 | 机会形成与去重 | MD-06 LNK-01 LNK-03 |
| F-17 | 两步衔接 | MD-12（人工节点，不自动交接） |
| F-18 | 角色指令配置 | MD-13 MD-14 |
| F-19 | 研究起点处理 | MD-07 MD-12 |
| F-20 | 人群比较与行为关系检验 | MD-08 MD-09 MD-10 EXT-02 |
| F-21 | 研究结果生成 | MD-07 MD-08 MD-09 MD-10 MD-11 LNK-02 |
| F-22 | 继续追问承接 | MD-07 PD-07 LNK-04 |
| F-23 | 工具注册与权限检查 | CFG-02 CFG-03 |
| F-24 | 查询执行与真实返回 | EXT-01 CFG-01 CFG-02 |
| F-25 | 查询记录保存 | EXT-01 |
| F-26 | 失败重试与受限返回 | PD-03 PD-01 CFG-04 EXT-01 |
| F-27 | 目标配置页 | MD-01 MD-02 MD-03 PD-04 CFG-05 |
| F-28 | 机会列表与详情页 | MD-06 PD-05 EXT-02 LNK-01 |
| F-29 | 研究建议提交页 | MD-12 |
| F-30 | 研究结果页 | MD-07 MD-08 MD-09 MD-10 MD-11 LNK-02 EXT-02 |
| F-31 | 追问对话页 | PD-07 PD-06 EXT-01 MD-07 |
| F-32 | 任务与状态页 | PD-01 PD-02 PD-03 MD-06 MD-08 MD-09 |

**覆盖检查**：F-01 ~ F-32 全部有表承载，**无孤儿功能点**。

## 11. 索引与外键建议

| 表 | 建议索引 | 用途 |
| ---- | ---- | ---- |
| `research_goal_version` | `(goal_id, version_no)` UK；`(goal_id, is_applied)` | 版本唯一；查当前生效配置 |
| `opportunity` | `(goal_id, opportunity_status)` | F-28 按目标 + 状态过滤列表 |
| `task` | `(goal_id, task_status)`；`(task_type)` | F-32 按目标过滤任务与三类事实 |
| `query_record` | `(task_id)`；`(source_id, queried_at)` | 任务留痕回查；按来源按时点回溯 |
| `evidence` | `(query_id)`；`(source_id)` | 证据回查查询记录 |
| `goal_gap` | `(goal_id, is_solved)` | F-27 未补充的待补项 |
| `context_injection` | `(task_id)` | F-12 某任务注入了什么 |
| `followup_message` | `(research_no, created_at)` | F-31 对话按时间展示 |

**外键策略**：MD / PD / CFG 之间一律建立真实外键约束；`ref_object_id`（PD-06、LNK-04）与 `goal_version_no` 因跨多表指向而无法建物理外键，由应用层校验 + 本文件 §0.4 的命名口径兜底。

## 12. 未决事项

| 编号 | 事项 | 状态 | 待谁定 |
| ---- | ---- | ---- | ---- |
| Q-01 | 表名前缀是否统一加（如全部 `jg_`） | **✅ 已决 2026-09-18**：**不加前缀**，保持本文件已定稿的表名，`schema.md` 无需返工（依据 `tech-stack.md` DS-04） | 已落地，无待办 |
| Q-02 | 具体数据库方言、字符集、排序规则 | **✅ 已决 2026-09-18**：**Cloudflare D1（SQLite）方言**；字符集 UTF-8；默认排序 **BINARY**（中文按字节序，**须应用层排序**）；`datetime` 落 **TEXT（ISO 8601，UTC）**；`varchar(n)` 长度**不强制**，须 CHECK 或应用层兜底（依据 `tech-stack.md` §3） | 已落地，无待办 |
| Q-03 | `business_context` 是否需要与 `goal_version` 建版本联动（背景也版本化） | 未决 | PM 评审 |
| Q-04 | §8.3 四条次级命名的最终取舍 | 未决 | PM 评审 |
| Q-05 | 是否需要对 `opportunity` 的六要素做「必填」强制（当前 `unknown_item` 可为空说明） | 未决 | PM 评审 |
| Q-06 | **`R-xx` 前缀归属**：宪法用作「需求条目」、原型与本研究用作「研究结果编号」 | **✅ 已决 2026-09-18**：`R-xx` 归研究结果对外编号，宪法侧「需求条目」改用 `REQ-xx`；宪法已升 **v1**，旧版归档 `.trash/AGENTS.md-v0.md`。详见 §0.7 | 已落地，无待办 |
| Q-07 | Skill 编号 `S-Ax/S-Bx` 与代码名的映射（`clue-scan` → `S-A1`、`hva-five-checks` → `S-B1`） | 未决 | PM 评审 |

## 反向清单

> 宪法「双向引用」要求：头部写上游卡（我来自哪、受哪些锁定约束），尾部写反向清单（我被谁引用），并登记进最近一层目录的 README。本文件三条分别落在此处与 `README.md`。

**上游（我来自哪）**

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../../AGENTS.md` | 宪法：一条硬红线（白盒原则）｜编号体系｜双向引用｜索引三层｜术语口径 | 强约束，冲突时以宪法为准 |
| `../BRD.md` | M1–M6 × F-01~F-32 全量功能点 | 本文件「服务功能点」列的全部取值来源 |
| `../../prototype/assets/data.js` | 全站唯一 mock 数据源（目标 / 机会 / 证据 / 研究 / 任务 / 追问） | 字段口径的事实来源 |
| `../../prototype/assets/app.js` | 跨页同口径的解析逻辑 | 派生字段与状态流转的事实来源 |

**反向（我被谁引用）**

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `README.md`（本目录 `03-locks/`） | **枝杈登记**（最近一层目录） | ✅ 已登记 |
| `../README.md`（`docs/`） | 目录清单登记（枝杈上一层） | ✅ 已登记 |
| `db/` 建表迁移与全 mock 种子数据 | 本文件字段表是其字段清单的**唯一消费方** | ⏳ 待建 |
| 子 PRD（PRD-M1~M6） | 引用字段与口径 | ⏳ 待建 |
| 开发计划、测试用例 | 引用功能点与字段 | ⏳ 待建 |
| `tech-stack.md` | 承接本文件 §12 Q-01（表名前缀）、Q-02（数据库方言）的去处 | ⏳ 待建 |
| `external-deps.md` | 与本文件 §7「不建表清单」互相印证；并承接 CFG-01 `capability_can/cannot` 的取值来源、CFG-02 工具种子清单、CFG-03 权限口径 | ✅ **已建**（2026-09-18，v1.0 草稿） |

**同批锁定**：`external-deps.md`（外部依赖）、`tech-stack.md`（技术栈）——本文件与二者共同构成「三项锁定」，三者互为印证；边界划分见 `README.md`「三项锁定的边界」。

> **诚实说明**：截至 v1.1，本文件的反向引用**只有「登记层」落地**（上表前两行，两份 README），标 ⏳ 的引用方**均尚未建立**，故本文件目前是**「上游实、反向待挂」**状态。待各引用方建立时，须在其头部上游卡中回指本文件，届时本表同步去 ⏳。此状态已如实标注，不作「已完成双向引用」论。
