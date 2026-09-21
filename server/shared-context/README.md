# server/shared-context · M2 共享上下文（信息存储中枢）

> 阶段1 · M2。本目录是 dev-plan 阶段1 的落位模块（`server/shared-context`，被 `server/api` / `server/agent-orchestrator` 调用）。
> 当前进度：**F-07 业务背景管理、F-08 可用来源与工具登记、F-09 证据管理、F-10 机会记录管理、F-11 研究结果与历史管理、F-12 上下文按任务组织注入**（阶段1 · M2 六个功能点**全部收口**）；另含**接线工作项 F-35 取号原子化**（非 BRD 功能点；新增 `./id-sequence.js` ＝ **CFG-09 `id_sequence` 唯一写入面**，2026-09-22 落地）。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 上游约束 | `../../AGENTS.md`（宪法：白盒原则｜双向引用｜术语口径「共享上下文＝数据库」）｜ `../../docs/03-locks/schema.md`（MD-04 `business_context` / MD-05 `touchpoint`；CFG-01 `source_registry`；EXT-02 `evidence` / LNK-01 `opportunity_evidence` / LNK-02 `finding_evidence`；MD-06 `opportunity` / PD-05 `opportunity_status_log` / LNK-03 `opportunity_relation`；**MD-07 `research` / MD-08 `research_finding` / EXT-03 `external_validation`**；Q-03「背景不做定版快照」；Q-05 六要素必填见 MD-06 表尾注；**v1.9 起含 CFG-09 `id_sequence`（取号序列，运行期基础设施；归属与范围见 §0.2 v1.9 说明与 §12 Q-18）**；§11 应用层校验）｜ `../../docs/07-decisions/ADR-003-机会六要素必填与未知项二态.md`（§3 清单与判定式 / §3.1 两件套 / §3.2 未加二态 CHECK）｜ `../../docs/03-locks/tech-stack.md`（§2.2 `shared-context` 模块 / DS-01 D1）｜ `../../docs/03-locks/external-deps.md`（§2 五系统 can/cannot/status）｜ `../../docs/04-plan/dev-plan.md`（阶段1 · M2 F-07~F-12）｜ `../../docs/02-prd/PRD-M2-共享上下文.md`（F-07~F-12）｜ `../../docs/05-test-cases/test-M2.md` |
| 职责 | 共享上下文存储中枢（D1）的读写。**严格逐 F-xx 落地**，不跨功能点预实现。 |
| 硬红线 | 只在本平台自有 D1 内增删查；**不调面向生产环境会改线上数据的接口**（BRD §5.3）；**证据一律只新增行、不覆盖**（EXT-02 头注）；暂不研究的机会**只改状态、不删除**（MD-06 头注）；**追问不覆盖原研究**（MD-07 表注 L271）；外部验证**只登记业务侧结论与来源引用**，平台不执行验证、不计算效果（EXT-03 表注 L737-738）。 |

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `index.js` | M2 模块本体：MD-04 背景条目 + MD-05 触点清单的读写 + 背景简报（F-07）；CFG-01 来源登记 + 缺口语义 + 来源与工具说明（F-08）；EXT-02 证据登记 + 回查链路 + LNK-01/LNK-02 证据关联（F-09）；MD-06 机会记录 + PD-05 状态留痕 + LNK-03 机会关系（F-10）；MD-07 研究登记 + MD-08 发现只读 + EXT-03 外部验证引用 + `parent_research_no` 追问链追溯（F-11）；**CFG-06 注入模板登记 + PD-06 按任务装配/初始化/回读（F-12）** | ✅ F-07 / F-08 / F-09 / F-10 / F-11 / **F-12** 已建 |
| `id-sequence.js` | **F-35 取号原子化（接线工作项）**：**CFG-09 `id_sequence` 的唯一写入面**——`issueId`（原子取号：`UPDATE ... SET next_val = next_val + 1 ... RETURNING next_val` **一条语句**完成「自增 + 取值」，取代「读全量自算最大 +1」的**读后写**，堵 **P0-3**「并发撞主键 → 任务 `blocked`」）、`healSequence`（**显式**修复计数器：旁路插入后把 `next_val` 抬到观测实际最大，**只抬不降**、幂等）、`readSequence`（回读读面）、`parseMaxSeq`（从既有 id 清单自算最大，**不写 `SELECT MAX`**）、`formatId`、`ID_NAMESPACES` / `ID_NAMESPACE_CODES`（**号形态与命名空间清单只此一份**）。**热路径刻意不回读业务表**（种子 thunk 只在冷路径调 1 次）；冷路径种子入参**必填**（省略即报错，防「按 0 起步重发已用号」）。范围＝用户裁决**选项 c**：只收敛 `task`/`research`/`opportunity` 三条最热号，其余 12 个取号面登记待办（`schema.md` §12 Q-18） | ✅ F-35 已建 2026-09-22（**26 断言全绿**） |
| `test-f07.mjs` | F-07 用例执行器（`node:sqlite` + D1 适配层，载入真实 DDL 跑约束） | ✅ 已建 |
| `test-f08.mjs` | F-08 用例执行器（载入真实 DDL + `0001_mock.sql` 种子，跑 CFG-01 约束与缺口语义） | ✅ 已建 |
| `test-f09.mjs` | F-09 用例执行器（载入真实 DDL + 种子，跑 EXT-02 外键 / 四要素 / 回查链路 / 新旧依据并存 / LNK-04 复合 UK） | ✅ 已建 |
| `test-f10.mjs` | F-10 用例执行器（载入真实 DDL + 种子，跑 MD-06 六要素 NOT NULL+CHECK / `unknown_item` 二态 / LNK-01/LNK-03 复合 UK / 自环应用层拒 / PD-05 状态链留痕） | ✅ 已建 |
| `test-f11.mjs` | F-11 用例执行器（载入真实 DDL + 种子，跑 MD-07 `opportunity_id`/自引用 FK / EXT-03 `research_no` FK / 追问不覆盖 / `parent_research_no` 祖先与派生链追溯 / MD-08 只读与 `UK(research_no, order_no)`） | ✅ 已建 |
| `test-f12.mjs` | F-12 用例执行器（载入真实 DDL + 种子，跑 CFG-06 复合 UK / PD-06 `task_id` FK / LNK-04 复合 UK / 类型与范围两维度装配 / **注入确定性可复现 + 幂等** / Q-08 三类不落行） | ✅ 已建 |
| `test-f35.mjs` | F-35 用例执行器（本地内存库 + 真实 DDL + 真实种子）：静态（全仓唯一写入面 / 号形态只此一份 / 消费方零取号裸 SQL / 经再导出不新增 import / 前提「全仓无 `withSession`」）+ 运行期（冷启动自愈种子 / 种子入参冷路径必填 / 并发 6 次互不相同 / 热路径 0 次回读 / `healSequence` 只抬不降幂等 / 旁路插入须显式修 / 空表可直取 / 未登记命名空间报错 / PK 兜底）+ 端到端（`createTask` 经取号落库、连建互不撞号）+ 漂移守卫（`schema.md` 声明表数 ↔ DDL `CREATE TABLE` 实数；`0001_init.sql` 与 `db/ops/*.sql` 两处列定义一致） | ✅ 已建（**26 断言全绿**） |

