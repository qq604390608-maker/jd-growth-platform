# tech-stack.md · 技术栈锁定

> 三项锁定之三（另两项：`schema.md` 表结构、`external-deps.md` 外部依赖）。
> 本文件锁死「用什么实现」：运行平台、各层选型、平台硬限制带来的设计约束。
> **一句话定位**：`schema.md` 管「存什么」，`external-deps.md` 管「外部能给什么」，本文件管「**用什么跑**」。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 文档编号 | LOCK-TECH-001 |
| 版本 | v1.0（2026-09-18 首次建立） |
| 状态 | 草稿，待 PM 与技术方评审 |
| 上游约束 | `../../AGENTS.md`（宪法：一条硬红线 白盒原则｜编号体系｜双向引用｜术语口径）｜`../BRD.md`（F-01~F-32｜§2.2 系统形态｜§5.3 硬红线）｜`schema.md`（36 张表、§12 Q-01/Q-02）｜`external-deps.md`（§4 交付基础设施 D-1~D-6、§7 T-21~T-27） |
| 事实来源 | **Cloudflare 官方文档**（`developers.cloudflare.com` 的 D1 / Workers / Queues / Workers AI 各 Limits 与 Pricing 页），**查询日期 2026-09-18** |
| 交付物 | `../../server/`、`../../frontend/`、`../../db/`、`../../agent-runtime/` 的工程结构与部署配置 |
| 适用范围 | 京东超市单一频道，不做全局 |

### 0.1 边界：本文件回答什么 / 不回答什么

| 问题 | 谁回答 |
| ---- | ---- |
| 存什么表、什么字段、什么口径 | `schema.md` |
| 外部系统能给什么、缺什么 | `external-deps.md` |
| **用什么运行平台、哪层用什么、有什么硬限制** | **本文件** |
| 每个功能点怎么实现（代码级） | `server/` 各模块的开发文档与 PRD-M1~M6 |

### 0.2 决策确认记录（对应要求 3 —— 不确定项已逐条向 PM 确认）

| # | 决策点 | **裁决** | 候选与取舍 | 回收的上游挂账 |
| ---- | ---- | ---- | ---- | ---- |
| DS-01 | 关系型数据库 | **Cloudflare D1（SQLite）** | vs 外部 Postgres（更强但破坏"Cloudflare 一体"、Workers 需 HTTP driver）；vs Durable Objects（36 张表跨对象会打散外键关系） | `schema.md` Q-02、`external-deps.md` D-1 |
| DS-02 | Agent 推理来源 | **Cloudflare Workers AI** | vs 外部 LLM API（能力更宽但引入外部依赖与密钥）；vs 混合（两套调用路径） | `external-deps.md` T-21（原为唯一全空缺项） |
| DS-03 | 任务编排 | **Cron Triggers + Queues + 自建状态机** | vs Cloudflare Workflows（少写代码但状态在平台侧，白盒度低）；vs Durable Objects（需自行实现重试且要额外处理与关系库的一致性） | `external-deps.md` T-26 |
| DS-04 | 表名前缀 | **不加前缀** | vs 统一加 `jg_`（需 schema 36 张表全部返工改名） | `schema.md` **Q-01（由此关闭）** |
| DS-05 | 前端形态 | **零构建，复用原型结构** | vs Vite + 框架 + TS（开发效率高但原型不能复用，且原型已"钉死需求"） | 宪法 `prototype/` 定位 |
| DS-06 | MCP 工具调用 | **自建 MCP 客户端** | vs 借用 Cloudflare Agents SDK 的 MCP 能力（少写协议代码，但其底层用 Durable Objects 管状态，与自建状态机形成两套状态源） | `external-deps.md` T-22、BRD M5「所有外部接口均已 MCP 化」 |

> **决策一致性**：六项合起来是**一套零外部依赖的全 Cloudflare 原生栈**——没有一样东西跑在 Cloudflare 之外（GitHub 只承担代码与 CI）。这带来一个明确的好处：**凭证只有一处**（Cloudflare API Token + GitHub Secrets），运维面最小。
> **代价**（如实记录）：**没有逃生门**。任何一层的平台限制（见 §4）都只能靠改设计绕过，不能靠"换一个云"解决。§4 即为此而写。

### 0.3 标记约定

沿用 `external-deps.md` §0.2 的三态标记：`✅` 已确认（注明来源）｜`⚠️ *` demo 占位（表下脚注）｜`⬜` 待确认（入 §8 清单）。

### 0.4 时效声明（**重要**）

> §4 的所有**平台限制数字**摘自 Cloudflare 官方文档，**查询日期 2026-09-18**。平台限制会随产品迭代变化（如 D1 库容量、Queues 吞吐、可用模型目录均在下调或上调中）。
> **因此**：本文件锁定的是**架构选择**（选哪些产品、怎么组合），**不是这些数字本身**。实施前须重新核对一次官方 Limits 页，差异记入变更记录。

