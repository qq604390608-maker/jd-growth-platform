#!/usr/bin/env node
/**
 * 文档卡（阶段1 · M2 · F-12 用例执行器 · 2026-09-19）
 * 上游：`../../docs/05-test-cases/test-M2.md`（TC-D-M2-009 / TC-D-M2-011 / TC-I-M2-002 = F-12 验收 oracle；
 *        TC-D-M2-015 标 F-09/F-12，本执行器按 F-12 侧再断言一次）
 *   ｜ `../../docs/02-prd/PRD-M2-共享上下文.md` F-12（验收要点：初始化是确定性程序行为，不是每回随机；
 *        只传递一句「继续分析」无效，要求 PM 重新粘贴全部资料也不应发生；类型＋范围两个维度）
 *   ｜ `../../docs/03-locks/schema.md` CFG-06 `context_template`（L593-605：`UK(task_type, context_type_code)`、
 *        `order_no` 注入顺序、`is_required` 缺失即不完整）、PD-06 `context_injection`（L484-497：`task_id` FK→PD-01、
 *        `ref_object_type` 走 `dict:OBJECT_TYPE`、Q-03 裁决「背景不做定版快照」）、§11 字典枚举（OBJECT_TYPE 四项）、
 *        §13 F-xx↔表映射（F-12 = CFG-06 PD-06 MD-05）
 *   ｜ `../../docs/07-decisions/ADR-001-业务背景不与目标版本联动.md`（§3 第 2/3 条：`background` 注入 `MD-04`
 *        当前生效条目；「当时内容」不还原，只记注入了哪几条对象）
 *   ｜ `../../db/migrations/0001_init.sql` L95-102（CFG-06）/ L366-373（PD-06）/ L424（LNK-04 复合 UK）
 *   ｜ `../../db/seed/0001_mock.sql`（CFG-06 模板 20 行：goal_check 3 / discovery 4 / hva_research 6 / hva_followup 7；
 *        PD-06 `context_injection` **种子为空**——先证基线 0 行，再由本项注入；
 *        `task` 7 行，其中 T-1022=discovery、T-1023=hva_followup；MD-12 `research_proposal` 种子为空）
 *   ｜ `./index.js`（被测模块）
 * 职责：以 `node:sqlite`（Node 内置）建 D1 兼容适配层，载入真实 DDL + 种子，实跑 F-12 用例并断言。
 * 硬红线：仅本地内存库，零外部调用、零生产写；**demo 数值不进断言**（只断结构与语义）。
 * 边界：本执行器只验 F-12；LNK-04 `task_object` 的**写入**归 M1 task-runner，此处只读其锚点并断言库级复合 UK。
 * 反向清单：登记 `../README.md`；被 CI `validate` 步骤复用（`node server/shared-context/test-f12.mjs`）。
 *
 * 用法：node server/shared-context/test-f12.mjs
 */
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import {
  registerContextTemplate,
  listContextTemplates,
  getContextTemplate,
  recordContextInjection,
  listContextInjections,
  buildTaskContext,
  initTaskContext,
  getTaskContext,
  CONTEXT_OBJECT_TYPE,
  CONTEXT_WITHOUT_OBJECT_TYPE,
} from "./index.js";

const DDL_PATH = new URL("../../db/migrations/0001_init.sql", import.meta.url);
const SEED_PATH = new URL("../../db/seed/0001_mock.sql", import.meta.url);

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
 * 建库。`seed=true` 时载入真实 mock 种子。
 * 种子文件自带 `PRAGMA foreign_keys = ON`——载入前剥离该 pragma（避开插入顺序依赖），
 * 载入后开 FK 跑 `foreign_key_check` 单独验完整性。
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

/** 取某信息类型的装配结果。 */
const sectionOf = (ctx, code) => ctx.sections.find((s) => s.context_type_code === code);

let pass = 0;
let failed = 0;
async function check(id, title, fn) {
  try {
    await fn();
    pass += 1;
    console.log(`  ✅ ${id} ${title}`);
  } catch (e) {
    failed += 1;
    console.log(`  ❌ ${id} ${title}\n     ${e.message}`);
  }
}

console.log("== F-12 上下文按任务组织注入（TC-D-M2-009 / TC-D-M2-011 / TC-I-M2-002 / TC-D-M2-015）==");

/* ---------------- 种子基线（诚实核对，非断言层） ---------------- */
{
  const { sqlite } = freshDb();
  const cnt = (t) => sqlite.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  console.log(
    `  · 种子基线：context_template=${cnt("context_template")} / context_injection=${cnt("context_injection")} / task=${cnt("task")} / research_proposal=${cnt("research_proposal")}`
  );
  for (const tt of ["goal_check", "discovery", "hva_research", "hva_followup"]) {
    const n = sqlite.prepare("SELECT COUNT(*) AS n FROM context_template WHERE task_type = ?").get(tt).n;
    console.log(`  · 模板 ${tt}：${n} 项`);
  }
}

