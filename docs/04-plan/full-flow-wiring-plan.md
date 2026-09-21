# 全流程打通 · 技术方案（已裁决，2026-09-21）

> 编制依据：三路源码审计（M3 链路 / M4 链路 / 运行时接线）+ 线上远程库实测（经本机入口 `http://127.0.0.1:8899`）
> 性质：**待实施的工作方案**，不是已落地成果。落地按「一 F-xx 一 PR」逐点走，逐点在本文件登记结果。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 上游约束 | `../AGENTS.md`（宪法：F-xx 编号体系｜白盒原则｜双向引用）｜`dev-plan.md`（阶段 4 · M3/M4 的交付物与验收要点）｜`../03-locks/schema.md`（PD-01/02/03、MD-07~11、CFG-04）｜`../03-locks/external-deps.md`（A-1 门禁、§7 未关项）｜`../03-locks/tech-stack.md`（§2.4 一步一消息、§4.2 Queues）｜`../01-brd/BRD.md` §5.3 硬红线｜`../05-test-cases/test-M4.md`（F-19~F-22 oracle） |
| 被测 / 被改对象 | `server/task-runner/`（`executor.js` / `index.js`）｜`server/agent-orchestrator/`（F-19~F-21 既有能力，复用不动语义）｜`wrangler.runner.toml` |
| 反向清单 | 登记 `./README.md`（04-plan 文件清单）；引用于 `dev-plan.md` 阶段 4「接线进展」；本文件为 F-33~F-40 的**编号与范围依据** |

---

## 一、结论先行

**"全流程跑不通"只差一段代码：M4（HVA 研究）的步骤执行体从未接线。**

其余八个环节都在，而且七要素的组装逻辑**早就写好了**，只是没有任何自动调用路径——只能靠 HTTP 手工 POST 触发。

线上实证（2026-09-21 读回）：

| 任务 | 类型 | 状态 | 进度 | 启动依据 |
|---|---|---|---|---|
| T-0011 | goal_check | done | 2 / 2 步 | 目标配置页「保存为新版本」 |
| T-0021 | discovery | **done** | **5 / 5 步** | 演示数据集（人工构造） |
| T-0027 | discovery | **done** | **5 / 5 步** | 目标配置页「应用配置」 |
| T-0028 | discovery | **done** | **5 / 5 步** | 目标配置页「应用配置」 |
| **T-0026** | **hva_research** | **running** | **0 / 5 步** | PM 13:36 提交研究建议 PROP-001 |
| **T-0029** | **hva_research** | **running** | **0 / 5 步** | PM 14:16 提交研究建议 PROP-001 |

`GET /api/research` → `{"items":[]}`：**库里一条研究结果都没有**。

---

## 二、全流程环节体检

| 环节 | 前端 | 后端 | 状态 |
|---|---|---|---|
| 目标配置（六要素 / 版本 / 口径检查 / 应用） | F-27 | F-01 | ✅ |
| 机会发现（M3 五步） | 触发按钮 | F-02 + `task-runner/executor.js` | 🟡 机械上跑通，但会产脏数据 |
| 机会列表与详情 | F-28 | F-10 | ✅ |
| 提研究建议 | F-29 | F-03 | ✅（PROP-001 已落） |
| **HVA 研究（M4 五步）** | — | **不存在执行体** | ❌ **硬断点** |
| 研究结果七要素 | F-30 | `agent-orchestrator/result.js` | ❌ 有组装逻辑，无自动调用路径 |
| 追问 | F-31 | F-05 / F-22 | ❌ 依赖 M4 产出 |
| 任务与状态 | F-32 | F-06 | ✅ |

---

## 三、断点清单（按严重度）

### P0-1 · M4 执行体不存在 —— 唯一硬断点

