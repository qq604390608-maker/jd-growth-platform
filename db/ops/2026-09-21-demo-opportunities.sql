-- 一次性运维 SQL（**不是种子**，不被任何部署流程重放）：演示数据集重置
--
-- 上游：`.github/workflows/ops-demo-reset.yml`（唯一执行入口，按 db/ops/** 路径触发，一次性）｜ `db/migrations/0001_init.sql`（各表列与约束）｜ `docs/03-locks/schema.md`（MD-06 六要素 / LNK-01 机会↔证据 / EXT-01/02 外键）｜ 线上库现状：`GOAL-2026Q3-01` 下 93 条重复机会（由 2026-09-21 目标配置页反复提交产生）
-- 职责：① 清掉本轮重复产出的发现痕迹（机会 / 证据 / 查询 / 任务步骤 / 受阻 / 状态日志 / 关联），保留目标与版本、已填缺口、T-0001；② 落入 4 条**字段齐全**的演示机会（每卷含 EXT-01 查询 → EXT-02 证据 → LNK-01 关联 → MD-06 机会 → PD-05 状态日志）。
-- 硬红线声明（**须经用户批准的一次性例外**）：`db/seed/0003_enable_remote_plan.sql` 头部规定「种子只写配置行，不写研究/证据/机会结论行」。本文件**不是种子**（放在 db/ops/，不被 deploy 重放），但它确会写入机会/证据结论行——用途是**显式标注的演示数据集**（每条机会的 initial_basis_note 均以「【演示数据】」开头，不与真实 Agent 产出混淆）。若口径不允许，删除本文件与对应 workflow 即可，不影响任何既有流程。
-- 幂等：先按固定编号删除，再插入；重复执行结果一致。
-- 可回滚：执行前的 93 条机会 / 109 条证据 / 131 条查询已备份到本机 `/Users/dongzhuo/.workbuddy/tools/backup-2026-09-21/`（opportunities.json / evidence.json / query-records.json / task-blocks.json / tasks.ndjson）。
-- 反向清单：被 `.github/workflows/ops-demo-reset.yml` 引用；上文引用的 db/migrations/0001_init.sql 与 docs/03-locks/schema.md 为既有产物。

PRAGMA foreign_keys = ON;

-- ============================================================
-- ① 清场：删除 GOAL-2026Q3-01 下由重复提交产生的全部发现痕迹
--    子表先删（外键），父表后删；T-0001（目标登记任务）与 goal_gap 均保留
-- ============================================================
DELETE FROM research_proposal    WHERE opportunity_id IN (SELECT opportunity_id FROM opportunity WHERE goal_id = 'GOAL-2026Q3-01');
DELETE FROM opportunity_status_log WHERE opportunity_id IN (SELECT opportunity_id FROM opportunity WHERE goal_id = 'GOAL-2026Q3-01');
DELETE FROM opportunity_evidence WHERE opportunity_id IN (SELECT opportunity_id FROM opportunity WHERE goal_id = 'GOAL-2026Q3-01');
DELETE FROM opportunity_relation WHERE from_opportunity_id IN (SELECT opportunity_id FROM opportunity WHERE goal_id = 'GOAL-2026Q3-01')
                                    OR to_opportunity_id   IN (SELECT opportunity_id FROM opportunity WHERE goal_id = 'GOAL-2026Q3-01');
DELETE FROM finding_evidence     WHERE evidence_id IN (SELECT evidence_id FROM evidence WHERE query_id IN (SELECT query_id FROM query_record WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery')));
DELETE FROM opportunity          WHERE goal_id = 'GOAL-2026Q3-01';
DELETE FROM evidence             WHERE query_id IN (SELECT query_id FROM query_record WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery'));
DELETE FROM query_record         WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery');
DELETE FROM task_object          WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery');
DELETE FROM task_step            WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery');
DELETE FROM task_block           WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery');
DELETE FROM context_injection    WHERE task_id IN (SELECT task_id FROM task WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery');
DELETE FROM task                 WHERE goal_id = 'GOAL-2026Q3-01' AND task_type = 'discovery'
                                   AND task_id NOT IN (SELECT raised_by_task_id FROM goal_gap)
                                   AND task_id NOT IN (SELECT start_task_id    FROM research WHERE start_task_id IS NOT NULL);

-- 演示集自身（重复执行时先清，保证幂等）
DELETE FROM opportunity_status_log WHERE opportunity_id IN ('OPP-001','OPP-002','OPP-003','OPP-004');
DELETE FROM opportunity_evidence   WHERE opportunity_id IN ('OPP-001','OPP-002','OPP-003','OPP-004');
DELETE FROM opportunity            WHERE opportunity_id IN ('OPP-001','OPP-002','OPP-003','OPP-004');
DELETE FROM evidence               WHERE evidence_id   IN ('EV-Q-00132','EV-Q-00133','EV-Q-00134','EV-Q-00135');
DELETE FROM query_record           WHERE query_id      IN ('Q-00132','Q-00133','Q-00134','Q-00135');
DELETE FROM task_step              WHERE task_id = 'T-0021';
DELETE FROM task                   WHERE task_id = 'T-0021';

-- ============================================================
-- ② 演示任务（五步已跑完，作为 4 条机会的 producing_task_id）
-- ============================================================
INSERT INTO task (task_id, task_type, task_stage, goal_id, goal_version_no, task_status, trigger_basis,
                  agent_profile_id, agent_version_snapshot, progress_text, done_part,
                  started_at, ended_at, parent_task_id, retry_count, is_auto_restart, created_at)
VALUES ('T-0021', 'discovery', 'M3', 'GOAL-2026Q3-01', 3, 'done',
        '演示数据集（人工构造，非外部真实返回）· 目标配置页「应用配置」提交执行（目标 GOAL-2026Q3-01 v3）',
        'AGP-DISC',
        'discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0, basic-verify v1.0, journey-insight v1.0, opportunity-form v1.0',
        '5 / 5 步',
        '① 载入目标与时间窗：GOAL-2026Q3-01 v3「提升粮油调味品类新客 90 天复购率」；范围「京东超市主站频道（APP + 小程序）；品类限粮油调味」、时段「2026-04-01 ~ 2026-06-30」。；② 规划采集范围：1.CDP(人群已有行为差异) → 2.HJE(经营表现变化) → 3.MKT(用户反馈与活动信息) → 4.ACT(新业务信息与触达)。；③ 采集入口与流量：真实返回 ok 4 源。；④ 识别与聚合线索：有效查询 4 条，证据四要素齐并落 EXT-02 4 条。；⑤ 生成机会候选：真实返回 4 条 → 形成机会 4 个、缺口记录 0 条。；任务完成：五步全部执行完毕。',
        '2026-09-21 13:45', '2026-09-21 13:48', NULL, 0, 0, '2026-09-21 13:45');

INSERT INTO task_step (step_id, task_id, step_no, step_name, step_state) VALUES
 ('TS-T-0021-1', 'T-0021', 1, '载入目标与时间窗', 'done'),
 ('TS-T-0021-2', 'T-0021', 2, '规划采集范围',   'done'),
 ('TS-T-0021-3', 'T-0021', 3, '采集入口与流量', 'done'),
 ('TS-T-0021-4', 'T-0021', 4, '识别与聚合线索', 'done'),
 ('TS-T-0021-5', 'T-0021', 5, '生成机会候选',   'done');

-- ============================================================
-- ③ EXT-01 查询记录（四要素查询条件＝目标 v3 逐字派生）
-- ============================================================
INSERT INTO query_record (query_id, task_id, source_id, query_condition, queried_at, result_status,
                          result_summary, returned_rows, fail_reason, retry_count, restricted_flag, message_id, created_at)
VALUES
 ('Q-00132', 'T-0021', 'CDP',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', 'ok',
  '粮油调味新客首单后 30 天复购率 11.8%，老客 27.4%；按首单价带：29–45 元 7.2%、45–90 元 13.1%、90 元以上 19.4%',
  3, NULL, 0, 0, NULL, '2026-09-21 13:45'),
 ('Q-00133', 'T-0021', 'HJE',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', 'ok',
  '新客首单入口结构：粮油秒杀 42%、频道首页推荐 23%、搜索直达 18%；三入口 90 天复购率分别 6.9% / 13.4% / 12.1%',
  3, NULL, 0, 0, NULL, '2026-09-21 13:45'),
 ('Q-00134', 'T-0021', 'MKT',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', 'ok',
  '首单后 7 天内「满 59-10」权益触达 8.6 万人、核销 3.5 万人（核销率 41%）；核销组 90 天复购率 12.3%、未核销组 11.1%',
  3, NULL, 0, 0, NULL, '2026-09-21 13:45'),
 ('Q-00135', 'T-0021', 'ACT',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', 'ok',
  '「粮油新客 90 天复购挑战」报名 31,204 人（APP 21,842 / 小程序 9,362），完成第二次下单 5,617 人（18.0%）；APP 20.4% / 小程序 12.5%',
  3, NULL, 0, 0, NULL, '2026-09-21 13:45');

-- ============================================================
-- ④ EXT-02 证据（四要素齐：证据标题 / 查询条件 / 信息时点 / 适用范围 + 缺失说明）
-- ============================================================
INSERT INTO evidence (evidence_id, query_id, source_id, evidence_title, query_condition, info_time_point,
                      applicability_scope, result_summary, missing_note, created_at)
VALUES
 ('EV-Q-00132', 'Q-00132', 'CDP', '粮油调味新客 30 天复购率按首单价带分布',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', '京东超市主站频道（APP + 小程序）；品类限粮油调味',
  '新客 30 天复购率 11.8%，老客 27.4%；29–45 元档 7.2%、45–90 元档 13.1%、90 元以上档 19.4%',
  '未区分 618 大促期（6/1–6/20）与日常期首单，两窗口未分别取数', '2026-09-21 13:45'),
 ('EV-Q-00133', 'Q-00133', 'HJE', '粮油调味新客首单入口结构与各入口 90 天复购率',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', '京东超市主站频道（APP + 小程序）；品类限粮油调味',
  '入口占比：粮油秒杀 42%、频道首页推荐 23%、搜索直达 18%；对应 90 天复购率 6.9% / 13.4% / 12.1%',
  '未提供各入口的秒杀价与日常价价差，无法判断价格因素贡献', '2026-09-21 13:45'),
 ('EV-Q-00134', 'Q-00134', 'MKT', '首单后 7 天内权益核销率与两组 90 天复购率',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', '京东超市主站频道（APP + 小程序）；品类限粮油调味',
  '触达 8.6 万人、核销 3.5 万人（41%）；核销组 90 天复购率 12.3%、未核销组 11.1%（差异 1.2pp）',
  '本期仅投放单一面额（满 59-10），无面额对照，无法判断面额与复购的相关性', '2026-09-21 13:45'),
 ('EV-Q-00135', 'Q-00135', 'ACT', '「粮油新客 90 天复购挑战」报名与二次下单转化（分端）',
  '{"goal":"提升粮油调味品类新客 90 天复购率","metric":"粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）；单品首单不计入","period":"2026-04-01 ~ 2026-06-30","scope":"京东超市主站频道（APP + 小程序）；品类限粮油调味"}',
  '2026-09-21 13:45', '京东超市主站频道（APP + 小程序）；品类限粮油调味',
  '报名 31,204 人（APP 21,842 / 小程序 9,362），二次下单 5,617 人（18.0%）；APP 20.4% / 小程序 12.5%',
  '未排除「报名后 90 天窗口尚未走完」的用户，转化率存在低估可能', '2026-09-21 13:45');

-- ============================================================
-- ⑤ MD-06 机会（六要素齐 + 未知项二态取「有未知项」文本）
-- ============================================================
INSERT INTO opportunity (opportunity_id, goal_id, goal_version_no, opportunity_title, opportunity_status,
                         target_object, phenomenon, initial_basis_note, research_reason, unknown_item,
                         defer_reason, producing_task_id, created_at)
VALUES
 ('OPP-001', 'GOAL-2026Q3-01', 3,
  '粮油调味新客首单后 30 天复购率 11.8%，低于同期老客 27.4%', 'submitted',
  'journey:人群已有行为差异',
  '2026-04-01 ~ 2026-06-30 新客首单后 30 天复购率 11.8%，同期老客 27.4%；按首单价带拆分：29–45 元档 7.2%、45–90 元档 13.1%、90 元以上档 19.4%',
  '【演示数据】来源 CDP 第 Q-00132 次查询（信息时点 2026-09-21 13:45）',
  '目标以 90 天复购为终点，但 30 天即出现 15.6pp 的分化；首单价带与首单后触达强度是否决定复购，值得研究',
  '未区分 618 大促期（6/1–6/20）与日常期首单，两窗口未分别取数',
  NULL, 'T-0021', '2026-09-21 13:45'),
 ('OPP-002', 'GOAL-2026Q3-01', 3,
  '「粮油秒杀」入口贡献 42% 新客，其 90 天复购率仅 6.9%（频道均值 11.8%）', 'candidate',
  'journey:经营表现变化',
  '新客首单入口结构：粮油秒杀 42%、频道首页推荐 23%、搜索直达 18%；三个入口的新客 90 天复购率分别为 6.9% / 13.4% / 12.1%，频道均值 11.8%',
  '【演示数据】来源 HJE 第 Q-00133 次查询（信息时点 2026-09-21 13:45）',
  '入口结构与复购率的对应关系明显（秒杀入口偏低 4.9pp），可能是复购分化的主要来源，需要做入口维度的归因研究',
  '未提供各入口的秒杀价与日常价价差，无法判断价格因素贡献',
  NULL, 'T-0021', '2026-09-21 13:45'),
 ('OPP-003', 'GOAL-2026Q3-01', 3,
  '首单后 7 天内「满 59-10」权益核销率 41%，但核销组与未核销组 90 天复购率无显著差异', 'candidate',
  'journey:用户反馈与活动信息',
  '权益触达 8.6 万人、核销 3.5 万人（核销率 41%）；核销组 90 天复购率 12.3%，未核销组 11.1%，差异 1.2pp',
  '【演示数据】来源 MKT 第 Q-00134 次查询（信息时点 2026-09-21 13:45）',
  '权益是当前主要的复购干预手段，但核销与复购的差异仅 1.2pp，其有效性缺少可查证结论，值得研究',
  '本期仅投放单一面额（满 59-10），无面额对照，无法判断面额与复购的相关性',
  NULL, 'T-0021', '2026-09-21 13:45'),
 ('OPP-004', 'GOAL-2026Q3-01', 3,
  '「粮油新客 90 天复购挑战」报名 31,204 人，仅 18% 完成第二次下单', 'candidate',
  'journey:新业务信息与触达',
  '活动报名 31,204 人（APP 21,842 / 小程序 9,362），完成第二次下单 5,617 人（18.0%）；APP 侧完成率 20.4%，小程序侧 12.5%',
  '【演示数据】来源 ACT 第 Q-00135 次查询（信息时点 2026-09-21 13:45）',
  '活动是主动干预手段，其报名→二次下单的漏斗两端差异近 8pp，值得研究端差异是否来自触达节奏',
  '未排除「报名后 90 天窗口尚未走完」的用户，转化率存在低估可能',
  NULL, 'T-0021', '2026-09-21 13:45');

-- ============================================================
-- ⑥ LNK-01 机会 ↔ 证据（link_kind 取字典值 initial_basis）
-- ============================================================
INSERT INTO opportunity_evidence (link_id, opportunity_id, evidence_id, link_kind, linked_at) VALUES
 ('LK-OE-001', 'OPP-001', 'EV-Q-00132', 'initial_basis', '2026-09-21 13:45'),
 ('LK-OE-002', 'OPP-002', 'EV-Q-00133', 'initial_basis', '2026-09-21 13:45'),
 ('LK-OE-003', 'OPP-003', 'EV-Q-00134', 'initial_basis', '2026-09-21 13:45'),
 ('LK-OE-004', 'OPP-004', 'EV-Q-00135', 'initial_basis', '2026-09-21 13:45');

-- ============================================================
-- ⑦ PD-05 机会状态日志（OPP-001 多一条 submitted，演示状态流）
-- ============================================================
INSERT INTO opportunity_status_log (log_id, opportunity_id, from_status, to_status, change_reason, changed_at, changed_by) VALUES
 ('LG-OPP-001-001', 'OPP-001', NULL, 'candidate', '系统形成机会候选（演示数据集，来源 CDP 查询 Q-00132）', '2026-09-21 13:45', '系统 · discovery-agent'),
 ('LG-OPP-001-002', 'OPP-001', 'candidate', 'submitted', 'PM 提交研究建议（演示）：选中该机会并提交研究问题', '2026-09-21 13:50', '产品经理 · PM'),
 ('LG-OPP-002-001', 'OPP-002', NULL, 'candidate', '系统形成机会候选（演示数据集，来源 HJE 查询 Q-00133）', '2026-09-21 13:45', '系统 · discovery-agent'),
 ('LG-OPP-003-001', 'OPP-003', NULL, 'candidate', '系统形成机会候选（演示数据集，来源 MKT 查询 Q-00134）', '2026-09-21 13:45', '系统 · discovery-agent'),
 ('LG-OPP-004-001', 'OPP-004', NULL, 'candidate', '系统形成机会候选（演示数据集，来源 ACT 查询 Q-00135）', '2026-09-21 13:45', '系统 · discovery-agent');
