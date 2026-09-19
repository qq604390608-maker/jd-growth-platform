/**
 * 文档卡（阶段0-工程骨架 → 阶段1 F-07/F-08/F-09/F-10/F-11/F-12 → **阶段2 F-23** 接入 · 2026-09-19）
 * 上游：AGENTS.md（宪法：一条硬红线｜索引三层）｜ docs/03-locks/tech-stack.md（§2.2 服务端 api 模块 / §6 工程结构 / §7.3 部署形态 TS-20 待确认）｜ docs/04-plan/dev-plan.md（阶段0 验收要点；阶段1 · M2 F-07~F-12）｜ docs/03-locks/schema.md（CFG-01 source_registry；EXT-02 evidence / LNK-01 / LNK-02；MD-06 opportunity / PD-05 opportunity_status_log / LNK-03 opportunity_relation；MD-07 research / MD-08 research_finding / EXT-03 external_validation；**CFG-06 context_template / PD-06 context_injection**）｜ docs/07-decisions/ADR-003（六要素必填与未知项二态）｜ docs/07-decisions/ADR-001（背景不做定版快照，以 PD-06 记录为准）｜ ../wrangler.toml（D1 绑定 DB）｜ ../../db/（迁移与种子）｜ ../shared-context/index.js（F-07 业务背景管理 / F-08 来源登记 / F-09 证据管理 / F-10 机会记录 / F-11 研究结果与历史管理 / **F-12 上下文按任务组织注入** 实现）｜ ../tool-executor/index.js（**F-23 工具注册与权限检查** 实现：CFG-02 工具登记 / CFG-03 授权登记 / 调用前权限判定，允许与受限互斥、受限必带原因）｜ docs/03-locks/external-deps.md §5（12 工具 TOL-01~12，TOL-12 为「不存在」）
 * 职责：Worker HTTP 入口（api 模块）。骨架职责＝健康检查 + 只读 D1 探测；**F-07 起**接入 `server/shared-context` 的业务背景库接口（背景条目 MD-04 / 触点清单 MD-05 / 背景简报）；**F-08 起**接入来源登记接口（CFG-01 来源清单/登记/接入能力确认/缺口地图/来源与工具说明）；**F-09 起**接入证据接口（EXT-02 证据登记/回查链路 + LNK-01/LNK-02 证据关联）；**F-10 起**接入机会记录接口（MD-06 机会登记/读模型 + PD-05 状态变更留痕 + LNK-03 机会关系）；**F-11 起**接入研究结果与历史接口（MD-07 研究登记/列表/读模型 + MD-08 发现只读 + EXT-03 外部验证引用登记 + `parent_research_no` 追问链追溯）；**F-12 起**接入上下文注入接口（CFG-06 注入模板登记/列表 + PD-06 按任务装配/初始化/回读，初始化确定性可复现且幂等）；**F-23 起**接入工具注册与权限检查接口（CFG-02 工具登记/列表、CFG-03 授权登记/列表、调用前权限判定与批量判定；判定**不发起任何外部调用**，真实取数归 F-24）。其余 F-xx 的真实接口随后续阶段接入。
 * 硬红线落实（BRD §5.3 / tech-stack §7.2）：只读写**本平台自有 D1**（「共享上下文＝数据库」），**不调任何面向生产环境会改线上数据的接口**；证据一律只新增行、不覆盖；暂不研究的机会**只改状态、不删除**；**追问不覆盖原研究**（MD-07 表注：追问新增行、`parent_research_no` 指向原研究）；外部验证**只登记业务侧结论与来源引用**，平台不执行验证、不计算效果。
 * 反向清单：被 AGENTS.md 索引 server/ 行 / server/README.md 引用；后续 task-runner｜agent-orchestrator｜tool-executor 复用本入口或按 TS-20 拆分。
 *
 * @param {Request} request
 * @param {Env} env 含 D1 binding `DB`（见 wrangler.toml）
 */
