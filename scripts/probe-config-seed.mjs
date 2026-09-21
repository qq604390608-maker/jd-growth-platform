#!/usr/bin/env node
// ============================================================
// probe-config-seed.mjs · 0002_config.sql 载入实测（D1 兼容口径）
// 实测两件事：
//   P1（正向）：schema + 0002_config.sql 在 FK ON 下干净载入，
//              各配置表行数与文件一致，mock 表为 0 行；
//   P2（反向）：若不过滤 run_policy 目标级行（POL-Q3 → mock 目标），
//              载入必须触发外键违约——证明行级过滤是必要的。
// 用法：node scripts/probe-config-seed.mjs   （CI validate 可选步骤）
// ============================================================
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const db = new DatabaseSync(':memory:');

// ---- P1 正向：干净载入 ----
db.exec('PRAGMA foreign_keys = ON;');
db.exec(readFileSync(path.join(ROOT, 'db/migrations/0001_init.sql'), 'utf8'));
db.exec(readFileSync(path.join(ROOT, 'db/seed/0002_config.sql'), 'utf8'));

const configCounts = {
  dict_type: 26, source_registry: 5, gap_rule: 4, context_template: 20,
  agent_profile: 2, touchpoint: 3, dict_item: 84, tool_registry: 12,
  run_policy: 1, skill_registry: 2, tool_permission: 24,
};
for (const [t, want] of Object.entries(configCounts)) {
  const got = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  if (got !== want) throw new Error(`P1 FAIL ${t}: 期望 ${want} 行，实测 ${got} 行`);
}
// mock 业务表必须为 0 行（抽查 6 张）
for (const t of ['research_goal', 'task', 'opportunity', 'evidence', 'query_record', 'business_context']) {
  const got = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  if (got !== 0) throw new Error(`P1 FAIL ${t}: mock 表应为 0 行，实测 ${got} 行`);
}
// 平台级策略在，目标级策略不在
const pol = db.prepare("SELECT policy_id FROM run_policy").all().map((r) => r.policy_id);
if (!(pol.length === 1 && pol[0] === 'POL-PLAT')) throw new Error(`P1 FAIL run_policy: 实测 [${pol}]，应仅 POL-PLAT`);

console.log(`[P1 OK] 配置包干净载入：${Object.keys(configCounts).length} 表 / ${Object.values(configCounts).reduce((a, b) => a + b, 0)} 行，mock 表 0 行，run_policy 仅 POL-PLAT`);

// ---- P2 反向：不过滤则必须违约 ----
db2: {
  const db2 = new DatabaseSync(':memory:');
  db2.exec('PRAGMA foreign_keys = ON;');
  db2.exec(readFileSync(path.join(ROOT, 'db/migrations/0001_init.sql'), 'utf8'));
  const configSql = readFileSync(path.join(ROOT, 'db/seed/0002_config.sql'), 'utf8');
  const srcSql = readFileSync(path.join(ROOT, 'db/seed/0001_mock.sql'), 'utf8');
  const polQ3 = srcSql.split('\n').find((l) => l.includes("VALUES ('POL-Q3'"));
  if (!polQ3) throw new Error('P2 前置失败：0001 中找不到 POL-Q3 行');
  let violated = false;
  try {
    db2.exec(configSql + '\n' + polQ3 + '\n');
  } catch (e) {
    violated = true;
    console.log(`[P2 OK] 含目标级策略 POL-Q3 的包被外键拦截：${String(e.message).slice(0, 80)}`);
  }
  if (!violated) throw new Error('P2 FAIL：POL-Q3 竟然载入成功，行级过滤失去意义，须复查 FK 定义');
}
// ---- P3 幂等：同库重放 0002 两次（模拟 deploy 每次 push main 重放），行数不变 ----
{
  const configSql = readFileSync(path.join(ROOT, 'db/seed/0002_config.sql'), 'utf8');
  db.exec(configSql); // 第二次重放（P1 已载过一次）
  const counts = db.prepare("SELECT (SELECT COUNT(*) FROM dict_item) a, (SELECT COUNT(*) FROM tool_registry) b, (SELECT COUNT(*) FROM run_policy) c").get();
  if (!(counts.a === 84 && counts.b === 12 && counts.c === 1)) {
    throw new Error(`P3 FAIL 重放后行数漂移：dict_item=${counts.a} tool_registry=${counts.b} run_policy=${counts.c}`);
  }
  console.log(`[P3 OK] 同库重放 0002 幂等：行数不变（dict_item=${counts.a} / tool_registry=${counts.b} / run_policy=${counts.c}）`);
}
console.log('[DONE] 0002_config.sql 载入实测通过');
