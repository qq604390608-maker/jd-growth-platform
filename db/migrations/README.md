# db/migrations/README.md · 建表迁移（枝杈索引）

> 宪法 `AGENTS.md` 给 `db/` 的职责之一：**建表迁移**。本 README 是 `migrations/` 子目录的枝杈展开，
> 反向引用 `db/README.md` 与三份锁定。

## 目录清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `0001_init.sql` | 36 张业务表的建表 DDL（MD-01~14 / PD-01~07 / CFG-01~08 / LNK-01~04 / EXT-01~03） | ✅ 已建（2026-09-19） |

## 上游（我来自哪）

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../README.md`（即 `db/README.md`） | `db/` 总索引 + DDL 开工检查单 | 强约束 |
| `../../docs/03-locks/schema.md` **v1.3** | 36 张表的字段级定义（**迁移脚本的唯一转换口径**） | 表结构 / 约束不得改 |
| `../../docs/03-locks/tech-stack.md` **v1.2** | §3 类型映射（D1 的 TEXT / NUMERIC 亲和、SQLite 无日期类型）、§5 部署形态 | 建表写法依据 |
| `../../docs/03-locks/external-deps.md` | 外键 / 来源 / 工具类的字段口径 | 建表写法依据 |
| `../../docs/07-decisions/ADR-001~003` | 裁决记录；**ADR-003 §3.1 是 MD-06 六要素 `CHECK` 写法的技术依据** | 约束写法依据 |
| `../probes/` | D1 行为实测证据（类型 / 长度 / 约束 / 外键 / 中文排序） | 建表时不得改写其结论 |

## 关键约定（落进 `0001_init.sql`）

1. **方言**：Cloudflare D1（SQLite）。`varchar(n)` 不强制长度 → 仅作文档声明；`datetime` 落 TEXT（ISO8601 `YYYY-MM-DD HH:MM`）；`tinyint/int/bigint` 落 INTEGER（0/1 标志）。
2. **外键**：默认强制（§11 真实外键）。文件头部 `PRAGMA foreign_keys = ON;`。
3. **长度约束（TS-11 仍待裁决）**：**暂不写**库级长度 `CHECK`；仅保留 Q-05 裁决的 6 处六要素 `CHECK(length(trim(x))>0)`（MD-06 的 `goal_id`/`goal_version_no`/`target_object`/`phenomenon`/`initial_basis_note`/`research_reason`，均 `NOT NULL`）。**若日后裁决「库级 `CHECK`」须补迁移**；裁决前本写法为暂定。
4. **建表顺序（白盒）**：一表一建；父表先于子表。尾部附 §11 建议索引（10 条）。
5. **MD-14 `skill_registry`**：表结构照建（Q-07「不阻塞建表」已解除）；种子数据按 Q-07 已决映射补 2 行（见 `../seed/README.md`）。

## 反向（我被谁引用）

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `../README.md`（`db/README.md`） | 总索引引用本目录 | ✅ 已登记 |
| `../../docs/03-locks/schema.md` §12 反向清单 | 「`db/` 建表迁移」为本文件字段表的唯一消费方 | ✅ 已登记（⏳ → ✅ 2026-09-19） |
| `../seed/README.md` | 种子须与本 DDL 列一致、外键对齐 | ✅ 已登记 |
