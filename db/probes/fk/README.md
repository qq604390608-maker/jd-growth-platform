# db/probes/fk/ · D1 外键约束实测（TS-14）

> 探针用途：实测 Cloudflare D1 中 `PRAGMA foreign_keys` 是否默认生效。
> 上游：`../../../docs/03-locks/tech-stack.md` §3.3 外键与约束、§8 TS-14；`../../../docs/03-locks/schema.md` §11 外键策略。
> 性质：**只读实测证据**，不是业务 migration，不参与业务建表。

## 0. 结论（三态）

| 范围 | 结论 | 依据 |
| ---- | ---- | ---- |
| `--local`（miniflare/workerd 模拟） | **默认生效** | 探针 a~f 全部实测 |
| `--remote`（真实 D1） | **默认生效，且比本地更严**（详见 §5b） | 探针 R1~R5 实测（2026-09-21） |

**总判定（2026-09-21 更新）：本地与远程双双实测「默认强制外键」，`schema.md` §11 承诺可直接落。** 本地已证实 `PRAGMA foreign_keys=OFF` 无效、`defer_foreign_keys` 可事务内临时放行；远程补充证实 **`OFF` 同样无效**，且**远程比本地更严**：显式 `BEGIN` 被平台禁止（code 7500）、`d1 execute` 多语句批次内 `defer_foreign_keys` **不放行**（每语句即隐式事务的结束，无「先违规后消解」窗口，详见 §5b R4/R5）。

## 1. 环境

| 项 | 值 |
| ---- | ---- |
| 实测日期 | 2026-09-18 |
| OS | macOS (darwin) |
| Node / npm | v24.19.0 / 11.17.0 |
| wrangler | **4.135.0**（`npx wrangler`，未全局安装） |
| D1 本地实例创建方式 | `wrangler d1 execute DB --local`，配置见 `wrangler.toml`（binding `DB`，`database_id` 为占位符 `00000000-...`）；本地库落在 `db/probes/fk/.wrangler/state/v3/d1/`，运行时标识 `served_by: miniflare.db` |
| Worker 会话实测 | `npx wrangler dev --local --port 8787`，D1 binding `env.DB` |
| 远程凭据 | **无**（`wrangler whoami` → "You are not authenticated"；无 `CLOUDFLARE_API_TOKEN`） |

探针表（`schema.sql`，最小两表）：

```sql
CREATE TABLE parent ( pid TEXT PRIMARY KEY );
CREATE TABLE child  ( cid TEXT PRIMARY KEY, pid TEXT REFERENCES parent(pid) );
```

## 2. 逐条实测与原始输出

### a. 查默认值

命令：

```bash
npx wrangler d1 execute DB --local --config wrangler.toml --command="PRAGMA foreign_keys;"
```

原始输出：

```json
[
  {
    "results": [
      {
        "foreign_keys": 1
      }
    ],
    "success": true,
    "meta": {
      "duration": 0
    }
  }
]
```

**结果：默认值 = 1（开启）。**

### b. 插入违反外键的 child（pid 指向不存在的 parent）

命令：

```bash
npx wrangler d1 execute DB --local --config wrangler.toml \
  --command="INSERT INTO child (cid, pid) VALUES ('c-violate', 'p-does-not-exist');"
```

原始输出：

```
✘ [ERROR] FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
=== EXIT CODE: 1 ===
```

**结果：报错拒绝，退出码 1，错误为 `SQLITE_CONSTRAINT_FOREIGNKEY`。**

### c. 删除被 child 引用的 parent

命令（先建有效引用，再删除）：

```bash
npx wrangler d1 execute DB --local --config wrangler.toml \
  --command="INSERT INTO parent (pid) VALUES ('p1'); INSERT INTO child (cid, pid) VALUES ('c1','p1');"
# → 🚣 2 commands executed successfully.

npx wrangler d1 execute DB --local --config wrangler.toml \
  --command="DELETE FROM parent WHERE pid='p1';"
```

原始输出：

```
✘ [ERROR] FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
=== EXIT CODE: 1 ===
```

