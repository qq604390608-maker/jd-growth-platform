/* ============================================================
   前端数据出口 · 唯一动态数据通道（frontend 全站只经此文件取数）
   文档卡：上游 ../../AGENTS.md（宪法硬红线：白盒原则｜每份产物双向引用）
        ｜ ../../docs/03-locks/tech-stack.md（§1.2 前后端分离落点：**前端不直连数据库、
           不持有任何外部系统凭证**，所有动态数据经 server/api；§2.1 数据来源＝把原型
           assets/data.js 的读取处换成 fetch，**原型的 mock 数据不复制进前端**）
        ｜ ../../docs/01-brd/BRD.md（§5.3 硬红线）
        ｜ ../../docs/02-prd/PRD-M6-运营端工作台.md（F-27~F-32）
        ｜ ../../docs/05-test-cases/test-M6.md（TC-C-M6-001 / TC-D-M6-001）
        ｜ ../README.md ｜ ../server/api/index.js（路由真源；本文件只按路由拼路径，不自造端点）
  职责：把 server/api 的 HTTP 接口收成一层薄封装——统一 JSON、统一错误映射、**统一同源约束**。
   ① 同源：请求路径一律 `/api/...` 相对路径（同域部署，免 CORS；tech-stack §1.2）。
       **本文件不出现任何绝对地址**（无 scheme / 无 host）——这是
      「前端不直连外部系统、不持凭证」在代码层的可运行判据（见 request() 的守卫）。
   ② 无凭证：不读 cookie/token、不设 Authorization、不读 localStorage 里的任何密钥；
       `credentials` 保持浏览器默认（同源即发送同源 cookie，前端不自行拼装凭证）。
   ③ 无业务逻辑：只做「路径 + 方法 + JSON」，判断逻辑一律在后端（PRD-M6 §1）。
   反向清单：被 ../assets/app.js（外壳与共享口径取数）、../pages/goal.html（F-27）
       与后续 F-28~F-32 各页经 window.API 调用；**前端唯一的网络出口**。
   ============================================================ */

(function () {
  "use strict";

  /** 同源前缀：同域部署下为空串。**不得配置成任何外部域名**（配了即违反 §1.2）。 */
  const BASE = "";

  /**
   * 统一请求。入参 path 必须是 `/api/` 开头的相对路径。
   * 守卫（可运行判据，不是注释）：非 `/api/` 开头、或含 `://`（绝对地址 / 外部系统）
   * 一律**直接抛错、不发请求**——把「前端只经 server/api、不直连外部」做成挡在前面的闸，
   * 而不是靠人记得。
   */
  async function request(method, path, body) {
    if (typeof path !== "string" || path.indexOf("/api/") !== 0) {
      throw new Error(`api：请求路径必须是 /api/ 开头的同源路径，收到「${String(path)}」`);
    }
    if (path.indexOf("://") !== -1) {
      throw new Error(`api：请求路径不得是绝对地址（前端不直连外部系统），收到「${String(path)}」`);
    }
    const init = { method: method, headers: {} };
    if (body !== undefined) {
      init.headers["Content-Type"] = "application/json";
      init.body = JSON.stringify(body);
    }
    const res = await fetch(BASE + path, init);
    let payload = null;
    try { payload = await res.json(); } catch (e) { payload = null; }
    if (!res.ok) {
      const detail = payload && (payload.error || payload.message);
      const err = new Error(detail || `请求失败（${method} ${path} → HTTP ${res.status}）`);
      err.status = res.status;
      err.payload = payload;
      throw err;
    }
    return payload;
  }

  const get = (path) => request("GET", path);
  const post = (path, body) => request("POST", path, body);
  const enc = encodeURIComponent;

  window.API = {
    request: request,

    /* ------------------------------------------------ F-27 目标配置页（M1 F-01 的读面与动作面） */

    /** 目标列表（MD-01）。`server/api` 的 `GET /api/goals`。 */
    listGoals: (status) => get("/api/goals" + (status ? "?status=" + enc(status) : "")),

    /** 目标一页读取（身份 + 当前版本 + 生效版本 + 版本历史 + 材料 + 未补待补项 + 任务）。 */
    getGoalRecord: (goalId) => get("/api/goals/" + enc(goalId)),

    /** 登记新目标（MD-01 + v1 快照）：`created_by` 与六要素全键必填（值为空串合法）。 */
    registerGoal: (payload) => post("/api/goals", payload),

    /** 保存六要素为**新版本**（不触碰历史版本；`change_note` 必填、`impact_note` 记影响范围）。 */
    saveGoalVersion: (goalId, payload) => post(`/api/goals/${enc(goalId)}/versions`, payload),

    /** 应用配置：使指定版本生效（同目标至多一行 `is_applied=1`）。 */
    applyGoalVersion: (goalId, payload) => post(`/api/goals/${enc(goalId)}/apply`, payload),

    /** 执行一次口径检查任务（按 CFG-05 规则校验六要素 → 产出 PD-04 待补项）。 */
    runGoalCheck: (goalId, payload) => post(`/api/goals/${enc(goalId)}/check`, payload),

    /** 待补项回查（PD-04）。 */
    listGoalGaps: (goalId, unsolvedOnly) =>
      get(
        `/api/goal-gaps?goal_id=${enc(goalId)}` + (unsolvedOnly ? "&unsolved=1" : "")
      ),

    /** 补充待补项：并入对应六要素字段并形成目标新版本。 */
    fillGoalGap: (gapId, payload) => post(`/api/goal-gaps/${enc(gapId)}/fill`, payload),

    /* ------------------------------------------------ F-02 机会发现（「应用配置」的衔接动作；M1） */

    /** 到点／手动创建一次机会发现任务（F-02）。 */
    createDiscoveryTask: (payload) => post("/api/discovery-tasks", payload),

    /* ------------------------------------------------ 机会（F-27 运行链状态只读；F-28 起为主要消费方） */

    /** 机会列表（可按目标过滤）。 */
    listOpportunities: (goalId, status) =>
      get(
        "/api/opportunities?goal_id=" + enc(goalId) +
        (status ? "&status=" + enc(status) : "")
      ),
  };
})();
