# 出关清单 · 部署前检查单

> 定位：回答「功能写完之后，还差什么才能真正上线」。
> 一句话结论：**计划内 32 个功能点（F-01~F-32）与三项缺陷已全部写完并合入本地 `main`，卡在出关三道门禁的后两道——部署未触发、外部契约未关闭。**
> 版本：v1.0（2026-09-20）

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 文档编号 | GO-LIVE-CHECKLIST（出关清单 / 部署前检查单） |
| 版本 | v1.0 |
| 上游约束 | `../../AGENTS.md`（宪法：一条硬红线 白盒原则｜编号体系｜双向引用｜索引三层）｜`dev-plan.md`（阶段 0~5 / 里程碑 M0~M5）｜`../03-locks/external-deps.md`（§7 待确认清单 `T-xx`）｜`../03-locks/tech-stack.md`（§8 待确认项 `TS-xx`）｜`../03-locks/schema.md`｜`../../.github/workflows/ci.yml`（部署流水线） |
| 事实来源 | **本地实测**（全量回归 35/35 套件、mock server 冒烟、前端六页 HTTP 交付），非推断 |
| 适用范围 | 京东超市单一频道，不做全局 |
| 形态边界 | 本清单只做「出关门当前卡在哪、按什么顺序解开、谁拍板」，不重复定义外部契约内容（归 `external-deps.md`）与技术选型（归 `tech-stack.md`） |

## 1. 门禁 A · 代码就绪 —— ✅ 已完成

| 检查项 | 状态 | 实测证据 |
| ---- | ---- | ---- |
| F-01~F-32 全部合入 `main` | ✅ | 30 个 F-/fix- 分支 100% 合入，`main` 为线性 ff-only 历史（无 merge commit） |
| 三项缺陷收口 | ✅ | Q-16 种子 `linked_at` 违约、`agent-runtime/discovery/agent.md` 本体缺口、F-14 `loadDiscoveryContext` 取值缺陷，均已修 |
| 全量回归 | ✅ | **35/35 套件通过，内部手动断言合计 2355 条**（2026-09-20 更新；含 `test-llm-client` 56 + `test-model-selection` 70） |
| 引用自检 | ✅ | 孤儿 / 悬空 / 重号 **0 命中**（`scripts/ref-check.mjs`） |
| 实体转义自检 | ✅ | 0 |
| 外部契约 mock 运行时 | ✅ | `prototype/mock` 起服务：`/health` 200；九类行为可强制触发——`restricted` 正确映射 `restricted_flag=1` + `fail_reason=权限未开通`；`slow` 给出 `retry_count=2` 且**成功不算失败**（`result_status=ok`） |
| 前端零构建静态交付 | ✅ | 六页（goal / opportunities / propose / result / followup / tasks）全部 HTTP 200 |

> 补充：本次出关前还修掉一处**由修复动作本身引入的回归**（详见 §5 已发现的坑），现 `test-f01` 由「87 通过 / 1 失败」转为 **88 全通过**。

## 2. 门禁 B · 部署上线 —— ⬜ 阻塞

**阻塞原因（两项，均需你提供）**

1. 仓库**无远程、无 upstream**——`git remote -v` 为空，本地 `main` 纯本地，无法通过 `git push` 触发流水线。
2. 流水线需 Cloudflare 凭证：`CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`，且**凭证仅经 GitHub Secrets 注入**，绝不写入仓库（宪法硬红线，见 `ci.yml` 头注）。

**操作步骤（按顺序）**

| 步骤 | 命令 / 动作 | 说明 |
| ---- | ---- | ---- |
| 1 | `git remote add origin <远程地址>` | 需你提供远程地址 |
| 2 | `git push -u origin main` | 触发 `.github/workflows/ci.yml` |
| 3 | 流水线 `validate` 阶段 | `wrangler d1 migrations apply jd-growth-platform --local --yes`（真实执行、FK 强制）＋ `node --check server/api/index.js` ＋ mock 自检 ＋ **F-01~F-32 全部用例** ＋ 引用自检 |
| 4 | 流水线 `deploy` 阶段（仅 push 到 main 时） | `d1 migrations apply jd-growth-platform --remote --yes` → `wrangler deploy` |
| 5 | GitHub 仓库 Settings → Branches | 开启 `main` 分支保护（需 PR 审核 + 状态检查通过）。**属仓库设置项，不在 `ci.yml` 内，须手动开**（见 `.github/README.md`） |

**PR 标题约定**：须以 `F-xx` / `阶段N` / `chore` / `docs` / `ci` 开头，否则 `pr-title-check` 会失败（对应 dev-plan「每 F-xx 一 PR」纪律）。

## 3. 门禁 C · 外部契约 —— ⬜ 阻塞

