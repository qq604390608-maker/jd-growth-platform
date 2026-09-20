# frontend/ · README

> 前端（**前后端分离**）。承载 M6 运营端工作台六页面 `F-27~F-32`，形态是**零构建静态资源**（HTML + 原生 JS + 自定义 CSS），**与 API 同源**，所有动态数据一律经 `server/api`。

## 1. 上游

- 宪法：`../AGENTS.md`（索引 `frontend/` 行；白盒原则；双向引用；索引三层）
- 需求：`../docs/01-brd/BRD.md`（M6 F-27~F-32；§5.3 硬红线）；`../docs/02-prd/PRD-M6-运营端工作台.md`
- 锁定：`../docs/03-locks/tech-stack.md`（**§1.2 前后端分离的落点与判断标准**；**§2.1 前端形态＝零构建静态资源，数据来源＝`server/api`，原型的 mock 数据不复制进前端**；§6 工程结构）；`../docs/03-locks/schema.md`（六要素与各表口径）
- 用例：`../docs/05-test-cases/test-M6.md`（`TC-I-M6-001` 目标配置页 / `TC-I-M6-002` 机会列表与详情页 / **`TC-I-M6-003` 研究建议提交页** / **`TC-I-M6-004` 研究结果页** / **`TC-I-M6-005` 追问对话页** / **`TC-I-M6-006` 任务与状态页** / `TC-C-M6-001` 契约 / `TC-D-M6-001` 前端不写库 / `TC-I-M6-007` 前后端分离判断标准）
- 实证：`../prototype/`（**钉死需求的实证**：各页区块 / 交互 / 文案以原型为准；原型使命已完成，仅作证据保留）
- 接口真源：`../server/api/index.js`（路由）+ `../server/task-runner/`、`../server/shared-context/` 等（返回体结构）

## 2. 交付口径（硬约定）

| 项 | 口径 |
| ---- | ---- |
| 形态 | **零构建**：静态 HTML / CSS / 原生 JS，无打包器、无框架（构建工具已否决，见 tech-stack DS-05；轻量组件复用手段 TS-13 待确认） |
| 部署 | **与 API 同源**：请求路径一律 `/api/...` 相对路径，免除 CORS 与凭证跨域（tech-stack §1.2）；同源的具体绑定方式见 §4 缺口 3 |
| 唯一网络出口 | `assets/api.js`。全站再无第二处 `fetch`——已做成可静态扫描的断言 |
| 数据来源 | 只读消费 `server/api` 的 JSON。**前端不直连数据库、不持有任何外部系统凭证** |
| 业务逻辑 | **零**。前端只做「取数 → 渲染 → 发动作」，判断逻辑一律在后端（PRD-M6 §1） |
| 业务数据落点 | **只在服务端**。前端 `localStorage` 仅存会话态（当前浏览目标、未读绿点），不入库、不回传（schema.md §8.1 已判定不建表） |
| 不做什么 | 不复制原型的 mock 数据；**不自造端点**（前端只按 `server/api` 既有路由拼路径）；不复制第二个六要素口径——目标六要素键取自服务端 `GOAL_FIELDS`，机会六要素键与标签取自服务端 `OPPORTUNITY_SIX_ELEMENTS` / `OPPORTUNITY_SIX_ELEMENT_LABELS`；**证据回查一律走 `GET /api/evidence-trace/{id}`**，不自己拼「证据 + 查询记录」 |

## 3. 目录

