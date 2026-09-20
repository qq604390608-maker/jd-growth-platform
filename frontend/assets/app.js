/* ============================================================
   前端共享逻辑 · 页面外壳注入 / 跨页同口径 / 会话态
   文档卡：上游 ../../AGENTS.md（宪法：白盒原则｜一条硬红线｜索引三层）
        ｜ ../../docs/01-brd/BRD.md（M6 F-27~F-32）
        ｜ ../../docs/02-prd/PRD-M6-运营端工作台.md（§1 本模块只做展示与人工操作入口，不含业务逻辑）
        ｜ ../../docs/03-locks/tech-stack.md（§2.1 前端：零构建静态资源；**数据来源＝server/api
           的 HTTP 接口**，把原型 assets/data.js 的读取处换成 fetch；**原型的 mock 数据不复制进前端**；
           共享逻辑沿用原型 assets/app.js 的分工；**会话态不入库、不入后端**）
        ｜ ../../docs/05-test-cases/test-M6.md（TC-C-M6-001 / TC-D-M6-001 / TC-I-M6-007）
        ｜ ../README.md ｜ ./api.js（**全站唯一数据出口**）｜ ../../prototype/assets/app.js（分工来源，不改）
   职责：把原型 assets/app.js 的「跨页同口径三件事」原样搬到前端，数据来源由 `window.DB`
       （原型 mock，**不复制**）换成 `window.API`（真实接口，异步）：
         ① 目标解析：U.allGoals / U.goalById / U.currentGoalId
         ② 运行链状态：U.runState —— 决定 F-28 机会列表能否进入
         ③ 未读标记：U.markUnread / U.clearUnread —— 侧栏小绿点
       另持两份**只读口径**（不复制第二份）：
         · U.SIX_FIELDS —— 六要素键与中文标签；**键＝服务端 `server/task-runner/goal.js#GOAL_FIELDS`**
           （`test-f27.mjs` 逐条对齐断言，改一处漏另一处立刻红）。
         · U.STATUS —— 状态徽标文案（与原型同一份口径）。
   硬约定（可静态核对）：本文件**不发任何请求**，一律经 `./api.js`；**不出现绝对地址与凭证**；
       业务数据**不写 localStorage**（只有会话态：当前浏览目标 / 未读标记）。
   反向清单：被 ../index.html（前端外壳）与 ../pages/goal.html（F-27）及后续 F-28~F-32 各页经
       <script src> 加载；对外只暴露 `window.U`（页面用）与 `window.PX`（兼容原型命名）。
   ============================================================ */

