/**
 * 文档卡（阶段1 · M2 · **CFG-09 `id_sequence` 唯一写入面** · 2026-09-22）
 *
 * 上游：`../../AGENTS.md`（宪法：白盒原则｜编号体系｜双向引用）
 *   ｜ `../../docs/03-locks/schema.md` **v1.9** CFG-09 `id_sequence`（`namespace` PK / `next_val`；
 *        `next_val` 口径＝「**已发出的最大序号**」；归属与范围见 §0.2 v1.9 说明、§4 CFG-09、§12 **Q-18**）
 *   ｜ `../../db/migrations/0001_init.sql`（本表 DDL 真源：`CREATE TABLE id_sequence`）
 *   ｜ `../../docs/04-plan/full-flow-wiring-plan.md` §2.2（**P0-3 取号竞态**）与 §「编号映射」**F-35** 行
 *   ｜ `./README.md`（M2 文件清单：本文件登记为该表**唯一写入面**）
 *
 * 职责：**原子取号**。取代原先三处「读全量 → 自算库内最大 → +1」的**读后写**取号——
 *   P0-3 的成因正是它：两个执行体同时读到同一个 `max`、各自 `+1` 得到**同一个号**，撞主键后任务被判 `blocked`。
 *   收敛的三处（用户裁决＝选项 c「只改最热三条」）：
 *     ① `../task-runner/step-plan.js` 的 `nextTaskId`（PD-01 `task.task_id`，`T-####`）；
 *     ② 同文件 `nextResearchNo`（MD-07 `research.research_no`，`R-###`）；
 *     ③ `../agent-orchestrator/opportunity.js` 的 `nextOpportunityId`（MD-06 `opportunity.opportunity_id`，`OPP-###`）。
 *   **调用面不变**：三者仍对外暴露**同名、同返回形态**的函数，只是内部改为委托本文件。
 *
 * 为什么这样是原子的（**依据官方文档与本地实测，不是同类产品类推**）：
 *   ① 取号与取值合并成**同一条语句** —— `UPDATE ... SET next_val = next_val + 1 WHERE namespace = ? RETURNING next_val`，
 *      于是「读了之后再写」的窗口**根本不存在**（不是「窗口更小」）；
 *   ② Cloudflare D1 官方文档（`d1/worker-api/d1-database`）：`batch()` 保证语句「**sequentially, non-concurrently**」执行；
 *      且「**不使用 Sessions API 时，所有查询只由主库执行**」——本工程未用 `withSession`（全仓无该调用），
 *      故同一个库上的读-改-写天然串行；
 *   ③ `RETURNING` 为 SQLite 3.35+ 能力，本工程 `compatibility_date = "2026-09-19"`；**已在本地 `node:sqlite`（同一引擎）
 *      实测**：连续两次取号返回 8 / 9，第三次 `UPDATE` 命中不存在的命名空间返回空（故须显式报错，见下）。
 *
 * 三条纪律（可静态核对，`./test-f35.mjs` 断言）：
 *   ① **本文件是 `id_sequence` 的唯一写入面**——全仓只有这里出现 `INSERT INTO id_sequence` / `UPDATE id_sequence`；
 *      消费方**零裸 SQL**（opportunity.js 本来就零裸 SQL，本文件不破这条）。
 *   ② **命名空间与号的形态只此一份**（`ID_NAMESPACES`）——消费方只传「命名空间 + 冷路径取既有 id 的 thunk」，
 *      **不复制前缀正则**（否则就是第二个口径）。
 *   ③ **不写 `SELECT MAX`**：冷路径的种子由消费方传入的既有 id 清单**自算**（延续项目既定纪律）；
 *      该入参在**冷路径为必填**——省略会被当成「按 0 起步」，在已有数据的库上重发已用号，
 *      故宁可响亮报错（空库须**显式**传 `[]`）。热路径完全不读它。
 *
 * 边界（**如实登记，勿读作「万无一失」**）：
 *   · 只保证「**经本文件取号者之间**不撞号」。**旁路插入**（运维 SQL / 手工补数 / 旧代码路径）不经本表，
 *     可能使计数器**落后于实际数据**。收回漂移的**两条路**（都只抬不降、都幂等）：
 *       ① **冷路径自动**——计数器行**不存在**时，用消费方给的既有 id 清单种到「观测到的实际最大」；
 *       ② **显式修复**——`healSequence()`。热路径**刻意不回读业务表**（否则每次取号都要全表扫描），
 *          故旁路插入之后它**不会自己发现**，须由调用方显式修（或删掉计数器行让它走冷路径重种）。
 *     仍存的窄窗口：**旁路插入与并发取号同时发生**时不承诺消除（消除需业务表全部统一经本表取号，
 *     见 `schema.md` §12 Q-18 待办）。
 *   · **号会因失败而空号**：取号在前、建行在后，两者**不在同一事务**内；若建行失败（守卫拒绝 / 约束冲突），
 *     该号不再复用。这是计数器的语义（旧「读后写」实现会复用号，代价正是并发撞号）。
 *   · **只收敛 3 个命名空间**：其余 **12 个**取号面仍为读后写（登记于 `schema.md` §12 Q-18），本轮未动。
 *
 * 门禁状态：无外部依赖（纯本地库读写；零外部调用、零凭证）。
 *
 * 反向清单：被 `../task-runner/step-plan.js`（`task` / `research`）与
 *   `../agent-orchestrator/opportunity.js`（`opportunity`，经 `./index.js` 再导出）引用；
 *   经 `./index.js` **再导出**（不重写）——这是为满足 F-16 用例「opportunity.js 唯一 import＝`../shared-context/index.js`」
 *   的既有断言，也为让两个消费方走**同一个 import 口径**；
 *   登记 `./README.md` 与 `../README.md`（模块硬红线的「本目录只写 X 表」清单同改）；测试 `./test-f35.mjs`。
 */

