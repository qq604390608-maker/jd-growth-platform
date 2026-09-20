# server/agent-orchestrator/ 模块文档卡

> 模块定位：阶段4 · **M3 机会发现 Agent + M4 HVA 分析 Agent** 的运行期能力底座（`docs/04-plan/dev-plan.md` 阶段4）。
> ｜ `../../docs/02-prd/PRD-M3-机会发现Agent.md`（F-13~F-17）｜ `../../docs/02-prd/PRD-M4-HVA分析Agent.md`（F-18~F-22）
> ｜ `../../docs/01-brd/BRD.md` §3 M3/M4、§4 F-13~F-22、§5.3 硬红线、§7 验收总则
> ｜ `../../docs/03-locks/schema.md`（MD-13 agent_profile、MD-14 skill_registry、§12 Q-07 已决 S-A1↔clue-scan↔AGP-DISC）
> ｜ `../../docs/03-locks/external-deps.md`（A-1 LLM ⬜ 未提供（最大风险）；A-2 MCP 客户端 ✅；A-3 指令加载与版本管理 ✅；A-4 Skill 加载 ✅）
> ｜ `../../docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle；其中 TC-C-M3-001 / TC-C-M4-001 为 LLM 产出契约，受 A-1 门禁未关闭限制）
>
> **本模块硬红线（与全局一致）**：生产零写（本目录只写 MD-13/MD-14，且只经本 README 列出的单一写入面）、真实返回禁模型替代、证据四要素、失败不否定结论；外部依赖门禁（A-1）未关闭前，推理相关用例一律 mock/demo、demo 值不进断言。

## 文件清单

| 文件 | 职责（F-xx 归属） | 状态 |
| ---- | ---- | ---- |
| `profile.js` | **F-13 角色指令配置**：MD-13/MD-14 **唯一写入面**（本模块首个写面）；`registerAgentProfile`（INSERT MD-13，agent_code UNIQUE 库级强制）、`getAgentProfile`（读）、`bumpAgentProfileVersion`（版本管理：同 agent_code 单行推进 current_version/doc_revision，**不新建行**）、`registerSkill`（INSERT MD-14，PK/UK/FK 库级强制）、`listAgentSkills`（读生效 Skill）、`composeAgentVersionSnapshot`（组装 F-06 任务态冻结用的 `agent_version_snapshot` 串） | ✅ F-13 已建 2026-09-20（**30 断言全绿**） |
| `test-f13.mjs` | F-13 用例执行器（node:sqlite + D1 适配层，载真实 DDL + 种子；断言读全字段 / 版本推进单行 / 注册 Skill 成功 / MD-14 PK-UK-FK 三反例 / MD-13 agent_code UNIQUE 反例 / 快照串形态对齐种子 / 静态零外部调用 + 唯一写入面） | ✅ 已建（**30 断言全绿**） |
| `discovery.js` | **F-14 围绕目标寻找线索**：纯编排层（**零写库**，不依赖 LLM）。`normalizeIntentionScore`（意向分归一 min(raw/threshold,1)，TC-U-M3-001）、`assembleDiscoveryPlan`（S-A1 发现任务调度：一阶段注入清单→确定性查证计划，含停止条件表达）、`summarizeCluesAsJourney`（S-A3 旅程线索归纳：按「谁在什么环节遇到什么现象」归类，每条须有人群/环节归属、拒裸变化）、`loadDiscoveryContext`（薄读：复用 shared-context 读面装配注入清单，不新增写面） | ✅ F-14 已建 2026-09-20（**33 断言全绿**） |
| `test-f14.mjs` | F-14 用例执行器（纯函数段不依赖 D1；`loadDiscoveryContext` 用 fake-db stub 验「复用读面 + 零写」；断言意向分归一（含封顶/除零防护）/ S-A1 计划有序+停止条件+sources 过滤 / S-A3 归属+拒裸变化+evidence 透传 / 零写 / 静态零外部调用 + 单一读面 import） | ✅ 已建（**33 断言全绿**） |
| `verification.js` | **F-15 基础查证**：S-A2 指标查证闭环 + 五项检查（**零自有写语句**——EXT-01 归 M5、EXT-02 归 F-09）。`runMetricVerification`（经 M5 `runQueryWithRecovery` 真实查询→查询事实；**硬红线：只有真实 ok 才 `verified=true`，`model_expectation`/`expected_summary` 被显式忽略**）、`verifyFiveChecks`（来源/适用范围/信息时点/已有机会/信息缺口；缺口口径读 CFG-05、已有机会比对读 MD-06）、`isolateContradictedEvidence`（TC-A-M3-006 倒挂隔离）、`resolveMissingFields`（TC-A-M3-005 退回请补）、`buildTentativeExplanation`（标「尚未验证」、不下 HVA 判断）、`buildEvidenceDraft`/`recordVerificationEvidence`（EXT-02 草稿 + 复用 F-09 `createEvidence` 落库）、`verifyClueAndDraftEvidence`（一步编排）、`parseStamp`（时点抽取，倒挂判定基础） | ✅ F-15 已建 2026-09-20（**87 断言全绿**） |
| `test-f15.mjs` | F-15 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子 + **注入式 transport**（复用 `prototype/mock/scenarios.js`）；断言经 M5 真实查询透传（含哨兵串证「模型预期不进事实」）/ 五项检查齐备与缺口标注 / 倒挂隔离非整包失败 / 缺字段退回请补 / 证据草稿四要素 + 落 EXT-02 回查 / 一步编排成败两路 / `parseStamp` / 静态零外部调用 + 零写语句 + 读语句仅 CFG-05） | ✅ 已建（**87 断言全绿**） |
| `opportunity.js` | **F-16 机会形成与去重**：S-A4 整理（**零自有写语句、零裸 SQL**——MD-06 归 F-10 `createOpportunity`、LNK-03 归 F-10 `linkOpportunityRelation`，取号/判重走读面）。`nextOpportunityId`/`nextOpportunityRelationId`（`OPP-NNN`/`LK-OR-NNN` 库内最大+1）、`buildOpportunitySixElements`（六要素组装 + 二态判定）、`hasEnoughBasis`（依据足够性：真实返回/来源可回查/未倒挂/六要素**已评估**齐备/标题可派生；适用范围未判定**不阻断**记 caveat）、`buildGapRecord`（缺口记录：检查范围+信息缺口+影响判断，**不落表**）、`formOpportunityOrGap`（S-A4 编排：足够→机会记录(+判重关联 `same_issue`)；不足→缺口记录且**不写任何表**） | ✅ F-16 已建 2026-09-20（**73 断言全绿**） |
| `test-f16.mjs` | F-16 用例执行器（node:sqlite + D1 适配层，载真实 DDL/种子 + 结构性注入的 F-15 查证结果；断言依据足够→落 MD-06 六要素+二态 / 依据不足→缺口记录且**行数不变** / unknown 未评估判不齐 / unknown 纯空白串显式拒 / 判重命中→LNK-03 `same_issue` 方向 / 取号推进 / 缺口记录结构 / 纯函数与 caveat / 静态零外部调用 + 零写语句 + 零裸 SQL + 唯一依赖 shared-context） | ✅ 已建（**73 断言全绿**） |

## F-13 已通过用例（`test-f13.mjs`，30 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 读角色指令 | 种子 `AGP-DISC`/`AGP-HVA` | 全字段形态正确；不存在的 agent_code → null（只读不报错） |
| ② 版本管理 | F-13 版本管理口径 | `bumpAgentProfileVersion` 推进 v1.3/r10，行数不变（UNIQUE 单行）；不存在的 agent_code → 影响 0 行不报错 |
| ③ 注册 Skill | F-13 能力登记 | 插新 `S-A2` 绑 discovery-agent 成功；discovery-agent 现有 2 个生效 Skill；hva-agent 仅 `S-B1` |
| ④ MD-14 三反例 | **TC-D-M3-002** | 重复 `skill_no='S-A1'` → PK 拒绝（UNIQUE constraint failed: skill_registry.skill_no）；重复 `skill_code='clue-scan'` → UK 拒绝；错 `bound_agent_code` → FK 失败 |
| ⑤ MD-13 UNIQUE 反例 | **TC-D-M3-001** | 重复 `agent_code='discovery-agent'` → UNIQUE 拒绝（该 UK 承载 MD-14 外键）；新 agent_code 可正常注册 |
| ⑥ 版本快照 | F-06 任务态冻结口径 | `composeAgentVersionSnapshot(discovery-agent)` ＝ `discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0`，与种子 `task.agent_version_snapshot` 逐字一致 |
| ⑦ 静态核验 | 单一写入面纪律 | 零外部 HTTP 调用；写语句目标仅限 `agent_profile`/`skill_registry`；`profile.js` 不 import 任何其它模块 |

## F-14 已通过用例（`test-f14.mjs`，33 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 意向分归一 | **TC-U-M3-001** | `1.3/1.0→1.0`（封顶）、`0.5/1.0→0.5`、`0.8/1.0→0.8`、`1.0/1.0→1.0`、`2.5/2.0→1.0`；`threshold=0` 除零防护回退 raw 本身（不崩） |
| ② S-A1 查证计划 | **TC-A-M3-001** | 缺 `goal` 抛错；默认 4 步、`step_no` 1..4 连续递增（先查/后查有序）；每项含 `check_item`/`data_source`/`tool`/`reason`/`stop_when_enough`；数据源顺序 `CDP>HJE>MKT>ACT`；停止条件＝计划内查证完成或依据已足够、且「不强制跑满」；`sources` 过滤（仅 CDP→1 步）；未命中数据源抛错 |
| ③ S-A3 线索归纳 | **TC-A-M3-003** | 有效线索 3 条（含人群/环节归属）；裸变化（无归属）被排除且计入 `unattributed_count=1`；每条有效线索 `attribution` 以 `audience:`/`journey:` 开头；无 `unattributed` 伪归属混入；`evidence_refs` 透传；同 fact 有人群+环节时以 `audience` 前缀归并 |
| ④ 注入清单装配 | F-14 薄读口径 | `loadDiscoveryContext` 返回六键注入清单；fake-db stub 下 prepare 语句**无 INSERT/UPDATE/DELETE（零写）**；确实经 prepare 调用了读面 |
| ⑤ 静态核验 | 零写 / 零外部调用纪律 | 无 `fetch` / 无 http(s) 字面；本文件无裸写语句字面（零写库）；唯一业务 `import` 来自 `../shared-context/index.js`；不 import `node:sqlite` / `tool-executor` / `task-runner` |

## F-15 已通过用例（`test-f15.mjs`，87 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① S-A2 真实查询 | **TC-A-M3-002** / **TC-I-M3-002** | 缺 `task_id`/`tool_id` 抛错；真实 ok → `verified=true`、`result_summary` 与注入返回体**逐字一致**（原样透传）、带 `query_id`/`source_id`/`queried_at`、EXT-01 已落痕；**哨兵串证硬红线**：传 `model_expectation` 后输出任何字段都**不含该串**且 `used_model_expectation=false`；失败 → `verified=false`、`result_summary=null`、`fail_reason` 原样透传（含真实错误码）；无授权 → 受限且 **transport 零调用**（不发起外部调用） |
| ② 五项检查 | **BRD §4 F-15**（L191-195）| 五项齐备（`source`/`applicability`/`info_time_point`/`existing_opportunity`/`gap`）；来源可回查（`query_id`）；适用范围命中目标范围→通过；信息时点未晚于取数时刻→不倒挂；已有机会命中（带 `hits`/`hit_count`）；缺口按 CFG-05 **4 条规则逐条核对**（每条带 `rule_id`/`target_field`/`gap_text`/`impact_note`），文本含渠道 → GAP-3 视为已写清、文本未提退款 → GAP-1 如实列为待补（**不静默放过**）；`all_present=true`；初步解释含「尚未验证」「值得进一步研究」「不下 HVA 判断」且**不含结论性措辞**；目标未声明范围 → 适用范围记**未知**且 `all_present=false` |
| ③ 倒挂隔离 | **TC-A-M3-006** | 3 条证据中 1 条晚于取数时刻 → **仅该条** `isolated`（原因 `info_time_point_after_fetch`）、其余 2 条照常参与、`batch_failed=false`（**非整包失败**）；无倒挂 → 全部参与；缺 `at` / 入参非数组抛错；倒挂事实在五项检查里 `contradicted=true` 且**不予采用**为证据草稿（`reason=contradicted_evidence_isolated`） |
| ④ 缺字段退回请补 | **TC-A-M3-005** | 缺 `missing_note` → `action='request_supplement'`、精确列出缺项、**`draft=null`（不返回半成品）**、口径含「不静默回退」「不编造」、含补齐指引；齐备 → `accept`；`required_fields` 为空抛错（**不隐式取默认**） |
| ⑤ 证据草稿与落库 | EXT-02 四要素 / F-09 单一写入面 | 四要素齐 → `completeness.valid=true`；草稿含来源/条件/时点/适用范围 + `missing_note`（缺口随依据留痕）；经 `recordVerificationEvidence` **复用 F-09 `createEvidence`** 落 EXT-02 并回查（挂真实 `query_id`/`source_id`）；四要素不齐 → 由 F-09 拒绝落库（实际未落行） |
| ⑥ 一步编排 | F-15 输入→输出契约 | 真实返回 → `verified=true` + 五项检查 + 证据草稿 + 初步解释，且**全链路不出现模型预期哨兵串**；未取得真实返回 → `checks`/`evidence` 均空、失败原因原样、口径含「不编造」且给出「退回请补」 |
| ⑦ 时点抽取 | 倒挂判定基础 | 从自由文本抽**首个**可识别时点（取数时刻优先）；`2026-9-6`→`2026-09-06 00:00`（补零）；无可识别时点 → `null`（**不猜**） |
| ⑧ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零写语句**（实测命中 0）；外部访问**只经 M5**（import `../tool-executor/index.js`）；读语句**仅面向 CFG-05** `gap_rule`；证据落库走 F-09 `createEvidence`；不 import `node:sqlite`/`node:fs`/`task-runner` |

## F-16 已通过用例（`test-f16.mjs`，73 断言）

| 组别 | oracle 来源 | 关键断言 |
| ---- | ---- | ---- |
| ① 依据足够→机会记录 | **TC-A-M3-004** | `outcome=opportunity`、取号 `OPP-015`（库内最大 014 +1）；MD-06 新增 1 行且**MD-07/EXT-02 行数不变**（F-16 止于机会）；六要素逐项落库（对应目标两列 / 涉及对象来自线索归属 / 观察现象 / 研究理由 / 初步依据含可回查查询号+来源）；`unknown_item=''`（二态·确无）且 `six_elements_complete=true`、`pending_supplement=false`；默认状态 `candidate` |
| ② 依据不足→缺口记录 | **TC-A-M3-004**（合法产出） | 未取得真实返回 → `outcome=gap`、`opportunity_id=null`；**MD-06 与 LNK-03 行数均不变（零写库）**；`basis.required.real_return=false` |
| ③ unknown 未评估 | **ADR-003**（Q-05） | `unknown_item` 未提供 → `not_assessed`、`pending_supplement=true`、`six_elements_complete=false` → 判**不齐**退回缺口（**不放过漏评估**）；不写库 |
| ④ unknown 纯空白串 | **ADR-003**（应用层须拒） | `'   '` → 抛错（**不静默降级**）；有实义未知项 → 正常形成机会且计入齐全（`has_unknown` 是合法态） |
| ⑤ 判重命中→关联更新 | **TC-A-M3-004** | 命中已有机会 → 仍形成新机会（新现象有独立价值）且落 LNK-03 `LK-OR-003`：`from=OPP-013`（已有机会）`to=OPP-015`（新机会）`kind=same_issue`（**方向对齐种子 LK-OR-002**）；关联可按机会反查；再跑一次按新机会逐个登记（`OPP-016`）方向口径稳定 |
| ⑥ 取号 | 全库口径 | `nextOpportunityId=OPP-015`、`nextOpportunityRelationId=LK-OR-003`（确定性、可回查） |
| ⑦ 缺口记录结构 | **PRD-M3** F-16 | `scope_checked`（目标 id / 业务范围 / 比对关键词）；`info_gaps` 非空且区分来源（`query_failed` / `evidence_isolated` / `cfg05_gap_rule` / `six_elements`）；`affected_judgements` 非空；倒挂 → 判依据不足（`not_contradicted=false`） |
| ⑧ 纯函数与 caveat | F-16 判据口径 | 标题派生（取现象 / 显式优先 / 无来源→null / 截断 80）；六要素装配含 `unknown_item`；**适用范围未判定不阻断**（`caveats.scope_decided=false` 而 `enough=true`，仍形成机会由人工节点复核）；`hasEnoughBasis` 返回结构稳定 |
| ⑨ 静态核验 | 硬红线纪律 | 零 `fetch(`、无 http(s) 字面；**零自有写语句**（实测命中 0）；**零裸 SQL**（`SELECT` 实测 0，取号/判重走读面）；唯一 `import` 来自 `../shared-context/index.js`；不反向依赖 `task-runner`/`tool-executor` |

## HTTP 路由面（`server/api/index.js`，F-13/F-14/F-15/F-16 接入）

| 路由 | 职责 | 成功 / 错误码 |
| ---- | ---- | ---- |
| `GET /api/agent-profiles/{agent_code}` | 读角色指令 + 生效 Skills + 版本快照 | 200；角色指令不存在 404 |
| `POST /api/agent-profiles/{agent_code}/version` | 推进 agent.md 版本（单行 UNIQUE、不新建行） | 200；版本号必填缺失 400 |
| `POST /api/skills` | 注册 Skill（PK/UK/FK 库级强制） | 201；必填缺失 400；约束冲突 409 |
| `POST /api/discovery-plan` | F-14 · S-A1 一阶段注入清单→确定性查证计划（纯计算、零写库） | 200；缺 `goal` 400；`sources` 未命中 400 |
| `GET /api/discovery-context/{task_id}` | F-14 · 装配一阶段注入清单（薄读，复用 shared-context 读面） | 200；task 不存在 404 |
| `POST /api/clue-summary` | F-14 · S-A3 查证事实集合→按人群/旅程环节归类（纯计算、拒裸变化） | 200；入参非数组 400 |
| `POST /api/intention-score` | F-14 · 意向分归一 min(raw/threshold,1)（TC-U-M3-001，纯计算） | 200；`intention_raw` 非数值 400 |
| `POST /api/metric-verification` | F-15 · S-A2 指标查证一次闭环（经 M5 真实查询 + 五项检查 + 证据草稿 + 初步解释） | 201（真实返回）；失败/受限 202（只回报真实原因，不编造） |
| `POST /api/five-checks` | F-15 · 五项检查（来源/适用范围/信息时点/已有机会/信息缺口） | 200；缺 `fact`/`at` 400 |
| `POST /api/evidence-isolation` | F-15 · 倒挂隔离（TC-A-M3-006，纯计算，非整包失败） | 200；缺 `at` 400 |
| `POST /api/missing-fields` | F-15 · 只松不严不硬映射（TC-A-M3-005，纯计算，缺字段退回请补） | 200；`required_fields` 为空 400 |
| `POST /api/verification-evidence` | F-15 · 装配 EXT-02 形态证据草稿；`persist=true` 时复用 F-09 落库 | 200（仅草稿）/ 201（已落库）；四要素不齐 409 |
| `POST /api/verification-query` | F-15 · 只跑一次真实查询供排查（不含五项检查与草稿） | 201（真实返回）；202（失败/受限） |
| `POST /api/opportunity-formation` | F-16 · S-A4 整理：依据足够→机会记录（MD-06）+ 判重关联（LNK-03）；不足→缺口记录且不写库 | 201（形成机会）/ 200（缺口记录，合法产出）；缺 `verification` 400；未知项非法 400；约束冲突 409 |
| `POST /api/opportunity-six-elements` | F-16 · 六要素组装 + 二态判定（纯计算，不写库） | 200 |
| `POST /api/opportunity-basis` | F-16 · 依据足够性判定（纯计算：真实返回/来源可回查/未倒挂/六要素已评估齐备/标题可派生） | 200 |
| `POST /api/opportunity-gap-record` | F-16 · 缺口记录（检查范围 + 信息缺口 + 影响判断，纯计算，不落表） | 200 |
| `GET /api/opportunity-next-id` | F-16 · 取号（`OPP-NNN` / `LK-OR-NNN`，库内最大 +1） | 200 |

## 口径（本模块已定，含登记在案的取舍）

### 1. F-13 角色指令配置（M3/M4 共用领域能力底座）

**① 单一写入面**：`profile.js` 是 **MD-13 `agent_profile` / MD-14 `skill_registry` 的首个（也是唯一）写入面**；零外部调用、不调 LLM（A-1 门禁只挡推理，不挡本文件的配置与版本管理）。

**② 版本管理＝同 agent_code 单行版本号推进**：`agent_profile.agent_code` 为 UNIQUE（DDL L120，承载 MD-14 外键），故版本升级只 `UPDATE` 同行的 `current_version`/`doc_revision`，**不新建行**、历史版本不落表——任务启动时由 F-06 落 `task.agent_version_snapshot` 冻结快照（见⑥）。

**③ Skill 编号对齐宪法（Q-07 已决 2026-09-19）**：`skill_no`（`S-Ax`/`S-Bx`）作主键、`skill_code`（`clue-scan`/`hva-five-checks`）降为 UK；`bound_agent_code` FK → `agent_profile.agent_code`。三反例（PK/UK/FK）由库级强制，断言见④。

**④ LLM 门禁边界（明确登记）**：**TC-C-M3-001 / TC-C-M4-001（Agent 产出结构化 JSON，response_format=json_schema 强制；strict 只卡外层可解析性）属 A-1 LLM 推理契约，A-1（LLM 推理服务）当前 ⬜ 未提供（external-deps §7 最大风险）**——本文件不实现推理，`test-f13` 只验能力登记与版本管理；该 oracle 项**登记为「门禁未关闭、非发布门禁」**，待 A-1 落实后由 F-14~F-22 补验。

**⑤ 不复制中文枚举**：`agent_code` 值域（discovery-agent/hva-agent）由 `dict:AGENT_CODE`（种子 DI-083/084）承担，本文件不内联字典；约束失败（UNIQUE/PK/FK）抛出 Error，与 F-26 `task-state.js` 一致（`run()` 失败即抛）。

### 2. F-14 围绕目标寻找线索（M3 找线索核心 · 纯编排）

**① 零写库 + 单读面复用**：`discovery.js` 所有导出均为**纯计算**（`normalizeIntentionScore` / `assembleDiscoveryPlan` / `summarizeCluesAsJourney`）或**读面复用**（`loadDiscoveryContext` 调 `shared-context.getTaskContext`/`getResearch`），**不 INSERT/UPDATE/DELETE 任何表**；唯一业务 `import` 来自 `../shared-context/index.js`。与 F-13 不同，F-14 无独立写面（M3 的写面由 M2 shared-context 承担）。

**② LLM 门禁边界（mock/demo 推进，明确登记）**：S-A1/S-A3 的**真实运行须 LLM（A-1）**，A-1 当前 ⬜ 未提供——本文件在门禁关闭前提供**确定性 fallback 编排**；**`TC-A-M3-001`/`TC-A-M3-003` 的 LLM 产出契约登记为「门禁未关闭、非发布门禁」**，`test-f14` 只验「输出结构契约」（计划有序 / 每条线索有归属），**不验真实 LLM 产出、demo 值不进断言**。

**③ 确定性领域规则（查证顺序与停止条件）**：默认查证顺序 `CDP（人群差异）> HJE（行为/转化）> MKT（反馈）> ACT（业务信息）`，与 `PRD-M3` L74-75 数据源及 TOL-01~06 一一对应；停止条件＝**计划内查证完成 或 依据已足够**（`stop_when_enough` 命中），**不强制跑满全部步骤**（S-A1 验收）。

**④ 线索须关联人群/旅程（PRD-M3 约束 2）**：`summarizeCluesAsJourney` 每条有效线索的 `attribution` 均以 `audience:` 或 `journey:` 开头；**裸变化（既无人群也无环节归属）不进有效线索**，单独计入 `unattributed_count`（对应「禁止仅罗列一组变化」）。

**⑤ 意向分归一（TC-U-M3-001）**：`min(raw/threshold, 1)` 封顶 1，确定性无随机；`threshold≤0` 除零防护回退 `raw` 本身。该函数为 F-14/F-15 共用。

### 3. F-15 基础查证（M3 查证核心 · 经 M5 真实查询）

**① 零自有写语句 + 双面复用**：`verification.js` 自己**不含任何 `INSERT`/`UPDATE`/`DELETE`**（`test-f15` ⑧ 静态断言）——查询与留痕（EXT-01）**全经 M5** `runQueryWithRecovery`，证据（EXT-02）**全经 F-09** `createEvidence`。外部访问也**只经 M5**（唯一出口），对应 `TC-I-M3-002`「所有外部查询经 M5、只读」。

**② 硬红线「禁止以模型预期内容代替查询结果」（TC-A-M3-002）**：`result_summary` 一律**原样透传**自 M5 信封（`mapResponseToResult` 本就不生成业务结论）；**只有 `result_status='ok'` 才置 `verified=true`**。调用方若传 `model_expectation`/`expected_summary`，本文件**显式忽略**并留 `used_model_expectation:false` / `model_expectation_ignored` 供核查；`test-f15` 用**哨兵串**证明该串不出现在任何输出字段里（含全链路一步编排）。

**③ 五项检查（BRD §4 F-15）**：`source`（哪份资料哪次查询，`query_id`/`source_id` 可回查）、`applicability`（人群/渠道/旅程环节是否对应当前目标；**目标未声明范围时记「未知」，不猜**）、`info_time_point`（业务条件是否已变化 + **倒挂判定**）、`existing_opportunity`（是否记录过相同问题：按关键词与 MD-06 已有机会的标题/现象比对，命中列出并**建议关联更新而非新建**）、`gap`（还缺什么、缺失影响哪项判断：**规则来自库内 CFG-05 `gap_rule`**（`is_active=1`，`match_pattern` 未命中即开放缺口），**不内联口径字典**）。`all_present` ＝ 五项都给出了肯定判定，**不把「未知」当通过**。

**④ 倒挂隔离（TC-A-M3-006，ADR-003 二态精神）**：证据**信息时点晚于取数时刻** → 视为倒挂 → **仅该条失效**（`isolateContradictedEvidence` 返回 `kept`/`isolated`），**其余证据照常参与**、`batch_failed=false`（**不污染全量**）；倒挂事实**不予采用**为证据草稿。时点抽取由 `parseStamp` 承担，抽不到时点则**不做倒挂判定**（不猜）。

**⑤ 缺字段只松不严不硬映射（TC-A-M3-005）**：`resolveMissingFields` 缺必填字段即返回 `action='request_supplement'` 且 **`draft=null`（不返回半成品）**——**不静默回退、不编造**；「素材已过审但查不到」同样退回请补（见 `guidance`）。必填字段须**显式传入**，不隐式取默认。

**⑥ 初步解释口径（BRD §4 验收）**：`buildTentativeExplanation` 一律标明「尚未验证」的部分、支持「值得进一步研究」，并明示**不给完整人群对照、不下 HVA 判断**；`FORBIDDEN_CONCLUSION_PATTERNS`（已确认/已证实/可以确认/必然/结论为/证明该）为**可静态核对的禁词表**，`test-f15` ② 断言解释文本不含之。

**⑦ LLM 门禁边界（mock/demo 推进，明确登记）**：把自然语言线索转成「待查指标＋范围」须 LLM（**A-1 ⬜ 未提供**）——本文件提供**确定性编排**，门禁关闭前只用**注入返回体**（`transport` 注入，复用 `prototype/mock/scenarios.js`）验证结构契约；**`TC-A-M3-002` 的真实 LLM 产出契约登记为「门禁未关闭、非发布门禁」**，demo 值不进断言。

### 4. F-16 机会形成与去重（M3 整理核心 · 止于机会）

**① 零自有写语句 + 双面复用**：`opportunity.js` 自己**不含任何 `INSERT`/`UPDATE`/`DELETE`**、**不含 `SELECT`**（`test-f16` ⑨ 静态断言）——MD-06 经 F-10 `createOpportunity`、LNK-03 经 F-10 `linkOpportunityRelation`，**取号与判重也走读面**（`listOpportunities` / `listOpportunityRelations`）。唯一业务 `import` 来自 `../shared-context/index.js`。

**② 「依据足够」的确定性判据（必要条件全满足）**：`real_return`（**拿到真实返回**：`fact.ok` 且 `verified`——不允许以模型预期代替查询结果）＋ `source_traceable`（来源可回查）＋ `not_contradicted`（未倒挂）＋ `six_elements_complete`（六要素**都被评估过**，ADR-003）＋ `title_present`（`opportunity_title` 是 NOT NULL 列）。任缺其一 → **退回缺口记录**（不硬凑）。

**③ 依据不足是合法产出（TC-A-M3-004）**：`outcome='gap'` 时返回**缺口记录**（`scope_checked` 检查范围 + `info_gaps` 信息缺口 + `affected_judgements` 影响哪项判断）且**不写任何表**——「允许本轮不产生新机会」。HTTP 层据此回 **200 而非错误**（缺口不是失败）。缺口**不落表**：schema 无缺口专表，缺口的出处是 `EXT-02.missing_note` 与 `CFG-01.capability_cannot`。

**④ 六要素二态（ADR-003 / Q-05）**：`unknown_item` `NULL`＝未评估（→ 不齐、触发待补）／`''`＝已评估且确无（→ 计入齐全）／文本＝有未知项（→ 亦计入齐全，留待后续核对）；**纯空白串→应用层显式拒**（库级 `NOT NULL` 拦不住空白串）。六要素之外的 `opportunity_title` 单独派生（显式优先，否则取现象、截断 80）。

**⑤ 去重＝「对照已有机会判重」+ 相同问题关联更新**：判重**复用 F-15 五项检查的 `existing_opportunity.matches`**（不另造一套关键词逻辑）；命中 → 仍形成新机会（新现象有独立价值）**并**落 LNK-03「相同问题关联」。**关系方向对齐种子 `LK-OR-002`**：`from`＝已有机会（原机会）、`to`＝新机会，`kind=same_issue`。

**⑥ 止于机会、不下 HVA 判断（PRD-M3 §4 红线 1）**：本文件只产出「机会＋初步依据」或「缺口记录」，**不输出生产动作**、不下 HVA 结论（该项归 M4）。

**⑦ 适用范围未判定不阻断**：目标未声明业务范围时，F-15 五项检查的 `applicability` 记「未知」——本文件把它作为 **caveat**（`caveats.scope_decided=false`）随机会记录一并暴露，**不因此丢弃已成立的证据**，由后续人工节点（F-03）复核。

## 反向清单

- **下游（我被谁引用）**：`../api/index.js`（**F-13 / F-14 / F-15 / F-16 路由**）｜阶段4 `../agent-orchestrator` 后续 F-17~F-22（消费 `getAgentProfile` / `composeAgentVersionSnapshot` 装配运行期上下文；`discovery.js` 的 `loadDiscoveryContext` 供 F-15 复用注入清单；`verification.js` 的 `verifyClueAndDraftEvidence`/`buildEvidenceDraft` 供 **F-16 机会形成与去重**消费「查证结果 → 机会或缺口记录」；`opportunity.js` 的 `formOpportunityOrGap` 供 **F-17 两步衔接**消费「机会记录 → PM 决策上下文」）｜`../task-runner`（F-02 发现任务、F-06 任务态冻结版本快照）复用 `composeAgentVersionSnapshot`
- **上游（我引用谁）**：`../../db`（DDL/种子，MD-13/MD-14 真源）｜`discovery.js` 引用 `../shared-context/index.js`（读面：`getTaskContext`/`getResearch`）｜`verification.js` 引用 `../tool-executor/index.js`（**M5**：`runQueryWithRecovery` / `RETRY_OUTCOME`）与 `../shared-context/index.js`（读面 `listOpportunities` + **F-09 写入面** `createEvidence`/`validateEvidenceCompleteness`）｜`opportunity.js` 引用 `../shared-context/index.js`（**F-10 写入面** `createOpportunity`/`linkOpportunityRelation` + 读面 `listOpportunities`/`listOpportunityRelations` + 纯函数 `assessOpportunitySixElements`）
- **文件间引用（本目录内）**：`profile.js` 为底层写面，被 `../api/index.js` 与后续 F-14~F-22 消费；`discovery.js` 为 F-14 纯编排层（零写库），本目录内不被其它文件 import（由 `../api/index.js` 消费）；`verification.js` 为 F-15 编排层（**零自有写语句**），同样只由 `../api/index.js` 消费、不被本目录其它文件 import；`opportunity.js` 为 F-16 编排层（**零自有写语句、零裸 SQL**），同样只由 `../api/index.js` 消费（F-17 两步衔接将复用其 `formOpportunityOrGap`）；`test-f13.mjs`/`test-f14.mjs`/`test-f15.mjs`/`test-f16.mjs` 仅用作 CI 验证，不进运行期

## 种子基线（本模块相关，只读参照）

`agent_profile` 2 行（`AGP-DISC`/`AGP-HVA`）、`skill_registry` 2 行（`S-A1`/`S-B1`）已由 `db/seed/0001_mock.sql` 落库，本模块运行期只改行（版本推进）、不增删基线行（新增 Skill 经 `registerSkill` 走业务写入面，非种子）。

**F-15 额外只读参照**（不属本模块写入面、运行期以只读消费）：`gap_rule` 4 行（`GAP-1`~`GAP-4`，口径规则真源，F-15 的「信息缺口」检查逐条读它）、`opportunity` 8 行（「已有机会」比对读它）、`evidence` 7 行（EXT-02，回查链验证用）。F-15 **不新增种子行**：证据由 F-09 写入面按业务写入（`test-f15` ⑤ 落 `EV-9001` 后回查）。

**F-16 额外只读参照 / 基线推进**：`opportunity` 8 行（`OPP-005`~`OPP-014`，判重比对与取号基准读它）、`opportunity_relation` 2 行（`LK-OR-001` `superseded` / `LK-OR-002` `same_issue`，**F-16 的 `same_issue` 方向口径以其为准**）。F-16 **不新增种子行**：机会与关系均由 F-10 写入面按业务写入（`test-f16` ①/⑤ 落 `OPP-015`/`OPP-016` + `LK-OR-003` 后回查）；种子 `opportunity` 的 `unknown_item` **全部非空**（原型只呈现「有未知项」一态），二态中的 `NULL`/`''` 由 ADR-003 补齐、由 F-16 判定与写入侧承担。
