#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · **F-35「取号原子化」用例执行器** · 2026-09-22）
 *
 * 上游：`../../docs/03-locks/schema.md` **v1.9**（CFG-09 `id_sequence`：§0.2 的 v1.9 说明 / §4 字段表 /
 *        §11「不建外键」例外 / §12 **Q-18** 归属与范围裁决）
 *   ｜ `../../db/migrations/0001_init.sql`（本表 **DDL 真源**）｜ `../../db/ops/2026-09-22-id-sequence.sql`
 *        （线上既有库的**一次性补建**入口——`0001` 已被记为已应用，D1 不重放）
 *   ｜ `../../docs/04-plan/full-flow-wiring-plan.md` §2.2（**P0-3 取号竞态**）与 §「编号映射」F-35 行
 *        （用户裁决＝**选项 c**：只收敛「任务 / 研究 / 机会」三条最热号；范围外 12 个取号面登记待办）
 *   ｜ `./id-sequence.js`（被测的**唯一写入面**）｜ `../task-runner/step-plan.js`（`nextTaskId` / `nextResearchNo`）
 *        与 `../agent-orchestrator/opportunity.js`（`nextOpportunityId`）＝两个消费方
 *
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入**真实 DDL + 种子**实跑 F-35 并断言。分四段：
 *   ① **静态**——`id_sequence` 全仓唯一写入面 / 号形态只此一份 / 消费方无取号裸 SQL / 经再导出而非新增 import /
 *      原子性论证的**前提**（全仓无 `withSession`，故查询只在主库执行）；
 *   ② **运行期**——冷启动自愈种子（含「种子入参冷路径必填」）、递增、`seeded` 标记、回读、
 *      **同一条语句下并发 6 次互不相同**（P0-3 的正解）、热路径**不回读业务表**（种子 thunk 0 调用）、
 *      `healSequence` 只抬不降且幂等、**旁路插入**场景（热路径不会自己发现 → 显式修复才对齐）、
 *      未知命名空间显式报错、`namespace` PK 库级兜底、空表（零种子）可直接取号；
 *   ③ **端到端**——`createTask` 经取号落库、连建 5 个任务**互不撞号**（P0-3 的验收形态）；
 *   ④ **漂移守卫**——`schema.md` 声明的表数 ↔ DDL 里 `CREATE TABLE` 的**实数**（防「文档说 37、DDL 建了 38」）；
 *      `0001_init.sql` 与 `db/ops/*.sql` 两处 `id_sequence` 的**列定义一致**（防两处 DDL 漂移）。
 *
 * 硬红线：仅本地内存库，零外部调用、零生产写、零凭证；**不连线上库**。
 * 边界：**不重测** F-16 / F-05 既有的取号断言——「调用面与返回形态不变」由它们各自继续守住；
 *   本用例只测「取号原子化」这件事本身。范围外的 12 个取号面**明确不测**（仍在读后写，见 Q-18 待办）。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f35.mjs`）。
 *
 * 用法：node server/shared-context/test-f35.mjs
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { issueId, formatId, parseMaxSeq, readSequence, healSequence, ID_NAMESPACES, ID_NAMESPACE_CODES } from "./id-sequence.js";
import { createTask, nextTaskId, nextResearchNo } from "../task-runner/step-plan.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DDL_PATH = join(ROOT, "db/migrations/0001_init.sql");
const OPS_PATH = join(ROOT, "db/ops/2026-09-22-id-sequence.sql");
const SEED_PATH = join(ROOT, "db/seed/0001_mock.sql");
const SCHEMA_PATH = join(ROOT, "docs/03-locks/schema.md");

/** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()。 */
function d1From(sqlite) {
  const makeStmt = (sql, params) => ({
    bind: (...args) => makeStmt(sql, args),
    run: () => {
      const r = sqlite.prepare(sql).run(...params);
      return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
    },
    all: () => ({ results: sqlite.prepare(sql).all(...params) }),
    first: (col) => {
      const row = sqlite.prepare(sql).get(...params) ?? null;
      if (row === null) return null;
      return col === undefined ? row : row[col];
    },
  });
  return { prepare: (sql) => makeStmt(sql, []) };
}

/**
 * 建库。`seed=true` 时载入真实 mock 种子（种子自带 `PRAGMA foreign_keys = ON`，载入前剥离，
 * 载入后统一开启，避开插入顺序依赖）。
 */
function freshDb({ seed = true } = {}) {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(readFileSync(DDL_PATH, "utf8"));
  if (seed) {
    const mock = readFileSync(SEED_PATH, "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
    sqlite.exec(mock);
  }
  sqlite.exec("PRAGMA foreign_keys = ON;");
  return { sqlite, db: d1From(sqlite) };
}

let pass = 0;
let failed = 0;
async function check(group, title, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✓ [${group}] ${title}`);
  } catch (e) {
    failed += 1;
    console.log(`  ✗ [${group}] ${title}\n      ${e?.message || e}`);
  }
}
function assert(cond, msg) {
  if (!cond) throw new Error("断言失败：" + msg);
}
async function expectThrow(fn, re) {
  let threw = false;
  let msg = "";
  try {
    await fn();
  } catch (e) {
    threw = true;
    msg = e?.message || String(e);
  }
  if (!threw) throw new Error("期望被拒绝，但操作成功");
  if (re && !re.test(msg)) throw new Error(`拒绝原因不符（期望 ${re}）：${msg}`);
}

