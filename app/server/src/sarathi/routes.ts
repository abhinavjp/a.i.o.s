import type { FastifyInstance } from "fastify";
import type { ApprovalLifetime, PermissionRuleDecision, ResolvedRoute, RoutePolicyOverride, RuntimeRouter, ToolIntent } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";
import { isRoutePolicyOverride } from "./RoutePolicy.js";
import type { ProviderCatalogManager } from "./ProviderCatalog.js";
import { isApprovalLifetime, isPermissionRuleDecision, isToolIntent, PermissionEngine } from "./PermissionEngine.js";
import type { RouteResilience } from "./RouteResilience.js";

interface PauseBody {
  paused: boolean;
}

interface SpecialistBody {
  name: string;
  role: string;
  runtime?: string;
}

interface SpecialistParams {
  id: string;
}

interface PolicyParams {
  scope: "global" | "specialist" | "workflow";
  id?: string;
}

interface PermissionRuleBody {
  decision: PermissionRuleDecision;
  tool: string;
  operation: string;
  target: string;
  lifetime: ApprovalLifetime;
  context?: Record<string, string>;
}

interface ApprovalBody {
  intent: ToolIntent;
  lifetime: ApprovalLifetime;
}

export function registerSarathiRoutes(
  app: FastifyInstance,
  store: SarathiStore,
  providerCatalogManager?: ProviderCatalogManager,
  permissionEngine?: PermissionEngine,
  resilience?: RouteResilience,
  runtimeRouter?: RuntimeRouter
): void {
  app.get("/api/sarathi/dashboard", async () => store.snapshot());

  app.get("/api/sarathi/routing/policies", async () => store.snapshot().routing);

  app.get("/api/sarathi/routing/circuits", async () => store.snapshot().routeCircuits);
  app.post<{ Body: { route: ResolvedRoute } }>("/api/sarathi/routing/circuits/probe", async (request, reply) => {
    if (!request.body?.route || !isRoutePolicyOverride({ primary: request.body.route })) {
      reply.code(400); return { error: "provide a valid route to probe" };
    }
    return { recovered: await resilience?.probe(request.body.route, runtimeRouter) ?? false, circuits: store.snapshot().routeCircuits };
  });

  app.get("/api/sarathi/permissions", async () => store.snapshot().permissions);

  app.post<{ Body: PermissionRuleBody }>("/api/sarathi/permissions/rules", async (request, reply) => {
    const body = request.body;
    if (!permissionEngine || !isPermissionRuleBody(body)) {
      reply.code(400);
      return { error: "provide a narrow deny, ask, or allow rule with tool, operation, target, and lifetime" };
    }
    const rule = permissionEngine.saveRule({
      decision: body.decision,
      tool: body.tool.trim(),
      operation: body.operation.trim(),
      target: body.target.trim(),
      lifetime: body.lifetime,
      context: body.context ?? {}
    });
    reply.code(201);
    return { rule };
  });

  app.post<{ Body: ApprovalBody }>("/api/sarathi/permissions/approvals", async (request, reply) => {
    const body = request.body;
    if (!permissionEngine || !isApprovalLifetime(body?.lifetime) || !isToolIntent(body.intent) || !hasApprovalContext(body.intent, body.lifetime)) {
      reply.code(400);
      return { error: "provide an exact tool intent and approval lifetime" };
    }
    const approval = permissionEngine.approve(normalizeIntent(body.intent), body.lifetime);
    reply.code(201);
    return { approval };
  });

  app.post<{ Body: ToolIntent }>("/api/sarathi/tools/execute", async (request, reply) => {
    if (!permissionEngine || !isToolIntent(request.body)) {
      reply.code(400);
      return { error: "provide a Sarathi-defined tool intent" };
    }
    const result = await permissionEngine.execute(normalizeIntent(request.body));
    reply.code(result.decision.outcome === "allowed" ? 200 : result.decision.outcome === "denied" ? 403 : 409);
    return result;
  });

  app.get("/api/sarathi/providers/catalogs", async () => store.snapshot().providerCatalogs);

  app.post<{ Params: { provider: string } }>(
    "/api/sarathi/providers/:provider/catalog/refresh",
    async (request, reply) => {
      const refresh = await providerCatalogManager?.refresh(request.params.provider);
      if (!refresh) {
        reply.code(404);
        return { error: "provider catalog adapter not configured" };
      }
      return { refresh: { status: refresh.status }, catalog: refresh.catalog };
    }
  );

  app.put<{ Params: PolicyParams; Body: RoutePolicyOverride }>(
    "/api/sarathi/routing/policies/:scope/:id?",
    async (request, reply) => {
      const { scope, id } = request.params;
      if (!isPolicyScope(scope) || (scope === "global" ? Boolean(id) : !id?.trim()) || !isRoutePolicyOverride(request.body)) {
        reply.code(400);
        return { error: "provide a global policy or a named specialist/workflow policy with valid routes" };
      }
      const policy = store.setRoutePolicy(scope, id, request.body);
      return { policy, routing: store.snapshot().routing };
    }
  );

  app.post<{ Body: PauseBody }>(
    "/api/sarathi/control/pause",
    async (request, reply) => {
      if (typeof request.body?.paused !== "boolean") {
        reply.code(400);
        return { error: "paused must be a boolean" };
      }
      return store.setPaused(request.body.paused);
    }
  );

  app.post("/api/sarathi/discovery/check", async () => store.checkDiscovery());

  app.post<{ Body: SpecialistBody }>(
    "/api/sarathi/specialists",
    async (request, reply) => {
      const { name, role, runtime = "unselected" } = request.body ?? {};
      if (!name?.trim() || !role?.trim()) {
        reply.code(400);
        return { error: "name and role are required" };
      }
      const specialist = store.createSpecialist({ name, role, runtime });
      reply.code(201);
      return { specialist };
    }
  );

  app.post<{ Params: SpecialistParams }>(
    "/api/sarathi/specialists/:id/approve",
    async (request, reply) => {
      const specialist = store.approveSpecialist(request.params.id);
      if (!specialist) {
        reply.code(404);
        return { error: "Specialist not found" };
      }
      return { specialist };
    }
  );
}

function isPolicyScope(value: string): value is PolicyParams["scope"] {
  return value === "global" || value === "specialist" || value === "workflow";
}

function isPermissionRuleBody(value: unknown): value is PermissionRuleBody {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  const context = body.context;
  const validContext = context === undefined || (typeof context === "object" && context !== null && !Array.isArray(context) &&
    Object.values(context).every((entry) => typeof entry === "string"));
  const scopedContext = context as Record<string, string> | undefined;
  return isPermissionRuleDecision(body.decision) && isApprovalLifetime(body.lifetime) &&
    ["tool", "operation", "target"].every((key) => typeof body[key] === "string" && body[key].trim()) &&
    validContext &&
    (body.lifetime !== "session" || Boolean(scopedContext?.sessionKey)) &&
    (body.lifetime !== "project" || Boolean(scopedContext?.projectId));
}

function normalizeIntent(intent: ToolIntent): ToolIntent {
  return {
    tool: intent.tool.trim(),
    operation: intent.operation.trim(),
    target: intent.target.trim(),
    context: Object.fromEntries(Object.entries(intent.context).sort(([left], [right]) => left.localeCompare(right)))
  };
}

function hasApprovalContext(intent: ToolIntent, lifetime: ApprovalLifetime): boolean {
  return (lifetime !== "session" || Boolean(intent.context.sessionKey)) &&
    (lifetime !== "project" || Boolean(intent.context.projectId));
}