| 位置 | 现状 |
|---|---|
| `server/task-runner/executor.js:144-146` | `if (task.task_type !== "discovery") throw`——非发现类型**直接抛错** |
| `server/task-runner/executor.js:326` | cron 选取条件硬写 `t.task_type = 'discovery'` |
| `server/task-runner/index.js:107-109` | `hva_research` 落到 `delegateToAgent` **契约占位**（只校验后返回 `delegated:true`，不执行任何步骤） |
| `server/agent-orchestrator/result.js:321` | `assembleResearchResult`（七要素组装）**纯计算、零写库**——已实现 |
| `server/agent-orchestrator/result.js:484` | `saveResearchReport`（落 7 列）——已实现 |
| `server/api/index.js:1069` | 唯一调用者，**HTTP POST 手工触发** |

**后果**：研究任务建行 → 五步全 `pending` → cron 永远不选它 → `0 / 5 步` 永久。

M4 五步名（`task-runner/step-plan.js`，逐字照抄原型 `prototype/pages/tasks.html` `TYPE_STEPS`）：
① 载入机会与目标口径　② 调度工具采集证据　③ 交叉验证候选行为　④ 形成结论与适用范围　⑤ 产出研究结果与依据

### P0-2 · M3 步骤无独占 → 并发重跑 → 产出翻倍

- `executor.js`：**先执行步骤体，后落 `done`**
- `executor.js` `runPendingDiscoveryWork` 的 `for(;;)`：每轮重新全表选 `active` 步；一个 tick 会**一路把整批任务跑到底**
- 12 个任务同 1 分钟提交 = 60 步 > 1 分钟节拍 → 跨 tick 重叠 → 同一 `active` 步被并发执行 → 产出 ×N

这是 93 条重复机会（标题去重后只有 4 个）的直接成因。

### P0-3 · 取号竞态

读后写取号（`opportunity-next-id` 类）无唯一约束兜底 → 并发撞主键 → 任务 `blocked`。

### P1-1 · 到期轮询异常会饿死执行体

`server/task-runner/index.js` 的 `runDueDiscoveryCalls` 排在 `runPendingDiscoveryWork` **之前且无 try/catch**。任一 goal 抛错（如无运行策略）→ 整个 `scheduled` reject → 本 tick 所有 `active` 步永不执行，且**每分钟重演**。

### P1-2 · 建任务与置 `active` 非原子

`schedule.js` 插 task → 落五步 `pending` → enqueue 才把步 1 置 `active`。中间异常 → 任务 `running` 但五步全 `pending` → 永远不被选中 → `0 / 5 步`。**与 T-0026 / T-0029 的现象同形**。

### P1-3 · 同一份研究建议产生了 2 个研究任务

- 事实：PROP-001 → T-0026（13:36）+ T-0029（14:16）；`triggered_task_id` 只记到 **T-0029**，T-0026 成孤儿。
- 机制已定位（2026-09-21，随 F-04 用例 A44 暴露）：⑤ 建议级幂等守卫 `markProposalTriggered` **位置偏晚**（排在建任务 / LNK-04 / 建壳 / PD-06 之后）→ 重复调用**虽最终报错，却已留下孤儿任务 + 孤儿研究壳**。
- 处置见下（第四节 · 自愈补扫）。

### P1-4 · 无真 Queue

`wrangler.toml` 与 `wrangler.runner.toml` **均无 producer / consumer 绑定**；`index.js` 的 `queue()` 是**死代码**；全靠 runner 的宽 cron `* * * * *` 宽扫兜底 → 时序脆弱、无重试、无 DLQ。

### P2-1 · 本地无一键全链路

无根 `package.json`；`node_modules` 只有 jsdom；**无 wrangler / miniflare 依赖**（走 `npx -y wrangler@4.135.0`）。改代码只能靠线上验证。

### P2-2 · 数据真实性（外部条件，非本期阻塞）

- 取数走 `baseline-v1.js` 的**契约基准 v1 冻结响应**——链路真、数值是占位。
- 外部对接方缺（`external-deps.md` §7，含 demo 占位共 16 条未关）。
- A-1（LLM）线上 `/api/health` = `ai: "bound"`，但**只在 api Worker**；runner Worker 的 `wrangler.runner.toml` **无 `[ai]`**。

