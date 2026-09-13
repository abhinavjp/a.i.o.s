import type { FastifyInstance } from "fastify";
import type { AgentEngineKind, EngineReadiness, EnginePolicyOverride, EngineConsent } from "@aios/contracts";
import type { AgentManager } from "@aios/agents";
import type { EngineConfigStore } from "./EngineConfigStore.js";
import { validatePolicy } from "./EngineConfigStore.js";

interface PolicyParams { id: string }

const ENGINE_KINDS: readonly AgentEngineKind[] = ["hermes", "codex", "claude-code"];

export function registerEngineRoutes(app: FastifyInstance, store: EngineConfigStore, manager?: AgentManager): void {
  app.get("/api/routing", async () => store.snapshot());

  // The cards report the same probe that admits a task, so a badge can never
  // claim a readiness the engine has not actually earned.
  app.get("/api/routing/readiness", async () => {
    const engines: Record<string, EngineReadiness> = {};
    for (const engine of ENGINE_KINDS) {
      engines[engine] = await probeEngine(manager, engine);
    }
    return { engines };
  });

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

async function probeEngine(manager: AgentManager | undefined, engine: AgentEngineKind): Promise<EngineReadiness> {
  const unregistered = { state: "unavailable", reason: `${engine} engine is not registered`, checkedAt: new Date().toISOString() } as const;
  if (!manager?.getEngineRegistry()?.has(engine)) return unregistered;
  const admission = await manager.resolveEngine(
    { primary: { engine, configuration: "default", billingMode: "subscription" }, fallbacks: [], source: "global", configurationVersions: { task: null, workflow: null, agent: null, global: null } },
    "readiness-probe"
  );
  return admission.readiness;
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
