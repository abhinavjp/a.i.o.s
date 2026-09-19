import type { FastifyInstance } from "fastify";
import type { ApprovalLifetime, LiveProofRoute, PermissionRuleDecision, ResolvedRoute, RoutePolicyOverride, RuntimeRouter, ToolIntent } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";
import { randomUUID } from "node:crypto";
import { isRoutePolicyOverride } from "./RoutePolicy.js";
import type { ProviderCatalogManager } from "./ProviderCatalog.js";
import { isApprovalLifetime, isPermissionRuleDecision, isToolIntent, PermissionEngine } from "./PermissionEngine.js";
import type { RouteResilience } from "./RouteResilience.js";
import type { LiveProofHarness } from "./ProofHarness.js";

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
interface StandingRuleBody { label?: unknown; askKind?: unknown; scope?: unknown; }

export function registerSarathiRoutes(
  app: FastifyInstance,
  store: SarathiStore,
  providerCatalogManager?: ProviderCatalogManager,
  permissionEngine?: PermissionEngine,
  resilience?: RouteResilience,
  runtimeRouter?: RuntimeRouter,
  proofHarness?: LiveProofHarness,
  onAskDecision?: (intent: ToolIntent, decision: "approved" | "declined", note?: string) => void,
  onArtifactAwait?: (artifactId: string) => ToolIntent | undefined
): void {
  app.get("/api/sarathi/dashboard", async () => store.snapshot());

  app.get("/api/sarathi/proofs", async () => store.snapshot().proofs);
  app.post<{ Params: { route: string }; Body: { optIn?: boolean } }>("/api/sarathi/proofs/:route", async (request, reply) => {
    const route = request.params.route as LiveProofRoute;
    if (!isLiveProofRoute(route)) {
      reply.code(400);
      return { error: "unknown live proof route" };
    }
    const proof = await (proofHarness?.prove(route, request.body?.optIn === true) ?? Promise.resolve({
      route, status: "UNMEASURED" as const, reason: "No live proof harness is configured.", checkedAt: null
    }));
    return { proof: store.recordProof(proof) };
  });

  app.get("/api/sarathi/routing/policies", async () => store.snapshot().routing);

  app.get("/api/sarathi/routing/circuits", async () => store.snapshot().routeCircuits);
  app.post<{ Body: { route: ResolvedRoute } }>("/api/sarathi/routing/circuits/probe", async (request, reply) => {
    if (!request.body?.route || !isRoutePolicyOverride({ primary: request.body.route })) {
      reply.code(400); return { error: "provide a valid route to probe" };
    }
    return { recovered: await resilience?.probe(request.body.route, runtimeRouter) ?? false, circuits: store.snapshot().routeCircuits };
  });

  app.get("/api/sarathi/permissions", async () => store.snapshot().permissions);
  app.get("/api/sarathi/standing-rules", async () => ({ rules: store.snapshot().standingRules }));
  app.post<{ Body: StandingRuleBody }>("/api/sarathi/standing-rules", async (request, reply) => {
    const { label, askKind, scope } = request.body ?? {};
    if (!permissionEngine || typeof label !== "string" || !label.trim() || typeof askKind !== "string" || !askKind.trim() || (scope !== "all" && typeof scope !== "string")) { reply.code(400); return { error: "label, askKind, and scope are required" }; }
    const operation = askKind.trim();
    try {
      const permissionRule = permissionEngine.buildStandingRule(operation, scope);
      const rule = store.addStandingRule({ id: randomUUID(), label: label.trim(), askKind: operation, scope, enabled: true, firedCount: 0, permissionRule });
      reply.code(201); return { rule };
    } catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "standing rule could not be saved" }; }
  });
  app.put<{ Params: { ruleId: string }; Body: { enabled?: boolean } }>("/api/sarathi/standing-rules/:ruleId", async (request, reply) => {
    if (typeof request.body?.enabled !== "boolean") { reply.code(400); return { error: "enabled must be a boolean" }; }
    const rule = store.setStandingRuleEnabled(request.params.ruleId, request.body.enabled);
    if (!rule) { reply.code(404); return { error: "standing rule was not found" }; } return { rule };
  });

  app.post<{ Body: PermissionRuleBody }>("/api/sarathi/permissions/rules", async (request, reply) => {
    const body = request.body;
    if (!permissionEngine || !isPermissionRuleBody(body)) {
      reply.code(400);
      return { error: "provide a narrow deny, ask, or allow rule with tool, operation, target, and lifetime" };
    }
    try {
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
    } catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "permission rule could not be saved" }; }
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
  app.put<{ Params: { ruleId: string }; Body: PermissionRuleBody }>("/api/sarathi/permissions/rules/:ruleId", async (request, reply) => {
    if (!permissionEngine || !isPermissionRuleBody(request.body)) { reply.code(400); return { error: "provide a valid permission rule" }; }
    try {
      const rule = store.updatePermissionRule(request.params.ruleId, { id: request.params.ruleId, remainingUses: request.body.lifetime === "once" ? 1 : null, createdAt: new Date().toISOString(), decision: request.body.decision, tool: request.body.tool, operation: request.body.operation, target: request.body.target, lifetime: request.body.lifetime, context: request.body.context ?? {} });
      if (!rule) { reply.code(404); return { error: "permission rule was not found" }; }
      return { rule };
    } catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "permission rule could not be edited" }; }
  });
  app.delete<{ Params: { ruleId: string } }>("/api/sarathi/permissions/rules/:ruleId", async (request, reply) => {
    try { const rule = store.deletePermissionRule(request.params.ruleId); if (!rule) { reply.code(404); return { error: "permission rule was not found" }; } return { rule }; }
    catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "permission rule could not be deleted" }; }
  });

  app.get("/api/sarathi/asks", async () => ({ asks: store.snapshot().asks }));
  app.post<{ Params: { artifactId: string } }>("/api/sarathi/artifacts/:artifactId/await", async (request, reply) => {
    if (!permissionEngine) { reply.code(400); return { error: "permission engine is unavailable" }; }
    const intent = onArtifactAwait?.(request.params.artifactId);
    if (!intent) { reply.code(400); return { error: "artifact must be in draft or rejected state" }; }
    const result = await permissionEngine.execute(intent);
    reply.code(result.decision.outcome === "requires_approval" ? 202 : result.decision.outcome === "allowed" ? 200 : 403);
    return result;
  });
  app.post<{ Params: { askId: string }; Body: { decision?: string; note?: string } }>("/api/sarathi/asks/:askId/decide", async (request, reply) => {
    if (!permissionEngine || (request.body?.decision !== "approved" && request.body?.decision !== "declined")) { reply.code(400); return { error: "decision must be approved or declined" }; }
    const ask = store.decideAsk(request.params.askId, request.body.decision);
    if (!ask) { reply.code(409); return { error: "ask was already decided or does not exist" }; }
    onAskDecision?.(ask.intent, request.body.decision, request.body.note);
    if (request.body.decision === "approved") permissionEngine.approve(ask.intent, "once");
    else permissionEngine.saveRule({ decision: "deny", tool: ask.intent.tool, operation: ask.intent.operation, target: ask.intent.target, context: ask.intent.context, lifetime: "once" });
    return { ask, decision: request.body.decision };
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

function isLiveProofRoute(value: string): value is LiveProofRoute {
  return ["codex", "claude", "ollama", "custom-openai-compatible", "openai", "anthropic", "openrouter"].includes(value);
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
