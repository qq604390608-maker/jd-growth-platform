# agent-runtime/ · 运行时资产目录

<!-- 文档卡
上游：`AGENTS.md`（宪法：编号体系｜双向引用｜索引三层｜目录名不得改）｜ `docs/03-locks/tech-stack.md` §2.5（agent.md 本体仓库文件 + MD-13 登记）§3.3 §7（模块归属与部署）｜ `docs/04-plan/dev-plan.md` 阶段0（L69 `agent-runtime/` 骨架：目录与版本管理机制，先于 M3/M4 落地本体）｜ `docs/02-prd/PRD-M3-机会发现Agent.md` §1.1 / `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1（领域能力定义）｜ `docs/03-locks/schema.md` MD-13 `agent_profile` / MD-14 `skill_registry`（登记与版本引用口径）
本文件：`agent-runtime/README.md` —— 枝杈索引（目录树 + 状态 + 反向清单）
下游：`server/agent-orchestrator/`（阶段4 加载 agent.md / skills，组装 `agent_version_snapshot`）｜ `docs/04-plan/dev-plan.md`（阶段4 M3/M4）｜ `docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 用例 oracle）
-->

## 目录职责
运行时资产：公共业务指令、两个 Agent 的 agent.md 与 skills、工具注册表。本体为仓库文件，登记入 `MD-13` / `MD-14`（详见 `VERSIONS.md`）。

## 目录树（阶段0 骨架）
```
agent-runtime/
├── README.md                 # 本文件（枝杈索引）
├── VERSIONS.md               # 版本管理机制（MD-13/MD-14 登记载体）★核心交付
├── business-rules.md         # 公共业务指令（两 Agent 共用，✅ 本体 F-18 2026-09-20）
├── discovery/                # 机会发现 Agent（M3）
│   ├── agent.md              # 角色指令（✅ 本体 2026-09-20）
│   └── skills/
│       ├── S-A1.md           # 线索扫描（MD-14 已种：clue-scan）
│       ├── S-A2.md           # （建壳，code 名待 T-24）
│       ├── S-A3.md           # （建壳，code 名待 T-24）
│       └── S-A4.md           # （建壳，code 名待 T-24）
└── hva/                      # HVA 分析 Agent（M4）
    ├── agent.md              # 角色指令（✅ 本体 F-18 2026-09-20）
    └── skills/
        ├── S-B1.md           # HVA 五查（MD-14 已种：hva-five-checks）
        ├── S-B2.md           # （建壳，code 名待 T-24）
        ├── S-B3.md           # （建壳，code 名待 T-24）
        └── S-B4.md           # （建壳，code 名待 T-24）
```

## 状态
- **阶段0 骨架已建（2026-09-19）**：目录 + 版本管理机制 `VERSIONS.md` + `agent.md`/`business-rules.md`/`S-A1~S-A4`/`S-B1~S-B4` 建壳（仅文件与文档卡）。
- **阶段4 落地（进行中）**：`business-rules.md`（公共业务指令 8 条）与 `hva/agent.md`（角色指令五段）本体已由 **F-18** 落地（2026-09-20；服务端装载见 `server/agent-orchestrator/role.js`）。
- **待阶段4**：`discovery/agent.md` 与 skills 本体内容（`S-A2~S-A4`/`S-B2~S-B4` 的 `skill_code` 受 T-24 阻塞）。
- **已登记未擅自改（F-18 实施发现）**：`discovery/agent.md` 仍为建壳，其建壳声明写「待阶段4 落地」，而 M3（F-13~F-17）已于 2026-09-20 收口——**F-13 只落了服务端 MD-13/MD-14 登记与版本管理，未落 agent.md 本体**，故 M3 侧角色指令本体形成缺口。本文件只如实登记，**不擅自补写**（等用户裁决）。
- **未决项**：✅ ~~T-23~~（已决 2026-09-20，依用户裁决：版本机制即真实形态，随 F-13/F-18 收口）；🟡 T-24 改窄（2026-09-20，依用户裁决）：加载方式 ✅（A-4）、主技能映射 ✅（Q-07），剩余仅 S-A2~S-A4/S-B2~S-B4 code 名待 PM（external-deps §7）。

## 反向清单
- 本目录被下列文件引用（预计）：`server/agent-orchestrator/`（阶段4 加载）｜ `docs/04-plan/dev-plan.md`（阶段0 L69 / 阶段4 L126）｜ `docs/02-prd/PRD-M3-机会发现Agent.md` §1.1（L21/L65/L122）｜ `docs/02-prd/PRD-M4-HVA分析Agent.md` §1.1（L19/L121）｜ `docs/05-test-cases/test-M3.md` / `test-M4.md`（F-13~F-22 oracle）。
- 本目录状态位登记于 `AGENTS.md` 索引表（L17，已由「待建」翻为「✅ 工程骨架已建 2026-09-19」）。
