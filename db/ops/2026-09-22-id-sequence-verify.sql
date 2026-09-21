-- 文档卡（一次性运维 · 回读校验 · 2026-09-22）
-- 上游：`../migrations/0001_init.sql`（CFG-09 `id_sequence` 的列定义）｜ `../../docs/03-locks/schema.md` v1.9
-- 职责：**只做回读**（零写）——确认 CFG-09 `id_sequence` 已补建，并回读三条命名空间的「库内实际最大序号」，
--   供人工核对冷路径自愈种子的落点（`server/shared-context/id-sequence.js` 的 `issueId` 冷启动会抬到这个值）。
-- 执行入口：`.github/workflows/ops-id-sequence.yml`（与建表 SQL 同一支工作流，**用 `--file` 而非 `--command`**——
--   该形态与 `ci.yml` deploy 步灌配置种子的写法一致，已实证可用）。
-- 硬红线：本文件**只有 SELECT**，无 INSERT / UPDATE / DELETE / DDL。
-- 反向清单：被 `ops-id-sequence.yml` 引用；登记 `../README.md`（一次性运维入口清单）。

SELECT
  (SELECT COUNT(*) FROM id_sequence)                                        AS counter_rows,
  (SELECT COUNT(*) FROM task)                                               AS tasks,
  (SELECT COUNT(*) FROM research)                                           AS researches,
  (SELECT COUNT(*) FROM opportunity)                                        AS opportunities;

-- 库内实际最大序号（冷路径自愈种子的落点；`substr` 去前缀后取整数最大值）
SELECT
  (SELECT MAX(CAST(substr(task_id, 3) AS INTEGER))        FROM task WHERE task_id LIKE 'T-%')       AS task_max,
  (SELECT MAX(CAST(substr(research_no, 3) AS INTEGER))    FROM research WHERE research_no LIKE 'R-%') AS research_max,
  (SELECT MAX(CAST(substr(opportunity_id, 5) AS INTEGER)) FROM opportunity WHERE opportunity_id LIKE 'OPP-%') AS opportunity_max;