## F-07 覆盖（业务背景管理）

- **落库对象**：`MD-04 business_context`（背景条目；`goal_id` 可空＝平台级通用背景）、`MD-05 touchpoint`（触点清单，`touchpoint_name` 唯一）。
- **实现**：`createBusinessContext` / `listBusinessContext` / `createTouchpoint` / `listTouchpoints` / `getBackgroundBriefing`。
- **oracle（test-M2）**：`TC-D-M2-001`（`goal_id` NULL 允许 / 不存在 FK 拒绝）、`TC-D-M2-002`（重复 `touchpoint_name` UNIQUE 拒绝）。实跑：`node server/shared-context/test-f07.mjs` → **VERIFY PASS**。

## F-08 覆盖（可用来源与工具登记）

- **落库对象**：`CFG-01 source_registry`（五类来源 CDP/HJE/PIM/MKT/ACT；`source_id` PK、`source_name` UK、`capability_can`/`capability_cannot`/`availability_status`）。只读交叉引用 `CFG-02 tool_registry` 产出「来源与工具说明」。
- **实现**：`registerSource` / `updateSourceCapability`（接入能力确认）/ `listSources` / `getSource` / `getSourceGaps`（缺口地图）/ `getSourceToolBriefing`（来源与工具说明）。
- **oracle（test-M2）**：`TC-D-M2-010`（`source_id` PK 拒 NULL / 拒重复；五来源种子齐全）、`TC-I-M2-003`（**来源登记不代替实际证据**——缺口 `is_evidence=false`、缺口如实登记）。实跑：`node server/shared-context/test-f08.mjs` → **VERIFY PASS**。
- **缺口语义（F-08 验收要点「Agent 能知道缺少什么信息」）**：缺口来源＝未接入（`unauthorized` → `source_unavailable`，整源不可查）或能力边界（`capability_cannot` → `capability_limit`）。缺口只登记、**不计入证据**。
- **边界（不跨项）**：`CFG-02` 工具的**写/注册**（MCP 化、`is_enabled`）归 **F-23（M5 阶段2）**，本项只做只读交叉引用。
- **未决项（挂起，未锁死）**：`T-07`（ACT `degraded` 是常态还是临时）、`T-08`（ACT 是否确认无用户参与明细）、`T-09`（是否还有第六个可用来源）——`external-deps` §7，故实现**不硬编码「恰好 5 个来源」**（`source_id` 走 `dict:SOURCE_CODE`，新增来源可直接登记）。