---

## 四、四期技术方案（已裁决）

### 裁决记录（2026-09-21）

| 问题 | 选项 | **用户裁决** |
|---|---|---|
| 打通范围 | A 只期1 / **B 期1+期2** / C +期3 / D 全做 | **B（期 1 + 期 2）** |
| M4 是否真调模型 | 1a 确定性 + fallback（推荐） / **1b 给 runner 加 `[ai]` 真调模型** | **1b** |
| 步骤独占路线 | **2a 轻量配额**（零 schema 变更） / 2b 租约（需迁移） | **2a**，并**加固为「配额 + 去重 + 超时」** |
| T-0026 / T-0029 处置 | 补扫救活两条 / 只救 T-0029 / 都不救 | **只救 T-0029**（T-0026 登记为 P1-3 证据） |
| MD-07 建壳位置 | **先补 F-04 建壳** / 放到执行体里建 | **先补 F-04**（已随 `9b617a8` 落地） |
| `followup.js` 值域偏差 | 本次顺手改 / **只登记不擅改** | **只登记不擅改** |
| 编号与节奏 | **按 F-33 起登记并开工** | **是** |

### 编号映射（F-33 起，全仓此前仅 F-01~F-32 在用）

| 编号 | 工作项 | 对应本节 | 状态 |
|---|---|---|---|
| **F-33** | **M4 执行体接线**（期 1）：五步执行体 + 按 `task_type` 分派 + runner `[ai]` + 自愈补扫 | 4.1 | ✅ **已上线 2026-09-21**（`209c85b`，CI `validate` + `deploy` 双绿；`research.js` + `self-heal.js` + `test-f33.mjs` 88 断言全绿；分派/选取/自愈同取 `WIRED_TASK_TYPES` 单一真源；线上验收见 §1.6） |
| **F-34** | 步骤配额 + 同 tick 去重 + 单步超时（期 2.1 加固版，零 schema 变更） | 4.2 | ✅ **已落地 2026-09-21**（新增 `server/task-runner/tick-guard.js` 纯计算件 + `test-f34.mjs` **56 断言全绿**并进 CI；配额与超时分别**派生自** `TYPE_STEPS` / `DEFAULT_TIMEOUT_MS`，不复制第二份口径；**超时不是失败**——不落 `PD-03`、不改 `task_status`、步骤留 `active` 交下个 tick 重试；**边界如实登记**：不是真独占，并发 tick 仍可能选中同一步；待提交） |
| **F-35** | 取号原子化（`id_sequence` 表） | 4.2 | ✅ **已落地 2026-09-22**（**已改锁定件**：`docs/03-locks/schema.md` **v1.8 → v1.9**（新增 **CFG-09 `id_sequence`**，表数 **36 → 37**＝业务表 36 ＋ 1 张**运行期基础设施**计数器表；旧版归档 `.trash/schema.md-v1.8.md`，SHA 4afb1679ad12）＋ `db/migrations/0001_init.sql` 表数声明同改（**37 个 `CREATE TABLE`**，头部钉 `schema.md v1.9`）。落地件＝`server/shared-context/id-sequence.js`——**该表唯一写入面**：热路径**一条** `UPDATE ... RETURNING` 完成「自增 + 取值」；**冷路径自愈种子**从消费方传入的既有编号列表抬到「库内实际最大」，故**不需要**为线上既有数据补种；`healSequence` 显式修漂移（`max()` upsert、**只抬不降**、幂等）；**热路径 0 次回读业务表**（性能纪律）。`task-runner/step-plan.js` 的 `nextTaskId` / `nextResearchNo` 与 `agent-orchestrator/opportunity.js` 的 `nextOpportunityId` 改走它，**消费方的调用面与返回形态逐字未变**（F-16 / F-05 / F-01~F-06 断言**一字未改**）；号形态（前缀 + 位宽）与命名空间**只此一份**，消费方不再持有正则。`test-f35.mjs` **26 断言全绿**并进 CI（含并发 6 次互不相同、热路径 0 次回读、只抬不降幂等、`schema.md` 表数 ↔ DDL 实数漂移守卫）。**线上既有库**补建走一次性入口 `db/ops/2026-09-22-id-sequence.sql`（`CREATE TABLE IF NOT EXISTS`，幂等、**无破坏性语句**）＋专用 workflow `ops-id-sequence.yml`；`ops-demo-reset.yml` 的 `paths` 同批收窄到自己的文件，两支互不触发。**边界如实登记**：① 其余 **12 个取号函数（4 个模块）仍为读后写**、同样存在 P0-3 竞态，本轮未收敛（`schema.md` §12 **Q-18** 待办；收敛无需再改 DDL）；② 只保证「**经本表取号者之间**不撞号」——**旁路插入**（运维 SQL / 手工补数）仍可能撞号，由自愈种子收回漂移，但与首次取号并发时仍有窄窗口、**不承诺消除**。**遗留待裁**：`tech-stack.md` / `external-deps.md` 的「36 张表」交叉引用**未同步**（二者自身是锁定件，改动须各自 bump 版本，**本项未擅动**，已登记） |
| **F-36** | 调度相位异常隔离（原描述：`runDueDiscoveryCalls` / `runPendingDiscoveryWork` 顺序与 try/catch 隔离） | 4.2 | ✅ **已落地 2026-09-21**（`index.js` 抽出 `TICK_PHASES`（顺序真源）+ `runPhase`（单相位 catch）+ `EMPTY_WORK`（失败时键齐的空形态）+ `runTick`（可测本体，可注入相位与 `onError`），`scheduled` 退化为一行薄壳；**相位级隔离**：任一抛错只影响自己、其余照跑，失败经 `phases.<相位>.{ok,why}` + `onError` **如实回报**（不炸整轮、也不静默吞错）；**顺序刻意不重排**——保留 `due → heal → work` 以维持「本轮新建 / 补回的 active 步在同一 tick 被消费」的流水线（把执行体提到最前只会把它们推迟一个 tick）；**纯控制流改动**：零 schema、不新增 import、不改上游语义；`test-f36.mjs` **45 断言全绿**并进 CI。**边界**：`queue()` 的逐消息隔离**不在本项范围**（该路径真 Queues 未接，属 P1-4，接入后单独处理）） |
| **F-39** | **F-03/F-04 幂等守卫前移**（消除孤儿任务 + 孤儿研究壳） | 4.3 | ✅ **已落地 2026-09-22**（原「独立工作项」转正）。根因：`markProposalTriggered` 的 `task_id` 入参**必须是已存在的任务**（`MD-12.triggered_task_id` 是外键），故只能排在「建任务 / LNK-04 / 建研究壳 / PD-06」**之后**；重复调用虽最终报错，却**已留下孤儿任务 + 孤儿研究壳**（`triggered_task_id` 只指回最后一次那条）＝线上 `PROP-001 → T-0026 + T-0029` 的双任务同形机制。修法：`proposal.js` 新增**只读预检** `ensureProposalNotTriggered(db, proposal_id)`（只判「建议是否已触发过」，**不需要 `task_id`**，故可排在最前），`hva.js` 的 `createHvaResearchTask` **在建任何行之前**先调它；靠后的 `markProposalTriggered` 只负责落 `triggered_task_id` 的写。**判据与原来一致**（仍报「已触发任务」，不引入第二套口径）。`test-f04` **A44 由「现状 4 行」翻转为「期望 3 行」**＋新增 A45（孤儿任务 0）/ A46（`triggered_task_id` 指回**首次**那条）＝ **66 断言全绿**；`test-f03` 新增 ⑩ 段（放行 / **零写** / 报错 / 报错路径零建行 / 守卫本体无写语句）＝ **90 断言全绿**。**零 schema 变更**、不新增 import 语句（并入既有 `./proposal.js` 一条） |
| **F-40** | **`followup.js` `research_status` 由 item_name 改回字典 item_code** | 4.3 | ✅ **已落地 2026-09-22**（原「独立工作项」转正）。`followup.js` 建追问研究壳时原写 item_name「研究中」，而字典 `RESEARCH_STATUS` 的 item_code 是 `running`（`varchar(16)` 无 CHECK，**库级拦不住**）；已改为 item_code `running`，与 F-04 `hva.js` 建壳**同口径**。`test-f05` 新增 **A34/A35** 正反两侧（值域**取自库**的 `dict_item` + 反例「不得写 item_name」）＝ **59 断言全绿**，与 `test-f04` 的 A37/A38 对称。**零 schema 变更**、一行改动 |
| **F-37** | **`ended_at` 脏态修法**（原「独立工作项」转正；**用户裁决＝「resume 清空」**） | 4.3 | ✅ **已落地 2026-09-22**（`tool-executor/task-state.js` 的 `setTaskStatus` 增 `clear_ended_at`＝**唯一显式清空口**，实现仍是**单条 `CASE` SQL**——`test-f26` 的「`UPDATE task` 恰 2 条」静态断言**逐字未动**；`task-runner/recovery.js` 的 `resumeTask` 用它。`test-f06` 47→**51 断言全绿**：脏态夹具（`blocked` + `ended_at` 非空，执行体 `catch` 同形）前置断言 + 恢复后清空 + **反例「未显式声明清空时沿用 `COALESCE` 保留旧值——清空只发生在 resume 一处」**。「`blocked` 不落值」方向**未采纳**，故受阻侧两个写入方（F-26 留空 / 执行体 `catch` 落时刻）保持原样） |
| **F-38** | **F-19 查证计划避开未启用来源**（原「独立工作项」转正；**用户裁决＝「是」**） | 4.3 | ✅ **已落地 2026-09-22**（`agent-orchestrator/research-start.js` 的 `assembleResearchStart` 收 `available_sources`：计划只用「**已声明 且 可用**」的来源，并**逐步骤收窄 `data_sources`**（某步只要还剩可用来源就保留，计划里不残留不可用来源），排除项**如实登记**为 `plan_excluded_sources` / `plan_excluded_checks` / `availability_note`；`task-runner/research.js` 经 M5 `listTools` 现读可用来源（本体仍**零裸 SQL**）后注入，并把排除项写进步 ① `done_part` 与返回体；**未注入 → 口径不变（不过滤）**，既有「`[]`＝不过滤」语义由 `allowEmpty` **显式开启**而非静默改掉。`test-f19` 94→**108 断言全绿**、`test-f33` 88→**99 断言全绿**（新增 ⑫「生产同形」：只启用 TOL-01/04/09/11 → **PIM 不被查询、零 `PD-03`、五步跑到 `done` + 报告落库**）。**边界如实登记**：只判「该来源有无已启用工具」，更细的权限 / 接入态仍由 M5 前置守卫兜底；**新增两个待裁决项**：①「零可用来源时是否应直接受阻」（当前＝计划只剩无来源步骤、报告如实说明缺口）②报告「其他解释与限制」是否纳入来源排除说明（报告内容归 F-21 口径，本轮未擅改）） |
| ~~（独立工作项）~~ | **执行体 catch 在 `blocked` 时落 `ended_at`**（→ 已转正为 **F-37**，见上）（`executor.js` / `research.js`），恢复后成「`running` + `ended_at` 非空」——与锁定列「任务结束时点；**进行中为空**」相悖（F-26 侧对 `blocked` 一律留空，仅 `stopped` 落值）。**干跑实证**（同库、同真实写入面）：F-26 口径 resume 后 `ended_at=null` ✅／执行体口径 resume 后 `ended_at='2026-09-21 16:00'` ❌。**线上同源可复现**：T-0026（catch 写）`ended_at=15:26` vs T-0029（F-26 写）`ended_at=null` | 4.3 | ⬜ 已登记未擅改 |
| （独立工作项） | **F-19 查证计划是否应避开未启用来源**（或在计划里标注受限）——否则任一计划源未接入，M4 一动手必然被 F-26 受阻，「跑到报告落库」在外部接入不齐时不可达 | 4.3 | ⬜ 已登记待裁决 |

