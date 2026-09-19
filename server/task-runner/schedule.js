/**
 * 文档卡（阶段3 · M1 · F-02 机会发现任务调度 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M1.md`（**TC-U-M1-001 = `run_frequency` 解析：合法 Cron、最小粒度 ≥ 1 分钟、
 *        超限报错**；**TC-U-M1-002 = `retry_limit` 落库封顶 ≤ 100 且超限显式报错**；
 *        TC-I-M1-001 = 任务程序决定何时启动、Agent 只在任务内被调用；TC-I-M1-006 = 消息只带 `task_id`+`step_no`、上下文现读）
 *   ｜ `../../docs/02-prd/PRD-M1-平台任务程序.md` F-02（验收要点：任务程序决定何时启动；Agent 只在任务内选择分析方法）
 *   ｜ `../../docs/01-brd/BRD.md` §3.1 流程主线（登记目标 → 调度 → M3 机会发现）+ §4 F-02
 *   ｜ `../../docs/03-locks/tech-stack.md` **§2.4**（Cron 到点 → 查 `CFG-04` → 建 `task` → 发 Queue 消息
 *        **只含 `task_id` + `step_no`** → Consumer 执行一步，**上下文一律从 D1 现读**）+ **§4.2**
 *        （Cron 最小粒度 **1 分钟**、账号 Triggers 上限 Free 5 / **Paid 250**；Queues `max_retries` **≤ 100**；
 *        Queue Consumer CPU/墙钟 **≤ 15 分钟** → `max_duration_min` 上限被平台钉死）+ **§5**（`CFG-04` → 平台配置映射）
 *   ｜ `../../docs/03-locks/schema.md` CFG-04 `run_policy`（`policy_scope` 平台级/目标级、`goal_id` 平台级为空、
 *        `run_frequency`、`max_duration_min`、`call_limit`、`retry_limit`、`is_active`）｜MD-13 `agent_profile`
 *        （`current_version` / `doc_revision` → 快照来源）｜MD-14 `skill_registry`（`bound_agent_code`）｜
 *        PD-01 `task`（`agent_version_snapshot` NOT NULL）｜LNK-04 `task_object`（启动对象/产出对象）
 *   ｜ `../../docs/03-locks/tech-stack.md` §5.1（`CFG-04` 缺 `retry_delay_sec`/`dead_letter_flag` —— 登记 `TS-17`）
 *   ｜ `./step-plan.js`（任务骨架：取号 / 建行 / 步骤 / 进度 / `LNK-04`）｜`../shared-context/index.js`（F-12 注入）
 * 职责：**运行策略**的登记与选取（目标级优先、回落平台级）、**运行频率 → Cron Triggers 表达式**的解析与校验、
 *   **发现任务**（`task_type=discovery`）的创建与派发（建任务 → 关联启动对象 → 五步计划 → 按 `CFG-06` 装配上下文 →
 *   发 Queue 消息）、以及「Agent 只在任务内被调用」的**调用守卫**。
 * 边界：本文件的写库**只落在 `CFG-04 run_policy` 一张表**（`saveRunPolicy`，改行必带主键条件）；
 *   任务与步骤的建行 / 改行一律经 `./step-plan.js`（单一写入面）；**不直接调外部接口**（无 `fetch`）；
 *   真实 Agent 调用归阶段4，本文件只提供**契约占位** `delegateToAgent`（必须带 `task_id` + `step_no`）。
 * 门禁状态：无外部依赖（纯本地库读写 + 可注入的 `enqueue` 端口）。
 *
 * 反向清单：被 `../api/index.js`（F-02 路由）引用；被本目录 `./goal.js` 的「应用配置」下游引用
 *   （见 `./README.md`）；登记 `./README.md` 与 `../README.md`；测试 `./test-f02.mjs`。
 */
import {
  createTask,
  planTaskSteps,
  advanceStep,
  listTaskSteps,
  linkTaskObject,
  getTask,
  dictCodes,
} from "./step-plan.js";
import { initTaskContext } from "../shared-context/index.js";

