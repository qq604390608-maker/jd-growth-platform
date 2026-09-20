# docs/ · README

> 产品与规约中心：业务背景、BRD、主子 PRD、三项锁定、开发计划、测试用例、runbook、决策留档。

## 上游

- 宪法：`../../AGENTS.md`（M1–M6 模块｜F-xx 功能点｜白盒原则｜双向引用｜索引三层）

## 目录

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `01-brd/BRD.md` | 业务需求文档：六大模块 × 32 功能点全量清单 | ✅ 已有（2026-09-19 迁入 `01-brd/`） |
| `03-locks/` | 三项锁定（schema 表结构 / external-deps 外部依赖 / tech-stack 技术栈） | ✅ 三项齐备（schema **v1.3**、external-deps v1.1、tech-stack **v1.3**；各含待确认清单） |
| `07-decisions/` | 决策留档：决策请示包（DEC-PACK）＋ 正式决策记录（ADR-xxx） | ✅ `DEC-PACK-001`（**v1.3**）＋ **`ADR-001`~`ADR-003` 已建**（2026-09-19，Q-03/04/05 三项裁决） |
| `02-prd/` | 主子 PRD：主索引 `PRD.md` ＋ 子 PRD `PRD-M1`~`PRD-M6`（一模块一份） | ✅ 已建（2026-09-19，仅业务背景仍待建） |
| `04-plan/` | 开发计划：按依赖顺序编排 M1~M6 的实施路线图（`dev-plan.md`） | ✅ 已建（2026-09-19，顺序 M2→M5→M1→M3/M4→M6） |
| `05-test-cases/` | 测试用例：总索引 `00-索引.md` ＋ 子用例 `test-M1`~`test-M6`（一模块一份） | ✅ 已建（2026-09-19，86 条用例，F-01~F-32 全覆盖） |
| （待建） | 业务背景、runbook | 待建 |

## 反向清单

- 被 `AGENTS.md` 索引（一级目录职责）
- `01-brd/BRD.md` 被后续 PRD、开发计划、测试用例引用
- `03-locks/` 的 `schema.md` 被 `../db/`（建表迁移与种子数据）引用
- `03-locks/` 的 `external-deps.md` 被 `../db/`（`source_registry` / `tool_registry` / `tool_permission` 种子）与 `../prototype/mock/`（mock server 契约）引用；其 §7 待确认清单（21 条）关闭前不宜视为可实施
- `03-locks/` 的 `tech-stack.md` 被 `../server/`（五模块实现）、`../frontend/`（六页面形态）、`../db/`（§3 是建表唯一转换口径）引用；其 §4 平台限制数字有时效性（摘于 2026-09-18），实施前须重核
- `07-decisions/` 的 `DEC-PACK-001.md` 以 `03-locks/schema.md` §12（Q-03/Q-04/Q-05）与 `01-brd/BRD.md` 为上游；三项**已于 2026-09-19 裁决**并升出 **`ADR-001`~`ADR-003`** —— 三者与 `schema.md` §12 三行**已互指**（`ADR-003` 另被 `tech-stack.md` §3.3 回指）
- `07-decisions/` 的 `ADR-003` 的技术前提来自 `../db/probes/type/`（D1 实测）；`tech-stack.md` §8 的 TS-11 / TS-14 事实来自 `../db/probes/type/` 与 `../db/probes/fk/`