## F-09 覆盖（证据管理）

- **落库对象**：`EXT-02 evidence`（证据：来源 + 查询条件 + 信息时点 + 适用范围 + 缺失说明）、`LNK-01 opportunity_evidence`（机会↔证据，`link_kind` 区分「初步依据 / 关联更新」）、`LNK-02 finding_evidence`（关键发现↔证据）。
- **实现**：
  - `validateEvidenceCompleteness`（**纯函数**：证据四要素齐全校验，返回 `{valid, missing, missing_labels}`）
  - `createEvidence`（四要素不齐 → **直接 fail、不落库**；只 INSERT，无 UPDATE/DELETE）
  - `getEvidence` / `listEvidence`（可按 `source_id` / `query_id` 过滤）
  - `getEvidenceTrace`（**回查链路**：证据 → 查询记录 EXT-01 → 来源 CFG-01，`traceable` 判据）
  - `linkOpportunityEvidence`（LNK-01）/ `linkFindingEvidence`（LNK-02）
  - `listEvidenceByOpportunity` / `listEvidenceByFinding`（**新旧依据全量并存**，不覆盖）
- **oracle（test-M2）**：`TC-D-M2-007`（`query_id` / `source_id` 不存在 → FK 拒绝）、`TC-I-M2-001`（**证据四要素齐全**：来源/条件/时点/适用范围任一缺失 → 该证据不可作有效依据；**新证据加入不覆盖原依据**）、`TC-D-M2-015`（LNK-04 复合 UK，标 F-09/F-12）。实跑：`node server/shared-context/test-f09.mjs` → **VERIFY PASS**（11 组断言）。
- **证据四要素**（BRD §7.3 / PRD-M2 F-09）：`source_id`（来源）/ `query_condition`（查询条件）/ `info_time_point`（信息时点）/ `applicability_scope`（适用范围）。四要素的**中文名**见 `EVIDENCE_ELEMENT_LABELS`。
- **证据自洽**：`query_condition` / `info_time_point` 在 EXT-02 **冗余一份**（与 EXT-01 同名同口径）——查询记录后来补录，证据表述也不随之漂移（schema EXT-02 头注）。
- **新证据不覆盖**：EXT-02 只新增行；同一机会/发现出现新证据时**追加关联**（LNK-01 记 `related_update`），旧 `initial_basis` 关联与旧证据原文**均保留**。
- **边界（不跨项）**：`query_record`（EXT-01）的**写入**归 **M5 `tool-executor`（F-24/F-25）**，本项只读回查；LNK-04 `task_object` 的**写入路径归 M1 `task-runner`（F-02/F-04/F-06）**，本执行器只按 oracle 断言其库级复合 UK。

## F-10 覆盖（机会记录管理）

