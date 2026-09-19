-- db/probes/collation/schema.sql
-- 探针表：仅用于 T-12 实测（中文默认排序对枚举展示顺序的影响），**不是业务迁移**
-- 上游：../../../docs/03-locks/tech-stack.md §3.2 字符集与排序规则 / §8 T-12
--       ../../../docs/03-locks/schema.md §9 字典项清单、CFG-07/CFG-08 字段定义
-- 禁止：本文件不得移入业务 migration 目录；不得据此改 schema.md
--
-- 表结构照抄 CFG-08 dict_item 的相关列（varchar(32) / varchar(64) / int），
-- 以便结论直接映射回字典表。10 条取值取自 schema.md §9 的真实字典项口径，
-- 并按任务要求覆盖三类：纯中文 / 中英混排 / 含括号与斜杠。
-- order_no 故意设为「非字节序、非拼音序」的人为顺序，用于验证它是否是唯一可靠控制。

DROP TABLE IF EXISTS probe_collation;

CREATE TABLE probe_collation (
  item_code varchar(32) NOT NULL PRIMARY KEY,
  item_name varchar(64) NOT NULL,
  order_no  int         NOT NULL
);

INSERT INTO probe_collation (item_code, item_name, order_no) VALUES
  ('TASK_STATUS.RUNNING',        '运行中',                    1),
  ('TASK_STATUS.STOPPED',        '已停止',                    2),
  ('MESSAGE_ROLE.AGENT',         '智能体',                    3),
  ('SOURCE.HJE',                 '黄金眼',                    4),
  ('SOURCE.CDP',                 'CDP 用户标签系统',           5),
  ('TASK_TYPE.HVA_FOLLOWUP',     'HVA 研究 · 追问',            6),
  ('MODEL.GLM',                  'glm-5.3 备选',              7),
  ('BEHAVIOR_STATUS.SUPPORTED',  '候选行为获得支持（仍属候选）',  8),
  ('DEVICE.SCOPE',               'APP / 小程序 / PC',          9),
  ('TOUCHPOINT.SCOPE',           '首页推荐位 / 搜索结果页',      10);