> 完整定义见 `external-deps.md` §7；本节只做**出关视角的进度汇总**，不重复定义内容。
>
> **对外提问稿另见 `external-intake-questions.md`**（2026-09-20 新增）：§7 的表格行只有「事项 / 谁提供 / 阻塞什么」，**不含可直接转发的问句**；提问单把 **16 条**未决项（含 T-01~T-05 五条「demo 占位在跑」的假性就绪项）翻译成对方能答的问题，并写明合格回答标准、不答后果与回答记录区。**催办外部方时发那份，不要发本节。**

### 3.1 数据源类（`T-01`~`T-10`，全部 ⬜ 未关，由对接方提供）

| 编号 | 待确认事项 | 阻塞什么 |
| ---- | ---- | ---- |
| T-01 | 真实 MCP 工具名与工具清单（是否与我方设计的 12 个工具一致） | F-23 / F-24 工具注册 |
| T-02 | 真实接口的查询条件字段名与语法 | F-15 / F-24 `query_condition` 可复现性 |
| T-03 | 历史深度（各系统可回溯多久） | F-09 `info_time_point`、F-22 补查范围 |
| T-04 | 权限范围（平台账号可查的人群 / 品类 / 频道边界） | F-23 权限判定、CFG-03 `restrict_reason` |
| T-05 | 返回体真实结构与字段路径 | EXT-01 `result_summary`、§6 mock 结构 |
| T-06 | 黄金眼 / 商品中台 / 营销中台的失败语义 | F-26 失败重试与受限返回 |
| T-07 | 活动报名系统的降级是常态还是临时 | F-08 可用性登记、依赖强度分级 |
| T-08 | 活动报名系统是否确认无用户参与明细 | F-20 第④项能否排除活动干扰 |
| T-09 | 是否还有 BRD 未列举的第六个数据源 | F-08 来源登记完整性 |
| T-10 | 各系统最小样本阈值、是否自动截断 | F-20 第⑤项 |

### 3.2 Agent 运行能力类（`T-20`~`T-24`）

| 编号 | 状态 | 说明 |
| ---- | ---- | ---- |
| T-20 | ⬜ | §3 分类框架是否成立（BRD 未列此维度），待 PM 确认 |
| T-21 | 🟡 | 已选定 **Cloudflare Workers AI**（DS-02），但**具体模型仍须实机验证**（`tech-stack.md` §8 **TS-10**） |
| T-22 | ✅ | 选定自建 MCP 客户端（DS-06）；协议细节仍取决于 T-01 / T-02 的真实契约 |
| T-23 | ✅ | `agent.md` 本体为仓库文件（`agent-runtime/`），D1 的 MD-13 存登记与版本引用 |
| T-24 | ⬜ | Skill 加载方式与编号映射，待 PM 确认 |

### 3.3 交付基础设施类（`T-25`~`T-27`）

| 编号 | 状态 | 说明 |
| ---- | ---- | ---- |
| T-25 | ⬜ | §4 分类框架是否成立，待 PM 确认 |
| T-26 | ✅ | 选定 Cron Triggers + Queues + 自建状态机（DS-03） |
| T-27 | 🟡 | mock server 暂定 `prototype/mock/`，归属与生命周期待定（`tech-stack.md` §8 TS-18） |

### 3.4 文档与路径类

| 编号 | 状态 |
| ---- | ---- |
| T-30 / T-31 | ✅ 均已解决（2026-09-19） |
| T-32 | ⬜ 未关（外部依赖文件是否需在 `db/` 种子定稿前定稿） |

### 3.5 技术栈侧（`tech-stack.md` §8 `TS-xx`）

| 编号 | 状态 | 说明 |
| ---- | ---- | ---- |
| **TS-10** | ⬜ **最大风险** | Workers AI **具体模型选型**须实机验证。它直接决定 F-20 第⑤项「信息是否足以支持判断」——模型必须**敢于说「不足以判断」**，这与模型对齐倾向强相关，须用 `external-deps.md` §6 的 mock 响应做回归。**探针骨架已就绪**（`server/probes/model-selection/`，2026-09-20：6 判例 × 5 检查自动判分、dry_run 零成本验链路、测试已进 CI）——**凭证到位后跑 §1.2 即出实测结果**；⚠️ 本地 dev 也计费 |
| TS-11 | ✅ | **已于 2026-09-20 裁决：应用层校验**。事实面早已齐（D1 长度**一律不强制**；`CHECK` 可用、按**字符**计、**不拦 NULL**）。**连带结论**：库级 `CHECK` **不写进 `0001`**，首版迁移不受影响；代价是绕过写入面的路径拦不住，须在各写入面分别落实 |
| TS-12 | 🟡 | 中文排序：默认 **BINARY ≠ 拼音序**、D1 **无拼音排序规则**（`COLLATE PINYIN` 报错）；待 PM 逐列确认「哪些列要排拼音」 |
| TS-13 | ⬜ | 前端是否需要轻量组件复用手段 |