/** 递归列出某目录下的 .js（排除用例自身与 node_modules）。 */
function jsFilesUnder(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) jsFilesUnder(p, out);
    else if (name.endsWith(".js")) out.push(p);
  }
  return out;
}
/** 去注释（静态扫描前统一处理，避免注释里的字面量造成误报/漏报）。 */
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
const read = (p) => readFileSync(p, "utf8");
const rel = (p) => relative(ROOT, p);
/** SQL 去注释（`--` 行）——静态扫 SQL 文件时必须用它，JS 版 `stripComments` 不认 `--`。 */
const stripSqlComments = (src) => src.replace(/--[^\n]*/g, "");

/**
 * **真实消费方形态**的种子提供者：从业务表读既有 id（**只在冷路径被调起**）。
 * 测试里必须传它——`issueId` 的种子入参**冷路径必填**，省略会显式报错（这正是防「按 0 起步重发已用号」的那道闸）。
 */
const seedFrom = (sqlite, sql) => () => sqlite.prepare(sql).all().map((r) => Object.values(r)[0]);

const ID_SEQ_SRC = read(join(HERE, "id-sequence.js"));
const STEP_SRC = read(join(ROOT, "server/task-runner/step-plan.js"));
const OPP_SRC = read(join(ROOT, "server/agent-orchestrator/opportunity.js"));
const INDEX_SRC = read(join(HERE, "index.js"));

console.log("F-35 取号原子化 · 用例执行（本地内存库 + 真实 DDL + 真实种子）");

/* ================================================================== */
/* ① 静态：唯一写入面 / 形态一份 / 消费方无取号裸 SQL / 再导出不重写      */
/* ================================================================== */
console.log("\n① 静态核验 · 唯一写入面 / 形态只一份 / 消费方零取号裸 SQL / 再导出不重写");

const ALL_JS = jsFilesUnder(join(ROOT, "server"));
const writers = ALL_JS.filter((p) => {
  const s = stripComments(read(p));
  return /INSERT\s+INTO\s+id_sequence/i.test(s) || /UPDATE\s+id_sequence/i.test(s);
});

await check("①", "`id_sequence` 全仓唯一写入面＝`shared-context/id-sequence.js`", () => {
  const got = writers.map(rel).sort();
  assert(got.length === 1, `写「id_sequence」的文件应恰 1 个（实测 ${got.length}：${got.join("、") || "无"}）`);
  assert(got[0].endsWith("id-sequence.js"), `唯一写入面应为 id-sequence.js（实测 ${got[0]}）`);
});

await check("①", "`shared-context/index.js` 只再导出、不重写（自身零 `id_sequence` 语句）", () => {
  const s = stripComments(INDEX_SRC);
  assert(!/INSERT\s+INTO\s+id_sequence/i.test(s) && !/UPDATE\s+id_sequence/i.test(s), "index.js 不得含该表的写语句（应只再导出）");
  assert(/from\s*"\.\/id-sequence\.js"/.test(s), "index.js 须从 ./id-sequence.js 再导出");
});

