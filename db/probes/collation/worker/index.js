// 探针 Worker：仅用于 T-12 实测（中文默认排序对枚举展示顺序的影响），不属于业务代码
// 上游：../../../docs/03-locks/tech-stack.md §3.2 / §8 T-12；../../../docs/03-locks/schema.md §9
// 路由：
//   GET /order    → ORDER BY 各种写法（默认 / DESC / BINARY / NOCASE / order_no）
//   GET /like     → LIKE 行为（中文子串、ASCII 大小写、_ 通配、括号与斜杠）
//   GET /glob     → GLOB 行为（区分大小写、? 通配、括号与斜杠）
//   GET /in       → IN 行为（精确匹配、尾空格、ASCII 大小写）
//   GET /bytes    → 各取值的 UTF-8 十六进制与码点，作为字节序证据
//   GET /byorder  → 仅 ORDER BY order_no（"字典表排序列"方案）
//   GET /all      → 依次汇总以上
const ROWS_SQL = "SELECT item_code, item_name, order_no FROM probe_collation ORDER BY order_no";

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    const DB = env.DB;
    const names = async (sql) =>
      (await DB.prepare(sql).all()).results.map((r) => r.item_name);

    try {
      if (path === "/order") {
        return Response.json({
          ok: true,
          path,
          note: "数组顺序即 SQL 返回顺序，原样转录",
          "默认 ORDER BY item_name": await names(
            "SELECT item_name FROM probe_collation ORDER BY item_name"
          ),
          "ORDER BY item_name DESC": await names(
            "SELECT item_name FROM probe_collation ORDER BY item_name DESC"
          ),
          "ORDER BY item_name COLLATE BINARY": await names(
            "SELECT item_name FROM probe_collation ORDER BY item_name COLLATE BINARY"
          ),
          "ORDER BY item_name COLLATE NOCASE": await names(
            "SELECT item_name FROM probe_collation ORDER BY item_name COLLATE NOCASE"
          ),
          "ORDER BY order_no（对照：人为展示序）": await names(
            "SELECT item_name FROM probe_collation ORDER BY order_no"
          ),
        });
      }

      if (path === "/like") {
        return Response.json({
          ok: true,
          path,
          note: "命中集合按 order_no 稳定排序后返回",
          "LIKE '%中%'": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '%中%' ORDER BY order_no"
          ),
          "LIKE '%研究%'": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '%研究%' ORDER BY order_no"
          ),
          "LIKE '%cdp%'（小写，验证 ASCII 大小写）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '%cdp%' ORDER BY order_no"
          ),
          "LIKE '%CDP%'（原样大写）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '%CDP%' ORDER BY order_no"
          ),
          "LIKE '运_中'（_ 单字符通配）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '运_中' ORDER BY order_no"
          ),
          "LIKE '%/%'（含斜杠）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '%/%' ORDER BY order_no"
          ),
          "LIKE '%（%'（含中文左括号）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '%（%' ORDER BY order_no"
          ),
          "LIKE '运行中'（精确）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '运行中' ORDER BY order_no"
          ),
          "LIKE '运行中 '（多一个尾空格）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name LIKE '运行中 ' ORDER BY order_no"
          ),
        });
      }

      if (path === "/glob") {
        return Response.json({
          ok: true,
          path,
          note: "GLOB 区分大小写；* 多字符，? 单字符；命中集合按 order_no 稳定排序",
          "GLOB '*中*'": await names(
            "SELECT item_name FROM probe_collation WHERE item_name GLOB '*中*' ORDER BY order_no"
          ),
          "GLOB '*cdp*'（小写）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name GLOB '*cdp*' ORDER BY order_no"
          ),
          "GLOB '*CDP*'（原样大写）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name GLOB '*CDP*' ORDER BY order_no"
          ),
          "GLOB '运?中'（? 单字符通配）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name GLOB '运?中' ORDER BY order_no"
          ),
          "GLOB '*/*'（含斜杠）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name GLOB '*/*' ORDER BY order_no"
          ),
          "GLOB '*（*'（含中文左括号）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name GLOB '*（*' ORDER BY order_no"
          ),
        });
      }

      if (path === "/in") {
        return Response.json({
          ok: true,
          path,
          note: "IN 为精确匹配；命中集合按 order_no 稳定排序",
          "IN ('运行中','黄金眼','不存在')": await names(
            "SELECT item_name FROM probe_collation WHERE item_name IN ('运行中','黄金眼','不存在') ORDER BY order_no"
          ),
          "IN ('运行中 ')（尾空格）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name IN ('运行中 ') ORDER BY order_no"
          ),
          "IN ('cdp 用户标签系统')（小写）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name IN ('cdp 用户标签系统') ORDER BY order_no"
          ),
          "IN ('CDP 用户标签系统')（原样）": await names(
            "SELECT item_name FROM probe_collation WHERE item_name IN ('CDP 用户标签系统') ORDER BY order_no"
          ),
          "IN ('已停止','智能体','HVA 研究 · 追问')": await names(
            "SELECT item_name FROM probe_collation WHERE item_name IN ('已停止','智能体','HVA 研究 · 追问') ORDER BY order_no"
          ),
        });
      }

      if (path === "/bytes") {
        const r = await DB.prepare(
          "SELECT item_code, item_name, order_no, hex(item_name) AS utf8_hex FROM probe_collation ORDER BY order_no"
        ).all();
        return Response.json({ ok: true, path, rows: r.results });
      }

      if (path === "/byorder") {
        const r = await DB.prepare(ROWS_SQL).all();
        return Response.json({ ok: true, path, rows: r.results });
      }

      if (path === "/all") {
        const out = { ok: true, path, groups: {} };
        for (const p of ["order", "like", "glob", "in", "bytes", "byorder"]) {
          out.groups[p] = await (await this.fetch(new Request("http://x" + "/" + p), env)).json();
        }
        return Response.json(out);
      }

      return new Response("routes: /order /like /glob /in /bytes /byorder /all");
    } catch (e) {
      return Response.json({ ok: false, path, error: String((e && e.message) || e) }, { status: 500 });
    }
  },
};