### 3.6 P0 阻断提示（出关前必须知晓）

`external-deps.md` §1.3 的依赖强度分级：

- **P0 阻断**：CDP、黄金眼——不可用则**无法产出任何有依据的结论**；
- **P1 削弱**：商品中台、营销中台——部分检验项无法完成，结论须标注限制；
- **P2 降级**：活动报名系统（原型唯一非 ok 来源）。

> **当前纪律**：在 T-01 / T-02 / T-05 关闭前，外部调用一律走 mock/demo 契约，**demo 值不得进断言**，对应用例不设为发布门禁。也就是说：**平台可运行、任务可留痕、结论可标注缺口，但「研究能否有依据」取决于外部系统是否接通。**

## 4. 需你 / PM / 对接方拍板的决策项（按优先级）

| # | 决策 | 谁拍板 | 影响 |
| ---- | ---- | ---- | ---- |
| 1 | 远程地址 + Cloudflare 凭证（`CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`） | 你 | 门禁 B 能否开启 |
| 2 | **TS-10** Workers AI 具体模型选型（须实机验证） | 技术方 + PM | F-20 能否「敢说不足以判断」，不编造红线能否达成 |
| 3 | T-01 / T-02 / T-05：真实 MCP 工具名、条件字段语法、返回结构 | 对接方 | F-24 / F-15 真实查询可复现 |
| 4 | T-20 / T-25：§3、§4 分类框架是否成立 | PM | `external-deps.md` 结构本身 |
| 5 | ~~TS-11：`varchar(n)` 长度用应用层校验还是库级 `CHECK`~~ → **已裁决：应用层校验**（2026-09-20） | ✅ 已决（原技术方） | 已定：**不改** `0001` 迁移；须在各写入面分别落实 |
| 6 | TS-12：哪些列需要拼音排序 | PM + 前端 | F-27 / F-28 列表排序 |

## 5. 已发现的坑（记入，避免重犯）

**重跑 `generate_mock.py` 会冲掉人工在 SQL 上的修正。**

- **现象**：Q-16 修复（`opportunity_evidence.linked_at` 写真实时点）时重跑了生成器，因生成器与已验证种子**不同步**，连带回退了三处已收口的修正：
  - `gap_rule` GAP-3 / GAP-4 的 `target_field` 由规范化值 `business_scope` / `focus_period` 回退为别名 `scope` / `period`——**冲掉 Q-13 已决①**，直接触发 `test-f01` 的 `alias_fields` 断言失败；
  - `task` T-1023 的 `parent_task_id` 由 `NULL` 变为 `T-1021`；
  - `opportunity_relation` LK-OR-001 的 `relation_kind` 由 `superseded` 变为 `related_update`（**跨枚举误用**：`related_update` 属 `EVIDENCE_LINK_KIND`，而 `OPP_RELATION` 只有 `same_issue` / `superseded`）。
- **修法**：把生成器三处对齐回已验证种子口径后**重新生成**，使生成器成为唯一真源。
- **验证**：重生成结果与已验证种子仅差 10 行 `opportunity_evidence.linked_at`（即 Q-16 修复本身），**其余零差异**；全量回归 32/32 通过。
- **纪律（新增）**：**改种子须先确认生成器与已验证 SQL 同步，再重跑；重跑后必须 `diff` 核对，只应出现预期差异。** 人工在 `0001_mock.sql` 上做的修正，须同步回 `generate_mock.py`。

## 反向清单

**上游（我来自哪）**

| 上游 | 内容 | 约束力 |
| ---- | ---- | ---- |
| `../../AGENTS.md` | 宪法：一条硬红线（白盒原则）｜编号体系｜双向引用｜索引三层 | 强约束，冲突时以宪法为准 |
| `dev-plan.md` | 阶段 0~5 / 里程碑 M0~M5 / 每 F-xx 一 PR | 本清单「功能是否写完」的判据来源 |
| `../03-locks/external-deps.md` | §7 待确认清单 `T-xx`、§1.3 依赖强度分级 | 门禁 C 的唯一真源 |
| `../03-locks/tech-stack.md` | §8 待确认项 `TS-xx` | 门禁 C 技术侧真源 |
| `../../.github/workflows/ci.yml` | 部署流水线步骤与凭证注入方式 | 门禁 B 的唯一真源 |

**反向（我被谁引用）**

| 引用方 | 性质 | 状态 |
| ---- | ---- | ---- |
| `README.md`（本目录 `docs/04-plan/`） | **枝杈登记**（最近一层目录） | ✅ 已登记 |
| `../README.md`（`docs/`） | 目录清单登记 | ⬜ 待登记（本文件为 04-plan 下属产物，docs 目录表按目录登记，未单列） |