await check("①", "号形态只此一份：消费方不再含取号前缀正则", () => {
  const step = stripComments(STEP_SRC);
  const opp = stripComments(OPP_SRC);
  assert(!/\^T-\(\\d\+\)\$/.test(step), "step-plan.js 不应再含 /^T-(\\d+)$/（形态已归 id-sequence.js）");
  assert(!/\^R-\(\\d\+\)\$/.test(step), "step-plan.js 不应再含 /^R-(\\d+)$/");
  assert(!/\^OPP-\(\\d\+\)\$/.test(opp), "opportunity.js 不应再含 /^OPP-(\\d+)$/");
  // 反例（不误报）：范围外的那条**保持原样**，证明上述断言不是「随便扫没有」
  assert(/\^LK-OR-\(\\d\+\)\$/.test(opp), "范围外的 LK-OR 取号应保持读后写原样（Q-18 待办，勿顺手改）");
});

await check("①", "消费方零取号裸 SQL：`RETURNING next_val` 只出现在写入面", () => {
  const holders = ALL_JS.filter((p) => /RETURNING\s+next_val/i.test(stripComments(read(p)))).map(rel);
  assert(holders.length === 1 && holders[0].endsWith("id-sequence.js"), `实测持有者 ${holders.join("、") || "无"}`);
});

await check("①", "`opportunity.js` 经再导出取用（未新增 import 语句——F-16 ⑨ 的口径不破）", () => {
  const s = stripComments(OPP_SRC);
  const importTargets = [...s.matchAll(/import\s*\{[\s\S]*?\}\s*from\s*"([^"]+)"/g)].map((m) => m[1]);
  assert(importTargets.length === 1, `import 语句应恰 1 条（实测 ${importTargets.length}）`);
  assert(importTargets[0] === "../shared-context/index.js", `唯一依赖应仍为 ../shared-context/index.js（实测 ${importTargets[0]}）`);
  const block = /import\s*\{([\s\S]*?)\}\s*from\s*"\.\.\/shared-context\/index\.js"/.exec(s)[1];
  assert(/\bissueId\b/.test(block), "须经该唯一 import 面引入 issueId（不直连 id-sequence.js）");
  assert(!/from\s*"\.\.\/shared-context\/id-sequence\.js"/.test(s), "不得直连 id-sequence.js（避免出现第二个 import 口径）");
});