> 期 3（真 Queues）与期 4（本地一键 e2e）本次**不在范围内**，条款保留在下文，供后续单独开工。

### 期 1 · 打通 M4 —— 必做（→ F-33）

**核心思路：把"只认 discovery"的执行体改成"按 `task_type` 分派"，M4 五步照同构写法落地。**

**1.1 新增执行体文件** `server/task-runner/research.js`（遵循"新增写面就单独成文件"惯例）
导出 `runResearchStep(db, task_id, step_no, opts)`，五步映射：

| 步 | 内容 | 复用既有能力 |
|---|---|---|
| ① | 载入机会与目标口径 | F-19 `loadResearchStartContext` + `assembleResearchStart`（只读、纯计算） |
| ② | 调度工具采集证据 | F-20 `queryForBehaviorCheck` →（M5 `runQueryWithRecovery` 落 EXT-01）＋ F-15 `buildEvidenceDraft` / `recordVerificationEvidence`（落 EXT-02） |
| ③ | 交叉验证候选行为 | F-20 `formCandidateBehavior`（落 MD-09 / MD-10） |
| ④ | 形成结论与适用范围 | F-20 `assembleBehaviorVerification` + F-18 `evaluateResearchClosure`（零写） |
| ⑤ | 产出研究结果与依据 | F-21 `assembleResearchResult`（纯计算）+ `saveResearchReport`（落 MD-07/08/11 + LNK-02） |

