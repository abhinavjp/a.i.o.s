import type { FastifyInstance } from "fastify";
import type { ResolvedRoute, RoutePolicyOverride } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";

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

export function registerSarathiRoutes(app: FastifyInstance, store: SarathiStore): void {
  app.get("/api/sarathi/dashboard", async () => store.snapshot());

  app.get("/api/sarathi/routing/policies", async () => store.snapshot().routing);

  app.put<{ Params: PolicyParams; Body: RoutePolicyOverride }>(
    "/api/sarathi/routing/policies/:scope/:id?",
    async (request, reply) => {
      const { scope, id } = request.params;
      if (!isPolicyScope(scope) || (scope === "global" ? Boolean(id) : !id?.trim()) || !isPolicy(request.body)) {
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

function isPolicy(value: unknown): value is RoutePolicyOverride {
  if (!value || typeof value !== "object") return false;
  const policy = value as RoutePolicyOverride;
  return (policy.primary === undefined || isRoute(policy.primary)) &&
    (policy.fallbacks === undefined || (Array.isArray(policy.fallbacks) && policy.fallbacks.every(isRoute)));
}

function isRoute(value: unknown): value is ResolvedRoute {
  if (!value || typeof value !== "object") return false;
  const route = value as ResolvedRoute;
  return typeof route.runtime === "string" && typeof route.provider === "string" &&
    typeof route.model === "string" && ["fake", "subscription", "api", "unmeasured"].includes(route.billingMode);
}