| 文件 | 功能点 | 职责 | 状态 |
| ---- | ---- | ---- | ---- |
| `index.html` | —（外壳，非功能点） | 前端入口：六页面进度（已建 / 待建）+ 当前浏览目标（口径与版本读服务端） | ✅ 已建（2026-09-20） |
| `assets/base.css` | — | 共享样式：设计令牌、卡片、徽章、表单、对话。自 `../prototype/assets/base.css` 沿用（剥离原型头部注释、加本目录文档卡），无外部资源引用 | ✅ 已建（2026-09-20） |
| `assets/api.js` | — | **唯一数据出口**：把 `server/api` 收成薄封装（统一 JSON / 统一错误映射 / 统一同源约束）。两条运行期守卫——路径必须 `/api/` 开头、不得是绝对地址（含 `://` 即抛错不发请求） | ✅ 已建（2026-09-20） |
| `assets/app.js` | — | 跨页共享逻辑：外壳注入与导航、目标解析、版本与运行链派生、未读绿点、通用工具（`window.U` / `window.PX`）。六要素键与序号取自服务端口径 | ✅ 已建（2026-09-20） |
| `pages/goal.html` | **F-27** | 目标配置：选择 / 新建目标 → 编辑六要素 → 保存为新版本（自动跑一次口径检查）→ 口径待补项以任务形式提示（可逐项补充）→ 「应用配置」使版本生效并触发机会发现（F-02） | ✅ 已建（2026-09-20） |
| `pages/opportunities.html` | **F-28** | 机会列表与详情（原型两页合并的左右布局一页）：按目标浏览机会（三状态 + 对象筛选）→ 详情＝机会六要素 + 未知项二态 + 证据链（点开即回查 `/api/evidence-trace/`）＋可用来源与工具 → 人工处置（提交研究建议 F-29 / 标记暂不研究 / 恢复为候选 / 查看研究结果 F-30）。**准入条件**：目标从未执行过机会发现且无产出 → 门禁态（与「空态」刻意分开） | ✅ 已建（2026-09-20） |
| `pages/propose.html` | **F-29** | 研究建议提交（人工节点）：已选机会**只读**（来自 F-28 的 `?opp=`、未带时取该目标第一条候选）→ 研究问题（必需，边填边看「还需补什么」）→ 可选补候选行为假设 / 人群限制 → 提交落 MD-12（服务端判幂等）→ **触发 F-04** 建 HVA 研究任务。**幂等命中时不再触发 F-04**；「是否已提交过」以 MD-12 **事实行**为准，不看机会状态列。**准入**：与 F-28 共用同一条硬门禁 | ✅ 已建（2026-09-20） |
| `pages/result.html` | **F-30** | 研究结果页：只读呈现一次研究的**结果七要素**（① 业务目标与研究问题 / ② 研究范围与方法 / ③ 证据与关键发现 / ④ 人群差异 / ⑤ 候选 HVA 及支持情况 / ⑥ 其他解释与限制 / ⑦ 改善方向）；页头含研究切换器（全量 `GET /api/research`）+ 对应机会 / 目标版本 / 完成时间；③ 关键发现以「已查明」视觉（绿左线）呈现、每条发现下挂证据折叠（点开才回查 `GET /api/evidence-trace/{id}`，同 F-28）；⑤ 候选行为支持 / 不支持两列并列；⑥ 以「仍受限」视觉（琥珀底）呈现，**与已查明明显可分**；顶部结论条据 `supported_count` 区分「有候选行为获得支持（仍属候选）」与「未找到足够依据支持候选行为，这也是完整的结果」 | ✅ 已建（2026-09-20） |
| `pages/followup.html` | **F-31** | 追问对话：基于原研究场景化追问（默认选 `R-006`，因 `R-007` 种子 `start_task_id=NULL` 不可建追问、不擅自改种子）→ 建 `hva_followup` 新任务（`parent_task_id` 挂原任务）＋新研究壳（`parent_research_no` 指原研究、`start_task_id` 指新任务），全部经既有 `POST /api/followup-tasks`（M1 F-05 `createFollowupTask` 写面只读封装，不自造端点）；页面呈现「已注入上下文」（取原研究关键字段 `research_question` / `evidence_link_count` / `goal_version_no`）＋「可调度工具」（来源名称、授权 `ok`／降级 `degraded` 徽标，来自 `GET /api/source-tool-briefing` 真实字段 `source_name` / `availability_status` / `capability_can`）；追问建议 chips；Agent 应答只回显 F-05 真实返回（新任务号／新研究号／`version_changed`／`tool_permissions` 数量），**不编造**查询结论 | ✅ 已建（2026-09-20） |
| `pages/tasks.html` | **F-32** | 任务与状态：只读呈现任务运行状态 / 受阻原因 / 已完成部分（三类事实分别可见：① 机会未被选中（MD-06 `deferred`/非 `submitted`，与 F-28 同一份事实源 `GET /api/opportunities`）② 任务未完成（来自目标记录 `rec.tasks`，运行状态 running／blocked／stopped）③ 研究未支持候选行为（F-21 七要素读面 `GET /api/research-result/{no}` 的 `e5_candidate_hva.unsupported_count`>0））；任务卡片含状态徽标（running/blocked/stopped/done，复用 app.js `STATUS`）、受阻原因（`f32Reason` 口径＝stopped→已停止、blocked 且 `block_reason_code='target_unclear'`→等待必要信息、其余 blocked→等待接口恢复）、已完成部分（`done_part` 真实字段）、启动依据；5 个过滤器 chips（全部／运行中／受阻／已停止／已完成）；取数经 `GET /api/task-blocks`（PD-03 读面，逐次留痕）＋ `GET /api/opportunities`（MD-06）＋ `GET /api/research`（MD-07）＋ `GET /api/research-result/{no}`（F-21 七要素读面）。**纯只读展示页（零写请求）**，状态机口径（BRD F-06 / M5 F-26）与后端共用、前端只做中文呈现不另立判据；默认按当前浏览目标过滤（`U.currentGoalId()`） | ✅ 已建（2026-09-20） |
| `test-f27.mjs` | F-27 | 用例执行器：jsdom 加载**真实页面** + 真实 Worker + 真实 D1（`node:sqlite` 载真实 DDL / 种子），10 组 130 断言 | ✅ 已建（2026-09-20；130 断言全绿） |
| `test-f28.mjs` | F-28 | 用例执行器：同上装置，11 组 **159 断言**。含**反例**——库级放行「适用范围＝纯空白串」的证据行，应用层判「四要素不齐 · 不可作为有效依据」 | ✅ 已建（2026-09-20；159 断言全绿） |
| `test-f29.mjs` | F-29 | 用例执行器：同上装置，12 组 **154 断言**。含**幂等反例**（重复提交后建议行 / 任务行均不变，且不再调 F-04）与**事实行反例**（机会状态为 `submitted` 却无建议行 → 不得谎报「已提交过」） | ✅ 已建（2026-09-20；154 断言全绿） |
| `test-f30.mjs` | F-30 | 用例执行器：同上装置，7 组 **88 断言**。含**对照双研究**（R-007 有候选行为获得支持 / R-006 未支持，结论条与改善方向随切换器重渲染）+ **证据点开回查**（点开才调 `GET /api/evidence-trace/{id}`，渲染四要素与可回查判据）+ **视觉可分断言**（`.res-established` 与 `.res-limited` 两套不同视觉）+ **只读断言**（全部请求经 `/api/`、仅 GET、零写） | ✅ 已建（2026-09-20；88 断言全绿） |
| `test-f31.mjs` | F-31 | 用例执行器：同上装置，7 组 **85 断言**。含**契约 oracle**（BRD `#### F-31 追问对话页`＋`追问建新任务并关联原研究`＋`基于通用 Agent 的场景化追问`；TC-I-M6-005 含 F-05／TC-I-M1-003；PRD-M6 含 PD-07／PD-01）＋**静态红线**（api.js 封装 `/api/followup-tasks`、followup.html 只引 api.js＋app.js＋base.css、只经 F-05 不调其它写面）＋**渲染默认 R-006**（5 字段逐字＋工具徽标＋chips≥4＋点 chip 填入输入框）＋**发送创建追问**（calls 含 `/api/followup-tasks`→201→`task.task_type='hva_followup'`、`parent_task_id='T-1021'`、`research.parent_research_no='R-006'`、`original_research.research_no='R-006'`、LNK-04、task_step、PD-06 4 行、PD-07+1、原研究逐字节不变）＋**空问题前置拒绝**（发请求前挡住、库不变）＋**前端只读**（全部经 `/api/`、仅 GET+1 个 POST、零写、localStorage 只含 applied/navUnread、业务数据不落存储、打开页面零写）＋**前后端分离**（server/db/scripts 零引用 frontend、直调 4 接口 200/201、无 `.json` 快照） | ✅ 已建（2026-09-20；85 断言全绿） |
| `test-f32.mjs` | F-32 | 用例执行器：同上装置，7 组 **77 断言**。含**契约 oracle**（BRD `#### F-32 任务与状态页`＋`任务运行状态`/`受阻原因`/`已完成部分` 三段口径；TC-I-M6-006 三类事实分别可见＋F-06/TC-I-M1-004 受阻矩阵；TC-C-M6-001 契约＋TC-D-M6-001 前端不写库＋TC-I-M6-007 前后端分离判断标准；PRD-M6 PD-01/02/03/05）＋**静态红线**（tasks.html 只引 api.js＋app.js＋base.css；只调 `listTaskBlocks`/`listOpportunities`/`listAllResearch`/`getResearchResult` 四种只读封装，不调任何写面）＋**渲染**（种子基线 GOAL-2026Q3-01：7 任务／2 受阻（T-1020 call_failed、T-1019 source_unavailable）／8 机会／2 研究（R-006/R-007 均 done）／2 候选行为（R-006 的 CB-002 `not_supported`、R-007 的 CB-001 `candidate_supported`）；三类事实标签＋数字逐字——① 机会未被选中＝4（3 candidate＋1 deferred）、② 任务未完成＝3（running1＋blocked1＋stopped1）、③ 研究未支持候选行为＝1（R-006）；任务卡片含 T-1022/1021/1023/1020/1019/1018；5 过滤器 chips）＋**受阻原因/已完成部分**（T-1020 `call_failed`→等待接口恢复＋真实 `done_part`/`block_note`/`resume_condition`；T-1019 `stopped`→已停止＋`done_part`＋「保留已完成部分，不自动重启」）＋**三类事实口径一致**（页内数字＝原表 `GET /api/opportunities`＋`/api/goals/{id}.tasks`＋`/api/research-result/{no}` 重算结果）＋**前端只读**（写动作 0 次；localStorage 只含 applied/navUnread；打开页面零写）＋**前后端分离**（server/db/scripts 零引用 frontend＋直调 6 接口 200＋无 `.json` 快照） | ✅ 已建（2026-09-20；77 断言全绿） |

