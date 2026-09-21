# PITFALLS.md · 京东-agent项目（踩坑细则）

> `MEMORY.md` 的配套细则页：**本机实测踩过的坑**与可复用做法。开工/交付前按需通读。
> 硬纪律、架构约定、本机环境在 `MEMORY.md`。

## 断言与静态扫描

- **`assert(asyncFn(...).length>=2)` 忘 `await`** → Promise 的 `.length` 是 `undefined`，断言**静默假失败**，排查成本极高。先 `await` 进变量再断言，并把**实测值写进断言文案**（`实测 N 条`）。
- **静态扫描扫全文（含注释）**：`/\b(UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/` 会被**中文注释里的字面英文词**命中。散文写「改行 / 删行类 SQL」；自扫的文件先 `stripComments` 再扫。
- **断言要精确到「语句形态」**：写「不写 `SELECT MAX`」而不是「不出现 `SELECT`」（编号计算里的 `Math.max`、注释里的字面词都会命中）。判「前端不直连数据库」用 `env.DB` / `D1Database` / `.prepare(`，**别用裸 `SELECT`**（CSS 元素选择器 `select`、HTML `<select>`、JS `delete` 运算符都会误伤）；判地址用 `https?://`，别用 `/http/i`（会命中文案里的 `HTTP 500` 字样）。
- **类别通配要用 `\d+`**：`/test-f2[0-9]\.mjs$/` 是「看起来通配、实则只到 29」——`test-f30.mjs` 不匹配，于是每加一个执行器都会打红既有用例。写 `/^test-f\d+\.mjs$/`；确要限上限就把理由写进注释。
- **「扫一个目录里除我以外的所有文件」的排除谓词一律按类别通配**（F-28 血泪）：`frontend/test-f27.mjs` 只排自己，F-28 新增 `test-f28.mjs`（内含 `INSERT INTO`/`.prepare(`/`http://localhost`/`fetch(`）后 F-27 **一次红 6 条**，且报的是「前端受检文件」命中，极易误判成「新页面违规」。把「受检对象＝运行期产物」的意图写进谓词旁注释。
- **静态 import 计数会命中文件头注释里的用法示例**（`from "./x.js"` 之类）→ 先 `stripComments(code)` 再抽 import。
- **引用自检的「重号」判定**＝同一文件内 **≥2 个列表项以同一编号开头**（跨文件引用同一编号不算）→ 同编号的注意事项别连着起多个列表项，改写成「门禁（F-26 相关）」「新登记 Q-12（未决）」这类**主题开头**的写法。
- **引用自检的解析基准**是「本文件目录」与「仓库根」二者之一：跨目录引用要写**相对仓库根的完整路径**（`frontend/pages/goal.html`）才命中；目录内简写（`pages/goal.html`）会落到「软偏差·路径不精确」（不计失败但报噪）。**待建产物的软偏差无法避免，属正常项，建成即自消**，不必加豁免条目。
- **`grep … | head -N` 截断会漏同步目标**（血泪）：同步下游钉版引用时用 `head -20` 列文件会被截断，实测漏掉 3 个文件里的 5 处改动。凡「全量」语义的操作**禁止 head 截断**——先 `grep -c` 计总数确认规模，或直接按关键词**不截断全扫**。**复核也要全量**：用「排除有意保留项」的谓词（如 `grep -v "~~"`）验证真残留为 0，而不是抽查。
- **「改前状态」必须在写之前取**：一串 `await` 之后再 `getTask` 拿到的是改后值。
- **修完 bug 要「反证」**：临时把正确值改成错误值，**必须看到断言变红**再恢复——**由绿变红才证明断言咬得住**。实测曾回滚「修复」后测试仍全绿（真正的修复在别处），若就此收工，这条断言能否防回归完全未知。本 shell 下 `sed -i '' 's/x/y/' file` 的参数会被吞（`s/x/y/` 被当文件名报 No such file），改用 `node -e "readFileSync→replace→writeFileSync"` 做临时替换（配合先 `cp` 备份）。
- **`Write` 重写中文长文档后自检 `&#xNNNN;` 实体转义残留**：`awk 'index($0,"&#x"){c++} END{print c+0}' 文件`，非 0 逐个修回。（自检规则文档本身写 `&#xNNNN;` 字面量属正常，不算残留。）

## 写面与状态

