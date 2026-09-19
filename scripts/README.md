# scripts/ · 引用自检（孤儿 / 悬空 / 重号）

> 文档卡（chore · 2026-09-19）
> 上游：`../AGENTS.md`（宪法：一条硬红线「每份产物建立双向引用，拒绝孤儿文件」｜编号体系「编号是主键，文件名只是载体」｜索引三层｜目录索引 `scripts/`＝引用自检脚本（孤儿/悬空/重号），**原状态「待建」，本次翻为已建**）
> ｜ `../docs/03-locks/tech-stack.md`（§6 工程结构：`scripts/`＝引用自检脚本（孤儿/悬空/重号），「纯本地脚本，可跑在 CI」；§2 目录名不得改）
> ｜ `../docs/05-test-cases/README.md` 与 `../docs/05-test-cases/00-索引.md`（§4：「可执行断言脚本骨架归 `scripts/tests/`，本步未出」——本目录的 `tests/` 即该骨架的第一份）
> ｜ `../docs/07-decisions/DEC-PACK-001.md` §5.2（悬空引用前例：须登记并上报，不擅自改）
>
> 职责：纯本地静态自检，输出「孤儿 / 悬空 / 重号」三类命中；任一命中非 0 即退出码 1，作为本地交付自检与 CI 的门禁。
> 边界：不验 SQL 可应用（归 `wrangler d1 migrations`）、不验代码可运行（归各 F-xx 的 `test-fxx.mjs`）、不验业务口径（归 `docs/03-locks/schema.md`）。

## 文件清单

| 文件 | 职责 | 状态 |
| ---- | ---- | ---- |
| `ref-check.mjs` | 自检本体。**三类判定口径的唯一可执行定义写在其头部文档卡**，改动须同步本文件 | ✅ 已建 2026-09-19 |
| `ref-check-allowlist.json` | 已知豁免登记（每条须带 `reason` / `registered_at` / `todo`），命中后单列「已登记豁免」，不计入失败 | ✅ 已建 2026-09-19（2 条） |
| `tests/test-ref-check.mjs` | 自检骨架（夹具断言）：证明三类**能抓到**、干净仓库**能放行**、豁免与 `--strict` 生效、退出码正确 | ✅ 已建 2026-09-19（18 断言全绿；含 1 条悬空 / 1 个孤儿 / 1 处重号 / 1 条软偏差的正例夹具与 1 个零命中夹具） |

## 用法

```bash
node scripts/ref-check.mjs                 # 全仓自检（默认根＝仓库根）
node scripts/ref-check.mjs --strict        # 软偏差也计入失败
node scripts/ref-check.mjs --json          # 机器可读输出
node scripts/ref-check.mjs --allowlist x.json --root <dir>
node scripts/tests/test-ref-check.mjs      # 跑自检骨架（夹具，不依赖真实仓库）
```

## 三类判定口径

| 类别 | 判定 | 失败 |
| ---- | ---- | ---- |
| 悬空 dangling | 文本中**带目录层级**的相对路径（Markdown 链接目标或反引号路径），相对本文件目录、相对仓库根都解析不到，**且仓库内不存在同名文件** | 是 |
| 软偏差 imprecise | 解析不到，但仓库内存在同名文件（路径写错但找得到）。默认仅列出，加 `--strict` 才计入失败 | 否（strict 时是） |
| 孤儿 orphan | 受检产物文件名在**其它任何受检文件**正文中均未出现（无人引用、也未登记进任何 README/索引）。README / `AGENTS.md` / CI / 配置类文件不参与判定 | 是 |
| 重号 duplicate | 同一文件内，同一编号在同一**表格块首列**出现 ≥2 次，或在 ≥2 个**列表项起始位**（裸写/加粗，反引号包裹算引用不算登记）。标题复述编号、「索引表一行 + 本体一节」均不算 | 是 |

扫描范围与排除：扩展名 `.md .js .mjs .sql .yml .toml .py .html .css`；排除 `.git` `.wrangler` `node_modules` `.kilo` `.trash` `.workbuddy` 整棵子树，以及 `db/probes/`（行为实测留证产物）与 `scripts/tests/`（含夹具路径字面量，属测试数据）。

## 已知口径 / 实测注意

- **豁免不是销账**：`ref-check-allowlist.json` 的每条都带 `todo`，删条的前提是缺陷真被修掉。沿用本项目「已知缺口先登记、不擅自改」的惯例（`DEC-PACK-001` §5.2 同）。
- **软偏差 20 条**（2026-09-19 实测）多为原型内相对路径的简写（如 `prototype/assets/data.js` 在文档里被简写成不带 prototype 前缀的形式）与 `prototype/mock/README.md` 上游卡的 `../03-locks/...`（应为 `../../docs/03-locks/...`）；不计入失败，**已登记待修，未擅自改**。
- 重号判定**刻意收紧**：本项目普遍在标题与列表里复述编号，宽判会一次报出 68 条误报（实测），故只认「同一表格块首列重复」与「列表项裸写登记重复」两类主键位。

## 反向清单

- `.github/workflows/ci.yml`（validate 步骤：先跑 `tests/test-ref-check.mjs` 再跑 `ref-check.mjs`）
- `../AGENTS.md`（`scripts/` 行状态位：待建 → ✅ 已建，2026-09-19）
- 本地交付自检（每个 PR 提交前跑「孤儿 / 悬空 / 重号 0 命中」）
