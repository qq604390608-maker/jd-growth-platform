# -*- coding: utf-8 -*-
"""
generate_mock.py · 由原型 data.js / external-deps.md 抽取真实 mock 源，生成 0001_mock.sql
依据：docs/03-locks/schema.md v1.3、prototype/assets/data.js、docs/03-locks/external-deps.md §5
规则：
  - 外键顺序插入（父表先于子表）
  - Q-07 已决（2026-09-19）→ MD-14 skill_registry 按映射补 2 行（S-A1=clue-scan/discovery-agent、S-B1=hva-five-checks/hva-agent）
  - MD-12 / PD-02 / PD-04 / PD-06 / EXT-03 原型无对应数据 → 0 行（注释说明）
  - datetime 用 'YYYY-MM-DD HH:MM' 文本
运行：python3 generate_mock.py  -> 写 ../seed/0001_mock.sql
"""
import os
import sqlite3

OUT = os.path.join(os.path.dirname(__file__), "0001_mock.sql")

def S(v):
    if v is None:
        return "NULL"
    return "'" + str(v).replace("'", "''") + "'"

def I(v):
    return "NULL" if v is None else str(int(v))

def ins(table, cols, rows):
    """rows: list of tuples，与 cols 顺序一致。"""
    out = []
    out.append("-- ---- %s (%d 行) ----" % (table, len(rows)))
    if not rows:
        out.append("-- (无 mock 数据)")
        out.append("")
        return "\n".join(out)
    col_sql = ", ".join(cols)
    for r in rows:
        vals = []
        for c, v in zip(cols, r):
            vals.append(S(v) if isinstance(v, str) or v is None else I(v))
        out.append("INSERT INTO %s (%s) VALUES (%s);" % (table, col_sql, ", ".join(vals)))
    out.append("")
    return "\n".join(out)

parts = []
EMITS = {}  # table -> list[sql]; 末尾按 DDL 外键拓扑排序输出，保证父表先于子表

def emit(table, cols, rows):
    EMITS.setdefault(table, []).append(ins(table, cols, rows))

parts.append("-- ============================================================")
parts.append("-- 0001_mock.sql · 全 mock 种子数据（仅 INSERT，不含 DDL）")
parts.append("-- 数据来源：prototype/assets/data.js（全站唯一 mock 源）+ external-deps.md §5 工具清单")
parts.append("-- 外键顺序：由生成器按 0001_init.sql 外键依赖做拓扑排序自动保证（父表先于子表）")
parts.append("-- 注：MD-14 skill_registry 按 Q-07 已决映射补 2 行；MD-12/PD-02/PD-04/PD-06/EXT-03 原型无数据留空")
parts.append("-- ============================================================")
parts.append("")
parts.append("PRAGMA foreign_keys = ON;")
parts.append("")

# ---------------- CFG-07 字典类型 ----------------
dict_types = [
    ("GOAL_STATUS", "目标生命周期状态", "MD-01 goal_status"),
    ("GOAL_FIELD", "目标六要素字段", "CFG-05 target_field / PD-04 target_field"),
    ("MATERIAL_KIND", "目标材料类型", "MD-03 material_kind"),
    ("MATERIAL_FROM", "目标材料来源", "MD-03 material_from"),
    ("CONTEXT_KIND", "业务背景类型", "MD-04 context_kind"),
    ("OPP_STATUS", "机会状态", "MD-06 opportunity_status"),
    ("RESEARCH_STATUS", "研究状态", "MD-07 research_status"),
    ("FINDING_SUPPORT", "关键发现支持情况", "MD-08 support_flag"),
    ("BEHAVIOR_STATUS", "候选行为支持情况", "MD-09 behavior_status"),
    ("BEHAVIOR_POINT_TYPE", "候选行为条目立场", "MD-10 point_type"),
    ("TASK_TYPE", "任务类型", "PD-01 task_type / CFG-06 task_type"),
    ("TASK_STATUS", "任务运行状态", "PD-01 task_status"),
    ("STEP_STATE", "任务步骤状态", "PD-02 step_state"),
    ("BLOCK_REASON", "任务受阻原因", "PD-03 block_reason_code"),
    ("QUERY_STATUS", "查询执行结果", "EXT-01 result_status"),
    ("SOURCE_CODE", "来源系统编码", "CFG-01/02 source_id / EXT-01/02 source_id"),
    ("SOURCE_STATUS", "来源可用性", "CFG-01 availability_status"),
    ("CONTEXT_TYPE", "上下文注入信息类型", "CFG-06/PD-06 context_type_code"),
    ("OBJECT_TYPE", "研究对象类型", "LNK-04/PD-06 object_type"),
    ("TASK_LINK_ROLE", "任务关联角色", "LNK-04 link_role"),
    ("GRANTEE_TYPE", "权限授权对象类型", "CFG-03 grantee_type"),
    ("POLICY_SCOPE", "运行策略作用域", "CFG-04 policy_scope"),
    ("MESSAGE_ROLE", "追问发言方", "PD-07 message_role"),
    ("EVIDENCE_LINK_KIND", "机会-证据关联语义", "LNK-01 link_kind"),
    ("OPP_RELATION", "机会间关系语义", "LNK-03 relation_kind"),
    ("AGENT_CODE", "Agent 代码", "MD-13 agent_code / MD-14 bound_agent_code"),
]
emit("dict_type", ["dict_type_code", "dict_type_name", "used_by_field"], dict_types)