function nowStamp() {
  return new Date().toISOString().slice(0, 16).replace("T", " ");
}

/** 账号级 Cron Triggers 条数上限（`tech-stack.md` §4.2：Paid 250 条）。 */
export const CRON_TRIGGER_LIMIT = 250;

/** 最小调度粒度（分钟）——`tech-stack.md` §4.2：Cron 最小粒度 1 分钟，**秒级不受支持**。 */
export const MIN_GRANULARITY_MIN = 1;

/** Queue Consumer 单步时长上限（分钟）——`tech-stack.md` §4.2：CPU 与墙钟均为 15 分钟。 */
export const MAX_DURATION_MIN_LIMIT = 15;

/** Queues `max_retries` 平台硬上限——`tech-stack.md` §4.2。 */
export const RETRY_LIMIT_PLATFORM_MAX = 100;

/** Queue 消息体积设计上限（`tech-stack.md` §2.4：消息只带两个字段，不超 1 KB）。 */
export const STEP_MESSAGE_MAX_BYTES = 1024;

const WEEKDAYS = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 0, 天: 0 };

/**
 * 运行频率 → Cron Triggers 表达式。
 *
 * **支持四式（其余一律显式报错，不自造语法）**：
 * | 写法 | 展开 |
 * | ---- | ---- |
 * | `每日 02:00` | `0 2 * * *` |
 * | `每日 02:00,14:00` | `0 2 * * *` + `0 14 * * *`（多时点 → 多条 Trigger） |
 * | `每 2 小时` | 分位 `0` + 时位步长 `2`（Cloudflare 的步长语法）+ 日 / 月 / 周为 `*`（`N` ∈ 1~23） |
 * | `每周一 09:30` | `30 9 * * 1`（`一`~`日`） |
 *
 * 校验：分钟 / 小时均须在合法区间的**两位**写法；含秒位（如 `02:00:30`）→ 报错
 * （最小粒度 1 分钟）；展开条数 > 250 → 报错（账号 Triggers 上限）。
 */
export function parseRunFrequency(text) {
  const raw = String(text ?? "").trim();
  const fail = (why) => {
    throw new Error(
      `无法解析的运行频率：'${raw}'（${why}）；支持：每日 HH:MM ｜ 每日 HH:MM,HH:MM ｜ 每 N 小时 ｜ 每周<一~日> HH:MM`,
    );
  };
  if (!raw) fail("为空");

  const hm = (h, m) => {
    if (!/^\d{2}$/.test(h) || !/^\d{2}$/.test(m)) fail("时 / 分须为两位数字（如 02:00）");
    const hh = Number(h);
    const mm = Number(m);
    if (hh > 23) fail(`小时 ${h} 超出 0~23`);
    if (mm > 59) fail(`分钟 ${m} 超出 0~59`);
    return { hh, mm };
  };

  let points = [];
  let kind = null;

  let m = /^每日\s+(.+)$/.exec(raw);
  if (m) {
    const parts = m[1].split(",").map((s) => s.trim());
    if (parts.some((p) => p.split(":").length > 2)) fail("含秒位（最小粒度 1 分钟）");
    if (!parts.every((p) => /^\d{1,2}:\d{1,2}$/.test(p))) fail("时刻须形如 HH:MM");
    points = parts.map((p) => {
      const [h, mi] = p.split(":");
      const { hh, mm } = hm(h.padStart(2, "0"), mi.padStart(2, "0"));
      return { hh, mm, dow: null };
    });
    kind = parts.length > 1 ? "daily_multi" : "daily";
  } else if ((m = /^每\s*(\d+)\s*小时$/.exec(raw))) {
    const n = Number(m[1]);
    if (!(n >= 1 && n <= 23)) fail(`「每 N 小时」的 N 须在 1~23（24 小时请写「每日 HH:MM」）`);
    points = [{ everyHours: n }];
    kind = "hourly";
  } else if ((m = /^每周([一二三四五六日天])\s+(\d{1,2}):(\d{1,2})$/.exec(raw))) {
    const dow = WEEKDAYS[m[1]];
    const { hh, mm } = hm(m[2].padStart(2, "0"), m[3].padStart(2, "0"));
    points = [{ hh, mm, dow }];
    kind = "weekly";
  } else {
    fail("不符合四种受支持的写法之一");
  }

  const normalized = points.map((p) =>
    p.everyHours ? `0 */${p.everyHours} * * *` : `${p.mm} ${p.hh} * * ${p.dow === null ? "*" : p.dow}`,
  );
  if (normalized.length > CRON_TRIGGER_LIMIT) {
    throw new Error(
      `运行频率展开为 ${normalized.length} 条 Trigger，超出账号上限 ${CRON_TRIGGER_LIMIT} 条（tech-stack §4.2 Paid 上限）`,
    );
  }
  normalized.forEach(assertCronExpression);
  return { raw, kind, cron: normalized, count: normalized.length, points };
}

