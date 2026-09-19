# S-B1 · HVA 五查（hva-five-checks）

<!-- 文档卡
上游：`AGENTS.md`（宪法：编号体系 S-Bx）｜ `docs/04-plan/dev-plan.md` 阶段4（L126）｜ `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1.3（S-B1 研究任务调度，F-19）｜ `docs/03-locks/schema.md` MD-14 `skill_registry`（`skill_no=S-B1`、`skill_code=hva-five-checks`、`bound_agent_code=hva-agent`、`version=v1.1`，已种 Q-07 已决）｜ `agent-runtime/VERSIONS.md` §2.3
本文件：`agent-runtime/hva/skills/S-B1.md` —— HVA 分析 Agent 技能「HVA 五查」（建壳）
下游：`server/agent-orchestrator/`（阶段4 加载）｜ `agent-runtime/hva/agent.md`（角色指令引用）｜ `docs/05-test-cases/test-M4.md`（F-19 oracle）
-->

## 定位
HVA 分析 Agent（M4）技能 S-B1 `hva-five-checks`：接产品问题，选研究路径（查证假设／寻找候选／说明限制），定比较条件、排查证顺序，产出研究计划（PRD-M4 §1.1.3）。

## 建壳声明
> 本文件为**阶段0 骨架建壳**。技能本体（输入/动作/输出/停止条件，对应 PRD-M4 §1.1.3 S-B1）待**阶段4** 落地；MD-14 已种（`skill_no=S-B1`，Q-07 已决）。验收 oracle 见 `docs/05-test-cases/test-M4.md`（TC-A-M4-001 等）。

## 反向清单
- 本文件被下列文件引用（预计）：`server/agent-orchestrator/`（阶段4 加载）｜ `agent-runtime/hva/agent.md`｜ `docs/04-plan/dev-plan.md`（阶段4 L126）｜ `docs/05-test-cases/test-M4.md`。
- 登记于 `agent-runtime/README.md` 目录树 与 `agent-runtime/VERSIONS.md` §2.3。
