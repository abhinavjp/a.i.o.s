import type { FastifyInstance } from "fastify";
import type { ApprovalLifetime, LiveProofRoute, PermissionRuleDecision, ResolvedRoute, RoutePolicyOverride, RuntimeRouter, ToolIntent } from "@aios/contracts";
import type { SarathiStore, StallThresholds } from "./SarathiStore.js";
import { randomUUID } from "node:crypto";
import { isRoutePolicyOverride } from "./RoutePolicy.js";
import type { ProviderCatalogManager } from "./ProviderCatalog.js";
import { isApprovalLifetime, isPermissionRuleDecision, isToolIntent, PermissionEngine } from "./PermissionEngine.js";
import type { RouteResilience } from "./RouteResilience.js";
import type { LiveProofHarness } from "./ProofHarness.js";
import type { AgentSlotManager } from "./AgentSlots.js";

interface PauseBody {
  paused: boolean;
}

interface SpecialistBody {
  name: string;
  role: string;
  runtime?: string;
  slotLimit?: number;
  capabilityTags?: unknown;
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
interface AutopilotBody { low?: unknown; medium?: unknown; high?: unknown; }
interface StallThresholdsBody { nudgeMinutes?: unknown; stopMinutes?: unknown; }

export function registerSarathiRoutes(
  app: FastifyInstance,
  store: SarathiStore,
  providerCatalogManager?: ProviderCatalogManager,
  permissionEngine?: PermissionEngine,
  resilience?: RouteResilience,
  runtimeRouter?: RuntimeRouter,
  proofHarness?: LiveProofHarness,
  onAskDecision?: (intent: ToolIntent, decision: "approved" | "declined", note?: string) => void | Promise<void>,
  onArtifactAwait?: (artifactId: string) => ToolIntent | undefined,
  agentSlots?: AgentSlotManager
): void {
  app.get("/api/sarathi/dashboard", async () => store.snapshot());
  app.get("/api/sarathi/agents", async () => ({ agents: agentSlots?.list() ?? [] }));
  app.get<{ Querystring: { capabilityTag?: string } }>("/api/sarathi/agents/suggest", async (request, reply) => {
    const capabilityTag = request.query.capabilityTag?.trim();
    if (!capabilityTag) { reply.code(400); return { error: "capability tag is required" }; }
    return agentSlots?.suggest(capabilityTag) ?? { agent: null, reason: `no agent with a free slot has capability tag ${capabilityTag}` };
  });

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
  app.get("/api/sarathi/autopilot", async () => store.snapshot().autopilot);
  app.get("/api/sarathi/stall-thresholds", async () => store.snapshot().stallThresholds);
  app.put<{ Body: StallThresholdsBody }>("/api/sarathi/stall-thresholds", async (request, reply) => {
    const thresholds = request.body;
    if (!isStallThresholds(thresholds)) { reply.code(400); return { error: "nudgeMinutes and stopMinutes must be positive whole minutes, with stopMinutes greater than nudgeMinutes" }; }
    return store.setStallThresholds(thresholds);
  });
  app.get("/api/sarathi/standing-rule-suggestions", async () => ({ suggestions: store.snapshot().standingRuleSuggestions.filter((item) => item.state === "offered") }));
  app.post<{ Params: { suggestionId: string } }>("/api/sarathi/standing-rule-suggestions/:suggestionId/accept", async (request, reply) => {
    const suggestion = store.snapshot().standingRuleSuggestions.find((item) => item.id === request.params.suggestionId && item.state === "offered");
    if (!suggestion || !permissionEngine) { reply.code(404); return { error: "standing rule suggestion was not found" }; }
    try { const rule = store.addStandingRule({ id: randomUUID(), label: `Automatically suggested: ${suggestion.askKind}`, askKind: suggestion.askKind, scope: suggestion.scope, enabled: true, firedCount: 0, permissionRule: permissionEngine.buildStandingRule(suggestion.askKind, suggestion.scope) }); store.setStandingRuleSuggestionState(suggestion.id, "accepted"); reply.code(201); return { rule }; } catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "standing rule suggestion could not be accepted" }; }
  });
  app.post<{ Params: { suggestionId: string } }>("/api/sarathi/standing-rule-suggestions/:suggestionId/dismiss", async (request, reply) => { const suggestion = store.setStandingRuleSuggestionState(request.params.suggestionId, "dismissed"); if (!suggestion) { reply.code(404); return { error: "standing rule suggestion was not found" }; } return { suggestion }; });
  app.get("/api/sarathi/automatic-decisions", async () => {
    const decisions = store.snapshot().automaticDecisions;
    const today = new Date().toISOString().slice(0, 10);
    return { decisions, todayCount: decisions.filter((decision) => decision.createdAt.startsWith(today)).length };
  });
  app.post<{ Params: { decisionId: string } }>("/api/sarathi/automatic-decisions/:decisionId/undo", async (request, reply) => {
    if (!permissionEngine) { reply.code(400); return { error: "permission engine is unavailable" }; }
    const result = await permissionEngine.undoAutomaticDecision(request.params.decisionId);
    if (result === "not-found") { reply.code(409); return { error: "automatic decision was already undone or does not exist" }; }
    if (result === "not-undoable") { reply.code(409); return { error: "automatic decision cannot be undone" }; }
    return result;
  });
  app.put<{ Body: AutopilotBody }>("/api/sarathi/autopilot", async (request, reply) => {
    const body = request.body;
    if (!body || ![body.low, body.medium, body.high].every((tier) => tier === "ask" || tier === "automatic")) { reply.code(400); return { error: "each autopilot tier must be ask or automatic" }; }
    return store.setAutopilot({ low: body.low as "ask" | "automatic", medium: body.medium as "ask" | "automatic", high: body.high as "ask" | "automatic" });
  });
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
    const ask = store.getPendingAsk(request.params.askId);
    if (!ask) { reply.code(409); return { error: "ask was already decided or does not exist" }; }
    await onAskDecision?.(ask.intent, request.body.decision, request.body.note);
    store.decideAsk(request.params.askId, request.body.decision);
    if (request.body.decision === "approved") { permissionEngine.approve(ask.intent, "once"); store.recordApprovedAsk(ask); }
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
      const { name, role, runtime = "unselected", slotLimit, capabilityTags } = request.body ?? {};
      if (!name?.trim() || !role?.trim() || (slotLimit !== undefined && (!Number.isInteger(slotLimit) || slotLimit < 1)) || !isCapabilityTags(capabilityTags)) {
        reply.code(400);
        return { error: "name, role, and a positive whole slot limit are required" };
      }
      const specialist = store.createSpecialist({ name, role, runtime, slotLimit, capabilityTags });
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

function isStallThresholds(value: StallThresholdsBody | undefined): value is StallThresholds {
  if (!value || typeof value.nudgeMinutes !== "number" || typeof value.stopMinutes !== "number") return false;
  return Number.isInteger(value.nudgeMinutes) && Number.isInteger(value.stopMinutes) && value.nudgeMinutes > 0 && value.stopMinutes > value.nudgeMinutes;
}

function isCapabilityTags(value: unknown): value is string[] | undefined {
  return value === undefined || (Array.isArray(value) && value.every((tag) => typeof tag === "string" && tag.trim()));
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