(function () {
  "use strict";

  /* ---------- 导航（六页面；与 ../../prototype/assets/app.js 同一清单、同一顺序） ---------- */
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
    { page: "tasks", fn: "F-32", name: "任务与状态", href: "pages/tasks.html" },
  ];

  /** 六要素：**键取自服务端口径**（`GOAL_FIELDS`），此处只加展示序号与中文标签。
   *  序号与标签沿用原型 `../../prototype/pages/goal.html` 的写法（钉死需求）。 */
  const SIX_FIELDS = [
    { no: "①", key: "business_goal", label: "业务目标", multiline: false },
    { no: "②", key: "metric_definition", label: "指标口径", multiline: true },
    { no: "③", key: "business_scope", label: "业务范围", multiline: false },
    { no: "④", key: "focus_period", label: "关注时段", multiline: false },
    { no: "⑤", key: "known_constraints", label: "已知约束", multiline: true },
    { no: "⑥", key: "provider", label: "提供方与材料", multiline: false },
  ];
  const SIX_KEYS = SIX_FIELDS.map(function (f) { return f.key; });

  /** 空六要素（值全为空串）：`MD-02` 六列皆 NOT NULL，**留空即产生口径待补项**（不替业务方定指标）。 */
  function blankFields() {
    const o = {};
    SIX_KEYS.forEach(function (k) { o[k] = ""; });
    return o;
  }

  const STATUS = {
    candidate: { cls: "badge-candidate", text: "候选" },
    deferred: { cls: "badge-deferred", text: "暂不研究" },
    submitted: { cls: "badge-submitted", text: "已提交研究" },
    running: { cls: "badge-running", text: "运行中" },
    blocked: { cls: "badge-blocked", text: "受阻" },
    stopped: { cls: "badge-stopped", text: "已停止" },
    done: { cls: "badge-done", text: "已完成" },
  };

  /* 操作人：落库留痕用的业务字段（`created_by` / `filled_by`）。
     正式的身份与鉴权（登录、同源以外的跨域鉴权）归 tech-stack §8 TS-15；
     当前前端以固定操作人标识填报，**不经手任何凭证**（无 token / 无密钥）。 */
  const OPERATOR = "产品经理 · PM";

  /* ---------- 会话态存储（**只放会话态**：当前浏览目标 / 未读标记）
     业务数据一律来自 server/api，不在前端持久化（tech-stack §2.1）。 ---------- */
  const KEY = "jd_growth_frontend_session_v1";
  let memory = {};
  const storeUsable = (function () {
    try { localStorage.setItem("__fe_probe", "1"); localStorage.removeItem("__fe_probe"); return true; }
    catch (e) { return false; }
  })();
  function loadStore() {
    if (!storeUsable) return memory;
    try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return memory; }
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
    reset: function () { memory = {}; try { localStorage.removeItem(KEY); } catch (e) {} },
  };

  /* ---------- 小工具 ---------- */
  const esc = function (s) {
    return String(s === undefined || s === null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  };
  function badge(status) {
    const s = STATUS[status] || { cls: "badge-neutral", text: status };
    return '<span class="badge ' + s.cls + '"><span class="badge-dot"></span>' + esc(s.text) + "</span>";
  }
  function qs(name) {
    const m = new RegExp("[?&]" + name + "=([^&]*)").exec(location.search);
    return m ? decodeURIComponent(m[1]) : null;
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }
  function nowStr() {
    const d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
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
     数据门面：目标列表 / 目标一页读取（异步，**只经 window.API**）
     ============================================================ */
  const cache = { goals: null, records: {} };

  async function loadGoals(force) {
    if (!force && cache.goals) return cache.goals;
    const res = await window.API.listGoals();
    cache.goals = (res && res.items) || [];
    return cache.goals;
  }
  async function loadGoalRecord(goalId, force) {
    if (!force && cache.records[goalId]) return cache.records[goalId];
    const rec = await window.API.getGoalRecord(goalId);
    cache.records[goalId] = rec;
    return rec;
  }
  function allGoals() { return (cache.goals || []).slice(); }
  function goalById(id) {
    const hit = allGoals().filter(function (g) { return g.goal_id === id; })[0];
    if (hit) return hit;
    const rec = cache.records[id];
    return rec ? rec.goal : null;
  }
  function recordOf(goalId) { return cache.records[goalId] || null; }

  /* 当前目标：URL 的 goal 参数 → 会话里「应用配置」记录 → 列表第一条。
     候选集合＝真实目标列表（服务端真源），**不靠本机新建**（新建目标登记后即在列表里）。 */
  function currentGoalId() {
    const known = allGoals().map(function (g) { return g.goal_id; });
    const applied = Store.get("applied", null);
    const wanted = qs("goal") || (applied && applied.goalId) || "";
    if (wanted && known.indexOf(wanted) !== -1) return wanted;
    return known[0] || "";
  }
  function currentGoal() { return goalById(currentGoalId()); }

  /* 六要素 / 版本：一律读服务端记录（当前版本快照），**不在前端另算一份**。 */
  function goalFields(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    const v = rec && rec.current_version;
    if (!v) return blankFields();
    const o = {};
    SIX_KEYS.forEach(function (k) { o[k] = v[k] === undefined || v[k] === null ? "" : String(v[k]); });
    return o;
  }
  function goalVersion(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    const v = rec && rec.current_version;
    return v ? "v" + v.version_no : "";
  }
  function appliedVersion(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    return (rec && rec.applied_version) || null;
  }
  function versionTimeline(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    return (rec && rec.versions) || [];
  }
  function goalMaterials(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    return (rec && rec.materials) || [];
  }
  function openGaps(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    return (rec && rec.open_gaps) || [];
  }
  function goalTasks(goalId) {
    const rec = recordOf(goalId || currentGoalId());
    return (rec && rec.tasks) || [];
  }

  /* ============================================================
     ② 运行链状态：目标配置（保存六要素）→ 应用配置＝执行一次机会发现 → 才有机会可言。
     state：no-run（已配置但从未跑过且无产出，机会列表不可进入）/ queued / has-data
     真源：目标下的任务（服务端 `task` 行）＋该目标的机会条数；**不在前端另记一份**。
     ============================================================ */
  let oppCountByGoal = {};
  async function loadOpportunityCounts(goalId) {
    const res = await window.API.listOpportunities(goalId);
    const items = (res && res.items) || [];
    oppCountByGoal[goalId] = items.length;
    return items;
  }
  function runState(goalId) {
    const gid = goalId || currentGoalId();
    const tasks = goalTasks(gid);
    const disc = tasks.filter(function (t) { return t.task_type === "discovery"; });
    const running = disc.filter(function (t) { return t.task_status === "running"; });
    const hasRun = disc.length > 0;
    const oppCount = oppCountByGoal[gid];
    const hasData = oppCount === undefined ? hasRun : oppCount > 0;
    return {
      goalId: gid,
      state: (!hasRun && !hasData) ? "no-run" : (running.length ? "queued" : "has-data"),
      hasRun: hasRun,
      hasData: hasData,
      runningCount: running.length,
      oppCount: oppCount === undefined ? null : oppCount,
      lastRun: disc.length ? disc[disc.length - 1] : null,
    };
  }
  /** 各页入口前置条件（门禁）。目前只有 F-28 需要硬门禁：没有机会可谈，就不该进去看空白。 */
  function gateOf(page, goalId) {
    if (page === "opportunities") {
      const rs = runState(goalId);
      if (rs.state === "no-run") {
        return {
          locked: true, state: rs.state, rs: rs,
          reason: "该目标配置尚未执行过机会发现，机会列表暂不可进入",
          how: "到目标配置页选中该套配置，点「应用配置」执行一次机会发现。",
        };
      }
      return { locked: false, state: rs.state, rs: rs, reason: "", how: "" };
    }
    return { locked: false, state: "", rs: null, reason: "", how: "" };
  }

  /* ============================================================
     ③ 未读标记（侧栏小绿点）：按目标分别记账，切目标不串。
     ============================================================ */
  function unreadMap() {
    const m = Store.get("navUnread", {});
    return (m && typeof m === "object" && !Array.isArray(m)) ? m : {};
  }
  function unreadOf(page, goalId) {
    const g = unreadMap()[goalId || currentGoalId()] || {};
    return g[page] || 0;
  }
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

  /* ---------- 侧栏 + 顶栏外壳（与原型同一结构与类名，视觉沿用 base.css） ---------- */
  let asideEl = null;
  let currentPage = "";
  let basePrefix = ".";

  function rootPrefix() {
    if (document.body.dataset.page === "home") return ".";
    if (/\/$/.test(location.pathname)) return ".";
    return "..";
  }

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

  /* ---------- 启动：外壳 → 取数 → 交给页面（pageInit 可为 async） ---------- */
  function noticeBox() {
    let el = document.getElementById("boot-notice");
    if (!el) {
      el = document.createElement("div");
      el.id = "boot-notice";
      const main = document.querySelector("main.content");
      if (main) main.insertBefore(el, main.firstChild);
    }
    return el;
  }
  function showBootError(e) {
    const box = noticeBox();
    const msg = (e && e.message) || String(e);
    box.innerHTML = '<div class="alert alert-info" style="margin-bottom:14px"><div class="flex-1">' +
      '<span class="alert-title">数据加载失败</span>　' + esc(msg) +
      "　（本页所有动态数据均经 server/api 获取；请确认接口可用后刷新）</div></div>";
  }

  const U = {
    SIX_FIELDS: SIX_FIELDS,
    SIX_KEYS: SIX_KEYS,
    STATUS: STATUS,
    OPERATOR: OPERATOR,
    blankFields: blankFields,
    esc: esc, badge: badge, qs: qs, nowStr: nowStr, tabs: tabs, Store: Store,
    loadGoals: loadGoals, loadGoalRecord: loadGoalRecord,
    loadOpportunityCounts: loadOpportunityCounts,
    allGoals: allGoals, goalById: goalById, recordOf: recordOf,
    currentGoal: currentGoal, currentGoalId: currentGoalId,
    goalFields: goalFields, goalVersion: goalVersion, appliedVersion: appliedVersion,
    versionTimeline: versionTimeline, goalMaterials: goalMaterials,
    openGaps: openGaps, goalTasks: goalTasks,
    runState: runState, gateOf: gateOf,
    markUnread: markUnread, clearUnread: clearUnread, unreadOf: unreadOf,
    renderNav: renderNav, showBootError: showBootError, noticeBox: noticeBox,
  };
  window.U = U;
  window.PX = U; // 兼容原型命名，便于对照阅读

  document.addEventListener("DOMContentLoaded", function () {
    buildChrome();
    tabs(document);
    (async function () {
      try {
        await loadGoals();
        const gid = currentGoalId();
        if (gid) {
          await loadGoalRecord(gid);
          await loadOpportunityCounts(gid);
        }
      } catch (e) {
        showBootError(e);
        renderNav();
        return;
      }
      renderNav();
      if (typeof window.pageInit === "function") {
        try { await window.pageInit(U); } catch (e) { showBootError(e); }
      }
    })();
  });
})();
