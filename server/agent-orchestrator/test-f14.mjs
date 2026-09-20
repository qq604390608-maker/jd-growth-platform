/**
 * 文档卡（F-14 用例执行器 · 2026-09-20）
 * 上游 oracle：../../../docs/05-test-cases/test-M3.md
 *   ｜ TC-U-M3-001（L1·F-14/F-15：意向分归一）｜ TC-A-M3-001（L4·F-14：S-A1 查证计划）｜ TC-A-M3-003（L4·F-14：S-A3 线索归纳）
 * 范围：F-14 确定性纯逻辑 + 确定性编排（mock/demo 推进；LLM 产出契约登记为「门禁未关闭、非发布门禁」）。
 * 自包含：纯函数段不依赖 D1；loadDiscoveryContext 用 fake-db stub 验证「复用读面 + 零写」。
 *
 * 用法：node server/agent-orchestrator/test-f14.mjs
 */

import {
  normalizeIntentionScore,
  assembleDiscoveryPlan,
  summarizeCluesAsJourney,
  loadDiscoveryContext,
  runDiscoveryWithLLM,
  createDiscoveryToolExecutor,
  DISCOVERY_TOOLS,
} from "./discovery.js";
import { MODELS } from "./llm-client.js";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

let passed = 0;
let failed = 0;
const fails = [];
function assert(cond, msg) {
  if (cond) { passed++; }
  else { failed++; fails.push(msg); console.log("  ✗ " + msg); }
}
async function assertThrows(fn, msg, match) {
  try {
    await fn();
    failed++; fails.push(msg + "（应抛错但未抛）"); console.log("  ✗ " + msg + "（应抛错但未抛）");
  } catch (e) {
    if (match && !String(e.message).includes(match)) {
      failed++; fails.push(msg + `（抛出但信息不符：期望含「${match}」，实际「${e.message}」）`);
      console.log("  ✗ " + msg + `（期望含「${match}」）`);
    } else { passed++; }
  }
}
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}
function finish() {
  console.log(`\n${failed === 0 ? "VERIFY PASS" : "VERIFY FAIL"} · ${passed} 断言通过 / ${failed} 失败`);
  if (failed > 0) { console.log("失败项："); fails.forEach((f) => console.log("  - " + f)); process.exit(1); }
  process.exit(0);
}

// ==================================================== U · TC-U-M3-001 意向分归一（确定性纯函数）
console.log("① TC-U-M3-001 · 意向分归一（min(raw/threshold,1)）");
{
  assert(normalizeIntentionScore(1.3, 1.0) === 1.0, "1.3/1.0 → 封顶 1.0（实测 " + normalizeIntentionScore(1.3, 1.0) + "）");
  assert(normalizeIntentionScore(0.5, 1.0) === 0.5, "0.5/1.0 → 0.5（实测 " + normalizeIntentionScore(0.5, 1.0) + "）");
  assert(normalizeIntentionScore(0.8, 1.0) === 0.8, "0.8/1.0 → 0.8");
  assert(normalizeIntentionScore(1.0, 1.0) === 1.0, "1.0/1.0 → 1.0");
  assert(normalizeIntentionScore(2.5, 2.0) === 1.0, "2.5/2.0 → 封顶 1.0");
  assert(normalizeIntentionScore(1.3, 0) === 1.3, "threshold=0 除零防护：回退为 raw 本身（不崩）");
}