- **落库对象**：`MD-06 opportunity`（机会：六要素 + `unknown_item` 二态 + `defer_reason`）、`PD-05 opportunity_status_log`（状态变更逐次留痕）、`LNK-03 opportunity_relation`（机会↔机会：去重/关联）。
- **实现**：
  - `assessOpportunitySixElements`（**纯函数**：六要素齐全判定 + 二态分类，返回 `{six_elements_present, missing, unknown_state, six_elements_complete, pending_supplement}`）
  - `classifyUnknownItem`（**纯函数**：`NULL`→`not_assessed` / `''`→`none_confirmed` / 文本→`has_unknown` / 纯空白串→`invalid_blank`）
  - `createOpportunity`（六要素不齐 → 应用层 fail；`unknown_item` 纯空白串 → 应用层拒；**库级 `NOT NULL` + `CHECK` 是最终防线**）
  - `getOpportunity` / `listOpportunities`（可按目标/状态过滤；`pendingSupplementOnly` 只看 `unknown_item IS NULL` 的**待补**机会）
  - `changeOpportunityStatus`（读当前状态作 `from_status` → 改 MD-06 → **追加** PD-05 日志；**不删除**记录）
  - `logOpportunityStatus` / `listOpportunityStatusLog`
  - `linkOpportunityRelation`（**自环拒绝**＝应用层） / `listOpportunityRelations`
  - `getOpportunityRecord`（读模型：本体 + 六要素判定 + 状态链 + 关系 + 证据关联）
- **oracle（test-M2）**：`TC-D-M2-003`（六要素任一 `NULL` → `NOT NULL` 拒）、`TC-D-M2-004`（六要素任一空串 → `CHECK(length(trim(x))>0)` 拒）、`TC-D-M2-005`（`unknown_item` 三态 + `'   '` **须应用层拒**）、`TC-D-M2-012`（LNK-01 复合 UK）、`TC-D-M2-014`（LNK-03 自环应用层拒 + 复合 UK 拒）。实跑：`node server/shared-context/test-f10.mjs` → **VERIFY PASS**（20 组断言）。
- **六要素的准确清单**（ADR-003 §3）：**「对应目标」占两列**（`goal_id` + `goal_version_no`），其余四项 `target_object` / `phenomenon` / `initial_basis_note` / `research_reason`——共六个字段受必填约束；`opportunity_title` **不在六要素内**（但仍 `NOT NULL`）。
- **必填＝两件套**（ADR-003 §3.1）：`NOT NULL` 拦 `NULL`；`CHECK(length(trim(x))>0)` 拦空串。**二者不可互相替代**——`length(NULL) > 0` 求值为 `NULL`，故 CHECK 会放行 `NULL`。
- **`unknown_item` 二态**（ADR-003 §3）：`NULL` = 未评估（判**不齐**、触发待补）；`''` = 已评估且确无（**计入齐全**）；非空文本 = 已评估且有未知项。**禁止编造未知项充数**。
- **暂不研究的仍保留**（PRD-M2 F-10 / MD-06 头注）：状态置 `deferred` 时填 `defer_reason`，**记录不删除**；条件变化或新证据后可再选（状态链可回查）。
- **边界（不跨项）**：机会的**人工选择**（F-03 人工节点）归 **M1 `task-runner`**；机会的**形成与去重判断**（F-16）归 **M3 机会发现 Agent**；`LNK-03` 关系的**判断**归 M3，本文件只提供关系登记/读取；本文件只做机会记录（MD-06）＋状态日志（PD-05）＋关系（LNK-03）的读写。

## F-11 覆盖（研究结果与历史管理）

- **落库对象**：`MD-07 research`（研究主体，编号 `R-xxx`，含七要素 ①②④⑥ + `parent_research_no` 追问链 + 目标启动快照）、`MD-08 research_finding`（关键发现，**只读**）、`EXT-03 external_validation`（外部验证结果引用）。
- **实现**：
  - `createResearch`（MD-07 登记；必填＝DDL `NOT NULL` 全集；**一律 INSERT、不提供覆盖更新**）
  - `getResearch` / `listResearch`（可按 `opportunity_id` / `research_status` 过滤）
  - `listResearchFindings`（**MD-08 只读**：发现的生成与写入归 F-20/F-21 M4）
  - `addExternalValidation` / `listExternalValidations`（EXT-03 只登记结论与来源引用）
  - `getResearchLineage`（**追问链追溯**：`ancestors` 由近及远、`descendants` 广度优先、`chain_from_root` 根→本研究；`has_history` / `has_followup` 供「是否已有历史可引用」判定）
  - `getResearchRecord`（读模型：研究本体 + 关键发现 + 外部验证 + 追问链）