# ---------------- CFG-08 字典项 ----------------
dict_items = [
    ("GOAL_STATUS", "active", "生效中", 1),
    ("GOAL_STATUS", "archived", "已归档", 2),
    ("GOAL_FIELD", "business_goal", "① 业务目标", 1),
    ("GOAL_FIELD", "metric_definition", "② 指标口径", 2),
    ("GOAL_FIELD", "business_scope", "③ 业务范围", 3),
    ("GOAL_FIELD", "focus_period", "④ 关注时段", 4),
    ("GOAL_FIELD", "known_constraints", "⑤ 已知约束", 5),
    ("GOAL_FIELD", "provider", "⑥ 提供方", 6),
    ("MATERIAL_KIND", "sheet", "表格", 1),
    ("MATERIAL_KIND", "mail", "邮件", 2),
    ("MATERIAL_KIND", "doc", "文档", 3),
    ("MATERIAL_KIND", "manual", "登记", 4),
    ("MATERIAL_FROM", "tenant", "业务方提供", 1),
    ("MATERIAL_FROM", "local", "本地选取", 2),
    ("MATERIAL_FROM", "manual", "手动登记", 3),
    ("CONTEXT_KIND", "knowledge", "业务知识", 1),
    ("CONTEXT_KIND", "constraint", "业务约束", 2),
    ("CONTEXT_KIND", "definition", "口径说明", 3),
    ("OPP_STATUS", "candidate", "候选", 1),
    ("OPP_STATUS", "deferred", "暂不研究", 2),
    ("OPP_STATUS", "submitted", "已提交研究", 3),
    ("RESEARCH_STATUS", "running", "研究中", 1),
    ("RESEARCH_STATUS", "done", "已完成", 2),
    ("FINDING_SUPPORT", "supported", "已支持", 1),
    ("FINDING_SUPPORT", "unsupported", "未支持", 2),
    ("BEHAVIOR_STATUS", "candidate_supported", "候选行为获得支持（仍属候选）", 1),
    ("BEHAVIOR_STATUS", "not_supported", "未找到足够依据支持", 2),
    ("BEHAVIOR_POINT_TYPE", "support", "支持的方面", 1),
    ("BEHAVIOR_POINT_TYPE", "unsupport", "不支持或存疑的方面", 2),
    ("TASK_TYPE", "goal_check", "口径检查", 1),
    ("TASK_TYPE", "discovery", "机会发现", 2),
    ("TASK_TYPE", "hva_research", "HVA 研究", 3),
    ("TASK_TYPE", "hva_followup", "HVA 研究·追问", 4),
    ("TASK_STATUS", "running", "运行中", 1),
    ("TASK_STATUS", "blocked", "受阻", 2),
    ("TASK_STATUS", "stopped", "已停止", 3),
    ("TASK_STATUS", "done", "已完成", 4),
    ("STEP_STATE", "pending", "待执行", 1),
    ("STEP_STATE", "active", "进行中", 2),
    ("STEP_STATE", "done", "已完成", 3),
    ("STEP_STATE", "blocked", "受阻", 4),
    ("BLOCK_REASON", "target_unclear", "目标或指标口径不清", 1),
    ("BLOCK_REASON", "no_data_returned", "接口未返回研究所需信息", 2),
    ("BLOCK_REASON", "source_unavailable", "来源未接入或权限不足", 3),
    ("BLOCK_REASON", "call_failed", "查询或服务调用失败", 4),
    ("BLOCK_REASON", "limit_or_cancel", "达到运行限制或人工取消", 5),
    ("BLOCK_REASON", "insufficient_basis", "研究完成但没有足够依据", 6),
    ("QUERY_STATUS", "ok", "成功", 1),
    ("QUERY_STATUS", "fail", "失败", 2),
    ("QUERY_STATUS", "running", "执行中", 3),
    ("SOURCE_CODE", "CDP", "CDP 用户标签系统", 1),
    ("SOURCE_CODE", "HJE", "黄金眼", 2),
    ("SOURCE_CODE", "PIM", "商品中台", 3),
    ("SOURCE_CODE", "MKT", "营销中台", 4),
    ("SOURCE_CODE", "ACT", "活动报名系统", 5),
    ("SOURCE_STATUS", "ok", "可用", 1),
    ("SOURCE_STATUS", "degraded", "降级", 2),
    ("SOURCE_STATUS", "unauthorized", "未接入", 3),
    ("CONTEXT_TYPE", "goal", "目标", 1),
    ("CONTEXT_TYPE", "background", "背景", 2),
    ("CONTEXT_TYPE", "source", "可用来源", 3),
    ("CONTEXT_TYPE", "opp_summary", "已有机会摘要", 4),
    ("CONTEXT_TYPE", "selected_opp", "所选机会", 5),
    ("CONTEXT_TYPE", "product_question", "产品问题", 6),
    ("CONTEXT_TYPE", "existing_evidence", "已有证据", 7),
    ("CONTEXT_TYPE", "related_history", "相关历史", 8),
    ("OBJECT_TYPE", "goal", "研究目标", 1),
    ("OBJECT_TYPE", "opportunity", "机会", 2),
    ("OBJECT_TYPE", "research", "研究", 3),
    ("OBJECT_TYPE", "proposal", "研究建议", 4),
    ("TASK_LINK_ROLE", "trigger", "启动对象", 1),
    ("TASK_LINK_ROLE", "output", "产出对象", 2),
    ("GRANTEE_TYPE", "agent", "按 Agent", 1),
    ("GRANTEE_TYPE", "task_type", "按任务类型", 2),
    ("POLICY_SCOPE", "platform", "平台级", 1),
    ("POLICY_SCOPE", "goal", "目标级", 2),
    ("MESSAGE_ROLE", "pm", "产品经理", 1),
    ("MESSAGE_ROLE", "agent", "智能体", 2),
    ("EVIDENCE_LINK_KIND", "initial_basis", "初步依据", 1),
    ("EVIDENCE_LINK_KIND", "related_update", "关联更新", 2),
    ("OPP_RELATION", "same_issue", "相同问题关联", 1),
    ("OPP_RELATION", "superseded", "被取代", 2),
    ("AGENT_CODE", "discovery-agent", "机会发现 Agent", 1),
    ("AGENT_CODE", "hva-agent", "HVA 分析 Agent", 2),
]
emit("dict_item", ["dict_item_id", "dict_type_code", "item_code", "item_name", "order_no", "is_active"],
                 [("DI-%03d" % (i + 1),) + r + (1,) for i, r in enumerate(dict_items)])

# ---------------- CFG-01 来源 ----------------
sources = [
    ("CDP", "CDP 用户标签系统", "人群圈选、标签分布、人群规模", "完整用户行为序列（仅有标签与聚合结果）", "ok", 1, "2026-07-01 00:00", "2026-09-18 00:00"),
    ("HJE", "黄金眼", "线上流量、坑位曝光点击、路径转化", "用户级别明细，仅到渠道/坑位聚合", "ok", 1, "2026-07-01 00:00", "2026-09-18 00:00"),
    ("PIM", "商品中台", "超市商品主数据、品类归属、价格带", "商品实时库存与履约状态", "ok", 1, "2026-07-01 00:00", "2026-09-18 00:00"),
    ("MKT", "营销中台", "权益发放与核销记录", "权益对复购的增量效果（需另行测算）", "ok", 1, "2026-07-01 00:00", "2026-09-18 00:00"),
    ("ACT", "活动报名系统", "活动是否存在、活动时间与报名商品", "用户是否真正参与及受影响程度", "degraded", 0, "2026-07-01 00:00", "2026-09-18 00:00"),
]
emit("source_registry", ["source_id", "source_name", "capability_can", "capability_cannot", "availability_status", "is_mcp_ready", "registered_at", "updated_at"], sources)

# ---------------- CFG-02 工具（TOL-01..12） ----------------
tools = [
    ("TOL-01", "cdp.crowd.query", "人群圈选与规模查询", "CDP", "取某人群的规模、标签分布，用于确认「该人群是否值得研究」", "目标业务范围已明确（否则圈选条件无法确定）", 0),
    ("TOL-02", "cdp.tag.distribution", "标签分布查询", "CDP", "取某标签在人群中的分布，用于人群差异的初步观察", "同上", 0),
    ("TOL-03", "cdp.behavior.agg", "行为聚合查询（非明细）", "CDP", "取行为在人群中的占比等聚合值", "行为定义已与目标口径对齐", 0),
    ("TOL-04", "hje.traffic.entry", "入口维度流量查询", "HJE", "按入口类型/时段/品类取流量与转化，用于入口差异观察", "入口与时段条件已定", 0),
    ("TOL-05", "hje.slot.exposure", "坑位曝光点击查询", "HJE", "取坑位级曝光与点击，用于触点效果观察", "坑位已登记（MD-05）", 0),
    ("TOL-06", "hje.path.conversion", "路径转化查询", "HJE", "取路径转化，用于旅程环节的流量观察", "旅程环节已定义", 0),
    ("TOL-07", "pim.category.query", "品类商品主数据查询", "PIM", "取品类下的商品、规格、价格带结构", "品类范围已定", 0),
    ("TOL-08", "pim.spec.distribution", "规格标签占比查询", "PIM", "取规格（家庭装/多件装等）在品类中的占比", "品类与规格标签已定", 0),
    ("TOL-09", "mkt.benefit.issue", "权益发放查询", "MKT", "取券发放量与领取人群，用于排除权益干扰", "券类型与窗口已定", 0),
    ("TOL-10", "mkt.benefit.redeem", "权益核销查询", "MKT", "取核销率，用于判断权益是否构成替代解释", "同上", 0),
    ("TOL-11", "act.activity.list", "已报名活动清单查询", "ACT", "取活动时段内已报名活动，用于排除活动干扰", "活动时段与频道已定", 0),
    ("TOL-12", "act.enroll.detail", "活动参与明细查询", "ACT", "取用户是否真实参与活动", "—（经判定该工具不存在：ACT 仅有报名信息）", 0),
]
emit("tool_registry", ["tool_id", "tool_code", "tool_name", "source_id", "tool_purpose", "call_condition", "is_enabled"], tools)

