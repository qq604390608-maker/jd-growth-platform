'use strict';
// prototype/mock/index.js — 研发期 mock server（external-deps.md §6 需求契约）
//
// 独立 node 进程，零依赖。POST /query 按 tool_code / force_behavior 返回可控响应，
// 让 F-14/F-15/F-24/F-26 在真实接口未接入时也能真实测试失败路径（BRD 硬红线：
// 不能用模型预期的内容代替查询结果）。
//
// 生产接入真实契约（external-deps §7 T-01/T-02/T-05 关闭）后整体替换；
// 红线：data 内 demo 值不得进断言。
// 启动：node index.js （可选 MOCK_PORT 覆盖，默认 8788）

const http = require('http');
const { SCENARIOS, defaultOk } = require('./scenarios');

const PORT = process.env.MOCK_PORT ? Number(process.env.MOCK_PORT) : 8788;

function sourceOf(toolCode) {
  if (!toolCode) return 'CDP';
  const p = String(toolCode).split('.')[0].toUpperCase();
  return ['CDP', 'HJE', 'PIM', 'MKT', 'ACT'].includes(p) ? p : 'CDP';
}

function handleQuery(body) {
  const toolCode = body && body.tool_code ? body.tool_code : 'unknown.tool';
  const force = body && body.force_behavior;
  if (force && SCENARIOS[force]) {
    return SCENARIOS[force](toolCode);
  }
  return defaultOk(toolCode, sourceOf(toolCode));
}

const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/query') {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch (e) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid json' }));
        return;
      }
      const payload = handleQuery(body);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    });
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'mock-server' }));
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

if (require.main === module) {
  server.listen(PORT, () => {
    // eslint-disable-next-line no-console
    console.log(`mock-server listening on :${PORT} (POST /query, GET /health)`);
  });
}

module.exports = { server, handleQuery, sourceOf };
