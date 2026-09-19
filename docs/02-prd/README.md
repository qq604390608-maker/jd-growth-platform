# docs/02-prd/ · README

> 产品需求文档（PRD）体系：主索引 ＋ 六大模块子 PRD
> 建立日期：2026-09-19（与 BRD v1.1、三项锁定 v1.x 对齐）

## 上游

- 宪法：`../../AGENTS.md`（M1–M6 模块｜F-xx 功能点｜白盒原则｜双向引用｜索引三层）
- 业务需求：`../01-brd/BRD.md`
- 三项锁定：`../03-locks/`（schema / external-deps / tech-stack）
- 决策留档：`../07-decisions/`（ADR-001~003、DEC-PACK-001）

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `PRD.md` | 主 PRD（**只做索引**，指向子 PRD 与上游） | ✅ 已建 v1.0 |
| `PRD-M1-平台任务程序.md` | 子 PRD · M1 平台任务程序（F-01~F-06） | ✅ 已建 v1.0 |
| `PRD-M2-共享上下文.md` | 子 PRD · M2 共享上下文（F-07~F-12） | ✅ 已建 v1.0 |
| `PRD-M3-机会发现Agent.md` | 子 PRD · M3 机会发现 Agent（F-13~F-17） | ✅ 已建 v1.1（2026-09-19 订正 §1.1 L65 列名口径） |
| `PRD-M4-HVA分析Agent.md` | 子 PRD · M4 HVA 分析 Agent（F-18~F-22） | ✅ 已建 v1.1（2026-09-19 订正 §1.1 L65 列名口径） |
| `PRD-M5-工具执行程序.md` | 子 PRD · M5 工具执行程序（F-23~F-26） | ✅ 已建 v1.0 |
| `PRD-M6-运营端工作台.md` | 子 PRD · M6 运营端工作台（F-27~F-32） | ✅ 已建 v1.0 |

## 引用约定

- 主 PRD `PRD.md` 仅索引，不写实现细节；功能需求 / 验收要点 / 表与工具映射下沉到子 PRD。
- 每份子 PRD 头部写上游卡（受 BRD、三项锁定、AGENTS 约束），尾部写反向清单（被主 PRD 索引、被本 README 登记）。
- 编号体系：子 PRD 文件名 `PRD-Mx`（x＝1~6），对应 AGENTS 编号体系中的「PRD-Mx 子 PRD」。

## 反向清单

- 被 `../../AGENTS.md` 索引（docs 行「主子 PRD」状态翻为已建）。
- 被 `../README.md`（docs 目录清单）登记。
- `PRD.md` 与 `PRD-M1`~`PRD-M6` 互相引用；下游预计被开发计划、测试用例、runbook 引用。
