# db/probes/README.md · D1 行为探针（枝杈索引）

> 本目录**只放实测探针**，不是业务 schema、不是 migration。
> 探针表以 `probe_` 前缀隔离在独立 D1 库（`*-probe`）中，**不得混入业务迁移目录**。

## 上游（我来自哪）

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../../AGENTS.md` | 宪法：一条硬红线｜编号体系｜双向引用｜索引三层｜`db/` 目录职责 | 强约束 |
| `../../docs/03-locks/tech-stack.md` | §3 类型映射与外键策略、§8 待确认清单（TS-11、TS-12、TS-14 均为"须实测"项） | 探针是这三条待确认项的实测手段 |
| `../../docs/03-locks/schema.md` | 类型写法与字段清单（`type/` 覆盖范围的来源）；§11 外键策略（`fk/` 验证其可兑现性） | 探针**不修改**它 |

## 目录清单

| 目录 | 对应待确认项 | 测什么 | 结论状态 |
| ---- | ---- | ---- | ---- |
| `type/` | `tech-stack.md` §8 **TS-11** | D1 的类型亲和与长度行为（`varchar(n)` 是否强制长度、空串 vs NULL、`datetime` 排序、`boolean` 存储、中文 BINARY 排序、复合 UNIQUE 与 CHECK） | ✅ **已实测**（2026-09-18，见 `type/README.md`；11 张探针表 / 148 条执行记录 / 原始响应 64,887 B） |
| `fk/` | `tech-stack.md` §8 **TS-14** | D1 中 `PRAGMA foreign_keys` 是否默认生效（`schema.md` §11「真实外键」的可兑现性） | ✅ **已实测**（2026-09-18，见 `fk/README.md`）。要点：`--local` 下**默认强制外键**、`PRAGMA foreign_keys=OFF` **无法关闭**、需临时放行只能 `PRAGMA defer_foreign_keys=on`；**`--remote` 因本机未认证未验证**，上生产前须补测 |
| `collation/` | `tech-stack.md` §8 **TS-12** | 中文默认排序对枚举展示顺序的影响（`ORDER BY` / `LIKE` / `GLOB` / `IN`；字典表 `order_no` 能否规避） | ✅ **已实测**（2026-09-18，见 `collation/README.md`）。要点：默认序＝**字节序（码点序）≠ 拼音序**且不报错；`CFG-08 dict_item.order_no` **零 schema 改动**即可规避；`LIKE` 对 ASCII 大小写不敏感，`GLOB`/`IN` 区分大小写且尾空格敏感；**线上 D1 未验证** |

> 三个探针的**实测日期、wrangler 版本（4.135.0）相同**，但运行环境记录不同（`fk/` 与 `collation/` 记 Node v24.19.0、`type/` 记 Node v22.22.2 与 ICU 78.2）——复核时如遇结论不一致，先对齐这条。

## 复现范式（三个探针共用）

```bash
cd db/probes/<name>
WR=/Users/dongzhuo/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler

$WR d1 execute <db>-probe --local --file=schema.sql -y   # 建表；DDL 须可重复执行
$WR dev --port <port> --ip 127.0.0.1                      # 另开终端
curl -s "http://127.0.0.1:<port>/<route>" -o "raw/<route>.json"
```

三条硬要求（`type/` 本轮踩到过）：

1. **DDL 必须可重复执行**——每条 `CREATE` 前都要有 `DROP TABLE IF EXISTS`，否则二次执行报 `table ... already exists`。
2. **`d1 execute` 前须先停 `dev`**——两者争同一份本地 SQLite，会互相锁。
3. **约束测试必须隔离**——多条 `CHECK` 放同一张表时，一条失败会掩盖其余结论（`type/` 已踩，见其 README §0.4）。

## 已知缺口（须处置）

| # | 缺口 | 影响 |
| ---- | ---- | ---- |
| 1 | **项目根仍无 `.gitignore`** | `probes/*/.wrangler/` 是本地运行态（`fk/` 872 KB、`type/` 4.9 MB），目前靠各自目录内的小 `.gitignore` 单独忽略（`fk/` 与 `type/` 均已具备）。项目根缺失会影响其余目录，不止探针 |
| 2 | **三份探针的远端均未验证** | `fk/` 的 `--remote` 因未认证被拒；`type/` 与 `collation/` 的线上 D1 同样未验。三份 README 都已如实标注，但**上生产前必须补测** |
| 3 | ~~`tech-stack.md` §8 的 TS-11 / TS-12 / TS-14 均**尚未回填**实测结论~~ → **已于 2026-09-19 收口** | 三条的事实面均已由 `docs/03-locks/tech-stack.md` **v1.2** 回填（TS-11 见 §3.1、TS-12 见 §3.2、TS-14 见 §3.3）；探针侧**未擅自改设计文件**，只提供事实与结论句，改写由锁文件作者完成。**残留**：TS-11 的**策略**（应用层校验 vs 库级 `CHECK`）仍待裁决；TS-12 的「逐列确认」仍待 PM；三条的 `--remote` 均未验证 |

## 反向（我被谁引用）

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `../README.md`（`db/`） | **枝杈登记**（最近一层目录） | ✅ 已登记 |
| `../../docs/03-locks/tech-stack.md` §3.3 / §8 TS-14 | `fk/` 的实测证据 | ✅ 已回填（2026-09-19，tech-stack **v1.2** §3.3 + §8 TS-14） |
| `../../docs/03-locks/tech-stack.md` §3.1 / §3.2 / §3.3、§8 TS-11 | `type/` 的事实输入（类型亲和 / 长度不强制 / 中文排序 / `CHECK` 可用性） | ✅ 事实已回填（2026-09-19）；**策略面（TS-11：应用层校验 vs 库级 `CHECK`）仍待裁决** |
| `../../docs/03-locks/tech-stack.md` §3.2 / §8 TS-12 | `collation/` 的事实输入（默认序 = 字节序、无拼音规则、`LIKE`/`GLOB` 差异） | 🟡 部分回填（2026-09-19）：§3.2 已采纳基础事实；`collation/README.md` §6 的「字典查询一律 `ORDER BY order_no`、零 schema 改动」**建议尚未写入设计文件**，属 TS-12 剩余 |
| `../../docs/03-locks/schema.md`（v1.3） | 字段声明/约束的取舍依据；§11 可兑现性 | ✅ 已互指（2026-09-19）：其 Q-05 的 `CHECK` 设计经 `ADR-003` §3.1 引用 `type/` 实测（v1.2 落地，v1.3 仅校正宪法交叉引用） |
| `../migrations/`（业务迁移） | 建表时对类型、约束与**建表/插入/删除顺序**的取舍依据 | ✅ 已建（2026-09-19） |
