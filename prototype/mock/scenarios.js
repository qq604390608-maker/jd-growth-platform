'use strict';
// prototype/mock/scenarios.js
// 9 类 mock 响应（external-deps.md §6：7 类行为 + 超时失败 + 执行中）
//
// 📌 口径（ADR-004，2026-09-21）：所有 data 内数值均为**契约基准 v1 自拟值**（`external-deps.md`
//    v1.3 §7 自答回填冻结），**可进断言**（断言文案标注基准版本）；真对接方出现时经 ADR 修订
//    （bump 基准 v2）整体替换，不直接改值。
// 每个响应体均含 EXT-01 可映射字段：result_status / result_summary / returned_rows /
// fail_reason / retry_count / restricted_flag（见 §6 统一约定）。

const SCENARIOS = {
  // 1. 延迟（§6.1）：慢响应，重试 2 次后返回 → 成功不算失败
  slow: (toolCode) => ({
    tool_code: toolCode,
    status: 'ok',
    elapsed_ms: 42000, // demo：> 30s 阈值
    retry_count: 2,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: '已报名活动清单（demo 聚合）',
    returned_rows: 37, // demo：仅类型断言
    fail_reason: null,
    data: { activity_count: 37, by_type: { 满减: 21, 秒杀: 16 }, covered_sku: 12000 },
    warnings: ['响应耗时超过阈值 30s，已重试 2 次后返回'],
  }),

  // 2. 403（§6.2）：权限不足 → 受限返回（restricted 映射为 result_status=fail + restricted_flag=1）
  restricted: (toolCode) => ({
    tool_code: toolCode,
    status: 'restricted',
    http_hint: 403,
    reason_code: 'NO_PERMISSION',
    retry_count: 0,
    restricted_flag: 1,
    result_status: 'fail',
    result_summary: '权限未开通：当前任务未被授权查询该人群范围',
    returned_rows: 0,
    fail_reason: '权限未开通',
    data: null,
  }),

  // 3. 空结果（§6.3）：查到但 0 行（成功但无数据，不得写成 fail）
  empty: (toolCode) => ({
    tool_code: toolCode,
    status: 'ok',
    elapsed_ms: 1800,
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: '条件命中 0 条记录',
    returned_rows: 0,
    fail_reason: null,
    data: { sample_size: 0, items: [] },
    notice: '条件命中 0 条记录',
  }),

  // 4. 多值字段（§6.4）：一个字段返回多个值，需保序与去重口径
  multi_value: (toolCode) => ({
    tool_code: toolCode,
    status: 'ok',
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: '品类商品主数据（含多值规格标签）',
    returned_rows: 1,
    fail_reason: null,
    data: {
      sku_id: 'SKU-88001',
      category_path: ['京东超市', '食品饮料', '乳品烘焙', '常温奶'],
      spec_tags: ['家庭装', '多件装', '促销装'],
    },
    notice: 'category_path 为层级路径，spec_tags 可能多标签并存',
  }),

  // 5. 不可算字段（§6.5）：字段存在但值不可计算（≠ 0 ≠ 失败）
  not_computable: (toolCode) => ({
    tool_code: toolCode,
    status: 'ok',
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: '部分指标未计算（样本量不足，不可算）',
    returned_rows: 1,
    fail_reason: null,
    data: {
      repurchase_rate_30d: null,
      repurchase_rate_30d_reason: '样本量不足（n=37），不满足最小样本阈值',
      sample_size: 37,
    },
    notice: '部分指标未计算',
  }),

  // 6. 中英枚举不一致（§6.6）：外部枚举与本地字典不对齐，须归一化
  enum_mismatch: (toolCode) => ({
    tool_code: toolCode,
    status: 'ok',
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: '入口维度流量（枚举需归一化）',
    returned_rows: 1,
    fail_reason: null,
    data: { entry_type: 'SEARCH_RESULT_PAGE', entry_type_raw: '搜索结果页', conversion_status: 'SUCCESS' },
    notice: '本系统枚举为英文，原始值为中文，需归一化',
  }),

  // 7. 覆盖边界（§6.7）：查询区间跨数据边界，实际覆盖不完整
  coverage_boundary: (toolCode) => ({
    tool_code: toolCode,
    status: 'ok',
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: '实际数据尾部缺失（覆盖边界不完整）',
    returned_rows: 1,
    fail_reason: null,
    data: {
      rows: [{ period: '2026-07-01 ~ 2026-09-15', value: 18.4 }],
      coverage: {
        requested: '2026-07-01 ~ 2026-09-15',
        actual: '2026-07-01 ~ 2026-09-10',
        truncated_days: 5,
      },
    },
    notice: '实际数据仅覆盖至 2026-09-10，尾部 5 天缺失',
  }),

  // 8. 超时失败（§6 末段）：重试 3/3 仍失败 → fail + call_failed
  timeout_fail: (toolCode) => ({
    tool_code: toolCode,
    status: 'fail',
    retry_count: 3,
    restricted_flag: 0,
    result_status: 'fail',
    result_summary: '调用超时，重试 3/3 仍失败',
    returned_rows: 0,
    fail_reason: '调用超时：重试 3 次后仍无响应',
    call_failed: true,
    data: null,
  }),

  // 9. 执行中（§6 末段）：进度态，未终态，须轮询
  running: (toolCode) => ({
    tool_code: toolCode,
    status: 'running',
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'running',
    result_summary: '查询执行中（轮询获取终态）',
    returned_rows: 0,
    fail_reason: null,
    data: null,
  }),
};

// 默认「正常」响应：按 source_id 给一个 ok 聚合 demo（不带 force_behavior 时）
const SOURCE_DEFAULT_OK = {
  CDP: { result_summary: '人群聚合（demo）', returned_rows: 1, data: { crowd_size: 12345 } },
  HJE: { result_summary: '入口流量聚合（demo）', returned_rows: 1, data: { entry: '搜索结果页', pv: 999 } },
  PIM: { result_summary: '品类商品主数据（demo）', returned_rows: 1, data: { sku_id: 'SKU-0001' } },
  MKT: { result_summary: '权益发放聚合（demo）', returned_rows: 1, data: { issue_count: 500 } },
  ACT: { result_summary: '已报名活动清单（demo）', returned_rows: 1, data: { activity_count: 1 } },
};

function defaultOk(toolCode, sourceId) {
  const base = SOURCE_DEFAULT_OK[sourceId] || SOURCE_DEFAULT_OK.CDP;
  return {
    tool_code: toolCode,
    status: 'ok',
    elapsed_ms: 800,
    retry_count: 0,
    restricted_flag: 0,
    result_status: 'ok',
    result_summary: base.result_summary,
    returned_rows: base.returned_rows,
    fail_reason: null,
    data: base.data,
  };
}

module.exports = { SCENARIOS, defaultOk, SOURCE_DEFAULT_OK };