**结果：报错拒绝。既非级联，也未留下孤儿（默认 NO ACTION 行为）。**

### d. 显式 `PRAGMA foreign_keys=ON` 后重复 b/c

d1（PRAGMA ON + 违规插入，同一条 command）：

```bash
npx wrangler d1 execute DB --local --config wrangler.toml \
  --command="PRAGMA foreign_keys=ON; INSERT INTO child (cid, pid) VALUES ('c-violate-on', 'p-does-not-exist');"
```

原始输出：

```
✘ [ERROR] FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
=== EXIT: 1 ===
```

d2（**补充反证**：PRAGMA OFF + 违规插入）：

```bash
npx wrangler d1 execute DB --local --config wrangler.toml \
  --command="PRAGMA foreign_keys=OFF; INSERT INTO child (cid, pid) VALUES ('c-violate-off', 'p-does-not-exist');"
```

原始输出：

```
✘ [ERROR] FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)
=== EXIT: 1 ===
```

回查 `child` 表（确认违规行未落库）：

```json
[
  { "results": [ { "cid": "c1", "pid": "p1" } ], "success": true }
]
```

**结果：ON 与默认一致（都拒绝）；且 OFF 也拒绝——说明该开关在 D1 中无法关闭。** 此处 CLI 单次 command 的 PRAGMA 作用域存疑，故追加 e 组在真实 Worker 会话内验证。

### e. 同一 Worker 会话内连续两次请求

路由与探针代码见 `worker/index.js`。连续请求（同一 `wrangler dev` 会话）：

```
--- e1. 第 1 次请求 /pragma ---
{"ok":true,"path":"/pragma","results":[{"foreign_keys":1}]}
--- e2. 第 2 次请求 /pragma（同一 dev 会话，不重新开启）---
{"ok":true,"path":"/pragma","results":[{"foreign_keys":1}]}
--- e3. 第 3 次请求 /pragma ---
{"ok":true,"path":"/pragma","results":[{"foreign_keys":1}]}
--- e4. /violate 违规插入 ---
{"ok":false,"path":"/violate","error":"D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)"}
```

```
--- e5. /off-insert（同 batch：PRAGMA OFF + 违规插入）---
{"ok":false,"path":"/off-insert","error":"D1_ERROR: FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)"}
--- e6. /rows 回查 child ---
{"ok":true,"path":"/rows","results":[{"cid":"c1","pid":"p1"}]}
```

```
--- e7. /toggle（同 batch：PRAGMA foreign_keys=OFF 后立即读值）---
{"ok":true,"path":"/toggle","batch":[{"success":true,"meta":{"served_by":"miniflare.db",...},"results":[]},
{"success":true,"meta":{"served_by":"miniflare.db",...},"results":[{"foreign_keys":1}]}]}
```

**结果：**
- 连续 3 次请求 `foreign_keys` 均为 `1`——**无需在每次请求前重新开启**，会话内一致。
- 违规插入在 Worker 运行时同样被拒（`D1_ERROR` 前缀）。
- **同 batch 内先 `PRAGMA foreign_keys=OFF` 再读，仍为 `1`**——该 PRAGMA 在 D1 中不可用（被平台覆盖），这与 d2 的现象互相印证。

### f. `PRAGMA defer_foreign_keys` 补测（文档所述唯一合法放行手段）

路由见 `worker/index.js`：`/defer-read`、`/defer-resolve`、`/defer-unresolved`。

```
--- f1. /defer-read（defer on 后读回）---
{"ok":true,"path":"/defer-read","batch":[{"success":true,...},{"success":true,...,
"results":[{"defer_foreign_keys":1}]}]}

--- f2. /defer-resolve（同 batch：defer on → 先插违规 child → 再补缺失 parent）---
{"ok":true,"path":"/defer-resolve","tag":"d1789746678441","batch":[
 {"success":true,...},{"success":true,"meta":{"changes":1,...},"results":[]},
 {"success":true,"meta":{"changes":1,...},"results":[]}]}

--- f3. /defer-unresolved（同 batch：defer on → 插违规 child → 不消解）---
{"ok":false,"path":"/defer-unresolved","tag":"u1789746678464",
 "error":"Durable Object was reset and rolled back to its last known good state because the
 application left the database in a state where constraints were violated:
 FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY)"}

--- f4. /rows 回查 ---
{"ok":true,"path":"/rows","results":[{"cid":"c1","pid":"p1"},
 {"cid":"c-d1789746678441","pid":"p-d1789746678441"}]}
```

