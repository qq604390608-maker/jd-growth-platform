#!/usr/bin/env node
// ============================================================
// deploy-seed-off.mjs · 生成 0002 的「FK-OFF 部署副本」
// ------------------------------------------------------------
// 背景：0002_config.sql 文件声明态为 PRAGMA foreign_keys = ON，
//   用于 CI validate 探针（scripts/probe-config-seed.mjs）的正向干净载入
//   + 反向「含目标级策略 POL-Q3 必外键违约」门禁（探针自行设 ON 后 exec
//   本文件，验证行级过滤必要）。
//
//   但 ci.yml deploy 步向「已有业务数据的生产库」重放本文件时，业务表
//   query_record/evidence → source_registry、research → agent_profile、
//   research_goal → gap_rule 存在外键引用，FK ON 下 DELETE 配置父表必违约
//   （首部署空库能过，库一有目标/任务/证据等数据就必挂——CI 历次 deploy 失败即此因）。
//
//   解：deploy 步经本脚本生成本文件的「FK-OFF 副本」再喂 wrangler --file。
//   （D1 连接内 PRAGMA 有效、跨连接无效，故必须文件内 OFF 副本，
//    而非前置 `--command "PRAGMA foreign_keys=OFF"` 单独连接。）
//
//   重新插入的配置行主键不变，业务外键引用自然恢复有效；0002 本体保持 ON 不变。
//
// 用法：node scripts/deploy-seed-off.mjs
//   → 产出 db/seed/.tmp_0002_deploy.sql（仅 deploy 步使用，已 gitignore）
// ============================================================
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'db/seed/0002_config.sql');
const DST = path.join(ROOT, 'db/seed/.tmp_0002_deploy.sql');

const src = readFileSync(SRC, 'utf8');
if (!src.includes('PRAGMA foreign_keys = ON')) {
  throw new Error('0002 中未找到 "PRAGMA foreign_keys = ON"，副本生成中止（声明态漂移？）');
}
const off = src.replace('PRAGMA foreign_keys = ON', 'PRAGMA foreign_keys = OFF');
writeFileSync(DST, off);
console.log(`[OK] 已生成 FK-OFF 部署副本：${DST}（仅 deploy 步使用，0002 本体保持 ON 声明态）`);
