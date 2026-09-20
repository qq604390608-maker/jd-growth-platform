# prototype/mock/ · 研发期 mock server

> 本目录是 `external-deps.md` §6 的需求契约实现（D-6：真实接口未接入时提供五系统可控响应）。
> 让 F-14 / F-15 / F-24 / F-26 能被真实地测试——**特别是失败路径**（BRD 硬红线：
> 不能用模型预期的内容代替查询结果）。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 目录编号 | PROTO-MOCK-001 |
| 状态 | ✅ 已建（2026-09-19，阶段 0） |
| 上游约束 | `../../AGENTS.md`（宪法：硬红线｜双向引用）｜`../../docs/03-locks/external-deps.md` §6（需求契约）、§7（待确认）｜`../../docs/04-plan/dev-plan.md`（阶段 0 关键交付物、验收要点）｜`../../docs/05-test-cases/test-M5.md`（F-23~F-26 oracle）｜`../../docs/03-locks/schema.md` EXT-01（落库字段） |
| 技术形态 | 独立 node 进程（零依赖，内置 `http`），不依赖 Worker；后续 M5 工具执行程序通过 HTTP 调用 |
| 红线 | **所有 `data` 内数值均为 demo 占位（external-deps §7 T-01/T-02/T-05 未关闭），不得进断言** |
| 待替换条件 | 真实 MCP 工具契约（T-01/T-02/T-05 关闭）到位后整体替换本目录 |

## 1. 文件清单

| 文件 | 职责 |
| ---- | ---- |
| `scenarios.js` | 9 类响应体定义（7 类行为 + 超时失败 + 执行中），纯数据 |
| `index.js` | HTTP 服务：`POST /query` 按 `tool_code` + `force_behavior` 返回可控响应；`GET /health` 探活 |
| `verify.js` | 自检：启动服务、逐类断言「可映射 EXT-01 六字段 + 行为语义正确」，demo 值不进断言 |

## 2. 启动与验证

```bash
# 启动（默认端口 8788，可用 MOCK_PORT 覆盖）
node prototype/mock/index.js

# 自检（启动临时实例 + 逐类断言，全绿即验收通过）
node prototype/mock/verify.js
```

## 3. 接口契约

请求：`POST /query`，body `{"tool_code": "cdp.behavior.agg", "force_behavior": "restricted"}`
- `tool_code`：工具编码（决定默认响应来源）
- `force_behavior`（可选）：`slow` / `restricted` / `empty` / `multi_value` / `not_computable` / `enum_mismatch` / `coverage_boundary` / `timeout_fail` / `running`，用于测试失败路径

响应：每个响应体均含 EXT-01 可映射字段
`result_status` / `result_summary` / `returned_rows` / `fail_reason` / `retry_count` / `restricted_flag`
（外加 `status` 原始行为码、`elapsed_ms`、`data` demo 块）。

## 4. 9 类行为 ↔ EXT-01 映射（见 external-deps §6.8）

| # | 行为 | 映射字段 | 语义要点 |
| ---- | ---- | ---- | ---- |
| 1 | 延迟 | `retry_count` | 成功不算失败，记录重试次数 |
| 2 | 403 | `restricted_flag` `fail_reason` | 受限返回，不静默为空 |
| 3 | 空结果 | `returned_rows=0` | 成功但无数据，非 fail |
| 4 | 多值字段 | `query_condition` `applicability_scope` | 多值保序与去重口径 |
| 5 | 不可算字段 | `result_summary` | 不可算 ≠ 0 ≠ 失败 |
| 6 | 中英枚举不一致 | `dict_item` | 外部枚举须归一化后落字典 |
| 7 | 覆盖边界 | `info_time_point` | 写实际覆盖区间，非请求区间 |
| 8 | 超时失败 | `status=fail` `retry_count` | 重试 3/3 仍失败 → call_failed |
| 9 | 执行中 | `status=running` | 未终态，须轮询 |

## 反向清单

**上游（我来自哪）**

| 上游 | 约束力 |
| ---- | ---- |
| `../../AGENTS.md` | 硬红线（生产零写、真实返回）、双向引用、索引三层 |
| `../../docs/03-locks/external-deps.md` §6 / §7 | 需求契约真源（mock 响应形状）；待确认项约束 demo 值不进断言 |
| `../../docs/04-plan/dev-plan.md` 阶段 0 | 关键交付物与验收要点（七类行为可返回并映射到 EXT-01） |
| `../../docs/03-locks/schema.md` EXT-01 | 落库字段口径（响应须可映射） |
| `../../docs/05-test-cases/test-M5.md` | F-23~F-26 验收 oracle（mock 须支撑失败路径测试） |

**反向（我被谁引用）**

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `../../docs/03-locks/external-deps.md` §6 反向清单 | 需求契约落地 | ✅ 已建（2026-09-19，本目录） |
| `prototype/README.md` | 最近一层目录枝杈登记 | ✅ 已登记 |
| `../../docs/04-plan/dev-plan.md` 阶段 0 | 验收要点「mock server 七类跑通」 | ✅ 已建 |
| `server/tool-executor`（M5，阶段 2） | 通过 HTTP 调用本服务做真实查询 | ⏳ 待建（阶段 2） |
| `agent-runtime/`（M3/M4，阶段 4） | 查找证环节调用本服务 | ⏳ 待建（阶段 4） |