---

## 1. 架构总览（对应要求 1 与要求 2）

### 1.1 全景

```
┌─ GitHub ─────────────────────────────────────────────┐
│  代码托管（单仓多目录）＋ GitHub Actions CI/CD          │
│  Secrets: CLOUDFLARE_API_TOKEN / ACCOUNT_ID          │
└───────────────────────┬──────────────────────────────┘
                        │ wrangler deploy（部署）
                        ▼
┌─ Cloudflare ──────────────────────────────────────────────────────┐
│                                                                   │
│  ┌─ Workers（前端静态资源，同源）──┐   ┌─ Workers（api）───────┐  │
│  │  frontend/  六页面 F-27~F-32   │──▶│  server/api          │  │
│  │  零构建 HTML + 原生 JS         │   │  只做接口，无业务逻辑  │  │
│  └────────────────────────────────┘   └──────────┬───────────┘  │
│                                                   │               │
│  ┌─ Cron Triggers ─┐   ┌─ Queues ──────────┐      │               │
│  │ 到点触发（F-02）│──▶│  每步一条消息      │      │               │
│  └─────────────────┘   │  task-runner 消费  │◀─────┘               │
│                        └────────┬──────────┘                       │
│                                 │                                  │
│  ┌─ Workers（agent-orchestrator）▼──┐   ┌─ Workers（tool-executor）┐│
│  │  两个 Agent 的编排与推理          │──▶│  自建 MCP 客户端         ││
│  │  Workers AI（function calling）  │   │  查五类外部系统           ││
│  └──────────────────────────────────┘   └──────────┬────────────┘│
│                                                     │              │
│  ┌─ D1（SQLite）──────────────────────────────────┐ │              │
│  │  36 张表（MD/PD/CFG/LNK/EXT）                  │◀┘              │
│  │  共享上下文 / 任务状态机 / 查询留痕              │                │
│  └────────────────────────────────────────────────┘                │
└───────────────────────────────────────────────────────────────────┘
                        │ MCP 调用（出网）
                        ▼
        CDP ｜ 黄金眼 ｜ 商品中台 ｜ 营销中台 ｜ 活动报名系统
```

### 1.2 前后端分离的落点（要求 1）

| 侧 | 承载 | 交付物 | 边界（硬约定） |
| ---- | ---- | ---- | ---- |
| **前端** | Workers 静态资源（**与 API 同源**） | `frontend/`：六页面 F-27~F-32，零构建 | **前端不直连数据库、不持有任何外部系统凭证**；所有动态数据经 `server/api` |
| **服务端** | Workers（按宪法拆五个模块） | `server/`：task-runner / shared-context / agent-orchestrator / tool-executor / api | 唯一的数据出口与凭证持有方 |

**为什么前端与 API 同源**：同源部署（静态资源与 Worker 同域）可**免除 CORS 配置与凭证跨域问题**，且 `frontend/` 与 `server/` 可共用一次部署产物。若未来拆分域名，需补 CORS 与鉴权（列为 §8 T-15）。

> **前后端分离的判断标准（可验收）**：把 `frontend/` 整个目录删掉，`server/` 的接口与 `db/` 的数据仍能独立存在并被任意客户端调用。若做不到（如前端里有硬编码的业务数据），即为**未分离**——这一点对应宪法白盒原则，须在验收时逐点检查。

### 1.3 GitHub 的角色（要求 2）