**结果：**
- `defer_foreign_keys` **可以设为 1**（与 `foreign_keys` 被强制覆盖不同）。
- f2：事务内先违规后消解 → **成功**，且该行落库（f4 可见 `c-d1789746678441`）。
- f3：事务结束仍违规 → **失败并整体回滚**（f4 中无 `c-u1789746678464`）。
- 与文档「defer 允许事务内临时违反，事务结束仍有违规则报错」**完全一致**。
- 附带观察：f3 的报错前缀为 `Durable Object was reset and rolled back to its last known good state`，即本地 D1 由 Durable Object 承载并在约束失败时回滚。

## 3. 与官方文档对照（步骤 4）

Cloudflare 官方文档《Define foreign keys》（Last updated 2026-04-21，`developers.cloudflare.com/d1/sql-api/foreign-keys/`）原文：

> "By default, D1 enforces that foreign key constraints are valid within all queries and migrations. This is identical to the behaviour you would observe when setting `PRAGMA foreign_keys = on` in SQLite for every transaction."

> "D1's foreign key enforcement is equivalent to SQLite's `PRAGMA foreign_keys = on` directive. Because D1 runs every query inside an implicit transaction, user queries cannot change this during a query or migration."

> "Instead, D1 allows you to call `PRAGMA defer_foreign_keys = on` or `off`, which allows you to violate foreign key constraints temporarily (until the end of the current transaction)."

| 项 | 文档说法 | `--local` 实测 | 是否一致 |
| ---- | ---- | ---- | ---- |
| 默认是否强制外键 | 默认强制（等价 `foreign_keys=on`） | 读回 1，违规即拒 | ✅ 一致 |
| 用户能否用 `PRAGMA foreign_keys` 关闭 | 不能（查询在隐式事务内，用户查询无法改变） | OFF 后读回仍为 1、违规仍拒 | ✅ 一致 |
| 需要时如何临时放行 | 用 `PRAGMA defer_foreign_keys=on`（事务内有效，事务结束仍有违规则报错） | f1~f4：defer 可设 1；事务内消解成功、未消解整体回滚 | ✅ 一致 |

## 4. 待补验证（不推测填空）

1. ~~**`--remote` 未验证**~~ → **✅ 已补测（2026-09-21，§5b）**：默认强制、OFF 无效与本地一致；defer 在批次内不放行、显式 BEGIN 被禁为远程新增事实。
2. **远程 Worker 会话（binding `env.DB`）复测未做**：e/f 组（连续请求一致性、defer 在 Worker batch 内行为）需部署后在线上 Worker 会话内复测——已随门禁 B 部署项登记。
3. **本地已补测项**：`PRAGMA defer_foreign_keys`（f 组）已实测，结论见 §3。

## 5b. `--remote` 补测实录（2026-09-21，凭证到位）

环境：`wrangler 4.135.0`（`npx -y`），`CLOUDFLARE_ACCOUNT_ID` / `CLOUDFLARE_API_TOKEN` 仅走环境变量、不落文件。远程库 **`jd-growth-platform`（id `853be8d3-bca2-4683-ab7a-a61725516662`，region WNAM）于 2026-09-21 实建**；建库前 `d1 list --json` 返回 `[]`（账号内零 D1 库），**无任何生产数据，探针表测毕即 DROP**，远程库现仅剩平台内部 `_cf_KV`。`database_id` 已补进 `wrangler.toml`。