// ==================================================== A1 · TC-A-M3-001 S-A1 发现任务调度（查证计划）
console.log("\n② TC-A-M3-001 · S-A1 一阶段注入清单 → 确定性查证计划");
{
  // 缺 goal → 抛错（必填）
  await assertThrows(() => assembleDiscoveryPlan({}), "缺 goal 抛错", "goal");

  const inj = {
    goal: "目标人群在支付环节的转化是否明显低于其它环节",
    scope: "APP 渠道 / 2026Q3",
    background: "近期支付成功率波动",
    history: ["上一轮已查过注册转化"],
    capabilities: ["clue-scan"],
    sources: ["CDP", "HJE", "MKT", "ACT"],
  };
  const r = assembleDiscoveryPlan(inj);
  assert(typeof r.goal === "string" && r.goal.length > 0, "A1 返回 goal 文本");
  assert(Array.isArray(r.plan) && r.plan.length === 4, `A1 默认返回 4 步查证计划（实测 ${r.plan.length} 步）`);
  // 有序：step_no 1..4 递增
  assert(r.plan.every((p, i) => p.step_no === i + 1), "A1 计划 step_no 从 1 连续递增（先查/后查有序）");
  // 每项含结构契约字段
  assert(r.plan.every((p) => p.check_item && p.data_source && p.tool && p.reason && p.stop_when_enough),
    "A1 每项含 check_item/data_source/tool/reason/stop_when_enough");
  // 数据源顺序：CDP 先于 HJE 先于 MKT 先于 ACT（确定性领域规则）
  const seq = r.plan.map((p) => p.data_source).join(">");
  assert(seq === "CDP>HJE>MKT>ACT", `A1 查证顺序＝人群差异→行为变化→反馈→业务信息（实测 ${seq}）`);
  // 停止条件表达（S-A1 验收：计划内查证完成 或 依据已足够）
  assert(/停止条件/.test(r.stop_condition) && /足够依据|依据已足够/.test(r.stop_condition),
    "A1 表达停止条件＝计划内查证完成 或 依据已足够");
  assert(r.stop_condition.includes("不强制跑满"), "A1 停止条件明确「不强制跑满全部步骤」");

  // sources 过滤：只传 CDP → 仅 1 步
  const r2 = assembleDiscoveryPlan({ goal: "g", sources: ["CDP"] });
  assert(r2.plan.length === 1 && r2.plan[0].data_source === "CDP", "A1 仅传 CDP → 计划只含 1 步且为 CDP");
  assert(r2.sources_used.length === 1 && r2.sources_used[0] === "CDP", "A1 sources_used 与过滤一致");

  // 全空 sources（非空数组但无命中）→ 抛错
  await assertThrows(() => assembleDiscoveryPlan({ goal: "g", sources: ["XX"] }), "传入未定义数据源抛错", "未命中");
}

// ==================================================== A3 · TC-A-M3-003 S-A3 旅程线索归纳
console.log("\n③ TC-A-M3-003 · S-A3 按「谁在什么环节遇到什么现象」归纳线索");
{
  await assertThrows(() => summarizeCluesAsJourney("not-array"), "入参非数组抛错");

  const factSet = [
    { fact_id: "F1", audience: "年轻妈妈", phenomenon: "加购后弃单率偏高", evidence_ref: "E-1" },
    { fact_id: "F2", journey_stage: "支付", phenomenon: "支付成功率低于均值", evidence_ref: "E-2" },
    { fact_id: "F3", phenomenon: "整体 GMV 下降" }, // 裸变化：无归属
    { fact_id: "F4", audience: "新客", journey_stage: "浏览", phenomenon: "新客停留时长短" },
  ];
  const out = summarizeCluesAsJourney(factSet);
  assert(Array.isArray(out.clues) && out.clues.length === 3, `A3 有效线索 3 条（含人群或环节归属；实测 ${out.clues.length}）`);
  assert(out.unattributed_count === 1, `A3 裸变化（F3 无归属）被排除且计入 unattributed_count=1（实测 ${out.unattributed_count}）`);
  // 每条有效线索均有归属前缀
  assert(out.clues.every((c) => /^audience:/.test(c.attribution) || /^journey:/.test(c.attribution)),
    "A3 每条有效线索 attribution 以 audience: 或 journey: 开头（均有人群/环节归属）");
  // 不罗列裸变化：无线索的 attribution 为裸文本
  assert(!out.clues.some((c) => c.attribution === "unattributed"), "A3 无「unattributed」伪归属混入有效线索");
  // evidence_refs 透传
  const f1 = out.clues.find((c) => c.attribution === "audience:年轻妈妈");
  assert(f1 && f1.evidence_refs.length === 1 && f1.evidence_refs[0] === "E-1", "A3 evidence_refs 透传正确");
  // 同 fact 有人群+环节 → 优先 audience 前缀（确定性规则）
  const f4 = out.clues.find((c) => c.attribution === "audience:新客");
  assert(f4 && f4.phenomenon === "新客停留时长短", "A3 同时有人群+环节时以 audience 前缀归并");
}

