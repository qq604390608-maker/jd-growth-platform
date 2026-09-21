/**
 * 文档卡（TS-16 应用层截断 · 2026-09-21）
 * 上游：../../docs/03-locks/tech-stack.md §4「单行 / 字符串上限 2 MB」约束行与 §8 **TS-16 已决**
 *       （2026-09-21 依用户裁决：**应用层截断＋留痕标注**——与 TS-11「应用层校验」同一取向，不引入对象存储 / 分段多行）
 *   ｜ ../../docs/03-locks/schema.md EXT-01 `query_record.result_summary`（真实返回的结果摘要，**不得用模型预期替代**）
 *       与 EXT-02 `evidence.result_summary`（结果原样保留，不拆数值）
 * 职责：D1 单行 2 MB 上限的**存储防护纯函数**——超限截断并在文末追加留痕标注（原字节数 / 上限 / 截断事实），
 *       未超限**原样返回同一字符串**（零改动）。语义边界：
 *   - 只作用于**写入面**（F-25 `saveQueryRecord` 落 EXT-01、F-09 `createEvidence` 落 EXT-02）——
 *     **分析面（编排层）拿到的仍是全量原文**，截断只发生在落库前一刻；
 *   - **不是模型加工**：标注是机械追加的存储事实说明，不改变「真实返回原样透传、禁模型预期替代」红线
 *     （TC-A-M3-002）——红线约束的是内容来源（禁止用模型预期代替真实返回），本函数不生成任何业务结论；
 *   - 上限取 **1,000,000 字节（< 2 MB 行上限）**：为同行其余列（`query_condition` / `fail_reason` 等）留余量；
 *   - 按 **UTF-8 字节**计量（与 D1 行上限口径一致，中文字符 3 字节/字），截断回退到**字符边界**（不产生残缺字节）。
 * 边界：不查库、不写库、零副作用；`null` / 非字符串 / 空串一律原样返回（失败时空串语义归 schema）。
 * 反向清单：被 `./index.js`（F-25 EXT-01 落痕）与 `../shared-context/index.js`（F-09 EXT-02 落库）import；
 *   用例 `./test-ts16.mjs`；登记 `../README.md` 与 `./README.md`、CI `validate` 步骤。
 */

/** `result_summary` 单列存储上限（字节）。取 1 MB：D1 单行 2 MB 上限内为同行其余列留余量。 */
export const SUMMARY_MAX_BYTES = 1_000_000;

const UTF8 = new TextEncoder();

/**
 * 超限截断＋留痕标注；未超限原样返回（同一引用）。
 * @param {string|null|undefined} value 待落库的长文本
 * @param {object} [opts]
 * @param {string} [opts.field="result_summary"] 列名（进标注，便于回查定位）
 * @param {number} [opts.maxBytes=SUMMARY_MAX_BYTES] 字节上限
 * @returns {string|null|undefined} 截断后文本（含文末 `[TRUNCATED …]` 标注）或原值
 */
export function truncateForStorage(value, { field = "result_summary", maxBytes = SUMMARY_MAX_BYTES } = {}) {
  if (typeof value !== "string" || value.length === 0) return value;
  const bytes = UTF8.encode(value).length;
  if (bytes <= maxBytes) return value;
  // 按字节截断后回退到**字符边界**（最多回退 3 字节；fatal 模式下残缺序列会抛错，据此探测）
  const buf = UTF8.encode(value).slice(0, maxBytes);
  const dec = new TextDecoder("utf-8", { fatal: true });
  let cut;
  for (let drop = 0; drop <= 3; drop++) {
    try {
      cut = dec.decode(drop === 0 ? buf : buf.subarray(0, buf.length - drop));
      break;
    } catch {
      // 尾部落在多字节字符中间 → 回退 1 字节重试
    }
  }
  const note =
    `\n[TRUNCATED ${field}] 原文 ${bytes} 字节超单列存储上限 ${maxBytes} 字节，` +
    `已按 tech-stack §8 TS-16（2026-09-21 用户裁决：应用层截断＋留痕标注）在落库前截断；` +
    `真实返回全文以外部系统为准，本列只存前 ${cut ? UTF8.encode(cut).length : 0} 字节。`;
  return cut + note;
}