## 4. 已知缺口（登记，未擅自改上游）

1. **材料（MD-03）只读展示**：F-01 的 `registerGoalMaterial` 尚未接入 `server/api` 的可调用面，F-27 页面上材料区只展示、不提供登记入口。**本页不越界自造端点**——材料登记面接入 `server/api` 归 F-01 侧决定，届时本页补动作。
2. **口径检查不自动去重**（F-01 既有口径，本点只登记不改）：`checkGoalGaps` 只跳过「规则命中」与「已补充」，对**仍未补充**的规则重跑会再落一批同规则的新待补项。F-27 的「重新检查口径」因此每次点击都会新增待补项行；是否去重由 F-01 决定。用例 `test-f27.mjs` ⑥ 组已**如实锁住**该行为（实测 3 → 6），不把既有口径当成本点的缺陷。
3. **静态资源同源绑定的具体方式待确认**：tech-stack §7.3 的 `TS-20`（五模块打包成一个还是多个 Worker）尚未定，`../wrangler.toml` 因此**未加**静态资源绑定（`[assets]`）——本点**不改部署配置**。当前 F-27 只依赖「同源相对路径」这一前提，绑定方式落定后无需改前端代码。
4. **与原型的有意偏差 ①**：口径检查**不在进入页面时自动跑**。原型进入即跑一次本地模拟检查；真实后端下那会产生 `goal_check` 任务与 `PD-04` 行（等于「看页面就写库」）。前端改为**保存新版本后自动跑一次**，另给显式「重新检查口径」按钮；进入页面只**读**已有待补项。
5. **F-28 与原型的有意偏差 ①（状态处置落库）**：原型的机会状态处置是**会话态覆盖**（`../assets/data.js` + `U.Store("oppStatus")`），刷新即丢；真实实现走 `PATCH /api/opportunity-status`，写平台 D1 的 MD-06 并落 PD-05 **逐次留痕**（`candidate ↔ deferred` 可回查、`defer_reason` 仅 `deferred` 时保留）。PD-05 的 `change_reason` 为 `NOT NULL`，故由页面给出**固定语义的处置说明**（含「经 F-28 人工处置」），不让前端自由编造业务口径。**边界**：这是**平台自身**的写面，不是外部生产系统写接口——硬红线「前端不发起任何生产写接口调用」仍成立，`test-f28.mjs` ⑨ 组断言写请求**只**落在 `/api/opportunity-status`。
6. **F-28 与原型的有意偏差 ②（证据链点开才回查）**：原型从 mock 一次性取全五字段；真实实现下未展开时只呈现 LNK-01 关联行拿得到的「来源 / 标题 / 时点」，**点开才**调 `GET /api/evidence-trace/{id}`（证据 → 查询记录 EXT-01 → 来源 CFG-01）。用例 ⑦ 组含**反例**：库级放行「适用范围＝纯空白串」的证据行（`NOT NULL` 拦不住空白串，实测确认），应用层判「四要素不齐 · 不可作为有效依据」。
7. **机会状态字典无只读接口**（登记，未擅自改上游）：`dict:OPP_STATUS` 等值域没有暴露给前端的只读路由，故状态徽标文案沿用原型同一份文案表（`assets/app.js` 的 `STATUS`）。这是**展示副本而非业务口径**；若后续补上字典只读路由，可改为从库读。
8. **机会页首次加载取数 13 次**（登记，未擅自改上游）：外壳启动 3 次（目标列表 / 目标一页读 / 机会计数）+ 本页 10 次（机会列表 1 + 逐条读模型 6 + 已提交研究 2 + 来源说明 1）。原因是 `server/api` 无「机会批量读模型」端点，本点**不自造端点**；机会量级变大时可由后端补一个批读面，前端只换调用点。
9. **F-29 与原型的有意偏差 ①（即时检查走服务端）**：原型在页面里用本地正则算「需补充的要点」；真实实现改为调 `POST /api/research-proposal-checks`（服务端 `checkResearchQuestion` 的唯一判据）。该口径本就**逐字照录原型**，故展现一致；收益是**前端不持第二份关键词表 / 长度阈值**——改口径只需改服务端一处。用例 ② 组把这层做成可静态核对的断言（页面不得出现人群 / 行为关键词的备选式与 `15` 阈值），⑥ 组再用**不误报反例**（问题已含行为词时不得点名缺行为）锁住行为。
10. **F-29 与原型的有意偏差 ②（幂等命中不再触发 F-04）**：原型用会话内 `U.Store("proposals")` 记幂等键、只在会话里造一条新任务；真实实现以 MD-12 `idempotency_key` 唯一约束为准（服务端返回 `created=false`）。页面据此**只在新建建议之后调用一次** F-04；重复提交**不新建建议行、不新建任务、也不再调建任务面**——用例 ⑨ 组三条断言同时锁住（不靠后端兜错）。
11. **「是否已提交过建议」以事实行为准，不看机会状态列**（登记，未擅自改上游）：种子（及历史数据）里存在**状态为 `submitted` 却没有对应 MD-12 建议行**的机会（如 `OPP-010` / `OPP-012`）。页面按 M1-F-17 的同一口径（人工节点完成判据＝有无**真实建议行**）如实说明「状态为已提交研究、但暂无登记在案的建议行」，不谎报「已提交过」。用例 ⑤ 组以此为主断言。
12. **建议页取数 6 次**（登记，未擅自改上游）：外壳启动 3 次（目标列表 / 目标一页读 / 机会计数）+ 本页 3 次（机会列表 1 + 该机会读模型 1 + 建议列表 1）；提交动作后再 3 次（建议列表 / 机会读模型 / 触发 F-04）。原因同缺口 8：无「机会批量读模型」端点，本点**不自造端点**。
13. **F-30 与原型的有意偏差 ①（证据点开才回查）**：原型 `study.html` 从 `assets/data.js` 直接取证据详情；本页改为未展开时只呈现证据编号（LNK-02 关联行能给到的），**点开才**调 `GET /api/evidence-trace/{id}`（证据 → 查询记录 EXT-01 → 来源 CFG-01），渲染四要素与可回查判据——与 F-28 偏差 ② 同一套链路，不复制任何 mock 数据。下游 `followup.html`（F-31 追问对话）作为前向链接保留，本页不越界实现。
14. **F-31 与原型的有意偏差 ①（Agent 应答只回显真实返回、不编造结论）**：原型在页面里直接展示「追问后的补查结果」；真实实现下 Agent 应答**只回显 F-05 真实返回**（新任务号／新研究号／`version_changed`／`tool_permissions` 数量），不伪造「补查返回的真实结果」——落实「不编造 Agent 结论」纪律与前后端分离（结论由后端 Agent 产生，前端不臆造）。
15. **F-31 与原型的有意偏差 ②（不自造端点）**：页面只经既有 `POST /api/followup-tasks`（M1 F-05 `createFollowupTask` 写面），不自造任何前端专属端点；已注入上下文取原研究七要素字段、可调度工具取 `GET /api/source-tool-briefing`，均为既有路由。
16. **追问页默认选 R-006（登记，未擅自改种子）**：种子里 `R-007` 的 `start_task_id=NULL`，按 F-05 硬前置（原研究须已关联 `start_task_id`）无法在其上建追问；页面默认选 `R-006`（`start_task_id='T-1021'`，可建追问），不擅自改种子令 `R-007` 可建。追问页取数＝外壳 3 ＋ 本页（研究列表 1＋原研究读 1＋来源说明 1）＝5 次进入；发送时 1 次写（`POST /api/followup-tasks`），不新增其它写面（登记，未擅自改上游）。
17. **F-32 只读页零写面（登记）**：F-32 是**纯只读展示页**，无任何写动作入口——任务状态机口径（BRD F-06 / M5 F-26 受阻矩阵与「停止不自动重启」）与后端共用一套判据，前端只做中文呈现（徽标／受阻原因文案／已完成部分着色），不另立业务判据、不发起任何生产写接口调用。受阻原因映射 `f32Reason`：stopped→「已停止」、blocked 且 `block_reason_code='target_unclear'`→「等待必要信息」、其余 blocked→「等待接口恢复」，与 `server/` 既有的 `PD-03`(`call_failed`/`source_unavailable`/`target_unclear`) 写面口径一致。
18. **F-32 不自造端点（登记）**：页面只经既有只读路由 `GET /api/task-blocks`（PD-03 逐次留痕读面）、`GET /api/opportunities`（MD-06）、`GET /api/research`（MD-07）、`GET /api/research-result/{no}`（F-21 七要素读面 `e5_candidate_hva.unsupported_count`），不自造任何前端专属端点；任务列表来自目标记录 `rec.tasks`（app.js `U.recordOf` 已载入），不新增取数面。
19. **F-32 默认按当前浏览目标过滤（登记）**：页面默认 `U.currentGoalId()` 取当前浏览目标，任务卡片来自该目标 `rec.tasks`；机会与研究的「未被选中／未支持」两类事实按 `goal_id === GOAL_ID` 过滤后呈现，与 F-28/F-30 共用同一份事实源（不复制第二个集合口径）。目标未登记时该页退化为空态，不越界读取其它目标数据。