**1.2 执行体两处小改**（`executor.js`）
- 分派守卫：由"非 discovery 即抛"改为**按 `task_type` 路由**到 discovery / research 两份执行体
- `runPendingDiscoveryWork` 的选取条件：由硬写 `task_type='discovery'` 改为"按已接线类型集合筛选"，行内按类型分派

**1.3 跨模块依赖必须同改三处**（这是最容易漏的自检项）
`task-runner` → `agent-orchestrator/result-store.js#updateResearchReport` 属**复用既有写面**（非新增跨模块写面）。但引入同目录外的新 import 会改变"文件间引用图"，故必须同改：
- `server/task-runner/README.md` 的「文件间引用」段
- `server/task-runner/README.md` 的模块级硬红线那句「本目录只写 X 表」
- `server/agent-orchestrator/README.md` 的消费者清单

**1.4 `[ai]`（1b）**：给 `wrangler.runner.toml` 加 `[ai]`（**单表，与 `wrangler.toml` 同形态**——Workers AI 是单一绑定，官方示例即 `[ai]`，与可多实例的 `[[d1_databases]]` 不同类）。语义判断仍遵「**可注入判据 + 确定性 fallback**」：传了就采纳（`source='provided'`）、有 `env.AI` 就真调（`source='llm'`）、都没有走确定性 fallback 并标 `llm_gated=true`——门禁开闭同一套代码可用，本地零密钥仍可回归。

