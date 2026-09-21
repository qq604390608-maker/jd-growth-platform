#!/usr/bin/env node
// ============================================================
// extract-config-seed.mjs · 从 0001_mock.sql 提取生产配置种子
// ------------------------------------------------------------
// 背景（决策项2，2026-09-21 已裁决）：生产必需配置（字典值域 / 工具清单 /
// 角色指令 / 上下文模板等）与 mock 业务数据混在 db/seed/0001_mock.sql，
// 无法按「生产零写」纪律整包灌远程库。本脚本从 0001 派生出仅含配置的
// db/seed/0002_config.sql，0001 一个字不动（30+ 用例 oracle 零影响）。
//
// 唯一真源规则：0002 是 0001 的派生物，禁止手改；漂移用 `--check` 复算发现。
//
// 提取规则：
//   1) 配置表整节提取（见 CONFIG_TABLES）；
//   2) run_policy 仅提取 goal_id IS NULL 的平台级行——目标级策略挂在
//      mock 业务目标上（如 POL-Q3 → GOAL-2026Q3-01），属业务数据，
//      灌生产会触发外键违约（goal_id REFERENCES research_goal）；
//   3) 节顺序继承 0001（其顺序已按外键拓扑排序，子集依然有效）。
//
// 用法：
//   node scripts/extract-config-seed.mjs            # 重新生成 0002_config.sql
//   node scripts/extract-config-seed.mjs --check    # 复算比对，漂移则 exit 1（CI validate 用）
// ============================================================

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'db/seed/0001_mock.sql');
const DST = path.join(ROOT, 'db/seed/0002_config.sql');

/** 配置表清单（生产必需，整节提取）。顺序无关，输出按 0001 原顺序。 */
const CONFIG_TABLES = new Set([
  'dict_type',        // 字典类型
  'dict_item',        // 字典值域（前端徽标 / 写入面校验的唯一真源）
  'source_registry',  // CFG-01 外部来源登记
  'tool_registry',    // CFG-02 工具清单（F-13/F-24 依赖）
  'tool_permission',  // CFG-03 工具权限
  'gap_rule',         // CFG-05 口径检查规则
  'context_template', // CFG-06 上下文注入模板
  'agent_profile',    // MD-13 角色指令登记
  'skill_registry',   // MD-14 技能登记
  'touchpoint',       // 触点登记（频道结构配置）
  'run_policy',       // CFG-04 运行策略（仅平台级，见行级过滤）
]);

/** run_policy 行级过滤：仅 goal_id 为 NULL 的平台级行进配置包。 */
const ROW_FILTERS = {
  run_policy: (line) => {
    const m = line.match(/^INSERT INTO run_policy\s*\(([^)]*)\)\s*VALUES\s*\((.*)\);\s*$/);
    if (!m) return false;
    // 列序：policy_id, policy_scope, goal_id, ...（DDL 定义顺序）
    const cols = m[1].split(',').map((c) => c.trim());
    const vals = m[2].split(',').map((v) => v.trim());
    // 按列名定位 goal_id，容忍列序变化；VALUES 内含逗号的字段不在前三列，直接按位置切安全
    const gi = cols.indexOf('goal_id');
    return gi >= 0 && gi < vals.length && vals[gi] === 'NULL';
  },
};

const HEADER = `-- ============================================================
-- 0002_config.sql · 生产配置种子（仅配置，无 mock 业务数据）
-- 数据来源：由 scripts/extract-config-seed.mjs 从 db/seed/0001_mock.sql 提取生成
-- 【本文件为派生物，禁止手改】修改配置请改 0001（或经裁决直接改 0001 的配置节），
--   然后重跑提取脚本；CI validate 阶段用 --check 防漂移。
-- 决策项2（2026-09-21 已裁决，方案A）：0001_mock.sql 保持不动；
--   生产库仅灌本文件（ci.yml deploy 阶段 d1 execute --remote --file）。
-- 提取规则：配置表整节 + run_policy 仅平台级（goal_id IS NULL）；
--   目标级策略（如 POL-Q3）挂在 mock 目标上，属业务数据，不进生产包。
-- 幂等调和语义：deploy 每次 push main 都会重放本文件，纯 INSERT 第二次必撞主键
--   （2026-09-21 实测发现）——故文件头部先按「子表在前」的逆拓扑序 DELETE 全部
--   配置行，再按原拓扑序 INSERT，每次部署将配置表对齐到本文件声明态。
--   配置值变更：改 0001 配置节 → 重跑提取 → 合 main 即生效，无需手工 UPDATE。
-- 外键（2026-09-21 修正）：生产库经前端/运行会产生业务数据，业务表
--   query_record/evidence → source_registry、research → agent_profile、
--   research_goal → gap_rule 存在外键引用；故种子以 PRAGMA foreign_keys = OFF
--   执行 DELETE+INSERT（重新插入的配置行主键不变，业务外键引用自然恢复有效）。
--   ⚠ 不可改回 ON：改回后重放会在「已有业务数据的库」上触发 FK 违约而失败
--   （首部署空库能过，库一有目标/任务/证据等数据就必挂——CI 历次 deploy 失败即此因）。
-- ============================================================

PRAGMA foreign_keys = OFF;
`;