// ==================================================== D · loadDiscoveryContext 复用读面 + 零写（fake-db stub）
console.log("\n④ loadDiscoveryContext · 复用 shared-context 读面 + 零写验证");
{
  function fakeDb() {
    const calls = [];
    return {
      calls,
      prepare(sql) {
        calls.push(sql);
        return {
          bind() {
            return {
              all() { return { results: [] }; },
              first() { return {}; },
              run() { return { success: true, meta: { changes: 0 } }; },
            };
          },
        };
      },
    };
  }
  const db = fakeDb();
  const inj = await loadDiscoveryContext(db, "T-X");
  assert(inj && typeof inj === "object", "D 返回注入清单对象");
  assert("goal" in inj && "scope" in inj && "background" in inj && "history" in inj && "capabilities" in inj && "sources" in inj,
    "D 注入清单含 goal/scope/background/history/capabilities/sources 六键");
  // 零写：所有 prepare SQL 均不含 INSERT/UPDATE/DELETE
  const writes = db.calls.filter((s) => /\b(INSERT|UPDATE|DELETE)\b/i.test(s));
  assert(writes.length === 0, `D 零写库（prepare 语句无 INSERT/UPDATE/DELETE；实测 ${writes.length} 条）`);
  assert(db.calls.length > 0, "D 确实调用了读面（getTaskContext/getResearch 经 prepare 读）");
}

