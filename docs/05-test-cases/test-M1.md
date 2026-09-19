# 测试用例 · M1 平台任务程序（F-01~F-06）

> **文档卡**
> | 项 | 内容 |
> | ---- | ---- |
> | 文档编号 | TC-M1 |
> | 上游约束 | `AGENTS.md`（宪法：白盒原则｜编号体系）｜`BRD.md` §4 F-01~F-06、§5.3 硬红线、§7 验收总则｜`PRD-M1-平台任务程序.md`（F-01~F-06 验收要点）｜`schema.md`（PD-01/02/03/04/05/07、MD-01/02/03、MD-12）｜`tech-stack.md`（DS-03 任务编排、§4.2 Queues 上限、§5 run_policy 映射）｜`dev-plan.md`（阶段 3 · M1）｜`ADR-003`（未知项二态，间接） |
> | 范围 | 组织者 / 调度层：目标版本化、两阶段任务调度、人工节点、追问派生、任务记录与异常恢复 |
> | 分层覆盖 | 单元(L1) / 约束(L3) / 平台集成(L5)。**L2（Agent JSON 契约）与 L4（Agent Skill 六步）不适用于本模块**（M1 无 Agent Skill，仅编排壳）——见 `00-索引.md` 分层说明。 |

## 1. 单元 / 纯计算（L1）

| 用例ID | 层级 | 验收(F-xx) | 输入 | 期望输出 / 断言 | 引用(见…) | 标记 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| TC-U-M1-001 | L1 | F-02 | 运行频率配置串 `"每日 02:00"` | 解析为合法 Cron Triggers 表达式；最小粒度 ≥ 1 分钟；超限报错。 | 见 `tech-stack.md` §4.2（Cron 最小 1 分钟、Paid 250 条上限）｜`PRD-M1` F-02 | — |
| TC-U-M1-002 | L1 | F-06 | `retry_limit` 入参 `150` | 落库值封顶 `≤ 100`（Queues `max_retries` 平台硬上限）；超限须显式报错而非静默截断。 | 见 `tech-stack.md` §4.2（重试最大 100）｜`PRD-M1` F-06 | — |

## 2. 约束 / 数据（L3）

> 依据 `db/migrations/0001_init.sql` 实际 DDL；每条约束给正/反一对。PK = 每表 `TEXT NOT NULL PRIMARY KEY`；FK 在 D1 默认强制（`tech-stack.md` §3.3 实测）。

| 用例ID | 层级 | 验收(F-xx) | 输入 | 期望输出 / 断言 | 引用(见…) | 标记 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| TC-D-M1-001 | L3 | F-01 | 写 `PD-01 task`：合法 `task_id='T-9001'` | 正：插入成功。反：置 `task_id=NULL` → `NOT NULL` 拒绝。 | 见 `schema.md` PD-01｜DDL `0001_init.sql` L187 | — |
| TC-D-M1-002 | L3 | F-01 | `PD-01.task.goal_id='GOAL-NOPE'`（不存在） | 反：FK 约束失败（`FOREIGN KEY constraint failed`）。 | 见 `schema.md` PD-01（goal_id REFERENCES research_goal）｜DDL L190 | — |
| TC-D-M1-003 | L3 | F-02 | `PD-02 task_step` 重复 `(task_id, step_no)=('T-9001',1)` 两次 | 反：复合 UK 拒绝第二次插入。 | 见 `schema.md` PD-02（UNIQUE(task_id,step_no)）｜DDL L323 | — |
| TC-D-M1-004 | L3 | F-05 | `PD-01` 自引用：子行 `T-9003.parent_task_id='T-9002'`，但 `T-9002` 排在 `T-9003` 之后插入 | 反：子表先于父表 → FK 失败（须父行先落）。正：`T-9002` 先插入、`T-9003` 后插入 → 成功。 | 见 `schema.md` PD-01（parent_task_id REFERENCES task）｜DDL L200｜`db/seed` 生成器已按拓扑排序验证 | — |
| TC-D-M1-005 | L3 | F-06 | `PD-03 task_block.task_id='T-NOPE'` | 反：FK 失败。 | 见 `schema.md` PD-03｜DDL L329 | — |
| TC-D-M1-006 | L3 | F-04 | `PD-04 goal_gap`：`goal_id`/`raised_by_task_id`/`rule_id` 任一不存在 | 反：对应 FK 失败。 | 见 `schema.md` PD-04（三外键）｜DDL L339-347 | — |
| TC-D-M1-007 | L3 | F-03 | `PD-05 opportunity_status_log.opportunity_id='OPP-NOPE'` | 反：FK 失败。 | 见 `schema.md` PD-05｜DDL L357 | — |
| TC-D-M1-008 | L3 | F-05 | `PD-07 followup_message.research_no='R-NOPE'` 或 `task_id='T-NOPE'` | 反：FK 失败。 | 见 `schema.md` PD-07｜DDL L377-379 | — |

