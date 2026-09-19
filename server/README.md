# server/ · 服务端工程结构（枝杈索引）

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 上游 | `AGENTS.md`（宪法索引：server/ 五模块名不得改）｜ `../docs/03-locks/tech-stack.md`（§2.2 服务端模块 / §6 工程结构 / §7.3 部署形态 `TS-20` 待确认）｜ `../docs/04-plan/dev-plan.md`（阶段0 工程骨架；阶段1 · M2 F-07~F-12）｜ `../wrangler.toml`（D1 绑定配置）｜ `../db/`（迁移与种子） |
| 职责 | 五个服务端 Worker 模块的实现目录；唯一的数据出口与凭证持有方（tech-stack §1.2） |
| 硬红线 | 生产环境零写操作；真实返回（禁模型预期替代）；证据四要素；失败不否定结论（BRD §5.3 / §7） |

## 工程状态（2026-09-19，阶段0-工程骨架 → 阶段1 · M2 → 阶段2 · M5 F-23/F-24）

- ✅ **工程骨架已立**：单一 Worker 入口 `server/api/index.js`（`wrangler.toml` 的 `main`），D1 绑定 `DB`（`migrations_dir = ./db/migrations`）。`wrangler dev` 起本地 D1 + `wrangler d1 migrations apply --local` 成功（见下方验证）。
- 🟡 **模块进度**：`shared-context` 六个功能点 **F-07 业务背景管理**、**F-08 可用来源与工具登记**、**F-09 证据管理**、**F-10 机会记录管理**、**F-11 研究结果与历史管理**、**F-12 上下文按任务组织注入** 已落地（2026-09-19，用例全绿，见 `./shared-context/README.md`）——**M2 阶段1 全部功能点收口**；`tool-executor` **F-23 工具注册与权限检查**（38 断言全绿）、**F-24 查询执行与真实返回**（74 断言全绿，含 DS-06 自建 MCP 客户端五项协议面，见 `./tool-executor/README.md`），**F-25/F-26 待建**；`task-runner` / `agent-orchestrator` 待建（按 dev-plan 阶段 3~4 实现）。
- ⚠️ `TS-20` 待确认：五模块拆多 Worker 还是合并单 Worker。**当前为单 Worker 入口**，拆分时调整 `wrangler.toml` 的 `main` 与 `modules` 配置，**不改变模块名与职责边界**。

## 模块清单（职责边界以 tech-stack §2.2 为准，名不得改）

| 模块 | 目录/文件 | 状态 | 服务功能点 |
| ---- | ---- | ---- | ---- |
| `api` | `server/api/index.js` | 🟡 骨架 + F-07~F-12 + **F-23/F-24** 路由（健康检查 / D1 探测 / 业务背景库接口 / 来源登记接口 / 证据接口 / 机会记录接口 / 研究结果与历史接口 / 上下文注入接口 / 工具注册与权限判定接口 / **工具描述与真实查询接口**） | F-07~F-12 **F-23 F-24**、F-27~F-32（后续实现） |
| `task-runner` | （待建） | 待建 | F-02 F-04 F-05 F-06 F-26 |
| `shared-context` | `server/shared-context/` | 🟡 部分（**F-07 / F-08 / F-09 / F-10 / F-11 / F-12 已建** 2026-09-19；**M2 阶段1 收口**） | F-07~F-12 |
| `agent-orchestrator` | （待建） | 待建 | F-13~F-22 |
| `tool-executor` | `server/tool-executor/` | 🟡 部分（**F-23 / F-24 已建** 2026-09-19；F-25/F-26 待建） | **F-23 F-24**、F-25 F-26 |

## 部署与本地

- 本地启动：`wrangler dev`（默认 local D1）
- 迁移应用：`wrangler d1 migrations apply jd-growth-platform --local`
- 研发期种子：`wrangler d1 execute jd-growth-platform --local --file=db/seed/0001_mock.sql`（**一次性**，重灌会撞字典 UK）
- 出口形态：前端经 `server/api` 取数；前端不直连库、不持凭证（tech-stack §1.2）

## 反向清单

- **上游（我来自哪）**：`AGENTS.md` 索引（`server/` 行）｜ `tech-stack.md` §2.2 / §6 / §7.3 ｜ `dev-plan.md` 阶段0 / 阶段1 ｜ `../wrangler.toml` ｜ `../db/`
- **下游（我被谁引用）**：各 `server/` 模块（后续阶段）｜ 阶段0-CI（`.github/workflows`，部署本 Worker）｜ `frontend/`（阶段5 经本 `api` 取数）
- **登记**：`AGENTS.md` 索引 `server/` 行（状态已由「待建」翻为「🟡 部分已建 2026-09-19」）
