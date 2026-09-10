import type { FastifyInstance } from "fastify";
import type { EnginePolicyOverride, EngineConsent } from "@aios/contracts";
import type { EngineConfigStore } from "./EngineConfigStore.js";
import { validatePolicy } from "./EngineConfigStore.js";

interface PolicyParams { id: string }

export function registerEngineRoutes(app: FastifyInstance, store: EngineConfigStore): void {
  app.get("/api/routing", async () => store.snapshot());

  app.put<{ Body: EnginePolicyOverride }>("/api/routing/global", async (request, reply) => update(store, "global", undefined, request.body, reply));
  app.put<{ Params: PolicyParams; Body: EnginePolicyOverride }>("/api/routing/workflows/:id", async (request, reply) => update(store, "workflow", request.params.id, request.body, reply));
  app.put<{ Params: PolicyParams; Body: EnginePolicyOverride }>("/api/routing/agents/:id", async (request, reply) => update(store, "agent", request.params.id, request.body, reply));

  app.put<{ Body: EngineConsent }>("/api/routing/consent", async (request, reply) => {
    try {
      const consent = store.setConsent(request.body);
      return { consent };
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "invalid consent" };
    }
  });
}

function update(store: EngineConfigStore, source: "global" | "workflow" | "agent", id: string | undefined, body: EnginePolicyOverride, reply: { code(statusCode: number): unknown }) {
  try {
    validatePolicy(body ?? {});
    if (body?.fallbackEnabled && !store.snapshot().consent.crossEngineFallback) throw new Error("cross-engine fallback requires explicit consent");
    const policy = store.setPolicy(source, id, body ?? {});
    return { policy, routing: store.snapshot() };
  } catch (error) {
    reply.code(400);
    return { error: error instanceof Error ? error.message : "invalid routing policy" };
  }
}