**1.5 顺带堵 P1-2**：cron 侧加**自愈补扫**——扫「`task_status='running'` 且无任何 `active` 步（但已有步骤计划）」的任务，把最小步号的 `pending` 步置 `active`。这条同时能救活已躺在库里的 T-0029（T-0026 先置 `blocked` 留痕，登记为 P1-3 证据，避免同源产出两份）。

**1.6 线上实测（期 1 验收 · 2026-09-21 15:26~15:29 UTC，即 `209c85b` 部署完成后 1~3 分钟内）**

口径：读面回查（`GET /api/tasks/{id}` + `GET /api/task-blocks?task_id=` + `GET /api/query-records?task_id=`），不靠日志猜测。

| 验收项 | 期 1 预期 | 线上实测 | 判定 |
|---|---|---|---|
| 自愈补扫救 T-0029 | 从「`running` + 五步全 `pending` → 永不被选中」脱出并真实执行 | `0 / 5` → **`2 / 5`**：步 ① 载入起点（路径 `verify_hypothesis`）→ 步 ② 真实查询 CDP `Q-00148 ok`、HJE `Q-00149 ok`，落 EXT-02 2 条 | ✅ 达成 |
| T-0026 登记为 P1-3 证据 | 置 `blocked` 留痕（不救） | `blocked` + `BL-001 target_unclear`：「第 1 步受阻：任务 T-0026 的二阶段上下文未取到研究问题（PD-06 `product_question` 缺位）——口径不清，不擅自代拟问题」 | ✅ 达成（**由执行体自动产生**，无需运维 SQL） |
| M4 体真跑（新建任务） | 新 `hva_research` 任务能走 M4 五步 | **T-0031**（15:27 由 F-04 建任务 + 建 MD-07 壳 `R-001`）→ 步 ①→② 实跑：EXT-01 3 条（CDP/HJE `ok`、PIM 受限）、EXT-02 2 条 | ✅ 达成 |
| M4 跑到「报告落库」 | —— | 未达成：步 ② 到 PIM 即被 M5 F-26 判受限返回 → 任务 `blocked`（见下） | ⚠️ 外部启用面 |