- **「先执行后拒写」会留半截状态**：任何「任务态 / 归属校验」都要做成**前置守卫**，在执行与写入之前判，而不是等写到最后一步才抛。
- **HTTP 错误文案与状态码是耦合的**：`api/index.js` 的 `errorResponse` **按文案关键词判状态码**（含「不在 / 不存在 / 未解析」等 → 400），新增守卫文案若不含关键词会被归到 500。写新守卫文案时按此约定选词。
- **前置守卫的判定顺序会改变返回码**：`saveResearchReport` 把「研究存在」放在「七要素齐备」之后，故**残缺入参 + 不存在的编号**拿到的是 `incomplete(200)` 而非 404。写冒烟 / 探针要按**守卫顺序**构造入参才能打到目标分支，别把「没打到 404」当成实现错。
- **阈值 / 数值入参的严数值化**：`Number(null)` 是 `0`、`Number("")` 是 `0` —— 若直接用 `Number.isFinite(Number(v))` 校验，`composite_raw: null` 会被静默当 0 放行（阈值判定会得出错误的 `in_pool`）。做法：显式拒 `null`/`undefined`/`""`/布尔，再 `Number()` + `isFinite`。适用「阈值、分数、计数」类入参。
- **写完必读回（别把草稿留在交付物里）**：实测在新写入面留过一个**无意义的占位分支**（`if (!Number.isInteger(...) && false) { /* 占位 */ }`），跑测试全绿、只有人工回读才发现。新文件交付前**通读一遍**，或 `Grep` 搜 `TODO|占位|FIXME|&& false`。
- **前端调用点必须逐点对齐服务端返回结构（F-27 血泪）**：同一个域的写面返回形态**各不相同**——`registerGoal` → `{ goal, version }`、`saveGoalVersion` → **直接是版本行**、`fillGoalGap` → `{ gap, version, merged_field }`、`applyGoalVersion` → `{ applied_version_no, …, version }`、`runGoalCheckTask` → `{ task, check, gaps, all_gaps }`。页面按 `{ version }` 猜着读（`ver.version.version_no`）→ 属性读错**抛在渲染之前** →「库已改、界面没更新、后置动作没跑」**一处读属性错误伪装成三类独立缺陷**（提示缺失 / 版本历史不刷新 / 待补项为 0），排查方向全被带偏。做法：写页面前先 `grep "^export async function"` + 读 return 行把契约钉死；页面里的 `catch` 只在**动作边界**兜，别让它掩盖「契约读错」这种必现 bug。
- **保存流程里「后置动作自己落提示」会吃掉前一条提示**：保存成功后自动跑口径检查，检查的 `note()` 会立刻覆盖「已保存为 vX + 影响范围」，用户等于看不到保存结果（oracle 明确要求提示影响范围）。做法：后置步骤支持 `silent` 选项并**把文案 return 给调用方**，由主流程合成**一条**最终提示。
- **`catch` 兜底会把「调用方写错」说成「任务失败」（F-33 定范式）**：执行体常写 `try { 干五步 } catch (e) { 记 PD-03 + 任务 blocked }`。这层兜底一旦包住**入口校验**，就越界了——`runResearchStep(db, tid, 0, {})`（不存在第 0 步）与 `analysis_input: "字符串"` 都会被吞成 `{outcome:"blocked"}`，**在库里留一条永远无法自动恢复的 `PD-03`**（reason 还是误导性的 `call_failed`），而真实原因只是调用方传错。做法：**程序性错误（越界步号 / 入参形态非法 / 任务类型不符）在 `try` 之外直接抛错**，`try` 只收结构性受阻（口径缺失、快照版本缺失、产出不合规）。配三条断言锁死：`assertThrows(...)` 抛对文案 + **步态未被改动** + **`task_block` 行数为 0**。另：catch 里若要 `advanceStep`/记 `PD-03`，先查该步号**是否真存在**（`listTaskSteps(...).some(s => s.step_no === n)`），否则会为不存在的步号造幽灵行。
- **接线体第一次跑通必卡在「缺必填字段」——先读上游写入面的必填清单**（F-33 实测两处）：`EXT-02 evidence` 要 `missing_note`（F-09 `REQUIRED_EVIDENCE`）、`MD-08 research_finding` 要 `limit_note`（F-21 `createResearchFinding` 必填列）。这类列**库级 `NOT NULL` 会拦**，但错误信息只报字段名，容易误判成自己的 bug。做法：实现前 `grep -nE "REQUIRED_|必填" <上游写入面文件>`，把必填项列成清单；再注意**顺序耦合**——`missing_note` 由缺口规则填出，所以必须**先** `verifyFiveChecks` **再** `buildEvidenceDraft`，反过来就会拿到空值而在落库时才炸。
- **夹具别假设种子里有某个 `task_type` 的行**（F-33 实测）：断言「queue 对未接线类型走占位」时去 `SELECT task_id FROM task WHERE task_type='goal_check'` → 种子**一行都没有** → `gc` 为 `undefined` → `Cannot read properties of undefined`，报错位置在断言行、看着像断言写错。做法：夹具**自建**（`createTask` + `planTaskSteps`）而不是借种子行；顺带更稳（种子改行数不会连带红）。注意 `delegateToAgent` 这类守卫**要求该任务已有步骤行**，只建任务不 plan 会报「步骤不存在」。
- **`blocked` 时落不落 `ended_at` 有两条写面，恢复后成脏态**（F-33 线上验收发现，已登记未擅改）：M5 `handleQueryFailure`（F-26）对 `blocked` **一律留空**、仅 `stopped` 落值；而执行体 catch（`executor.js` / `research.js`）在 `blocked` 时**落 `ended_at=stamp`**。`setTaskStatus` 的 SQL 是 `ended_at = COALESCE(?, ended_at)`、`resumeTask` 又不传该值 → **旧值被保留**，于是恢复后出现「`running` 却 `ended_at` 非空」，与锁定列「任务结束时点；**进行中为空**」相悖（M6 F-32 会读出「进行中还有结束时刻」）。**干跑实证**（同库 + 真实写入面 `setTaskStatus`/`resumeTask`）：F-26 口径 resume 后 `ended_at=null` ✅／执行体口径 resume 后 `ended_at='2026-09-21 16:00'` ❌。**线上同源可复现**：同一批任务里 catch 写的 `ended_at=15:26`、F-26 写的 `ended_at=null`。排查手法：拿「同一状态、不同来源」的两行对比 `ended_at` 是否一致，比读代码快。
- **受阻文案的「前缀」是写面指纹**（线上排查用）：`第 N 步受阻：<原因>` ＝**执行体 catch** 写的（`research.js` / `executor.js`）；`接口不可用（受限返回）：<原因> —— 受影响的研究内容已保留` ＝**M5 F-26 `handleQueryFailure`** 写的（`tool-executor/index.js`）。看到后者就别再去执行体的 catch 里找原因——它是「查询侧被判受限」的产物，根因要往 `is_enabled` / 权限面查。另外 F-26 会把 `done_fragment`（默认 `<时刻> <block_note>`）**追加进 `done_part`**，所以 `done_part` 里会看到「①…；<时刻> 接口不可用…；②…」这种**受阻记录夹在两步之间**的形态——它标记的是「那一刻被处置」，不是顺序错乱。

