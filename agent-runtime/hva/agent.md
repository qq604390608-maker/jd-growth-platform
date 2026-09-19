# agent.md · HVA 分析 Agent（hva-agent）

<!-- 文档卡
上游：`AGENTS.md`（宪法：编号体系｜双向引用｜索引三层）｜ `docs/03-locks/tech-stack.md` §2.5（agent.md 本体仓库文件）｜ `docs/04-plan/dev-plan.md` 阶段0（L69 骨架）/ 阶段4（L126 落地）｜ `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1.1（角色指令）｜ `docs/03-locks/schema.md` MD-13 `agent_profile`（`agent_code=hva-agent`、`profile_id=AGP-HVA`、`current_version=v1.3`、`doc_revision=r12`）
本文件：`agent-runtime/hva/agent.md` —— HVA 分析 Agent 角色指令「你是谁：职责/输入/输出/结束条件」（建壳）
下游：`server/agent-orchestrator/`（阶段4 加载 hva-agent）｜ `agent-runtime/business-rules.md`（共用指令）｜ `agent-runtime/hva/skills/S-B1~S-B4.md`（可调能力）｜ `docs/05-test-cases/test-M4.md`（F-18~F-22 oracle）
-->

## 定位
HVA 分析 Agent（M4）角色指令：定义第二阶段职责、输入、输出与结束条件；与 Skill（能消费什么）、程序（能干什么）构成领域能力。

## 建壳声明
> 本文件为**阶段0 骨架建壳**。角色指令本体（职责/输入/输出/结束条件，对应 PRD-M4 §1.1.1）待**阶段4（dev-plan 阶段4 M4）** 落地；登记见 `MD-13 agent_profile`（`agent_code=hva-agent`，`VERSIONS.md` §2.1）。验收 oracle 见 `docs/05-test-cases/test-M4.md`。

## 反向清单
- 本文件被下列文件引用（预计）：`server/agent-orchestrator/`（阶段4 加载）｜ `docs/04-plan/dev-plan.md`（阶段4 L126）｜ `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1.1｜ `docs/05-test-cases/test-M4.md`。
- 登记于 `agent-runtime/README.md` 目录树。