import {
  createBusinessContext,
  listBusinessContext,
  createTouchpoint,
  listTouchpoints,
  getBackgroundBriefing,
  registerSource,
  updateSourceCapability,
  listSources,
  getSourceGaps,
  getSourceToolBriefing,
  createEvidence,
  getEvidence,
  listEvidence,
  getEvidenceTrace,
  linkOpportunityEvidence,
  linkFindingEvidence,
  listEvidenceByOpportunity,
  listEvidenceByFinding,
  createOpportunity,
  listOpportunities,
  changeOpportunityStatus,
  linkOpportunityRelation,
  listOpportunityRelations,
  getOpportunityRecord,
  createResearch,
  listResearch,
  listResearchFindings,
  addExternalValidation,
  listExternalValidations,
  getResearchLineage,
  getResearchRecord,
  registerContextTemplate,
  listContextTemplates,
  recordContextInjection,
  listContextInjections,
  buildTaskContext,
  initTaskContext,
  getTaskContext,
} from "../shared-context/index.js";
import {
  registerTool,
  listTools,
  registerPermission,
  listPermissions,
  checkToolPermission,
  checkToolPermissions,
} from "../tool-executor/index.js";

/**
 * 把模块抛出的错误映射为 HTTP 状态：
 * 目标行不存在→404；库级约束冲突（NOT NULL/UNIQUE/FK/CHECK）→409；
 * 应用层校验不通过（缺必填 / 四要素不齐 / 六要素不齐 / 未知项非法 / 自环）→400；其余→500。
 */
