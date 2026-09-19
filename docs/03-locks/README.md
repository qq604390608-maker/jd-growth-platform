# 03-locks/ · README

> 三项锁定：把**不可轻易变更**的底层约束一次性钉死，避免开发期反复推翻。
> 三者互为印证：schema 的字段口径受 tech-stack 的方言约束，schema 的「不建表清单」与 external-deps 的外部依赖一一对应。

## 上游

- 宪法：`../../AGENTS.md`（白盒原则｜编号体系｜双向引用｜术语口径）
- 需求：`../01-brd/BRD.md`（M1–M6 × F-01~F-32）
- 事实来源：`../../prototype/assets/data.js`（全站唯一 mock 数据源）

## 目录

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `schema.md` | 数据库表结构锁定：36 张表的字段 / 类型 / 可空 / 口径 / 值域 / 服务功能点 | ✅ 已有（**v1.3** 草稿，2026-09-19 —— v1.2 含 Q-03/Q-04/Q-05 裁决落地；v1.3 为宪法升 v2 后的交叉引用校正，表结构未动） |
| `external-deps.md` | 外部依赖锁定：依赖总表（数据源/Agent 运行能力/交付基础设施三类）· 五系统能力核对七项 · `tool_registry` 文档视图（含 `blocks_features`）· mock server 需求 | ✅ 已有（v1.1 草稿，含待确认清单） |
| `tech-stack.md` | 技术栈锁定：Cloudflare + GitHub 架构 · `server/` 五模块选型 · D1 落地约束（方言/字符集/排序/类型映射）· 平台限制→设计约束 · `CFG-04`→平台配置映射 | ✅ 已有（**v1.2** 草稿，2026-09-19 —— 含 TS-11 / TS-14 实测回填） |

## 三项锁定的边界

| 锁定 | 回答什么 | 不回答什么 |
| ---- | ---- | ---- |
| `schema.md` | 概念怎么切表、字段叫什么、口径是什么 | 用什么数据库、表名加不加前缀 |
| `external-deps.md` | 外部系统怎么接、能拿到什么、缺什么 | 表怎么建 |
| `tech-stack.md` | 用什么技术、什么方言、什么前缀 | 字段口径是什么 |

> 「字段口径」只在 `schema.md` 出现一次；「数据库方言与表名前缀」只在 `tech-stack.md` 出现一次。两处不重复描述同一件事。

## 反向清单

- 本目录被 `../../AGENTS.md` 索引（一级目录职责）
- 本目录被 `../README.md` 登记
- `schema.md` 被 `../../db/`（建表迁移与种子数据）引用 —— ⏳ 引用方待建
- `external-deps.md` 被 `../../db/`（`source_registry` / `tool_registry` / `tool_permission` 种子数据）与 `../../prototype/mock/`（mock server 契约）引用 —— ⏳ 引用方待建
- `tech-stack.md` 被 `../../server/`（五模块实现）、`../../frontend/`（形态与同源部署）、`../../db/`（§3 是建表唯一转换口径）引用 —— ⏳ 引用方待建
- `schema.md` 与 `external-deps.md` **互相印证**：前者 §7 说「外部数据不建业务表」，后者说「那外部能给什么」
- `schema.md` §12 的 Q-01（表名前缀）/ Q-02（数据库方言）由 `tech-stack.md` **关闭**；`tech-stack.md` §5.1 又**反向**建议 `CFG-04` 增补 `retry_delay_sec` / `dead_letter_flag`（待 PM 裁决）
- `schema.md` §12 的 **Q-03 / Q-04 / Q-05** 已由 `../07-decisions/ADR-001~003` **关闭**（2026-09-19）；对应地 `tech-stack.md` §3.3 的 `CHECK` / `NULL` 实测说明是 `ADR-003` 的技术依据
- `tech-stack.md` §8 的 **TS-11**（`varchar` 长度策略：**实测已完成、策略待裁决**）与 **TS-14**（外键：**实测已完成**）由 `../../db/probes/type/` 与 `../../db/probes/fk/` 提供事实，本目录文件已回填引用
- 上述三份锁定文件的反向引用当前**只有登记层**（本 README 与 `../README.md`）与少数已建下游（`../07-decisions/` 的 ADR、`../../db/probes/`）落地；**代码级引用方**（`db/migrations/`、子 PRD、开发计划、测试用例、`server/`、`frontend/`）**均未建立**，逐条状态见各自尾部「反向清单」
