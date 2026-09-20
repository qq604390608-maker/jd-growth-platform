/**
 * 文档卡（阶段4 · M3 · F-13 角色指令配置 · 2026-09-20）
 * 上游：../../../docs/02-prd/PRD-M3-机会发现Agent.md（§1.1 领域能力定义：agent.md / business-rules.md / S-A1~S-A4｜F-13 角色指令配置）
 *   ｜ ../../../docs/05-test-cases/test-M3.md（**TC-D-M3-001**（L3·F-13：MD-13 `agent_code` UNIQUE 拒绝重复）｜
 *        **TC-D-M3-002**（L3·F-13/F-16：MD-14 `S-A1`/`clue-scan`/`bound_agent_code=discovery-agent`，PK/UK/FK 三反例）｜
 *        **TC-C-M3-001**（L2·F-13：Agent 产出结构化 JSON，response_format=json_schema 强制；⚠️ A-1 LLM 未提供 → 本文件不实现推理，仅定义能力登记与版本管理，该 oracle 项登记为「门禁未关闭、非发布门禁」）
 *        **TC-I-M3-003**（L5·F-13：五查口径；结束条件））
 *   ｜ ../../../docs/01-brd/BRD.md §4 F-13（角色指令配置：agent.md 定义「你是谁」）｜ §7 验收总则
 *   ｜ ../../../docs/03-locks/schema.md（MD-13 agent_profile、MD-14 skill_registry、§12 Q-07 已决 S-A1↔clue-scan↔AGP-DISC）
 *   ｜ ../../../docs/03-locks/external-deps.md（A-3 指令加载与版本管理＝F-13/F-18/F-06/F-32；A-1 LLM ⬜ 未提供（最大风险））
 *   ｜ ../../../docs/04-plan/dev-plan.md（阶段4 · M3：F-13~F-17；agent-orchestrator 模块）
 * 职责：F-13 领域能力注册与版本管理——agent.md 角色指令（MD-13）登记与版本引用、Skill 能力登记（MD-14）。
 *   **本文件是 MD-13 / MD-14 的首个（也是唯一）写入面**，供 F-02（发现任务加载角色指令）、F-06（任务态记录指令与能力版本）与 F-14~F-22（Agent 运行期）复用。
 * 硬红线：① **零外部调用**（不发起任何 HTTP / 不调 LLM——A-1 门禁只挡推理，不挡本文件的配置与版本管理）；
 *   ② **单一写入面**：只写 MD-13 / MD-14，不直接写其它表；③ 不复制中文枚举（agent_code 值域从 dict:AGENT_CODE 现读，但本文件不内联字典，约束由 DDL/种子承担）；
 *   ④ 版本管理＝「同 agent_code 单行版本号推进」（`agent_code` UNIQUE 保证），**不新建行、历史版本不落表**（任务启动时由 F-06 落 `agent_version_snapshot` 快照冻结）。
 * 边界：business-rules.md（公共业务指令）的加载归后续；本文件只管 agent.md 角色指令 + Skill 注册。
 * 反向清单：登记 ./README.md 与 ../../README.md；被 CI `validate` 步骤复用（node server/agent-orchestrator/test-f13.mjs）。
 *
 * 用法：import { registerAgentProfile, getAgentProfile, bumpAgentProfileVersion, registerSkill, listAgentSkills, composeAgentVersionSnapshot } from "./profile.js";
 */

/**
 * 注册角色指令（MD-13）。唯一写入面之一；`agent_code` UNIQUE 由库级强制，重复 agent_code 的插入反例在 test-f13 断言。
 * 约束失败（UNIQUE/PK）抛出 Error（与 F-26 task-state.js 一致：run() 失败即抛）。
 * @param {object} db
 * @param {object} p { profile_id, agent_code, agent_name, agent_stage, current_version, doc_revision, is_active=1 }
 * @returns {{ success: boolean, changes?: number }}
 */