- **oracle（test-M2）**：`TC-D-M2-006`（MD-07 `opportunity_id` 不存在 → FK 拒；补充：`parent_research_no` 自引用 FK 亦拒）、`TC-D-M2-008`（EXT-03 `research_no` 不存在 → FK 拒）、`TC-I-M2-004`（历史研究可回查、避免重复研究——按 `parent_research_no` 链追溯）。实跑：`node server/shared-context/test-f11.mjs` → **VERIFY PASS**（14 组断言）。
- **追问不覆盖原研究**（schema MD-07 表注 L271）：追问形成**新的 `research` 行**，`parent_research_no` 指向原研究；原研究的七要素正文**保持不变**（`test-f11.mjs` 的 TC-I-M2-004a 逐字段比对验证）。
- **编号口径**（schema §0.5 第 1 条）：全库只用 `R-xxx`，原型 `ST-xxx` 内部编号**已弃用**；`test-f11.mjs` 断言所有 `research_no` 符合 `^R-`。
- **外部验证平台不参与**（schema EXT-03 表注 L737-738）：**验证的执行与效果计算由业务工作完成**，本表只有结论引用与来源出处，**没有指标值**；多条并存、不覆盖，按 `validated_at` 倒序。
- **边界（不跨项）**：MD-08 发现 / MD-09 候选行为 / MD-10 支持情况条目 / MD-11 改善方向的**生成与写入**归 **F-20/F-21（M4）**，本项只读回查；追问的**发起与对话**（PD-07 `followup_message`）归 F-22/F-31；MD-07 的 `start_task_id`（F-04）由 M1 `task-runner` 写入，本文件只接受传入值。

## F-12 覆盖（上下文按任务组织注入）

- **落库对象**：`CFG-06 context_template`（按任务类型定「注入哪些信息类型 + 顺序 + 是否必需」）、`PD-06 context_injection`（某任务**实际注入**了哪些对象）；范围侧只读 `MD-05 touchpoint` / `MD-02 research_goal_version`（品类与时段）。
- **实现**：
  - `registerContextTemplate` / `listContextTemplates` / `getContextTemplate`（CFG-06 读写；重复 `(task_type, context_type_code)` 由库级 UK 拒）
  - `recordContextInjection` / `listContextInjections`（PD-06 读写；`task_id` 不存在由库级 FK 拒）
  - `buildTaskContext`（**纯读取、不写库**：按模板逐类型装配工作空间，返回 `sections` + `scope` + `missing_required`）
  - `initTaskContext`（装配 + 落 PD-06；**幂等**，已注入对象跳过；`injected_at` 可显式传入）
  - `getTaskContext`（回读：装配内容 + 该任务已注入记录）
  - 导出常量 `CONTEXT_OBJECT_TYPE`（上下文类型 → `ref_object_type`）、`CONTEXT_WITHOUT_OBJECT_TYPE`（Q-08 三类）
- **oracle（test-M2）**：`TC-D-M2-009`（PD-06 `task_id` 不存在 → FK 拒）、`TC-D-M2-011`（CFG-06 复合 UK 拒）、`TC-I-M2-002`（**注入确定性可复现**：两次装配逐字节一致、两次初始化不重复落行）、`TC-D-M2-015`（LNK-04 复合 UK，F-12 侧复验）。实跑：`node server/shared-context/test-f12.mjs` → **VERIFY PASS**（14 组断言）。
- **两个维度**（PRD-M2 F-12）：
  - **类型**：由 CFG-06 模板决定——一阶段（goal_check/discovery）＝目标 + 背景 + 可用来源（+ 机会摘要）；二阶段（hva_research/hva_followup）再加所选机会 + 产品问题 + 已有证据 + 相关历史。顺序＝ `order_no`。
  - **范围**：`goal_id` / `goal_version_no` **从任务现读**（PD-01），品类＝目标版本 `business_scope`、时段＝ `focus_period`、触点＝ `MD-05` 在册生效项；背景只取本目标条目 + 平台级通用条目（`goal_id IS NULL`）。
