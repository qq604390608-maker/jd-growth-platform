'use strict';
// prototype/mock/verify.js — mock server 自检（数值口径依契约基准 v1 · ADR-004）
//
// 启动 index.js，逐 9 类请求，断言「可映射 EXT-01 六字段 + 行为语义正确」。
// 只断言结构与行为语义，不断言任何 demo 数值（红线）。
// 运行：node verify.js

const { spawn } = require('child_process');
const path = require('path');
const { SCENARIOS } = require('./scenarios');

const PORT = 8799;
const BASE = `http://localhost:${PORT}`;

const EXT_FIELDS = ['result_status', 'result_summary', 'returned_rows', 'fail_reason', 'retry_count', 'restricted_flag'];

function assert(cond, msg) {
  if (!cond) throw new Error('ASSERT FAIL: ' + msg);
}

async function postQuery(behavior, toolCode) {
  const r = await fetch(BASE + '/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool_code: toolCode || 'cdp.behavior.agg', force_behavior: behavior }),
  });
  return r.json();
}

function checkExtMappable(p, label) {
  for (const f of EXT_FIELDS) {
    assert(f in p, `${label}: 缺 EXT-01 可映射字段 ${f}`);
  }
  assert(typeof p.result_status === 'string', `${label}: result_status 须为字符串`);
  assert(typeof p.result_summary === 'string', `${label}: result_summary 须为字符串`);
  assert(typeof p.returned_rows === 'number', `${label}: returned_rows 须为数字`);
  assert(p.fail_reason === null || typeof p.fail_reason === 'string', `${label}: fail_reason 须为 string|null`);
  assert(typeof p.retry_count === 'number', `${label}: retry_count 须为数字`);
  assert(p.restricted_flag === 0 || p.restricted_flag === 1, `${label}: restricted_flag 须为 0|1`);
}

async function main() {
  const behaviors = Object.keys(SCENARIOS);
  assert(behaviors.length === 9, `须为 9 类响应（7 行为 + 超时失败 + 执行中），实际 ${behaviors.length}`);

  for (const b of behaviors) {
    const p = await postQuery(b);
    checkExtMappable(p, b); // 每类都能映射到 EXT-01 六字段
  }

  // 特定行为语义（仅语义，不断言 demo 数值）
  const restricted = await postQuery('restricted');
  assert(restricted.restricted_flag === 1 && restricted.result_status === 'fail',
    'restricted 须 restricted_flag=1 且 result_status=fail（不静默为空）');

  const empty = await postQuery('empty');
  assert(empty.status === 'ok' && empty.returned_rows === 0,
    'empty 须 status=ok 且 returned_rows=0（成功但无数据，非 fail）');

  const timeout = await postQuery('timeout_fail');
  assert(timeout.status === 'fail' && timeout.retry_count >= 3 && !!timeout.fail_reason,
    'timeout_fail 须 status=fail 且 retry_count>=3 且 fail_reason 非空（call_failed 语义）');

  const running = await postQuery('running');
  assert(running.status === 'running' && running.result_status === 'running',
    'running 须未终态（轮询语义）');

  const slow = await postQuery('slow');
  assert(slow.retry_count >= 1 && slow.result_status === 'ok',
    'slow 须记录重试且成功不算失败');

  // 默认 ok（不带 force_behavior）
  const def = await (await fetch(BASE + '/query', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ tool_code: 'hje.traffic.entry' }),
  })).json();
  assert(def.status === 'ok' && def.result_status === 'ok', '默认须返回 ok 响应');

  // eslint-disable-next-line no-console
  console.log(`VERIFY PASS: ${behaviors.length} 类响应均可映射 EXT-01 六字段 + 行为语义正确（数值口径依契约基准 v1）`);
}

const child = spawn(process.execPath, [path.join(__dirname, 'index.js')], {
  env: { ...process.env, MOCK_PORT: String(PORT) },
  stdio: 'ignore',
});
child.on('error', (e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});

// 等 server listening 后再跑断言
setTimeout(() => {
  main()
    .then(() => {
      child.kill();
      process.exit(0);
    })
    .catch((e) => {
      // eslint-disable-next-line no-console
      console.error(e.message);
      child.kill();
      process.exit(1);
    });
}, 900);