**唯一剩余阻塞＝外部启用面，不是代码**：M4 的查证计划含 **PIM**，而线上 `db/seed/0003_enable_remote_plan.sql` 只启用了 **TOL-01/04/09/11**（CDP 人群 / HJE 入口 / MKT 发放 / ACT 活动），`TOL-07 pim.category.query` 仍 `is_enabled=0`。故步 ② 到 PIM 即被 **M5 F-26** 按「受限返回」处置：写 `PD-03 source_unavailable`（`BL-002`，`blocked_at=15:27`，`resume_condition＝接入或权限问题解决`）＋ 任务置 `blocked`；执行体的**前置守卫**随即停手（剩余源暂停）——**与 `executor.js`（discovery）同款行为，非 M4 独有**。

- 救这条走既有路径：先解决 PIM 接入/启用，再 `POST /api/task-recovery` `resume`（`blocked`→`running`），下一 tick 由 cron 接管续跑。
- **待决（登记）**：F-19 的查证计划**是否应避开未启用来源**（或在计划里标注受限）——否则任一计划源未接入，M4 一动手必然受阻，「跑到报告落库」在外部接入不齐时不可达。

### 期 2 · 让 M3 不再产脏数据 —— 强烈建议同期

**2.1 步骤独占（2a 加固版）**
`runPendingDiscoveryWork` 加**每 tick 步数配额**（把批次摊到多个 tick，从根上消掉重叠窗口）＋**同 tick 去重**（同一 tick 内同一 `task_id` 只推进一次）＋**单步超时**（单步超过阈值即放弃本轮、不重复占用）。

- `STEP_STATE` 值域只有 `pending / active / done / blocked`（`db/seed/0002_config.sql` DI-038~041），**没有 `running`** → 不能靠"置 running"做独占；零 schema 变更路线的边界如实登记。

**2.2 取号原子化（P0-3）—— 已落地（F-35）**
新增 `id_sequence` 表（`namespace` PK / `next_val`），原子取号：`UPDATE id_sequence SET next_val = next_val + 1 WHERE namespace = ? RETURNING next_val`，取代「读全量自算最大 +1」的读后写（两个执行体同读同一个 `max` 各自 `+1` → 撞主键 → 任务 `blocked`）。
**落地范围经用户裁决收窄**：本节原文写「`opportunity` / `evidence` / `query_record` 统一改走它」，但**实测**全仓取号面为 **15 个函数 / 4 个模块**、且 `evidence` 的号是**派生**自 `query_id`（本无竞态）——故只收敛**「任务 / 研究 / 机会」三条最热号**（`nextTaskId` / `nextResearchNo` / `nextOpportunityId`），**其余 12 个登记待办**（`docs/03-locks/schema.md` §12 **Q-18**）。
本项**不是零 schema 变更**：新增表使 `schema.md` 由 v1.8「36 张表」升 **v1.9「37 张表」**（**业务表仍 36** ＋ 1 张**运行期基础设施**计数器表，借 CFG 维度落位为 **CFG-09**），`db/migrations/0001_init.sql` 表数声明与全仓叙述同批同步；**线上既有库**另走一次性入口 `db/ops/2026-09-22-id-sequence.sql` ＋ `ops-id-sequence.yml`（`0001_init.sql` 已被 `d1_migrations` 记为已应用，D1 **不会重放**）。
仍符合项目「**取号不写 `SELECT MAX`**」的既定纪律；唯一写入面＝`server/shared-context/id-sequence.js`。

