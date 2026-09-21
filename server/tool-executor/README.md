# tool-executor · M5 工具执行程序（server/tool-executor）

> 文档卡（阶段2 · M5 · 2026-09-19）
> 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径「查询证据必须带来源/条件/时点/适用范围」）
> ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md`（F-23~F-26 验收要点；F-23＝权限分支互斥，不允许时保存原因并返回受限原因）
> ｜ `../../docs/03-locks/schema.md`（CFG-02 `tool_registry` L533-545｜CFG-03 `tool_permission` L547-561｜CFG-01 `source_registry` L516-531｜CFG-04/05｜**EXT-01 `query_record` L700-714**｜§11 字典枚举｜§12 Q-09~Q-11）
> ｜ `../../docs/03-locks/tech-stack.md`（DS-06 自建 MCP 客户端；**五项协议面**归 F-24，落在 `mcp-client.js`）
> ｜ `../../docs/03-locks/external-deps.md` §5（12 工具 TOL-01~12 文档视图，与 CFG-02 同源；**TOL-12 是「不存在」**；TOL-03/TOL-10 能力不足；TOL-11 降级）
> ｜ `../../docs/03-locks/external-deps.md` §6（mock 契约：请求含 `tool_code` + `query_condition`；响应须能映射到 EXT-01 六字段；七类行为 + 超时失败 + 执行中）
> ｜ `../../docs/05-test-cases/test-M5.md`（`TC-U-M5-001` / `TC-C-M5-001` / `TC-I-M5-001` / `TC-I-M5-002` / `TC-I-M5-005`；**`TC-D-M5-005` / `TC-I-M5-003` 归 F-25**）
> ｜ `../../prototype/mock/scenarios.js`（九类真实返回体，`test-f24.mjs` 直接取用作夹具）
> ｜ `../../docs/04-plan/dev-plan.md`（阶段 2 · M5：关键交付物 / 验收要点 / 依赖前序 / 风险与待确认）
> ｜ `../../db/migrations/0001_init.sql` L49-92
>
> 职责：M5 的查询执行与留痕层。**F-23~F-26 已全建**——F-23 工具注册与权限检查、F-24 查询执行与真实返回、F-25 查询记录保存、**F-26 失败重试与受限返回**。
> 边界：F-24 **只返回不落 `EXT-01`**（信封显式标 `persisted=false`、`persist_by="F-25"`），落痕由 F-25 承担；
> F-26 的一次「执行」＝**带重试的完整一次执行，落一行 `EXT-01`**，逐次尝试的证据面留在信封 `attempts[]`；
> **完整任务调度与 Queues 重投递归 M1 F-06（阶段3）**，本模块只按共用状态机口径写任务态。
> 零写边界（可静态扫描证明）：`mcp-client.js` 是**传输层**——零 SQL、零库写，HTTP 唯一方法为 POST（无 PUT/PATCH/DELETE 通道）；
> `task-state.js` 是**任务态写入面**——改行语句只落在 `task` 且必带主键条件，`index.js` 因而不含改行 / 删行类 SQL（`test-f23.mjs` 断言逐字未动）。

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `index.js` | F-23 本体：CFG-02 工具注册（登记/查询）、CFG-03 授权登记、**调用前权限判定**（判定链互斥、受限必带原因）；**F-24 编排层**：`describeTools` + `executeQuery`（先判权限→允许才发请求→映射为 EXT-01 口径信封 + 四要素）；**F-25 落痕层**：`saveQueryRecord` / `recordQuery` / `getQueryRecord` / `listQueryRecords` / `readbackQuery`；**F-26 重试与编排**：`getRunPolicy` / `retryLimitOf` / `executeQueryWithRetry` / `handleQueryFailure` / `runQueryWithRecovery` | ✅ F-23 / F-24 / F-25 / **F-26** 已建 2026-09-19 |
| `mcp-client.js` | **F-24 传输层（DS-06 自建 MCP 客户端）**：五项协议面（工具描述格式 / 调用回传 / 超时 / 错误码映射 / 权限拒绝形态）+ 条件序列化 + 限制萃取 + 实体级隔离。**零 SQL、零写** | ✅ F-24 已建 2026-09-19 |
| `task-state.js` | **F-26 任务态写入面**：`PD-01 task` 任务态跃迁（含「停止状态不自动重启」「已完成不改写」守卫）与 `done_part` 只追加；`PD-03 task_block` 受阻留痕（`dict:BLOCK_REASON` 值域校验）与回查；`dictCodes` 通用字典取值。**单独成文件的理由与 `mcp-client.js` 同：让写入面可静态验证** | ✅ F-26 已建 2026-09-19 |
| `text-limit.js` | **TS-16 应用层截断**（tech-stack §8 已决 2026-09-21）：`truncateForStorage` 纯函数——超单列上限（1,000,000 字节）在**写入面落库前**截断（UTF-8 字节计量、字符边界回退）＋文末 `[TRUNCATED <列名>]` 留痕标注；未超限原样返回同一引用。被 `index.js`（EXT-01 落痕）与 `../shared-context/index.js`（EXT-02 落库）import；**分析面仍拿全量原文**，不改变「真实返回原样透传」红线 | ✅ 已建 2026-09-21（`test-ts16.mjs` 16 断言全绿） |
| `test-f23.mjs` | F-23 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子） | ✅ 已建（38 断言全绿） |
| `test-f24.mjs` | F-24 用例执行器（注入式 transport + `prototype/mock/scenarios.js` 真实夹具，零外部调用） | ✅ 已建（**74 断言全绿**） |
| `test-f25.mjs` | F-25 用例执行器（真实 DDL + 种子；断言落痕完整性、失败也留痕、回查、留痕不变量、零写） | ✅ 已建（**53 断言全绿**） |
| `test-f26.mjs` | F-26 用例执行器（真实 DDL + 种子；断言重试是代码逻辑、上限口径、成功不算失败、用尽→受阻、再犯→停止、停止不自动重启、受限不重试、写入面静态验证、失败不否定结论） | ✅ 已建（**100 断言全绿**） |
| `test-ts16.mjs` | TS-16 截断用例执行器（① 纯函数边界：字节计量 / 字符边界 / 留痕标注 / 空值透传；② EXT-01 `saveQueryRecord` 端到端；③ EXT-02 `createEvidence` 端到端；未超限逐字节原样、超限截断＋标注） | ✅ 已建 2026-09-21（**16 断言全绿**，进 CI validate） |

## F-23 判定链（互斥，依次短路）

| 序 | 判定 | `reason_code` | 结果 |
| -- | ---- | ---- | ---- |
| 1 | 工具未登记 | `tool_not_found` | 受限 |
| 2 | 工具未启用 `is_enabled=0` | `tool_disabled` | 受限 |
| 3 | 来源未完成 MCP 化 `is_mcp_ready=0` | `source_not_mcp_ready` | 受限 |
| 4 | 来源未接入 `availability_status=unauthorized` | `source_unauthorized` | 受限 |
| 5 | 无有效授权记录（对象不匹配 / 不在有效期） | `no_permission` | 受限 |
| 6 | 授权记录 `allow_flag=0` | `restricted`（原样带 `restrict_reason`） | 受限 |
| 7 | 其余 | — | **允许** |

- **降级 ≠ 失败**：`availability_status=degraded` 不阻断，作为 `limits[]` 随结果返回（供 F-24 落四要素之「限制」），依据 `external-deps.md` §5（TOL-11 降级仍可查）。
- **批量判定**逐条独立：单条受限不影响其它条（实体级隔离，与 `TC-U-M5-001` 同模式，非整包失败）。
- 判定为**纯读**，不写 `EXT-01`——留痕归 F-25。

## F-24 真实查询返回（DS-06 自建 MCP 客户端）

### 编排顺序（`executeQuery`，`index.js`）

```
checkToolPermission（F-23） ──受限──▶ 直接返回受限信封（transport_called=false，**不发起外部调用**）
        │允许
        ▼
 transport / createHttpTransport（mcp-client.js，POST + AbortController 超时）
        │
        ▼
 mapResponseToResult（错误码映射 → EXT-01 字段口径信封 + 四要素）
