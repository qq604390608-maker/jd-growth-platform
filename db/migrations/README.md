# db/migrations/README.md · 建表迁移（枝杈索引）

> 宪法 `AGENTS.md` 给 `db/` 的职责之一：**建表迁移**。本 README 是 `migrations/` 子目录的枝杈展开，
> 反向引用 `db/README.md` 与三份锁定。

## 目录清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `0001_init.sql` | 建表 DDL：**37 表**＝业务表 36 张（MD-01~14 / PD-01~07 / CFG-01~08 / LNK-01~04 / EXT-01~03）＋ 1 张**运行期基础设施**计数器表（**CFG-09 `id_sequence`**，v1.9 起） | ✅ 已建（2026-09-19；**v1.9 增量 +1 表**，业务表结构未动） |

## 上游（我来自哪）

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../README.md`（即 `db/README.md`） | `db/` 总索引 + DDL 开工检查单 + 一次性运维入口（`ops/`） | 强约束 |
| `../../docs/03-locks/schema.md` **v1.9** | **37 张表**（业务表 36 ＋ 1 张运行期基础设施计数器表）的字段级定义（**迁移脚本的唯一转换口径**） | 表结构 / 约束不得改 |
| `../../docs/03-locks/tech-stack.md` **v1.6** | §3 类型映射（D1 的 TEXT / NUMERIC 亲和、SQLite 无日期类型）、§5 部署形态 | 建表写法依据 |
| `../../docs/03-locks/external-deps.md` | 外键 / 来源 / 工具类的字段口径 | 建表写法依据 |
| `../../docs/07-decisions/ADR-001~003` | 裁决记录；**ADR-003 §3.1 是 MD-06 六要素 `CHECK` 写法的技术依据** | 约束写法依据 |
| `../probes/` | D1 行为实测证据（类型 / 长度 / 约束 / 外键 / 中文排序） | 建表时不得改写其结论 |

## 关键约定（落进 `0001_init.sql`）

1. **方言**：Cloudflare D1（SQLite）。`varchar(n)` 不强制长度 → 仅作文档声明；`datetime` 落 TEXT（ISO8601 `YYYY-MM-DD HH:MM`）；`tinyint/int/bigint` 落 INTEGER（0/1 标志）。
2. **外键**：默认强制（§11 真实外键）。文件头部 `PRAGMA foreign_keys = ON;`。
3. **长度约束（TS-11 已于 2026-09-20 裁决为「应用层校验」）**：据此**不写**库级长度 `CHECK`；仅保留 Q-05 裁决的 6 处六要素 `CHECK(length(trim(x))>0)`（MD-06 的 `goal_id`/`goal_version_no`/`target_object`/`phenomenon`/`initial_basis_note`/`research_reason`，均 `NOT NULL`）。**当前写法即为裁决结果，非暂定**；若日后改裁决「库级 `CHECK`」须补迁移。
4. **建表顺序（白盒）**：一表一建；父表先于子表。尾部附 §11 建议索引（10 条）。
5. **MD-14 `skill_registry`**：表结构照建（Q-07「不阻塞建表」已解除）；种子数据按 Q-07 已决映射补 2 行（见 `../seed/README.md`）。
6. **线上既有库补建走 `db/ops/`，不改本文件、不拆第二个迁移文件**（v1.9 起立）：本文件是**单一 DDL 文件**、且**已被线上 `d1_migrations` 记为已应用** → D1 **不会重放**；而全仓 30+ 套用例按**硬编码路径** `db/migrations/0001_init.sql` 载入真实 DDL，故**不能**把新增表挪到第二个迁移文件（会与用例的加载面脱节）。做法＝`db/ops/<日期>-<事项>.sql`（幂等 `IF NOT EXISTS`、**无破坏性语句**）＋ 一个**按该文件自身路径精确触发**的专用 workflow（示例：`db/ops/2026-09-22-id-sequence.sql` ＋ `.github/workflows/ops-id-sequence.yml`）；`ci.yml` 的 `deploy` **只重放** `db/seed/`，**不碰** `db/ops/`。

## 反向（我被谁引用）

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `../README.md`（`db/README.md`） | 总索引引用本目录 | ✅ 已登记 |
| `../../docs/03-locks/schema.md` §12 反向清单 | 「`db/` 建表迁移」为本文件字段表的唯一消费方 | ✅ 已登记（⏳ → ✅ 2026-09-19） |
| `../seed/README.md` | 种子须与本 DDL 列一致、外键对齐 | ✅ 已登记 |
| `../ops/2026-09-22-id-sequence.sql` | 线上既有库补建 CFG-09 的**同一张表的 DDL 真源**（列定义须与本文件逐字一致，`test-f35.mjs` 有漂移守卫断言） | ✅ 已建（2026-09-22，F-35） |
| `../../server/shared-context/id-sequence.js` · `test-f35.mjs` | 本 DDL 的 CFG-09 是其**写入面的表结构依据**；用例静态载入本文件并断「`schema.md` 声明表数 ↔ `CREATE TABLE` 实数」 | ✅ 已建（2026-09-22，F-35） |
