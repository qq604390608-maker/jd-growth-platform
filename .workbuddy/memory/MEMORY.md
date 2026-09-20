# MEMORY.md · 京东-agent项目（长期项目约定）

> 只记**跨会话仍然成立**的项目约定与踩过的坑。日常过程写在 `YYYY-MM-DD.md`。

## 硬纪律（不可绕过）

- **一 F-xx 一 PR**：开工前读上游真源（子 PRD 验收要点 → `docs/05-test-cases/test-Mx.md` 的 oracle → `docs/03-locks/*` → `AGENTS.md` 红线），交付走**双向登记**（文档卡 + 反向清单 + 目录 README + `AGENTS.md` 状态位 + `ci.yml` 一步）。
- **生产零写 / 真实返回 / 证据四要素 / 失败不否定结论**：四条红线写进每份产物，且**尽量做成可静态扫描或可运行期断言**的，不靠人工保证。
- **外部依赖门禁**：`external-deps.md` §7 未关闭项（T-01/T-02/T-05/T-06…）未关时，外部调用一律 mock/demo，**demo 数值不进断言**；未关项对应的用例不设为发布门禁。
- **发现上游文件自身缺陷 → 先登记「未擅自改」，等用户点头再动**；动手时按全套流程（bump 版本 + 旧版进 `.trash/` + 比对 SHA + 同步下游钉版）。口径不确定的**登记成 Q-xx 挂 `docs/03-locks/schema.md` §12**，并明确「当前按哪个方向实现」。

## 架构约定

- **新增写面就单独成文件**（`server/tool-executor/` 的既有惯例）：`mcp-client.js`（传输层，零 SQL 零写）、`task-state.js`（任务态写入面，改行只落在 `task` 且带主键条件）。这样 `index.js` 保持「不含改行 / 删行类 SQL」，**`test-f23.mjs` 那条静态零写断言就永远不用改**——扩写面时不去动既有 oracle，是这个拆法的第一目的。**一个模块可以有多个写面**：`server/agent-orchestrator/` 里 `profile.js` 管 MD-13/MD-14、`behavior-store.js` 管 MD-09/MD-10；编排文件（`role.js` / `behavior.js`）**零写语句零裸 SQL**，落库全经写面文件，**取号也不写 `SELECT MAX`**（用写面读面返回的全量自算「库内最大 +1」）。模块级硬红线里那句「本目录只写 X 表」是**清单**、不是「只有一张表」，新增写面时必须同改该句。
- **引入同目录内新 import 会改变「文件间引用图」**：本目录 README 的「文件间引用（本目录内）」段逐文件写明了「谁被别人 import」。把 `behavior.js` 指向 `verification.js`（F-20 复用 F-15 的查询与倒挂口径）后，`verification.js` 就不再是「只由 `../api/index.js` 消费」——**该段与模块级硬红线必须同改**，否则文档与现实不符（这是交付物自检里最容易漏的一项）。
- **「派生优于复制」**：上游已有真源常量时，下游**用 `map` 派生**而不是再抄一份（如五查键序 `RESEARCH_CHECK_SEQUENCE.map(s => s.check_key)`），并在用例里断言 `派生结果.join(">") === 上游常量.join(">")`。改一处不可能漏另一处，且「不复制第二个口径」这条纪律变成可静态核对的断言。
- **值域一律从库读、不内联**：`dict_item`（`dictCodes(db, 'TASK_STATUS')` 等）是唯一真源；代码里不复制中文枚举。
- **叙述文本本体归 `agent-runtime/`，服务端只持「编号 + 判据键 + 来源回指」**：角色指令（`agent.md`）与公共业务指令（`business-rules.md`）的**文本本体只存 `agent-runtime/` 一份**；服务端（`server/agent-orchestrator/role.js`）不内联叙述，只持段落键 / 指令编号 / 判据键，并用例**逐条对齐断言**（读本体 md 抽标题列表 vs 代码常量列表，逐条相等）。配套纪律：常量里的标题须与本体标题**逐字一致**（修饰语放正文），否则「回指不重述」就退化成第二个口径。
- **约定优于重写 oracle**：既有用例的断言能不动就不动；确需扩写面时优先改架构（拆文件 / 缩窄写面），其次才是改用例。
- **受门禁的语义判断一律做成「可注入判据 + 确定性 fallback」**（F-19 范式，后续 F-20/F-21 同类沿用）：需要 LLM（A-1 ⬜ 未提供）的那一步（如「问题是否适合 HVA 研究」）**不做关键词猜测**——函数接收可选的判定入参（如 `suitability={suitable,reason,signals}`），传了就采纳（`source='provided'`），没传就走**确定性 fallback** 并显式标注 `llm_gated=true`，**既不硬造结论也不硬做**；入参形态非法一律报错、不静默忽略。这样门禁关闭前后**同一套代码**可用，且 oracle 的「三分支」在门禁期内即可被用例真实走通（该 oracle 项登记为「门禁未关闭、非发布门禁」）。
- **「缺信息」不等于「路径未定」**：把「能定则定、缺则如实登记」当作默认口径——如 F-19 的比较条件三项缺了就列入 `missing`（不编造、不静默回退），**但不阻断本步的停止条件**（停止条件只认「路径确定」），补齐动作交给下游功能点。别把上游的缺口变成自己的失败。