```

### 五项协议面（`tech-stack.md` §2.6，`mcp-client.js`）

| 面 | 实现 | 口径 |
| -- | ---- | ---- |
| 1 工具描述格式 | `describeTool` | `name/description/inputSchema` + `_meta.contract="demo"`——**结构为 demo**（T-01/T-02/TS-22 未关闭），显式标注不外推 |
| 2 调用与结果回传 | `createHttpTransport` | 请求体＝`tool_code` + `query_condition`（§6 统一约定）；非 2xx → `__transport_error` 由错误码面统一收口 |
| 3 超时 | `TransportTimeout` + `AbortController` | 默认 `30000ms`（§6.1 阈值）；超时是**可识别错误类型**，映射到「调用超时」而非结果 |
| 4 错误码映射 | `mapResponseToResult` | `ok`/`restricted`/`fail`/`running` → EXT-01 六字段；无法识别的状态一律 `fail` + 原因含「**不得用模型预期填充**」 |
| 5 权限拒绝形态 | 受限分支 | `restricted_flag=1`、`result_status=fail`、`returned_rows=0`、`data=null`，`fail_reason` 必填（schema 规定失败时 `result_summary` 为空，故原因一律进 `fail_reason`） |

### 九类行为 → EXT-01 字段映射（对照 `external-deps.md` §6.8）

| # | 行为 | `result_status` | `returned_rows` | `restricted_flag` | 关键字段 / 限制 |
| -- | ---- | ---- | ---- | ---- | ---- |
| 1 | 延迟 | `ok` | 透传 | 0 | `retry_count` 透传，**成功不算失败**；慢响应提示进 `limits[]` |
| 2 | 403 | `fail` | 0 | **1** | `fail_reason`=权限未开通；`result_summary`=null |
| 3 | 空结果 | `ok` | **0** | 0 | 记限制「空结果，**非失败**」，不得写成 `fail` |
| 4 | 多值字段 | `ok` | 透传 | 0 | 数组**保序**；限制标注须说明取值口径（排除 `rows/items` 等结果集，避免误报） |
| 5 | 不可算字段 | `ok` | 透传 | 0 | `null` 值与 `*_reason` 原样保留，标注「≠0 ≠失败」 |
| 6 | 中英枚举不一致 | `ok` | 透传 | 0 | 保留 `*_raw` 原始值，标注须落字典项 |
| 7 | 覆盖边界 | `ok` | 透传 | 0 | **时点写实际覆盖区间**（`coverage.actual`），不写请求区间；截断进 `limits[]` |
| 8 | 超时失败 | `fail` | 0 | 0 | `fail_reason` 含「超时」，`retry_count` 透传 |
| 9 | 执行中 | `running` | 0 | 0 | **非终态**，`fail_reason`=null，不判失败 |

### 实体级隔离（`TC-U-M5-001` 域内涵代）

平台无交易价格字段（BRD §5.2 收益测算 out of scope），故以域内不变量演示同一模式：**信息时点 ≤ 取数时刻**。
`splitEntities` 发现倒挂行 → **只隔离该行**（进 `isolated[]`），`result_status` 仍为 `ok`，`returned_rows` 只计有效行——**非整包失败**。

### 已通过用例（`test-f24.mjs`，74 断言）

`TC-U-M5-001`（实体级隔离）、`TC-C-M5-001`（九类行为 → EXT-01 六字段映射，含 `dict:QUERY_STATUS` 值域校验）、
`TC-I-M5-001`（权限分支互斥 + 不允许不发起外部调用）、`TC-I-M5-002`（`data` 与 `result_summary` **逐字节原样**，不用模型预期替代）、
`TC-I-M5-005`（传输层零 SQL；HTTP 唯一方法为 POST，无 PUT/PATCH/DELETE 通道）。

`TC-D-M5-001`（CFG-02 PK/UK/FK/NULL）、`TC-D-M5-002`（CFG-03 `tool_id` FK）、`TC-D-M5-003`（CFG-04 `goal_id` 可空 FK）、`TC-D-M5-004`（CFG-05 `rule_id` PK）、`TC-I-M5-001`（权限分支互斥 + 受限原因 + 有效期 + 降级别 + 批量隔离）、`TC-I-M5-005`（生产零写）。

## F-25 查询记录保存（`EXT-01 query_record` 落痕）

### 一句话口径

**每一次执行落一行**——成功 / 失败 / 受限 / 执行中**都落**；`recordQuery` = `executeQuery`（F-24）+ `saveQueryRecord`（F-25）。

```
recordQuery
   ├─ executeQuery（F-24：判权限 → 允许才发请求 → 映射信封）
   └─ saveQueryRecord（F-25：不变量校验 → 写入 EXT-01 → 回读）
