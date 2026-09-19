# 测试用例 · M2 共享上下文（F-07~F-12）

> **文档卡**
> | 项 | 内容 |
> | ---- | ---- |
> | 文档编号 | TC-M2 |
> | 上游约束 | `AGENTS.md`（白盒原则｜双向引用｜术语口径「共享上下文＝数据库」）｜`BRD.md` §4 F-07~F-12、§7.3 证据四要素｜`PRD-M2-共享上下文.md`（F-07~F-12 验收要点）｜`schema.md`（MD-04/05/06/07/08、EXT-02/03、PD-06、CFG-01/06、LNK-01/02/03/04）｜`external-deps.md`（§2 五类来源、§4 交付基础设施）｜`dev-plan.md`（阶段 1 · M2）｜`ADR-003`（六要素二态） |
> | 范围 | 信息存储中枢：背景、来源、证据、机会、研究、历史的数据库化存储，按任务确定性注入 |
> | 分层覆盖 | 约束(L3) / 平台集成(L5)。**L1（纯计算）本模块无确定性评分逻辑**；**L2（Agent JSON 契约）不适用**（M2 不产出 Agent 结果）；**L4（Agent Skill）不适用**（来源登记属平台行为，归入 L5）。 |

## 1. 约束 / 数据（L3）

| 用例ID | 层级 | 验收(F-xx) | 输入 | 期望输出 / 断言 | 引用(见…) | 标记 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| TC-D-M2-001 | L3 | F-07 | `MD-04 business_context`：`goal_id` 置平台级通用背景为 `NULL` | 正：平台级背景 `goal_id` 允许 NULL（DDL 定义 `REFERENCES research_goal(goal_id)` 无 NOT NULL）。反：填不存在的 `goal_id` → FK 失败。 | 见 `schema.md` MD-04（goal_id 可空 FK）｜DDL L163 | — |
| TC-D-M2-002 | L3 | F-07 | `MD-05 touchpoint`：重复 `touchpoint_name='首页推荐位'` | 反：UNIQUE 拒绝第二次。 | 见 `schema.md` MD-05（UNIQUE touchpoint_name）｜DDL L180 | — |
| TC-D-M2-003 | L3 | F-10 | `MD-06 opportunity` 六要素其一置 `NULL`（如 `target_object=NULL`） | 反：`NOT NULL` 拒绝（`goal_id`/`goal_version_no`/`target_object`/`phenomenon`/`initial_basis_note`/`research_reason` 六字段均 NOT NULL）。 | 见 `schema.md` MD-06｜`ADR-003` §3（六要素 NOT NULL）｜DDL L211-222 | — |
| TC-D-M2-004 | L3 | F-10 | `MD-06` 六要素其一置空串 `''`（如 `target_object=''`） | 反：`CHECK (length(trim(x)) > 0)` 拒绝空串（Q-05 裁决）。 | 见 `schema.md` MD-06（六要素 CHECK）｜`ADR-003` §3.1（CHECK 拦空串）｜DDL L211-222 | — |
| TC-D-M2-005 | L3 | F-10 | `MD-06.unknown_item` 三态 | 正①`NULL`=未评估（判定「不齐」，触发待补）；正②`''`=已评估且确无未知项（计入齐全）；正③非空文本=有未知项。反：`'   '` 纯空白串——库级 CHECK 不拦（仅拦 `NULL`），须**应用层**拒绝（见 `ADR-003` §3.2 可选式）。 | 见 `ADR-003` §3（二态判定式 `unknown_item IS NULL`→不齐）｜`schema.md` MD-06 | — |
| TC-D-M2-006 | L3 | F-11 | `MD-07 research.opportunity_id='OPP-NOPE'` | 反：FK 失败。 | 见 `schema.md` MD-07（FK opportunity）｜DDL L232 | — |
| TC-D-M2-007 | L3 | F-09 | `EXT-02 evidence`：`query_id`/`source_id` 不存在 | 反：FK 失败（`query_id` REFERENCES query_record、`source_id` REFERENCES source_registry）。 | 见 `schema.md` EXT-02｜DDL L449-450 | — |
| TC-D-M2-008 | L3 | F-11 | `EXT-03 external_validation.research_no='R-NOPE'` | 反：FK 失败。 | 见 `schema.md` EXT-03｜DDL L463 | — |
| TC-D-M2-009 | L3 | F-12 | `PD-06 context_injection.task_id='T-NOPE'` | 反：FK 失败。 | 见 `schema.md` PD-06｜DDL L368 | — |
| TC-D-M2-010 | L3 | F-08 | `CFG-01 source_registry`：`source_id` 重复 / `NULL` | 反①：PK 拒绝 NULL；反②：重复 PK 拒绝。正：5 来源（CDP/HJE/PIM/MKT/ACT）种子齐全。 | 见 `schema.md` CFG-01｜DDL L38｜`db/seed/0001_mock.sql`（5 来源已种） | — |
| TC-D-M2-011 | L3 | F-12 | `CFG-06 context_template` 重复 `(task_type, context_type_code)` | 反：复合 UK 拒绝。 | 见 `schema.md` CFG-06（UNIQUE(task_type,context_type_code)）｜DDL L101 | — |
| TC-D-M2-012 | L3 | F-10 | `LNK-01 opportunity_evidence` 重复 `(opportunity_id, evidence_id, link_kind)` | 反：复合 UK 拒绝。 | 见 `schema.md` LNK-01（UNIQUE）｜DDL L394 | — |
| TC-D-M2-013 | L3 | F-10 | `LNK-02 finding_evidence` 重复 `(finding_id, evidence_id)` | 反：UK 拒绝。 | 见 `schema.md` LNK-02｜DDL L403 | — |
| TC-D-M2-014 | L3 | F-10 | `LNK-03 opportunity_relation`：自环 `from_opportunity_id=to_opportunity_id` | 反：业务上禁止自环（应用层校验，见 `schema.md` §11 跨表应用层校验）；重复 `(from,to,kind)` → UK 拒绝。 | 见 `schema.md` LNK-03（UNIQUE）＋§11 应用层校验｜DDL L413 | — |
| TC-D-M2-015 | L3 | F-09 / F-12 | `LNK-04 task_object_link` 重复 `(task_id, object_type, object_id, link_role)` | 反：复合 UK 拒绝。 | 见 `schema.md` LNK-04（UNIQUE）｜DDL L424 | — |