# ---------------- CFG-03 工具权限（每工具 × 两 Agent 允许） ----------------
perms = []
for i, t in enumerate(tools):
    perms.append(("PERM-D-%02d" % (i + 1), "agent", "discovery-agent", t[0], 1, None, "2026-07-01 00:00", None))
    perms.append(("PERM-H-%02d" % (i + 1), "agent", "hva-agent", t[0], 1, None, "2026-07-01 00:00", None))
emit("tool_permission", ["permission_id", "grantee_type", "grantee_ref", "tool_id", "allow_flag", "restrict_reason", "effective_from", "effective_until"], perms)

# ---------------- CFG-04 运行策略 ----------------
# 注：schema CFG-04 无 registered_at 列（运行策略由后端持有，原型不呈现），故不种注册时点
policies = [
    ("POL-PLAT", "platform", None, "每日 02:00", 120, 50, 3, 1),
    ("POL-Q3", "goal", "GOAL-2026Q3-01", "每日 02:00", 120, 50, 3, 1),
]
emit("run_policy", ["policy_id", "policy_scope", "goal_id", "run_frequency", "max_duration_min", "call_limit", "retry_limit", "is_active"], policies)

# ---------------- CFG-05 口径检查规则 ----------------
gap_rules = [
    ("GAP-1", "metric_definition", "退款|取消", "复购口径是否剔除退款 / 取消订单", "直接影响复购率分母与候选行为判定", 1),
    ("GAP-2", "metric_definition", "跨品类|首次下单|首单定义", "新客是否限定为「跨品类首单」，单品类首单是否计入", "决定人群圈选条件与可比基础", 1),
    ("GAP-3", "business_scope", "APP|小程序|PC|渠道", "是否区分 APP / 小程序 / PC 渠道分别统计", "若不分渠道，行为差异可能被渠道结构掩盖", 1),
    ("GAP-4", "focus_period", r"\d{4}-\d{1,2}-\d{1,2}", "关注时段未写明具体起止日期", "取数窗口不确定，证据时点无法对齐", 1),
]
emit("gap_rule", ["rule_id", "target_field", "match_pattern", "gap_text", "impact_note", "is_active"], gap_rules)

# ---------------- CFG-06 上下文注入模板 ----------------
ctx_tmpl = []
ct = 0
specs = [
    ("goal_check", ["goal", "background", "source"]),
    ("discovery", ["goal", "background", "source", "opp_summary"]),
    ("hva_research", ["goal", "background", "source", "selected_opp", "product_question", "existing_evidence"]),
    ("hva_followup", ["goal", "background", "source", "selected_opp", "product_question", "existing_evidence", "related_history"]),
]
for tt, types in specs:
    for j, ct_code in enumerate(types, 1):
        ct += 1
        ctx_tmpl.append(("CT-%03d" % ct, tt, ct_code, j, 1))
emit("context_template", ["template_id", "task_type", "context_type_code", "order_no", "is_required"], ctx_tmpl)

# ---------------- MD-01 研究目标 ----------------
goals = [
    ("GOAL-2026Q3-01", 1, 3, "active", "2026-07-28 14:30", "超市事业部运营组 · 张运营"),
    ("GOAL-2026Q2-01", 2, 2, "active", "2026-04-02 09:15", "超市事业部运营组 · 李运营"),
    ("GOAL-2026Q1-01", 3, 1, "archived", "2026-01-05 11:20", "超市事业部运营组 · 王运营"),
]
emit("research_goal", ["goal_id", "goal_seq", "current_version_no", "goal_status", "created_at", "created_by"], goals)

# ---------------- MD-13 Agent 角色指令 ----------------
agents = [
    ("AGP-DISC", "discovery-agent", "机会发现 Agent", "M3", "v1.2", "r9", 1),
    ("AGP-HVA", "hva-agent", "HVA 分析 Agent", "M4", "v1.3", "r12", 1),
]
emit("agent_profile", ["profile_id", "agent_code", "agent_name", "agent_stage", "current_version", "doc_revision", "is_active"], agents)

# ---------------- MD-02 目标版本 ----------------
versions = [
    ("GV-Q3-V3", "GOAL-2026Q3-01", 3, "提升京东超市新客 30 天复购率", "新客 = 考察期内首次在京东超市下单的用户；30 天复购 = 首单后 30 个自然日内再次下单（≥1 单）", "京东超市主站频道；品类限粮油调味、乳品烘焙、个护清洁", "2026-07-01 ~ 2026-09-15", "Q3 大促（8/18–8/20）期间流量结构偏移，该时段需单独观察，不与日常合并", "超市事业部运营组 · 张运营", "关注时段延长至 9/15；补充大促时段排除约束", "影响 2 个在研研究（R-007、R-006）：新时段需补查黄金眼流量证据", 1, "2026-09-12 17:20", "2026-09-12 17:20", "张运营"),
    ("GV-Q3-V2", "GOAL-2026Q3-01", 2, "提升京东超市新客 30 天复购率", "新客 = 考察期内首次在京东超市下单的用户；30 天复购 = 首单后 30 个自然日内再次下单（≥1 单）", "京东超市主站频道；品类限粮油调味、乳品烘焙、个护清洁", "2026-07-01 ~ 2026-09-15", "Q3 大促（8/18–8/20）期间流量结构偏移，该时段需单独观察，不与日常合并", "超市事业部运营组 · 张运营", "品类范围由全品类收敛至 3 个品类", "影响 1 个在研研究（R-006）：原乳品外样本不再纳入", 0, None, "2026-08-25 10:05", "张运营"),
    ("GV-Q3-V1", "GOAL-2026Q3-01", 1, "提升京东超市新客 30 天复购率", "新客 = 考察期内首次在京东超市下单的用户；30 天复购 = 首单后 30 个自然日内再次下单（≥1 单）", "京东超市主站频道；品类限粮油调味、乳品烘焙、个护清洁", "2026-07-01 ~ 2026-09-15", "Q3 大促（8/18–8/20）期间流量结构偏移，该时段需单独观察，不与日常合并", "超市事业部运营组 · 张运营", "首次登记", "—", 0, None, "2026-07-28 14:30", "张运营"),
    ("GV-Q2-V2", "GOAL-2026Q2-01", 2, "提升粮油调味品类新客 90 天复购率", "粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）", "京东超市主站频道（APP + 小程序）；品类限粮油调味", "2026-04-01 ~ 2026-06-30", "618 大促（6/1–6/20）期间单独观察，不与日常合并", "超市事业部运营组 · 李运营", "复购窗口由 60 天延长至 90 天", "影响 1 个已归档研究（R-003）：需按 90 天窗口重算", 1, "2026-06-30 15:40", "2026-06-30 15:40", "李运营"),
    ("GV-Q2-V1", "GOAL-2026Q2-01", 1, "提升粮油调味品类新客 90 天复购率", "粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）", "京东超市主站频道（APP + 小程序）；品类限粮油调味", "2026-04-01 ~ 2026-06-30", "618 大促（6/1–6/20）期间单独观察，不与日常合并", "超市事业部运营组 · 李运营", "首次登记", "—", 0, None, "2026-04-02 09:15", "李运营"),
    ("GV-Q1-V1", "GOAL-2026Q1-01", 1, "提升超市新客首单件单价", "件单价 = 新客首次下单的订单金额 / 订单商品件数（已剔除退款与取消订单）；首次下单 = 考察期内首次在超市完成的成交订单", "京东超市主站频道；按 APP / 小程序 / PC 分渠道统计，品类不限", "2026-01-01 ~ 2026-03-01", "年货节（1/17–2/5）期间单独观察", "超市事业部运营组 · 王运营", "首次登记", "—", 1, "2026-03-05 11:20", "2026-03-05 11:20", "王运营"),
]
emit("research_goal_version", ["goal_version_id", "goal_id", "version_no", "business_goal", "metric_definition", "business_scope", "focus_period", "known_constraints", "provider", "change_note", "impact_note", "is_applied", "applied_at", "created_at", "created_by"], versions)