## 3. 平台 / 集成（L5）

| 用例ID | L5 | 验收(F-xx) | 输入 | 期望输出 / 断言 | 引用(见…) | 标记 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| TC-I-M1-001 | L5 | F-02 / F-04 | 运行条件到达 → 创建发现任务 / 研究建议提交后 | **任务程序决定何时启动**；Agent 仅在任务内被调用，不在任务外自发行动；第二阶段启动时点 = 建议提交时刻。 | 见 `PRD-M1` F-02/F-04 验收要点｜`BRD` §3.1 流程主线 | — |
| TC-I-M1-002 | L5 | F-03 / F-04 | PM 在 M6 选机会＋提研究问题（必需） | 建议与机会版本关联；**重复提交幂等**（同 `idempotency_key` 不重复启动相同任务）；缺研究问题时拒绝提交。 | 见 `PRD-M1` F-03（验收：建议与机会版本关联、重复提交幂等）｜`schema.md` PD-05（UNIQUE idempotency_key）｜DDL L302 | — |
| TC-I-M1-003 | L5 | F-05 | 已有研究上提新问题 | 关联原研究建立新任务（`parent_research_no`/`start_task_id` 指向原）；原研究结果与依据继续保留；新旧版本不混。 | 见 `PRD-M1` F-05 验收要点｜`schema.md` MD-07（parent_research_no REFERENCES research）｜DDL L244 | — |
| TC-I-M1-004 | L5 | F-06 | 任务持续失败 | 状态机置 `blocked` **不自动重启**；研究内容与运行状态分别记录（`PD-02` 步骤结果 vs `PD-01.task_status`）；已完成部分保留；运行的失败**不作为否定 HVA 的依据**。 | 见 `PRD-M1` F-06 验收要点｜`BRD` §7.4（失败不否定结论）｜`tech-stack.md` §2.4（死信→blocked） | — |
| TC-I-M1-005 | L5 | F-01 | 目标中途更新 | 同一研究不因目标更新被悄悄替换；新目标建新版本（`MD-02` `is_applied` 标记）；历史研究保留启动时口径快照。 | 见 `PRD-M1` F-01 验收要点①｜`schema.md` MD-02（goal_version 版本化）｜DDL L130 | — |
| TC-I-M1-006 | L5 | F-01 / F-06 | 版本切换 / 状态跃迁写库 | 每个状态跃迁是一行可查数据（白盒）；消息只带 `task_id`+`step_no`，上下文现读（非大上下文入队）。 | 见 `tech-stack.md` §2.4（消息≤128KB、状态在库）｜`PRD-M1` F-06 | — |

## 4. 本模块不适用层级说明

- **L2（Agent JSON 契约）**：M1 不产出 Agent 推理结果，无 `json_schema` 输出断言；契约断言见 M3/M4/M5/M6。
- **L4（Agent Skill 六步）**：M1 无 Skill（S-Ax/S-Bx 属 M3/M4）；M1 的调度壳行为归入 L5。