/**
 * 命名空间 → 号的形态。**唯一一份**（消费方不得再写一遍前缀 / 补零位数）。
 * `prefix` 与 `width` 决定对外编号；`existing_from` 只作文档说明（冷路径的种子从哪张表取）。
 * 形态与种子数据一致：`T-0001`~`T-1023` / `R-006`~`R-007` / `OPP-001`~`OPP-014`。
 */
export const ID_NAMESPACES = Object.freeze({
  task: Object.freeze({ prefix: "T-", width: 4, existing_from: "PD-01 `task.task_id`" }),
  research: Object.freeze({ prefix: "R-", width: 3, existing_from: "MD-07 `research.research_no`" }),
  opportunity: Object.freeze({ prefix: "OPP-", width: 3, existing_from: "MD-06 `opportunity.opportunity_id`" }),
});

/** 已登记命名空间清单（供用例与文档**逐条对齐**，避免出现「第二份清单」）。 */
export const ID_NAMESPACE_CODES = Object.freeze(Object.keys(ID_NAMESPACES));

/**
 * 取命名空间规格。**未登记的命名空间一律显式报错**——不静默新建：
 * 新建一个命名空间等于新定义一个对外编号形态，那件事必须发生在锁定件里，不能由一次调用顺手做掉。
 */
function specOf(namespace) {
  const spec = ID_NAMESPACES[namespace];
  if (!spec) {
    throw new Error(
      `未知取号命名空间 '${String(namespace)}'（已登记：${ID_NAMESPACE_CODES.join(" / ")}）——` +
        "不静默新建：新命名空间的号形态须先写进 `docs/03-locks/schema.md` CFG-09 与 `ID_NAMESPACES`",
    );
  }
  return spec;
}

/** 序号 → 对外编号（`task`/4 → `T-0004`；`research`/7 → `R-007`；`opportunity`/15 → `OPP-015`）。 */
export function formatId(namespace, seq) {
  const spec = specOf(namespace);
  const n = Number(seq);
  if (!Number.isFinite(n) || n < 1) throw new Error(`序号须为正整数（收到 ${String(seq)}）`);
  return `${spec.prefix}${String(n).padStart(spec.width, "0")}`;
}

/**
 * 从既有 id 清单**自算库内最大序号**（**不写 `SELECT MAX`**，延续既定纪律）。
 * 形态不认识的值一律忽略（与 `nextOpportunityRelationId` 等同款口径）。
 */