| 角色 | 承担 | 对应约束 |
| ---- | ---- | ---- |
| 代码托管 | 单仓多目录（`frontend/` `server/` `db/` `agent-runtime/` `docs/` `prototype/` `scripts/`），与宪法索引三层结构一致 | AGENTS.md 目录索引 |
| CI/CD | GitHub Actions → `wrangler deploy`；D1 迁移用 `wrangler d1 migrations apply` | §7 |
| 凭证保管 | Repository Secrets 存 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`；**不得写入仓库** | BRD §5.3 硬红线 |
| 变更留痕 | PR + 分支保护：每个功能点（F-xx）一个 PR，与「逐点开发、逐点验收」对齐 | 宪法一条硬红线（白盒原则） |
| **不承担** | 不存业务数据、不做运行时计算、不做数据源（GitHub 只在交付链路上，不在运行链路上） | `external-deps.md` §1.1 三类界定 |

---

## 2. 技术栈清单（分层）

### 2.1 前端

| 项 | 选型 | 说明 |
| ---- | ---- | ---- |
| 形态 | **零构建静态资源** | 沿用 `prototype/` 的页面结构（HTML + 原生 JS + 自定义 CSS） |
| 数据来源 | `server/api` 的 HTTP 接口 | 把原型 `assets/data.js` 的读取处换成 `fetch`；**原型的 mock 数据不复制进前端** |
| 页面 | F-27 目标配置 / F-28 机会列表详情 / F-29 研究建议提交 / F-30 研究结果 / F-31 追问对话 / F-32 任务与状态 | 与原型一一对应 |
| 共享逻辑 | 沿用原型的 `assets/app.js` 分工（跨页同口径的解析逻辑集中一处） | 避免六页面各写一份格式化逻辑 |
| 状态 | 不引入状态管理库；会话态（如未读数）**不入库、不入后端** | `schema.md` §8.1 已判定「`navUnread` 是前端会话态，不建表」 |

> ⚠️ `*`：是否引入前端构建工具（Vite）**已否决**（DS-05），但**是否需要引入一个轻量模板/组件复用手段**（如 Web Components）⬜ 待确认（§8 T-13）。当前按「原生 JS + 少量工具函数」起步。

### 2.2 服务端（对齐宪法既定的五个模块名）

> 模块划分来自 `AGENTS.md` 索引，本文件不另起名称。

| 模块 | 职责 | 承载 | 服务的功能点 |
| ---- | ---- | ---- | ---- |
| `server/api` | 对外接口层：只做参数校验与转发，**不含业务逻辑** | Worker（HTTP） | F-27~F-32 |
| `server/task-runner` | 任务状态机：创建任务、推进步骤、重试、受阻与恢复 | Worker（Queue Consumer + Cron 触发入口） | F-02 F-04 F-05 F-06 F-26 |
| `server/shared-context` | 共享上下文：背景、来源、证据、机会、历史、注入 | Worker（被 api / orchestrator 调用） | F-07~F-12 |
| `server/agent-orchestrator` | 两个 Agent 的编排：装配上下文、调用模型、工具回路、产出落库 | Worker（调 Workers AI） | F-13~F-22 |
| `server/tool-executor` | 工具执行：权限检查、**自建 MCP 客户端**、真实返回、失败语义 | Worker | F-23~F-26 |

> 五个模块**可以打包为多个 Worker 或合并部署**（见 §7.3 部署形态），但**名字与职责边界以本表为准**——这是宪法索引层的约定，实现形态不得改其名。

### 2.3 数据层

| 项 | 选型 | 依据 |
| ---- | ---- | ---- |
| 引擎 | **Cloudflare D1**（SQLite） | DS-01 |
| 表数 | 36 张（`schema.md`） | 不加前缀（DS-04） |
| 访问方式 | D1 binding（Wrangler 配置），由 Worker 访问 | 前端不直连 |
| 迁移 | `wrangler d1 migrations`（版本化 SQL 文件，落 `db/`） | 宪法 `db/` 定位 |
| 种子数据 | 全 mock 种子，与 `external-deps.md` §5 工具清单对齐 | `db/` 交付物 |

**具体的方言、类型映射、字符集、排序规则见 §3**——这是本节最重要的部分。

### 2.4 任务编排

| 项 | 选型 | 说明 |
| ---- | ---- | ---- |
| 定时触发 | **Cron Triggers** | F-02：到点创建发现任务。最小粒度 1 分钟（见 §4） |
| 排队与分发 | **Queues** | 一步一条消息，自驱动推进 |
| 状态机本体 | **自建**，状态落 D1（`PD-01 task` / `PD-02 task_step` / `PD-03 task_block`） | 与白盒原则最契合：每个状态跃迁都是一行可查的数据 |
| 重试 | Queues 原生重试（`max_retries` / `retry_delay`）+ 死信队列 | **「重试是代码逻辑不是 AI 决策」**（BRD F-26）由平台上配置实现，不经过模型 |

**一次任务的推进链路**（对应 BRD F-06 的要求）：

```
Cron 到点
  └─▶ task-runner：查 CFG-04 run_policy（频率/时长/调用上限/重试上限）
        └─▶ 创建 task（PD-01，task_status=running）
              └─▶ 发 Queue 消息（只含 task_id + step_no，不含大上下文）
                    └─▶ Queue Consumer（= task-runner）执行一个 task_step
                          ├─ 写 PD-02 task_step（步骤结果）
                          ├─ 需要外部数据 → 调 tool-executor（F-23/F-24）
                          ├─ 需要模型判断 → 调 agent-orchestrator
                          ├─ 未完成 → 再发下一条 Queue 消息（自驱动，不靠 Cron 轮询）
                          └─ 失败 → Queues 自动重试 → 超 max_retries
                                    └─▶ 死信队列 → 写 PD-03 task_block（block_reason）
                                          └─▶ task_status=blocked（停止状态不自动重启，BRD F-06）
