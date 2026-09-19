# business-rules.md · 公共业务指令（两 Agent 共用）

<!-- 文档卡
上游：`AGENTS.md`（宪法：编号体系｜双向引用）｜ `docs/03-locks/tech-stack.md` §2.5（agent-runtime 归属）｜ `docs/04-plan/dev-plan.md` 阶段0（L69 骨架）/ 阶段4（L126 落地本体）｜ `docs/02-prd/PRD-M3-机会发现Agent.md` §1.1.2 / `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1.2（公共业务指令 8 条）
本文件：`agent-runtime/business-rules.md` —— 机会发现 Agent 与 HVA 分析 Agent 共用的行为边界（建壳）
下游：`agent-runtime/discovery/agent.md` / `agent-runtime/hva/agent.md`（被两 Agent 角色指令引用）｜ `server/agent-orchestrator/`（阶段4 注入上下文）｜ `docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle）
-->

## 定位
本文件定义两个 Agent 共用的公共业务指令（行为边界），被 `discovery/agent.md` 与 `hva/agent.md` 引用。

## 建壳声明
> 本文件为**阶段0 骨架建壳**。公共业务指令 8 条（含「查询经工具执行程序、禁模型预期替代结果」「引用证据须带来源/条件/时点/适用范围」「不调生产写接口硬红线」等）本体待**阶段4（dev-plan 阶段4 M3/M4）** 落地，验收 oracle 见 `docs/05-test-cases/test-M3.md` / `test-M4.md`。

## 反向清单
- 本文件被下列文件引用（预计）：`agent-runtime/discovery/agent.md` / `agent-runtime/hva/agent.md`（角色指令引用）｜ `server/agent-orchestrator/`（阶段4 上下文注入）｜ `docs/04-plan/dev-plan.md`（阶段4 L126）｜ `docs/05-test-cases/test-M3.md` / `test-M4.md`。
- 登记于 `agent-runtime/README.md` 目录树。
