# db/seed/README.md · 全 mock 种子数据（枝杈索引）

> 宪法 `AGENTS.md` 给 `db/` 的职责之二：**全 mock 种子数据**。本 README 是 `seed/` 子目录的枝杈展开，
> 反向引用 `db/README.md` 与三份锁定。

## 目录清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `0001_mock.sql` | 全 mock 种子数据（仅 INSERT，不含 DDL）。30 表有数据 / 6 表按裁决留空。**本文件一个字不动**（30+ 用例 oracle 直接引用，决策项2 方案A） | ✅ 已建（2026-09-19） |
| `0002_config.sql` | **生产配置种子**（决策项2，2026-09-21 已裁决）：仅配置数据（11 表 / 183 行），由脚本从 `0001_mock.sql` 提取生成——**派生物，禁止手改**。生产库仅灌本文件（`ci.yml` deploy 阶段 `d1 execute --remote --file`），mock 业务数据不上生产 | ✅ 已建（2026-09-21） |
| `generate_mock.py` | 种子生成器：从 `prototype/assets/data.js` 与 `external-deps.md` §5 抽取真实源，按 DDL 外键拓扑排序输出 | ✅ 已建（可重跑复现） |
| `../../scripts/extract-config-seed.mjs` | 0002 提取脚本：配置表整节 + `run_policy` 仅平台级（`goal_id IS NULL`）行级过滤；`--check` 复算比对防漂移（CI validate 阶段执行） | ✅ 已建（2026-09-21） |
| `../../scripts/probe-config-seed.mjs` | 0002 载入探针：FK ON 下正向干净载入（行数逐一断言）+ 反向「含目标级策略 POL-Q3 必外键违约」（CI validate 阶段执行） | ✅ 已建（2026-09-21） |

## 0002_config.sql 提取规则（决策项2 · 方案A）

- **配置表整节提取（11 表 / 183 行）**：`dict_type`(26) / `dict_item`(84) / `source_registry`(5) / `tool_registry`(12) / `tool_permission`(24) / `gap_rule`(4) / `context_template`(20) / `agent_profile`(2) / `skill_registry`(2) / `touchpoint`(3) / `run_policy`(1)。
- **行级过滤**：`run_policy` 仅提取 `goal_id IS NULL` 的**平台级**行——目标级策略（`POL-Q3`）挂在 mock 业务目标 `GOAL-2026Q3-01` 上，属业务数据，灌生产会触发外键违约（`goal_id REFERENCES research_goal(goal_id)`，探针 P2 已实测拦截）。
- **防漂移**：0002 是 0001 的派生物，改配置须改 0001（或生成器）后重跑提取脚本；`node scripts/extract-config-seed.mjs --check` 比对不一致即 exit 1。
- **幂等调和**（2026-09-21 补，实测教训）：deploy 每次 push main 都重放本文件，纯 INSERT 第二次必撞主键——文件头部先逆拓扑序（子表在前）DELETE 全部配置行再拓扑序 INSERT，每次部署把配置对齐到声明态；探针 P3 实测同库重放行数不变。配置值变更流程：改 0001 → 重跑提取 → 合 main 即生效。

## 上游（我来自哪）

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../README.md`（`db/README.md`） | `db/` 总索引 + DDL 开工检查单 | 强约束 |
| `../migrations/0001_init.sql` | 36 表 DDL（列口径 / 外键）——种子的列必须与之一致 | 表结构不得改 |
| `../../docs/03-locks/schema.md` **v1.3** | 字段口径、§9 字典类型清单（**26 组**，非用户口述的 25）、§11 索引 | 列 / 值口径依据 |
| `../../prototype/assets/data.js` | 全站唯一 mock 源（目标 / 机会 / 证据 / 研究 / 任务 / 追问） | 行数据依据 |
| `../../docs/03-locks/external-deps.md` §5 | 12 个工具（`TOL-01~12`）清单 | 工具种子依据 |

## 种子范围与留空表

- **已种（30 表）**：5 来源、12 工具、24 权限（每工具 × 两 Agent）、2 策略、4 口径规则、19 上下文模板、26 字典类型 / 84 字典项、3 目标、2 Agent、6 目标版本、5 材料、3 背景、3 触点、7 任务、8 机会、2 研究、6 发现、2 候选行为、10 行为点、4 改善方向、4 状态日志、3 追问、全部关联表（LNK-01~04）、11 查询、7 证据。
- **留空（6 表，按裁决 / 原型无数据）**：
  - `MD-14.skill_registry` — **Q-07 已决（2026-09-19）**，按映射补 2 行（S-A1=clue-scan/discovery-agent、S-B1=hva-five-checks/hva-agent），见 `0001_mock.sql`；
  - `MD-12.research_proposal` / `PD-02.task_step` / `PD-04.goal_gap` / `PD-06.context_injection` / `EXT-03.external_validation` — 运行时 / 原型无数据 → 0 行。

## 外键顺序保证

`generate_mock.py` 末尾按 `0001_init.sql` 的外键依赖做 **拓扑排序**（自引用除外），确保父表先于子表输出；
单表内自引用行（如 `task.parent_task_id`）在数据类型里已手工排为父行在前。
落地校验：`PRAGMA foreign_keys = ON` 下载入 `0001_init.sql` + `0001_mock.sql`，`foreign_key_check` = 0、`integrity_check` = ok、6 处六要素 `CHECK` 无违例。

## 反向（我被谁引用）

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `../README.md`（`db/README.md`） | 总索引引用本目录 | ✅ 已登记 |
| `../../docs/03-locks/schema.md` §12 反向清单 | 「`db/` 全 mock 种子数据」为本文件字段表的消费方 | ✅ 已登记（⏳ → ✅ 2026-09-19） |
| `../../docs/03-locks/external-deps.md` §8 反向清单 | §5 工具清单是 `source_registry`/`tool_registry`/`tool_permission` 种子来源 | ✅ 已登记（⏳ → ✅ 2026-09-19） |
| `../migrations/README.md` | 种子须与 DDL 列一致 | ✅ 已登记 |