# ---------------- MD-03 目标材料 ----------------
materials = [
    ("MAT-02", "GOAL-2026Q3-01", "Q3 运营目标拆解表 v2", "sheet", "2026-09-10", "tenant", 1, "2026-09-10 00:00"),
    ("MAT-01", "GOAL-2026Q3-01", "新客定义说明邮件（9/10）", "mail", "2026-09-10", "tenant", 1, "2026-09-10 00:00"),
    ("MAT-Q2-02", "GOAL-2026Q2-01", "Q2 粮油品类运营复盘", "sheet", "2026-06-28", "tenant", 1, "2026-06-28 00:00"),
    ("MAT-Q2-01", "GOAL-2026Q2-01", "粮油消耗周期说明", "doc", "2026-06-20", "tenant", 1, "2026-06-20 00:00"),
    ("MAT-Q1-01", "GOAL-2026Q1-01", "Q1 新客结构分析", "doc", "2026-03-01", "tenant", 1, "2026-03-01 00:00"),
]
emit("goal_material", ["material_id", "goal_id", "material_name", "material_kind", "material_at", "material_from", "is_active", "registered_at"], materials)

# ---------------- MD-04 业务背景（3 条，忠实于 data.js 约束） ----------------
contexts = [
    ("BC-01", "GOAL-2026Q3-01", "knowledge", "Q3 大促流量结构偏移", "8/18–8/20 大促期间流量结构明显偏移，该时段复购表现不可与日常合并观察，须单独切片。", "Q3 运营目标拆解表 v2", 1, "2026-09-10 00:00"),
    ("BC-02", "GOAL-2026Q3-01", "constraint", "复购口径剔除退款与取消", "复购率分母须剔除退款与取消订单，否则低估真实复购。", "新客定义说明邮件（9/10）", 1, "2026-09-10 00:00"),
    ("BC-03", None, "definition", "数据口径默认覆盖范围", "默认覆盖范围＝京东超市主站频道 APP 端；小程序端数据单独标注，不默认并入。", "平台通用口径", 1, "2026-07-01 00:00"),
]
emit("business_context", ["context_id", "goal_id", "context_kind", "title", "content", "source_ref", "is_active", "created_at"], contexts)

# ---------------- MD-05 触点 ----------------
touchpoints = [
    ("TP-01", "首页推荐位", "京东超市频道", "APP 首页信息流推荐位", 1, "2026-07-01 00:00"),
    ("TP-02", "搜索结果页", "京东超市频道", "搜索关键词结果页", 1, "2026-07-01 00:00"),
    ("TP-03", "京东超市频道", "京东超市频道", "频道落地页与品类楼层", 1, "2026-07-01 00:00"),
]
emit("touchpoint", ["touchpoint_id", "touchpoint_name", "channel", "position_desc", "is_active", "created_at"], touchpoints)

# ---------------- PD-01 任务（先于机会/研究，供外键） ----------------
tasks = [
    ("T-1022", "discovery", "M3", "GOAL-2026Q3-01", 3, "done", "按运行频率（每日 02:00）自动创建发现任务", "AGP-DISC", "discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0", "5 / 5 步", "产出 3 条新机会（OPP-012 / OPP-013 / OPP-014），1 条关联更新（OPP-009）", "2026-09-16 02:00", "2026-09-16 04:35", None, 0, 0, "2026-09-16 02:00"),
    ("T-1021", "hva_research", "M4", "GOAL-2026Q3-01", 3, "done", "PM 于 2026-09-15 20:28 提交研究建议（OPP-010）", "AGP-HVA", "hva-agent v1.2 / agent.md r11", "5 / 5 步", "形成研究结果 R-006：未支持「家庭装首单」为候选 HVA", "2026-09-15 20:30", "2026-09-16 15:10", None, 0, 0, "2026-09-15 20:30"),
    ("T-1023", "hva_followup", "M4", "GOAL-2026Q3-01", 3, "running", "PM 于 2026-09-18 09:11 在 R-007 上提交追问：「乳品方向补查渠道结构」", "AGP-HVA", "hva-agent v1.3 / agent.md r12 / skills: hva-five-checks v1.1", "2 / 5 步", "已注入原研究 R-007 上下文；已完成第 1 项查询", "2026-09-18 09:12", None, None, 0, 0, "2026-09-18 09:12"),
    ("T-1020", "hva_research", "M4", "GOAL-2026Q3-01", 3, "blocked", "PM 于 2026-09-16 09:58 提交研究建议（OPP-009）", "AGP-HVA", "hva-agent v1.3 / agent.md r12", "1 / 5 步", "已保存启动依据与首次查询记录；CDP 行为明细查询失败，已完成部分保留待续", "2026-09-16 10:00", None, None, 0, 0, "2026-09-16 10:00"),
    ("T-1019", "discovery", "M3", "GOAL-2026Q3-01", 1, "stopped", "按运行频率自动创建", "AGP-DISC", "discovery-agent v1.0 / agent.md r5", "2 / 5 步", "已形成的范围说明与信息缺口已保存，可后续重跑", "2026-08-02 02:00", "2026-08-02 02:47", None, 0, 0, "2026-08-02 02:00"),
    ("T-1018", "discovery", "M3", "GOAL-2026Q3-01", 2, "done", "按运行频率自动创建", "AGP-DISC", "discovery-agent v1.2 / agent.md r9", "5 / 5 步", "产出 OPP-011、OPP-009", "2026-09-13 02:00", "2026-09-13 03:20", None, 0, 0, "2026-09-13 02:00"),
    ("T-1008", "discovery", "M3", "GOAL-2026Q2-01", 2, "done", "按运行频率自动创建", "AGP-DISC", "discovery-agent v1.1 / agent.md r7", "5 / 5 步", "产出 OPP-006、OPP-005", "2026-06-28 02:00", "2026-06-28 03:40", None, 0, 0, "2026-06-28 02:00"),
]
emit("task", ["task_id", "task_type", "task_stage", "goal_id", "goal_version_no", "task_status", "trigger_basis", "agent_profile_id", "agent_version_snapshot", "progress_text", "done_part", "started_at", "ended_at", "parent_task_id", "retry_count", "is_auto_restart", "created_at"], tasks)