## 2. 平台 / 集成（L5）

| 用例ID | 层级 | 验收(F-xx) | 输入 | 期望输出 / 断言 | 引用(见…) | 标记 |
| ---- | ---- | ---- | ---- | ---- | ---- | ---- |
| TC-I-M2-001 | L5 | F-09 | 引用一条证据 | **证据四要素齐全校验**：`source`（来源）/ `query_condition`（条件·适用范围）/ `info_time_point`（时点）/ `applicable_scope`（适用范围）任一缺失 → 该证据**不可作为有效依据**（fail）。新证据加入**不覆盖**原依据（原 `research_finding` 仍保留）。 | 见 `BRD` §7.3（证据四要素）｜`PRD-M2` F-09 验收要点｜`schema.md` EXT-02 字段 | — |
| TC-I-M2-002 | L5 | F-12 | 同一任务两次请求相同上下文注入 | **注入确定性**：两次返回的上下文内容一致、可复现；非每回随机；不要求 PM 重贴全部资料、不退化成只传「继续分析」。 | 见 `PRD-M2` F-12 验收要点（初始化是确定性程序行为）｜`schema.md` CFG-06/PD-06 | — |
| TC-I-M2-003 | L5 | F-08 | 登记某来源「未接入 / 无法查询」 | 来源登记**不代替**实际证据：Agent 可知缺口，但查询须对应真实接入；缺口如实登记，不把系统名当证据。 | 见 `PRD-M2` F-08 验收要点｜`external-deps.md` §2（系统名≠实际可查内容） | ⚠️待确认(§7-T07/T08/T09) |
| TC-I-M2-004 | L5 | F-11 | 后续研究引用历史研究 | 历史研究可回查；避免重复研究（按 `MD-07.parent_research_no` 链追溯）。 | 见 `PRD-M2` F-11 验收要点｜`schema.md` MD-07 | — |

## 3. 本模块不适用层级说明

- **L1**：M2 为纯存储层，无归一/评分/价格等确定性计算。
- **L2**：M2 不产出 Agent 推理结果，无 `json_schema` 输出断言。
- **L4**：来源/证据登记属平台写行为（归入 L5），非 Agent Skill 六步；Skill 见 M3/M4。
