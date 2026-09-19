/* ============================================================
   原型共享 Mock 数据 · 全站唯一数据源
   上游：../../docs/01-brd/BRD.md（M2 共享上下文 F-07~F-12、M5 工具执行 F-23~F-26）
   口径：证据必须带来源、查询条件、信息时点、适用范围；
        HVA 研究完成前一律称「候选行为」。
   注意：本文件为原型期 mock，真实运行时数据应来自数据库接口。
   ============================================================ */

window.DB = (function () {
  /* ---------- F-08 可用来源与工具登记 ---------- */
  const sources = [
    { id: "CDP", name: "CDP 用户标签系统", can: "人群圈选、标签分布、人群规模", cannot: "完整用户行为序列（仅有标签与聚合结果）", status: "ok" },
    { id: "HJE", name: "黄金眼", can: "线上流量、坑位曝光点击、路径转化", cannot: "用户级别明细，仅到渠道/坑位聚合", status: "ok" },
    { id: "PIM", name: "商品中台", can: "超市商品主数据、品类归属、价格带", cannot: "商品实时库存与履约状态", status: "ok" },
    { id: "MKT", name: "营销中台", can: "权益发放与核销记录", cannot: "权益对复购的增量效果（需另行测算）", status: "ok" },
    { id: "ACT", name: "活动报名系统", can: "活动是否存在、活动时间与报名商品", cannot: "用户是否真正参与及受影响程度", status: "degraded" }
  ];

  /* ---------- F-01 研究目标（多目标 + 版本化） ----------
     列表按 seq 倒序展示：seq 1 为当前目标，其余为历史目标。
     每个目标自带六要素、材料与版本历史。 */
  const TODAY = "2026-09-18";

  const goalList = [
    {
      id: "GOAL-2026Q3-01",
      seq: 1,
      version: "v3",
      updatedAt: "2026-09-12 17:20",
      updatedBy: "超市事业部运营组 · 张运营",
      fields: {
        businessGoal: "提升京东超市新客 30 天复购率",
        metricDef: "新客 = 考察期内首次在京东超市下单的用户；30 天复购 = 首单后 30 个自然日内再次下单（≥1 单）",
        scope: "京东超市主站频道；品类限粮油调味、乳品烘焙、个护清洁",
        period: "2026-07-01 ~ 2026-09-15",
        constraints: "Q3 大促（8/18–8/20）期间流量结构偏移，该时段需单独观察，不与日常合并",
        provider: "超市事业部运营组 · 张运营"
      },
      // ⑥ 的材料部分：可增删，不再写死为文案
      materials: [
        { id: "MAT-02", name: "Q3 运营目标拆解表 v2", kind: "表格", at: "2026-09-10", from: "业务方提供" },
        { id: "MAT-01", name: "新客定义说明邮件（9/10）", kind: "邮件", at: "2026-09-10", from: "业务方提供" }
      ],
      versions: [
        { version: "v3", at: "2026-09-12 17:20", by: "张运营", change: "关注时段延长至 9/15；补充大促时段排除约束", impact: "影响 2 个在研研究（ST-007、ST-006）：新时段需补查黄金眼流量证据" },
        { version: "v2", at: "2026-08-25 10:05", by: "张运营", change: "品类范围由全品类收敛至 3 个品类", impact: "影响 1 个在研研究（ST-006）：原乳品外样本不再纳入" },
        { version: "v1", at: "2026-07-28 14:30", by: "张运营", change: "首次登记", impact: "—" }
      ]
    },
    {
      id: "GOAL-2026Q2-01",
      seq: 2,
      version: "v2",
      updatedAt: "2026-06-30 15:40",
      updatedBy: "超市事业部运营组 · 李运营",
      fields: {
        businessGoal: "提升粮油调味品类新客 90 天复购率",
        metricDef: "粮油调味新客 = 考察期内首次购买粮油调味类目的用户；90 天复购 = 首单后 90 个自然日内再次下单（已剔除退款与取消订单）",
        scope: "京东超市主站频道（APP + 小程序）；品类限粮油调味",
        period: "2026-04-01 ~ 2026-06-30",
        constraints: "618 大促（6/1–6/20）期间单独观察，不与日常合并",
        provider: "超市事业部运营组 · 李运营"
      },
      materials: [
        { id: "MAT-Q2-02", name: "Q2 粮油品类运营复盘", kind: "表格", at: "2026-06-28", from: "业务方提供" },
        { id: "MAT-Q2-01", name: "粮油消耗周期说明", kind: "文档", at: "2026-06-20", from: "业务方提供" }
      ],
      versions: [
        { version: "v2", at: "2026-06-30 15:40", by: "李运营", change: "复购窗口由 60 天延长至 90 天", impact: "影响 1 个已归档研究（ST-003）：需按 90 天窗口重算" },
        { version: "v1", at: "2026-04-02 09:15", by: "李运营", change: "首次登记", impact: "—" }
      ]
    },
    {
      id: "GOAL-2026Q1-01",
      seq: 3,
      version: "v1",
      updatedAt: "2026-03-05 11:20",
      updatedBy: "超市事业部运营组 · 王运营",
      fields: {
        businessGoal: "提升超市新客首单件单价",
        metricDef: "件单价 = 新客首次下单的订单金额 / 订单商品件数（已剔除退款与取消订单）；首次下单 = 考察期内首次在超市完成的成交订单",
        scope: "京东超市主站频道；按 APP / 小程序 / PC 分渠道统计，品类不限",
        period: "2026-01-01 ~ 2026-03-01",
        constraints: "年货节（1/17–2/5）期间单独观察",
        provider: "超市事业部运营组 · 王运营"
      },
      materials: [
        { id: "MAT-Q1-01", name: "Q1 新客结构分析", kind: "文档", at: "2026-03-01", from: "业务方提供" }
      ],
      versions: [
        { version: "v1", at: "2026-03-05 11:20", by: "王运营", change: "首次登记", impact: "—" }
      ]
    }
  ];

  const goals = {
    list: goalList,
    current: goalList[0],
    versions: goalList[0].versions // 兼容旧引用
  };

  /* ---------- 口径检查规则（Mock：替代后续后端判断） ----------
     真实运行时 checkGaps 应改为后端接口调用；此处按规则对六要素做关键词校验。
     solved 为业务方已确认补充的口径编号，命中即不再列为待补。 */
  const gapRules = [
    { id: "GAP-1", field: "metricDef", pattern: /退款|取消/, text: "复购口径是否剔除退款 / 取消订单", impact: "直接影响复购率分母与候选行为判定" },
    { id: "GAP-2", field: "metricDef", pattern: /跨品类|首次下单|首单定义/, text: "新客是否限定为「跨品类首单」，单品类首单是否计入", impact: "决定人群圈选条件与可比基础" },
    { id: "GAP-3", field: "scope", pattern: /APP|小程序|PC|渠道/, text: "是否区分 APP / 小程序 / PC 渠道分别统计", impact: "若不分渠道，行为差异可能被渠道结构掩盖" },
    { id: "GAP-4", field: "period", pattern: /\d{4}-\d{1,2}-\d{1,2}/, text: "关注时段未写明具体起止日期", impact: "取数窗口不确定，证据时点无法对齐" }
  ];

  const FIELD_NAME = {
    businessGoal: "① 业务目标", metricDef: "② 指标口径", scope: "③ 业务范围",
    period: "④ 关注时段", constraints: "⑤ 已知约束", provider: "⑥ 提供方与材料"
  };

  function checkGaps(fields, solved) {
    const f = fields || {};
    const done = solved || [];
    return gapRules
      .filter(function (r) { return done.indexOf(r.id) === -1 && !r.pattern.test(f[r.field] || ""); })
      .map(function (r) {
        return { id: r.id, field: r.field, text: r.text, impact: r.impact, raisedAt: TODAY };
      });
  }

  /* ---------- F-09 证据库（每条带来源/条件/时点/适用范围/缺失说明） ---------- */
  const evidences = {
    "EV-1041": {
      id: "EV-1041", sourceId: "HJE", sourceName: "黄金眼",
      title: "搜索进入 vs 推荐位进入的新客 30 天复购率",
      condition: "入口类型 ∈ {搜索结果页, 首页推荐位}；品类 ∈ {粮油调味, 乳品烘焙, 个护清洁}；新客定义按目标 v3",
      at: "2026-09-16 03:00 取数，覆盖 2026-07-01 ~ 2026-09-15",
      scope: "仅京东超市主站 APP 端；不含小程序",
      result: "搜索进入新客复购率 18.4%，推荐位进入 26.1%，差 7.7pp（样本量 41.2 万 / 33.8 万）",
      missing: "无用户级别明细，无法确认搜索进入用户后续是否改用其他入口",
      queryId: "Q-90217"
    },
    "EV-1038": {
      id: "EV-1038", sourceId: "CDP", sourceName: "CDP 用户标签系统",
      title: "新客首单后 7 日内「二次找品」行为占比",
      condition: "标签：new_customer_2026Q3 = true；行为窗口 = 首单后 0~7 日；行为 ∈ {搜索点击≥3 次, 加购未下单}",
      at: "2026-09-15 21:40 取数，标签快照 2026-09-14",
      scope: "超市频道全量新客，APP + 小程序",
      result: "有二次找品行为的新客占 31.7%；该人群 30 天复购率 29.3% vs 无行为人群 17.9%",
      missing: "CDP 仅提供标签聚合，无法取到行为发生的精确时序，先后关系待核",
      queryId: "Q-90188"
    },
    "EV-1035": {
      id: "EV-1035", sourceId: "PIM", sourceName: "商品中台",
      title: "乳品烘焙品类中「家庭装 / 多件装」商品占比",
      condition: "品类 = 乳品烘焙；包装规格标签 ∈ {家庭装, 多件装}；在架状态 = 在售",
      at: "2026-09-14 09:00 取数",
      scope: "超市频道在售商品主数据",
      result: "家庭装 / 多件装 SKU 占该品类 22.6%，其首单成交占新客首单 34.1%",
      missing: "商品中台不含用户购买记录，成交占比由 CDP 侧补查",
      queryId: "Q-90116"
    },
    "EV-1031": {
      id: "EV-1031", sourceId: "MKT", sourceName: "营销中台",
      title: "新客券发放与核销情况",
      condition: "券类型 = 新客专享券；发放窗口 2026-07-01 ~ 2026-09-15；领取人群 = 超市新客",
      at: "2026-09-13 15:20 取数",
      scope: "超市频道新客，含 APP / 小程序",
      result: "发放 128.4 万张，核销 41.2 万张，核销率 32.1%；核销用户 30 天复购率 35.8%",
      missing: "无法直接给出券对复购的增量效果——核销用户本身可能购买意愿更强（存在自选择）",
      queryId: "Q-90074"
    },
    "EV-1024": {
      id: "EV-1024", sourceId: "HJE", sourceName: "黄金眼",
      title: "粮油调味 vs 乳品烘焙新客 90 天复购率",
      condition: "品类 ∈ {粮油调味, 乳品烘焙}；新客定义按目标 GOAL-2026Q2-01 v2；复购窗口 = 首单后 90 天",
      at: "2026-06-28 03:00 取数，覆盖 2026-04-01 ~ 2026-06-30",
      scope: "京东超市主站 APP + 小程序；不含 618 大促（6/1–6/20）时段",
      result: "粮油调味新客 90 天复购率 21.3%，乳品烘焙 33.7%，差 12.4pp（样本量 28.6 万 / 31.1 万）",
      missing: "仅有品类级聚合，无法确认同一用户的跨品类复购行为",
      queryId: "Q-88042"
    },
    "EV-1022": {
      id: "EV-1022", sourceId: "PIM", sourceName: "商品中台",
      title: "粮油调味「单件小规格」商品成交占比",
      condition: "品类 = 粮油调味；规格标签 ∈ {单件装, 小规格}；在架状态 = 在售",
      at: "2026-06-25 09:30 取数",
      scope: "超市频道在售商品主数据",
      result: "单件小规格 SKU 占该品类 54.2%，其首单成交占粮油新客首单 68.4%",
      missing: "商品中台不含用户购买记录，成交占比由 CDP 侧补查；无法判断规格选择动因",
      queryId: "Q-88031"
    },
    "EV-1027": {
      id: "EV-1027", sourceId: "ACT", sourceName: "活动报名系统",
      title: "Q3 大促期间超市频道已报名活动清单",
      condition: "活动时段 ∈ 2026-08-18 ~ 2026-08-20；频道 = 京东超市",
      at: "2026-09-10 11:05 取数（接口响应慢，重试 2 次后返回）",
      scope: "仅已报名活动记录",
      result: "共 37 个活动报名，其中满减类 21 个、秒杀类 16 个；覆盖 SKU 1.2 万个",
      missing: "系统只有报名信息，无用户参与明细；「活动存在」不等于「用户参与了」",
      queryId: "Q-90012"
    }
  };

  /* ---------- F-10 机会记录（六要素 + 状态） ---------- */
  const opportunities = [
    {
      id: "OPP-014", title: "新客首单后 7 日内未再访问超市频道",
      status: "candidate", target: "GOAL-2026Q3-01 · v3",
      object: "人群：2026Q3 首次下单新客 ｜ 旅程环节：首单履约后 ~ 复购前",
      phenomenon: "约 38.2% 的新客在首单签收后 7 日内未再产生任何超市频道访问行为",
      basis: "黄金眼流量数据（2026-09-16 取数，覆盖 7/1–9/15）",
      reason: "该人群规模大（约 52 万），若访问缺失是复购低的前置原因，则是最直接的干预切入口",
      unknown: "无法判断是否转移到其他频道或站外；无用户级明细确认访问缺失的真实原因",
      evidences: ["EV-1041"], createdAt: "2026-09-16", fromTask: "T-1022"
    },
    {
      id: "OPP-013", title: "粮油调味新客复购显著低于乳品烘焙",
      status: "candidate", target: "GOAL-2026Q3-01 · v3",
      object: "人群：粮油调味新客 vs 乳品烘焙新客 ｜ 旅程环节：首单品类选择",
      phenomenon: "粮油调味新客 30 天复购率 15.2%，乳品烘焙 24.8%，差 9.6pp",
      basis: "CDP 人群标签聚合（2026-09-14 快照）",
      reason: "品类间差异明显，可能对应消耗周期或商品结构差异，值得作为人群比较的切入点",
      unknown: "消耗周期差异未验证；两品类新客的获客渠道结构是否可比尚未核对",
      evidences: ["EV-1038"], createdAt: "2026-09-15", fromTask: "T-1022"
    },
    {
      id: "OPP-012", title: "搜索进入的新客 30 天复购低于推荐位进入",
      status: "submitted", target: "GOAL-2026Q3-01 · v3",
      object: "人群：搜索结果页进入新客 vs 首页推荐位进入新客 ｜ 旅程环节：首单入口",
      phenomenon: "搜索进入新客复购率 18.4%，推荐位进入 26.1%，差 7.7pp",
      basis: "黄金眼入口维度流量数据（2026-09-16 取数）",
      reason: "入口差异可能对应不同的需求明确度与后续行为模式，适合检验候选行为",
      unknown: "两组人群的原始特征（消费力、品类偏好）是否可比尚未核对；先后关系待验证",
      evidences: ["EV-1041", "EV-1038"], createdAt: "2026-09-16", fromTask: "T-1022",
      studyId: "ST-007"
    },
    {
      id: "OPP-010", title: "乳品烘焙新客中「家庭装」首单复购更高",
      status: "submitted", target: "GOAL-2026Q3-01 · v3",
      object: "人群：乳品烘焙新客，按首单是否家庭装 / 多件装分组 ｜ 旅程环节：首单商品选择",
      phenomenon: "首单购买家庭装的新客 30 天复购率 31.5%，非家庭装 22.9%",
      basis: "商品中台规格数据 + CDP 成交聚合（2026-09-14）",
      reason: "规格选择是可干预的商品侧变量，若成立可直接影响首单推荐策略",
      unknown: "家庭装用户可能本就是囤货型用户（自选择）；活动与权益干扰未完全排除",
      evidences: ["EV-1035", "EV-1031"], createdAt: "2026-09-14", fromTask: "T-1022",
      studyId: "ST-006"
    },
    {
      id: "OPP-011", title: "新客券领取后未核销比例偏高",
      status: "deferred", target: "GOAL-2026Q3-01 · v3",
      object: "人群：领取新客券但未核销用户 ｜ 旅程环节：领券后 ~ 首单前",
      phenomenon: "新客券核销率仅 32.1%，约 87 万张券未核销",
      basis: "营销中台发放核销记录（2026-09-13 取数）",
      reason: "（暂不研究）核销率低本身不指向用户长期价值行为，且权益配置属 out of scope",
      unknown: "未核销原因（门槛 / 品类不适用 / 遗忘）无数据支撑",
      evidences: ["EV-1031"], createdAt: "2026-09-13", fromTask: "T-1018",
      deferReason: "经 PM 评估：该现象主要涉及权益配置，不属于候选行为研究范围；记录保留，条件变化或新证据后可再选"
    },
    {
      id: "OPP-009", title: "个护清洁新客首单件单价偏低",
      status: "candidate", target: "GOAL-2026Q3-01 · v3",
      object: "人群：个护清洁新客 ｜ 旅程环节：首单下单",
      phenomenon: "个护清洁新客首单平均件单价 28.4 元，低于粮油（45.1 元）与乳品（39.7 元）",
      basis: "CDP 成交聚合（2026-09-14 快照）",
      reason: "件单价可能影响履约体验与后续复购意愿，但当前证据仅停留在现象层",
      unknown: "件单价与复购的关联未验证；可能纯粹由品类价格带决定，无研究价值",
      evidences: ["EV-1038"], createdAt: "2026-09-14", fromTask: "T-1018"
    },

    /* ---- GOAL-2026Q2-01（粮油调味 90 天复购）下的机会，产出于发现任务 T-1008 ---- */
    {
      id: "OPP-006", title: "粮油调味新客 90 天复购率低于乳品烘焙 12.4pp",
      status: "candidate", target: "GOAL-2026Q2-01 · v2",
      object: "人群：粮油调味新客 vs 乳品烘焙新客 ｜ 旅程环节：首单后 90 天内",
      phenomenon: "粮油调味新客 90 天复购率 21.3%，乳品烘焙 33.7%，差 12.4pp",
      basis: "黄金眼品类流量与复购看板（2026-06-28 取数，覆盖 4/1–6/30）",
      reason: "差距大于品类平均波动区间，可能对应消耗周期差异，值得作为品类对比的切入点",
      unknown: "未区分规格（家庭装 / 单件装）购买结构，无法排除商品结构带来的差异",
      evidences: ["EV-1024"], createdAt: "2026-06-28", fromTask: "T-1008"
    },
    {
      id: "OPP-005", title: "粮油新客首单集中在单件小规格，90 天内未形成补给需求",
      status: "deferred", target: "GOAL-2026Q2-01 · v2",
      object: "人群：粮油调味新客 ｜ 旅程环节：首单商品规格选择",
      phenomenon: "首单为单件小规格的新客占 68.4%，该人群 90 天复购率 17.9%",
      basis: "商品中台规格标签 + CDP 成交聚合（2026-06-25 取数）",
      reason: "规格结构可能是复购低的直接原因，且与商品运营策略相关",
      unknown: "无法判断规格选择是用户偏好还是价格带限制所致",
      evidences: ["EV-1022"], createdAt: "2026-06-26", fromTask: "T-1008",
      deferReason: "2026-07-02 复核：规格结构属长期商品策略，短期内无可干预手段，暂不研究；记录保留，条件变化或新证据后可再选"
    }
  ];

  /* ---------- F-11 研究结果（ST-007 完整七要素 / ST-006 摘要） ---------- */
  const studies = {
    "ST-007": {
      id: "ST-007", oppId: "OPP-012", studyNo: "R-007",
      question: "搜索进入的新客复购更低，是因为他们缺少「首单后二次找品」这一行为，还是因为入口本身带来了不同需求强度的人群？",
      status: "done", finishedAt: "2026-09-17 18:42",
      // 七要素
      e1_goal: "业务目标：提升京东超市新客 30 天复购率（GOAL-2026Q3-01 v3）｜研究问题：搜索进入新客复购更低，是行为差异还是人群结构差异",
      e2_scope: "研究范围：京东超市主站 APP 端，粮油调味 / 乳品烘焙 / 个护清洁三品类新客，2026-07-01 ~ 2026-09-15；方法：入口维度分组比较 + 候选行为时序核查 + 其他解释排查（活动 / 权益 / 商品结构）",
      e3_findings: [
        {
          text: "搜索进入与推荐位进入的新客，在消费力标签、品类偏好上的分布基本一致，可比基础成立",
          support: "supported", evidences: ["EV-1038"], limit: "可比性仅在现有标签维度上成立，无用户级明细"
        },
        {
          text: "「首单后 7 日内二次找品」行为与 30 天复购存在稳定的先后关系：行为发生在复购之前",
          support: "supported", evidences: ["EV-1038"], limit: "CDP 仅提供聚合标签，行为精确到日的时序需 CDP 明细接口确认"
        },
        {
          text: "搜索进入人群的二次找品行为占比（24.1%）显著低于推荐位进入人群（38.6%）",
          support: "supported", evidences: ["EV-1038", "EV-1041"], limit: "两组人群的获客渠道结构未完全对齐，可能残留混淆"
        },
        {
          text: "活动与权益对两组人群的覆盖基本一致，不构成主要替代解释",
          support: "supported", evidences: ["EV-1027", "EV-1031"], limit: "活动报名系统仅有报名记录，无用户参与明细，「活动存在」不等于「用户参与」"
        }
      ],
      e4_diff: "有二次找品行为的新客复购率 29.3%，无该行为 17.9%（差 11.4pp）；该差异在三个品类方向上一致，乳品烘焙方向最明显（31.0% vs 18.2%）",
      e5_hva: {
        name: "首单后 7 日内二次找品（搜索点击≥3 次或加购未下单）",
        status: "candidate_supported",
        supported: ["与后续复购存在稳定的先后关系（行为在前、复购在后）", "有无该行为的人群复购差异达 11.4pp，且在三个品类方向一致", "入口维度的人群原始特征可比，行为差异不是人群结构造成的"],
        unsupported: ["CDP 无用户级明细，行为发生的精确时序未逐人核对", "两组人群获客渠道结构未完全对齐，残留混淆未排除", "未做完整人群对照实验，仍属观察性结论"]
      },
      e6_limits: "① 观察到「行为与较好表现同时出现」不等于因果，本研究未做干预验证；② CDP 接口无用户级明细，行为时序为聚合推断；③ 活动参与明细缺失，「活动存在」不能推出「用户受影响」；④ 目标口径中「复购是否剔除退款订单」仍待业务方确认，可能影响分母。",
      e7_actions: [
        { for: "搜索进入的超市新客", what: "首单履约后 7 日内缺少二次找品行为", why: "该行为与后续复购存在稳定先后关系且在三个品类方向一致，是值得干预的前置环节" },
        { for: "乳品烘焙方向的新客", what: "复购差异最大（31.0% vs 18.2%）", why: "该方向行为差异最明显，作为首轮验证的优先人群" },
        { for: "研究本身", what: "需补 CDP 用户级行为明细接口", why: "当前时序结论建立在聚合标签上，只有拿到明细才能确认先后关系" }
      ],
      outOfScopeNote: "活动玩法配置、权益组合、预算与排期不在本研究结论范围内，需另行开展。"
    },
    "ST-006": {
      id: "ST-006", oppId: "OPP-010", studyNo: "R-006",
      question: "首单购买「家庭装 / 多件装」是否是与新客长期价值相关的关键行为？",
      status: "done", finishedAt: "2026-09-16 15:10",
      e1_goal: "业务目标：提升京东超市新客 30 天复购率｜研究问题：家庭装首单是否可作为候选 HVA",
      e2_scope: "范围：乳品烘焙品类新客，2026-07-01 ~ 2026-09-15；方法：按首单规格分组比较 + 其他解释排查",
      e3_findings: [
        { text: "家庭装首单新客复购率 31.5% vs 非家庭装 22.9%，差 8.6pp", support: "supported", evidences: ["EV-1035"], limit: "分组非随机，自选择未排除" },
        { text: "两组人群在消费力标签上差异显著，家庭装组本身消费力更高", support: "supported", evidences: ["EV-1038"], limit: "可比基础不成立，行为作用受限" }
      ],
      e4_diff: "剔除消费力标签差异后，规格带来的复购差异收窄至 2.1pp，且置信度不足",
      e5_hva: {
        name: "首单购买家庭装 / 多件装",
        status: "not_supported",
        supported: ["原始分组下存在 8.6pp 的复购差异"],
        unsupported: ["两组人群消费力标签本身差异显著，可比基础不成立", "剔除消费力后差异收窄至 2.1pp，不足以支持该行为为关键行为", "家庭装选择更可能是消费力与囤货偏好的结果，而非复购的原因"]
      },
      e6_limits: "① 分组为观察性分组，未做随机对照；② 消费力差异为主要替代解释且未排除；③ 商品中台无履约与消耗周期数据，无法验证「囤货后自然复购更慢」这一反向可能。",
      e7_actions: [
        { for: "研究本身", what: "若继续验证，需先构造消费力可比的人群分组", why: "当前分组下任何结论都会被消费力差异污染" }
      ],
      outOfScopeNote: "家庭装的选品与铺货策略属商品运营范畴，不在本研究结论范围内。"
    }
  };

  /* ---------- F-06 任务记录与状态机 ---------- */
  const tasks = [
    {
      id: "T-1023", type: "HVA 研究", ref: "ST-007 · 追问（F-22）", stage: "M4",
      status: "running", startedAt: "2026-09-18 09:12",
      trigger: "PM 于 2026-09-18 09:11 在 R-007 上提交追问：「乳品方向补查渠道结构」",
      agentVersion: "hva-agent v1.3 / agent.md r12 / skills: hva-five-checks v1.1",
      queries: [
        { id: "Q-90241", src: "CDP", cond: "乳品烘焙新客 × 渠道(APP/小程序)", at: "2026-09-18 09:13", result: "成功 · 返回 3.2 万行聚合", status: "ok" },
        { id: "Q-90242", src: "HJE", cond: "乳品方向入口流量，2026-09-01~09-15", at: "2026-09-18 09:14", result: "执行中", status: "running" }
      ],
      done: "已注入原研究 R-007 上下文；已完成第 1 项查询",
      blockedBy: null, progress: "2 / 5 步"
    },
    {
      id: "T-1022", type: "机会发现", ref: "GOAL-2026Q3-01 v3", stage: "M3",
      status: "done", startedAt: "2026-09-16 02:00", endedAt: "2026-09-16 04:35",
      trigger: "按运行频率（每日 02:00）自动创建发现任务",
      agentVersion: "discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0",
      queries: [
        { id: "Q-90217", src: "HJE", cond: "入口维度新客复购", at: "2026-09-16 03:00", result: "成功", status: "ok" },
        { id: "Q-90188", src: "CDP", cond: "二次找品行为占比", at: "2026-09-15 21:40", result: "成功", status: "ok" }
      ],
      done: "产出 3 条新机会（OPP-012 / OPP-013 / OPP-014），1 条关联更新（OPP-009）",
      blockedBy: null, progress: "5 / 5 步"
    },
    {
      id: "T-1021", type: "HVA 研究", ref: "ST-006", stage: "M4",
      status: "done", startedAt: "2026-09-15 20:30", endedAt: "2026-09-16 15:10",
      trigger: "PM 于 2026-09-15 20:28 提交研究建议（OPP-010）",
      agentVersion: "hva-agent v1.2 / agent.md r11",
      queries: [
        { id: "Q-90116", src: "PIM", cond: "乳品规格分布", at: "2026-09-15 21:02", result: "成功", status: "ok" }
      ],
      done: "形成研究结果 R-006：未支持「家庭装首单」为候选 HVA",
      blockedBy: null, progress: "5 / 5 步"
    },
    {
      id: "T-1020", type: "HVA 研究", ref: "ST-005（OPP-009 方向）", stage: "M4",
      status: "blocked", startedAt: "2026-09-16 10:00",
      trigger: "PM 于 2026-09-16 09:58 提交研究建议（OPP-009）",
      agentVersion: "hva-agent v1.3 / agent.md r12",
      queries: [
        { id: "Q-90223", src: "CDP", cond: "个护清洁新客行为明细", at: "2026-09-16 10:02", result: "失败 · 接口超时（重试 3/3）", status: "fail" }
      ],
      done: "已保存启动依据与首次查询记录；CDP 行为明细查询失败，已完成部分保留待续",
      blockedReason: "查询或服务调用失败", // 对应 F-06 任务受阻处理矩阵「情况」列
      blockedBy: "等待 CDP 接口恢复（阻塞自 2026-09-16 10:02）", progress: "1 / 5 步"
    },
    {
      id: "T-1019", type: "机会发现", ref: "GOAL-2026Q3-01 v1", stage: "M3",
      status: "stopped",
      blockedReason: "来源未接入或权限不足", // 对应 F-06 任务受阻处理矩阵「情况」列（权限未开通）
      startedAt: "2026-08-02 02:00", endedAt: "2026-08-02 02:47",
      trigger: "按运行频率自动创建",
      agentVersion: "discovery-agent v1.0 / agent.md r5",
      queries: [
        { id: "Q-88010", src: "HJE", cond: "全品类新客流量", at: "2026-08-02 02:10", result: "失败 · 权限未开通（受限返回）", status: "fail" }
      ],
      done: "已形成的范围说明与信息缺口已保存，可后续重跑",
      blockedBy: "持续失败后停止（保留已完成部分，不自动重启）", progress: "2 / 5 步"
    },
    {
      id: "T-1018", type: "机会发现", ref: "GOAL-2026Q3-01 v2", stage: "M3",
      status: "done", startedAt: "2026-09-13 02:00", endedAt: "2026-09-13 03:20",
      trigger: "按运行频率自动创建",
      agentVersion: "discovery-agent v1.2 / agent.md r9",
      queries: [
        { id: "Q-90074", src: "MKT", cond: "新客券发放核销", at: "2026-09-13 15:20", result: "成功", status: "ok" }
      ],
      done: "产出 OPP-011、OPP-009",
      blockedBy: null, progress: "5 / 5 步"
    },
    {
      id: "T-1008", type: "机会发现", ref: "GOAL-2026Q2-01 v2", stage: "M3",
      status: "done", startedAt: "2026-06-28 02:00", endedAt: "2026-06-28 03:40",
      trigger: "按运行频率自动创建",
      agentVersion: "discovery-agent v1.1 / agent.md r7",
      queries: [
        { id: "Q-88042", src: "HJE", cond: "粮油 vs 乳品新客 90 天复购", at: "2026-06-28 03:00", result: "成功", status: "ok" },
        { id: "Q-88031", src: "PIM", cond: "粮油规格分布", at: "2026-06-25 09:30", result: "成功", status: "ok" }
      ],
      done: "产出 OPP-006、OPP-005",
      blockedBy: null, progress: "5 / 5 步"
    }
  ];

  /* 任务归属的目标配置（用于 F-32 任务与状态页按「当前生效目标配置」过滤）
     机会发现类任务：ref 直接含目标 ID；HVA 研究 / 追问类：按所研究机会反推目标 */
  const TASK_GOAL = {
    "T-1023": "GOAL-2026Q3-01", // ST-007 追问 → OPP-012
    "T-1022": "GOAL-2026Q3-01", // 机会发现 GOAL-2026Q3-01 v3
    "T-1021": "GOAL-2026Q3-01", // ST-006 → OPP-010
    "T-1020": "GOAL-2026Q3-01", // ST-005 → OPP-009
    "T-1019": "GOAL-2026Q3-01", // 机会发现 GOAL-2026Q3-01 v1
    "T-1018": "GOAL-2026Q3-01", // 机会发现 GOAL-2026Q3-01 v2
    "T-1008": "GOAL-2026Q2-01"  // 机会发现 GOAL-2026Q2-01 v2
  };
  tasks.forEach(function (t) { if (!t.goal) t.goal = TASK_GOAL[t.id] || "GOAL-2026Q3-01"; });

  /* ---------- F-31 追问对话（ST-007 上的追问） ---------- */
  const followups = {
    "ST-007": [
      { role: "pm", at: "2026-09-18 09:11", text: "乳品方向再补查一下：搜索进入和推荐位进入的人群，渠道结构（APP / 小程序）是不是一致的？如果不一致，前面的结论要打折。" },
      { role: "agent", at: "2026-09-18 09:13", text: "收到。已关联原研究 R-007 上下文，本轮作为新任务 T-1023 执行（原结果与依据保留）。\n\n已调度工具：CDP 用户标签系统 —— 查询「乳品烘焙新客 × 渠道分布」。\n返回：搜索进入人群中 APP 占 71.2%，推荐位进入人群中 APP 占 84.6%，两组差 13.4pp。\n\n这意味着：两组人群的渠道结构确实不一致，前面「人群可比」的结论需要限定适用范围——仅在 APP 端可比，跨渠道混合时残留混淆。", queries: [{ id: "Q-90241", src: "CDP", status: "ok" }] },
      { role: "agent", at: "2026-09-18 09:14", text: "继续调度：黄金眼 —— 查询乳品方向入口流量（2026-09-01 ~ 09-15），用于在 APP 端口径内重算差异。执行中。", queries: [{ id: "Q-90242", src: "HJE", status: "running" }] }
    ]
  };

  /* ---------- 默认展示的目标配置 ----------
     机会列表默认呈现哪套目标下产出的机会；
     这里按最近一次成功的机会发现任务反推默认目标与机会数。 */
  function goalOppCount(goalId) {
    return opportunities.filter(function (o) {
      return (o.target || "").indexOf(goalId) === 0;
    }).length;
  }
  function lastDiscoveryTask(goalId) {
    return tasks.filter(function (t) {
      return t.type === "机会发现" && t.status === "done" && (t.ref || "").indexOf(goalId) === 0;
    })[0] || null;
  }
  function appliedOf(goalId) {
    const t = lastDiscoveryTask(goalId);
    if (!t) return null;
    const m = /v(\d+)/.exec(t.ref || "");
    return {
      goalId: goalId,
      version: m ? "v" + m[1] : "",
      taskId: t.id,
      at: (t.startedAt || "").slice(0, 10),
      count: goalOppCount(goalId)
    };
  }
  const applied = { goalId: "GOAL-2026Q3-01", record: appliedOf("GOAL-2026Q3-01") };

  return {
    sources, goals, gapRules, checkGaps, FIELD_NAME,
    evidences, opportunities, studies, tasks, followups,
    applied, appliedOf, goalOppCount
  };
})();