## 踩过的坑（本机实测）

- **`assert(someAsyncFn(...).length >= 2)` 忘了 `await`** → Promise 的 `.length` 是 `undefined`，断言**静默假失败**，排查成本极高。做法：async 结果先 `await` 进变量再断言，并把**实测值写进断言文案**（`实测 N 条`）。
- **「改前状态」必须在写之前取**：一串 `await` 之后再 `getTask` 拿到的是改后值。
- **静态扫描扫全文（含注释）**：`/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/` 会被**中文注释里的字面英文词**命中。散文里写「改行 / 删行类 SQL」；若该文件由自己写的用例扫描，就先 `stripComments` 再去扫。
- **「先执行后拒写」会留半截状态**：任何「任务态 / 归属校验」都要做成**前置守卫**，在执行与写入之前判，而不是等写到最后一步才抛。
- **引用自检的「重号」判定**：同一文件内 **≥2 个列表项以同一编号开头**即命中（跨文件引用同一编号不算）。所以同一编号的注意事项不要连着起 4 个列表项，改写成「门禁（F-26 相关）」「新登记 Q-12（未决，F-26 实施发现）」这类以主题开头的写法。
- **`Write` 重写中文长文档后自检 `&#xNNNN;` 实体转义残留**：`awk 'index($0,"&#x"){c++} END{print c+0}' 文件`，非 0 逐个修回。
- **阈值 / 数值入参的严数值化**：`Number(null)` 是 `0`、`Number("")` 是 `0`——若直接用 `Number.isFinite(Number(v))` 做校验，`composite_raw: null` 会被静默当成 0 放行（阈值判定就会得出错误的 `in_pool`）。做法：显式拒 `null`/`undefined`/`""`/布尔，再 `Number()` + `isFinite`。这条对「阈值、分数、计数」类入参一律适用。
- **写完必读回（别把草稿留在交付物里）**：本点实测在新写的写入面函数里留了一个**无意义的占位分支**（`if (!Number.isInteger(...) && false) { /* 占位 */ }`），跑测试全绿、只有人工回读才发现。做法：新文件交付前**通读一遍**，或用 `Grep` 搜 `TODO|占位|FIXME|&& false`。

## 本机环境

- 无 `wrangler`（2026-09-19 确认）。验证方式：`node:sqlite` 建 D1 兼容适配层 + 载真实 DDL/种子 + 直接调 `worker.fetch`；要验真实 HTTP 就把 `prototype/mock/index.js`（默认 `:8788`）起起来打。
- node 用 `/Users/dongzhuo/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`。
- **`node:sqlite` 返回的行是 null-prototype 对象**：`String(row)` / 模板串直接抛 `Cannot convert object to primitive value`。凡把「可能拿到库行对象」的入参做字符串化的地方（如来源清单过滤），**按形态显式取值**（字符串直接用 / 对象取 `source_id` 之类的具名字段 / 其余形态忽略），别用 `String()` 兜底——它在 fake-db 或纯字符串入参时看不出问题，真实夹具一跑才崩。
- git 身份：仓库级 `dev <dev@local>`（全局未配，新克隆需 `git config user.name/email` 才能提交）。