**2.3 修 P1-1**
`index.js` 两处各自 try/catch，且把 `runPendingDiscoveryWork` 提到前面（或至少让它的失败不被轮询异常吞掉）。

### 期 3 · 接真 Queues —— 去掉时序脆弱（本次范围外）

- 两个 toml 加 `[[queues.producers]]` + `[[queues.consumers]]`（`max_batch_size = 1`、`max_retries = 3`、`dead_letter_queue`）。
- `schedule.js` 的 enqueue 端口从"落 D1 痕迹"换成 `env.TASK_QUEUE.send({ task_id, step_no })`。
- `index.js` 的 `queue()` 死代码复活为真 consumer；**cron 降级为兜底补扫**。
- **前置条件**：需在 Cloudflare 账号建 queue（本机无凭证 → Dashboard 建，或 CI 内用 `CLOUDFLARE_API_TOKEN` 跑 `wrangler queues create`）。

### 期 4 · 本地一键 e2e —— 把"跑通"变成可回归证据（本次范围外）

- 建根 `package.json`（devDeps：`wrangler`、`jsdom`）+ `scripts/e2e-local.mjs`：本地 D1 migrate + seed → 建目标 → 跑发现 → 提建议 → 跑研究 → **断言七要素齐备** → 退出码。

### 明确不做 / 待外部条件

- **数据真实性**：需外部对接方（16 条未关项）。接上后数值才从"契约基准 v1"变真。
- **A-1 门禁登记（未擅改）**：`external-deps.md` §3 表 A-1 行仍写 `⬜ 未提供`，与 §7 **T-21 已决**内部不一致；按惯例登记，等确认后触发上游改版。

---

## 五、工作量与风险

| 期 | 触碰的既有 oracle 风险 | 备注 |
|---|---|---|
| 期 1 | 全仓 grep 确认**无任何用例断言「非 discovery 即抛错」**；`test-ts20.mjs` / `test-stage4.mjs` 断言的是「goal_check 走占位」——goal_check 本次不接线，断言不受影响 | 仍须先跑 server 全量套件确认 |
| 期 2 | `test-f23.mjs` 的生产零写断言——**只要新写面单独成文件就不受影响** | 2b 若走租约需同步 `schema.md`（本次不走） |
| 期 3 | 无新 oracle 风险；但需先建 queue 资源 | |
| 期 4 | 新增 `package.json` 会被 ref-check 关注（双向登记） | |

**共同纪律**：一 F-xx 一 PR、双向登记（文档卡 + 反向清单 + 目录 README + `AGENTS.md` 状态位 + `ci.yml` 一步）、开工前读上游真源（子 PRD 验收要点 → `docs/05-test-cases/` 下对应用例的 oracle（test-M1..test-M5） → `docs/03-locks/*` → `AGENTS.md` 红线）。

---

## 六、附：本次审计的旁证

- 清理前的 93 条重复机会全量快照：`~/.workbuddy/tools/backup-2026-09-21/`（可回滚）
- 线上通道（本机浏览器打不开 `workers.dev` 的原因与绕行）：`~/.workbuddy/tools/jd-local-gateway.mjs` → `http://127.0.0.1:8899`
- 原始工作稿（仓库外，本文件为其正式落库版）：`~/.workbuddy/tools/全流程打通技术方案.md`
