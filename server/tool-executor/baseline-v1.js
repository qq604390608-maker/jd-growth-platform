/**
 * 文档卡（阶段4 接线 · M5 工具执行程序 · baseline-v1 生产兜底 · 2026-09-21）
 * 上游：`../../docs/03-locks/external-deps.md`（§7 T-01~T-10 + T-22 **已随 ADR-004 全部冻结为契约基准 v1**——
 *        无真实对接方，11 条契约由我方自拟冻结；真对接方出现时走 ADR 修订替换，bump 基准 v2）｜
 *        `../../docs/03-locks/schema.md` EXT-01（返回体须能映射到 `result_status` / `result_summary` /
 *        `returned_rows` / `fail_reason` / `retry_count` / `restricted_flag`）｜
 *        `prototype/mock/scenarios.js`（基准 v1 的可运行实现——本文件是它的**进程内等价副本**，避免生产态反向依赖 `prototype/` 研发设施）｜
 *        `./mcp-client.js`（传输层：`createHttpTransport` 默认打 `http://127.0.0.1:8788/query`，那是**本地 dev** mock，
 *        在 Cloudflare 边缘不可达——本文件即「无真实端点时」的生产默认，替代那个不可达默认）
 * 职责：**生产态内置 baseline-v1 响应器**。当 `executeQuery` 未注入 transport 且未配置 `MOCK_ENDPOINT`
 *        （即不是本地 dev 跑 mock server）时，返回 external-deps 冻结的契约基准 v1 的「正常」响应，
 *        让 discovery 业务闭环在「无真实外部系统」前提下仍能跑通（步③查询→EXT-01 ok 落痕→步④⑤形成机会）。
 * 红线落实：
 *   - **零网络**：进程内直接返回，不 `fetch` 任何外部地址（替代 `createHttpTransport` 的本地默认，后者在边缘不可达）。
 *   - **数值冻结**：`data` 内数值一律为契约基准 v1 的自拟值（来源 `external-deps.md` §7 + `prototype/mock/scenarios.js`），
 *     不由本层生成；真对接方出现时整体替换（bump 基准 v2），不直接改值。
 *   - **不冒充真实返回**：调用方（`executeQuery` → `mapResponseToResult`）仍按 EXT-01 信封口径映射，
 *     本文件只提供「来源可回查、条件/时点/适用范围可溯」的契约数据，绝不编造业务结论。
 *   - **与 dev mock 同源**：`SOURCE_DEFAULT_OK` 与 `sourceOf` 与 `prototype/mock/scenarios.js` **逐字段对齐**，
 *     改一处须同步另一处（登记见本文件反向清单）。
 * 反向清单：被 `./index.js`（`executeQuery` 默认 transport 分支）引用；登记 `./README.md`；
 *   测试 `./test-f24.mjs`（断言默认 transport 在无 `MOCK_ENDPOINT` 时回退到本响应器并产出 ok 信封）。
 */

/**
 * 来源识别：tool_code 首段大写（CDP/HJE/PIM/MKT/ACT），未知回落 CDP。
 * 与 `prototype/mock/index.js` 的 `sourceOf` 逐字段对齐。
 * @param {string} toolCode
 * @returns {'CDP'|'HJE'|'PIM'|'MKT'|'ACT'}
 */
export function sourceOf(toolCode) {
  if (!toolCode) return "CDP";
  const p = String(toolCode).split(".")[0].toUpperCase();
  return ["CDP", "HJE", "PIM", "MKT", "ACT"].includes(p) ? p : "CDP";
}

/**
 * 契约基准 v1 的「正常」响应（按 source_id 给一个 ok 聚合，不带 force_behavior 时）。
 * 数值全部来自 `external-deps.md` §7 自拟冻结值 + `prototype/mock/scenarios.js` 的 `SOURCE_DEFAULT_OK`，
 * **可进断言**（断言文案标注基准版本）；真对接方出现时经 ADR 修订（bump 基准 v2）整体替换，不直接改值。
 */
const SOURCE_DEFAULT_OK = {
  CDP: { result_summary: "人群聚合（契约基准 v1）", returned_rows: 1, data: { crowd_size: 12345 } },
  HJE: { result_summary: "入口流量聚合（契约基准 v1）", returned_rows: 1, data: { entry: "搜索结果页", pv: 999 } },
  PIM: { result_summary: "品类商品主数据（契约基准 v1）", returned_rows: 1, data: { sku_id: "SKU-0001" } },
  MKT: { result_summary: "权益发放聚合（契约基准 v1）", returned_rows: 1, data: { issue_count: 500 } },
  ACT: { result_summary: "已报名活动清单（契约基准 v1）", returned_rows: 1, data: { activity_count: 1 } },
};

/**
 * 返回 frozen baseline-v1 的 ok 信封（未带 force_behavior 的默认路径）。
 * 形态与 `mapResponseToResult` 期望一致：`status/result_status='ok'` + `data`。
 * @param {string} toolCode
 * @param {string} [query_condition] 仅原样回显（契约入参，查询条件由调用方注入，本层不生成）
 * @returns {object} baseline-v1 ok 响应体
 */
export function baselineV1Respond(toolCode, query_condition = null) {
  const source = sourceOf(toolCode);
  const base = SOURCE_DEFAULT_OK[source] || SOURCE_DEFAULT_OK.CDP;
  return {
    tool_code: toolCode,
    status: "ok",
    elapsed_ms: 800,
    retry_count: 0,
    restricted_flag: 0,
    result_status: "ok",
    result_summary: base.result_summary,
    returned_rows: base.returned_rows,
    fail_reason: null,
    data: base.data,
    ...(query_condition != null ? { query_condition } : {}),
  };
}

/**
 * 生产态默认 transport（替代 `createHttpTransport` 在边缘不可达的本地默认）。
 * 签名与 `createHttpTransport` 返回的函数一致：`async ({ tool_code, query_condition, force_behavior }) => payload`。
 * 注意：baseline-v1 是「无真实端点时的契约占位」，**忽略** `force_behavior`（强制异常行为是 dev mock 的测试钩子，
 * 生产/CI 不应使用）；需要异常路径请用注入 transport。
 * @returns {Promise<object>}
 */
export function baselineV1Transport({ tool_code, query_condition } = {}) {
  return Promise.resolve(baselineV1Respond(tool_code, query_condition));
}
