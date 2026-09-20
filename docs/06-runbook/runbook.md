# docs/06-runbook/ · 运维手册（runbook）

> 阶段0-CI 之后的运维面汇总：环境准备、本地开发两条通道、D1 迁移、回归跑法、探针、部署上线、已知运维事项。只写**已实测/已在用**的命令与事实，不预填未发生的流程。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 上游约束 | `AGENTS.md`（宪法：凭证不落库、白盒纪律、双向引用）｜ `.github/README.md`（CI/CD 流水线与仓库设置项）｜ `wrangler.toml`（Worker 名 `jd-growth-platform`、D1 绑定 `DB`、`[ai]` binding）｜ `docs/04-plan/go-live-checklist.md`（门禁 A/B/C）｜ `docs/03-locks/tech-stack.md`（§3.3 未验证面、§8 TS-10/TS-14）｜ `db/probes/fk/README.md`（远程外键实测） |
| 职责 | 开发/部署/排障的**操作手册**；不承载任何口径定义（口径一律见上游锁定文档，本手册只引用） |
| 硬红线落实 | 凭证只走环境变量、绝不写入任何文件；本手册不包含任何真实 token/account_id 值 |

## 1. 环境准备

| 项 | 值 / 命令 | 注意 |
| ---- | ---- | ---- |
| Node | 用受管版本 `/Users/dongzhuo/.workbuddy/binaries/node/versions/22.22.2-3/bin/node`（下文简写 `node`） | 全局 node 为 24.19.0，勿混用 |
| wrangler | `npx -y wrangler@4.135.0 <cmd>` | **必须带 `-y`**（否则首次下载会卡在交互确认，实测卡 20min+）；无全局安装 |
| 凭证 | `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… npx -y wrangler@…`（env 注入） | 绝不写进任何文件/`wrangler.toml`；`--remote` 命令必需 |
| 代理 | 本机有代理环境变量时 wrangler 会提示 `Proxy environment variables detected` | 正常现象，走代理即可 |

## 2. 本地开发（两条通道）

### 通道 A · 纯 mock（零凭证、零计费，日常默认）

```bash
node prototype/mock/index.js          # 默认 :8788
node prototype/mock/verify.js         # mock 自检（CI 同款）
```

- 数据走 node:sqlite 建的 D1 兼容适配层 + 真实 DDL/种子；**demo 种子数值不进任何断言**（外部依赖门禁纪律）。

### 通道 B · wrangler dev（验真实 Worker + binding）

```bash
npx -y wrangler@4.135.0 d1 migrations apply jd-growth-platform --local --yes   # 先建本地库
npx -y wrangler@4.135.0 dev --local --port 8787
```

- `[ai]` binding 两种跑法（详见 `wrangler.toml` 头注）：a) 带 `CLOUDFLARE_API_TOKEN` 时 AI 走 remote（**本地 dev 亦计费**）；b) 零密钥时临时注释 `[ai]`，编排调用须显式 `opts.mock = true`（输出带 `_mock` 标记、`/api/health` 如实上报 `ai: "mock_mode"`）。**勿把对 `[ai]` 的临时注释提交进 git**。
- 本地 dev 结束后确认 `git status`，发现 `wrangler.toml` 变脏先还原再提交。

## 3. 数据库迁移（D1）

| 动作 | 命令 | 说明 |
| ---- | ---- | ---- |
| 本地应用迁移 | `npx -y wrangler@4.135.0 d1 migrations apply jd-growth-platform --local --yes` | CI `validate` 阶段同款；真实执行、FK 强制 |
| 远程库现状 | `jd-growth-platform`（id `853be8d3-bca2-4683-ab7a-a61725516662`，2026-09-21 实建，region WNAM） | 建库时账号零 D1 库、无生产数据；`database_id` 已入 `wrangler.toml` |
| 远程应用迁移 | `npx -y wrangler@4.135.0 d1 migrations apply jd-growth-platform --remote --yes` | **日常由 CI `deploy` 阶段执行**（push 到 main 时）；手动跑仅用于排障 |