// ==================================================== S · 静态核验（零外部调用 / 零裸 SQL / 单一读面复用）
console.log("\n⑤ 静态核验 · 零外部调用 / 零裸 SQL / 仅复用 shared-context 读面");
{
  const src = stripComments(readFileSync(new URL("./discovery.js", import.meta.url), "utf8"));
  assert(!/fetch\s*\(/.test(src) && !/https?:\/\//.test(src), "S 无外部 HTTP 调用（无 fetch / 无 http(s) 字面）");
  // 本文件不直接写库：无裸 INSERT/UPDATE/DELETE 字面（读面在 shared-context 内部，本文件只 import）
  assert(!/\b(INSERT|UPDATE|DELETE)\b\s+INTO/i.test(src), "S 本文件无裸写语句字面（写面全在 shared-context，本文件零写）");
  // import 仅来自 shared-context（读面）；不 import 其它业务模块 / D1 写面
  const sharedImports = (src.match(/from "\.\.\/shared-context\/index\.js"/g) || []).length;
  assert(sharedImports === 1, "S 唯一业务 import 来自 ../shared-context/index.js（复用读面）");
  const otherBusiness = (src.match(/from "\.\.\/(?!shared-context)[^"]*"/g) || []).length;
  assert(otherBusiness === 0, "S 不 import 其它 ../ 业务模块（tool-executor / task-runner 等）");
  assert(!/node:sqlite/.test(src), "S 不 import node:sqlite（零裸 SQL，写面全在 shared-context）");
}


// ==================================================== F · 取值正确性（真实 D1；修复 F-14 取值缺陷 §agent-orchestrator/README §⑥）
console.log("\n⑥ loadDiscoveryContext · 真实 D1 取值非空（修复取值缺陷）");
{
  /** 把 node:sqlite 包成 D1 形态：prepare().bind().run()/all()/first()（复用 test-f12 适配层）。 */
  const d1From = (sqlite) => {
    const makeStmt = (sql, params) => ({
      bind: (...args) => makeStmt(sql, args),
      run: () => {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      all: () => ({ results: sqlite.prepare(sql).all(...params) }),
      first: (col) => {
        const row = sqlite.prepare(sql).get(...params) ?? null;
        return row === null ? null : col === undefined ? row : row[col];
      },
    });
    return { prepare: (sql) => makeStmt(sql, []) };
  };
  const DDL = readFileSync(new URL("../../db/migrations/0001_init.sql", import.meta.url), "utf8");
  const SEED = readFileSync(new URL("../../db/seed/0001_mock.sql", import.meta.url), "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(DDL);
  sqlite.exec(SEED);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = d1From(sqlite);

  const ctx = await loadDiscoveryContext(db, "T-1022");
  assert(Array.isArray(ctx.goal) && ctx.goal.length >= 1, `⑥ goal 非空（实测 ${ctx.goal.length} 条）`);
  assert(Array.isArray(ctx.background) && ctx.background.length >= 1, `⑥ background 非空（实测 ${ctx.background.length} 条）`);
  assert(Array.isArray(ctx.capabilities) && ctx.capabilities.length >= 1, `⑥ capabilities 非空（实测 ${ctx.capabilities.length} 条）`);
  assert(Array.isArray(ctx.sources) && ctx.sources.length >= 1, `⑥ sources 非空（实测 ${ctx.sources.length} 条）`);
  assert(ctx.scope && ctx.scope.business_scope != null, `⑥ scope 含 business_scope（实测 ${ctx.scope && ctx.scope.business_scope}）`);
  // 修复前：goal/background/capabilities/sources 恒为空（ctx 无顶层键）；现从 sections 取值应非空
}

// ==================================================== ⑦ A-1 LLM 驱动路径（2026-09-20 收编）
console.log("\n⑦ A-1 LLM 驱动路径 · `runDiscoveryWithLLM` / `DISCOVERY_TOOLS` / 工具执行器（mock binding，不触真实推理）");
{
  /** mock AI binding（只记录调用、返回预设 completion） */
  const reply = (content) => ({ choices: [{ message: { role: "assistant", content }, finish_reason: "stop" }] });
  const makeAI = (responses) => {
    const calls = [];
    let i = 0;
    return {
      calls,
      async run(model, inputs) {
        const r = responses[Math.min(i, responses.length - 1)];
        calls.push({ model, inputs });
        i += 1;
        return typeof r === "function" ? r(model, inputs, i) : r;
      },
    };
  };

  // A-1 门禁：无 binding → 不进 LLM 路径
  await assertThrows(() => runDiscoveryWithLLM(null, {}, "T-1022"), "⑦ ai 为空 → 抛错（A-1 未接入）", "ai binding 不能为空");

  // 显式 mock（2026-09-20 收编并发改动）：opts.mock = true + 无 binding → 走 mock 路径。
  // 红线锚定：mock 输出带 _mock 标记 + stopped_by=mock_mode（可观测、防误信），
  // 且 mock 工具执行不触注入的 toolExecutor（llm-client 内部假执行器，零写库）。
  const mockRes = await runDiscoveryWithLLM(null, {}, "T-1022", { mock: true });
  assert(mockRes && mockRes.stopped_by === "mock_mode", "⑦ 显式 mock → stopped_by=mock_mode（可观测）");
  assert(mockRes.content && mockRes.content._mock === true, "⑦ mock 结论带 _mock=true 标记（防误信伪造数据）");
  assert(Array.isArray(mockRes.tool_calls_executed) && mockRes.tool_calls_executed.length > 0, `⑦ mock 工具执行记录非空（实测 ${mockRes.tool_calls_executed.length}）`);
  assert(
    mockRes.tool_calls_executed.every((t) => t.result && t.result.source && String(t.result.source).endsWith("-MOCK")),
    "⑦ mock 工具结果全部带 -MOCK 来源标记（不冒充真实返回）"
  );

  // 工具定义：function calling 契约合规
  assert(Array.isArray(DISCOVERY_TOOLS) && DISCOVERY_TOOLS.length > 0, `⑦ DISCOVERY_TOOLS 非空（实测 ${DISCOVERY_TOOLS.length}）`);
  assert(
    DISCOVERY_TOOLS.every((t) => t && t.type === "function" && t.function && typeof t.function.name === "string"
      && typeof t.function.description === "string" && t.function.parameters),
    "⑦ 每个工具定义含 type=function + name / description / parameters"
  );
  const toolNames = DISCOVERY_TOOLS.map((t) => t.function.name);
  assert(new Set(toolNames).size === toolNames.length, "⑦ 工具名不重复（function calling 要求唯一）");

  // 工具执行器：未知工具在 import tool-executor **之前**短路（不触发真实查询、不落痕）
  const exec = createDiscoveryToolExecutor({}, "T-1022", "agent", "discovery-agent");
  const unknown = await exec("no_such_tool", {});
  assert(unknown && typeof unknown.error === "string", "⑦ 未知工具名 → 返回 { error }（不抛、不静默成功）");
  assert(String(unknown.error).includes("未知工具"), `⑦ 错误信息点名未知工具（实测 ${unknown.error}）`);

  // 正常路径：真实 D1（种子发现任务 T-1022）+ mock LLM 一轮返回结构化 JSON
  const d1From = (sqlite) => {
    const makeStmt = (sql, params) => ({
      bind: (...args) => makeStmt(sql, args),
      run: () => {
        const r = sqlite.prepare(sql).run(...params);
        return { success: true, meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } };
      },
      all: () => ({ results: sqlite.prepare(sql).all(...params) }),
      first: (col) => {
        const row = sqlite.prepare(sql).get(...params) ?? null;
        return row === null ? null : col === undefined ? row : row[col];
      },
    });
    return { prepare: (sql) => makeStmt(sql, []) };
  };
  const DDL = readFileSync(new URL("../../db/migrations/0001_init.sql", import.meta.url), "utf8");
  const SEED = readFileSync(new URL("../../db/seed/0001_mock.sql", import.meta.url), "utf8").replace(/pragma\s+foreign_keys\s*=\s*on\s*;/gi, "");
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(DDL);
  sqlite.exec(SEED);
  sqlite.exec("PRAGMA foreign_keys = ON;");
  const db = d1From(sqlite);

  const payload = {
    clues: [{ attribution: "audience:新客", phenomenon: "首单后 7 日复购率偏低", evidence_refs: ["Q-1"] }],
    opportunities: [],
    gaps: ["缺少渠道分层数据"],
    summary: "本轮仅发现 1 条线索，依据不足以形成机会",
  };
  const ai = makeAI([reply(JSON.stringify(payload))]);
  const r = await runDiscoveryWithLLM(ai, db, "T-1022");

  assert(r.content && Array.isArray(r.content.clues), "⑦ 解析出结构化结果（clues 为数组）");
  assert(r.content.clues.length === 1, `⑦ 线索条数正确（实测 ${r.content.clues.length}）`);
  assert(r.content.gaps.length === 1, "⑦ 缺口如实带回（依据不足→记缺口，不强行形成机会）");
  assert(r.rounds === 1, `⑦ 模型一轮结束（实测 ${r.rounds}）`);
  assert(r.stopped_by === "model_end", `⑦ stopped_by=model_end（实测 ${r.stopped_by}）`);
  assert(r.tool_calls_executed.length === 0, "⑦ 未要求调用工具时不触发任何查询（**零外部调用**）");
  assert(ai.calls[0].model === MODELS.MAIN, `⑦ 默认模型取自 MODELS.MAIN 常量、不硬编码（实测 ${ai.calls[0].model}）`);

  const userMsg = ai.calls[0].inputs.messages.find((m) => m.role === "user").content;
  assert(userMsg.includes("业务目标"), "⑦ 用户消息含「业务目标」段（注入清单已装配）");
  assert(userMsg.includes("任务"), "⑦ 用户消息含任务指令段");
  assert(Array.isArray(ai.calls[0].inputs.tools), "⑦ 工具定义随请求下发（function calling 契约）");

  // LLM 返回非法 JSON → 兜底记缺口，不静默丢
  const ai2 = makeAI([reply("这不是 JSON")]);
  const r2 = await runDiscoveryWithLLM(ai2, db, "T-1022");
  assert(r2.content._parse_error === true, "⑦ 非法 JSON → 显式标 _parse_error（不静默丢）");
  assert(Array.isArray(r2.content.gaps) && r2.content.gaps.length >= 1, "⑦ 解析失败**记入 gaps**（显式可见，不吞掉）");
  assert(typeof r2.content.summary === "string" && r2.content.summary.length > 0, "⑦ 兜底时保留原始文本供排查");
}

finish();
