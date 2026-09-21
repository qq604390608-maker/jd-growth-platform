-- 一次性运维 SQL（**不是种子**，不被 ci.yml 的 deploy 重放）：线上既有库补建 CFG-09 `id_sequence`
--
-- 上游：`docs/03-locks/schema.md` **v1.9**（CFG-09 `id_sequence` 的字段级唯一转换口径；
--       表数 36→37、Q-18 记录归属与范围裁决）｜ `db/migrations/0001_init.sql`（同一张表的 DDL 真源）｜
--       `server/shared-context/id-sequence.js`（该表**唯一写入面**）｜
--       `.github/workflows/ops-id-sequence.yml`（唯一执行入口，按本文件路径精确触发）。
-- 职责：**只做一件事**——在线上既有库里把 `id_sequence` 建出来。
-- 为什么不能用 `d1 migrations apply` 补：`0001_init.sql` 是**单一 DDL 文件**、且**已被线上 `d1_migrations` 记为已应用**，
--   D1 不会重放它；而全仓 30+ 套用例都按**硬编码路径** `db/migrations/0001_init.sql` 载入真实 DDL，
--   故不能把本表拆到第二个迁移文件（会与用例的加载面脱节）。因此线上补建走本一次性入口。
-- 幂等：`CREATE TABLE IF NOT EXISTS`；重复执行为空操作，结果一致。
-- 无破坏性：本文件**不含任何** DELETE / UPDATE / 业务数据写入，只建一张空表。
-- 不补种（刻意）：计数器**空表即合法初值**——写入面 `id-sequence.js` 在首次取号时用
--   `ON CONFLICT(namespace) DO UPDATE SET next_val = max(next_val, excluded.next_val)` 的自愈种子
--   把计数器抬到「库内实际最大」，故线上既有数据（`T-00xx` / `R-xxx` / `OPP-0xx`）不会被重新编号、
--   也**不需要**在本文件里复制一遍「前缀 + 取数字段」的解析口径（那会变成第二个口径）。
-- 硬红线落实：本文件不含任何外部系统调用、不含凭证；`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`
--   仅经 GitHub Secrets 注入，由 Cloudflare 平台侧凭据完成写动作（BRD §5.3）。
-- 反向清单：被 `.github/workflows/ops-id-sequence.yml` 引用；被 `db/README.md` 与
--   `docs/03-locks/schema.md` §「v1.9 说明」登记。

PRAGMA foreign_keys = ON;

-- CFG-09 取号序列（与 `db/migrations/0001_init.sql` 内的 DDL 逐字一致；此处用 IF NOT EXISTS 以保幂等）
CREATE TABLE IF NOT EXISTS id_sequence (
    namespace TEXT    NOT NULL PRIMARY KEY,
    next_val  INTEGER NOT NULL
);
