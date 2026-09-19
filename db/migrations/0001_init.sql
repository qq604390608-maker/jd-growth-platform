-- ============================================================
-- 0001_init.sql · 用户增长机会挖掘平台 · 建表迁移（白盒，一表一建）
-- 依据：docs/03-locks/schema.md v1.3（2026-09-19，最终锁定版）
-- 方言：Cloudflare D1（SQLite）。详见 schema.md §12 Q-02 / tech-stack.md §3。
--   类型映射：datetime → TEXT(ISO8601, 本库用 'YYYY-MM-DD HH:MM')；
--             tinyint/bigint/int → INTEGER（0/1 标志用 INTEGER）；
--             varchar(n) 仅作文档声明，D1 不强制长度（TS-11 仍待裁决，首版暂不写库级长度 CHECK；若日后裁决库级 CHECK 须补迁移）。
--   约束：MD/PD/CFG 之间一律真实外键（§11，D1 默认强制）。
--         Q-05 裁决：MD-06 六要素 NOT NULL + CHECK(length(trim(x))>0) 拒空串。
--   本文件不承担业务数据；种子见 ../seed/0001_mock.sql。
-- ============================================================

PRAGMA foreign_keys = ON;

-- ---------- 维度三 · 配置数据（CFG）先建无依赖项 ----------

-- CFG-07 字典类型（全库值域登记处）
CREATE TABLE dict_type (
    dict_type_code TEXT    NOT NULL PRIMARY KEY,          -- 字段里 dict:XXX 引用的就是它
    dict_type_name TEXT    NOT NULL,
    used_by_field   TEXT    NOT NULL,
    UNIQUE (dict_type_name)
);

-- CFG-08 字典项（取值明细，中文口径写在这里）
CREATE TABLE dict_item (
    dict_item_id    TEXT    NOT NULL PRIMARY KEY,
    dict_type_code  TEXT    NOT NULL REFERENCES dict_type(dict_type_code),
    item_code       TEXT    NOT NULL,                       -- 库内实际存储值
    item_name       TEXT    NOT NULL,                       -- 中文口径
    order_no        INTEGER NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,            -- 0/1
    UNIQUE (dict_type_code, item_code)
);

-- CFG-01 外部来源登记
CREATE TABLE source_registry (
    source_id         TEXT    NOT NULL PRIMARY KEY,         -- dict:SOURCE_CODE (CDP/HJE/PIM/MKT/ACT)
    source_name       TEXT    NOT NULL,
    capability_can    TEXT    NOT NULL,
    capability_cannot TEXT    NOT NULL,
    availability_status TEXT  NOT NULL,                     -- dict:SOURCE_STATUS
    is_mcp_ready      INTEGER NOT NULL DEFAULT 0,           -- 0/1
    registered_at     TEXT    NOT NULL,
    updated_at        TEXT    NOT NULL
);

-- CFG-02 工具注册（MCP 工具）
CREATE TABLE tool_registry (
    tool_id      TEXT    NOT NULL PRIMARY KEY,              -- TOL-01..12
    tool_code    TEXT    NOT NULL,                          -- MCP 工具名
    tool_name    TEXT    NOT NULL,
    source_id    TEXT    NOT NULL REFERENCES source_registry(source_id),
    tool_purpose TEXT    NOT NULL,
    call_condition TEXT   NOT NULL,
    is_enabled   INTEGER NOT NULL DEFAULT 0,               -- 0/1
    UNIQUE (tool_code)
);

-- CFG-03 工具权限与调用条件
CREATE TABLE tool_permission (
    permission_id   TEXT    NOT NULL PRIMARY KEY,
    grantee_type    TEXT    NOT NULL,                       -- dict:GRANTEE_TYPE
    grantee_ref     TEXT    NOT NULL,                       -- agent_code 或 task_type
    tool_id         TEXT    NOT NULL REFERENCES tool_registry(tool_id),
    allow_flag      INTEGER NOT NULL,                       -- 0/1，与不允许互斥
    restrict_reason TEXT,                                   -- 不允许时填
    effective_from  TEXT    NOT NULL,
    effective_until TEXT                                     -- 长期为空
);