## 5. 跑用例

前端用例是**唯一**需要 `jsdom` 的执行器（仓库零构建、无 `package.json`，`jsdom` 只作测试期依赖）：

```
npm i --no-save jsdom && node frontend/test-f27.mjs
npm i --no-save jsdom && node frontend/test-f28.mjs
npm i --no-save jsdom && node frontend/test-f29.mjs
npm i --no-save jsdom && node frontend/test-f30.mjs
npm i --no-save jsdom && node frontend/test-f31.mjs
npm i --no-save jsdom && node frontend/test-f32.mjs
```

缺依赖时执行器**显式失败**并打印上面这条命令——不静默跳过（前端用例被跳过＝一条无人看守的静默洞）。

用例的取数通道接的是**真实 Worker + 真实 D1**（`node:sqlite` 载真实 DDL / 种子），不是 mock 语义；只跑本机内存库，零外部调用、零生产写。

## 6. 反向清单

- 被 `../AGENTS.md` 索引 `frontend/` 行引用。
- 被 `../.github/workflows/ci.yml` 的 `validate` 步骤复用（安装 `jsdom` + `node frontend/test-f27.mjs` + `node frontend/test-f28.mjs` + `node frontend/test-f29.mjs` + `node frontend/test-f30.mjs` + `node frontend/test-f31.mjs` + `node frontend/test-f32.mjs`）。
- 被 `../docs/03-locks/tech-stack.md` §1.2 / §2.1 / §6 与 `../docs/04-plan/dev-plan.md` 阶段 5 引用（作为「前端零构建 + 前后端分离」的落点）。
- 本目录内部引用图：`index.html` 与 `pages/*.html` → `assets/api.js`（唯一网络出口）、`assets/app.js`（共享口径）、`assets/base.css`（样式）；`test-f27.mjs` → `pages/goal.html` + `assets/*` + `../server/api/index.js` + `../db/`；`test-f28.mjs` → `pages/opportunities.html` + `assets/*` + `../server/api/index.js` + `../db/`；`test-f29.mjs` → `pages/propose.html` + `assets/*` + `../server/task-runner/proposal.js`（检查规则与幂等键口径）+ `../server/task-runner/hva.js`（F-04 建任务）+ `../db/`；`test-f30.mjs` → `pages/result.html` + `assets/*` + `../server/api/index.js` + `../server/agent-orchestrator/result.js`（七要素读面 `loadResearchResultContext` 与 `scanResultBoundary` 禁词表口径）+ `../db/`；`test-f31.mjs` → `pages/followup.html` + `assets/*` + `../server/api/index.js` + `../server/task-runner/followup.js`（`createFollowupTask` F-05 写面真源）+ `../db/`；`test-f32.mjs` → `pages/tasks.html` + `assets/*` + `../server/api/index.js` + `../server/task-runner/goal.js`（`getGoalRecord` 读面真源，任务来自 `rec.tasks`）+ `../server/shared-context/index.js`（`listResearch` 读面）+ `../server/agent-orchestrator/result.js`（`loadResearchResultContext` `e5_candidate_hva.unsupported_count` 读面）+ `../server/task-runner/task-state.js`（PD-03 读面口径，零写）+ `../db/`。
- `assets/app.js` 的两份只读口径各有唯一上游：`U.SIX_FIELDS` ← `../server/task-runner/goal.js` 的 `GOAL_FIELDS`；`U.OPP_FIELDS` ← `../server/shared-context/index.js` 的 `OPPORTUNITY_SIX_ELEMENTS` / `OPPORTUNITY_SIX_ELEMENT_LABELS`（分别由 `test-f27.mjs` / `test-f28.mjs` 逐条对齐断言守住）。