export function parseMaxSeq(namespace, existing_ids = []) {
  const spec = specOf(namespace);
  const re = new RegExp(`^${spec.prefix}(\\d+)$`);
  let max = 0;
  for (const raw of Array.isArray(existing_ids) ? existing_ids : []) {
    const m = re.exec(String(raw ?? "").trim());
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}

/** 读面：某命名空间的计数器行（不存在返回 `null`）。供回读与用例核对，**不写库**。 */
export async function readSequence(db, namespace) {
  specOf(namespace);
  const row = await db.prepare("SELECT namespace, next_val FROM id_sequence WHERE namespace = ?").bind(namespace).first();
  if (!row) return null;
  return { namespace: row.namespace, next_val: Number(row.next_val) };
}

/**
 * 冷路径取「既有 id 清单」——**必填**：直接给数组，或给一个返回数组的 thunk（热路径不会调用它，
 * 故不把全表扫描带进每次取号）。**不允许省略**：省略即等于「按 0 起步」，
 * 在已有数据的库上会重发已用号——宁可响亮报错，也不静默降级。
 */
async function resolveExisting(existing) {
  if (typeof existing === "function") return (await existing()) || [];
  if (Array.isArray(existing)) return existing;
  throw new Error(
    "取号缺少「既有 id 清单」（冷路径用它把计数器种到库内实际最大）——请传数组或返回数组的函数；" +
      "库内确无该命名空间既有数据时请**显式传 []**（省略会被当成 0 起步，在已有数据的库上重发已用号）",
  );
}

/**
 * 计数器落种子（`next_val` **只抬不降**，故反复执行幂等）。
 * **唯一一份** upsert 语句——`issueId` 的冷路径与 `healSequence` 共用它，不复制第二份。
 */
async function seedCounter(db, namespace, max) {
  await db
    .prepare(
      "INSERT INTO id_sequence (namespace, next_val) VALUES (?, ?) " +
        "ON CONFLICT(namespace) DO UPDATE SET next_val = max(next_val, excluded.next_val)",
    )
    .bind(namespace, max)
    .run();
}

/**
 * 原子取号（与 `healSequence` 共用）
 * @param {object} db D1 / `node:sqlite` 适配的库句柄
 * @param {string} namespace `task` / `research` / `opportunity`
 * @param {Array<string>|Function} existing **冷路径必填**：该命名空间已有的 id 清单（或返回它的 thunk）。
 *   热路径（计数器行已在）**完全不读它**——这是「一行一条语句」的原子性收益，也是不把全表扫描带进热路径的前提。
 *   **不允许省略**：省略即等于「按 0 起步」，会在已有数据的库上重发已用号；库内确无既有数据时请显式传 `[]`。
 * @returns {Promise<{id: string, seq: number, seeded: boolean}>} `seeded=true` 表示本次走了冷路径（顺手初始化了计数器）
 */
export async function issueId(db, namespace, existing) {
  specOf(namespace);

  // 热路径：一条语句完成「自增 + 取值」，无读后写窗口。
  const take = () =>
    db
      .prepare("UPDATE id_sequence SET next_val = next_val + 1 WHERE namespace = ? RETURNING next_val")
      .bind(namespace)
      .first();

  let row = await take();
  let seeded = false;

  if (!row) {
    // 冷路径：该命名空间首次取号（或线上刚由一次性运维 SQL 建出空表）。
    // 种子＝「观测到的库内实际最大」，**只抬不降**（故并发冷启动也安全：两者种入同一个 max，
    // 随后的 UPDATE 在主库上串行，各自拿到不同的号）。
    seeded = true;
    await seedCounter(db, namespace, parseMaxSeq(namespace, await resolveExisting(existing)));
    row = await take();
  }

  const seq = Number(row && row.next_val);
  if (!Number.isFinite(seq) || seq < 1) {
    // 到这里还能落空，只可能是「并发建行 + 并发删除」这类异常外力；显式报错，不静默退化成读后写取号。
    throw new Error(
      `取号失败：命名空间 '${namespace}' 的计数器未就绪（id_sequence 无该行，且自愈种子未生效）——` +
        "不静默退化成「读全量自算最大 +1」（那正是本文件要消灭的竞态）",
    );
  }
  return { id: formatId(namespace, seq), seq, seeded };
}

/**
 * **显式**修复计数器——冷路径之外唯一能把计数器抬起来的入口。
 *
 * 为什么需要它：热路径**刻意不回读业务表**（否则每次取号都要全表扫描）。代价是「旁路插入」
 * （运维 SQL / 手工补数 / 旧代码路径写入业务行而未经本文件）之后，计数器会**落后于实际数据**，
 * 而热路径不会自己发现。此时由调用方显式调本函数一次性修复（或删掉计数器行让它走冷路径重种）。
 *
 * `next_val` **只抬不降**（`max(next_val, excluded.next_val)`），故**反复执行幂等**；
 * 传入比当前更小的观测值不会回退（回退＝重发已用号）。
 * @param {Array<string>|Function} existing 既有 id 清单（或 thunk）——**必填**，同 `issueId`。
 * @returns {Promise<{namespace: string, next_val: number, raised: boolean}>} `raised` 表示本次确实抬高了
 */
export async function healSequence(db, namespace, existing) {
  specOf(namespace);
  const before = await readSequence(db, namespace);
  await seedCounter(db, namespace, parseMaxSeq(namespace, await resolveExisting(existing)));
  const after = await readSequence(db, namespace);
  return { namespace, next_val: after.next_val, raised: before === null || after.next_val > before.next_val };
}