-- CFG-04 运行策略
CREATE TABLE run_policy (
    policy_id       TEXT    NOT NULL PRIMARY KEY,
    policy_scope    TEXT    NOT NULL,                       -- dict:POLICY_SCOPE
    goal_id         TEXT    REFERENCES research_goal(goal_id), -- 目标级策略；平台级为空
    run_frequency   TEXT    NOT NULL,
    max_duration_min INTEGER,                               -- 不限为空
    call_limit      INTEGER,                                -- 不限为空
    retry_limit     INTEGER NOT NULL,                       -- ≥0
    is_active       INTEGER NOT NULL DEFAULT 1              -- 0/1
);

-- CFG-05 口径检查规则
CREATE TABLE gap_rule (
    rule_id      TEXT    NOT NULL PRIMARY KEY,               -- GAP-1..
    target_field TEXT    NOT NULL,                          -- dict:GOAL_FIELD
    match_pattern TEXT   NOT NULL,
    gap_text     TEXT    NOT NULL,
    impact_note  TEXT    NOT NULL,
    is_active    INTEGER NOT NULL DEFAULT 1                 -- 0/1
);

-- CFG-06 上下文注入模板
CREATE TABLE context_template (
    template_id       TEXT    NOT NULL PRIMARY KEY,
    task_type         TEXT    NOT NULL,                     -- dict:TASK_TYPE
    context_type_code TEXT    NOT NULL,                     -- dict:CONTEXT_TYPE
    order_no          INTEGER NOT NULL,
    is_required       INTEGER NOT NULL DEFAULT 1,           -- 0/1
    UNIQUE (task_type, context_type_code)
);

-- ---------- 维度一 · 主数据（MD，先建 research_goal） ----------

-- MD-01 研究目标身份
CREATE TABLE research_goal (
    goal_id            TEXT    NOT NULL PRIMARY KEY,         -- GOAL-2026Q3-01
    goal_seq           INTEGER NOT NULL,                     -- 展示序号，UK
    current_version_no INTEGER NOT NULL,                     -- ≥1，FK 逻辑指向 MD-02
    goal_status        TEXT    NOT NULL,                     -- dict:GOAL_STATUS
    created_at         TEXT    NOT NULL,
    created_by         TEXT    NOT NULL,
    UNIQUE (goal_seq)
);

-- MD-13 Agent 角色指令（agent_code 需 UNIQUE 以承载 MD-14 外键）
CREATE TABLE agent_profile (
    profile_id      TEXT    NOT NULL PRIMARY KEY,            -- AGP-DISC / AGP-HVA
    agent_code      TEXT    NOT NULL UNIQUE,                 -- discovery-agent / hva-agent
    agent_name      TEXT    NOT NULL,
    agent_stage     TEXT    NOT NULL,                        -- M3 / M4
    current_version TEXT    NOT NULL,
    doc_revision    TEXT    NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1              -- 0/1
);

-- MD-02 目标版本（六要素快照）
CREATE TABLE research_goal_version (
    goal_version_id TEXT    NOT NULL PRIMARY KEY,            -- goal_id + '-v' + version_no
    goal_id         TEXT    NOT NULL REFERENCES research_goal(goal_id),
    version_no      INTEGER NOT NULL,                        -- v1/v2/v3
    business_goal   TEXT    NOT NULL,
    metric_definition TEXT  NOT NULL,
    business_scope  TEXT    NOT NULL,
    focus_period    TEXT    NOT NULL,
    known_constraints TEXT  NOT NULL,
    provider        TEXT    NOT NULL,
    change_note     TEXT    NOT NULL,
    impact_note     TEXT    NOT NULL,
    is_applied      INTEGER NOT NULL DEFAULT 0,             -- 0/1，同 goal_id 至多一行 1
    applied_at      TEXT,                                    -- 未应用为空
    created_at      TEXT    NOT NULL,
    created_by      TEXT    NOT NULL,
    UNIQUE (goal_id, version_no)
);

-- MD-03 目标材料
CREATE TABLE goal_material (
    material_id   TEXT    NOT NULL PRIMARY KEY,              -- MAT-01 / MAT-02
    goal_id       TEXT    NOT NULL REFERENCES research_goal(goal_id),
    material_name TEXT    NOT NULL,
    material_kind TEXT    NOT NULL,                          -- dict:MATERIAL_KIND
    material_at   TEXT    NOT NULL,
    material_from TEXT    NOT NULL,                          -- dict:MATERIAL_FROM
    is_active     INTEGER NOT NULL DEFAULT 1,               -- 0/1
    registered_at TEXT    NOT NULL
);