## 种子与版本

- **改 `db/seed` 种子的两条硬纪律（血泪）**：
  ① **生成器与已验证 SQL 会不同步**——`generate_mock.py` 是「运行即**全量**重写 `0001_mock.sql`」，人工在 SQL 上做的修正若**没同步回生成器**，重跑会把那些修正**静默回退**（实测：`gap_rule` 的规范化字段名被回退成别名、冲掉 Q-13 已决①，并改了 T-1023 父任务与 LK-OR-001 的关系语义——后者还是跨枚举误用，`related_update` 属 `EVIDENCE_LINK_KIND` 而非 `OPP_RELATION`）。做法：改种子前先把人工修正**同步回生成器**再重跑，重跑后**必须 `diff` 核对只应出现预期差异**（逐表确认变更范围）。
  ② **改种子后必须跑全量 32 套件回归**——只跑「相关」套件会漏掉跨表关联影响（实测：只跑 F-16/F-17，漏掉 F-01 因 `gap_rule` 别名而失败的 `alias_fields` 断言，隔了一整轮才暴露）。
- **bump 版本后同步下游，钉版引用要分两类处理**：**「现状声明」**（如「已建 v1.2」「✅ 已有 v1.2」）跟着改成新版本；**「历史事实」**（如「2026-09-19 回填至 v1.2」）**保留旧版本号**，改成新版本会让史实失真。已决项用 `~~划掉~~ → 已决（日期）` 保留痕迹，不要直接删掉旧表述（删了就看不出曾经待决）。「待确认条数」这类汇总数字要同步递减（实测 §8 由 13 条减为 12 条）。

