# db/probes/type/README.md · D1 类型亲和与长度行为实测

> **本文件只记录实测。不含策略选择、不含结论性建议。**
> TS-11 的策略（应用层校验 or `CHECK` 约束）**已于 2026-09-20 裁决为「应用层校验」**（`tech-stack.md` v1.3 §8）；本文件只提供**事实**（裁决的依据即本文件实测）。

| 项 | 内容 |
| ---- | ---- |
| 实测目的 | 为 `tech-stack.md` §8 **TS-11**（`varchar(n)` 长度约束在 D1 的兜底策略）提供事实依据 |
| 实测时间 | 2026-09-18 |
| 上游（我来自哪） | `../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用）；`../../../docs/03-locks/tech-stack.md` §3 类型映射表 / §8 TS-11；`../../../docs/03-locks/schema.md`（类型写法来源，本文件**未修改它**） |
| 同级范式 | `../fk/`（TS-14 外键实测，同一 worker 探针范式） |
| 事实来源 | 本目录 `schema.sql` + `worker/index.js` 在 **wrangler 4.135.0 + miniflare D1（local）** 上真实执行的返回，原始响应存于 `raw/*.json` |
| 声明 | 期间**未修改** `docs/03-locks/schema.md`；**未**给任何业务表加 `CHECK`；探针表**不在**业务 migration 目录内 |

---

## 0. 阅读须知

### 0.1 三类标记

| 标记 | 含义 |
| ---- | ---- |
| ✅ 实际测到 | 有本次原始输出支撑，附 SQL 与返回 |
| ⚠️ 有落差 | 实测行为与 `schema.md` 写法的字面预期不一致 |
| 🔴 落差且是隐患 | 落差会导致**静默错误**（不报错但结果不对），非仅"不设防" |
| ⬜ 未测 / 未验 | 本轮未覆盖，或无法在本地验证 |

### 0.2 时效声明

本文所有数字与行为摘于 **2026-09-18**，运行于 wrangler **4.135.0** 的 miniflare D1（local）。

- D1 的 SQLite 引擎版本**无法从 SQL 读出**（见 §2.1 与 §3 第 25 行）——这是本轮的第一个发现。
- 本地 miniflare D1 与**线上 D1** 是否在上述每一条上完全一致，**本轮未验证**（无线上凭据）。§6 已列为待复验项。

### 0.3 本轮明确没做的事

- ❌ 未选策略、未提建议：未判断"该用应用层校验还是 CHECK"
- ❌ 未修改 `docs/03-locks/schema.md`
- ❌ 未给全表加 `CHECK`
- ❌ 未把探针表混进业务 migration 目录（探针全部在 `db/probes/type/`）
- ❌ 未测性能、未测并发、未测 D1 的 2 MB/行与 10 GB/库上限

### 0.4 一处必须说明的实测事故（已修，但值得留在案）

第一轮探针把 4 条 `CHECK` 放在**同一张表** `probe_check` 上。其中 `ts datetime CHECK (typeof(ts) = 'text')` 在 `ts` 缺省时 `typeof(NULL)` 返回字符串 `'null'`，不等于 `'text'`，于是**这条约束把 NULL 拒了**，导致同一批里 `length()` / `glob()` 的 NULL 行为被它**抢先拦下**，结论不可用。

- 影响：第一轮 g6 中 ①③⑤⑥ 与 glob ①③④ 共 7 条**判据失效**，已作废。
- 处理：新增 4 张**隔离约束表**（`probe_check_len` / `_glob` / `_type` / `_multi`）重测，结论以 `raw/g6b.json`、`raw/g6c.json` 为准。
- 副产品：这个事故本身留下了两条真事实（见 §3 第 19、23 行）——**同为 CHECK，一条放行 NULL、一条拒绝 NULL**。

---

## 1. 探针环境与复现

### 1.1 环境

| 项 | 值 |
| ---- | ---- |
| 工具链 | wrangler **4.135.0**（`npx` 缓存，路径 `/Users/dongzhuo/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler`） |
| 运行模式 | `wrangler dev --port 8799 --ip 127.0.0.1`（local，D1 落 `.wrangler/state/v3/d1/`） |
| D1 数据库名 | `type-probe`（探针专用，**非业务库**） |
| 探针表 | **11 张**，全部 `probe_` 前缀 |
| 执行记录 | **148 条**（成功 121 / 报错 27，后者均为预期的约束报错） |
| 原始响应 | `raw/g0..g6,g6b,g6c,recheck.json`，共 64,887 B，**未经加工** |
| 主机侧辅助 | Node v22.22.2（ICU 78.2）—— 仅用于算中文排序的**独立参考序** |

### 1.2 文件清单

| 文件 | 作用 |
| ---- | ---- |
| `wrangler.toml` | 探针 worker 配置（`database_id` 全 0，仅本地） |
| `schema.sql` | 11 张探针表的 DDL，**可重复执行**（每条 CREATE 前都有 DROP IF EXISTS） |
| `worker/index.js` | 探针 worker：路由 `/g0 /g1 /g2 /g3 /g4 /g5 /g6 /g6b /g6c /recheck /all` |
| `raw/*.json` | 各组原始响应（原样留存，本文件 §2 的内容均摘自此） |
| `.gitignore` | 忽略 `.wrangler/`（4.9 MB 本地运行态，非证据文件） |
| `README.md` | 本文件 |

### 1.3 复现步骤

```bash
cd db/probes/type
WR=/Users/dongzhuo/.npm/_npx/32026684e21afda6/node_modules/.bin/wrangler

$WR d1 execute type-probe --local --file=schema.sql -y     # 建表（可重复执行）
$WR dev --port 8799 --ip 127.0.0.1                          # 另开一个终端

for g in g0 g1 g2 g3 g4 g5 g6 g6b g6c recheck; do
  curl -s "http://127.0.0.1:8799/$g" -o "raw/$g.json"
done
```

> `/all` 会按 g0→recheck 依次执行；因各组都**有写入**，重复调用会叠加数据。复现时请先跑 `schema.sql` 复位，再逐组各调一次。

### 1.4 覆盖的声明类型写法

`schema.md` 实际出现的类型写法共 **20 种**；你点名的 7 种里有 3 种在 `schema.md` **零出现**，本轮一并测（下表最后一列）。

| 你点名的 | 在 schema.md 的出现次数 | 备注 |
| ---- | ---- | ---- |
| `varchar(24)` | 41 | ✅ 实际使用 |
| `varchar(200)` | 18 | ✅ 实际使用 |
| `text` | 29 | ✅ 实际使用（schema 写小写 `text`） |
| `datetime` | 32 | ✅ 实际使用 |
| `integer` | **0** | ❌ schema 未用；实际写的是 `int`(19) / `tinyint`(17) / `bigint`(1)，本轮一并测 |
| `real` | **0** | ❌ schema 未用；本轮按你点名补测 |
| `boolean` | **0** | ❌ schema 未用；实际表意布尔处多写 `tinyint`，本轮一并测 |

其余 13 种 `varchar(n)`（8/16/20/32/40/48/64/80/100/120/128/160/300）与上列同属 TEXT 亲和，**长度是否强制由同一机制决定**，故未逐长度建列，结论按亲和类推广。

---

## 2. 六项实测：原始输出

> 以下表格逐条转录 `raw/*.json` 的返回。字节级原始响应见 `raw/` 目录。
> `typeof()` 列是 SQLite 的**存储类**（`null` / `integer` / `real` / `text` / `blob`），与声明类型无关。

### 2.1 item1 · `varchar(24)` 存入 200 字符

原样 SQL（写入）：
```sql
INSERT INTO probe_type (tag, c_v24) VALUES (?, ?)   -- 参数: 'len200', 'x'×200
```

原样返回：

| 动作 | 结果 |
| ---- | ---- |
| 写入 200 字符到 `varchar(24)` | **成功（无报错）** `{"success":true}` |
| 读回 | `{"tag":"len200","chars":200,"bytes":200,"storage_class":"text","head":"xxxxx","tail":"xxxxx"}` |
| 写入 300 字符到 `varchar(200)` | **成功**；读回 `{"chars":300,"storage_class":"text"}` |
| 写入恰好 24 字符 | 成功 |
| 写入 30 个中文字符到 `varchar(24)` | 成功；读回 `{"chars":30,"bytes":90,"storage_class":"text"}` |
| 全表超长统计 | `{"rows_over_24":2}` |
| 同列实际长度区间 | `{"min_chars":24,"max_chars":200}` |

**原样结论**：不截断、不报错、**尾部完整**（`tail` 仍是 `xxxxx`），存储类 `text`。同一声明列里实存 24–200 字符并存。

### 2.2 item2 · 空串 vs NULL

原样返回：

| 测试 | 原样结果 |
| ---- | ---- |
| `NOT NULL` 列写入空串 `''` | **成功** |
| `NOT NULL` 列缺省（不写该列） | 报错 `NOT NULL constraint failed: probe_nn.c_nn`（`SQLITE_CONSTRAINT_NOTNULL`） |
| `UNIQUE` 列第二次写 `''` | 报错 `UNIQUE constraint failed: probe_nn.c_u` |
| `UNIQUE` 列写 `NULL` 三次 | **三次均成功** |
| 逐行读回（同一 `c_u` 列） | `{"tag":"empty_str","is_null":0,"len":0,"cls":"text","quoted":"''"}`<br>`{"tag":"null_1","is_null":1,"len":null,"cls":"null","quoted":"NULL"}`<br>`{"tag":"null_2","is_null":1,"len":null,"cls":"null","quoted":"NULL"}` |
| 计数 | `{"cnt_null":2,"cnt_empty":1,"total":3}` |
| `WHERE c_nn IS NULL` | 0 行 |
| `WHERE c_nn = ''` | 1 行（`empty_str`） |
| `WHERE length(c_nn) = 0` | 1 行 |

**原样结论**：空串与 NULL **可区分**（`is_null` / `length` / `typeof` 三个维度都能分开，`''` 的存储类是 `text`、`NULL` 是 `null`）。`NOT NULL` 只拦 NULL、**不拦空串**。`UNIQUE` 拦得住重复空串、**拦不住重复 NULL**。

### 2.3 item3 · `datetime` 落 TEXT(ISO 8601 UTC) 后，字符串排序是否等于时间排序

三类样本（跨时区 / 跨月 / 闰日）各一组，另加两组反例（未零填充 / 混合存储类）。

**写入后的存储类**（`datetime` 声明列 `dt_col`）：

| pid | 写入值 | `typeof(dt_col)` | `quote(dt_col)` |
| ---- | ---- | ---- | ---- |
| a1 | `2026-02-28T16:30:00Z` | `text` | `'2026-02-28T16:30:00Z'` |
| a2 | `2026-03-01T01:00:00Z` | `text` | `'2026-03-01T01:00:00Z'` |
| b1 | `2026-01-31T23:59:59Z` | `text` | `'2026-01-31T23:59:59Z'` |
| b2 | `2026-02-01T00:00:01Z` | `text` | `'2026-02-01T00:00:01Z'` |
| c1 | `2024-02-29T23:59:59Z` | `text` | `'2024-02-29T23:59:59Z'` |
| c2 | `2024-03-01T00:00:00Z` | `text` | `'2024-03-01T00:00:00Z'` |
| c3 | `2024-02-28T12:00:00Z` | `text` | `'2024-02-28T12:00:00Z'` |
| **m1** | `2025-09-18T00:00:00Z` | `text` | `'2025-09-18T00:00:00Z'` |
| **m2** | 字符串 `'20260918120000'` | **`integer`** | `20260918120000` |
| **m3** | JS number `1758200000000` | **`integer`** | `1758200000000` |
| **p1** | `2026-9-18T00:00:00Z`（未零填充） | `text` | `'2026-9-18T00:00:00Z'` |
| p2 | `2026-10-01T00:00:00Z` | `text` | `'2026-10-01T00:00:00Z'` |

**排序对照**（`ORDER BY utc_txt` 字符串序 vs `ORDER BY julianday(utc_txt)` 时间序）：

| 组 | 样本 | 字符串序 | 时间序 | 相等？ |
| ---- | ---- | ---- | ---- | ---- |
| 跨时区 TZ | a1(UTC 02-28 16:30) / a2(UTC 03-01 01:00) | `a1,a2` | `a1,a2` | **✅ 相等** |
| 跨月 MONTH | b1(01-31 23:59:59) / b2(02-01 00:00:01) | `b1,b2` | `b1,b2` | **✅ 相等** |
| 闰日 LEAP | c3(02-28) / c1(02-29) / c2(03-01) | `c3,c1,c2` | `c3,c1,c2` | **✅ 相等** |
| **未零填充 PAD** | p1(`2026-9-18`) / p2(`2026-10-01`) | `p2,p1` | `p1,p2` | **❌ 不等** |
| **混合存储类 MIX** | m1/m2/m3 | `m3,m2,m1`（按列） | `m2,m3,m1`（按时间函数） | **❌ 不等** |

补充两条：

| 测试 | 原样结果 |
| ---- | ---- |
| 跨时区组改用**带偏移的本地串** `ORDER BY local_txt` | `a2,a1` —— 与时间序 `a1,a2` **相反** |
| `julianday()` 能否解析各串 | `a1/a2/b1/b2/c1/c2/c3/p2` 全部返回数值；**`p1` 返回 `null`**（`2026-9-18T00:00:00Z` 无法被时间函数识别） |
| `dt_col` 列存储类分布 | `{"integer":2,"text":10}` —— **同一声明列里两种存储类并存** |

**原样结论**：零填充且已归一到 UTC 的 ISO 串，字符串序 = 时间序（三组全中）。但**带偏移的本地串排序会反转**；**未零填充的串连 `julianday()` 都返回 NULL**；`datetime` 声明列在收到数字型值时会被转成 `integer`，**同列混存储类后 `ORDER BY` 结果与时间序不一致**。

### 2.4 item4 · `boolean` 的实际存储值与读回类型

| 写入方式 | 原样读回 | `typeof` | 是否等于 `1` |
| ---- | ---- | ---- | ---- |
| SQL 字面量 `true` | `1` | `integer` | 1 |
| SQL 字面量 `false` | `0` | `integer` | 0 |
| SQL 字面量 `TRUE` | `1` | `integer` | 1 |
| SQL 字面量 `1` | `1` | `integer` | 1 |
| SQL 字面量 `0` | `0` | `integer` | 0 |
| SQL 字面量 `2` | `2` | `integer` | 0（不拦越界） |
| **JS 驱动 `.bind(true)`** | `1` | `integer` | 1 |
| **JS 驱动 `.bind(false)`** | `0` | `integer` | 0 |
| JS 驱动 `.bind(1)` | `1` | `integer` | 1 |
| SQL 字面量 `'true'`（字符串） | `"true"` | **`text`** | 0 |
| SQL 字面量 `'yes'` | `"yes"` | **`text`** | 0 |
| JS 驱动 `.bind('true')` | `"true"` | **`text`** | 0 |

存储类分布：`{"integer":9,"text":3}`。

`tinyint` 列（`schema.md` 用 17 次）的补充实测：

| 写入 | 读回 | `typeof` |
| ---- | ---- | ---- |
| `true` | `1` | `integer` |
| `2` | `2` | `integer` |
| **`300`** | **`300`** | `integer` —— **未拦越界** |

**原样结论**：D1 **没有原生布尔**。`boolean` 声明列的亲和类是 NUMERIC；SQL 的 `true/false/TRUE` 字面量与 JS 的 `.bind(true/false)` **全部落成 integer `1/0`**；字符串 `'true'` 落成 `text` 且与 `1` 不等值。**读回永远不返回 JS `boolean`**（返回 `1` / `0` / `"true"`）。同一列可同时存在 `integer` 与 `text` 两类值。`tinyint` **不约束取值区间**（实测写入 300 成功）。

### 2.5 item5 · 中文在 BINARY 排序下的行为

写入三个值：`张三` / `李四` / `王五`，再按不同方式排序。

| 排序方式 | 原样结果 |
| ---- | ---- |
| `ORDER BY name`（默认，即 BINARY） | `张三, 李四, 王五` |
| `ORDER BY name COLLATE BINARY` | `张三, 李四, 王五` |
| `ORDER BY name COLLATE NOCASE` | `张三, 李四, 王五`（**对中文无影响**） |
| `ORDER BY name DESC` | `王五, 李四, 张三` |
| `ORDER BY name COLLATE PINYIN` | ❌ 报错 `no such collation sequence: PINYIN` |
| `ORDER BY name COLLATE zh` | ❌ 报错 `no such collation sequence: zh` |

字节层面证据：

| 值 | UTF-8 十六进制 | 首字符码点 |
| ---- | ---- | ---- |
| 张三 | `E5BCA0E4B889` | 24352 |
| 李四 | `E69D8EE59B9B` | 26446 |
| 王五 | `E78E8BE4BA94` | 29579 |

**独立参考序**（主机侧 Node v22.22.2 / ICU 78.2，与本探针无关的第三方计算）：

| 参考 | 结果 |
| ---- | ---- |
| `Intl.Collator('zh-Hans-CN')` 排序 | **`李四, 王五, 张三`** |
| 逐字符码点升序 | `张三, 李四, 王五` |

**原样结论**：D1 默认排序是 **BINARY（字节序 = 码点序）**，结果 `张三,李四,王五`；独立拼音参考序是 `李四,王五,张三`。**两者不相等。** `COLLATE NOCASE` 只折 ASCII 大小写，对中文无效；`PINYIN` / `zh` 排序规则**不存在**。另：`PRAGMA collation_list` 被 D1 拒（见 §3 第 25 行），**无法用 PRAGMA 自证可用排序规则清单**。

### 2.6 item6 · 复合 `UNIQUE` 与 `CHECK`

**复合 UNIQUE**（`probe_uk`，`UNIQUE(goal_id, version_no)`）：

| 操作 | 原样结果 |
| ---- | ---- |
| 写 `(g1,1)` | 成功 |
| 再写 `(g1,1)` | ❌ `UNIQUE constraint failed: probe_uk.goal_id, probe_uk.version_no` |
| 写 `(g1,2)` | 成功 |
| 写 `(NULL,1)` 两次 | **两次均成功** |
| 写 `(g1,NULL)` 两次 | **两次均成功** |
| 最终落库 | 6 行：`(g1,1) (g1,2) (NULL,1) (NULL,1) (g1,NULL) (g1,NULL)` |
| 索引定义 | `sqlite_autoindex_probe_uk_1`（`sql` 字段为 `null`） |

**CHECK 隔离测试**（`probe_check_len`，`CHECK (length(code) <= 24)`）：

| 操作 | 原样结果 |
| ---- | ---- |
| 24 字符 | 成功 |
| 25 字符 | ❌ `CHECK constraint failed: length(code) <= 24` |
| **NULL** | **成功（放行）** |
| 空串 `''` | 成功（`length('')=0`） |
| **24 个中文（24 字符 / 72 字节）** | **成功** |
| 25 个中文（25 字符 / 75 字节） | ❌ `CHECK constraint failed: length(code) <= 24` |
| `UPDATE` 该行改成 25 字符 | ❌ 同上报错（**CHECK 约束 UPDATE**） |
| `UPDATE` 该行改成 NULL | 成功 |
| 读回 | `len24 {chars:24,bytes:24}` / `len_null {is_null:1}` / `len_empty {chars:0}` / `len_cn24 {chars:24,bytes:72}` |

**CHECK 用 `GLOB`**（`probe_check_glob`，`CHECK (kind GLOB 'F-[0-9]*')`）：

| 值 | 结果 |
| ---- | ---- |
| `F-01` / `F-999` / `F-1` | 成功 |
| `F-01extra` | **成功**（`GLOB` 前缀匹配过宽） |
| `X-1` / `''` | ❌ `CHECK constraint failed: kind GLOB 'F-[0-9]*'` |
| **`f-01`** | ❌ 报错 —— **`GLOB` 区分大小写** |
| NULL | 成功（放行） |

**CHECK 用 `typeof`**（`probe_check_type`，`CHECK (typeof(ts) = 'text')`）：

| 值 | 结果 | 说明 |
| ---- | ---- | ---- |
| ISO 串 `2026-09-18T00:00:00Z` | 成功 | 落 `text` |
| JS number `20260918` | ❌ 报错 | 落 `integer` |
| **纯数字串 `'20260918'`** | ❌ 报错 | **数字亲和把字符串转成了 `integer`** |
| 空串 `''` | 成功 | `typeof('')='text'` |
| **NULL** | ❌ 报错 | `typeof(NULL) = 'null'`，**CHECK 拒绝 NULL** |

**CHECK 用 `length(cast(x AS blob))`**（`probe_check_bytes`，字节上限 24）：

| 值 | 字符数 | 字节数 | 结果 |
| ---- | ---- | ---- | ---- |
| 24 个 ASCII | 24 | 24 | 成功 |
| 25 个 ASCII | 25 | 25 | ❌ 报错 |
| 8 个中文 | 8 | 24 | 成功 |
| 9 个中文 | 9 | 27 | ❌ 报错 |
| 12 个中文 | 12 | 36 | ❌ 报错 |
| NULL | — | — | 成功（放行） |

**多约束同时失败时报哪一条**（`probe_check_multi`，两条 CHECK）：

| 场景 | 报出的约束 |
| ---- | ---- |
| `code` 25 字符 **且** `kind='X-1'` | 只报 `length(code) <= 24`（声明顺序第一条），**`kind GLOB` 的违规未出现在报错里** |
| 仅 `code` 25 字符 | `length(code) <= 24` |
| 仅 `kind='X-1'` | `kind GLOB 'F-[0-9]*'` |

**原样结论**：复合 `UNIQUE` 按预期生效，但**含 NULL 的组合不被判重**。`CHECK` 里 `length()` / `GLOB()` / `typeof()` / `length(cast(x AS blob))` **全部可用**，且**约束 `UPDATE`**。`length()` 按**字符**计（24 个中文 = 72 字节仍通过），`cast(... AS blob)` 按**字节**计。`length(NULL)` 与 `NULL GLOB ...` 求值为 NULL → **CHECK 放行 NULL**；而 `typeof(NULL)='null'` 求值为 FALSE → **CHECK 拒绝 NULL**。多约束同时失败时，**只报第一条**。

---

## 3. `schema.md` 写法 → D1 实际行为 → 落差

> 一表到底，按"行为面"分行。**"落差"列只描述机制差异，不写应对策略。**

| # | `schema.md` 的写法 | D1 实际行为 | 落差 |
| ---- | ---- | ---- | ---- |
| 1 | `varchar(24)`（41 列） | 声明**原样保留**（`PRAGMA table_info` 返回 `varchar(24)`）；写 200 字符**不截断、不报错**，读回 `length()=200`、尾部完整，`typeof=text` | ⚠️ **有落差**：24 只是文档约定，D1 不承担。脏值无任何拦截 |
| 2 | `varchar(200)`（18 列）及其余 18 种 `varchar(n)`（共 180 列） | 同上：**长度一律不强制**。实测同列并存 24–200 字符 | ⚠️ **有落差**：180 个声明长度全部不设防，落差面覆盖全库 varchar 列 |
| 3 | `text`（29 列） | 无长度概念；本轮未触及上限 | ⚠️ 落差**类型不同**：不是"被截断"，而是"无上限"（受 2 MB/行 另论，本轮未测） |
| 4 | `datetime`（32 列） | 亲和类 = **NUMERIC**（不是 TEXT）。ISO 串原样落 `text`；**数字串 / JS number 被转成 `integer`**（实测 m2、m3） | 🔴 **落差且是隐患**：同一声明列可混存 `text` 与 `integer`（实测 10 text + 2 integer），混后 `ORDER BY` 与时间序不一致 |
| 5 | `int`（19 列）/ `tinyint`（17 列）/ `bigint`（1 列） | 均 INTEGER 亲和；`tinyint` **不约束区间**（写 300 成功存 300） | 🟡 **有落差**：`tinyint` 语义里的取值区间不成立 |
| 6 | `boolean`（schema 未用，你点名） | 亲和类 = NUMERIC。`true`/`false`/`TRUE` 与 JS `.bind(true/false)` 全部落 **integer 1/0**；`'true'` 落 `text`；**读回永不返回 JS boolean** | ⚠️ **有落差**：无原生布尔，且同列可混 `integer`/`text` |
| 7 | `real`（schema 未用，你点名） | REAL 亲和 | — 本轮未测到异常 |
| 8 | 空串 vs NULL | **可区分**：`is_null` 1/0、`length` null/0、`typeof` `null`/`text` 三维度都能分 | ⚠️ **有落差**：`NOT NULL` 只拦 NULL、**不拦空串**（写入成功） |
| 9 | `UNIQUE` 遇 NULL | 重复空串报 UNIQUE；**写 3 次 NULL 全成功**；含 NULL 的复合键同样不判重 | ⚠️ **有落差**：唯一性在 NULL 上失效 |
| 10 | ISO 8601 UTC 串（零填充、已归一） | 跨时区 / 跨月 / 闰日 **三组均 `字符串序 == julianday 序`** | ✅ **无落差**（前提是零填充 + 已归一到 UTC） |
| 11 | 带时区偏移的本地串 | 跨时区组 `ORDER BY local_txt = a2,a1` ≠ 时间序 `a1,a2` → **顺序反转** | 🔴 **落差且是隐患**：存带偏移的串会**静默**算错先后 |
| 12 | 未零填充的串（`2026-9-18`） | 字符串序 `p2,p1` ≠ 时间序 `p1,p2`；且 `julianday('2026-9-18T00:00:00Z')` = **NULL** | 🔴 **落差且是隐患**：连时间函数都解析不了，排序/比较都会得出错误结果 |
| 13 | 同列混存储类 | `ORDER BY col` = `m3,m2,m1`；`ORDER BY julianday(col)` = `m2,m3,m1` | 🔴 **落差且是隐患**：只要有一个数字型值混入，该列排序不可用 |
| 14 | 中文默认排序 | BINARY（字节序）：`张三,李四,王五`；独立 `Intl.Collator('zh-Hans-CN')` 参考序：`李四,王五,张三` | 🔴 **落差且是隐患**：**不是拼音序**，且不报错（静默给出"看着像排过"的结果） |
| 15 | `COLLATE BINARY` / `COLLATE NOCASE` | BINARY 同默认；NOCASE 对中文**无影响** | — 无新落差 |
| 16 | `COLLATE PINYIN` / `COLLATE zh` | 均报 `no such collation sequence` | 🔴 **有落差**：D1 无拼音排序规则 |
| 17 | 复合 `UNIQUE(a,b)` | 生效：重复对报 `UNIQUE constraint failed: <表>.a, <表>.b`；`(g1,2)` 通过 | ✅ 无落差 |
| 18 | `CHECK (length(x) <= n)` | 可用：25 字符拒、24 通过；**约束 UPDATE** | ✅ 可用 |
| 19 | 同上遇 NULL | `length(NULL) <= n` 求值为 NULL → **放行** | ⚠️ **有落差**：**不拦 NULL，不能替代 `NOT NULL`** |
| 20 | 同上按字符还是字节 | **按字符**：24 个中文（72 字节）通过；25 个中文拒 | ⚠️ **有落差**：若 `varchar(24)` 原意是 24 **字节**，`length()` 表达不了 |
| 21 | `CHECK (length(cast(x AS blob)) <= n)` | 可用且**按字节**：8 中文（24 B）通过、9 中文（27 B）拒 | ✅ 可用 |
| 22 | `CHECK (x GLOB 'F-[0-9]*')` | 可用、**区分大小写**（`f-01` 拒）；**前缀过宽**（`F-01extra` 通过） | ⚠️ **有落差**：`GLOB` 不是精确格式校验 |
| 23 | `CHECK (typeof(x) = 'text')` 遇 NULL | `typeof(NULL)='null'` → **拒绝 NULL** | ⚠️ **反差**：同为 CHECK，`length()` 那条放行 NULL、`typeof()` 这条拒绝 NULL —— **NULL 行为取决于表达式本身，不取决于 CHECK** |
| 24 | 多约束同时失败 | 只报**声明顺序第一条**，其余违规不出现在报错里 | ⚠️ **有落差**：报错信息不完整，排障时容易以为只有一条违规 |
| 25 | `sqlite_version()` / `PRAGMA collation_list` / `PRAGMA compile_options` | 全部 `D1_ERROR: not authorized to use function` / `not authorized: SQLITE_AUTH` | 🔴 **有落差**：D1 的 SQL 面被裁剪，**无法用 PRAGMA 自证运行环境** |
| 26 | `PRAGMA table_info(x)` | 可用，declared type 原样可读 | ✅ 可用 |
| 27 | 声明类型的大小写 | `text`→`TEXT`、`int`→`INT`、`integer`→`INTEGER`、`real`→`REAL` 被规范化；`varchar(24)`/`tinyint`/`bigint`/`boolean`/`datetime` **原样保留** | ℹ️ 事实，未测到后果 |

---

## 4. 附：20 种声明写法 → 亲和类

说明：亲和类由 SQLite 的规则决定（类型名含 `INT`→INTEGER；含 `CHAR`/`CLOB`/`TEXT`→TEXT；含 `REAL`/`FLOA`/`DOUB`→REAL；为空或含 `BLOB`→BLOB；**其余→NUMERIC**）。下表按实测与规则合并列出。

| # | 声明写法 | 列数 | 亲和类 | 长度是否强制 | 本项实测依据 |
| ---- | ---- | ---- | ---- | ---- | ---- |
| 1 | `varchar(24)` | 41 | TEXT | ❌ 不强制 | §2.1 |
| 2 | `varchar(200)` | 18 | TEXT | ❌ 不强制 | §2.1 |
| 3 | `varchar(300)` | 13 | TEXT | ❌ 不强制 | 按亲和类推广（未单独建列） |
| 4 | `varchar(120)` | 5 | TEXT | ❌ 不强制 | 同上 |
| 5 | `varchar(16)` | 28 | TEXT | ❌ 不强制 | 同上 |
| 6 | `varchar(32)` | 46 | TEXT | ❌ 不强制 | 同上 |
| 7 | `varchar(64)` | 16 | TEXT | ❌ 不强制 | 同上 |
| 8 | `varchar(100)` | 2 | TEXT | ❌ 不强制 | 同上 |
| 9 | `varchar(40)` | 3 | TEXT | ❌ 不强制 | 同上 |
| 10 | `varchar(8)` | 3 | TEXT | ❌ 不强制 | 同上 |
| 11 | `varchar(48)` | 1 | TEXT | ❌ 不强制 | 同上 |
| 12 | `varchar(128)` | 1 | TEXT | ❌ 不强制 | 同上 |
| 13 | `varchar(160)` | 1 | TEXT | ❌ 不强制 | 同上 |
| 14 | `varchar(20)` | 1 | TEXT | ❌ 不强制 | 同上 |
| 15 | `varchar(80)` | 1 | TEXT | ❌ 不强制 | 同上 |
| 16 | `text` | 29 | TEXT | 无长度概念 | §2.1（`c_text` 列为 TEXT 亲和） |
| 17 | `datetime` | 32 | **NUMERIC** | — | §2.3（数字型值被转成 `integer`） |
| 18 | `int` | 19 | INTEGER | — | §2.4（`tinyint` 同族） |
| 19 | `tinyint` | 17 | INTEGER | — | §2.4（写 300 成功） |
| 20 | `bigint` | 1 | INTEGER | — | 同 `int` 族 |
| 21 | `integer` | 0（你点名） | INTEGER | — | §2.1（`c_int2`） |
| 22 | `real` | 0（你点名） | REAL | — | 未测到异常 |
| 23 | `boolean` | 0（你点名） | **NUMERIC** | — | §2.4 |

> `varchar(n)` 合计 **180 列**，`text` 29 列，非 varchar 列 98 列，共 **278 个字段行 / 36 张表**。

---

## 5. 落差项映射到具体表与字段

**只列清单与分类依据，不代表我替你选策略。**

### 5.1 分类依据（先说规则，再看清单）

落差「`varchar(n)` 长度不强制」（§3 第 1、2 行）只对 `varchar(n)` 列成立，故只对 **180 个 varchar 列**分类。依据两条，按优先级判定：

| 类别 | 判定依据 | 为什么归这类 |
| ---- | ---- | ---- |
| **A · 编号锚点** | 满足任一：① `uniq` 含 **PK/UK** ② `uniq` 含 **FK** ③ 列名以 **`_no` / `_id` / `_code`** 结尾 | 这类值是全库的**主键与引用链载体**。D1 下超长写入**不报错、不截断**（§2.1），脏了会在引用处表现为"查不到 / 关联断"，**且不会在写入时报错**——属静默失效 |
| **B · 长文本** | 非 A，且声明长度 **≥ 100** | 自由文本（描述/摘要/依据/备注等）。单行超长只影响该字段自身的可读性，不牵动引用链 |
| **C · 其余短字段** | 非 A 非 B（长度 ≤ 64 且非键） | 多为状态/枚举/名称类，**不在本次两清单范围内**，仅给出计数，避免清单留白 |

> 说明：`text`（29 列）**不进 A/B/C**——它没有声明长度，落差类型不同（§3 第 3 行）。`int`/`tinyint`/`datetime`/`boolean` 同样不进，它们的落差是亲和类与存储类问题，不是长度问题。

### 5.2 清单 A · 编号锚点（**94 列**）

按依据分组。括号内为该列的声明类型。

**依据 = PK/UK + 命名（39 列）**

| 表 | 列 |
| ---- | ---- |
| CFG-01 | `source_id`(16) |
| CFG-02 | `tool_id`(32), `tool_code`(64) |
| CFG-03 | `permission_id`(32) |
| CFG-04 | `policy_id`(32) |
| CFG-05 | `rule_id`(24) |
| CFG-06 | `template_id`(32) |
| CFG-07 | `dict_type_code`(32) |
| CFG-08 | `dict_item_id`(32), `item_code`(32) |
| EXT-01 | `query_id`(24) |
| EXT-02 | `evidence_id`(24) |
| EXT-03 | `validation_id`(32) |
| LNK-01 | `link_id`(32) |
| LNK-02 | `link_id`(32) |
| LNK-03 | `relation_id`(32) |
| LNK-04 | `link_id`(32) |
| MD-01 | `goal_id`(32) |
| MD-02 | `goal_version_id`(40) |
| MD-03 | `material_id`(32) |
| MD-04 | `context_id`(32) |
| MD-05 | `touchpoint_id`(32) |
| MD-06 | `opportunity_id`(24) |
| MD-07 | `research_no`(24) |
| MD-08 | `finding_id`(32) |
| MD-09 | `candidate_id`(32) |
| MD-10 | `point_id`(32) |
| MD-11 | `action_id`(32) |
| MD-12 | `proposal_id`(32) |
| MD-13 | `profile_id`(32) |
| MD-14 | `skill_no`(16), `skill_code`(48) |
| PD-01 | `task_id`(24) |
| PD-02 | `step_id`(32) |
| PD-03 | `block_id`(32) |
| PD-04 | `gap_id`(32) |
| PD-05 | `log_id`(32) |
| PD-06 | `injection_id`(32) |
| PD-07 | `message_id`(32) |

**依据 = PK/UK（不含编号命名，4 列）**

| 表 | 列 |
| ---- | ---- |
| CFG-01 | `source_name`(64) |
| CFG-07 | `dict_type_name`(64) |
| MD-05 | `touchpoint_name`(64) |
| MD-12 | `idempotency_key`(128) |

**依据 = FK + 命名（45 列）**

| 表 | 列 |
| ---- | ---- |
| — | 27 × `varchar(24)`、15 × `varchar(32)`、3 × `varchar(16)` 的 FK 列，明细见 `schema.md` 各表「唯一性 / 值域」列为 `FK → xx` 的行 |

> 明细未逐列展开（45 列横跨 20 余张表），判定条件已固化在上表规则里，可用同一条 `grep` 复现。

**依据 = 命名（非键，6 列）**

| 表 | 列 |
| ---- | ---- |
| CFG-06 | `context_type_code`(24) |
| LNK-04 | `object_id`(40) |
| MD-13 | `agent_code`(32) |
| PD-03 | `block_reason_code`(32) |
| PD-06 | `context_type_code`(24), `ref_object_id`(40) |

### 5.3 清单 B · 长文本（**39 列**）

| 表 | 列 |
| ---- | ---- |
| CFG-01 | `capability_can`(300), `capability_cannot`(300) |
| CFG-02 | `tool_purpose`(200), `call_condition`(200) |
| CFG-03 | `restrict_reason`(200) |
| CFG-05 | `match_pattern`(200), `gap_text`(200), `impact_note`(200) |
| CFG-07 | `used_by_field`(120) |
| EXT-01 | `fail_reason`(200) |
| EXT-02 | `evidence_title`(200), `applicability_scope`(300) |
| EXT-03 | `source_ref`(200) |
| MD-02 | `business_goal`(200), `business_scope`(300), `focus_period`(100), `provider`(100), `change_note`(200) |
| MD-03 | `material_name`(200) |
| MD-04 | `title`(120), `source_ref`(200) |
| MD-05 | `position_desc`(120) |
| MD-06 | `opportunity_title`(200), `target_object`(300) |
| MD-07 | `behavior_hypothesis`(300), `population_limit`(300) |
| MD-09 | `behavior_name`(300) |
| MD-11 | `target_for`(120), `problem_what`(200) |
| MD-12 | `behavior_hypothesis`(300), `population_limit`(300) |
| PD-01 | `trigger_basis`(300), `agent_version_snapshot`(160) |
| PD-02 | `step_name`(120) |
| PD-03 | `block_note`(300), `resume_condition`(200) |
| PD-04 | `gap_text`(200), `impact_note`(200) |
| PD-05 | `change_reason`(300) |

按类型分布：`varchar(200)` 18、`varchar(300)` 13、`varchar(120)` 5、`varchar(100)` 2、`varchar(160)` 1。

### 5.4 清单 C · 其余短字段（**47 列**，仅计数）

| 类型 | 列数 |
| ---- | ---- |
| `varchar(16)` | 23 |
| `varchar(64)` | 12 |
| `varchar(24)` | 6 |
| `varchar(8)` | 3 |
| `varchar(32)` | 1 |
| `varchar(80)` | 1 |
| `varchar(20)` | 1 |

> 未列入 A/B 的意思是：**既不是引用链载体（不满足 A），也不是自由文本（不满足 B）**。是否要治理，取决于你对这些字段的语义判断，不在本清单范围内。

### 5.5 分类计数对账

| 类别 | 列数 |
| ---- | ---- |
| A 编号锚点 | 94 |
| B 长文本 | 39 |
| C 其余短字段 | 47 |
| **`varchar(n)` 小计** | **180** |
| `text`（另类，见 §3 第 3 行） | 29 |
| 非 varchar（`datetime`/`int`/`tinyint`/`bigint`） | 69 |
| **`schema.md` 字段行合计** | **278** |

> 校验：94+39+47 = 180 ✓；180+29+69 = 278 ✓（与 `schema.md` 实际字段行数一致，36 张表）

---

## 6. 未测 / 未验（诚实清单）

| # | 项 | 状态 |
| ---- | ---- | ---- |
| 1 | 上述行为在**线上 D1**（非 miniflare local）是否逐条一致 | ⬜ **未验证**（无线上凭据）。尤其 §3 第 25 行的 `not authorized` 属 D1 授权层，本地与线上是否同规则未验 |
| 2 | D1 的 SQLite **引擎版本号** | ⬜ 无法从 SQL 读出（`sqlite_version()` 被拒），本地也未单独确认 miniflare 打包的版本 |
| 3 | **2 MB/行**与 **10 GB/库**上限 | ⬜ 未测（属 `tech-stack.md` §4，本轮不在范围） |
| 4 | `varchar(n)` 长度声明在 **D1 的 `.all()` / 批量写 / 事务**路径下行为是否一致 | ⬜ 未测（本轮全部走单条 `prepare().bind().all()`） |
| 5 | 长文本被截断时是否有**警告**（而非静默） | ⬜ 未测；本轮只测到"不截断" |
| 6 | 中文排序的**其他参考实现**（如 `pypinyin`） | ⬜ 本轮只用 `Intl.Collator('zh-Hans-CN')`（ICU 78.2）作参考序 |
| 7 | `COLLATE` 在 **索引**上的行为（建索引时能带 collation 吗） | ⬜ 未测 |
| 8 | `CHECK` 与 **NULL** 的完整矩阵（本轮只覆盖 `length` / `GLOB` / `typeof` 三类表达式） | ⬜ 部分覆盖 |
| 9 | `tinyint` 之外，`int` / `bigint` 的越界行为（如写 `2^63`） | ⬜ 未测 |

---

## 反向清单

> 宪法「双向引用」要求：头部写上游卡，尾部写反向清单，并登记进最近一层目录的 README。

**上游（我来自哪）**

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../../../AGENTS.md` | 宪法：一条硬红线｜编号体系｜双向引用｜索引三层 | 强约束 |
| `../../../docs/03-locks/tech-stack.md` | §3 类型映射表（含"`varchar(n)` 不强制长度"的**未实测断言**）、§8 **TS-11** | 本文件是 TS-11 的事实输入 |
| `../../../docs/03-locks/schema.md` | 20 种类型写法的出现频次与 278 个字段行（本文件§5 分类的输入） | **本文件未修改它** |
| `../fk/` | TS-14 实测的 worker 探针范式（本文件沿用）；其结论已见于 `../fk/README.md` | 范式同级 |

**反向（我被谁引用）**

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `db/probes/README.md` | **枝杈登记**（最近一层目录） | ✅ 已登记 |
| `../../../docs/03-locks/tech-stack.md` §3.1 / §3.2 / §3.3、§8 TS-11 | 事实输入：`varchar(n)` 不强制长度、`datetime` 亲和、中文排序、`CHECK` 可用性 | ✅ **已回填（2026-09-19，tech-stack v1.2）**；**策略面已于 2026-09-20 裁决**（tech-stack **v1.3** §8 TS-11）：**应用层校验**——库级 `CHECK` 不写进 `0001`，须在各写入面分别落实 |
| `../../../docs/03-locks/schema.md`（v1.3） | 若按本文件事实调整字段声明或增补约束，需回指 | ✅ **已互指（2026-09-19）**：其 Q-05 的 `CHECK (length(trim(x)) > 0)` 设计经 `ADR-003` §3.1 引用本文件实测（并已按本文件结论补上「`CHECK` 不拦 NULL，须配 `NOT NULL`」）。v1.3 为宪法交叉引用校正，未改字段 |
| `../../../db/` 迁移脚本 | 建表时对类型/约束的取舍依据 | ✅ 已建（2026-09-19） |

> **诚实说明（更新于 2026-09-19）**：本文件的**上游与反向现已双向闭环**。上游 `schema.md` 的类型清单是实际解析所得（148 条执行记录有原始 JSON 存证）；反向原有三处 `⏳` 已收敛——`tech-stack.md` §3.1 / §3.2 / §3.3 已按本文件实测改写（`varchar(24)` 写 200 字符不截断、`datetime` 实为 NUMERIC 亲和、`CHECK` 按字符计且不拦 NULL 三句均已落文），`schema.md` v1.2 的 `CHECK` 设计已回指本文件。**仍未收敛的一面是「策略」而非「事实」**：TS-11 的兜底方式（应用层校验 vs 库级 `CHECK`）尚未裁决，故 `db/` 迁移脚本仍未建。

---

## 事实来源汇总（便于复核）

| 数字 | 值 | 出处 |
| ---- | ---- | ---- |
| 探针表数 | 11 | `schema.sql` |
| 执行记录 | 148（成功 121 / 报错 27） | `raw/*.json` |
| 原始响应体量 | 64,887 B | `raw/` |
| `schema.md` 字段行 | 278 | `/tmp` 解析脚本（可重跑） + `schema.md` |
| `schema.md` 表数 | 36 | 同上 |
| 类型写法种类 | 20 | 同上 |
| `varchar(n)` 列 | 180 | 同上 |
| 编号锚点 / 长文本 / 其余 | 94 / 39 / 47 | 本文件 §5 |
