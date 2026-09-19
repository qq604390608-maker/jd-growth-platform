# tool-executor · M5 工具执行程序（server/tool-executor）

> 文档卡（阶段2 · M5 · 2026-09-19）
> 上游：`../../AGENTS.md`（宪法：一条硬红线｜编号体系｜双向引用｜术语口径「查询证据必须带来源/条件/时点/适用范围」）
> ｜ `../../docs/02-prd/PRD-M5-工具执行程序.md`（F-23~F-26 验收要点；F-23＝权限分支互斥，不允许时保存原因并返回受限原因）
> ｜ `../../docs/03-locks/schema.md`（CFG-02 `tool_registry` L533-545｜CFG-03 `tool_permission` L547-561｜CFG-01 `source_registry` L516-531｜CFG-04/05｜§11 字典枚举）
> ｜ `../../docs/03-locks/external-deps.md` §5（12 工具 TOL-01~12 文档视图，与 CFG-02 同源；**TOL-12 是「不存在」**；TOL-03/TOL-10 能力不足；TOL-11 降级）｜§6（mock 契约，七类行为）
> ｜ `../../docs/03-locks/tech-stack.md`（DS-06 自建 MCP 客户端；协议面归 F-24）
> ｜ `../../docs/04-plan/dev-plan.md`（阶段 2 · M5：关键交付物 / 验收要点 / 依赖前序 / 风险与待确认）
> ｜ `../../db/migrations/0001_init.sql` L49-92
>
> 职责：M5 的查询执行与留痕层。**当前已建 F-23**（工具注册与权限检查）。
> 边界：F-24 真实查询 / F-25 落痕 / F-26 重试与暂停 **均未开工**；本模块至今**不发起任何外部调用**。

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `index.js` | F-23 本体：CFG-02 工具注册（登记/查询）、CFG-03 授权登记、**调用前权限判定**（判定链互斥、受限必带原因） | ✅ F-23 已建 2026-09-19 |
| `test-f23.mjs` | F-23 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子） | ✅ 已建（38 断言全绿） |

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

## 已通过用例（`test-f23.mjs`，38 断言）

`TC-D-M5-001`（CFG-02 PK/UK/FK/NULL）、`TC-D-M5-002`（CFG-03 `tool_id` FK）、`TC-D-M5-003`（CFG-04 `goal_id` 可空 FK）、`TC-D-M5-004`（CFG-05 `rule_id` PK）、`TC-I-M5-001`（权限分支互斥 + 受限原因 + 有效期 + 降级别 + 批量隔离）、`TC-I-M5-005`（生产零写）。

## 已知口径 / 实测注意（本模块相关）

- **种子现状即「如实登记」**：12 个工具 `is_enabled` **全为 0**、24 条授权记录 `allow_flag` **全为 1**——对应 `external-deps.md` §5「⚠️ 未接入 / ⚠️ 降级 / ❌ 不存在」。故种子上**没有任何工具可被允许**，「允许」分支由用例内临时启用演示，不改种子。
- `tool_code` 在 `external-deps.md` §5 标 `*`＝**demo 占位**（T-01/T-02/T-05 未关）；**demo 值不进断言**，只断数量、归属与形如 `TOL-xx` 的编号形态。
- 判定链里「工具未启用」与「工具不存在」目前**共用 `tool_disabled`**——CFG-02 无「存在性」字段，已登记为 `schema.md` §12 **Q-09**（未决）。
- 本地适配层与真机差异：真机 D1 的 `run()` 遇约束冲突会抛；本地适配层返回 `success:false`。两条路径在 `registerTool` / `registerPermission` 里都当失败处理，绝不静默成功（实测 FK 坏 → 409）。
- 本机无 `wrangler`（2026-09-19 确认），端到端用「直接调 `worker.fetch` + node:sqlite 造 `env.DB`」验证；`wrangler d1 migrations apply` 未实跑。

## 反向清单

- `../api/index.js`（F-23 路由：`/api/tools`、`/api/tool-permissions`、`/api/tool-permission/check`、`/api/tool-permission/check-batch`）
- `../agent-orchestrator`（后续：M3/M4 调用工具前先查权限）
- `../README.md`（server 枝杈登记）｜`.github/workflows/ci.yml`（validate 步骤）｜`../../AGENTS.md`（`server/` 状态位）