const sectionRe = /^-- ---- (\w+) \((\d+) 行\) ----$/;

function parseSections(sql) {
  const sections = [];
  let cur = null;
  for (const line of sql.split('\n')) {
    const m = line.match(sectionRe);
    if (m) {
      cur = { table: m[1], declared: Number(m[2]), lines: [] };
      sections.push(cur);
    } else if (cur && line.startsWith('INSERT INTO')) {
      cur.lines.push(line);
    }
  }
  return sections;
}

function buildConfigSql(srcSql) {
  const sections = parseSections(srcSql);
  const seen = new Set();
  const keptSections = [];
  for (const sec of sections) {
    if (!CONFIG_TABLES.has(sec.table)) continue;
    if (seen.has(sec.table)) throw new Error(`配置表 ${sec.table} 在 0001 中出现多个分节`);
    seen.add(sec.table);
    const filter = ROW_FILTERS[sec.table];
    const kept = filter ? sec.lines.filter(filter) : sec.lines;
    if (kept.length === 0) continue; // 全被过滤的表不产空节
    keptSections.push({ table: sec.table, lines: kept, declared: sec.declared });
  }
  const missing = [...CONFIG_TABLES].filter((t) => !seen.has(t));
  if (missing.length) throw new Error(`0001 中缺少配置表分节：${missing.join(', ')}`);

  const out = [HEADER];
  // 幂等调和：先逆拓扑序（子表在前）DELETE，避免父表先删触发 FK 拦截
  out.push('-- ---- 幂等调和 · 逆拓扑序清空配置表（子表在前） ----');
  for (const { table } of [...keptSections].reverse()) out.push(`DELETE FROM ${table};`);
  out.push('');
  // 再按 0001 原拓扑序 INSERT（父表先于子表）
  const manifest = [];
  for (const { table, lines, declared } of keptSections) {
    out.push(`-- ---- ${table} (${lines.length} 行) ----`);
    out.push(...lines, '');
    manifest.push({ table, declared, kept: lines.length });
  }
  return { sql: out.join('\n') + '\n', manifest };
}

const srcSql = readFileSync(SRC, 'utf8');
const { sql, manifest } = buildConfigSql(srcSql);

if (process.argv.includes('--check')) {
  let disk = null;
  try {
    disk = readFileSync(DST, 'utf8');
  } catch {
    console.error(`[FAIL] ${path.relative(ROOT, DST)} 不存在，请重跑提取脚本生成`);
    process.exit(1);
  }
  if (disk !== sql) {
    console.error('[FAIL] 0002_config.sql 与从 0001 复算结果不一致（漂移）。请重跑：node scripts/extract-config-seed.mjs');
    process.exit(1);
  }
  const total = manifest.reduce((s, r) => s + r.kept, 0);
  console.log(`[OK] 0002_config.sql 与 0001 复算一致（${manifest.length} 表 / ${total} 行）`);
  process.exit(0);
}

writeFileSync(DST, sql);
const total = manifest.reduce((s, r) => s + r.kept, 0);
console.log(`[OK] 已生成 ${path.relative(ROOT, DST)}：${manifest.length} 表 / ${total} 行`);
for (const r of manifest) {
  const note = r.filter ? `（0001 声明 ${r.declared} 行，行级过滤后 ${r.kept} 行）` : '';
  console.log(`  - ${r.table}: ${r.kept} 行${note}`);
}
const filtered = manifest.filter((r) => r.kept !== r.declared);
if (filtered.length && !process.argv.includes('--quiet')) {
  for (const r of filtered) console.log(`  [note] ${r.table} 行级过滤：${r.declared} → ${r.kept}`);
}