/* ---------------- TC-D-M2-011：CFG-06 复合 UK ---------------- */

await check("TC-D-M2-011a", "F-12 反例：context_template 重复 (task_type, context_type_code) → 库级 UK 拒绝", async () => {
  const { db } = freshDb();
  await expectThrow(
    () =>
      registerContextTemplate(db, {
        template_id: "CT-F12-DUP",
        task_type: "discovery",
        context_type_code: "goal", // 种子 CT-004 已是 (discovery, goal)
        order_no: 9,
        is_required: 1,
      }),
    /UNIQUE|constraint/i
  );
});

await check("TC-D-M2-011b", "F-12 正例：新增未占用的 (task_type, context_type_code) → 落库成功且可回读", async () => {
  const { db } = freshDb();
  const r = await registerContextTemplate(db, {
    template_id: "CT-F12-01",
    task_type: "goal_check",
    context_type_code: "opp_summary", // 种子 CT-001~003 只到 source
    order_no: 4,
    is_required: 0,
  });
  assert(r.template_id === "CT-F12-01", "返回 template_id 应为 CT-F12-01");
  const row = await getContextTemplate(db, "CT-F12-01");
  assert(row && row.order_no === 4 && row.is_required === 0, "回读应带 order_no=4 / is_required=0");
  const tpl = await listContextTemplates(db, { task_type: "goal_check" });
  assert(tpl.length === 4, `goal_check 模板应由 3 项变 4 项，实得 ${tpl.length}`);
  assert(
    tpl.map((t) => t.context_type_code).join(",") === "goal,background,source,opp_summary",
    "模板应按 order_no 升序返回"
  );
});

/* ---------------- TC-D-M2-009：PD-06 task_id 外键 ---------------- */

await check("TC-D-M2-009a", "F-12 反例：context_injection.task_id='T-NOPE' → 库级外键拒绝", async () => {
  const { db } = freshDb();
  await expectThrow(
    () =>
      recordContextInjection(db, {
        injection_id: "CI-T-NOPE-01",
        task_id: "T-NOPE",
        context_type_code: "goal",
        ref_object_type: "goal",
        ref_object_id: "GOAL-2026Q3-01",
      }),
    /FOREIGN KEY|constraint/i
  );
});

await check("TC-D-M2-009b", "F-12 正例：task_id 为种子已存在任务 → 落库成功，注入记录可回查", async () => {
  const { db } = freshDb();
  const before = await listContextInjections(db, { task_id: "T-1022" });
  assert(before.length === 0, "PD-06 种子应为空（基线 0 行）");
  const r = await recordContextInjection(db, {
    injection_id: "CI-T-1022-01",
    task_id: "T-1022",
    context_type_code: "goal",
    ref_object_type: "goal",
    ref_object_id: "GOAL-2026Q3-01",
    injected_at: "2026-09-19 10:00",
  });
  assert(r.injected_at === "2026-09-19 10:00", "injected_at 应回显");
  const rows = await listContextInjections(db, { task_id: "T-1022" });
  assert(rows.length === 1 && rows[0].injection_id === "CI-T-1022-01", "注入记录应可回查");
  await expectThrow(
    () =>
      recordContextInjection(db, {
        injection_id: "CI-T-1022-01",
        task_id: "T-1022",
        context_type_code: "goal",
        ref_object_type: "goal",
        ref_object_id: "GOAL-2026Q3-01",
      }),
    /UNIQUE|constraint/i
  );
});

/* ---------------- TC-D-M2-015：LNK-04 复合 UK（F-12 侧复验） ---------------- */

await check("TC-D-M2-015", "F-12/F-09：LNK-04 重复 (task_id, object_type, object_id, link_role) → 复合 UK 拒绝", async () => {
  const { db } = freshDb();
  await expectThrow(
    () =>
      db
        .prepare(
          "INSERT INTO task_object (link_id, task_id, object_type, object_id, link_role, created_at) VALUES (?,?,?,?,?,?)"
        )
        .bind("LK-TO-F12", "T-1022", "goal", "GOAL-2026Q3-01", "trigger", "2026-09-19 10:00")
        .run(),
    /UNIQUE|constraint/i
  );
});

/* ---------------- F-12 装配：类型维度（一阶段 / 二阶段） ---------------- */