```

### 落痕不变量（缺一项即拒落，`saveQueryRecord`）

| # | 不变量 | 理由（回指） |
| -- | ---- | ---- |
| 1 | `result_status` ∈ `dict:QUERY_STATUS` | 值域**不内联**，从 `dict_item` 读（schema §11 是真源） |
| 2 | `query_condition` 非空 | EXT-01 口径「须完整到可复现」——空条件落库等于不可回查 |
| 3 | `result_status='fail'` ⇒ `fail_reason` 非空 | `PRD-M5` §4 约束 3：**失败也留痕 ≠ 留了等于没留** |
| 4 | `returned_rows` 为 ≥0 整数或空 | schema EXT-01 值域 |
| 5 | `task_id` 必填 | 「每次查询须归属真实任务」（`TC-D-M5-005`） |
| 6 | `source_id` 必填（信封或调用方兜底） | 见 Q-11：两者都没有时抛 `PersistSkip`，**不冒充已留痕** |

`task_id` / `source_id` / `message_id` 的外键**一律交给库级拒绝**，不在应用层复制口径（实测坏 FK → 409）。

### 回查（`TC-I-M5-003`「记录可回查」）

| 入口 | 用途 |
| ---- | ---- |
| `getQueryRecord(db, query_id)` | 单条 |
| `listQueryRecords(db, { task_id, source_id, result_status, message_id })` | 组合筛选，排序稳定（`query_id` DESC） |
| `readbackQuery(db, query_id)` | 单条 + 派生四要素前三样（条件 / 来源 / 时点）；**显式返回 `limits_not_persisted: true`**（Q-10 方向②） |

### `query_id` 取号

`Q-` + 5 位数字（PK 形如 `Q-90217`）：取库内已用最大值 +1，**确定性可复现**，不撞号（种子 `Q-90242` → 下一条 `Q-90243`）。

### 已通过用例（`test-f25.mjs`，53 断言）

`TC-D-M5-005`（`task_id`/`source_id`/`message_id` 不存在 → FK 失败）、
`TC-I-M5-003`（每次执行落库：条件/来源/时点/结果齐全，**失败 / 受限 / 执行中 / 传输异常四类逐一验「失败也留痕」**，原样落 `result_summary`、失败时为空）、
`TC-I-M5-005`（生产零写：落痕只写本地 `EXT-01`，外部调用仍只有一次查询，配置表未被改动）。

另验：留痕不变量 6 条（失败无原因 / 空条件 / 值域外 / 行数为负 / 缺 `task_id` 一律拒落）、回查与四要素派生、`query_id` 递增不撞号。

## F-26 失败重试与受限返回

### 一句话口径

**重试是代码逻辑不是 AI 决策**（`BRD` F-26）——上限取 `CFG-04 run_policy.retry_limit`，封顶 **100**（`tech-stack` §4.2 Queues 最大重试）；
**受限返回不重试**（`external-deps` §6.2「受限返回，非失败」，重试不改变权限）；持续失败 → 暂停受影响研究并**保留已完成部分**；真卡死 → 保留状态停止且**不自动重启**。

```
runQueryWithRecovery（F-26 一步编排）
   ├─ assertTaskRunnable（前置守卫：已停止 / 已完成 → 直接拒，**零写入**）
   ├─ executeQueryWithRetry（F-24 + 重试：按 CFG-04 上限循环，受限不重试）
   ├─ saveQueryRecord（F-25：**一次执行落一行** EXT-01，行内 retry_count 记本层重试次数）
   └─ handleQueryFailure（仅失败 / 受限时）→ PD-03 受阻记录 + PD-01 任务态 + done_part 保留