```

> **消息只带 `task_id` + `step_no`**（不超 1 KB），**上下文一律从 D1 现读**。原因：Queues 单条消息上限 **128 KB**（§4），而注入上下文（`PD-06 context_injection`）可能远超此值。这是被平台限制倒逼出的设计，也顺带保证了「消息小、状态在库里、可回查」。

### 2.5 Agent 运行时

| 项 | 选型 | 说明 |
| ---- | ---- | ---- |
| 推理平台 | **Cloudflare Workers AI** | 免密钥（平台内调用）、计费统一、与 Worker 一体 |
| 模型要求 | **必须支持 function calling**（F-23/F-24 的 MCP 工具调用依赖它） | 选型池见下 |
| 结构化输出 | 使用 JSON mode / `response_format: json_schema` | 强制模型返回符合结构的对象，降低「编造」风险 |
| agent.md / skills | 本体为仓库文件（`agent-runtime/`），版本随 git；D1 的 `MD-13 agent_profile` / `MD-14 skill_registry` 存**登记与版本引用** | 与 `schema.md` 一致；原型 `agentVersion: "hva-agent v1.3 / agent.md r12"` 即此版本串 |

**候选模型池**（均标注支持 Function calling，取自 Workers AI 目录，**查询日 2026-09-18**）：

| 模型 | 关键能力 | 适合用在哪 |
| ---- | ---- | ---- |
| `deepseek-v4-pro-*` | **100 万 token 上下文**，长时程 agentic | F-20 五查这类需要同时装入多份证据的推理 |
| `kimi-k2.6` / `kimi-k2.7-code` | 1T 参数、262K 上下文、**多轮 tool calling**、结构化输出 | F-15/F-24 的多轮工具回路 |
| `glm-5.3` | 1M 上下文、function calling、结构化输出 | 同上，备选 |
| `glm-5.3-flash` / `deepseek-v4-flash-*` | 轻量快速版，支持 function calling | F-14 找线索、F-31 追问回复等短回路 |
| `qwen3.8-27b` / `gemma-4-*` / `nemotron-3-120b-*` / `gpt-oss-120b` | function calling + reasoning | 备选池 |

> ⚠️ `*`：**具体用哪个模型、以及是否所有场景都够用，⬜ 待确认**（§8 T-10）。选型须以**实机验证**为准——特别是 F-20 第⑤项「信息是否足以支持判断」要求模型**敢于说"不足以判断"**，这与模型的对齐倾向强相关，必须用 `external-deps.md` §6 的 mock 响应做回归。
> 免费额度：Workers AI 有每日免费 Neuron 配额，研发期可利用；生产按推理量计费。

### 2.6 工具执行与 MCP

| 项 | 选型 | 说明 |
| ---- | ---- | ---- |
| MCP 客户端 | **自建**（在 `server/tool-executor` 内实现） | DS-06：与自建状态机保持单一状态源 |
| 工具注册 | D1 的 `CFG-02 tool_registry` 为唯一登记处 | `external-deps.md` §5 的 12 个工具逐行落为种子数据 |
| 权限检查 | D1 的 `CFG-03 tool_permission`，**每次调用前判定** | BRD F-23「权限分支互斥」 |
| 失败语义 | 映射到 `EXT-01 query_record` 的 `result_status` / `fail_reason` / `restricted_flag` / `retry_count` | `external-deps.md` §6 七类行为 |
| 研发期替身 | mock server（契约见 `external-deps.md` §6） | 真实接口未接入时的可控响应 |

> **自建 MCP 客户端需自行实现的协议面**（列为实施清单，不在本文件写代码）：工具描述格式、调用与结果回传、超时、错误码映射、权限拒绝的返回形态。这五项恰是 `external-deps.md` §7 T-01/T-02/T-05 的待确认内容——**对接方给了真实契约，实现才能定稿**。

---

## 3. D1 落地约束（**回收 `schema.md` Q-02：方言、字符集、排序规则**）

> 本节是 `schema.md` 到实际建表的**唯一转换口径**。`db/` 迁移脚本须逐条遵守。

### 3.1 方言与类型映射（**最重要**）

SQLite 只认 5 种存储类（`NULL` / `INTEGER` / `REAL` / `TEXT` / `BLOB`），其余类型名只影响「类型亲和性」。`schema.md` 的写法到 D1 的落法：

| `schema.md` 写法 | SQLite 存储类 | **必须注意的落差** |
| ---- | ---- | ---- |
| `varchar(n)` | TEXT | **SQLite 不强制长度**！`varchar(24)` 写 200 字符也能存。`schema.md` 里的长度只是文档约定 → 需靠应用层校验或 `CHECK(length(x)<=n)` 兜底（⬜ §8 T-11 定策略） |
| `text` | TEXT | 无长度限制，但单行上限 **2 MB**（§4） |
| `int` | INTEGER | 64 位，够用 |
| `bigint` | INTEGER | SQLite 的 INTEGER 本就是 64 位 |
| `tinyint`（0/1） | INTEGER | 无布尔类型，**沿用 0/1**，与 `schema.md` 现有写法一致 |
| `datetime` | **TEXT（ISO 8601）** | **SQLite 无原生日期类型**。统一存 `YYYY-MM-DDTHH:MM:SSZ`（UTC），带时区的展示由前端或 API 层转换。这是本节最须遵守的一条：**存 UTC、统一格式、靠字符串排序即可** |
| 枚举（`dict:XXX`） | TEXT | 存 `dict_item.item_code`（英文编码），中文口径在 `dict_item.item_name` |

> **`datetime` 的决策理由**：ISO 8601 TEXT 可直接按字典序排序（同格式下等于时间序）、可读、无需转换；INTEGER 时间戳虽然比较更快，但在 D1 这种数据量级下收益可忽略，且调试时可读性差太多。**选定 TEXT + UTC**。

### 3.2 字符集与排序规则

| 项 | 结论 |
| ---- | ---- |
| 字符集 | UTF-8（SQLite/D1 固定，无需配置）。**中文完全支持**，不需额外字符集选项 |
| 默认排序规则 | **BINARY**（按字节比较） |
| ⚠️ **中文排序陷阱** | `ORDER BY` 中文列的默认结果是 **UTF-8 字节序**，**不等于拼音序**，也不等于笔画序。`COLLATE NOCASE` 只对 ASCII 有效，对中文无效 |
| 影响面 | F-27 目标列表、F-28 机会列表、来源/触点清单等**凡按中文名排序的展示** |
| 处理策略 | ① 需要中文排序的列**在应用层排序**（前端或 API 层用 `Intl.Collator('zh-Hans-CN')`）；② 若某列必须库内排序，**增设一列拼音/排序键**（⬜ §8 T-12 逐列确认，当前默认走 ①） |
| 时区 | 存储一律 **UTC**；展示按 **GMT+8**。原型里的本地时间（如「2026-09-16 03:00」）入库时须转换并统一 |

### 3.3 外键与约束

| 项 | 结论 |
| ---- | ---- |
| 外键 | `schema.md` §11 要求「MD/PD/CFG 之间一律建立真实外键约束」。SQLite 的 `PRAGMA foreign_keys` **需确认在 D1 中是否默认生效**——⬜ **实施第一步必须实测验证**（§8 T-14），若不生效则每次会话显式开启 |
| 唯一约束 | SQLite 支持 `UNIQUE` 与复合唯一，`schema.md` 的 UK 定义可直接落 |
| `CHECK` | SQLite 支持；用于兜底 §3.1 的 varchar 长度问题 |
| 跨表引用（无物理外键） | `PD-06.ref_object_id` / `LNK-04.object_id` / `goal_version_no` 因跨多表指向，`schema.md` §11 已判定由应用层校验——**在 D1 上同样如此** |
| 删除 | 一律软删或状态位（`schema.md` CFG-08 `is_active`），**不做物理删除**，与「新证据加入不覆盖原有依据」一致 |

### 3.4 表名前缀

**不加前缀**（DS-04）。表名即 `schema.md` 已定稿的 `research_goal` / `opportunity` / `evidence` 等，`schema.md` **无需返工**。

---

## 4. 平台限制 → 设计约束（**本文件的核心：把平台数字翻成项目约束**）

> 数字摘自 Cloudflare 官方 Limits 页，**查询日 2026-09-18**（时效声明见 §0.4）。

### 4.1 D1

| 限制项 | 官方数值 | **对本项目的约束** | 影响功能点 |
| ---- | ---- | ---- | ---- |
| 单库最大 | **10 GB**（Workers Paid）/ 500 MB（Free）；**10 GB 上限不可提升** | 本平台数据为报告/机会/证据类文本，量级极小（估算远低于 1 GB）。**结论：不构成约束**。但须注意 `result_summary` / `context_injection` 是长文本，随研究次数线性增长 | 全库 |
| 单表最大列数 | 100 | `schema.md` 最宽的表远低于此 | — |
| 单行 / 字符串上限 | 2 MB | **约束**：`EXT-01 result_summary`、`EXT-02 result_summary`、`PD-06` 注入快照若存大结果，须**截断或分段**。⬜ 截断策略待定（§8 T-16） | F-09 F-12 F-24 F-25 |
| 单次 SQL 查询时长 | **30 秒** | 禁止长事务与大批量 UPDATE/DELETE；`db/` 的种子数据导入须**分批** | `db/` |
| **并发模型** | **每个库本质单线程，一次处理一个查询**；并发超限先排队，队列满返回 `overloaded` 错误 | **最重要的约束**：多个研究任务并发写库会排队。**设计对策**：Queues 消费者的 `max_concurrency` 与 D1 写入能力对齐（见 §4.2），避免同时多个任务密集写 `query_record` | F-06 F-25 |
| 每 Worker 调用读子请求 | 1000（Paid）/ 50（Free） | 单次请求内的查询数须收敛；**避免 N+1 查询**（如 F-28 机会列表逐个查证据） | F-28 F-30 |
| 每次调用 D1 连接数 | 最多 6 | 连接不做池化，靠 binding 复用 | — |
| Time Travel（回滚） | 30 天（Paid）/ 7 天（Free） | 误操作可回滚窗口；**但不能替代备份** | — |
| 计费（Free 额度） | 读 500 万行/天、**写 10 万行/天**、存储 5 GB | 研发期够用；**注意写行数**——状态机每步都写 PD-02，一跳一写会快速累积 | F-06 |

### 4.2 Workers / Queues

| 限制项 | 官方数值 | **对本项目的约束** | 影响功能点 |
| ---- | ---- | ---- | ---- |
| CPU 时间（HTTP） | Free **10 ms**；Paid 默认 30 秒，可提至 **5 分钟** | **必须用 Workers Paid**。Free 的 10 ms 连一次 JSON 序列化都不够，Agent 任务完全不可行 | 全部 |
| CPU 时间（Cron / **Queue Consumer**） | **15 分钟** | **这是「单步任务」的硬上限**：一个 task_step 的 CPU 不得超过 15 分钟 → `schema.md` `CFG-04 max_duration_min` 的**值域上限受此约束** | F-02 F-06 |
| 消费者墙钟时长 | 15 分钟 | 同上；且「等待外部接口」的墙钟时间也计入，**外部系统响应慢（如活动报名系统"响应慢"）会直接吃掉预算** | F-06 F-24 F-26 |
| 内存 | 128 MB / isolate | 上下文注入不得把巨量证据一次性读进内存 → 印证 §2.4「消息只带 task_id，按需读」 | F-12 |
| 同时出网连接 | 6 / 请求 | 并行调多个外部工具时须限流 | F-24 |
| Subrequests | 50（Free）/ 1000~10000（Paid） | 工具调用 + 模型调用都算子请求，须计数 | F-14 F-15 F-24 |
| Worker 体积 | Free 3 MB / Paid 10 MB | 前端静态资源**不计入** Worker 体积（作为静态资产单独托管） | — |
| Cron Triggers 数量 | Free 5 / Paid **250** | F-02「运行频率按业务需要配置」→ 每个目标可能一条触发规则，**250 条上限须在设计时核对目标数量** | F-02 |
| **Queues 消息大小** | **128 KB** | **倒逼 §2.4 的设计**：消息只带 `task_id` + `step_no`，上下文从 D1 读 | F-06 |
| Queues 批量 | 最大 100 条 / 批量等待最长 60 秒 | `max_batch_size` 与 `max_batch_timeout` 可按任务时延要求调 | F-02 |
| Queues 重试 | **最大 100 次**；可配 `retry_delay`、`dead_letter_queue` | **直接对应 `CFG-04 retry_limit`**（值域 ≤ 100）；超限进死信 → 写 `PD-03` 并置 `task_status=blocked` | F-06 F-26 |
| 消息保留期 | 可配最长 **14 天** | 积压消息的存活窗口，超过即被删除 | F-06 |
| 每队列吞吐 | 5,000 消息/秒 | 远高于本项目需求 | — |
| 并发消费者 | 最多 250 | **须与 D1 单线程写入对齐**：并发过高会让 D1 排队甚至 `overloaded` → 通过 `max_concurrency` 降低并发，换取稳定 | F-06 F-25 |

### 4.3 §4 汇总：三条被平台限制**倒逼**出的设计

1. **必须 Workers Paid**（Free 的 10 ms CPU 不可行）——这直接决定成本模型为 $5/月起 + 用量。
2. **单步任务 ≤ 15 分钟**（Queue Consumer 上限）→ `CFG-04 max_duration_min` 不是自由配置，**其上限被平台钉死**。研究任务必须**切成多步**，这也正好与 `PD-02 task_step` 的粒度设计吻合。
3. **消息 ≤ 128 KB、D1 单线程写入** → 采用「**消息瘦、状态厚**」：Queues 只传标识，一切上下文与状态落 D1，写入并发靠 `max_concurrency` 主动限流。

---

## 5. `CFG-04 run_policy` → 平台配置映射（**本文件对 `schema.md` 的直接落点**）

> `schema.md` CFG-04 是「运行频率、时长、调用限制、重试上限」的登记处。本表说明**每个字段落到 Cloudflare 的哪个配置项**。

| `schema.md` 字段 | 落到 Cloudflare 的 | 值域与约束 |
| ---- | ---- | ---- |
| `run_frequency` | **Cron Triggers 表达式** | 最小粒度 **1 分钟**；账号 Triggers 数受上限约束（Free 5 / Paid 250） |
| `max_duration_min` | Queues 消费者 CPU/墙钟上限 | **≤ 15 分钟**（平台硬上限）。超过则任务必须切步 |
| `call_limit` | 自建状态机内计数（写 `PD-02`），**非平台配置** | ≥1，由程序实现；需与 Subrequests 上限（1000/请求）区分开 |
| `retry_limit` | Queues `max_retries` | **0~100**（平台上限 100）；达到后进死信队列 |
| `policy_scope` / `goal_id` / `is_active` | 程序逻辑（决定用哪条策略生成 Trigger 与消费行为） | 同上 |

### 5.1 ⚠️ 本文件对 `schema.md` 的**反向反馈：`CFG-04` 缺两个字段**

实施时发现 `run_policy` 无法完整配置 Queues 的重试行为，**建议 `schema.md` 增补**（⬜ 待 PM 裁决，§8 T-17）：

| 建议新增字段 | 类型 | 口径 | 对应平台能力 |
| ---- | ---- | ---- | ---- |
| `retry_delay_sec` | int | 失败后延迟多久再投递（`retry_delay`） | Queues `retry_delay` |
| `dead_letter_flag` | tinyint | 超过 `retry_limit` 后是否转入死信（而非丢弃） | Queues `dead_letter_queue`；对应 BRD F-06「持续失败暂停受影响研究」 |

> 若不增补，则这两个行为只能写死在代码里——**违反「配置约束 Agent / 运行策略可配」的设计意图**（`schema.md` §4 维度三的共同职责）。故建议增补。

---

## 6. 工程结构（对齐 `AGENTS.md` 索引，不另起目录）

| 目录 | 内容 | 技术要点 |
| ---- | ---- | ---- |
| `frontend/` | 六页面 F-27~F-32（零构建） | 静态资源，与 API 同源 |
| `server/` | api / task-runner / shared-context / agent-orchestrator / tool-executor | Worker 代码；Wrangler 配置见 §7 |
| `db/` | D1 迁移脚本（版本化 SQL）＋ 全 mock 种子数据 | `wrangler d1 migrations` |
| `agent-runtime/` | 公共业务指令、两个 Agent 的 agent.md、skills、工具注册表 | 本体为仓库文件 → 登记入 `MD-13` / `MD-14` |
| `scripts/` | 引用自检脚本（孤儿 / 悬空 / 重号） | 纯本地脚本，可跑在 CI |
| `docs/` | 本文件在内的规约 | — |
| `prototype/` | 原型，保留作证据，**不改** | 前端开发时作视觉与交互参照 |
| `mock/`（新增，隶属 `prototype/`） | mock server（契约见 `external-deps.md` §6） | ⬜ 归属与生命周期待定（`external-deps.md` T-27） |

> **`mock/` 是否独立于 `prototype/`**：⬜ 待确认（§8 T-18）。当前按 `prototype/mock/` 处理，理由是它服务于研发期而不进入生产链路。

---

## 7. 环境、配置与发布

### 7.1 环境划分

| 环境 | 用途 | 数据 | 触发 |
| ---- | ---- | ---- | ---- |
| **本地（local）** | 开发调试 | Wrangler 本地 D1（local storage） | `wrangler dev` |
| **预览（preview）** | PR 验收 | 独立 D1 / 独立 Queues（⬜ §8 T-19 是否建） | GitHub Actions on PR |
| **生产（production）** | 实际使用 | 生产 D1 / 生产 Queues | 合并主干后 deploy |

### 7.2 密钥与凭证

| 凭证 | 存放 | 纪律 |
| ---- | ---- | ---- |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | GitHub Repository Secrets | 不落仓库、不落前端 |
| Workers AI 调用 | **无需外部密钥**（平台内 binding） | DS-02 的红利：少一处密钥管理 |
| 外部系统（CDP 等）凭证 | Workers Secrets | 仅 `tool-executor` 可见；⬜ 由 `external-deps.md` T-04 权限范围决定 |

> **BRD §5.3 硬红线的技术落实**：所有外部系统调用均为**只读查询**（F-24），**任何写操作不实现**；CI 中不配置任何生产写权限的 Token。

### 7.3 部署形态

⬜ **待确认**（§8 T-20）：五个 `server/` 模块是**打包成多个 Worker**（职责隔离、独立伸缩）还是**合并为一个 Worker**（减少跨 Worker 调用与部署复杂度）。

- 当前倾向：`api` 与 `task-runner`（含 Queue Consumer）**分**（入口性质不同）；`agent-orchestrator` 与 `tool-executor` 可**合**（调用链紧密，合并减少一次 Service Binding 往返）。
- 该决定**不影响 `schema.md` 与模块职责边界**，可在实施时定，故不阻塞。

---

## 8. 待确认清单

| 编号 | 待确认事项 | 谁提供 | 阻塞什么 |
| ---- | ---- | ---- | ---- |
| T-10 | **Workers AI 具体模型选型**：F-20 五查需强推理且须「敢说不足以判断」，须实机验证 | 技术方 + PM | 推理质量与「不编造」红线的达成 |
| T-11 | `varchar(n)` 长度约束在 D1 的兜底策略（应用层校验 or `CHECK` 约束） | 技术方 | `db/` 迁移脚本写法 |
| T-12 | 哪些列需要中文排序 → 是否增设拼音/排序键列 | PM + 前端 | F-27/F-28 列表排序 |
| T-13 | 前端是否需要轻量组件复用手段（如 Web Components） | 前端 | `frontend/` 开发方式 |
| T-14 | **D1 中 `PRAGMA foreign_keys` 是否默认生效**（`schema.md` §11 承诺了真实外键，须实测） | 技术方 | `schema.md` §11 的可兑现性 |
| T-15 | 前端与 API 是否长期保持同源（若拆域名需补 CORS 与鉴权） | PM | 部署形态 |
| T-16 | 长文本（`result_summary` / 注入快照）的截断或分段策略（受 2 MB/行 限制） | 技术方 | F-09 F-12 F-24 |
| T-17 | **是否给 `schema.md` `CFG-04` 增补 `retry_delay_sec` / `dead_letter_flag`**（§5.1） | PM | F-06 重试行为能否配置化 |
| T-18 | `mock/` 是否独立于 `prototype/` | PM | 目录归属 |
| T-19 | 是否建立独立的预览环境（独立 D1 + Queues） | PM + 技术方 | 验收流程 |
| T-20 | `server/` 五模块打包为几个 Worker（§7.3） | 技术方 | 部署形态（不阻塞设计） |
| T-21 | 平台限制数字的复核（本文件 §4 的数摘于 2026-09-18） | 技术方 | 实施前须重核一次 |
| T-22 | 外部系统凭证的获取与最小权限（承接 `external-deps.md` T-04） | 对接方 | F-23 F-24 真实接入 |

> **与其它锁定文档待确认清单的关系**：`external-deps.md` §7 的 T-01~T-10（五系统接入细节）**仍是本文件的前置**——工具契约未定，`tool-executor` 的实现无法定稿。本清单只覆盖**技术选型与工程**层面。

---

## 反向清单

> 宪法「双向引用」要求：头部写上游卡（我来自哪、受哪些锁定约束），尾部写反向清单（我被谁引用），并登记进最近一层目录的 README。

**上游（我来自哪）**

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../../AGENTS.md` | 宪法：一条硬红线｜编号体系｜双向引用｜索引三层｜目录索引（`frontend/` `server/` 五模块名 `db/` `scripts/` `agent-runtime/`） | 强约束；**模块名与目录不得改** |
| `../BRD.md` | §2.2 系统形态（前后端分离）、§5.3 硬红线（不调生产写接口）、F-01~F-32 | 服务端只读、零写操作 |
| `schema.md` | 36 张表；§11 外键策略；CFG-01~CFG-04；§12 **Q-01（前缀）与 Q-02（方言）由本文件关闭** | 表结构不得改；§5.1 反向提出增补建议 |
| `external-deps.md` | §4 交付基础设施 D-1~D-6；§5 工具清单；§6 mock 契约；§7 T-21~T-27 | 本文件是这些待确认项的技术侧回答 |

**反向（我被谁引用）**

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `README.md`（本目录 `03-locks/`） | **枝杈登记**（最近一层目录） | ✅ 已登记 |
| `../README.md`（`docs/`） | 目录清单登记 | ✅ 已登记 |
| `schema.md` §12 | Q-01 / Q-02 的答案落点 | ✅ 已互指 |
| `external-deps.md` §7 | T-21~T-27 的技术侧回答 | ⏳ 待回填 |
| `../../server/`（五个模块） | 实现依据 | ⏳ 待建 |
| `../../frontend/`（六页面） | 形态与部署依据 | ⏳ 待建 |
| `../../db/` 迁移脚本 | §3 是建表的唯一转换口径 | ⏳ 待建 |
| 开发计划 / 测试用例 / runbook | 引用平台限制与部署形态 | ⏳ 待建 |

> **诚实说明**：截至 v1.0，本文件的反向引用**只有「登记层」实现**（两份 README）与 `schema.md` 的互指；标 ⏳ 的引用方均未建立。此外 §8 有 **13 条待确认**、§4 的数字有时效性（§0.4）、`external-deps.md` §7 的 T-01~T-10 仍是本文件实现的前置。
