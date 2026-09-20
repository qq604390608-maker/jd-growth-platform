# agent-runtime 版本管理机制（登记载体）

<!-- 文档卡
上游：`AGENTS.md`（宪法：编号体系｜双向引用）｜ `docs/03-locks/tech-stack.md` §2.5（agent.md 本体为仓库文件、D1 的 MD-13 存登记与版本引用）§3.3 §7 ｜ `docs/04-plan/dev-plan.md` 阶段0（L69 `agent-runtime/` 骨架＝MD-13/MD-14 登记载体）｜ `docs/03-locks/schema.md` MD-13 `agent_profile` / MD-14 `skill_registry`（口径见 L363-391）｜ `docs/03-locks/external-deps.md` §7 T-23 / T-24（版本管理与 Skill 加载）
本文件：`agent-runtime/VERSIONS.md` —— 阶段0 骨架的版本管理机制，是 MD-13/MD-14 在仓库侧的登记载体与文件落位索引
下游：`server/agent-orchestrator/`（阶段4 启动时读 MD-13/MD-14 + 本文件组装 `agent_version_snapshot` 入 PD-01.task）｜ `docs/04-plan/dev-plan.md`（阶段4）｜ `docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle）
-->

## 1. 版本机制约定（⚠️待确认 T-23）
- agent.md / business-rules.md / skills 本体为仓库文件，版本随 git（`tech-stack.md` §2.5）。
- 任务启动时，`server/agent-orchestrator` 组装 `agent_version_snapshot`（落 `PD-01.task.agent_version_snapshot`，schema MD-13 关联 L411）。原型形如（机会发现）：`discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0`；（HVA 分析）：`hva-agent v1.3 / agent.md r12 / skills: hva-five-checks v1.1`。两串分别镜像种子 `MD-13`/`MD-14`（`db/seed/generate_mock.py` L255/L376-377）。
- 本 `VERSIONS.md` 即「登记载体」：人工维护的「当前生效版本 ↔ 仓库文件落位」映射；运行期以 `MD-13.current_version` / `MD-14.version` 为权威，本文件是其仓库侧镜像与文件索引。
- ⚠️ **T-23（external-deps §7 L460）**：原型 `agent.md r12` 已有、真实形态待定。本机制为阶段0 提案；T-23 关闭后若定「git hash 自动注入」或「`rN` 手动维护」，再固化并同步本文件。当前 `doc_revision`（r9/r12）取自种子，供阶段4 落地时对齐。

## 2. 登记载体（仓库文件 ↔ MD-13/MD-14 映射）

### 2.1 Agent 角色指令（MD-13 `agent_profile`，PK = `profile_id`）
| `agent_code` | `profile_id` | `agent_name` | `agent_stage` | `current_version` | `doc_revision` | agent.md 落位 | 状态 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `discovery-agent` | `AGP-DISC` | 机会发现 Agent | M3 | `v1.2` | `r9` | `agent-runtime/discovery/agent.md` | 建壳（本体待阶段4） |
| `hva-agent` | `AGP-HVA` | HVA 分析 Agent | M4 | `v1.3` | `r12` | `agent-runtime/hva/agent.md` | ✅ 本体已落地（F-18，2026-09-20；结束条件＝有依据的研究回答 / 说明无法完成判断的原因） |

> ✅ **口径已订正（2026-09-19）**：原 `PRD-M3-机会发现Agent.md` §1.1（L65）`agent_code=AGP-DISC` 误用列名，已订正为 `profile_id=AGP-DISC`／`agent_code=discovery-agent`，并同步刷新 Q-07 已决状态（`PRD-M4` L65 同类一并订正，两文件均 bump v1.1，旧版见 `.trash/PRD-M3-v1.0.md`／`PRD-M4-v1.0.md`）。本表以 DDL/种子为唯一真源。

### 2.2 公共业务指令（business-rules.md，两 Agent 共用，无独立 MD 行）
- 落位：`agent-runtime/business-rules.md`
- 口径：`PRD-M3` §1.1.2 / `PRD-M4` §1.1.2（8 条公共业务指令，含「查询经工具执行程序、禁模型预期替代结果」「引用证据须带来源/条件/时点/适用范围」「不调生产写接口硬红线」）
- 状态：✅ 本体已落地（F-18，2026-09-20；8 条，服务端以 `server/agent-orchestrator/role.js` 的 `BUSINESS_RULE_IDS` 逐条对齐装载）

### 2.3 Skill 能力登记（MD-14 `skill_registry`，PK = `skill_no`）
| `skill_no` | `skill_code` | `bound_agent_code` | `version` | 落位 | MD-14 状态 |
| --- | --- | --- | --- | --- | --- |
| `S-A1` | `clue-scan` | `discovery-agent` | `v1.0` | `agent-runtime/discovery/skills/S-A1.md` | ✅ 已种（Q-07 已决 2026-09-19） |
| `S-A2` | 待 T-24 关闭后定 code 名 | `discovery-agent` | — | `agent-runtime/discovery/skills/S-A2.md` | ⏳ 待种 |
| `S-A3` | 同上 | `discovery-agent` | — | `agent-runtime/discovery/skills/S-A3.md` | ⏳ 待种 |
| `S-A4` | 同上 | `discovery-agent` | — | `agent-runtime/discovery/skills/S-A4.md` | ⏳ 待种 |
| `S-B1` | `hva-five-checks` | `hva-agent` | `v1.1` | `agent-runtime/hva/skills/S-B1.md` | ✅ 已种（Q-07 已决 2026-09-19） |
| `S-B2` | 待 T-24 关闭后定 code 名 | `hva-agent` | — | `agent-runtime/hva/skills/S-B2.md` | ⏳ 待种 |
| `S-B3` | 同上 | `hva-agent` | — | `agent-runtime/hva/skills/S-B3.md` | ⏳ 待种 |
| `S-B4` | 同上 | `hva-agent` | — | `agent-runtime/hva/skills/S-B4.md` | ⏳ 待种 |

> 注：Q-07 仅裁决 `S-A1`/`S-B1` 映射（`clue-scan`/`hva-five-checks`）；`S-A2~S-A4`/`S-B2~S-B4` 的 code 名与加载方式待 **T-24（external-deps §7 L461）** 关闭。加载机制（A-4，external-deps §3 L215）已确认挂载 `S-A1`/`S-B1`，其余待 T-24。

## 反向清单
- 本文件被下列文件引用（预计）：`server/agent-orchestrator/`（阶段4 启动加载，组装 `agent_version_snapshot`）｜ `docs/04-plan/dev-plan.md`（阶段0 L69 / 阶段4 L126）｜ `docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle）｜ `docs/02-prd/PRD-M3-机会发现Agent.md` §1.1 / `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1。
- 登记于 `agent-runtime/README.md` 目录树。