- **确定性**（验收要点「初始化不是每回随机」）：所有装配查询显式 `ORDER BY`、不依赖随机与时间；同任务同库状态 → 同工作空间。`injected_at` 不入装配结果，`initTaskContext` 幂等。
- **「只传一句继续分析」无效**：必需类型（`is_required = 1`）为空即计入 `missing_required` 并置 `complete = false`（例：种子 `MD-12 research_proposal` 为空 → hva 类任务的「产品问题」如实标不完整），**不静默补全、不臆造内容**。
- **背景不定版快照**（Q-03 / `ADR-001`）：`background` 注入 `MD-04` 当前生效条目（`is_active = 1`）；PD-06 只记「注入了哪几条对象」，不承担「当时内容是什么」的还原责任。
- **⚠️ Q-08（本项发现，已登记 `docs/03-locks/schema.md` §12，待裁决，未擅自改口径）**：`PD-06.ref_object_type` 的值域 `dict:OBJECT_TYPE` 只有 `goal` / `opportunity` / `research` / `proposal` 四项，而 CONTEXT_TYPE 中的 **`background`（MD-04 条目）/ `source`（CFG-01 来源）/ `existing_evidence`（EXT-02 证据）三类无对应取值**。本项按「只装配其内容、**不落 PD-06 行**」实现，并在装配结果上打 `no_object_type_q08 = true` 显式标出（已写入 `test-f12.mjs` 断言，不留隐式缺口）。裁决后改 `CONTEXT_OBJECT_TYPE` 一张映射表即可。
- **边界（不跨项）**：LNK-04 `task_object` 的**写入**归 M1 `task-runner`（F-02/F-04/F-06），本项只读其锚点（所选机会 / 原研究）；`MD-12 research_proposal` 的写入归 F-03；机会/证据/研究的**生成**归 M3/M4/M5，本项只按范围挑选；任务不存在由应用层拒（`task 不存在：xxx`），不落半截工作空间。

## 已知口径 / 实测注意（本模块相关）

1. **数值列的空串不被库级拦**（实测 2026-09-19，`node:sqlite`）：`goal_version_no` 为 `INTEGER` 列，`CHECK (goal_version_no >= 1)` 在 SQLite **类型序（TEXT > INTEGER）** 下对 `''` 求值为 `TRUE` → **库级放行空串**。本模块由应用层 `assessOpportunitySixElements` / `assertRequired`（以 `trim() === ''` 判缺失）兜底拒。**已写入 `test-f10.mjs` 断言**（不靠声称）。
2. **`unknown_item` 的二态无库级 CHECK**（ADR-003 §3.2 明示未加）→ 纯空白串 `'   '` 库级放行，**须应用层拒**（`createOpportunity` 已拒）。**已写入 `test-f10.mjs` 断言**：先证库级放行，再证应用层拒绝。
3. **种子数据口径异常（已登记，未擅自改）**：`db/seed/generate_mock.py` 的 LNK-03 种子行 `LK-OR-001` 的 `relation_kind = "related_update"` 属**值域外**——`dict:OPP_RELATION` 仅 `same_issue`（相同问题关联）/ `superseded`（被取代）两项；`related_update` 实为 `dict:EVIDENCE_LINK_KIND` 的取值（LNK-01 用）。该表无物理约束可拦（字典值域靠应用层），故种子可载入。**待用户裁定是否订正为 `same_issue`**；本模块 `linkOpportunityRelation` 不内联值域、不做域校验（值域真源在 `dict_item`）。
4. **本地 D1 的种子是一次性的**：`wrangler d1 execute --local --file=db/seed/0001_mock.sql` 重灌会撞 `UNIQUE constraint failed: dict_type.dict_type_name`（第一次已灌入）——先 `SELECT COUNT(*)` 核对，够了就直接起 dev server。
5. **EXT-03 种子为空**（原型无外部验证数据，`generate_mock.py` L489 `emit("external_validation", ..., [])`）：F-11 用例先证基线 0 行，再由本项登记正例；其 FK 反例与种子无关，可独立验证。
6. **F-35 取号器的四条边界**（2026-09-22，均可复现；`test-f35.mjs` 逐条断言）：
   ① **热路径不回读业务表**——故「旁路插入」（运维 SQL / 手工补数 / 旧代码路径）之后计数器会**落后于实际数据**，热路径**不会自己发现**；收回漂移须**显式**调 `healSequence`（或删掉计数器行让它走冷路径重种）。**不承诺**消除「旁路插入与并发取号同时发生」这个窄窗口。
   ② **号会因失败而空号**——取号在前、建行在后，两者**不在同一事务**；建行失败（守卫拒绝 / 约束冲突）时该号作废不复用。这是计数器语义（旧「读后写」会复用号，代价正是并发撞号）。
   ③ **冷路径种子入参必填**——省略会被当成「按 0 起步」，在已有数据的库上重发已用号；故 `issueId` 遇到非法入参**响亮报错**，空库须显式传 `[]`。
   ④ **只保证「经本文件取号者之间」不撞号**；范围外 12 个取号面（含同目录外的 `LNK-03` 关系号）仍是读后写，见 `../../docs/03-locks/schema.md` §12 **Q-18** 待办。