-- MD-04 业务背景
CREATE TABLE business_context (
    context_id   TEXT    NOT NULL PRIMARY KEY,
    goal_id      TEXT    REFERENCES research_goal(goal_id),  -- 平台级通用背景为空
    context_kind TEXT    NOT NULL,                           -- dict:CONTEXT_KIND
    title        TEXT    NOT NULL,
    content      TEXT    NOT NULL,
    source_ref   TEXT    NOT NULL,
    is_active    INTEGER NOT NULL DEFAULT 1,                -- 0/1
    created_at   TEXT    NOT NULL
);

-- MD-05 触点清单
CREATE TABLE touchpoint (
    touchpoint_id   TEXT    NOT NULL PRIMARY KEY,
    touchpoint_name TEXT    NOT NULL,
    channel         TEXT    NOT NULL,
    position_desc   TEXT    NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,             -- 0/1
    created_at      TEXT    NOT NULL,
    UNIQUE (touchpoint_name)
);

-- ---------- 维度二 · 过程数据（PD-01 先于机会/研究） ----------

-- PD-01 任务
CREATE TABLE task (
    task_id               TEXT    NOT NULL PRIMARY KEY,      -- T-1023
    task_type             TEXT    NOT NULL,                  -- dict:TASK_TYPE
    task_stage            TEXT    NOT NULL,                  -- M1/M3/M4
    goal_id               TEXT    NOT NULL REFERENCES research_goal(goal_id),
    goal_version_no       INTEGER NOT NULL,                   -- 启动采用版本号快照
    task_status           TEXT    NOT NULL,                  -- dict:TASK_STATUS
    trigger_basis         TEXT    NOT NULL,
    agent_profile_id      TEXT    REFERENCES agent_profile(profile_id),
    agent_version_snapshot TEXT  NOT NULL,
    progress_text         TEXT    NOT NULL,
    done_part             TEXT    NOT NULL,
    started_at            TEXT    NOT NULL,
    ended_at              TEXT,                               -- 进行中为空
    parent_task_id        TEXT    REFERENCES task(task_id),  -- 追问/重跑
    retry_count           INTEGER NOT NULL DEFAULT 0,        -- ≥0
    is_auto_restart       INTEGER NOT NULL DEFAULT 0,        -- 固定 0
    created_at            TEXT    NOT NULL
);

-- MD-06 机会记录（Q-05 六要素必填：NOT NULL + CHECK 拒空串）
CREATE TABLE opportunity (
    opportunity_id     TEXT    NOT NULL PRIMARY KEY,          -- OPP-014
    goal_id            TEXT    NOT NULL
                        REFERENCES research_goal(goal_id)
                        CHECK (length(trim(goal_id)) > 0),    -- 六要素·对应目标
    goal_version_no    INTEGER NOT NULL CHECK (goal_version_no >= 1), -- 六要素·版本
    opportunity_title  TEXT    NOT NULL,
    opportunity_status TEXT   NOT NULL,                      -- dict:OPP_STATUS
    target_object      TEXT    NOT NULL
                        CHECK (length(trim(target_object)) > 0),  -- 六要素·涉及对象
    phenomenon         TEXT    NOT NULL
                        CHECK (length(trim(phenomenon)) > 0),     -- 六要素·观察现象
    initial_basis_note TEXT   NOT NULL
                        CHECK (length(trim(initial_basis_note)) > 0), -- 六要素·初步依据
    research_reason    TEXT    NOT NULL
                        CHECK (length(trim(research_reason)) > 0),    -- 六要素·研究理由
    unknown_item       TEXT,                                  -- 六要素·未知项（二态）：NULL=未评估，''=确无，文本=有未知项
    defer_reason       TEXT,                                  -- 仅 deferred 时填
    producing_task_id  TEXT    REFERENCES task(task_id),
    created_at         TEXT    NOT NULL
);