await check("F-12(PRD)a", "F-12 类型维度：discovery 任务按模板注入 目标/背景/可用来源/已有机会摘要", async () => {
  const { db } = freshDb();
  const ctx = await buildTaskContext(db, { task_id: "T-1022" }); // T-1022 = discovery
  assert(ctx.task_type === "discovery", "任务类型应现读为 discovery");
  const codes = ctx.sections.map((s) => s.context_type_code);
  assert(
    codes.join(",") === "goal,background,source,opp_summary",
    `一阶段应为 目标/背景/可用来源/已有机会摘要，实得 ${codes.join(",")}`
  );
  const orders = ctx.sections.map((s) => s.order_no);
  assert(orders.join(",") === "1,2,3,4", `注入顺序应等于模板 order_no，实得 ${orders.join(",")}`);
});

await check("F-12(PRD)b", "F-12 类型维度：hva_followup 在一阶段基础上增加 所选机会/产品问题/已有证据/相关历史", async () => {
  const { db } = freshDb();
  const ctx = await buildTaskContext(db, { task_id: "T-1023" }); // T-1023 = hva_followup
  const codes = ctx.sections.map((s) => s.context_type_code);
  assert(
    codes.join(",") === "goal,background,source,selected_opp,product_question,existing_evidence,related_history",
    `二阶段七类齐全，实得 ${codes.join(",")}`
  );
  const sel = sectionOf(ctx, "selected_opp");
  assert(sel.status === "injected", "二阶段锚点机会应由 LNK-04 现读命中（T-1023 → OPP-012）");
  assert(
    sel.items[0].ref_object_id === "OPP-012" && sel.object_type === "opportunity",
    `所选机会应为 OPP-012 且对象类别为 opportunity，实得 ${sel.items[0].ref_object_id}/${sel.object_type}`
  );
  const hist = sectionOf(ctx, "related_history");
  assert(hist.object_type === "research", "相关历史的对象类别应为 research");
});

await check("F-12(PRD)c", "F-12 范围维度：背景只取本目标 + 平台级；品类/时段来自启动采用的目标版本", async () => {
  const { db } = freshDb();
  const ctx = await buildTaskContext(db, { task_id: "T-1022" });
  const bg = sectionOf(ctx, "background");
  assert(bg.items.length > 0, "背景应注入到条目");
  for (const it of bg.items) {
    const gid = it.background.goal_id;
    assert(gid === ctx.goal_id || gid === null, `背景 ${it.ref_object_id} 不属于本目标且非平台级`);
    assert(it.background.is_active === 1, "背景只注入当前生效条目（is_active=1）");
  }
  assert(
    typeof ctx.scope.business_scope === "string" && ctx.scope.business_scope.length > 0,
    "范围应带目标版本的品类（business_scope）"
  );
  assert(typeof ctx.scope.focus_period === "string" && ctx.scope.focus_period.length > 0, "范围应带关注时段");
  assert(ctx.scope.touchpoints.length > 0, "范围应带触点清单");
  for (const tp of ctx.scope.touchpoints) {
    assert(tp.is_active === 1, "触点只取在册生效项");
  }
});

await check("F-12(PRD)d", "F-12 验收要点：工作空间非空（不是只传一句「继续分析」），空项如实标 incomplete", async () => {
  const { db } = freshDb();
  const ctx = await buildTaskContext(db, { task_id: "T-1022" });
  const filled = ctx.sections.filter((s) => s.status === "injected");
  assert(filled.length >= 3, `一阶段至少目标/背景/来源有内容，实得 ${filled.length} 类`);
  for (const s of ctx.sections) {
    assert(
      s.status === "injected" ? s.items.length > 0 : s.items.length === 0,
      `status 与 items 应自洽（${s.context_type_code}）`
    );
  }
  // MD-12 research_proposal 种子为空 → hva_followup 的「产品问题」必需却为空 → 上下文不完整（如实标出）
  const hva = await buildTaskContext(db, { task_id: "T-1023" });
  assert(
    hva.missing_required.includes("product_question") && hva.complete === false,
    `必需类型为空应计入 missing_required（实得 ${hva.missing_required.join(",")}）`
  );
});

/* ---------------- TC-I-M2-002：注入确定性可复现 ---------------- */

await check("TC-I-M2-002a", "F-12 确定性：同一任务两次装配 → 工作空间逐字节一致（非每回随机）", async () => {
  const { db } = freshDb();
  const a = await buildTaskContext(db, { task_id: "T-1022" });
  const b = await buildTaskContext(db, { task_id: "T-1022" });
  assert(JSON.stringify(a) === JSON.stringify(b), "两次装配结果应完全一致");
  const c = await buildTaskContext(db, { task_id: "T-1023" });
  assert(JSON.stringify(a) !== JSON.stringify(c), "不同任务的工作空间应不同（未退化成同一段话）");
});

