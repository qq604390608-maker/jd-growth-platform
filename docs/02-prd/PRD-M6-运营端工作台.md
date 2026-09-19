# PRD-M6 · 运营端工作台（前端）

> 子 PRD · 模块 M6 ｜ 覆盖功能点 F-27 ~ F-32
> 版本：v1.0（2026-09-19，首版基于 BRD v1.1 与三项锁定落地）

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 文档编号 | PRD-M6 |
| 版本 | v1.0 |
| 上游约束 | `../AGENTS.md`（宪法：白盒原则｜双向引用）｜`../01-brd/BRD.md` §3 M6、§4 F-27~F-32、§7 验收总则｜`../03-locks/schema.md`（MD-01/02/03、MD-06、MD-07/08/09/10/11、MD-12、PD-01/02/03/05、PD-07、LNK-01、EXT-02）｜`../03-locks/tech-stack.md`（DS-05 零构建前端、DS-01 D1、server/api 形态）｜`../prototype/`（可交互原型，已钉死需求） |
| 适用范围 | 京东超市单一频道，不做全局 |

## 1. 模块目标与定位

M6 是平台的**前端（运营端工作台）**：前后端分离，服务端所有动态数据经接口请求，数据从数据库来。以下六个页面供原型阶段直接使用，作为需求已被钉死的实证。本模块只做展示与人工操作入口，不含业务逻辑（业务逻辑在 `server/api`）。

## 2. 范围

**In scope**：F-27~F-32（目标配置页、机会列表与详情页、研究建议提交页、研究结果页、追问对话页、任务与状态页）。
**Out of scope**：研究判断（M3/M4）、查询执行（M5）、调度（M1）、共享上下文内容组织（M2）。所有写操作经 `server/api` 落到 D1，本模块不直接写库。

## 3. 功能需求

### F-27 目标配置页

- **功能描述**（继承 BRD §4）：业务方登记 / 关联目标六要素；口径待补项以任务形式提示；目标更新形成新版本并提示影响范围。
- **验收要点**：不替业务方定指标；版本变化可见。
- **关联原型**：`prototype/pages/goal.html`。
- **关联 schema**：`MD-01 research_goal`、`MD-02 research_goal_version`、`MD-03 goal_material`、`PD-04 goal_gap`（待补项提示）。
- **依赖与衔接**：触发 M1 F-01。

### F-28 机会列表与详情页

- **功能描述**（继承 BRD §4）：按目标浏览机会（状态：候选 / 暂不研究 / 已提交研究）；详情页呈现机会六要素＋证据链（来源、条件、时点可点开回查）＋未知项。
- **验收要点**：六要素齐全；证据可回查到查询记录。
- **关联原型**：`prototype/pages/opportunities.html`（列表）、`prototype/pages/opportunity-detail.html`（详情）。
- **关联 schema**：`MD-06 opportunity`（六要素＋`unknown_item`）、`LNK-01 opportunity_evidence`、`EXT-02 evidence`、`PD-05 opportunity_status_log`（状态）。
- **依赖与衔接**：数据来自 M2（F-10）；回查经 M5 `EXT-01`（F-25）。

### F-29 研究建议提交页

- **功能描述**（继承 BRD §4）：PM 选机会 → 填研究问题（必需）→ 可选补候选行为假设、人群限制；问题不明确时只补问题不重填材料。
- **验收要点**：提交后触发 F-04；重复提交幂等。
- **关联原型**：`prototype/pages/propose.html`。
- **关联 schema**：`MD-12 research_proposal`（建议记录）。
- **依赖与衔接**：触发 M1 F-03/F-04（人工节点 → HVA 任务）。

### F-30 研究结果页

- **功能描述**（继承 BRD §4）：呈现结果七要素；每项关键发现挂证据来源与适用范围；候选 HVA 的支持 / 不支持情况并列展示。
- **验收要点**：已查明与仍受限的内容视觉可分。
- **关联原型**：`prototype/pages/result.html`。
- **关联 schema**：`MD-07 research`、`MD-08 research_finding`、`MD-09 candidate_behavior`、`MD-10 behavior_point`、`MD-11 improvement_action`、`LNK-02 finding_evidence`、`EXT-02 evidence`。
- **依赖与衔接**：数据来自 M4（F-21）。

### F-31 追问对话页

- **功能描述**（继承 BRD §4）：基于通用 Agent 的场景化追问：拿到对应上下文信息，用对话方式再调度、查没发现的地方、注入新信息再跑。
- **验收要点**：追问建新任务并关联原研究（F-05）。
- **关联原型**：`prototype/pages/followup.html`。
- **关联 schema**：`PD-07 followup_message`（追问消息）、`PD-01 task`（`parent_task_id` 关联原任务）。
- **依赖与衔接**：触发 M1 F-05 → M4 F-22。

### F-32 任务与状态页

- **功能描述**（继承 BRD §4）：任务运行状态、受阻原因（等待必要信息 / 等待接口恢复 / 已停止）、已完成部分；机会未被选中、任务未完成、研究未支持候选行为三类事实分别可见。
- **验收要点**：状态机口径与 M1 F-06 一致。
- **关联原型**：`prototype/pages/tasks.html`。
- **关联 schema**：`PD-01 task`（状态）、`PD-02 task_step`（步骤）、`PD-03 task_block`（受阻原因与已完成部分）、`PD-05 opportunity_status_log`。
- **依赖与衔接**：状态口径须与 M1 F-06、M5 F-26 一致。

## 4. 关键约束与红线

1. **前后端分离**：动态数据一律走 `server/api`，前端不直接写库、不直接查外部系统。
2. **零构建形态**：前端复用原型结构、零构建 HTML＋原生 JS，同源部署于 Workers（`tech-stack.md` DS-05）。
3. **证据可回查**：机会/结果页的证据链须能点开回查到查询记录（BRD §7 第 3 条）。
4. **状态口径统一**：任务状态机展示须与 M1 F-06 / M5 F-26 一致。
5. **生产环境零写操作**：本模块经 api 的写操作仍受 M5 硬红线约束（BRD §5.3）。
6. **白盒原则**：F-27~F-32 逐页验收、双向引用。

## 5. 验收总则（模块级，承接 BRD §7）

- 六页面逐页对照 BRD F-27~F-32 验收要点；原型 `prototype/` 为钉死需求的实证。
- 已查明与仍受限内容视觉可分（F-30）；三类事实分别可见（F-32）。
- 重复提交幂等（F-29）；追问关联原研究（F-31）。

## 反向清单

- 被主 PRD `./PRD.md` 索引（M6 行）。
- 被 `./README.md`（docs/02-prd 目录枝杈）登记。
- 上游：`../01-brd/BRD.md`、`../03-locks/schema.md`、`../03-locks/tech-stack.md`、`../prototype/`、`../AGENTS.md`。
- 下游预计被引用：开发计划、测试用例（`../05-test-cases/`）、runbook、`frontend/`（六页面 F-27~F-32）、`server/api`（接口）。
- 被开发计划 `../04-plan/dev-plan.md` 按依赖顺序（阶段 5 · M6，最后界面层）编排。
