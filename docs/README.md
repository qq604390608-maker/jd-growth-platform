# docs/ · README

> 产品与规约中心：业务背景、BRD、主子 PRD、三项锁定、开发计划、测试用例、runbook、决策留档。

## 上游

- 宪法：`../../AGENTS.md`（M1–M6 模块｜F-xx 功能点｜白盒原则｜双向引用｜索引三层）

## 目录

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `01-brd/BRD.md` | 业务需求文档：六大模块 × 32 功能点全量清单 | ✅ 已有（2026-09-19 迁入 `01-brd/`） |
| `03-locks/` | 三项锁定（schema 表结构 / external-deps 外部依赖 / tech-stack 技术栈） | ✅ 三项齐备（schema **v1.8**、external-deps **v1.3**、tech-stack **v1.5**；external-deps §7 已随 ADR-004 全量收口＝契约基准 v1） |
| `07-decisions/` | 决策留档：决策请示包（DEC-PACK）＋ 正式决策记录（ADR-xxx） | ✅ `DEC-PACK-001`（**v1.3**）＋ **`ADR-001`~`ADR-003` 已建**（2026-09-19，Q-03/04/05 三项裁决） |
| `02-prd/` | 主子 PRD：主索引 `PRD.md` ＋ 子 PRD `PRD-M1`~`PRD-M6`（一模块一份） | ✅ 已建（2026-09-19，仅业务背景仍待建） |
| `04-plan/` | 开发计划：实施路线图（`dev-plan.md`）＋ 出关清单（`go-live-checklist.md`）＋ 技术裁决请示（`ts-decision-requests.md`）＋ 外部问题清单（`external-intake-questions.md`） | ✅ 已建（2026-09-19，顺序 M2→M5→M1→M3/M4→M6；三份补充件 2026-09-20~21 增补） |
| `05-test-cases/` | 测试用例：总索引 `00-索引.md` ＋ 子用例 `test-M1`~`test-M6`（一模块一份） | ✅ 已建（2026-09-19，86 条用例，F-01~F-32 全覆盖） |
| `06-runbook/runbook.md` | 运维手册：环境准备、本地开发两通道、D1 迁移（含远程行为差异）、回归跑法、探针、部署上线、已知运维事项 | ✅ 已建（2026-09-21） |
| `00-background/business-background.md` | 业务背景：痛点/定位/流程/边界的**提炼与导航**（口径真源在 `01-brd/BRD.md`，本文不新增口径） | 🟡 草稿（2026-09-21 从 BRD/PRD 提炼，待业务方与 PM 评审） |

## 反向清单

- 被 `AGENTS.md` 索引（一级目录职责）
- `01-brd/BRD.md` 被后续 PRD、开发计划、测试用例引用
- `03-locks/` 的 `schema.md` 被 `../db/`（建表迁移与种子数据）引用
- `03-locks/` 的 `external-deps.md` 被 `../db/`（`source_registry` / `tool_registry` / `tool_permission` 种子）与 `../prototype/mock/`（mock server 契约）引用；其 §7 待确认清单 21 条**已于 2026-09-21 全部收口**（ADR-004：无外部对接方，T-01~T-10 + T-22 由我方双重角色自拟冻结为**契约基准 v1**，自造值允许进断言并标注基准版本，红线「真实返回」改述为「来源可追溯」）；真对接方出现时走 ADR 修订替换
- `03-locks/` 的 `tech-stack.md` 被 `../server/`（五模块实现）、`../frontend/`（六页面形态）、`../db/`（§3 是建表唯一转换口径）引用；其 §4 平台限制数字有时效性（摘于 2026-09-18），实施前须重核
- `07-decisions/` 的 `DEC-PACK-001.md` 以 `03-locks/schema.md` §12（Q-03/Q-04/Q-05）与 `01-brd/BRD.md` 为上游；三项**已于 2026-09-19 裁决**并升出 **`ADR-001`~`ADR-003`** —— 三者与 `schema.md` §12 三行**已互指**（`ADR-003` 另被 `tech-stack.md` §3.3 回指）
- `07-decisions/` 的 `ADR-003` 的技术前提来自 `../db/probes/type/`（D1 实测）；`tech-stack.md` §8 的 TS-11 / TS-14 事实来自 `../db/probes/type/` 与 `../db/probes/fk/`