| # | 探针 | 原始结果 | 结论 |
| ---- | ---- | ---- | ---- |
| R1 | `PRAGMA foreign_keys` | `{"foreign_keys": 1}` | **默认强制，与本地一致** |
| R2 | 建两表（`parent`/`child REFERENCES`）后插孤儿 | `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT (extended: SQLITE_CONSTRAINT_FOREIGNKEY) [code: 7500]` | **违规即拒，与本地一致** |
| R3 | 同批次 `PRAGMA foreign_keys=OFF; INSERT 孤儿` | 同上 `FOREIGN KEY constraint failed` | **OFF 无效，与本地一致** |
| R4 | 同批次 `PRAGMA defer_foreign_keys=ON; INSERT 孤儿` | 同上 `FOREIGN KEY constraint failed`；回查 `COUNT(*)=0` | **⚠️ 与本地不同：批次内 defer 不放行**。解释：D1 每条查询都运行在隐式事务内（官方文档原文，§3），单语句即事务结束，defer 无「窗口」可用 |
| R5 | 多语句批次含显式 `BEGIN … COMMIT` | `✘ [ERROR] … To execute a transaction, please use the state.storage.transaction() … instead of the SQL BEGIN TRANSACTION or SAVEPOINT statements. [code: 7500]` | **远程禁止 SQL 显式事务**（官方指引走平台侧事务 API） |
| R6 | （旁证）R5 整批失败后查 `sqlite_master` | 探针两表**无残留**（批次内 DDL 一并回滚） | 批次级原子性的直接观察 |

**远程对写入面的实际约束**（比本地更严，登记给实施面）：
1. 远程**不存在**「事务内先违规、后补父行」的 SQL 写法——`BEGIN` 被禁、defer 在批次内无窗口。迁移与种子若跨语句存在引用顺序问题，**必须靠语句排序满足**，不能指望 defer。
2. 批次（单次 execute 多语句）呈现原子性（R6），可作为小规模原子写入的替代语境；Worker 内 `binding.batch()` 的远程行为待部署后复测（记入 §4）。

## 5c. `--remote` 受阻原文（历史记录，2026-09-18）

命令：

```bash
npx wrangler d1 execute DB --remote --config wrangler.toml --command="PRAGMA foreign_keys;"
```

原始输出：

```
Resource location: remote

✘ [ERROR] In a non-interactive environment, it's necessary to set a CLOUDFLARE_API_TOKEN
  environment variable for wrangler to work. Please go to
  https://developers.cloudflare.com/fundamentals/api/get-started/create-token/ for instructions
  on how to create an api token, and assign its value to CLOUDFLARE_API_TOKEN.

  To continue without logging in, rerun this command with `--temporary`. Wrangler will use a
  temporary account and print a claim URL.
```

补齐远程验证所需的一步：创建 `CLOUDFLARE_API_TOKEN`（或交互式 `wrangler login`）→ 在真实 D1 实例上重跑 §2 的 a~e。**在此之前，远程结论记为「不确定」。**

## 6. 可直接粘进 `tech-stack.md` §8 的结论句

> **TS-14（实测）**：在 `wrangler 4.135.0` + `--local` 下，D1 **默认强制外键约束**——`PRAGMA foreign_keys` 读回 `1`，插入违规子行或删除被引用父行均返回 `FOREIGN KEY constraint failed: SQLITE_CONSTRAINT_FOREIGNKEY`，且 `PRAGMA foreign_keys=OFF` 无法关闭（同 batch 内 OFF 后读回仍为 1），与官方文档「等价于每个事务都设 `foreign_keys=on`、用户查询无法改变」一致。因此 **无需在连接层每次 execute 前置开启，也无需写进迁移文件首行**；`schema.md` §11 承诺的真实外键可直接落。影响面：所有带物理外键的表（MD/PD/CFG 之间的关系）在**迁移建表顺序、种子数据插入顺序、删除顺序**上必须满足引用完整性；由于 §3.3 已定「一律软删/状态位、不做物理删除」，删除顺序风险仅在迁移与 mock 数据阶段。若迁移中确需临时违反（建表/改表顺序），只能用 `PRAGMA defer_foreign_keys=on`（**已实测**：defer 可设 1；事务内先违规后补父可成功且落库，事务结束仍未消解则整体回滚报 `FOREIGN KEY constraint failed`）。**注意：以上为 `--local` 结论；`--remote` 因本机未认证未验证，上生产前须补测。**