export async function registerAgentProfile(db, {
  profile_id, agent_code, agent_name, agent_stage, current_version, doc_revision, is_active = 1,
}) {
  const res = db.prepare(
    "INSERT INTO agent_profile (profile_id, agent_code, agent_name, agent_stage, current_version, doc_revision, is_active) " +
    "VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(profile_id, agent_code, agent_name, agent_stage, current_version, doc_revision, is_active).run();
  if (res.success === false) throw new Error(res.error || "agent_profile 插入失败");
  return { success: true, changes: Number(res.meta?.changes ?? res.changes ?? 0) };
}

/**
 * 读角色指令（MD-13）。只读，返回单行或 null。
 * @param {object} db D1 形态（prepare().bind().first()）
 * @param {string} agent_code discovery-agent / hva-agent
 * @returns {object|null}
 */
export async function getAgentProfile(db, agent_code) {
  return db.prepare(
    "SELECT profile_id, agent_code, agent_name, agent_stage, current_version, doc_revision, is_active " +
    "FROM agent_profile WHERE agent_code = ?"
  ).bind(agent_code).first();
}

/**
 * 读某 Agent 当前生效（is_active=1）的 Skill 列表（MD-14）。只读。
 * @param {object} db
 * @param {string} agent_code
 * @returns {Array<object>}
 */
export async function listAgentSkills(db, agent_code) {
  const r = db.prepare(
    "SELECT skill_no, skill_code, skill_name, version, bound_agent_code, is_active " +
    "FROM skill_registry WHERE bound_agent_code = ? AND is_active = 1 ORDER BY skill_no"
  ).bind(agent_code).all();
  return r.results ?? [];
}

/**
 * 版本管理（MD-13）：推进 agent.md 的版本引用——只更新同 agent_code 单行的 current_version / doc_revision，**不新建行**。
 * agent_code UNIQUE 约束由库级强制；传入不存在的 agent_code 不报错（UPDATE 影响 0 行），由调用方先 getAgentProfile 判存在。
 * @param {object} db
 * @param {object} p { agent_code, current_version, doc_revision }
 * @returns {number} 受影响行数（应为 0 或 1）
 */
export async function bumpAgentProfileVersion(db, { agent_code, current_version, doc_revision }) {
  const res = db.prepare(
    "UPDATE agent_profile SET current_version = ?, doc_revision = ? WHERE agent_code = ?"
  ).bind(current_version, doc_revision, agent_code).run();
  return Number(res.meta?.changes ?? res.changes ?? 0);
}

/**
 * 注册 Skill 能力（MD-14）。唯一写入面之一；PK（skill_no）/ UK（skill_code）/ FK（bound_agent_code→agent_profile.agent_code）
 * 全部由库级强制，反例在 test-f13 断言。约束失败（PK/UK/FK）抛出 Error（与 F-26 task-state.js 一致）。
 * @param {object} db
 * @param {object} p { skill_no, skill_code, skill_name, version, bound_agent_code, is_active=1 }
 * @returns {{ success: boolean, changes?: number }}
 */
export async function registerSkill(db, {
  skill_no, skill_code, skill_name, version, bound_agent_code, is_active = 1,
}) {
  const res = db.prepare(
    "INSERT INTO skill_registry (skill_no, skill_code, skill_name, version, bound_agent_code, is_active) " +
    "VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(skill_no, skill_code, skill_name, version, bound_agent_code, is_active).run();
  if (res.success === false) throw new Error(res.error || "skill_registry 插入失败");
  return { success: true, changes: Number(res.meta?.changes ?? res.changes ?? 0) };
}

/**
 * 组装「指令 + 能力」版本快照串（供 F-06 任务态 `agent_version_snapshot` 冻结落库）。
 * 形态对齐种子 task.agent_version_snapshot：`discovery-agent v1.2 / agent.md r9 / skills: clue-scan v1.0`。
 * 只读 MD-13 + MD-14（is_active=1）。
 * @param {object} db
 * @param {string} agent_code
 * @returns {string|null} 找不到 profile 时返回 null
 */
export async function composeAgentVersionSnapshot(db, agent_code) {
  const p = await getAgentProfile(db, agent_code);
  if (!p) return null;
  const skills = await listAgentSkills(db, agent_code);
  const skillPart = skills.map((s) => `${s.skill_code} ${s.version}`).join(", ");
  return `${p.agent_code} ${p.current_version} / agent.md ${p.doc_revision}` +
    (skillPart ? ` / skills: ${skillPart}` : "");
}