function errorResponse(e) {
  const msg = String((e && e.message) || e);
  let status = 500;
  if (/不存在/.test(msg)) status = 404;
  else if (/NOT NULL|UNIQUE|FOREIGN KEY|CHECK|constraint/i.test(msg)) status = 409;
  else if (/必填|四要素不齐|六要素不齐|未知项|自环/.test(msg)) status = 400;
  return Response.json({ error: msg }, { status });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    try {
      // 健康检查：证明 Worker 已加载、可响应
      if (pathname === "/api/health") {
        return Response.json({ status: "ok", ts: new Date().toISOString() });
      }

      // 只读 D1 连通探测：证明 D1 binding 已接通、迁移已应用（无任何写操作）
      if (pathname === "/api/db-ping") {
        try {
          const { results } = await env.DB.prepare("SELECT 1 AS ok").all();
          return Response.json({ d1: "reachable", ok: results[0] && results[0].ok });
        } catch (e) {
          return Response.json({ d1: "error", message: String(e) }, { status: 500 });
        }
      }

      // ---------------- F-07 业务背景管理（M2 共享上下文） ----------------

      // 背景条目：列表 / 新建（MD-04）
      if (pathname === "/api/business-context") {
        if (request.method === "GET") {
          const goal_id = url.searchParams.has("goal_id")
            ? url.searchParams.get("goal_id") || null // 空串＝平台级（goal_id IS NULL）
            : undefined; // 不传＝全部
          return Response.json({ items: await listBusinessContext(env.DB, { goal_id }) });
        }
        if (request.method === "POST") {
          return Response.json(await createBusinessContext(env.DB, await request.json()), { status: 201 });
        }
      }

      // 触点清单：列表 / 新建（MD-05）
      if (pathname === "/api/touchpoints") {
        if (request.method === "GET") {
          const channel = url.searchParams.get("channel") || undefined;
          return Response.json({ items: await listTouchpoints(env.DB, { channel }) });
        }
        if (request.method === "POST") {
          return Response.json(await createTouchpoint(env.DB, await request.json()), { status: 201 });
        }
      }

      // 背景简报：F-07 验收「Agent 查询前可获知能查哪些、该往哪个方向查」
      if (pathname === "/api/background-briefing" && request.method === "GET") {
        const goal_id = url.searchParams.has("goal_id") ? url.searchParams.get("goal_id") || null : null;
        return Response.json(await getBackgroundBriefing(env.DB, { goal_id }));
      }

      // ---------------- F-08 可用来源与工具登记（M2 共享上下文 · CFG-01） ----------------

      // 来源清单：列表 / 登记（CFG-01）
      if (pathname === "/api/sources") {
        if (request.method === "GET") {
          const status = url.searchParams.get("status") || undefined;
          const mcpReadyOnly = url.searchParams.get("mcp_ready") === "1";
          return Response.json({ items: await listSources(env.DB, { status, mcpReadyOnly }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerSource(env.DB, await request.json()), { status: 201 });
        }
      }

      // 接入能力确认（F-08「实际可查内容需通过接入能力确认」）
      if (pathname === "/api/sources/capability" && request.method === "PATCH") {
        return Response.json(await updateSourceCapability(env.DB, await request.json()));
      }

      // 来源缺口地图：F-08 验收「Agent 能知道缺少什么信息」（缺口 is_evidence=false）
      if (pathname === "/api/source-gaps" && request.method === "GET") {
        return Response.json({ gaps: await getSourceGaps(env.DB) });
      }

      // 来源与工具说明：F-08 输入→输出「接入能力 → 来源与工具说明」
      if (pathname === "/api/source-tool-briefing" && request.method === "GET") {
        return Response.json(await getSourceToolBriefing(env.DB));
      }

      // ---------------- F-09 证据管理（M2 共享上下文 · EXT-02 + LNK-01/LNK-02） ----------------

      // 证据：列表（可按来源/查询/机会/发现过滤）/ 登记（EXT-02）
      if (pathname === "/api/evidence") {
        if (request.method === "GET") {
          const opportunity_id = url.searchParams.get("opportunity_id");
          const finding_id = url.searchParams.get("finding_id");
          if (opportunity_id) {
            // 某机会的全部证据关联（新旧依据并存，按 link_kind 区分）
            return Response.json({ items: await listEvidenceByOpportunity(env.DB, opportunity_id) });
          }
          if (finding_id) {
            return Response.json({ items: await listEvidenceByFinding(env.DB, finding_id) });
          }
          const source_id = url.searchParams.get("source_id") || undefined;
          const query_id = url.searchParams.get("query_id") || undefined;
          return Response.json({ items: await listEvidence(env.DB, { source_id, query_id }) });
        }
        if (request.method === "POST") {
          // 四要素不齐 → 400（不可作为有效依据）；query_id/source_id 不存在 → 409（FK）
          return Response.json(await createEvidence(env.DB, await request.json()), { status: 201 });
        }
      }

      // 证据回查链路：证据 → 查询记录 → 来源（F-09「证据链完整可回溯」）
      if (pathname.startsWith("/api/evidence-trace/") && request.method === "GET") {
        const evidence_id = decodeURIComponent(pathname.slice("/api/evidence-trace/".length));
        const trace = await getEvidenceTrace(env.DB, evidence_id);
        if (trace === null) return Response.json({ error: `证据不存在：${evidence_id}` }, { status: 404 });
        return Response.json(trace);
      }

      // 单条证据（原样，EXT-02 自洽副本）
      if (pathname.startsWith("/api/evidence/") && request.method === "GET") {
        const evidence_id = decodeURIComponent(pathname.slice("/api/evidence/".length));
        const ev = await getEvidence(env.DB, evidence_id);
        if (ev === null) return Response.json({ error: `证据不存在：${evidence_id}` }, { status: 404 });
        return Response.json(ev);
      }

      // 证据关联：LNK-01（机会）/ LNK-02（发现）
      if (pathname === "/api/evidence-links/opportunity" && request.method === "POST") {
        return Response.json(await linkOpportunityEvidence(env.DB, await request.json()), { status: 201 });
      }
      if (pathname === "/api/evidence-links/finding" && request.method === "POST") {
        return Response.json(await linkFindingEvidence(env.DB, await request.json()), { status: 201 });
      }

      // ---------------- F-10 机会记录管理（M2 共享上下文 · MD-06 + PD-05 + LNK-03） ----------------

      // 机会：列表（可按目标/状态过滤；`pending_supplement=1` 只看未评估待补）/ 登记（MD-06）
      if (pathname === "/api/opportunities") {
        if (request.method === "GET") {
          const goal_id = url.searchParams.get("goal_id") || undefined;
          const status = url.searchParams.get("status") || undefined;
          const pendingSupplementOnly = url.searchParams.get("pending_supplement") === "1";
          return Response.json({
            items: await listOpportunities(env.DB, { goal_id, status, pendingSupplementOnly }),
          });
        }
        if (request.method === "POST") {
          // 六要素不齐 / unknown_item 纯空白串 → 400（应用层拒）；库级 NOT NULL/CHECK → 409
          return Response.json(await createOpportunity(env.DB, await request.json()), { status: 201 });
        }
      }

      // 机会状态变更（F-10：暂不研究者置 deferred、记录保留；PD-05 逐次留痕）
      if (pathname === "/api/opportunity-status" && request.method === "PATCH") {
        return Response.json(await changeOpportunityStatus(env.DB, await request.json()));
      }

      // 机会关系：列表 / 登记（LNK-03；自环 → 400 应用层拒，复合 UK → 409 库级拒）
      if (pathname === "/api/opportunity-relations") {
        if (request.method === "GET") {
          const opportunity_id = url.searchParams.get("opportunity_id") || undefined;
          return Response.json({ items: await listOpportunityRelations(env.DB, { opportunity_id }) });
        }
        if (request.method === "POST") {
          return Response.json(await linkOpportunityRelation(env.DB, await request.json()), { status: 201 });
        }
      }

      // 机会读模型：本体 + 六要素/二态判定 + 状态链 + 关系 + 证据关联（F-28 列表与详情页的存储读取面）
      if (pathname.startsWith("/api/opportunities/") && request.method === "GET") {
        const opportunity_id = decodeURIComponent(pathname.slice("/api/opportunities/".length));
        const rec = await getOpportunityRecord(env.DB, opportunity_id);
        if (rec === null) return Response.json({ error: `机会不存在：${opportunity_id}` }, { status: 404 });
        return Response.json(rec);
      }

      // ---------------- F-11 研究结果与历史管理（M2 共享上下文 · MD-07 + MD-08 + EXT-03） ----------------

      // 研究：列表（可按机会 / 状态过滤）/ 登记（MD-07）
      if (pathname === "/api/research") {
        if (request.method === "GET") {
          const opportunity_id = url.searchParams.get("opportunity_id") || undefined;
          const research_status = url.searchParams.get("research_status") || undefined;
          return Response.json({ items: await listResearch(env.DB, { opportunity_id, research_status }) });
        }
        if (request.method === "POST") {
          // 必填缺失 → 400（应用层拒）；opportunity_id / parent_research_no 不存在 → 409（库级 FK）
          return Response.json(await createResearch(env.DB, await request.json()), { status: 201 });
        }
      }

      // 追问链追溯： ancestors / descendants / chain_from_root（TC-I-M2-004「历史可回查、避免重复研究」）
      if (pathname.startsWith("/api/research-lineage/") && request.method === "GET") {
        const research_no = decodeURIComponent(pathname.slice("/api/research-lineage/".length));
        const lineage = await getResearchLineage(env.DB, research_no);
        if (lineage === null) return Response.json({ error: `研究不存在：${research_no}` }, { status: 404 });
        return Response.json(lineage);
      }

      // 关键发现：MD-08 **只读**（发现与七要素正文的生成归 F-20/F-21 M4）
      if (pathname.startsWith("/api/research/") && pathname.endsWith("/findings") && request.method === "GET") {
        const research_no = decodeURIComponent(pathname.slice("/api/research/".length, -"/findings".length));
        return Response.json({ items: await listResearchFindings(env.DB, research_no) });
      }

      // 研究读模型：本体 + 关键发现 + 外部验证引用 + 追问链（F-30 研究结果页的存储读取面）
      if (pathname.startsWith("/api/research/") && request.method === "GET") {
        const research_no = decodeURIComponent(pathname.slice("/api/research/".length));
        const rec = await getResearchRecord(env.DB, research_no);
        if (rec === null) return Response.json({ error: `研究不存在：${research_no}` }, { status: 404 });
        return Response.json(rec);
      }

      // 外部验证引用：列表（可按研究过滤）/ 登记（EXT-03；平台只登记结论与来源，不执行验证、不计算效果）
      if (pathname === "/api/external-validations") {
        if (request.method === "GET") {
          const research_no = url.searchParams.get("research_no") || undefined;
          return Response.json({ items: await listExternalValidations(env.DB, { research_no }) });
        }
        if (request.method === "POST") {
          // research_no 不存在 → 409（TC-D-M2-008 库级 FK）
          return Response.json(await addExternalValidation(env.DB, await request.json()), { status: 201 });
        }
      }

      // ---------------- F-12 上下文按任务组织注入（M2 共享上下文 · CFG-06 + PD-06） ----------------

      // 注入模板：列表（可按任务类型过滤）/ 登记（CFG-06；重复 (task_type, context_type_code) → 409）
      if (pathname === "/api/context-templates") {
        if (request.method === "GET") {
          const task_type = url.searchParams.get("task_type") || undefined;
          return Response.json({ items: await listContextTemplates(env.DB, { task_type }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerContextTemplate(env.DB, await request.json()), { status: 201 });
        }
      }

      // 任务上下文**初始化**（写）：按模板装配 + 落 PD-06 注入记录（幂等，重复调用不重复落行）
      if (pathname === "/api/task-context/init" && request.method === "POST") {
        return Response.json(await initTaskContext(env.DB, await request.json()), { status: 201 });
      }

      // 任务上下文**装配 / 回读**（只读）：GET 同一任务两次返回一致（确定性；TC-I-M2-002）
      if (pathname.startsWith("/api/task-context/") && request.method === "GET") {
        const task_id = decodeURIComponent(pathname.slice("/api/task-context/".length));
        const ctx = await getTaskContext(env.DB, task_id);
        return Response.json(ctx);
      }

      // 注入记录：列表（可按任务 / 信息类型过滤）/ 单条登记（PD-06；task_id 不存在 → 409 FK）
      if (pathname === "/api/context-injections") {
        if (request.method === "GET") {
          const task_id = url.searchParams.get("task_id") || undefined;
          const context_type_code = url.searchParams.get("context_type_code") || undefined;
          return Response.json({ items: await listContextInjections(env.DB, { task_id, context_type_code }) });
        }
        if (request.method === "POST") {
          return Response.json(await recordContextInjection(env.DB, await request.json()), { status: 201 });
        }
      }

      // ---------------- F-23 工具注册与权限检查（M5 工具执行程序 · CFG-02 + CFG-03） ----------------

      // 工具注册：列表（可按来源 / 启用状态过滤）/ 登记（CFG-02；重复 tool_id 或 tool_code → 409）
      if (pathname === "/api/tools") {
        if (request.method === "GET") {
          const source_id = url.searchParams.get("source_id") || undefined;
          const is_enabled = url.searchParams.get("is_enabled");
          return Response.json({
            items: await listTools(env.DB, {
              source_id,
              is_enabled: is_enabled === null ? undefined : Number(is_enabled),
            }),
          });
        }
        if (request.method === "POST") {
          return Response.json(await registerTool(env.DB, await request.json()), { status: 201 });
        }
      }

      // 授权记录：列表（可按工具 / 授权对象过滤）/ 登记（CFG-03；tool_id 不存在 → 409 FK）
      if (pathname === "/api/tool-permissions") {
        if (request.method === "GET") {
          const tool_id = url.searchParams.get("tool_id") || undefined;
          const grantee_type = url.searchParams.get("grantee_type") || undefined;
          const grantee_ref = url.searchParams.get("grantee_ref") || undefined;
          return Response.json({ items: await listPermissions(env.DB, { tool_id, grantee_type, grantee_ref }) });
        }
        if (request.method === "POST") {
          return Response.json(await registerPermission(env.DB, await request.json()), { status: 201 });
        }
      }

      // 权限判定（每次调用前先查）：允许 / 受限互斥；受限必带 reason_code + restrict_reason
      if (pathname === "/api/tool-permission/check" && request.method === "POST") {
        return Response.json(await checkToolPermission(env.DB, await request.json()));
      }

      // 批量判定：逐条独立，单条受限不影响其它条（实体级隔离，非整包失败）
      if (pathname === "/api/tool-permission/check-batch" && request.method === "POST") {
        return Response.json(await checkToolPermissions(env.DB, await request.json()));
      }

      return new Response("Not Found", { status: 404 });
    } catch (e) {
      return errorResponse(e);
    }
  },
};