-- MD-07 研究
CREATE TABLE research (
    research_no          TEXT    NOT NULL PRIMARY KEY,         -- R-007
    opportunity_id       TEXT    NOT NULL REFERENCES opportunity(opportunity_id),
    research_question    TEXT    NOT NULL,
    e1_goal_statement    TEXT    NOT NULL,
    e2_scope_method      TEXT    NOT NULL,
    e4_population_diff   TEXT    NOT NULL,
    e6_limits            TEXT    NOT NULL,
    out_of_scope_note    TEXT    NOT NULL,
    research_status      TEXT    NOT NULL,                    -- dict:RESEARCH_STATUS
    goal_id              TEXT    NOT NULL REFERENCES research_goal(goal_id), -- 启动快照
    goal_version_no      INTEGER NOT NULL,                    -- 逻辑关联 MD-02
    behavior_hypothesis  TEXT,                                -- 可选
    population_limit     TEXT,                                -- 可选
    parent_research_no   TEXT    REFERENCES research(research_no), -- 追问链
    start_task_id        TEXT    REFERENCES task(task_id),
    finished_at          TEXT,                                -- 未完成为空
    created_at           TEXT    NOT NULL
);

-- MD-08 关键发现
CREATE TABLE research_finding (
    finding_id   TEXT    NOT NULL PRIMARY KEY,
    research_no  TEXT    NOT NULL REFERENCES research(research_no),
    finding_text TEXT    NOT NULL,
    support_flag TEXT    NOT NULL,                            -- dict:FINDING_SUPPORT
    limit_note   TEXT    NOT NULL,
    order_no     INTEGER NOT NULL,
    UNIQUE (research_no, order_no)
);

-- MD-09 候选行为
CREATE TABLE candidate_behavior (
    candidate_id    TEXT    NOT NULL PRIMARY KEY,
    research_no     TEXT    NOT NULL REFERENCES research(research_no),
    behavior_name   TEXT    NOT NULL,
    behavior_status TEXT    NOT NULL                           -- dict:BEHAVIOR_STATUS
);

-- MD-10 候选行为支持情况条目
CREATE TABLE behavior_point (
    point_id     TEXT    NOT NULL PRIMARY KEY,
    candidate_id TEXT    NOT NULL REFERENCES candidate_behavior(candidate_id),
    point_type   TEXT    NOT NULL,                            -- dict:BEHAVIOR_POINT_TYPE
    point_text   TEXT    NOT NULL,
    order_no     INTEGER NOT NULL,
    UNIQUE (candidate_id, point_type, order_no)
);

-- MD-11 改善方向
CREATE TABLE improvement_action (
    action_id    TEXT    NOT NULL PRIMARY KEY,
    research_no  TEXT    NOT NULL REFERENCES research(research_no),
    target_for   TEXT    NOT NULL,
    problem_what TEXT    NOT NULL,
    reason_why   TEXT    NOT NULL,
    order_no     INTEGER NOT NULL,
    UNIQUE (research_no, order_no)
);

-- MD-12 研究建议（幂等键）
CREATE TABLE research_proposal (
    proposal_id       TEXT    NOT NULL PRIMARY KEY,
    opportunity_id    TEXT    NOT NULL REFERENCES opportunity(opportunity_id),
    goal_version_no   INTEGER NOT NULL,
    research_question TEXT   NOT NULL,
    behavior_hypothesis TEXT,                                 -- 可选
    population_limit  TEXT,                                   -- 可选
    idempotency_key   TEXT    NOT NULL,                       -- 机会ID+问题+假设+限制 摘要
    submitted_at      TEXT    NOT NULL,
    submitted_by      TEXT    NOT NULL,
    triggered_task_id TEXT    REFERENCES task(task_id),
    UNIQUE (idempotency_key)
);

-- MD-14 Skill 能力登记（Q-07 已决 2026-09-19：种子见 0001_mock.sql，S-A1=clue-scan/discovery-agent、S-B1=hva-five-checks/hva-agent）
CREATE TABLE skill_registry (
    skill_no        TEXT    NOT NULL PRIMARY KEY,             -- S-A1 / S-B1
    skill_code      TEXT    NOT NULL,                         -- clue-scan / hva-five-checks
    skill_name      TEXT    NOT NULL,
    version         TEXT    NOT NULL,
    bound_agent_code TEXT   NOT NULL REFERENCES agent_profile(agent_code),
    is_active       INTEGER NOT NULL DEFAULT 1,              -- 0/1
    UNIQUE (skill_code)
);