# ---------------- MD-06 机会 ----------------
opps = [
    ("OPP-014", "GOAL-2026Q3-01", 3, "新客首单后 7 日内未再访问超市频道", "candidate", "人群：2026Q3 首次下单新客 ｜ 旅程环节：首单履约后 ~ 复购前", "约 38.2% 的新客在首单签收后 7 日内未再产生任何超市频道访问行为", "黄金眼流量数据（2026-09-16 取数，覆盖 7/1–9/15）", "该人群规模大（约 52 万），若访问缺失是复购低的前置原因，则是最直接的干预切入口", "无法判断是否转移到其他频道或站外；无用户级明细确认访问缺失的真实原因", None, "T-1022", "2026-09-16 00:00"),
    ("OPP-013", "GOAL-2026Q3-01", 3, "粮油调味新客复购显著低于乳品烘焙", "candidate", "人群：粮油调味新客 vs 乳品烘焙新客 ｜ 旅程环节：首单品类选择", "粮油调味新客 30 天复购率 15.2%，乳品烘焙 24.8%，差 9.6pp", "CDP 人群标签聚合（2026-09-14 快照）", "品类间差异明显，可能对应消耗周期或商品结构差异，值得作为人群比较的切入点", "消耗周期差异未验证；两品类新客的获客渠道结构是否可比尚未核对", None, "T-1022", "2026-09-15 00:00"),
    ("OPP-012", "GOAL-2026Q3-01", 3, "搜索进入的新客 30 天复购低于推荐位进入", "submitted", "人群：搜索结果页进入新客 vs 首页推荐位进入新客 ｜ 旅程环节：首单入口", "搜索进入新客复购率 18.4%，推荐位进入 26.1%，差 7.7pp", "黄金眼入口维度流量数据（2026-09-16 取数）", "入口差异可能对应不同的需求明确度与后续行为模式，适合检验候选行为", "两组人群的原始特征（消费力、品类偏好）是否可比尚未核对；先后关系待验证", None, "T-1022", "2026-09-16 00:00"),
    ("OPP-010", "GOAL-2026Q3-01", 3, "乳品烘焙新客中「家庭装」首单复购更高", "submitted", "人群：乳品烘焙新客，按首单是否家庭装 / 多件装分组 ｜ 旅程环节：首单商品选择", "首单购买家庭装的新客 30 天复购率 31.5%，非家庭装 22.9%", "商品中台规格数据 + CDP 成交聚合（2026-09-14）", "规格选择是可干预的商品侧变量，若成立可直接影响首单推荐策略", "家庭装用户可能本就是囤货型用户（自选择）；活动与权益干扰未完全排除", None, "T-1022", "2026-09-14 00:00"),
    ("OPP-011", "GOAL-2026Q3-01", 3, "新客券领取后未核销比例偏高", "deferred", "人群：领取新客券但未核销用户 ｜ 旅程环节：领券后 ~ 首单前", "新客券核销率仅 32.1%，约 87 万张券未核销", "营销中台发放核销记录（2026-09-13 取数）", "（暂不研究）核销率低本身不指向用户长期价值行为，且权益配置属 out of scope", "未核销原因（门槛 / 品类不适用 / 遗忘）无数据支撑", "经 PM 评估：该现象主要涉及权益配置，不属于候选行为研究范围；记录保留，条件变化或新证据后可再选", "T-1018", "2026-09-13 00:00"),
    ("OPP-009", "GOAL-2026Q3-01", 3, "个护清洁新客首单件单价偏低", "candidate", "人群：个护清洁新客 ｜ 旅程环节：首单下单", "个护清洁新客首单平均件单价 28.4 元，低于粮油（45.1 元）与乳品（39.7 元）", "CDP 成交聚合（2026-09-14 快照）", "件单价可能影响履约体验与后续复购意愿，但当前证据仅停留在现象层", "件单价与复购的关联未验证；可能纯粹由品类价格带决定，无研究价值", None, "T-1018", "2026-09-14 00:00"),
    ("OPP-006", "GOAL-2026Q2-01", 2, "粮油调味新客 90 天复购率低于乳品烘焙 12.4pp", "candidate", "人群：粮油调味新客 vs 乳品烘焙新客 ｜ 旅程环节：首单后 90 天内", "粮油调味新客 90 天复购率 21.3%，乳品烘焙 33.7%，差 12.4pp", "黄金眼品类流量与复购看板（2026-06-28 取数，覆盖 4/1–6/30）", "差距大于品类平均波动区间，可能对应消耗周期差异，值得作为品类对比的切入点", "未区分规格（家庭装 / 单件装）购买结构，无法排除商品结构带来的差异", None, "T-1008", "2026-06-28 00:00"),
    ("OPP-005", "GOAL-2026Q2-01", 2, "粮油新客首单集中在单件小规格，90 天内未形成补给需求", "deferred", "人群：粮油调味新客 ｜ 旅程环节：首单商品规格选择", "首单为单件小规格的新客占 68.4%，该人群 90 天复购率 17.9%", "商品中台规格标签 + CDP 成交聚合（2026-06-25 取数）", "规格结构可能是复购低的直接原因，且与商品运营策略相关", "无法判断规格选择是用户偏好还是价格带限制所致", "2026-07-02 复核：规格结构属长期商品策略，短期内无可干预手段，暂不研究；记录保留，条件变化或新证据后可再选", "T-1008", "2026-06-26 00:00"),
]
emit("opportunity", ["opportunity_id", "goal_id", "goal_version_no", "opportunity_title", "opportunity_status", "target_object", "phenomenon", "initial_basis_note", "research_reason", "unknown_item", "defer_reason", "producing_task_id", "created_at"], opps)

# ---------------- MD-07 研究 ----------------
research = [
    ("R-007", "OPP-012", "搜索进入的新客复购更低，是因为他们缺少「首单后二次找品」这一行为，还是因为入口本身带来了不同需求强度的人群？", "业务目标：提升京东超市新客 30 天复购率（GOAL-2026Q3-01 v3）｜研究问题：搜索进入新客复购更低，是行为差异还是人群结构差异", "研究范围：京东超市主站 APP 端，粮油调味 / 乳品烘焙 / 个护清洁三品类新客，2026-07-01 ~ 2026-09-15；方法：入口维度分组比较 + 候选行为时序核查 + 其他解释排查（活动 / 权益 / 商品结构）", "有二次找品行为的新客复购率 29.3%，无该行为 17.9%（差 11.4pp）；该差异在三个品类方向上一致，乳品烘焙方向最明显（31.0% vs 18.2%）", "① 观察到「行为与较好表现同时出现」不等于因果，本研究未做干预验证；② CDP 接口无用户级明细，行为时序为聚合推断；③ 活动参与明细缺失，「活动存在」不能推出「用户受影响」；④ 目标口径中「复购是否剔除退款订单」仍待业务方确认，可能影响分母。", "活动玩法配置、权益组合、预算与排期不在本研究结论范围内，需另行开展。", "done", "GOAL-2026Q3-01", 3, None, None, None, None, "2026-09-17 18:42", "2026-09-15 20:28"),
    ("R-006", "OPP-010", "首单购买「家庭装 / 多件装」是否是与新客长期价值相关的关键行为？", "业务目标：提升京东超市新客 30 天复购率｜研究问题：家庭装首单是否可作为候选 HVA", "范围：乳品烘焙品类新客，2026-07-01 ~ 2026-09-15；方法：按首单规格分组比较 + 其他解释排查", "剔除消费力标签差异后，规格带来的复购差异收窄至 2.1pp，且置信度不足", "① 分组为观察性分组，未做随机对照；② 消费力差异为主要替代解释且未排除；③ 商品中台无履约与消耗周期数据，无法验证「囤货后自然复购更慢」这一反向可能。", "家庭装的选品与铺货策略属商品运营范畴，不在本研究结论范围内。", "done", "GOAL-2026Q3-01", 3, None, None, None, "T-1021", "2026-09-16 15:10", "2026-09-15 20:28"),
]
emit("research", ["research_no", "opportunity_id", "research_question", "e1_goal_statement", "e2_scope_method", "e4_population_diff", "e6_limits", "out_of_scope_note", "research_status", "goal_id", "goal_version_no", "behavior_hypothesis", "population_limit", "parent_research_no", "start_task_id", "finished_at", "created_at"], research)

