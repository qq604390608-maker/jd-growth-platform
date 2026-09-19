# .github/ · CI/CD 流水线

> 阶段0-CI（2026-09-19）。本目录承载 GitHub Actions 流水线，是 dev-plan §3 阶段0 验收要点「CI」的落地。

## 文档卡

| 项 | 内容 |
| ---- | ---- |
| 上游约束 | `AGENTS.md`（宪法：硬红线零写、凭证不落库）｜ `docs/04-plan/dev-plan.md`（L70 CI 任务书 / L158 CI/CD 纪律）｜ `docs/03-locks/tech-stack.md`（§1.3 部署形态 / §7.2 凭证落实）｜ `wrangler.toml`（Worker 名 `jd-growth-platform`、D1 绑定 `DB`） |
| 适用范围 | 全仓 CI/CD；每 F-xx 一个 PR 的白盒纪律 |

## 文件清单

| 文件 | 职责 |
| ---- | ---- |
| `workflows/ci.yml` | 主流水线：`pr-title-check`（白盒命名校验）＋ `validate`（D1 迁移本地真实应用 + 入口静态检查 + mock 自检）＋ `deploy`（主干部署 D1 迁移 + Worker） |

## 流水线行为

- **PR（到 main）**：`pr-title-check` 校验标题以 `F-xx` / `阶段N` / `chore` / `docs` / `ci` 开头；`validate` 跑 `wrangler d1 migrations apply --local --yes`（真实执行、FK 强制）、`node --check server/api/index.js`、`node prototype/mock/verify.js`。
- **push（到 main）**：`validate` 通过后 `deploy` 用 Secrets 注入的 `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` 执行 `wrangler d1 migrations apply --remote --yes` 与 `wrangler deploy`。

## 必须手动完成的仓库设置（不在文件内）

- **分支保护**：GitHub 仓库 `Settings → Branches`，对 `main` 开启「Require a pull request before merging」＋「Require status checks to pass」（勾选 `validate` 与 `pr-title-check`）。这是 dev-plan L70「每 F-xx 一个 PR 的分支保护」的技术落实，属仓库配置项，非流水线文件可控。
- **Secrets**：仓库 `Settings → Secrets and variables → Actions`，添加 `CLOUDFLARE_API_TOKEN` 与 `CLOUDFLARE_ACCOUNT_ID`（值来自 Cloudflare 控制台）。凭证绝不写入仓库（BRD §5.3 硬红线）。

## 反向清单（被谁引用）

- `AGENTS.md` 索引 `.github/` 行（状态：✅ 已建 2026-09-19）
- `docs/04-plan/dev-plan.md` L192 下游清单「CI 流水线」
- `server/` 各模块（阶段1~5 实现后由本流水线部署）
- `wrangler.toml`（被 `deploy` 步骤复用其 Worker 名与 D1 绑定）