## 并发与数据形态

- **工作区会被「另一个进程」并发修改**（已三次复现，2026-09-20）：`git status` 出现过**本会话从未编辑过**的文件改动——先是 `wrangler.toml` + `server/api/index.js` + 新增 `llm-client.js`（Workers AI 接入试验，222 行、含具体模型 ID），收编提交后又冒出 `discovery.js` +295 行（接入 LLM + 跨模块写面）与 `agent.md` +14。特征：**来源不明、未测试未登记**。做法：① 提交前**逐文件确认「这是我改的吗」**，不是就 `git add` **只列自己的文件、单独挑出不夹带**；② 向用户报告并等裁决，不擅自收编或删除；③ 已确认的错误要修（如 `[[ai]]` 被写成 `[ai]`，**修完还会被改回**，须复核时间戳）。另：收编这类游离改动时它们**不属于任何分支**，只能就地提交，提交前用 `git status --short` 圈定范围。
- **`node:sqlite` 返回的行是 null-prototype 对象**：`String(row)` / 模板串直接抛 `Cannot convert object to primitive value`。凡把「可能拿到库行对象」的入参做字符串化的地方（如来源清单过滤），**按形态显式取值**（字符串直接用 / 对象取 `source_id` 之类的具名字段 / 其余形态忽略），别用 `String()` 兜底——它在 fake-db 或纯字符串入参时看不出问题，真实夹具一跑才崩。
- **D1 兼容适配层的 `first()` 必须返回「行或 `null`」，不能返回信封**：真实 D1 的 `first()` 解析为**行对象或 `null`**，`all()` 为 `{results}`，`run()` 为 `{success,meta}`。适配层若把 `first()` 包成 `{success,result}`，调用方的 `if (existing)` **恒真**，会静默走进「幂等 / 已存在」分支（F-21 冒烟实测：`submitProposal` 明明新建却返回 `idempotent:true`）。
- **给执行回路加「节流类守卫」时，默认参数要派生自单一真源、且不许破既有 oracle**（F-34 定范式，2026-09-21）：加「每 tick 步数配额 + 同 tick 去重 + 单步超时」三道守卫时踩到三点——
  ① **默认值不能破既有断言**：配额默认若小于单任务步数（本项目 5），既有用例「一次驱动跑满五步」立刻红；正解是把默认值**派生**成 `Math.max(...Object.values(TYPE_STEPS).map((s) => s.length))`（＝一个任务的整轮步数），于是「不破既有语义」变成**可断言的不变量**（用例断 `TICK_QUOTA === 该派生式` 且 `>= max`，并断 `配额 < 一批 12 任务 × 5 步 = 60` 以证「摊薄」仍有意义）。
  ② **超时阈值必须大于它兜底的那一层自己的超时**：单步超时**派生自**传输层 `DEFAULT_TIMEOUT_MS`（×2）而不是自拟数字——否则会**误杀「传输层本可完成」的步骤**，把真实返回变成「超时放弃」。用例直接断 `STEP_TIMEOUT_MS > DEFAULT_TIMEOUT_MS`。
  ③ **上限类标志的判定顺序是「先取待办、再判能否做」**：把配额判断放在「取待执行批次」**之前**，会把「刚好跑完（无剩余）」误报成「被配额拦住」（`exhausted=true`）——实测初版即踩、用例 ⑧ 立刻红。正解：先查本轮待办，**待办为空即结束**，非空但无配额才置 `exhausted`；含义收紧为「**配额已尽且仍有待执行步骤**」。
- **「放弃等待」型超时必须给被放弃的 Promise 挂空 `catch`，并用例断言「零未处理拒绝」**：`Promise.race([work, timeout])` 超时返回哨兵后 `work` **仍在跑**，它随后若 reject 就是一个**未处理拒绝**（Node 15+ 默认致命）——等于把「超时兜底」升级成进程崩溃。做法：超时分支里 `pending.catch(() => {})`；用例侧 `process.on("unhandledRejection", …)` 计数并断言 **0 条**（比只断「返回了哨兵」更能锁住这条红线）。另：把 `timer`/`clear` 做成可注入参数，超时分支就能**确定性触发**（注入一个「立即回调」的假定时器），不必靠真实等待——这让「超时」这类时间相关分支也能稳定进 CI。

## 工具与文档流程