# ---------------- MD-08 关键发现 ----------------
findings = [
    ("F-001", "R-007", "搜索进入与推荐位进入的新客，在消费力标签、品类偏好上的分布基本一致，可比基础成立", "supported", "可比性仅在现有标签维度上成立，无用户级明细", 1),
    ("F-002", "R-007", "「首单后 7 日内二次找品」行为与 30 天复购存在稳定的先后关系：行为发生在复购之前", "supported", "CDP 仅提供聚合标签，行为精确到日的时序需 CDP 明细接口确认", 2),
    ("F-003", "R-007", "搜索进入人群的二次找品行为占比（24.1%）显著低于推荐位进入人群（38.6%）", "supported", "两组人群的获客渠道结构未完全对齐，可能残留混淆", 3),
    ("F-004", "R-007", "活动与权益对两组人群的覆盖基本一致，不构成主要替代解释", "supported", "活动报名系统仅有报名记录，无用户参与明细，「活动存在」不等于「用户参与」", 4),
    ("F-005", "R-006", "家庭装首单新客复购率 31.5% vs 非家庭装 22.9%，差 8.6pp", "supported", "分组非随机，自选择未排除", 1),
    ("F-006", "R-006", "两组人群在消费力标签上差异显著，家庭装组本身消费力更高", "supported", "可比基础不成立，行为作用受限", 2),
]
emit("research_finding", ["finding_id", "research_no", "finding_text", "support_flag", "limit_note", "order_no"], findings)

# ---------------- MD-09 候选行为 ----------------
cands = [
    ("CB-001", "R-007", "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）", "candidate_supported"),
    ("CB-002", "R-006", "首单购买家庭装 / 多件装", "not_supported"),
]
emit("candidate_behavior", ["candidate_id", "research_no", "behavior_name", "behavior_status"], cands)

# ---------------- MD-10 行为支持条目 ----------------
points = [
    ("BP-001", "CB-001", "support", "与后续复购存在稳定的先后关系（行为在前、复购在后）", 1),
    ("BP-002", "CB-001", "support", "有无该行为的人群复购差异达 11.4pp，且在三个品类方向一致", 2),
    ("BP-003", "CB-001", "support", "入口维度的人群原始特征可比，行为差异不是人群结构造成的", 3),
    ("BP-004", "CB-001", "unsupport", "CDP 无用户级明细，行为发生的精确时序未逐人核对", 1),
    ("BP-005", "CB-001", "unsupport", "两组人群获客渠道结构未完全对齐，残留混淆未排除", 2),
    ("BP-006", "CB-001", "unsupport", "未做完整人群对照实验，仍属观察性结论", 3),
    ("BP-007", "CB-002", "support", "原始分组下存在 8.6pp 的复购差异", 1),
    ("BP-008", "CB-002", "unsupport", "两组人群消费力标签本身差异显著，可比基础不成立", 1),
    ("BP-009", "CB-002", "unsupport", "剔除消费力后差异收窄至 2.1pp，不足以支持该行为为关键行为", 2),
    ("BP-010", "CB-002", "unsupport", "家庭装选择更可能是消费力与囤货偏好的结果，而非复购的原因", 3),
]
emit("behavior_point", ["point_id", "candidate_id", "point_type", "point_text", "order_no"], points)

# ---------------- MD-11 改善方向 ----------------
actions = [
    ("AC-001", "R-007", "搜索进入的超市新客", "首单履约后 7 日内缺少二次找品行为", "该行为与后续复购存在稳定先后关系且在三个品类方向一致，是值得干预的前置环节", 1),
    ("AC-002", "R-007", "乳品烘焙方向的新客", "复购差异最大（31.0% vs 18.2%）", "该方向行为差异最明显，作为首轮验证的优先人群", 2),
    ("AC-003", "R-007", "研究本身", "需补 CDP 用户级行为明细接口", "当前时序结论建立在聚合标签上，只有拿到明细才能确认先后关系", 3),
    ("AC-004", "R-006", "研究本身", "若继续验证，需先构造消费力可比的人群分组", "当前分组下任何结论都会被消费力差异污染", 1),
]
emit("improvement_action", ["action_id", "research_no", "target_for", "problem_what", "reason_why", "order_no"], actions)

# ---------------- MD-12 研究建议（原型无数据，留空） ----------------
emit("research_proposal", ["proposal_id", "opportunity_id", "goal_version_no", "research_question", "behavior_hypothesis", "population_limit", "idempotency_key", "submitted_at", "submitted_by", "triggered_task_id"], [])

# ---------------- MD-14 Skill 登记（Q-07 已决 2026-09-19：clue-scan→S-A1/discovery-agent、hva-five-checks→S-B1/hva-agent） ----------------
skills = [
    ("S-A1", "clue-scan", "线索扫描", "v1.0", "discovery-agent", 1),
    ("S-B1", "hva-five-checks", "HVA 五查", "v1.1", "hva-agent", 1),
]
emit("skill_registry", ["skill_no", "skill_code", "skill_name", "version", "bound_agent_code", "is_active"], skills)

# ---------------- PD-02 任务步骤（原型无步骤级数据，留空） ----------------
emit("task_step", ["step_id", "task_id", "step_no", "step_name", "step_state"], [])

# ---------------- PD-03 任务受阻 ----------------
blocks = [
    ("BL-001", "T-1020", "call_failed", "CDP 行为明细查询失败（接口超时，重试 3/3）", "等待 CDP 接口恢复（阻塞自 2026-09-16 10:02）", "2026-09-16 10:02", 0),
    ("BL-002", "T-1019", "source_unavailable", "HJE 权限未开通（受限返回）", "持续失败后停止（保留已完成部分，不自动重启）", "2026-08-02 02:10", 0),
]
emit("task_block", ["block_id", "task_id", "block_reason_code", "block_note", "resume_condition", "blocked_at", "is_resolved"], blocks)

# ---------------- PD-04 目标口径待补项（运行时产生，留空） ----------------
emit("goal_gap", ["gap_id", "goal_id", "goal_version_no", "rule_id", "target_field", "gap_text", "impact_note", "raised_at", "raised_by_task_id", "filled_value", "filled_at", "filled_by", "is_solved"], [])

