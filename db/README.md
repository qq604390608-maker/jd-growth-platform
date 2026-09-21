# db/README.md · 数据层（枝杈索引）

> 宪法 `AGENTS.md` 索引给 `db/` 的职责：**建表迁移与全 mock 种子数据**。
> 本 README 是该职责的枝杈展开，并把新增的探针子目录纳入引用链。

## 上游（我来自哪）

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../AGENTS.md` | 宪法 **v3**：`db/` 职责＝建表迁移与全 mock 种子数据；双向引用；索引三层 | 强约束。**v3 已把索引表 `db/` 行由「🟡 部分」校正为「✅ 已建」**（2026-09-19，继 v2 后二次校正）；本 README 目录清单同步 |
| `../docs/03-locks/schema.md` **v1.9** | **37 张表**（**业务表 36 张** ＋ 1 张运行期基础设施计数器表 CFG-09；v1.9 起）的字段级定义（**迁移脚本的唯一转换口径**） | 表结构不得改 |
| `../docs/03-locks/tech-stack.md` | §3 类型映射（含 D1 的 TEXT/NUMERIC 亲和、SQLite 无日期类型）、§5 部署形态 | 建表写法依据 |
| `../docs/03-locks/external-deps.md` | §5 `tool_registry` / §1 `source_registry` 等配置类种子数据的来源 | 种子数据依据 |
| `../docs/07-decisions/ADR-001~003` | 三项裁决记录；其中 **`ADR-003` §3.1 是 `MD-06` 六要素 `CHECK` 写法的技术依据**（`CHECK` 拦空串、`NOT NULL` 拦 NULL，二者并用） | 建表约束写法依据 |
| `probes/` | D1 行为实测证据（类型 / 长度 / 约束 / 外键 / 中文排序） | 建表时不得改写其结论 |

## 目录清单

| 目录 / 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `probes/` | **D1 行为探针**（`probe_` 前缀表，独立探针库，不是业务 schema）：`type/` 对应 TS-11、`fk/` 对应 TS-14、`collation/` 对应 TS-12 | ✅ 已有（详见 `probes/README.md`） |
| `migrations/` | 建表迁移（**37 表**＝业务表 36 张 ＋ 1 张**运行期基础设施**计数器表） | ✅ **已建**（`0001_init.sql`，**37 个 `CREATE TABLE`**——v1.9 起含 CFG-09 `id_sequence`；含真实外键 + Q-05 六要素 `CHECK` + §11 建议索引） |
| `seed/` | 全 mock 种子数据（12 工具 + 26 组字典 + 各配置表，按 DDL 外键拓扑排序输出） | ✅ **已建**（`0001_mock.sql`，**31 表有数据 / 5 表原型无数据留空**：`MD-12/PD-02/PD-04/PD-06/EXT-03`；`MD-14.skill_registry` 已按 Q-07 已决映射补 2 行。**计数器表 CFG-09 刻意不补种**——空表即合法初值，首次取号由写入面自愈种子抬到「库内实际最大」） |
| `ops/` | **一次性运维 SQL**（**不是种子**：`ci.yml` 的 deploy **只重放** `db/seed/`，**不碰本目录**）：线上既有库补建的专用入口，每个文件配一个按**自身路径**精确触发的 workflow | ✅ 已有（`2026-09-22-id-sequence.sql`——补建 CFG-09 `id_sequence`，`CREATE TABLE IF NOT EXISTS` 幂等、**无破坏性语句**；执行入口 `.github/workflows/ops-id-sequence.yml`。背景：`0001_init.sql` 是**单一 DDL 文件**且已被线上 `d1_migrations` 记为已应用，D1 **不会重放**；而全仓 30+ 套用例按**硬编码路径**载入它，故不能拆出第二个迁移文件） |

> `migrations/` 与 `seed/` 已落地；**探测类文件（`probes/`）与业务迁移必须分开**，这是本 README 先立下的边界（已守住）。
> **`ops/` 与 `seed/` 必须分开**（v1.9 新立）：运维 SQL 只做一次性动作、可能**碰线上数据**，绝不能混进 `deploy` 的种子重放路径；且各 ops workflow 的 `paths` 必须**收窄到自己的文件**，避免互相触发（`ops-demo-reset.yml` 已同批收窄）。

## DDL 开工检查单（**写 `migrations/0001` 前的放行闸**）

> 立单时间 **2026-09-19**（`DEC-PACK-001` 三项裁决回写完成当日）。每项都需**走查证据**，不许写「已完成」。

| # | 检查项 | 结论 | 证据 |
| ---- | ---- | ---- | ---- |
| 1 | `Q-03` / `Q-04` / `Q-05` 是否**已决** | ✅ **全绿**（2026-09-19） | `../docs/03-locks/schema.md` §12 三行均标 `✅ 已决`；决策记录 `ADR-001` / `ADR-002` / `ADR-003` |
| 2 | `TS-14`（外键）是否**已有实测结论** | ✅ **有**（`--local`）——D1 默认强制外键、`OFF` 关不掉、只能 `defer_foreign_keys` 临时放行 | `tech-stack.md` §3.3 + §8 TS-14；`probes/fk/README.md` |
| 3 | ~~`TS-11`（`varchar(n)` 兜底）策略是否已裁决~~ | ✅ **已裁决（2026-09-20，依用户裁决）：应用层校验**——事实面已齐（D1 不强制长度、`CHECK` 可用）；据此首版 `0001_init.sql` **不写**库级长度 `CHECK`（仅保留 Q-05 裁决的 6 处六要素 `CHECK(length(trim(x))>0)`），**当前写法即为裁决结果、非暂定**；若日后改裁决「库级 `CHECK`」须补迁移 | `tech-stack.md` **v1.3** §3.1 + §8 TS-11（均已标「已决」）；`probes/type/README.md`（§5 分类清单：编号锚点 94 / 长文本 39 / 其余短字段 47 = 180） |
| 4 | `Q-07`（Skill 编号映射）是否**仍开放** | ✅ **已决（2026-09-19）**：`clue-scan`→`S-A1`/`discovery-agent`、`hva-five-checks`→`S-B1`/`hva-agent` | `schema.md` §12 Q-07 已决；`MD-14.skill_registry` 已按映射补 2 行种子（见 `seed/0001_mock.sql`），不阻塞整体迁移 |
| 5 | 是否残留 `TBD` / 挡路的"待确认" | ✅ `TBD` **0 处**；"待确认"共 40 处，**全部是清单条目**（`tech-stack.md` §8 待确认清单、`external-deps.md` §7、`ADR-003` 未闭合项等），无一是"待填的空位" | 2026-09-19 全库扫描（`docs/` + `db/` + 工作日志） |

### 放行判定

| 动作 | 判定 | 说明 |
| ---- | ---- | ---- |
| **建表**（`db/migrations/0001_init.sql`） | 🟢 **已完成**（2026-09-19；**v1.9 增量：+1 张运行期基础设施表**） | **37 表** DDL 落盘（v1.9 起含 CFG-09 `id_sequence`），含真实外键 + Q-05 六要素 `CHECK`；**TS-11 已于 2026-09-20 裁决为「应用层校验」**，故首版**不写**库级长度 `CHECK`（若日后改裁决库级 `CHECK` 再补迁移） |
| **种子**（`db/seed/0001_mock.sql`） | 🟢 **已完成**（2026-09-19，MD-14 于 v3 轮补种） | 31 表有数据、5 表（MD-12/PD-02/PD-04/PD-06/EXT-03）原型无数据留空；按 DDL 外键拓扑排序输出，`PRAGMA foreign_keys=ON` 校验 0 违例。**CFG-09 计数器表不补种**（空表即合法初值） |
| **线上补建**（`db/ops/2026-09-22-id-sequence.sql`） | 🟡 **待执行**（人工触发 `ops-id-sequence.yml`；一次性） | 线上既有库补建 CFG-09；`CREATE TABLE IF NOT EXISTS` 幂等、重复执行为空操作；**回读校验**随该 workflow 一并跑（计数器行数 + 三条命名空间的「库内实际最大」） |

## 已知缺口（须处置）

| # | 缺口 | 影响 |
| ---- | ---- | ---- |
| 1 | ~~`AGENTS.md` 索引里 `db/` 标「待建」，实际已有 `probes/`~~ → **已于 2026-09-19 修** | 宪法升 **v2**：索引表 `db/` 行改为「🟡 部分：`probes/` 已有；`migrations/`、`seed/` 待建」，并新增状态取值说明。同批把 `docs/` 行一并校正（原亦标「待建」）。旧版归档 `.trash/AGENTS.md-v1.md`；**v3（2026-09-19）进一步把 `db/` 行翻为「✅ 已建」**（MD-14 补种后 db 职责全兑现），旧版归档 `.trash/AGENTS.md-v2.md` |
| 2 | ~~**项目根没有 `.gitignore`**~~ → **已于 2026-09-19 修**（阶段0-工程骨架新建根 `.gitignore`：忽略 `.wrangler/`、`node_modules/`、`.dev.vars`、`.env`、`*.log`） | 已收口；`probes/*/.wrangler/` 本地运行态（`fk/` 872 KB、`type/` 4.9 MB）由根规则 + 各目录 `.gitignore` 双保险 |
| 3 | `probes/` 三份探针的 **`--remote` / 线上 D1 均未验证** | TS-11 / TS-12 / TS-14 的结论目前都只是 `--local`（miniflare 模拟）结论，**上生产前须补测**。详见 `probes/README.md` |
| 4 | ~~TS-11 / TS-14 的实测结论尚未回填 `tech-stack.md` §8~~ → **已于 2026-09-19 收口**；~~TS-11 策略仍待裁决~~ → **已于 2026-09-20 裁决为「应用层校验」**（见检查单第 3 项），`0001_init.sql` 据此**不写**库级长度 `CHECK`（若日后改裁决库级 `CHECK` 再补迁移） | `tech-stack.md` **v1.2** 已按探针结论改写 §3.1 / §3.2 / §3.3 并更新 §8 的 TS-11 / TS-12 / TS-14；**v1.3** 收口 TS-11 策略裁决 |
| 5 | `probes/` 的**共享 `probe_` 前缀表**分散在三个子库各建一份 | 三份探针各自 `schema.sql` 独立，若将来需要跨探针联查需另建；当前各自隔离是有意为之（避免约束互相掩盖，见 `probes/README.md` 三条硬要求 3） |
| 6 | **两张锁定件＋一份决策留档的「36 张表」交叉引用未同步**（v1.9 落地 F-35 时发现，**未擅自改**） | ① `docs/03-locks/tech-stack.md`（§0.2 DS-01 / DS-04 的论据、§1 架构图、§2 表数行、尾部引用卡）与 ② `docs/03-locks/external-deps.md`（§4 D-1 行）仍写「36 张表」。**未同步的原因**：二者本身是锁定件，改动须各自 bump 版本 + 旧版进 `.trash/` + 比对 SHA + 同步下游钉版，**超出 F-35 的授权范围**，故只登记。**影响面有限**：v1.9 明确「**业务表仍是 36 张**」，上述表述按「业务表」读仍成立，唯 `tech-stack.md` §2 的「表数 \| 36 张（`schema.md`）」与 §12 引用卡属**实打实的过期**。**处置建议**：待用户点头后随这两份文件的下一次改版一并校正。③ `docs/07-decisions/DEC-PACK-001.md` **L384** 引述 D-1 时亦写「36 张表」——该件是**时点决策留档**（记的是 2026-09-19 的裁决语境「Q-03/04/05 都不改变表的数量」），按惯例**不改历史留档**，追溯口径一律以 `schema.md` 现版为准 |

## 反向（我被谁引用）

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `../docs/03-locks/schema.md` 尾部反向清单 | 「`db/` 建表迁移」为预期引用方 | ✅ 已登记（schema 已将其翻为 **✅ 已建**，2026-09-19；**v1.9 已注明「**37 表** DDL」**） |
| `../docs/03-locks/external-deps.md` 尾部反向清单 | 「`db/` 的 `source_registry` / `tool_registry` / `tool_permission` 种子」 | ✅ 已登记（external-deps 已将其翻为 **✅ 已建**，2026-09-19） |
| `../docs/03-locks/README.md` | 枝杈对 `db/` 的反向引用 | ✅ 已登记 |
| `probes/README.md` | 子目录枝杈 | ✅ 已登记 |
| `migrations/README.md` · `seed/README.md` | 子目录枝杈，反向引用本 README 与三份锁定 | ✅ 已建（2026-09-19） |
| `ops/2026-09-22-id-sequence.sql` | 一次性运维 SQL；其头部反向清单指回本 README（「一次性运维入口清单」） | ✅ 已建（2026-09-22，F-35） |
| `.github/workflows/ops-id-sequence.yml` | 上述 ops SQL 的**唯一执行入口**（按该文件路径精确触发） | ✅ 已建（2026-09-22，F-35） |
| `server/shared-context/id-sequence.js` · `test-f35.mjs` | 本目录 `migrations/0001_init.sql` 的 CFG-09 DDL 是其**写入面的表结构依据**；用例含「`schema.md` 声明表数 ↔ DDL `CREATE TABLE` 实数」漂移守卫 | ✅ 已建（2026-09-22，F-35） |
