-- 出关运维待办（go-live §2）：启用 4 个计划工具 + ACT 恢复（幂等 UPDATE）。
--
-- 背景：0002_config.sql 每部署会 `DELETE + INSERT` 重置 `tool_registry` / `source_registry`
-- （is_enabled=0、ACT availability_status='degraded'——这是 mock 反例口径，被测试 oracle 钉死，
-- 不能改 0001/0002 种子）。故「出关启用」必须在 0002 之后独立执行，且每次部署都要跑。
--
-- 本文件只写配置行（tool_registry.is_enabled / source_registry.availability_status），
-- 不写任何研究/证据/机会结论行（生产零写红线）。UPDATE 幂等，重复执行安全。
--
-- ci.yml deploy 在「灌生产配置种子（0002）」之后、`部署 Worker` 之前执行本文件（d1 execute --file）。
-- 改用 --file 而非 --command：可在单事务内执行两条语句，避免 CI shell 引号/单条限制导致的静默失败。

-- ① ACT 来源恢复为可用（原 degraded / is_mcp_ready=0）
UPDATE source_registry
   SET availability_status = 'ok', is_mcp_ready = 1, updated_at = datetime('now')
 WHERE source_id = 'ACT';

-- ② 启用 4 个计划工具（discovery 五步真实查询依赖）
UPDATE tool_registry
   SET is_enabled = 1
 WHERE tool_code IN ('cdp.crowd.query', 'hje.traffic.entry', 'mkt.benefit.issue', 'act.activity.list');
