# S-A1 · 线索扫描（clue-scan）

<!-- 文档卡
上游：`AGENTS.md`（宪法：编号体系 S-Ax）｜ `docs/04-plan/dev-plan.md` 阶段4（L126）｜ `docs/02-prd/PRD-M3-机会发现Agent.md` §1.1.3（S-A1 发现任务调度，F-14/F-15）｜ `docs/03-locks/schema.md` MD-14 `skill_registry`（`skill_no=S-A1`、`skill_code=clue-scan`、`bound_agent_code=discovery-agent`、`version=v1.0`，已种 Q-07 已决）｜ `agent-runtime/VERSIONS.md` §2.3
本文件：`agent-runtime/discovery/skills/S-A1.md` —— 机会发现 Agent 技能「线索扫描」（建壳）
下游：`server/agent-orchestrator/`（阶段4 加载）｜ `agent-runtime/discovery/agent.md`（角色指令引用）｜ `docs/05-test-cases/test-M3.md`（F-14/F-15 oracle）
-->

## 定位
机会发现 Agent（M3）技能 S-A1 `clue-scan`：接收启动上下文，按目标规划查证顺序，逐项发起查证，产出查证计划＋逐项结果（PRD-M3 §1.1.3）。

## 建壳声明
> 本文件为**阶段0 骨架建壳**。技能本体（输入/动作/输出/停止条件，对应 PRD-M3 §1.1.3 S-A1）待**阶段4** 落地；MD-14 已种（`skill_no=S-A1`，Q-07 已决）。验收 oracle 见 `docs/05-test-cases/test-M3.md`（TC-A-M3-001 等）。

## 反向清单
- 本文件被下列文件引用（预计）：`server/agent-orchestrator/`（阶段4 加载）｜ `agent-runtime/discovery/agent.md`｜ `docs/04-plan/dev-plan.md`（阶段4 L126）｜ `docs/05-test-cases/test-M3.md`。
- 登记于 `agent-runtime/README.md` 目录树 与 `agent-runtime/VERSIONS.md` §2.3。