# ---------------- PD-05 机会状态变更日志 ----------------
status_log = [
    ("LG-001", "OPP-011", "candidate", "deferred", "经 PM 评估：该现象主要涉及权益配置，不属于候选行为研究范围", "2026-09-13 10:00", "PM"),
    ("LG-002", "OPP-005", "candidate", "deferred", "2026-07-02 复核：规格结构属长期商品策略，短期内无可干预手段", "2026-07-02 10:00", "PM 复核"),
    ("LG-003", "OPP-012", "candidate", "submitted", "PM 提交研究建议（OPP-012）", "2026-09-16 10:00", "PM"),
    ("LG-004", "OPP-010", "candidate", "submitted", "PM 提交研究建议（OPP-010）", "2026-09-14 10:00", "PM"),
]
emit("opportunity_status_log", ["log_id", "opportunity_id", "from_status", "to_status", "change_reason", "changed_at", "changed_by"], status_log)

# ---------------- PD-06 上下文注入（运行时产生，留空） ----------------
emit("context_injection", ["injection_id", "task_id", "context_type_code", "ref_object_type", "ref_object_id", "injected_at"], [])

# ---------------- PD-07 追问消息 ----------------
followups = [
    ("MSG-001", "R-007", "T-1023", "pm", "乳品方向再补查一下：搜索进入和推荐位进入的人群，渠道结构（APP / 小程序）是不是一致的？如果不一致，前面的结论要打折。", "2026-09-18 09:11"),
    ("MSG-002", "R-007", "T-1023", "agent", "收到。已关联原研究 R-007 上下文，本轮作为新任务 T-1023 执行（原结果与依据保留）。\n\n已调度工具：CDP 用户标签系统 —— 查询「乳品烘焙新客 × 渠道分布」。\n返回：搜索进入人群中 APP 占 71.2%，推荐位进入人群中 APP 占 84.6%，两组差 13.4pp。\n\n这意味着：两组人群的渠道结构确实不一致，前面「人群可比」的结论需要限定适用范围——仅在 APP 端可比，跨渠道混合时残留混淆。", "2026-09-18 09:13"),
    ("MSG-003", "R-007", "T-1023", "agent", "继续调度：黄金眼 —— 查询乳品方向入口流量（2026-09-01 ~ 09-15），用于在 APP 端口径内重算差异。执行中。", "2026-09-18 09:14"),
]
emit("followup_message", ["message_id", "research_no", "task_id", "message_role", "message_text", "created_at"], followups)

# ---------------- LNK-01 机会↔证据 ----------------
opp_ev = [
    ("OPP-014", "EV-1041"), ("OPP-013", "EV-1038"), ("OPP-012", "EV-1041"), ("OPP-012", "EV-1038"),
    ("OPP-010", "EV-1035"), ("OPP-010", "EV-1031"), ("OPP-011", "EV-1031"), ("OPP-009", "EV-1038"),
    ("OPP-006", "EV-1024"), ("OPP-005", "EV-1022"),
]
# Q-16 已决（2026-09-20 方向①）：linked_at 取机会 created_at 真实时点，不再写 producing_task_id（任务 ID）
opp_created = {r[0]: r[12] for r in opps}
lnk_oe = []
for i, (oid, eid) in enumerate(opp_ev, 1):
    lnk_oe.append(("LK-OE-%03d" % i, oid, eid, "initial_basis", opp_created.get(oid, "2026-09-16 00:00")))
emit("opportunity_evidence", ["link_id", "opportunity_id", "evidence_id", "link_kind", "linked_at"], lnk_oe)

# ---------------- LNK-02 发现↔证据 ----------------
find_ev = [
    ("F-001", "EV-1038"), ("F-002", "EV-1038"), ("F-003", "EV-1038"), ("F-003", "EV-1041"),
    ("F-004", "EV-1027"), ("F-004", "EV-1031"), ("F-005", "EV-1035"), ("F-006", "EV-1038"),
]
lnk_fe = []
for i, (fid, eid) in enumerate(find_ev, 1):
    lnk_fe.append(("LK-FE-%03d" % i, fid, eid, "2026-09-17 18:42"))
emit("finding_evidence", ["link_id", "finding_id", "evidence_id", "linked_at"], lnk_fe)

# ---------------- LNK-03 机会↔机会 ----------------
lnk_or = [
    ("LK-OR-001", "OPP-014", "OPP-009", "superseded", "2026-09-16 04:35"),
    ("LK-OR-002", "OPP-009", "OPP-013", "same_issue", "2026-09-16 04:35"),
]
emit("opportunity_relation", ["relation_id", "from_opportunity_id", "to_opportunity_id", "relation_kind", "created_at"], lnk_or)

# ---------------- LNK-04 任务↔研究对象 ----------------
lnk_to = [
    ("LK-TO-001", "T-1022", "goal", "GOAL-2026Q3-01", "trigger", "2026-09-16 02:00"),
    ("LK-TO-002", "T-1022", "opportunity", "OPP-012", "output", "2026-09-16 04:35"),
    ("LK-TO-003", "T-1023", "opportunity", "OPP-012", "trigger", "2026-09-18 09:11"),
    ("LK-TO-004", "T-1023", "research", "R-007", "output", "2026-09-18 09:11"),
    ("LK-TO-005", "T-1021", "opportunity", "OPP-010", "trigger", "2026-09-15 20:28"),
    ("LK-TO-006", "T-1021", "research", "R-006", "output", "2026-09-16 15:10"),
    ("LK-TO-007", "T-1020", "opportunity", "OPP-009", "trigger", "2026-09-16 09:58"),
    ("LK-TO-008", "T-1019", "goal", "GOAL-2026Q3-01", "trigger", "2026-08-02 02:00"),
    ("LK-TO-009", "T-1018", "goal", "GOAL-2026Q3-01", "trigger", "2026-09-13 02:00"),
    ("LK-TO-010", "T-1018", "opportunity", "OPP-011", "output", "2026-09-13 03:20"),
    ("LK-TO-011", "T-1008", "goal", "GOAL-2026Q2-01", "trigger", "2026-06-28 02:00"),
    ("LK-TO-012", "T-1008", "opportunity", "OPP-006", "output", "2026-06-28 03:40"),
]
emit("task_object", ["link_id", "task_id", "object_type", "object_id", "link_role", "created_at"], lnk_to)

