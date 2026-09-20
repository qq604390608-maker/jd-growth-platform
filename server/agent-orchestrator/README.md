# server/agent-orchestrator/ 模块文档卡

> 模块定位：阶段4 · **M3 机会发现 Agent + M4 HVA 分析 Agent** 的运行期能力底座（`docs/04-plan/dev-plan.md` 阶段4）。
> ｜ `../../docs/02-prd/PRD-M3-机会发现Agent.md`（F-13~F-17）｜ `../../docs/02-prd/PRD-M4-HVA分析Agent.md`（F-18~F-22）
> ｜ `../../docs/01-brd/BRD.md` §3 M3/M4、§4 F-13~F-22、§5.3 硬红线、§7 验收总则
> ｜ `../../docs/03-locks/schema.md`（MD-13 agent_profile、MD-14 skill_registry、§12 Q-07 已决 S-A1↔clue-scan↔AGP-DISC）
> ｜ `../../docs/03-locks/external-deps.md`（A-1 LLM ⬜ 未提供（最大风险）；A-2 MCP 客户端 ✅；A-3 指令加载与版本管理 ✅；A-4 Skill 加载 ✅）
> ｜ `../../docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle；其中 TC-C-M3-001 / TC-C-M4-001 为 LLM 产出契约，受 A-1 门禁未关闭限制）
>
> **本模块硬红线（与全局一致）**：生产零写（本目录只写 MD-13/MD-14，且只经本 README 列出的单一写入面）、真实返回禁模型替代、证据四要素、失败不否定结论；外部依赖门禁（A-1）未关闭前，推理相关用例一律 mock/demo、demo 值不进断言。

## 文件清单

| 文件 | 职责（F-xx 归属） | 状态 |
| ---- | ---- | ---- |
| `profile.js` | **F-13 角色指令配置**：MD-13/MD-14 **唯一写入面**（本模块首个写面）；`registerAgentProfile`（INSERT MD-13，agent_code UNIQUE 库级强制）、`getAgentProfile`（读）、`bumpAgentProfileVersion`（版本管理：同 agent_code 单行推进 current_version/doc_revision，**不新建行**）、`registerSkill`（INSERT MD-14，PK/UK/FK 库级强制）、`listAgentSkills`（读生效 Skill）、`composeAgentVersionSnapshot`（组装 F-06 任务态冻结用的 `agent_version_snapshot` 串） | ✅ F-13 已建 2026-09-20（**30 断言全绿**） |
| `test-f13.mjs` | F-13 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；断言读全字段 / 版本推进单行 / 注册 Skill 成功 / MD-14 PK-UK-FK 三反例 / MD-13 agent_code UNIQUE 反例 / 快照串形态对齐种子 / 静态零外部调用 + 唯一写入面） | ✅ 已建（**30 断言全绿**） |

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

## HTTP 路由面（`server/api/index.js`，F-13 接入）

| 路由 | 职责 | 成功 / 错误码 |
| ---- | ---- | ---- |
| `GET /api/agent-profiles/{agent_code}` | 读角色指令 + 生效 Skills + 版本快照 | 200；角色指令不存在 404 |
| `POST /api/agent-profiles/{agent_code}/version` | 推进 agent.md 版本（单行 UNIQUE、不新建行） | 200；版本号必填缺失 400 |
| `POST /api/skills` | 注册 Skill（PK/UK/FK 库级强制） | 201；必填缺失 400；约束冲突 409 |

## 口径（本模块已定，含登记在案的取舍）

### 1. F-13 角色指令配置（M3/M4 共用领域能力底座）

**① 单一写入面**：`profile.js` 是 **MD-13 `agent_profile` / MD-14 `skill_registry` 的首个（也是唯一）写入面**；零外部调用、不调 LLM（A-1 门禁只挡推理，不挡本文件的配置与版本管理）。

**② 版本管理＝同 agent_code 单行版本号推进**：`agent_profile.agent_code` 为 UNIQUE（DDL L120，承载 MD-14 外键），故版本升级只 `UPDATE` 同行的 `current_version`/`doc_revision`，**不新建行**、历史版本不落表——任务启动时由 F-06 落 `task.agent_version_snapshot` 冻结快照（见⑥）。

**③ Skill 编号对齐宪法（Q-07 已决 2026-09-19）**：`skill_no`（`S-Ax`/`S-Bx`）作主键、`skill_code`（`clue-scan`/`hva-five-checks`）降为 UK；`bound_agent_code` FK → `agent_profile.agent_code`。三反例（PK/UK/FK）由库级强制，断言见④。

**④ LLM 门禁边界（明确登记）**：**TC-C-M3-001 / TC-C-M4-001（Agent 产出结构化 JSON，response_format=json_schema 强制；strict 只卡外层可解析性）属 A-1 LLM 推理契约，A-1（LLM 推理服务）当前 ⬜ 未提供（external-deps §7 最大风险）**——本文件不实现推理，`test-f13` 只验能力登记与版本管理；该 oracle 项**登记为「门禁未关闭、非发布门禁」**，待 A-1 落实后由 F-14~F-22 补验。

**⑤ 不复制中文枚举**：`agent_code` 值域（discovery-agent/hva-agent）由 `dict:AGENT_CODE`（种子 DI-083/084）承担，本文件不内联字典；约束失败（UNIQUE/PK/FK）抛出 Error，与 F-26 `task-state.js` 一致（`run()` 失败即抛）。

## 反向清单

- **下游（我被谁引用）**：`../api/index.js`（**F-13 路由**）｜阶段4 `../agent-orchestrator` 后续 F-14~F-22（消费 `getAgentProfile` / `composeAgentVersionSnapshot` 装配运行期上下文）；`../task-runner`（F-02 发现任务、F-06 任务态冻结版本快照）复用 `composeAgentVersionSnapshot`
- **上游（我引用谁）**：`../../db`（DDL/种子，MD-13/MD-14 真源）
- **文件间引用（本目录内）**：`profile.js` 为底层写面，被 `../api/index.js` 与后续 F-14~F-22 消费；`test-f13.mjs` 仅用作 CI 验证，不进运行期

## 种子基线（本模块相关，只读参照）

`agent_profile` 2 行（`AGP-DISC`/`AGP-HVA`）、`skill_registry` 2 行（`S-A1`/`S-B1`）已由 `db/seed/0001_mock.sql` 落库，本模块运行期只改行（版本推进）、不增删基线行（新增 Skill 经 `registerSkill` 走业务写入面，非种子）。