-- PD-02 任务步骤
CREATE TABLE task_step (
    step_id     TEXT    NOT NULL PRIMARY KEY,
    task_id     TEXT    NOT NULL REFERENCES task(task_id),
    step_no     INTEGER NOT NULL,
    step_name   TEXT    NOT NULL,
    step_state  TEXT    NOT NULL,                            -- dict:STEP_STATE
    UNIQUE (task_id, step_no)
);

-- PD-03 任务受阻记录
CREATE TABLE task_block (
    block_id        TEXT    NOT NULL PRIMARY KEY,
    task_id         TEXT    NOT NULL REFERENCES task(task_id),
    block_reason_code TEXT NOT NULL,                          -- dict:BLOCK_REASON
    block_note      TEXT    NOT NULL,
    resume_condition TEXT   NOT NULL,
    blocked_at      TEXT    NOT NULL,
    is_resolved     INTEGER NOT NULL DEFAULT 0               -- 0/1
);

-- PD-04 目标口径待补项
CREATE TABLE goal_gap (
    gap_id           TEXT    NOT NULL PRIMARY KEY,
    goal_id          TEXT    NOT NULL REFERENCES research_goal(goal_id),
    goal_version_no  INTEGER NOT NULL,
    rule_id          TEXT    NOT NULL REFERENCES gap_rule(rule_id),
    target_field     TEXT    NOT NULL,                       -- dict:GOAL_FIELD
    gap_text         TEXT    NOT NULL,
    impact_note      TEXT    NOT NULL,
    raised_at        TEXT    NOT NULL,
    raised_by_task_id TEXT   NOT NULL REFERENCES task(task_id),
    filled_value     TEXT,                                    -- 未补为空
    filled_at        TEXT,
    filled_by        TEXT,
    is_solved        INTEGER NOT NULL DEFAULT 0              -- 0/1
);

-- PD-05 机会状态变更日志
CREATE TABLE opportunity_status_log (
    log_id        TEXT    NOT NULL PRIMARY KEY,
    opportunity_id TEXT    NOT NULL REFERENCES opportunity(opportunity_id),
    from_status   TEXT,                                       -- 首次为空
    to_status     TEXT    NOT NULL,                          -- dict:OPP_STATUS
    change_reason TEXT    NOT NULL,
    changed_at    TEXT    NOT NULL,
    changed_by    TEXT    NOT NULL
);

-- PD-06 上下文注入记录
CREATE TABLE context_injection (
    injection_id      TEXT    NOT NULL PRIMARY KEY,
    task_id           TEXT    NOT NULL REFERENCES task(task_id),
    context_type_code TEXT    NOT NULL,                       -- dict:CONTEXT_TYPE
    ref_object_type   TEXT    NOT NULL,                       -- dict:OBJECT_TYPE
    ref_object_id     TEXT    NOT NULL,                       -- 跨表主键值
    injected_at       TEXT    NOT NULL
);

-- PD-07 追问对话消息
CREATE TABLE followup_message (
    message_id  TEXT    NOT NULL PRIMARY KEY,
    research_no TEXT    NOT NULL REFERENCES research(research_no),
    task_id     TEXT    NOT NULL REFERENCES task(task_id),
    message_role TEXT   NOT NULL,                             -- dict:MESSAGE_ROLE
    message_text TEXT   NOT NULL,
    created_at  TEXT    NOT NULL
);

-- ---------- 维度四 · 关联表（LNK） ----------

-- LNK-01 机会 ↔ 证据
CREATE TABLE opportunity_evidence (
    link_id       TEXT    NOT NULL PRIMARY KEY,
    opportunity_id TEXT   NOT NULL REFERENCES opportunity(opportunity_id),
    evidence_id   TEXT    NOT NULL REFERENCES evidence(evidence_id),
    link_kind     TEXT    NOT NULL,                          -- dict:EVIDENCE_LINK_KIND
    linked_at     TEXT    NOT NULL,
    UNIQUE (opportunity_id, evidence_id, link_kind)
);

-- LNK-02 关键发现 ↔ 证据
CREATE TABLE finding_evidence (
    link_id    TEXT    NOT NULL PRIMARY KEY,
    finding_id TEXT    NOT NULL REFERENCES research_finding(finding_id),
    evidence_id TEXT   NOT NULL REFERENCES evidence(evidence_id),
    linked_at  TEXT    NOT NULL,
    UNIQUE (finding_id, evidence_id)
);