/** Cron Triggers 表达式合法性（5 段：分 时 日 月 周；本项目只用「字面量 + 步长 + 通配」三形态）。 */
export function assertCronExpression(expr) {
  const parts = String(expr).trim().split(/\s+/);
  if (parts.length !== 5) throw new Error(`非法 Cron 表达式：'${expr}'（须为 5 段：分 时 日 月 周）`);
  const [mi, hh, dom, mon, dow] = parts;
  const okField = (v, lo, hi) => v === "*" || /^\*\/\d+$/.test(v) || (/^\d+$/.test(v) && Number(v) >= lo && Number(v) <= hi);
  if (!okField(mi, 0, 59)) throw new Error(`非法 Cron 表达式：'${expr}'（分钟位 '${mi}'）`);
  if (!okField(hh, 0, 23)) throw new Error(`非法 Cron 表达式：'${expr}'（小时位 '${hh}'）`);
  if (dom !== "*" || mon !== "*") throw new Error(`非法 Cron 表达式：'${expr}'（本项目只按「每日 / 每周」配置，日 / 月位须为 *）`);
  if (!okField(dow, 0, 6)) throw new Error(`非法 Cron 表达式：'${expr}'（星期位 '${dow}'）`);
  return true;
}

// ---------------------------------------------------------------- CFG-04 运行策略

/** 字典值域内的策略作用域（从库读，不内联）。 */
async function assertPolicyScope(db, scope) {
  const codes = await dictCodes(db, "POLICY_SCOPE");
  if (!codes.includes(scope)) {
    throw new Error(`policy_scope '${String(scope)}' 不在 dict:POLICY_SCOPE 值域内（${codes.join(" / ")}）`);
  }
}

/**
 * 登记 / 覆盖一条运行策略（`CFG-04`）。
 * **写入侧从严**（对齐 `TC-U-M1-002`：超限**显式报错**，不静默截断）：
 *   `retry_limit` ∉ 0~100 → 报错；`max_duration_min` > 15 → 报错（平台单步上限）；
 *   `call_limit` < 1 → 报错；`run_frequency` 不可解析 → 报错。
 * （消费侧对历史脏数据的兜底截断见 `../tool-executor/index.js` 的 `retryLimitOf`——两侧分工不同，均已登记。）
 */