await check("①", "原子性论证的前提：全仓无 `withSession`（故查询只在主库执行）", () => {
  const using = ALL_JS.filter((p) => /\.withSession\s*\(/.test(stripComments(read(p)))).map(rel);
  assert(using.length === 0, `本工程未用 D1 Sessions API 是「读-改-写不跨副本」的前提；实测 ${using.join("、") || "无"}`);
});

await check("①", "命名空间清单恰 3 项且与清单常量一致（不复制第二份清单）", () => {
  assert(ID_NAMESPACE_CODES.length === 3, `应恰 3 个命名空间（实测 ${ID_NAMESPACE_CODES.length}）`);
  assert(ID_NAMESPACE_CODES.join(">") === "task>research>opportunity", `实测 ${ID_NAMESPACE_CODES.join(">")}`);
  assert(ID_NAMESPACE_CODES.join(">") === Object.keys(ID_NAMESPACES).join(">"), "两个导出应同源同序");
});

/* ================================================================== */
/* ② 运行期：取号语义                                                    */
/* ================================================================== */
console.log("\n② 运行期 · 冷启动自愈种子 / 递增 / 并发不重复 / 只抬不降 / 显式报错 / PK 兜底");

await check("②", "计数器**无种子**：载入 mock 种子后 `id_sequence` 仍为 0 行", () => {
  const { sqlite } = freshDb();
  const c = sqlite.prepare("SELECT COUNT(*) AS c FROM id_sequence").get().c;
  assert(c === 0, `计数器表不应有种子行（实测 ${c} 行）——空表即合法初值，靠冷路径自愈`);
});

await check("②", "冷启动：各命名空间首号＝库内实际最大 +1（自愈种子）", async () => {
  const { sqlite, db } = freshDb();
  const t = await issueId(db, "task", seedFrom(sqlite, "SELECT task_id FROM task"));
  const r = await issueId(db, "research", seedFrom(sqlite, "SELECT research_no FROM research"));
  const o = await issueId(db, "opportunity", seedFrom(sqlite, "SELECT opportunity_id FROM opportunity"));
  assert(t.id === "T-1024", `task 首号应＝种子最大 T-1023 +1（实测 ${t.id}）`);
  assert(r.id === "R-008", `research 首号应＝种子最大 R-007 +1（实测 ${r.id}）`);
  assert(o.id === "OPP-015", `opportunity 首号应＝种子最大 OPP-014 +1（实测 ${o.id}）`);
  assert(t.seeded === true, "首次应标记 seeded=true（走了冷路径）");
});

await check("②", "冷路径种子入参**必填**：省略即显式报错（不静默按 0 起步）", async () => {
  const { db } = freshDb();
  await expectThrow(() => issueId(db, "task"), /缺少「既有 id 清单」/);
  // 反例（不误报）：显式传 [] 是**合法**的「库内确无既有数据」
  const first = await issueId(db, "task", []);
  assert(first.id === "T-0001", `显式 [] → 冷启动 0 → T-0001（实测 ${first.id}）`);
});

await check("②", "递增 + `seeded` 标记回落 + 与 `readSequence` 回读一致", async () => {
  const { sqlite, db } = freshDb();
  const seed = seedFrom(sqlite, "SELECT task_id FROM task");
  const a = await issueId(db, "task", seed);
  const b = await issueId(db, "task", seed);
  assert(b.seq === a.seq + 1, `第二次应＋1（实测 ${a.seq} → ${b.seq}）`);
  assert(a.seq === 1024 && b.seq === 1025, `冷启动后应续 1024 / 1025（实测 ${a.seq} / ${b.seq}）`);
  assert(b.seeded === false, "第二次应 seeded=false（热路径不读既有 id 清单）");
  const row = await readSequence(db, "task");
  assert(row.next_val === b.seq, `计数器回读应＝最近发出号（实测 ${row.next_val} vs ${b.seq}）`);
});

await check("②", "**P0-3 正解**：同一条语句下并发 6 次取号互不相同（旧读后写会全撞）", async () => {
  const { sqlite, db } = freshDb();
  const seed = seedFrom(sqlite, "SELECT task_id FROM task");
  // 先热一次，让计数器就绪（此后的并发纯走「UPDATE ... RETURNING」热路径）
  const first = await issueId(db, "task", seed);
  const got = await Promise.all(Array.from({ length: 5 }, () => issueId(db, "task", seed)));
  const seqs = [first, ...got].map((x) => x.seq).sort((x, y) => x - y);
  assert(new Set(seqs).size === 6, `6 次取号应互不相同（实测 ${seqs.join(",")}）`);
  assert(seqs.join(",") === "1024,1025,1026,1027,1028,1029", `应严格连续（实测 ${seqs.join(",")}）`);
  // 对照：旧的「自算最大 +1」在同一批既有数据上**恒返回同一个值**——这正是撞号的成因
  const same = ["T-1023"];
  assert(parseMaxSeq("task", same) === parseMaxSeq("task", same), "旧口径自算最大是确定值（故并发必然同号）");
});

await check("②", "热路径**不回读业务表**：种子 thunk 只在冷路径被调 1 次（性能纪律）", async () => {
  const { sqlite, db } = freshDb();
  let calls = 0;
  const seed = () => {
    calls += 1;
    return sqlite.prepare("SELECT task_id FROM task").all().map((r) => r.task_id);
  };
  await issueId(db, "task", seed);
  assert(calls === 1, `冷路径应调 1 次（实测 ${calls}）`);
  await issueId(db, "task", seed);
  await issueId(db, "task", seed);
  assert(calls === 1, `后续热路径不得再调（实测 ${calls} 次）——否则每次取号都要全表扫描`);
});

await check("②", "`healSequence` 只抬不降、且反复执行幂等", async () => {
  const { db } = freshDb({ seed: false });
  await issueId(db, "opportunity", []); // 空库 → 1
  assert((await readSequence(db, "opportunity")).next_val === 1, "空库首号后计数器应为 1");
  const up = await healSequence(db, "opportunity", ["OPP-200"]);
  assert(up.raised === true && up.next_val === 200, `应抬到 200（实测 next_val=${up.next_val}、raised=${up.raised}）`);
  const down = await healSequence(db, "opportunity", ["OPP-003"]);
  assert(down.next_val === 200 && down.raised === false, `更小的观测值不得回退（实测 ${down.next_val}、raised=${down.raised}）`);
  const again = await healSequence(db, "opportunity", ["OPP-200"]);
  assert(again.raised === false, "同一观测值重复修复应幂等（raised=false）");
  assert((await issueId(db, "opportunity", [])).id === "OPP-201", "修复后续号应从 201 起");
});

await check("②", "**旁路插入**：热路径不会自己发现（落后如实存在），`healSequence` 是显式修复口", async () => {
  const { sqlite, db } = freshDb();
  const real = seedFrom(sqlite, "SELECT opportunity_id FROM opportunity");
  await issueId(db, "opportunity", real); // 种到实际最大 14 → 15
  // 「旁路插入」一条 OPP-016（不经本表）：热路径刻意不回读业务表，故它**不知道**，下一个号仍是 16。
  const next = await issueId(db, "opportunity", real);
  assert(next.id === "OPP-016", `热路径照发 16（实测 ${next.id}）——这正是「落后」的如实体现，不假装知道`);
  // 显式修复：把观测清单（含旁路插入的 OPP-016 与更大的 OPP-090）交给 healSequence
  const h = await healSequence(db, "opportunity", [...real(), "OPP-016", "OPP-090"]);
  assert(h.next_val === 90, `应抬到观测最大 90（实测 ${h.next_val}）`);
  const after = await issueId(db, "opportunity", real);
  assert(after.id === "OPP-091", `修复后续 91，不再撞（实测 ${after.id}）`);
});

await check("②", "空表（零种子）可直接取号：seed 0 → `T-0001` / `R-001` / `OPP-001`", async () => {
  const { db } = freshDb({ seed: false });
  assert((await issueId(db, "task", [])).id === "T-0001", "空库 task 首号应为 T-0001（显式传 []）");
  assert((await issueId(db, "research", [])).id === "R-001", "空库 research 首号应为 R-001");
  assert((await issueId(db, "opportunity", [])).id === "OPP-001", "空库 opportunity 首号应为 OPP-001");
});

await check("②", "未登记命名空间一律显式报错（不静默新建）", async () => {
  const { db } = freshDb();
  await expectThrow(() => issueId(db, "evidence"), /未知取号命名空间/);
  await expectThrow(() => readSequence(db, "nope"), /未知取号命名空间/);
  await expectThrow(() => Promise.resolve(formatId("nope", 1)), /未知取号命名空间/);
  assert((await readSequence(db, "nope").catch(() => "threw")) === "threw", "读面也应拒绝");
});

await check("②", "序号非法一律报错（不静默补零成 `T-0000`）", async () => {
  await expectThrow(() => Promise.resolve(formatId("task", 0)), /正整数/);
  await expectThrow(() => Promise.resolve(formatId("task", "x")), /正整数/);
  assert(formatId("task", 4) === "T-0004" && formatId("research", 7) === "R-007" && formatId("opportunity", 15) === "OPP-015",
    "补零位数：T-4 位 / R-3 位 / OPP-3 位");
});

await check("②", "库级兜底：`namespace` 为 PK，重复插入被拒", async () => {
  const { sqlite, db } = freshDb();
  await issueId(db, "task", []);
  let threw = false;
  try {
    sqlite.prepare("INSERT INTO id_sequence (namespace, next_val) VALUES ('task', 1)").run();
  } catch (e) {
    threw = /UNIQUE|PRIMARY/i.test(e.message);
  }
  assert(threw, "重复 namespace 应被 PK 拒绝（兜底不靠应用层自觉）");
  assert(sqlite.prepare("SELECT COUNT(*) AS c FROM id_sequence WHERE namespace='task'").get().c === 1, "同命名空间应恒 1 行");
});

/* ================================================================== */
/* ③ 端到端：消费路径（任务 / 研究 / 机会）                               */
/* ================================================================== */
console.log("\n③ 端到端 · 消费路径经取号落库、连建互不撞号（P0-3 的验收形态）");

const GOAL = "GOAL-2026Q3-01";
const baseTask = {
  task_type: "discovery",
  goal_id: GOAL,
  goal_version_no: 3,
  trigger_basis: "F-35 用例：连建取号",
  agent_version_snapshot: "F-35-test",
};

await check("③", "`createTask` 经取号落库：返回号＝期望号且行存在", async () => {
  const { db } = freshDb();
  const t = await createTask(db, baseTask);
  assert(t.task_id === "T-1024", `经取号应为 T-1024（实测 ${t.task_id}）`);
  const row = await db.prepare("SELECT task_id FROM task WHERE task_id = ?").bind(t.task_id).first();
  assert(!!row, "任务行应真实落库");
});

await check("③", "连建 5 个任务**互不撞号**（同一 tick 并发 3 个也不撞）", async () => {
  const { db } = freshDb();
  const ids = [];
  for (let i = 0; i < 2; i += 1) ids.push((await createTask(db, baseTask)).task_id);
  const conc = await Promise.all([createTask(db, baseTask), createTask(db, baseTask), createTask(db, baseTask)]);
  ids.push(...conc.map((x) => x.task_id));
  assert(new Set(ids).size === 5, `5 个任务号应互不相同（实测 ${ids.join(",")}）`);
  const rows = await db.prepare("SELECT COUNT(*) AS c FROM task").first();
  assert(Number(rows.c) === 7 + 5, `种子 7 + 新建 5 = 12 行（实测 ${rows.c}）`);
});

await check("③", "`nextTaskId` / `nextResearchNo` 调用面与形态不变（返回字符串）", async () => {
  const { db } = freshDb();
  const t = await nextTaskId(db);
  const r = await nextResearchNo(db);
  assert(typeof t === "string" && /^T-\d{4}$/.test(t) && t === "T-1024", `nextTaskId 形态/取值（实测 ${t}）`);
  assert(typeof r === "string" && /^R-\d{3}$/.test(r) && r === "R-008", `nextResearchNo 形态/取值（实测 ${r}）`);
});

/* ================================================================== */
/* ④ 漂移守卫：文档 ↔ DDL ↔ 运维 SQL                                      */
/* ================================================================== */
console.log("\n④ 漂移守卫 · schema.md 表数 ↔ DDL 实数 / 两处 DDL 列定义一致");

await check("④", "`schema.md` 声明的表数 ＝ DDL 里 `CREATE TABLE` 的实数", () => {
  const schema = read(SCHEMA_PATH);
  const m = /共\s*\*\*(\d+)\s*张表\*\*/.exec(schema);
  assert(!!m, "schema.md 应含「共 **N 张表**」声明");
  const ddl = read(DDL_PATH);
  const n = (ddl.match(/^CREATE TABLE /gm) || []).length;
  assert(Number(m[1]) === n, `文档声明 ${m[1]} 张 vs DDL 实建 ${n} 张——须同改，否则就是漂移`);
});

await check("④", "两处 `id_sequence` DDL 列定义一致（0001 与 db/ops 一次性补建）", () => {
  const pick = (src, file) => {
    const m = /CREATE TABLE (?:IF NOT EXISTS )?id_sequence\s*\(([\s\S]*?)\)\s*;/i.exec(src);
    assert(!!m, `${file} 应含 id_sequence 的 CREATE TABLE`);
    return m[1].replace(/\s+/g, " ").replace(/--[^,]*/g, "").trim().toLowerCase();
  };
  const a = pick(read(DDL_PATH), "0001_init.sql");
  const b = pick(read(OPS_PATH), "db/ops/2026-09-22-id-sequence.sql");
  assert(a === b, `两处列定义须一致：\n      0001 → ${a}\n      ops  → ${b}`);
  assert(/namespace\s+text\s+not null primary key/.test(a) && /next_val\s+integer\s+not null/.test(a),
    `列口径应为 namespace TEXT PK / next_val INTEGER NOT NULL（实测 ${a}）`);
});

await check("④", "运维入口幂等：`db/ops/*.sql` 对已建表的库可重复执行", () => {
  const { sqlite } = freshDb({ seed: false }); // DDL 已建出 id_sequence
  const opsSql = read(OPS_PATH);
  sqlite.exec(opsSql);
  sqlite.exec(opsSql);
  assert(true, "两次执行均应通过（IF NOT EXISTS）");
});

await check("④", "运维入口不含破坏性语句（只建表）", () => {
  // 用 **SQL 版**去注释（`--` 行）——JS 版 stripComments 不认 `--`，会把说明文字也算进扫描
  const s = stripSqlComments(read(OPS_PATH));
  assert(!/\bDELETE\b/i.test(s), "运维 SQL 不得含 DELETE");
  assert(!/\bUPDATE\s+[a-z_]/i.test(s), "运维 SQL 不得含 UPDATE");
  assert(!/INSERT\s+INTO/i.test(s), "运维 SQL 不得含 INSERT（不补种，靠自愈）");
  assert(/CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+id_sequence/i.test(s), "须为 IF NOT EXISTS（幂等建表）");
});

console.log("");
if (failed === 0) {
  console.log(`VERIFY PASS · ${pass} 断言通过 / 0 失败 —— F-35 取号原子化（CFG-09 id_sequence）`);
} else {
  console.log(`VERIFY FAIL · ${pass} 通过 / ${failed} 失败`);
  process.exitCode = 1;
}