-- LNK-03 机会 ↔ 机会
CREATE TABLE opportunity_relation (
    relation_id         TEXT    NOT NULL PRIMARY KEY,
    from_opportunity_id TEXT   NOT NULL REFERENCES opportunity(opportunity_id),
    to_opportunity_id   TEXT   NOT NULL REFERENCES opportunity(opportunity_id),
    relation_kind       TEXT    NOT NULL,                   -- dict:OPP_RELATION
    created_at          TEXT    NOT NULL,
    UNIQUE (from_opportunity_id, to_opportunity_id, relation_kind)
);

-- LNK-04 任务 ↔ 研究对象
CREATE TABLE task_object (
    link_id     TEXT    NOT NULL PRIMARY KEY,
    task_id     TEXT    NOT NULL REFERENCES task(task_id),
    object_type TEXT    NOT NULL,                             -- dict:OBJECT_TYPE
    object_id   TEXT    NOT NULL,
    link_role   TEXT    NOT NULL,                            -- dict:TASK_LINK_ROLE
    created_at  TEXT    NOT NULL,
    UNIQUE (task_id, object_type, object_id, link_role)
);

-- ---------- 维度五 · 外部系统引用快照（EXT） ----------

-- EXT-01 查询记录
CREATE TABLE query_record (
    query_id        TEXT    NOT NULL PRIMARY KEY,            -- Q-90217
    task_id         TEXT    NOT NULL REFERENCES task(task_id),
    source_id       TEXT    NOT NULL REFERENCES source_registry(source_id),
    query_condition TEXT    NOT NULL,
    queried_at      TEXT    NOT NULL,
    result_status   TEXT    NOT NULL,                        -- dict:QUERY_STATUS
    result_summary  TEXT,                                    -- 失败时为空
    returned_rows   INTEGER,                                 -- ≥0
    fail_reason     TEXT,
    retry_count     INTEGER NOT NULL DEFAULT 0,              -- ≥0
    restricted_flag INTEGER NOT NULL DEFAULT 0,              -- 0/1
    message_id      TEXT    REFERENCES followup_message(message_id),
    created_at      TEXT    NOT NULL
);

-- EXT-02 证据
CREATE TABLE evidence (
    evidence_id        TEXT    NOT NULL PRIMARY KEY,         -- EV-1041
    query_id           TEXT    NOT NULL REFERENCES query_record(query_id),
    source_id          TEXT    NOT NULL REFERENCES source_registry(source_id),
    evidence_title     TEXT    NOT NULL,
    query_condition    TEXT    NOT NULL,
    info_time_point    TEXT    NOT NULL,
    applicability_scope TEXT   NOT NULL,
    result_summary     TEXT    NOT NULL,
    missing_note       TEXT    NOT NULL,
    created_at         TEXT    NOT NULL
);

-- EXT-03 外部验证结果引用
CREATE TABLE external_validation (
    validation_id TEXT    NOT NULL PRIMARY KEY,
    research_no   TEXT    NOT NULL REFERENCES research(research_no),
    conclusion    TEXT    NOT NULL,
    source_ref    TEXT    NOT NULL,
    validated_at  TEXT    NOT NULL,
    created_at    TEXT    NOT NULL
);

-- ---------- 建议索引（schema.md §11） ----------
CREATE INDEX idx_goal_version_applied   ON research_goal_version(goal_id, is_applied);
CREATE INDEX idx_opportunity_goal_status ON opportunity(goal_id, opportunity_status);
CREATE INDEX idx_task_goal_status       ON task(goal_id, task_status);
CREATE INDEX idx_task_type              ON task(task_type);
CREATE INDEX idx_query_record_task      ON query_record(task_id);
CREATE INDEX idx_query_record_source    ON query_record(source_id, queried_at);
CREATE INDEX idx_evidence_query         ON evidence(query_id);
CREATE INDEX idx_evidence_source        ON evidence(source_id);
CREATE INDEX idx_goal_gap_unsolved      ON goal_gap(goal_id, is_solved);
CREATE INDEX idx_context_injection_task ON context_injection(task_id);
CREATE INDEX idx_followup_research      ON followup_message(research_no, created_at);