## 反向清单（被谁引用）

- `../api/index.js`（**F-12 路由：`/api/context-templates`(GET/POST)、`/api/task-context/init`(POST)、`/api/task-context/{task_id}`(GET)、`/api/context-injections`(GET/POST)**；F-07 路由：`/api/business-context`、`/api/touchpoints`、`/api/background-briefing`；F-08 路由：`/api/sources`、`/api/sources/capability`、`/api/source-gaps`、`/api/source-tool-briefing`；F-09 路由：`/api/evidence`、`/api/evidence-trace/{id}`、`/api/evidence/{id}`、`/api/evidence-links/opportunity`、`/api/evidence-links/finding`；F-10 路由：`/api/opportunities`、`/api/opportunities/{id}`、`/api/opportunity-status`、`/api/opportunity-relations`；**F-11 路由：`/api/research`、`/api/research/{research_no}`、`/api/research/{research_no}/findings`、`/api/research-lineage/{research_no}`、`/api/external-validations`**）
- `../agent-orchestrator`（后续：M3/M4 启动时注入背景简报与来源能力边界；引用证据时回查证据链；消费机会记录；M4 追问时按 `parent_research_no` 追溯历史研究避免重复研究；**启动时调 `initTaskContext` 按模板初始化本任务工作空间**）
- `../task-runner`（后续：M1 创建任务后按 `CFG-06` 模板初始化上下文；注入记录与本模块共用 `recordContextInjection` 写入口）
- `../README.md`（`server/` 枝杈登记）
- `.github/workflows/ci.yml`（`validate` 步骤复用 `test-f07.mjs` / `test-f08.mjs` / `test-f09.mjs` / `test-f10.mjs` / `test-f11.mjs` / **`test-f12.mjs`** / **`test-f35.mjs`**）
- **F-35 的两个消费方（经本模块取号，不改本模块口径）**：`../task-runner/step-plan.js` 的 `nextTaskId`（`task`）/ `nextResearchNo`（`research`）与 `../agent-orchestrator/opportunity.js` 的 `nextOpportunityId`（`opportunity`）——
  三者经 `./id-sequence.js` 取号；`opportunity.js` **经本模块 `index.js` 再导出**取用（不直连，故其「唯一 import」静态断言不动）。
  两个消费方的**调用面与返回形态一律未变**（既有 `test-f16` / `test-f05` / `test-f01`~`test-f06` 断言逐字未改即证明这一点）。
- `db/ops/2026-09-22-id-sequence.sql` ＋ `.github/workflows/ops-id-sequence.yml`（线上既有库补建 `id_sequence` 的一次性入口——`0001_init.sql` 已被记为已应用，D1 不重放）
- `../../docs/02-prd/PRD-M2-共享上下文.md` 反向清单（下游 `server/（shared-context）`）