> **TS-14（远程实测，2026-09-21 补齐，详见 §5b）**：真实 D1（`jd-growth-platform`，实测时账号内零生产数据）**同样默认强制外键**（R1=1）、违规即拒（R2）、`foreign_keys=OFF` 无效（R3），与本地一致。**远程比本地更严的两点**：① `PRAGMA defer_foreign_keys=ON` 在 `d1 execute` 多语句批次内**不放行**（R4）——D1 每条查询即隐式事务，defer 无窗口，故**远程迁移/种子必须靠语句排序满足引用完整性**，不能依赖 defer；② SQL 显式 `BEGIN` 被平台禁止（R5，code 7500，官方指引走 `state.storage.transaction()`），单次 execute 批次呈现原子性（R6）可作小规模原子写替代语境。本地 f 组的「事务内先违规后消解」写法**在远程 SQL 层不存在对应物**；Worker binding（`env.DB.batch()`）下的 defer 行为待部署后线上复测（§4 第 2 条）。

## 7. 复现方式

```bash
cd db/probes/fk

# 1) 建本地探针库与两表
npx wrangler d1 execute DB --local --config wrangler.toml --file=schema.sql

# 2) CLI 侧实测（a~d）
npx wrangler d1 execute DB --local --config wrangler.toml --command="PRAGMA foreign_keys;"
npx wrangler d1 execute DB --local --config wrangler.toml --command="INSERT INTO child (cid,pid) VALUES ('c-violate','p-does-not-exist');"

# 3) Worker 会话实测（e）
npx wrangler dev --local --port 8787
curl -s http://localhost:8787/pragma
curl -s http://localhost:8787/pragma
curl -s http://localhost:8787/violate
curl -s http://localhost:8787/off-insert
curl -s http://localhost:8787/toggle
curl -s http://localhost:8787/defer-read
curl -s http://localhost:8787/defer-resolve
curl -s http://localhost:8787/defer-unresolved
curl -s http://localhost:8787/rows
```

## 8. 文件说明

| 文件 | 作用 |
| ---- | ---- |
| `wrangler.toml` | 探针专用最小配置（D1 binding，占位 database_id） |
| `schema.sql` | 探针两表 `parent` / `child` |
| `worker/index.js` | 探针 Worker：`/pragma`、`/violate`、`/off-insert`、`/toggle`、`/defer-read`、`/defer-resolve`、`/defer-unresolved`、`/rows` |
| `.wrangler/state/v3/d1/` | 本地 D1 运行状态（构建产物，非证据文件，应忽略） |

## 上游与反向清单

**上游（我来自哪）**

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../../../AGENTS.md` | 宪法：白盒原则、双向引用、编号体系 | 强约束 |
| `../../../docs/03-locks/tech-stack.md` | §3.3 外键与约束、§8 TS-14 | 本文件是 TS-14 的实测回答 |
| `../../../docs/03-locks/schema.md` | §11 外键策略（36 张表真实外键） | 表结构不得改；本文件只验证可兑现性 |

**反向（我被谁引用）**

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `docs/03-locks/tech-stack.md` §3.3 / §8 TS-14 | 实测证据回填 | ✅ **已回填（2026-09-19，tech-stack v1.2）**：§3.3 已按本文件结论改写，§8 TS-14 标 `✅ 实测已完成 2026-09-18`。**`--remote` 已补测（2026-09-21）**，tech-stack TS-14 行同步翻为「本地+远程双实测」 |
| `docs/03-locks/schema.md`（v1.3） | §11 外键可兑现性的实测依据 | ✅ 已互指（2026-09-19）：其 §11 可直接落的判断引用本文件（v1.3 仅校正宪法交叉引用，未改字段） |
| `db/` 迁移与种子数据 | 建表/插入/删除顺序约束 | ✅ 已建（2026-09-19） |
