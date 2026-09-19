// 探针 Worker：仅用于 T-14 会话复用性实测，不属于业务代码
// 路由：
//   GET /pragma      → 返回本连接 PRAGMA foreign_keys 值
//   GET /violate     → 违规插入 child（期望报 FOREIGN KEY constraint failed）
//   GET /off-insert  → 同一 batch 内 PRAGMA OFF + 违规插入（验证开关是否可控）
//   GET /rows        → 返回 child 表当前行
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    try {
      if (path === "/pragma") {
        const r = await env.DB.prepare("PRAGMA foreign_keys;").all();
        return Response.json({ ok: true, path, results: r.results });
      }
      if (path === "/violate") {
        try {
          await env.DB.prepare("INSERT INTO child (cid, pid) VALUES (?, ?)")
            .bind("c-w-" + Date.now(), "p-does-not-exist").run();
          return Response.json({ ok: true, path, inserted: true });
        } catch (e) {
          return Response.json({ ok: false, path, error: String((e && e.message) || e) });
        }
      }
      if (path === "/off-insert") {
        try {
          const r = await env.DB.batch([
            env.DB.prepare("PRAGMA foreign_keys=OFF;"),
            env.DB.prepare("INSERT INTO child (cid, pid) VALUES (?, ?)")
              .bind("c-batch-" + Date.now(), "p-does-not-exist")
          ]);
          return Response.json({ ok: true, path, batch: r });
        } catch (e) {
          return Response.json({ ok: false, path, error: String((e && e.message) || e) });
        }
      }
      if (path === "/toggle") {
        // 同 batch 内先 OFF 再读，确认 PRAGMA 是否真的作用于连接
        const r = await env.DB.batch([
          env.DB.prepare("PRAGMA foreign_keys=OFF;"),
          env.DB.prepare("PRAGMA foreign_keys;")
        ]);
        return Response.json({ ok: true, path, batch: r });
      }
      if (path === "/defer-read") {
        // 同 batch：defer on 后读回值
        const r = await env.DB.batch([
          env.DB.prepare("PRAGMA defer_foreign_keys=on;"),
          env.DB.prepare("PRAGMA defer_foreign_keys;")
        ]);
        return Response.json({ ok: true, path, batch: r });
      }
      if (path === "/defer-resolve") {
        // 同 batch：defer on → 先插违规 child → 再补上缺失 parent（事务结束前消解）
        const tag = "d" + Date.now();
        try {
          const r = await env.DB.batch([
            env.DB.prepare("PRAGMA defer_foreign_keys=on;"),
            env.DB.prepare("INSERT INTO child (cid, pid) VALUES (?, ?)").bind("c-" + tag, "p-" + tag),
            env.DB.prepare("INSERT INTO parent (pid) VALUES (?)").bind("p-" + tag)
          ]);
          return Response.json({ ok: true, path, tag, batch: r });
        } catch (e) {
          return Response.json({ ok: false, path, tag, error: String((e && e.message) || e) });
        }
      }
      if (path === "/defer-unresolved") {
        // 同 batch：defer on → 插违规 child → 不消解（事务结束应失败）
        const tag = "u" + Date.now();
        try {
          const r = await env.DB.batch([
            env.DB.prepare("PRAGMA defer_foreign_keys=on;"),
            env.DB.prepare("INSERT INTO child (cid, pid) VALUES (?, ?)").bind("c-" + tag, "p-missing-" + tag)
          ]);
          return Response.json({ ok: true, path, tag, batch: r });
        } catch (e) {
          return Response.json({ ok: false, path, tag, error: String((e && e.message) || e) });
        }
      }
      if (path === "/rows") {
        const r = await env.DB.prepare("SELECT * FROM child;").all();
        return Response.json({ ok: true, path, results: r.results });
      }
      return new Response("routes: /pragma /violate /off-insert /rows");
    } catch (e) {
      return Response.json({ ok: false, error: String((e && e.message) || e) }, { status: 500 });
    }
  }
};
