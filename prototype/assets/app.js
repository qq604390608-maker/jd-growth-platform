/* ============================================================
   原型共享脚本 · 页面外壳注入 / 交互基建 / 用户动作存储
   上游：../../docs/01-brd/BRD.md（M6 F-27~F-32）
   说明：原型期不接后端，用户动作（提交建议、改状态、发追问）
        存入 localStorage，用于演示幂等、任务状态流转与跨页联动。
   本文件同时承载「跨页同口径」的三件事，各页面一律调这里，不再各写一遍
   （历史上各页各写一遍，曾导致目标解析不一致、任务归属互相打脸）：
     ① 目标解析：U.allGoals / U.goalById / U.currentGoalId
     ② 运行链状态：U.runState —— 决定 F-28 机会列表能否进入
     ③ 未读标记：U.markUnread / U.clearUnread —— 侧栏小绿点
   ============================================================ */

(function () {
  /* href 一律以 prototype/ 根目录为基准书写，运行时按当前页位置补前缀，
     否则从根目录的 index.html 点进子页会解析成 prototype/goal.html（404）。 */
  const NAV = [
    { group: "工作台" },
    { page: "home", fn: "—", name: "总览", href: "index.html" },
    { group: "研究前置" },
    { page: "goal", fn: "F-27", name: "目标配置", href: "pages/goal.html" },
    { page: "opportunities", fn: "F-28", name: "机会列表", href: "pages/opportunities.html" },
    { group: "研究与追问" },
    { page: "propose", fn: "F-29", name: "研究建议提交", href: "pages/propose.html" },
    { page: "result", fn: "F-30", name: "研究结果", href: "pages/result.html" },
    { page: "followup", fn: "F-31", name: "追问对话", href: "pages/followup.html" },
    { group: "运行" },
    { page: "tasks", fn: "F-32", name: "任务与状态", href: "pages/tasks.html" }
  ];

  function rootPrefix() {
    if (document.body.dataset.page === "home") return ".";
    if (/\/$/.test(location.pathname)) return ".";
    return "..";
  }

  /* ---------- 用户动作存储 ----------
     以 file:// 直接打开时，部分浏览器会禁用 localStorage，
     此时降级到内存，并通过 URL 参数保证跨页联动仍然可见。 */
  const KEY = "jd_growth_prototype_store_v2"; // v2：与旧版演示数据隔离，等于一次重置
  let memory = {};
  const storeUsable = (function () {
    try { localStorage.setItem("__px_probe", "1"); localStorage.removeItem("__px_probe"); return true; }
    catch (e) { return false; }
  })();
  if (storeUsable) {
    try { localStorage.removeItem("jd_growth_prototype_store"); } catch (e) {} // 清理 v1 遗留数据
  }
  function loadStore() {
    if (!storeUsable) return memory;
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; }
    catch (e) { return memory; }
  }
  function saveStore(s) {
    memory = s;
    if (!storeUsable) return;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {}
  }
  const Store = {
    available: storeUsable,
    get: function (k, fallback) {
      const s = loadStore();
      return s[k] === undefined ? fallback : s[k];
    },
    set: function (k, v) { const s = loadStore(); s[k] = v; saveStore(s); },
    reset: function () {
      memory = {};
      try { localStorage.removeItem(KEY); } catch (e) {}
    }
  };

  /* ---------- 小工具 ---------- */
  const esc = function (s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  const STATUS = {
    candidate: { cls: "badge-candidate", text: "候选" },
    deferred: { cls: "badge-deferred", text: "暂不研究" },
    submitted: { cls: "badge-submitted", text: "已提交研究" },
    running: { cls: "badge-running", text: "运行中" },
    blocked: { cls: "badge-blocked", text: "受阻" },
    stopped: { cls: "badge-stopped", text: "已停止" },
    done: { cls: "badge-done", text: "已完成" }
  };
  function badge(status) {
    const s = STATUS[status] || { cls: "badge-neutral", text: status };
    return '<span class="badge ' + s.cls + '"><span class="badge-dot"></span>' + s.text + "</span>";
  }
  function qs(name) {
    const m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function tabs(scope) {
    scope.querySelectorAll("[data-tabs]").forEach(function (bar) {
      bar.querySelectorAll(".tab").forEach(function (t) {
        t.addEventListener("click", function () {
          bar.querySelectorAll(".tab").forEach(function (x) { x.classList.remove("active"); });
          t.classList.add("active");
          const panels = scope.querySelectorAll('[data-panel-group="' + bar.dataset.tabs + '"] .tab-panel');
          panels.forEach(function (p) { p.classList.remove("active"); });
          const target = scope.querySelector("#" + t.dataset.target);
          if (target) target.classList.add("active");
        });
      });
    });
  }

  /* ============================================================
     ① 目标解析（跨页唯一入口）
     优先级：URL 的 goal 参数 → 本机 applied 记录 → DB.applied → 默认目标。
     候选集合含本机新建目标（newGoals），否则新建目标「应用配置」后
     各页会静默回退到默认目标。
     ============================================================ */
  function db() { return window.DB || {}; }
  function allGoals() {
    const d = db();
    const list = (d.goals && d.goals.list) || [];
    const mine = Store.get("newGoals", []);
    return list.concat(Array.isArray(mine) ? mine : []);
  }
  function goalById(id) {
    const d = db();
    const hit = allGoals().filter(function (g) { return g.id === id; })[0];
    return hit || (d.goals && d.goals.current) || null;
  }
  function currentGoalId() {
    const d = db();
    const s = Store.get("applied", null);
    const fallback = (d.goals && d.goals.current && d.goals.current.id) || "";
    const gid = qs("goal") || (s && s.goalId) || (d.applied && d.applied.goalId) || fallback;
    const known = allGoals().some(function (g) { return g.id === gid; });
    return known ? gid : fallback;
  }
  function currentGoal() { return goalById(currentGoalId()); }
  /* 六要素与版本：本机改过的（goalFields / goalVer）优先于 mock 原始值。
     总览、目标配置、机会列表、任务与状态四页读同一份，过去各页各写一遍曾出现版本对不上。 */
  function goalFields(goalId) {
    const over = Store.get("goalFields", {}) || {};
    const g = goalById(goalId) || {};
    return over[goalId] || g.fields || {};
  }
  function goalVersion(goalId) {
    const over = Store.get("goalVer", {}) || {};
    const g = goalById(goalId) || {};
    return over[goalId] || g.version || "";
  }

  /* 某目标下的全部任务：本机新建任务 + mock 任务。
     归属只认任务自身的 goal 字段（data.js 的 mock 任务已补该字段；
     运行期新建任务由各页在创建时写入，不得再靠"当前目标"兜底）。
     兜底顺序：goal 字段 → 从 ref 里认目标 ID（ref 形如「GOAL-2026Q2-01 · 六要素」）。
     不做「兜底到当前目标」——那正是跨目标操作时任务归属串掉的成因。 */
  function taskGoalId(t) {
    if (t.goal) return t.goal;
    const m = /GOAL-[A-Za-z0-9-]+/.exec(t.ref || "");
    return m ? m[0] : "";
  }
  function goalTasks(goalId) {
    const d = db();
    const extra = Store.get("newTasks", []) || [];
    return extra.concat(d.tasks || []).filter(function (t) { return taskGoalId(t) === goalId; });
  }
  function goalOpps(goalId) {
    return (db().opportunities || []).filter(function (o) {
      return (o.target || "").indexOf(goalId) === 0;
    });
  }
  function goalStudies(goalId) {
    const d = db();
    const own = {};
    (d.opportunities || []).forEach(function (o) {
      if (o.studyId) own[o.studyId] = (o.target || "").split(" · ")[0];
    });
    return Object.keys(d.studies || {})
      .map(function (k) { return d.studies[k]; })
      .filter(function (s) { return own[s.id] === goalId; });
  }

  /* ============================================================
     ② 运行链状态：先后运行关系
     目标配置（保存六要素）→ 应用配置＝执行一次机会发现 → 才有机会可言。
     state：
       "no-run"    已配置但从未跑过机会发现，且无历史产出 → 机会列表不可进入
       "queued"    机会发现正在运行 → 可进入，页面标注运行中
       "has-data"  已有历史产出（或跑完过）→ 可进入
     ============================================================ */
  function runState(goalId) {
    const gid = goalId || currentGoalId();
    const opps = goalOpps(gid);
    const disc = goalTasks(gid).filter(function (t) { return t.type === "机会发现"; });
    const running = disc.filter(function (t) { return t.status === "running"; });
    const hasRun = disc.length > 0;
    const hasData = opps.length > 0;
    const lastDone = disc.filter(function (t) { return t.status === "done"; })[0] || null;
    return {
      goalId: gid,
      state: (!hasRun && !hasData) ? "no-run" : (running.length ? "queued" : "has-data"),
      hasRun: hasRun, hasData: hasData,
      running: running, runningCount: running.length,
      oppCount: opps.length,
      lastRun: disc[0] || null, lastDone: lastDone
    };
  }

  /* 各页入口的前置条件（门禁）。目前只有 F-28 需要硬门禁：
     机会列表没有机会可谈，就不该让人进去看一片空白。 */
  function gateOf(page, goalId) {
    if (page === "opportunities") {
      const rs = runState(goalId);
      if (rs.state === "no-run") {
        return {
          locked: true, state: rs.state, rs: rs,
          reason: "该目标配置尚未执行过机会发现，机会列表暂不可进入",
          how: "到目标配置页选中该套配置，点「应用配置」执行一次机会发现。"
        };
      }
      return { locked: false, state: rs.state, rs: rs, reason: "", how: "" };
    }
    return { locked: false, state: "", rs: null, reason: "", how: "" };
  }

  /* ============================================================
     ③ 未读更新标记（侧栏小绿点）
     语义：自上次查看以来，该页面所属的数据源有新产出。
     打点：运行动作产生新任务/新产出时（各页在自己的动作里调 markUnread）
     清除：点击侧栏对应项
     按目标分别记账，切目标不会串。
     ============================================================ */
  function unreadMap() {
    const m = Store.get("navUnread", {});
    return (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
  }
  function unreadOf(page, goalId) {
    const g = unreadMap()[goalId || currentGoalId()] || {};
    return g[page] || 0;
  }
  /* goalId 可显式传入：像「应用配置」这种刚改了 applied 的动作，
     必须按它自己操作的那套目标记账，不能靠当前解析再猜一次。 */
  function markUnread(page, n, goalId) {
    if (!page) return;
    const m = unreadMap();
    const gid = goalId || currentGoalId();
    const g = m[gid] || {};
    g[page] = (g[page] || 0) + (n || 1);
    m[gid] = g;
    Store.set("navUnread", m);
    renderNav();
  }
  function clearUnread(page, goalId) {
    const m = unreadMap();
    const gid = goalId || currentGoalId();
    if (m[gid] && m[gid][page]) {
      delete m[gid][page];
      Store.set("navUnread", m);
      renderNav();
    }
  }

  /* ---------- 侧栏外壳 ---------- */
  let asideEl = null;
  let currentPage = "";
  let basePrefix = ".";

  function buildChrome() {
    const main = document.querySelector("main.content");
    if (!main) return;
    currentPage = document.body.dataset.page || "";
    basePrefix = rootPrefix();

    const header = document.createElement("header");
    header.className = "topbar";
    header.innerHTML =
      '<div class="brand"><a href="' + basePrefix + '/index.html" style="display:flex;align-items:center;gap:10px;color:inherit">' +
        '<div class="brand-mark">JD</div>' +
        '<div><span class="brand-text">用户增长机会挖掘平台</span>' +
        '<span class="brand-sub">京东超市 · 运营端</span></div></a>' +
      "</div>" +
      '<div class="topbar-right">' +
        '<span class="sys-status"><span class="dot"></span>系统状态：正常运行</span>' +
        '<div class="user-chip"><span class="avatar">PM</span>产品经理</div>' +
      "</div>";

    const shell = document.createElement("div");
    shell.className = "shell";
    asideEl = document.createElement("aside");
    asideEl.className = "sidebar";

    main.parentNode.insertBefore(header, main);
    main.parentNode.insertBefore(shell, main);
    shell.appendChild(asideEl);
    shell.appendChild(main);

    renderNav();
  }

  function renderNav() {
    if (!asideEl) return;
    asideEl.innerHTML = NAV.map(function (n) {
      if (n.group) return '<div class="nav-group">' + n.group + "</div>";
      const active = n.page === currentPage ? " active" : "";
      const gate = gateOf(n.page);
      const n1 = unreadOf(n.page);
      let tip = "";
      if (gate.locked) tip = gate.reason + "。" + gate.how;
      else if (n1) tip = "有 " + n1 + " 处更新未查看";
      return '<a class="nav-item' + active + (gate.locked ? " is-locked" : "") +
        '" data-nav="' + n.page + '"' + (tip ? ' title="' + esc(tip) + '"' : "") +
        (gate.locked ? ' aria-disabled="true"' : "") +
        ' href="' + basePrefix + "/" + n.href + '">' +
        '<span class="fn">' + n.fn + "</span>" + n.name +
        (gate.locked ? '<span class="nav-lock">未运行</span>' : "") +
        (n1 ? '<span class="nav-dot"></span>' : "") +
        "</a>";
    }).join("");

    asideEl.querySelectorAll("[data-nav]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        if (a.classList.contains("is-locked")) { e.preventDefault(); return; }
        clearUnread(a.dataset.nav);
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    buildChrome();
    tabs(document);
    if (typeof window.pageInit === "function") {
      window.pageInit(DB, {
        esc: esc, badge: badge, qs: qs, Store: Store,
        allGoals: allGoals, goalById: goalById, currentGoal: currentGoal, currentGoalId: currentGoalId,
        goalFields: goalFields, goalVersion: goalVersion,
        goalTasks: goalTasks, goalOpps: goalOpps, goalStudies: goalStudies,
        runState: runState, gateOf: gateOf,
        markUnread: markUnread, clearUnread: clearUnread, unreadOf: unreadOf,
        renderNav: renderNav
      });
    }
  });

  window.PX = {
    esc: esc, badge: badge, qs: qs, Store: Store, tabs: tabs, renderNav: renderNav,
    allGoals: allGoals, goalById: goalById, currentGoal: currentGoal, currentGoalId: currentGoalId,
    goalFields: goalFields, goalVersion: goalVersion,
    goalTasks: goalTasks, goalOpps: goalOpps, goalStudies: goalStudies,
    runState: runState, gateOf: gateOf,
    markUnread: markUnread, clearUnread: clearUnread, unreadOf: unreadOf
  };
})();