# ---------------- EXT-01 查询记录 ----------------
queries = [
    ("Q-90241", "T-1023", "CDP", "乳品烘焙新客 × 渠道(APP/小程序)", "2026-09-18 09:13", "ok", "成功 · 返回 3.2 万行聚合", 32000, None, 0, 0, None, "2026-09-18 09:13"),
    ("Q-90242", "T-1023", "HJE", "乳品方向入口流量，2026-09-01~09-15", "2026-09-18 09:14", "running", None, None, None, 0, 0, None, "2026-09-18 09:14"),
    ("Q-90217", "T-1022", "HJE", "入口维度新客复购", "2026-09-16 03:00", "ok", "成功", None, None, 0, 0, None, "2026-09-16 03:00"),
    ("Q-90188", "T-1022", "CDP", "二次找品行为占比", "2026-09-15 21:40", "ok", "成功", None, None, 0, 0, None, "2026-09-15 21:40"),
    ("Q-90116", "T-1021", "PIM", "乳品规格分布", "2026-09-15 21:02", "ok", "成功", None, None, 0, 0, None, "2026-09-15 21:02"),
    ("Q-90223", "T-1020", "CDP", "个护清洁新客行为明细", "2026-09-16 10:02", "fail", None, None, "接口超时（重试 3/3）", 3, 0, None, "2026-09-16 10:02"),
    ("Q-88010", "T-1019", "HJE", "全品类新客流量", "2026-08-02 02:10", "fail", None, None, "权限未开通（受限返回）", 0, 1, None, "2026-08-02 02:10"),
    ("Q-90074", "T-1018", "MKT", "新客券发放核销", "2026-09-13 15:20", "ok", "成功", None, None, 0, 0, None, "2026-09-13 15:20"),
    ("Q-88042", "T-1008", "HJE", "粮油 vs 乳品新客 90 天复购", "2026-06-28 03:00", "ok", "成功", None, None, 0, 0, None, "2026-06-28 03:00"),
    ("Q-88031", "T-1008", "PIM", "粮油规格分布", "2026-06-25 09:30", "ok", "成功", None, None, 0, 0, None, "2026-06-25 09:30"),
    ("Q-90012", "T-1018", "ACT", "活动时段内已报名活动清单", "2026-09-10 11:05", "ok", "共 37 个活动报名，覆盖 SKU 1.2 万个", None, None, 0, 0, None, "2026-09-10 11:05"),
]
emit("query_record", ["query_id", "task_id", "source_id", "query_condition", "queried_at", "result_status", "result_summary", "returned_rows", "fail_reason", "retry_count", "restricted_flag", "message_id", "created_at"], queries)

# ---------------- EXT-02 证据 ----------------
evidences = [
    ("EV-1041", "Q-90217", "HJE", "搜索进入 vs 推荐位进入的新客 30 天复购率", "入口类型 ∈ {搜索结果页, 首页推荐位}；品类 ∈ {粮油调味, 乳品烘焙, 个护清洁}；新客定义按目标 v3", "2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15", "仅京东超市主站 APP 端；不含小程序", "搜索进入新客复购率 18.4%，推荐位进入 26.1%，差 7.7pp（样本量 41.2 万 / 33.8 万）", "无用户级别明细，无法确认搜索进入用户后续是否改用其他入口", "2026-09-16 03:00"),
    ("EV-1038", "Q-90188", "CDP", "新客首单后 7 日内「二次找品」行为占比", "标签：new_customer_2026Q3 = true；行为窗口 = 首单后 0~7 日；行为 ∈ {搜索点击≥3 次, 加购未下单}", "2026-09-15 21:40 取数，标签快照 2026-09-14", "超市频道全量新客，APP + 小程序", "有二次找品行为的新客占 31.7%；该人群 30 天复购率 29.3% vs 无行为人群 17.9%", "CDP 仅提供标签聚合，无法取到行为发生的精确时序，先后关系待核", "2026-09-15 21:40"),
    ("EV-1035", "Q-90116", "PIM", "乳品烘焙品类中「家庭装 / 多件装」商品占比", "品类 = 乳品烘焙；包装规格标签 ∈ {家庭装, 多件装}；在架状态 = 在售", "2026-09-14 09:00 取数", "超市频道在售商品主数据", "家庭装 / 多件装 SKU 占该品类 22.6%，其首单成交占新客首单 34.1%", "商品中台不含用户购买记录，成交占比由 CDP 侧补查", "2026-09-14 09:00"),
    ("EV-1031", "Q-90074", "MKT", "新客券发放与核销情况", "券类型 = 新客专享券；发放窗口 2026-07-01 ~ 2026-09-15；领取人群 = 超市新客", "2026-09-13 15:20 取数", "超市频道新客，含 APP / 小程序", "发放 128.4 万张，核销 41.2 万张，核销率 32.1%；核销用户 30 天复购率 35.8%", "无法直接给出券对复购的增量效果——核销用户本身可能购买意愿更强（存在自选择）", "2026-09-13 15:20"),
    ("EV-1024", "Q-88042", "HJE", "粮油调味 vs 乳品烘焙新客 90 天复购率", "品类 ∈ {粮油调味, 乳品烘焙}；新客定义按目标 GOAL-2026Q2-01 v2；复购窗口 = 首单后 90 天", "2026-06-28 03:00 取数，覆盖 2026-04-01 ~ 2026-06-30", "京东超市主站 APP + 小程序；不含 618 大促（6/1–6/20）时段", "粮油调味新客 90 天复购率 21.3%，乳品烘焙 33.7%，差 12.4pp（样本量 28.6 万 / 31.1 万）", "仅有品类级聚合，无法确认同一用户的跨品类复购行为", "2026-06-28 03:00"),
    ("EV-1022", "Q-88031", "PIM", "粮油调味「单件小规格」商品成交占比", "品类 = 粮油调味；规格标签 ∈ {单件装, 小规格}；在架状态 = 在售", "2026-06-25 09:30 取数", "超市频道在售商品主数据", "单件小规格 SKU 占该品类 54.2%，其首单成交占粮油新客首单 68.4%", "商品中台不含用户购买记录，成交占比由 CDP 侧补查；无法判断规格选择动因", "2026-06-25 09:30"),
    ("EV-1027", "Q-90012", "ACT", "Q3 大促期间超市频道已报名活动清单", "活动时段 ∈ 2026-08-18 ~ 2026-08-20；频道 = 京东超市", "2026-09-10 11:05 取数（接口响应慢，重试 2 次后返回）", "仅已报名活动记录", "共 37 个活动报名，其中满减类 21 个、秒杀类 16 个；覆盖 SKU 1.2 万个", "系统只有报名信息，无用户参与明细；「活动存在」不等于「用户参与了」", "2026-09-10 11:05"),
]
emit("evidence", ["evidence_id", "query_id", "source_id", "evidence_title", "query_condition", "info_time_point", "applicability_scope", "result_summary", "missing_note", "created_at"], evidences)

# ---------------- EXT-03 外部验证（原型无数据，留空） ----------------
emit("external_validation", ["validation_id", "research_no", "conclusion", "source_ref", "validated_at", "created_at"], [])

def fk_topo_order():
    """按 0001_init.sql 的外键依赖做拓扑排序（自引用除外），确保父表先于子表输出。"""
    ddl_path = os.path.join(os.path.dirname(__file__), "..", "migrations", "0001_init.sql")
    conn = sqlite3.connect(":memory:")
    conn.executescript(open(ddl_path, encoding="utf-8").read())
    graph = {t: set() for t in EMITS}
    for t in list(graph):
        for row in conn.execute('PRAGMA foreign_key_list("%s")' % t):
            parent = row[2]
            if parent != t and parent in graph:
                graph[t].add(parent)
    indeg = {t: len(graph[t]) for t in graph}
    from collections import deque
    ready = deque([t for t in graph if indeg[t] == 0])
    order = []
    while ready:
        n = ready.popleft()
        order.append(n)
        for t in graph:
            if n in graph[t]:
                indeg[t] -= 1
                if indeg[t] == 0:
                    ready.append(t)
    if len(order) != len(graph):  # 仅自引用环，排在末尾
        order.extend(t for t in graph if t not in order)
    return order

with open(OUT, "w", encoding="utf-8") as f:
    body = []
    for t in fk_topo_order():
        body.extend(EMITS.get(t, []))
    f.write("\n".join(parts + body))

print("written:", OUT)
print("tables with rows:", sum(1 for sqls in EMITS.values() if any("INSERT INTO" in s for s in sqls)))
print("total bytes:", os.path.getsize(OUT))