⚠️ **远程 D1 与本地的行为差异（TS-14 实测，2026-09-21，详见 `db/probes/fk/README.md` §5b）**：
- `PRAGMA foreign_keys` 远程同样**恒为强制**（默认 1、`OFF` 无效）；
- **`PRAGMA defer_foreign_keys=ON` 在 `d1 execute` 多语句批次内不放行**（每条语句即隐式事务，无窗口）；
- **SQL 显式 `BEGIN`/`SAVEPOINT` 被平台禁止**（code 7500）。
- **推论：远程迁移/种子必须靠语句排序满足引用完整性**（先父表后子表、先插被引用行），不能依赖 defer 或显式事务。单次 execute 多语句批次呈现原子性（整批成功或整批回滚）。

## 4. 回归跑法

```bash
# server 全量（每模块 test-*.mjs，均基于 node:sqlite 载真实 DDL/种子）
for t in server/**/test-*.mjs; do node "$t" || break; done

# 前端六页面
for t in frontend/test-f2*.mjs; do node "$t" || break; done

# 引用自检（孤儿/悬空/重号三类，要求 0 命中）
node scripts/ref-check.mjs
```

- 断言失败先看**实测值是否已写进断言文案**；async 结果必须 `await` 后再断言（历史坑：Promise `.length` 为 `undefined` 静默假失败）。
- 探针/编排层用例改动了 judge/cases 口径时，`server/probes/model-selection/test-model-selection.mjs` 必须同跑。

## 5. 探针

| 探针 | 位置 | 跑法 |
| ---- | ---- | ---- |
| D1 外键行为 | `db/probes/fk/` | 本地 `wrangler d1 execute --local`；远程见该 README §5b（R1~R6） |
| D1 类型/长度 | `db/probes/type/` | 同上（**仍限 `--local`，线上复测待部署后**） |
| 模型选型 | `server/probes/model-selection/` | `CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node run-rest.mjs raw/<日期>.json [模型键]`；`PROBE_MAX_TOKENS=4096` 可放开输出预算对照；TS-10 已收口，原候选池仅留 Paid 升级后对比复跑 |

## 6. 部署上线（门禁 B，均需人工前置动作）

1. `git remote add origin <远程地址>` → `git push -u origin main`（触发 `.github/workflows/ci.yml`）；
2. GitHub `Settings → Secrets and variables → Actions` 配 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID`（凭证只经 Secrets，绝不入仓）；
3. `Settings → Branches` 对 main 开分支保护（Require PR + 勾选 `validate`、`pr-title-check` 状态检查）——**属仓库设置项，`ci.yml` 管不到**；
4. 流水线：PR → `pr-title-check`（标题须以 `F-xx` / `阶段N` / `chore` / `docs` / `ci` 开头）+ `validate`（迁移本地真实应用 + 入口静态检查 + mock 自检 + F-xx 全部用例）；push main → `deploy`（`--remote` 迁移 + `wrangler deploy`）。

## 7. 已知运维事项

| 事项 | 事实 | 处置 |
| ---- | ---- | ---- |
| Workers AI Free 限流 | Free 计划有每日额度，超限返回 `429` 并附重置时间（UTC+8） | 等重置或切其他 Free 模型；生产高峰限流是 Free 唯一代价（TS-10 收口裁决已接受） |
| wrangler 首次下载 | 不带 `-y` 会卡交互确认 | 一律 `npx -y wrangler@4.135.0` |
| 远程无 SQL 事务 | `BEGIN` 禁用（code 7500） | 批量写靠单次 execute 批次的原子性；跨语句一致性靠排序（§3） |
| demo 种子 | `generate_mock.py` 是种子唯一真源，与已验证 SQL 同步维护 | 外部契约未关项（T-01~T-05）关闭前，外部调用一律 mock，demo 数值不进断言 |

## 上游与反向清单

**上游（我来自哪）**

| 上游 | 内容 |
| ---- | ---- |
| `AGENTS.md` | 宪法红线（凭证不落库、白盒、双向引用） |
| `.github/README.md` | ci.yml 行为与仓库设置项（§6 的流水线细节真源） |
| `docs/03-locks/tech-stack.md` | §3.3 未验证面、§8 TS-10/TS-14 实测结论 |
| `db/probes/fk/README.md` | 本地/远程外键实测（§3 差异真源） |
| `docs/04-plan/go-live-checklist.md` | 门禁 A/B/C（§6 的上线步骤真源） |

**反向（我被谁引用）**

| 引用方 | 状态 |
| ---- | ---- |
| `docs/README.md` 目录表（`06-runbook/` 行） | ✅ 已登记 |
| `AGENTS.md` 索引 `docs/` 行 | ✅ 已登记 |