- **改 YAML / 配置文件里「某一行的内容」时，别用只含行尾的锚点**：实测把 `run: node ...test-f04.mjs` 的**末尾换行**当作 `old_string` 做替换，结果该行与下一行 `- name: 跑 F-05 用例…` **粘贴成一行** → `python3 -c "import yaml..."` 报 `mapping values are not allowed here`。做法：**整行替换**（含整行文本），改完立刻用 `yaml.safe_load` 验可解析（本项目 `ci.yml` 47 步，可打印步骤数复核）。
- **oracle 会 encode「上游缺陷下的旧现实」**：`test-f19` 断言「该机会的历史研究**只有** `R-007`」——它之所以成立，正是因为 F-04 当时**没建研究壳**。补完建壳，真库多一行 `R-008`，断言必红。做法：遇到这类红**先问「断言的成立前提是不是某个缺陷」**，而不是先怀疑自己的改动；确认后**原地改断言**（不新增，保持断言数不变，避免连带上游文档里「94 断言」这类计数），并在注释里写清「**变的是库里真的多了一行，口径未变**」。
- **`hva.js` 的静态断言 `!db\.prepare\(` 是假阴性**：该文件多处是 `db\n    .prepare(...)`（换行断链），朴素正则匹配不到，于是「不直接写库」这条**漏检**了既有的裸 SELECT。自己新增同类断言时用 `db\s*\.\s*prepare\s*\(`；也提醒：**「无命中」要先排除是不是正则写法问题**。
- **新功能点要复用同目录既有件时，先查会不会成环**：`hva.js`（F-04）需要 `followup.js`（F-05）的 `nextResearchNo`，但 `followup.js` 已 `import` `hva.js` 的 `resolveHvaToolPermissions` → 反向引用即**循环依赖**。做法：把共用件**下沉到两者都依赖的骨架件**（本项目 `step-plan.js`），由原持有者**再导出**（`export { x } from "./y.js"`）以保持既有调用面零改动。
- **「建行缺位」型缺陷的定位手法（可复用）**：怀疑某张表在生产恒零行时，① 全仓 grep 该表的建行函数**调用点**（不是定义点）——只有测试与 HTTP 路由调用＝生产链路无人建行；② 查**服务功能点归属**：锁定文件（`schema.md`）里该表**字段级**的「服务功能点」列 + 口径列（如 `created_at`「＝建议提交时刻」）往往能**唯一确定**该由哪个功能点建行，比表头概览句更权威；③ 从前端用例的**写请求白名单**反证「不是前端该建的」。
- **线上实测不要靠猜日志，用「读面回查三件套」定事实**（F-33 线上验收范式）：`GET /api/tasks/{task_id}`（任务态 + **`done_part` 全量**——它逐段累积了每步自述，是执行体行为的原始凭证）、`GET /api/task-blocks?task_id=`（`PD-03` 受阻记录，含 `block_reason_code` 与文案）、`GET /api/query-records?task_id=`（`EXT-01` 逐条，含 `fail_reason`）——三者一读，「哪一步真跑了、跑了哪几个源、受阻是谁写的」立刻分明。再配 `GET /api/tools`（看启用面，**字段名是 `is_enabled` 不是 `enabled`**）、`GET /api/research`（MD-07 壳）。**连通姿势**：本机浏览器直开打不开线上域名，但 `curl --noproxy '*' --resolve <host>:443:<真实IP> https://<host>/api/...` 可直连；**任务没有列表路由**，按 `T-00NN` 逐号探（404 即跳过）。**验证「部署是否真的生效」看时间戳**：本次 `deploy` 完成于 15:26，而 T-0026 / T-0029 的受阻记录落在 15:26 / 15:27——这就直接证明线上行为出自新版本，不必等日志。
- **跨模块消费关系要「两侧都登记」，收尾时把双方清单对读一遍**（2026-09-21 实测）：F-33 引入的 `task-runner → tool-executor` 消费（取 `listQueryRecords`）当时只在 `task-runner/README.md` 写了自己「复用谁」，**忘了去 `tool-executor/README.md` 的反向清单补一行**——直到 F-34 又新增一处消费（取 `DEFAULT_TIMEOUT_MS`）才暴露。做法：**新增跨模块 import 后立刻去对面 README 反向清单加行**；收尾自检把双方清单对读（本次已把 `../task-runner` 补进 `tool-executor/README.md` 反向清单，并注明「只取只读面与常量、跨模块写面为零」）。