export async function saveRunPolicy(db, input = {}) {
  const { policy_id, policy_scope, goal_id = null, run_frequency, max_duration_min = null, call_limit = null, retry_limit, is_active = 1 } = input;
  if (!policy_id) throw new Error("saveRunPolicy：policy_id 必填");
  await assertPolicyScope(db, policy_scope);
  if (policy_scope === "platform" && goal_id) throw new Error("saveRunPolicy：平台级策略的 goal_id 须为空");
  if (policy_scope === "goal") {
    if (!goal_id) throw new Error("saveRunPolicy：目标级策略必须带 goal_id");
    const g = await db.prepare("SELECT goal_id FROM research_goal WHERE goal_id = ?").bind(goal_id).first();
    if (!g) throw new Error(`目标不存在：${goal_id}`);
  }
  parseRunFrequency(run_frequency);

  const rl = Number(retry_limit);
  if (!Number.isInteger(rl) || rl < 0) throw new Error("saveRunPolicy：retry_limit 须为 ≥0 的整数");
  if (rl > RETRY_LIMIT_PLATFORM_MAX) {
    throw new Error(
      `retry_limit=${rl} 超出 Queues max_retries 平台硬上限 ${RETRY_LIMIT_PLATFORM_MAX}（tech-stack §4.2）——拒绝落库，不静默截断`,
    );
  }
  let md = null;
  if (max_duration_min !== null && max_duration_min !== undefined) {
    md = Number(max_duration_min);
    if (!Number.isInteger(md) || md < 1) throw new Error("saveRunPolicy：max_duration_min 须为 ≥1 的整数或留空");
    if (md > MAX_DURATION_MIN_LIMIT) {
      throw new Error(
        `max_duration_min=${md} 超出 Queue Consumer 单步上限 ${MAX_DURATION_MIN_LIMIT} 分钟（tech-stack §4.2）——超出则任务必须切步`,
      );
    }
  }
  let cl = null;
  if (call_limit !== null && call_limit !== undefined) {
    cl = Number(call_limit);
    if (!Number.isInteger(cl) || cl < 1) throw new Error("saveRunPolicy：call_limit 须为 ≥1 的整数或留空");
  }

  const exists = await db.prepare("SELECT policy_id FROM run_policy WHERE policy_id = ?").bind(policy_id).first();
  const r = exists
    ? await db
        .prepare("UPDATE run_policy SET policy_scope = ?, goal_id = ?, run_frequency = ?, max_duration_min = ?, call_limit = ?, retry_limit = ?, is_active = ? WHERE policy_id = ?")
        .bind(policy_scope, goal_id, String(run_frequency), md, cl, rl, Number(is_active) ? 1 : 0, policy_id)
        .run()
    : await db
        .prepare("INSERT INTO run_policy (policy_id, policy_scope, goal_id, run_frequency, max_duration_min, call_limit, retry_limit, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .bind(policy_id, policy_scope, goal_id, String(run_frequency), md, cl, rl, Number(is_active) ? 1 : 0)
        .run();
  if (r && r.success === false) throw new Error(r.error || "run_policy 写入失败");
  return db.prepare("SELECT * FROM run_policy WHERE policy_id = ?").bind(policy_id).first();
}

/** 运行策略列表（`CFG-04`）。 */
export async function listRunPolicies(db, { policy_scope, goal_id, activeOnly = false } = {}) {
  const where = [];
  const args = [];
  if (policy_scope !== undefined) { where.push("policy_scope = ?"); args.push(policy_scope); }
  if (goal_id !== undefined) { where.push("goal_id = ?"); args.push(goal_id); }
  if (activeOnly) where.push("is_active = 1");
  const sql = `SELECT * FROM run_policy ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY policy_id`;
  return (await db.prepare(sql).bind(...args).all()).results;
}

/**
 * 选出生效的运行策略：**目标级优先，回落平台级**（`CFG-04` 的两级作用域）。
 * 两级都没有可用策略 → **显式报错**（调度缺了频率就是无依据创建任务，不能兜底猜）。
 */
export async function resolveRunPolicy(db, { goal_id } = {}) {
  const goalLevel = (
    await db
      .prepare("SELECT * FROM run_policy WHERE is_active = 1 AND policy_scope = 'goal' AND goal_id = ? ORDER BY policy_id")
      .bind(goal_id)
      .all()
  ).results;
  if (goalLevel.length) return { policy: goalLevel[0], source: "goal", candidates: goalLevel };
  const platform = (
    await db
      .prepare("SELECT * FROM run_policy WHERE is_active = 1 AND policy_scope = 'platform' ORDER BY policy_id")
      .bind()
      .all()
  ).results;
  if (platform.length) return { policy: platform[0], source: "platform", candidates: platform };
  throw new Error(`无可用运行策略：目标 ${goal_id} 既无生效的目标级策略，平台级也无生效策略（CFG-04）`);
}

// ---------------------------------------------------------------- MD-13/MD-14 能力版本快照

/**
 * 拼 `PD-01.agent_version_snapshot`：`<agent_code> <current_version> / agent.md <doc_revision>[ / skills: ...]`。
 * 口径来自 `MD-13` + `MD-14`（种子 `T-1022` 的既有写法同此形）。
 */
export async function agentSnapshotOf(db, profile_id) {
  const profile = await db.prepare("SELECT * FROM agent_profile WHERE profile_id = ?").bind(profile_id).first();
  if (!profile) throw new Error(`Agent 角色指令不存在：${profile_id}`);
  const skills = (
    await db
      .prepare("SELECT * FROM skill_registry WHERE bound_agent_code = ? AND is_active = 1 ORDER BY skill_no")
      .bind(profile.agent_code)
      .all()
  ).results;
  let text = `${profile.agent_code} ${profile.current_version} / agent.md ${profile.doc_revision}`;
  if (skills.length) text += ` / skills: ${skills.map((s) => `${s.skill_code} ${s.version}`).join(", ")}`;
  return { profile, skills, snapshot: text };
}

// ---------------------------------------------------------------- Queue 消息（可注入端口 + 本地实现）

/**
 * 消息形状守卫：**恰好** `{ task_id, step_no }` 两个键——多一个键都可能把上下文塞进消息
 * （`tech-stack` §2.4：消息 ≤128 KB 是平台限制，设计口径是「不超 1 KB、上下文从 D1 现读」）。
 */
export function assertStepMessage(message) {
  const keys = Object.keys(message ?? {}).sort();
  if (keys.length !== 2 || keys[0] !== "step_no" || keys[1] !== "task_id") {
    throw new Error(`Queue 消息只能含 { task_id, step_no } 两个键（实测 ${keys.join(",") || "空"}）`);
  }
  if (typeof message.task_id !== "string" || !message.task_id) throw new Error("Queue 消息：task_id 必填");
  if (!Number.isInteger(message.step_no) || message.step_no < 1) throw new Error("Queue 消息：step_no 须为 ≥1 的整数");
  const size = Buffer.byteLength(JSON.stringify(message), "utf8");
  if (size > STEP_MESSAGE_MAX_BYTES) {
    throw new Error(`Queue 消息 ${size} 字节，超出设计上限 ${STEP_MESSAGE_MAX_BYTES} 字节（上下文不得入消息，须从 D1 现读）`);
  }
  return { message, size_bytes: size };
}

/**
 * 本机可跑的默认 `enqueue` 实现（无 wrangler / Queues 时的落地形态）。
 * 行为：校验消息形状 → 校验任务与步骤真实存在 → **把该步从 `pending` 置 `active`（这就是「已投递」的投递痕迹）**
 * → 返回确定性 `message_id`。测试可注入 spy 版本的 `enqueue` 来断言「发了什么、发了几条」。
 */
export function createLocalEnqueue(db, { at } = {}) {
  const enqueue = async (message) => {
    const { size_bytes } = assertStepMessage(message);
    const task = await getTask(db, message.task_id);
    if (!task) throw new Error(`任务不存在：${message.task_id}（不得为不存在的任务投递）`);
    const steps = await listTaskSteps(db, message.task_id);
    const step = steps.find((s) => s.step_no === message.step_no);
    if (!step) throw new Error(`步骤不存在：${message.task_id} 第 ${message.step_no} 步（须先 planTaskSteps）`);
    if (step.step_state === "pending") await advanceStep(db, { task_id: message.task_id, step_no: message.step_no, step_state: "active" });
    enqueue.delivered.push({ ...message, size_bytes, at: at || nowStamp() });
    return { message_id: `${message.task_id}#${message.step_no}`, message: { ...message }, size_bytes, delivered_at: at || nowStamp() };
  };
  enqueue.delivered = [];
  enqueue.kind = "local";
  return enqueue;
}

/**
 * 「Agent 只在任务内被调用」的调用守卫（`TC-I-M1-001`）：真实 Agent 调用归阶段4，
 * 此处只给**契约占位**——必须带 `task_id` + `step_no`，且该任务已落库。
 */
export async function delegateToAgent(db, { task_id, step_no, note } = {}) {
  if (!task_id) throw new Error("delegateToAgent：task_id 必填（Agent 只在任务内被调用，不得任务外自发行动）");
  const task = await getTask(db, task_id);
  if (!task) throw new Error(`任务不存在：${task_id}（不得在任务之外调用 Agent）`);
  const steps = await listTaskSteps(db, task_id);
  if (!steps.some((s) => s.step_no === step_no)) throw new Error(`步骤不存在：${task_id} 第 ${step_no} 步`);
  return {
    delegated: true,
    task_id,
    step_no,
    agent_profile_id: task.agent_profile_id,
    agent_version_snapshot: task.agent_version_snapshot,
    note: note || "阶段4 接入真实 Agent；本阶段为契约占位",
  };
}

// ---------------------------------------------------------------- F-02 发现任务

/**
 * 到点创建发现任务（`F-02`）：
 *   选策略（目标级优先）→ 解析运行频率为 Cron（**任务程序决定何时启动**）→ 建 `discovery` 任务
 *   → 关联启动对象（`LNK-04`，`link_role=trigger`，指向目标）→ 建五步计划
 *   → 按 `CFG-06` 装配并落 `PD-06` 上下文（**上下文现读，不入消息**）→ 发 Queue 消息（只带 `task_id`+`step_no`）。
 */
export async function createDiscoveryTask(db, {
  goal_id, goal_version_no, trigger_basis, at, enqueue, created_by = "task-runner",
} = {}) {
  const goal = await db.prepare("SELECT * FROM research_goal WHERE goal_id = ?").bind(goal_id).first();
  if (!goal) throw new Error(`目标不存在：${goal_id}`);
  const { policy, source } = await resolveRunPolicy(db, { goal_id });
  const schedule = parseRunFrequency(policy.run_frequency);
  const versionNo = goal_version_no ?? goal.current_version_no;
  const stamp = at || nowStamp();
  const snap = await agentSnapshotOf(db, "AGP-DISC");

  const task = await createTask(db, {
    task_type: "discovery",
    goal_id,
    goal_version_no: versionNo,
    trigger_basis: trigger_basis || `按运行频率（${policy.run_frequency}）自动创建发现任务`,
    agent_profile_id: snap.profile.profile_id,
    agent_version_snapshot: snap.snapshot,
    task_status: "running",
    started_at: stamp,
  });
  await linkTaskObject(db, { task_id: task.task_id, object_type: "goal", object_id: goal_id, link_role: "trigger", created_at: stamp });
  await planTaskSteps(db, task.task_id, "discovery");
  const context = await initTaskContext(db, { task_id: task.task_id, injected_at: stamp });

  const doEnqueue = typeof enqueue === "function" ? enqueue : createLocalEnqueue(db, { at: stamp });
  const dispatch = await doEnqueue({ task_id: task.task_id, step_no: 1 });

  return {
    task: await getTask(db, task.task_id),
    policy,
    policy_source: source,
    schedule,
    agent_snapshot: snap.snapshot,
    steps: await listTaskSteps(db, task.task_id),
    context,
    dispatch,
  };
}

/** 任务的派发面回查：步骤现状 + 已投递过的消息（`createLocalEnqueue` 实现下）。 */
export async function getTaskDispatch(db, task_id) {
  const task = await getTask(db, task_id);
  if (!task) throw new Error(`任务不存在：${task_id}`);
  return { task, steps: await listTaskSteps(db, task_id) };
}