await check("TC-I-M2-002b", "F-12 确定性 + 幂等：两次初始化 → 内容一致、注入记录不重复落行", async () => {
  const { db } = freshDb();
  const first = await initTaskContext(db, { task_id: "T-1022", injected_at: "2026-09-19 10:00" });
  const rows1 = await listContextInjections(db, { task_id: "T-1022" });
  assert(first.injections_written > 0, "首次初始化应落注入记录");
  assert(rows1.length === first.injections_written, "落行数应与 written 一致");
  const second = await initTaskContext(db, { task_id: "T-1022", injected_at: "2026-09-19 10:00" });
  const rows2 = await listContextInjections(db, { task_id: "T-1022" });
  assert(second.injections_written === 0, `重复初始化不应重复落行，实得 ${second.injections_written}`);
  assert(second.injections_skipped === rows1.length, "重复项应全部命中幂等跳过");
  assert(rows2.length === rows1.length, "总行数应保持不变");
  assert(
    JSON.stringify(rows1) === JSON.stringify(rows2),
    "两次初始化的注入记录应完全一致（含 injection_id 与 injected_at）"
  );
  assert(
    JSON.stringify(first.sections) === JSON.stringify(second.sections),
    "两次初始化的装配内容应一致"
  );
});

await check("TC-I-M2-002c", "F-12 回查：getTaskContext 返回装配内容 + 该任务已注入记录", async () => {
  const { db } = freshDb();
  await initTaskContext(db, { task_id: "T-1022", injected_at: "2026-09-19 10:00" });
  const ctx = await getTaskContext(db, "T-1022");
  assert(ctx.injections.length > 0, "回读应带注入记录");
  for (const r of ctx.injections) {
    assert(r.task_id === "T-1022", "注入记录应属于该任务");
    assert(String(r.injected_at).length > 0, "注入时点必填");
  }
});

/* ---------------- Q-08：三类无 OBJECT_TYPE 取值（只装配、不落行） ---------------- */

await check("F-12(Q-08)", "F-12 Q-08：background/source/existing_evidence 三类只装配、不落 PD-06 行（dict:OBJECT_TYPE 无取值）", async () => {
  const { db } = freshDb();
  assert(
    CONTEXT_WITHOUT_OBJECT_TYPE.join(",") === "background,source,existing_evidence",
    "待裁决三类应与映射表一致"
  );
  const ctx = await initTaskContext(db, { task_id: "T-1023", injected_at: "2026-09-19 10:00" });
  for (const code of CONTEXT_WITHOUT_OBJECT_TYPE) {
    const s = sectionOf(ctx, code);
    assert(s && s.no_object_type_q08 === true && s.object_type === null, `${code} 应标记无 OBJECT_TYPE 取值`);
    assert(
      !ctx.injections.some((r) => r.context_type_code === code),
      `${code} 不应落 PD-06 行（Q-08 待裁决）`
    );
  }
  // 其余类型（本任务模板命中的）对象类别应取自映射表；本模板未命中的类型不在本次断言范围
  for (const s of ctx.sections) {
    if (CONTEXT_WITHOUT_OBJECT_TYPE.includes(s.context_type_code)) continue;
    assert(
      s.object_type === CONTEXT_OBJECT_TYPE[s.context_type_code],
      `${s.context_type_code} 的对象类别应取自映射表，实得 ${s.object_type}`
    );
  }
  for (const r of ctx.injections) {
    assert(
      Object.values(CONTEXT_OBJECT_TYPE).includes(r.ref_object_type),
      `落行的 ref_object_type 应落在 dict:OBJECT_TYPE 四项内，实得 ${r.ref_object_type}`
    );
  }
});

/* ---------------- 边界：任务不存在 ---------------- */

await check("F-12(边界)", "F-12 边界：任务不存在 → 应用层拒绝（不落半截工作空间）", async () => {
  const { db } = freshDb();
  await expectThrow(() => buildTaskContext(db, { task_id: "T-NOPE" }), /task 不存在/);
  await expectThrow(() => initTaskContext(db, { task_id: "T-NOPE" }), /task 不存在/);
  const rows = await listContextInjections(db, { task_id: "T-NOPE" });
  assert(rows.length === 0, "不应留下任何注入记录");
});

console.log("");
if (failed === 0) {
  console.log(`VERIFY PASS：${pass} 组断言全绿（F-12 上下文按任务组织注入）`);
} else {
  console.log(`VERIFY FAIL：${pass} 通过 / ${failed} 失败`);
  process.exitCode = 1;
}