```

### 重试判定（互斥，`executeQueryWithRetry`）

| 终局 `outcome` | 触发条件 | 是否重试 | 任务态 |
| ---- | ---- | ---- | ---- |
| `ok` | `result_status='ok'` | — | **不动**（**成功不算失败**，`§6.1`） |
| `running` | `result_status='running'` | 否（非终态） | **不动** |
| `restricted` | 事前判定受限（`decision=restricted`）或来源返回 403（`restricted_flag=1`） | **否**（重试不改变权限） | 受阻（矩阵第 3 行） |
| `exhausted` | `result_status='fail'` 且非受限，重试用尽 | 是（≤ 上限） | 受阻 / 停止（矩阵第 4 行） |

### `retry_count` 取值口径（显式标注，不隐式）

`EXT-01.retry_count` ＝「本次执行已重试次数」，有两个来源，**取谁写谁并标出来**：

| 情形 | 写入值 | `retry_count_source` |
| ---- | ---- | ---- |
| 本层**真的重试过**（`retried>0`） | 本层重试次数 | `platform`（这才是「重试是代码逻辑」的留痕） |
| 本层未重试、返回体自带值 | 沿用返回体透传值 | `upstream_passthrough`（`§6.1` 慢响应场景） |
| 两者皆无 | `0` | `none` |

### 上限口径（`getRunPolicy` / `retryLimitOf`）

- 取策略**先目标级、后平台级**（各取 `is_active=1` 的第一条，按 `policy_id` 稳定排序）；
- 都取不到 → `retry_limit=0` 且 `policy_source='none'` + 说明「**不假设默认重试次数**」；
- 库里值 **>100 时截断到 100** 并写 `clamped=true` + `note`（`tech-stack` §4.2 值域 ≤100），不静默放过、也不擅自改成别的数。

### 受阻矩阵映射（`BRD` F-06 六行取本模块用到的两行）

| 情形 | `block_reason_code` | `resume_condition` | 任务态 |
| ---- | ---- | ---- | ---- |
| 第 3 行 来源未接入或权限不足（**受限返回**） | `source_unavailable` | 接入或权限问题解决 | `blocked` |
| 第 4 行 查询或服务调用失败（**用尽仍失败**） | `call_failed` | 服务恢复且满足任务继续条件 | `blocked` |
| 「达到运行限制或人工取消」→ **停止状态不自动重启** | 同上（同类） | 持续失败后停止（保留已完成部分，不自动重启） | `stopped` |

### 卡死门槛（**schema §12 Q-12**，BRD 未给可判定边界）

> 该任务**已有未解除的同类受阻记录**（`PD-03` 里 `is_resolved=0` 且 `block_reason_code` 与本次相同）→ `stopped`；
> 否则 → `blocked`。同一门槛对失败与受限**同样适用**（两类的受阻原因不同码，互不干扰）。
> 这是本实现取的**确定性规则**，用于把「持续失败暂停受影响研究」与「实在卡死保留状态停止」分开；**BRD 原文未给边界**，故登记待裁决。

### 任务态守卫（`task-state.js`，来自 BRD F-06 状态流）

| 守卫 | 行为 | `reason_code` |
| ---- | ---- | ---- |
| **前置守卫**（`assertTaskRunnable`，执行前） | 已 `stopped` / `done` 的任务**根本不进入执行**——避免「先执行、后拒写」留下半截状态（一条无主 EXT-01 / 一条多余 PD-03） | `stopped_no_auto_restart` / `done_immutable` |
| **停止状态不自动重启** | 已是 `stopped` 的任务不接受任何状态变更（**后续是否继续须人工明确**） | `stopped_no_auto_restart` |
| 已完成任务不改写 | `done` 不允许被改回受阻（不改写已结束的任务态） | `done_immutable` |
| 按主键圈定写入面 | 改行语句一律带 `WHERE task_id = ?`（**禁全表更新**）；`is_auto_restart` 一律写 0 | — |
| `done_part` 只追加 | **绝不覆盖**已完成部分；空片段不写、重复片段不重复追加（幂等） | — |

### 写入面与静态验证（生产零写可被证明）

| 文件 | 写入面 | 由谁证明 |
| ---- | ---- | ---- |
| `mcp-client.js` | 零 SQL、零库写，HTTP 唯一方法 POST | `test-f24.mjs`（静态扫描） |
| `index.js` | 只新增行（`EXT-01` 等），**不含改行 / 删行类 SQL** | `test-f23.mjs`（断言**逐字未动**） |
| `task-state.js` | 改行**只落在 `task`** 且必带主键条件；无删行 / 改结构语句、无外部 HTTP | `test-f26.mjs`（去注释后静态扫描 + 运行期行数比对） |

`test-f26.mjs` 另在运行期断言：受阻流程**只改目标任务行**（其余 `task` 行逐字未变），且 `tool_registry` / `tool_permission` / `source_registry` / **`evidence`** / **`research`** 行数不变——**运行失败不作为否定研究结论的依据**（`BRD` §7 第 4 条）。

### 已通过用例（`test-f26.mjs`，100 断言）

`TC-I-M5-004`（重试是代码逻辑：代码决定调用次数、上限取 `CFG-04`、越界截断、成功不算失败、慢响应透传口径；
用尽 → `blocked` + `PD-03`(`call_failed`) + 保留 `done_part`；再犯 → `stopped` + `ended_at`；
**停止不自动重启**；种子 `T-1020`（已受阻且同类受阻未解除）再失败 → 直接 `stopped`）、
**受限返回不重试**（`§6.2`）且如实落 `source_unavailable` 受阻（矩阵第 3 行）、
`TC-I-M5-005`（写入面静态验证 + 运行期零写 + 失败不否定结论）。

## 已知口径 / 实测注意（本模块相关）

- **种子现状即「如实登记」**：12 个工具 `is_enabled` **全为 0**、24 条授权记录 `allow_flag` **全为 1**——对应 `external-deps.md` §5「⚠️ 未接入 / ⚠️ 降级 / ❌ 不存在」。故种子上**没有任何工具可被允许**，「允许」分支由用例内临时启用演示，不改种子。
- `tool_code` 在 `external-deps.md` §5 标 `*`＝**demo 占位**（T-01/T-02/T-05 未关）；**demo 值不进断言**，只断数量、归属与形如 `TOL-xx` 的编号形态。
- 判定链里「工具未启用」与「工具不存在」目前**共用 `tool_disabled`**——CFG-02 无「存在性」字段，已登记为 `schema.md` §12 **Q-09**（未决）。
- 本地适配层与真机差异：真机 D1 的 `run()` 遇约束冲突会抛；本地适配层返回 `success:false`。两条路径在 `registerTool` / `registerPermission` 里都当失败处理，绝不静默成功（实测 FK 坏 → 409）。
- 本机无 `wrangler`（2026-09-19 确认），端到端用「直接调 `worker.fetch` + node:sqlite 造 `env.DB`」验证；`wrangler d1 migrations apply` 未实跑。
- **F-24 端到端**另起本机 mock server（`:8788`）验证真实 HTTP 链路：允许 → 200 + `result_status=ok`；受限 → **403** 且 `transport_called=false`。
- **Q-10（未决）**：`EXT-01` 无承载「限制」的字段，F-24 的 `four_elements.limits[]` 目前只能随信封返回；转 `EXT-02 evidence` 时归入 `applicability_scope`。是否要在 EXT-01 增列尚未裁决（见 `schema.md` §12）。**F-25 已按方向②落地**：落痕不写限制，`readbackQuery` 回查时显式标 `limits_not_persisted`。
- **Q-11（未决，F-25 新登记）**：`EXT-01.source_id` 为 NOT NULL 外键，**装不下「工具/来源根本未登记」这类失败**（F-23 判定链在 `tool_not_found` 处短路，此时没有来源可写）。**当前按方向②**：判定链短路 = 没有发生执行，不落 `EXT-01`，改由 `persist_skip.reason_code` 显式标记「为何没留痕」（`POST /api/query-records` 回 202 而非 201），**绝不静默丢**。
- **落痕只写 EXT-01**：`recordQuery` 不改 `tool_registry` / `tool_permission` / `source_registry`（实测落痕前后三表行数不变），读写分离。
- **门禁（F-26 相关）**：`external-deps.md` §7 **T-06（黄金眼 / 商品中台 / 营销中台的失败语义）未关闭**——`test-M5.md` 的 `TC-I-M5-004` 本就以 stub/mock 打桩、**不设为发布门禁**；本实现对接的是 `§6` mock 契约（七类行为 + 超时失败 + 执行中），**demo 数值不进断言**。
- **新登记 Q-12（未决，F-26 实施发现）**：BRD 只写「持续失败暂停受影响研究」与「真卡死保留已完成部分停止」，**没给可判定边界**。当前按「**同类受阻未解除即视为卡死 → `stopped`**」实现（见上「卡死门槛」），**方向①（改用别的门槛，如连续 N 次或时间窗）待 PM / 我裁决**。
- **写面隔离（F-26 的架构选择）**：任务态处置（改 `PD-01` / 插 `PD-03`）**只在 `task-state.js`**；`index.js` 仍不含改行 / 删行类 SQL——`test-f23.mjs` 的生产零写断言**未改一字**（这是把写入面单独成文件的直接目的）。
- **端到端（路由级，F-26）**：`POST /api/query-recovery` 受理后按 `outcome` 分状态码——受限 → **403**（响应带 `note`，即 §6.2 同口径的受限措辞，供前端直接显示）、无处留痕 → **202 + `persist_skip`**、其余（含用尽仍失败）→ **201**（本次执行已如实留痕，任务受阻 / 停止的事实写在 `recovery` 里）；`GET /api/run-policy` / `GET /api/task-blocks` / `GET /api/tasks/{task_id}` 为只读回查面。
- **实测种子交互**：`T-1020` 种子即 `blocked` 且带**未解除**的 `BL-001`(`call_failed`)，故对其再失败会**直接判 `stopped`**——这不是特例分支，而是同一门槛的必然结果（`test-f26.mjs` ④ 已断言）。

## 反向清单

- `../api/index.js`（F-23 路由：`/api/tools`、`/api/tool-permissions`、`/api/tool-permission/check`、`/api/tool-permission/check-batch`；F-24 路由：`/api/tool-descriptions`、`/api/query`（受限 → 403）；F-25 路由：`POST /api/query-records`（执行+落痕，未留痕 → 202）、`GET /api/query-records`（组合筛选）、`GET /api/query-records/{query_id}`（回查+四要素）；**F-26 路由：`POST /api/query-recovery`（重试+落痕+任务态处置；受限 → 403、未留痕 → 202）、`GET /api/run-policy`（生效策略与重试上限）、`GET /api/task-blocks`（受阻记录回查）、`GET /api/tasks/{task_id}`（任务态回查）**）
- `../agent-orchestrator`（后续：M3/M4 调用工具前先查权限；发起真实查询并落痕；失败/受限后消费 `recovery` 的任务态处置结果）
- `../task-runner`（**消费方，只取只读面与常量**：`./executor.js` 取 `listQueryRecords` 回查 EXT-01（阶段4 M3 执行体的确定性重算来源，F-33/阶段4）；**`./tick-guard.js` 取 `DEFAULT_TIMEOUT_MS` 派生单步超时（F-34，2026-09-21）**——本模块仍**不向 task-runner 提供任何写面**，跨模块写面为零）
- `./mcp-client.js`（F-24 传输层，被 `./index.js` 引用）｜`./task-state.js`（**F-26 任务态写入面**，被 `./index.js` 引用并由 `./test-f26.mjs` 直接断言写入面）
- `../../docs/03-locks/schema.md` §12（Q-09、Q-10、Q-11、**Q-12** 登记处）｜`../../prototype/mock/scenarios.js`（夹具来源）
- `../README.md`（server 枝杈登记）｜`.github/workflows/ci.yml`（validate 步骤）｜`../../AGENTS.md`（`server/` 状态位）
