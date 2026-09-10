import type { FastifyInstance } from "fastify";
import type { AgentManager } from "@aios/agents";
import type { AgentEngineKind, EnginePolicyOverride, TaskOutcome } from "@aios/contracts";
import { NullAgent } from "@aios/agents";
import { TaskRunRegistry } from "../TaskRunRegistry.js";
import { computeSessionKey } from "../sessionKey.js";
import type { TaskStore } from "../TaskStore.js";
import type { EngineConfigStore, StoredEnginePolicy } from "../engine/EngineConfigStore.js";
import { resolveEnginePolicy } from "../engine/resolveEnginePolicy.js";
import { validatePolicy } from "../engine/EngineConfigStore.js";

interface SubmitTaskBody {
  task: string;
  workflowId?: string;
  agentId?: string;
  engineOverride?: EnginePolicyOverride | AgentEngineKind;
  safeBoundary?: boolean;
  orchestration?: string;
}

interface StreamParams {
  taskId: string;
}

export function registerTaskRoutes(
  app: FastifyInstance,
  manager: AgentManager,
  store: TaskStore
  ,engineStore?: EngineConfigStore
): void {
  const registry = new TaskRunRegistry(store);

  app.post<{ Body: SubmitTaskBody }>("/api/agents/active/tasks", async (request, reply) => {
    if (!request.body || typeof request.body.task !== "string" || !request.body.task.trim()) {
      reply.code(400);
      return { error: "task is required" };
    }
    const { task, workflowId, agentId, engineOverride, safeBoundary = false, orchestration } = request.body;
    const sessionKey = computeSessionKey("default-operator", "default");
    const routingEnabled = Boolean(manager.getEngineRegistry()?.kinds().length);
    if (!routingEnabled || !engineStore) {
      const taskId = registry.start(manager.getActiveAgent(), task, sessionKey);
      reply.code(202);
      return { taskId };
    }

    const taskPolicy = typeof engineOverride === "string"
      ? { primary: { engine: engineOverride, configuration: "default", billingMode: "subscription" as const } }
      : engineOverride;
    try {
      if (taskPolicy) validatePolicy(taskPolicy as EnginePolicyOverride);
    } catch (error) {
      reply.code(400);
      return { error: error instanceof Error ? error.message : "invalid engine override" };
    }
    const resolved = resolveEnginePolicy({
      global: toLayer(engineStore.getPolicy("global")),
      agent: toLayer(engineStore.getPolicy("agent", agentId)),
      workflow: toLayer(engineStore.getPolicy("workflow", workflowId)),
      task: taskPolicy ? { policy: taskPolicy, version: null } : null
    });
    if (orchestration === "hermes-kanban" && resolved.primary.engine !== "hermes") {
      const taskId = registry.start(new NullAgent(), task, sessionKey, {
        resolvedEnginePlan: resolved,
        routingSource: resolved.source,
        readiness: { state: "unavailable", reason: "Hermes Kanban is incompatible with the selected engine", checkedAt: new Date().toISOString() },
        initialOutcome: { status: "blocked", message: "Hermes Kanban is incompatible with the selected engine" }
      });
      reply.code(202);
      return { taskId, resolvedEnginePlan: resolved, readiness: { state: "unavailable", reason: "Hermes Kanban is incompatible with the selected engine", checkedAt: new Date().toISOString() }, outcome: { status: "blocked", message: "Hermes Kanban is incompatible with the selected engine" } };
    }
    let admission = manager.resolveEngine(resolved);
    if (!admission.ok && resolved.fallbacks.length && resolved.primary.engine !== resolved.fallbacks[0]?.engine) {
      const consent = engineStore.snapshot().consent;
      const fallbackAllowed = resolved.primary.billingMode !== "api" && resolved.fallbacks.every((route) => route.billingMode !== "api") || consent.paidFallback;
      if (resolved.primary.engine !== resolved.fallbacks[0]?.engine && consent.crossEngineFallback && fallbackAllowed && safeBoundary) {
        for (const fallback of resolved.fallbacks) {
          const candidate = manager.resolveEngine({ ...resolved, primary: fallback });
          if (candidate.ok) { admission = candidate; break; }
        }
      } else {
        admission = { ...admission, outcome: { status: "blocked", message: "fallback blocked: explicit consent, billing, and safe durable boundary are required" } };
      }
    }
    const taskId = registry.start(admission.ok ? admission.agent : new NullAgent(), task, sessionKey, {
      resolvedEnginePlan: resolved,
      readiness: admission.readiness,
      routingSource: resolved.source,
      initialOutcome: admission.ok ? undefined : admission.outcome
    });

    reply.code(202);
    return { taskId, resolvedEnginePlan: resolved, readiness: admission.readiness, outcome: admission.ok ? undefined : admission.outcome };
  });

  app.get<{ Params: StreamParams }>(
    "/api/agents/active/tasks/:taskId",
    async (request, reply) => {
      const { taskId } = request.params;

      const record = registry.get(taskId);
      if (!record) {
        reply.code(404);
        return { error: "Task not found" };
      }

      return {
        taskId: record.taskId,
        task: record.task,
        status: record.status,
        chunks: record.chunks,
        outcome: record.outcome,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt
        ,resolvedEnginePlan: record.resolvedEnginePlan
        ,readiness: record.readiness
        ,routingSource: record.routingSource
        ,nativeSessionIds: record.nativeSessionIds
      };
    }
  );

  app.get<{ Params: StreamParams }>(
    "/api/agents/active/tasks/:taskId/stream",
    async (request, reply) => {
      const { taskId } = request.params;

      if (!registry.has(taskId)) {
        reply.code(404);
        return { error: "Task not found" };
      }

      return new Promise<void>((resolve) => {
        reply.raw.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });

        registry.attach(
          taskId,
          (chunk) => {
            reply.raw.write(`data: ${chunk}\n\n`);
          },
          (outcome: TaskOutcome) => {
            reply.raw.write(`event: done\ndata: ${JSON.stringify(outcome)}\n\n`);
            reply.raw.end();
            resolve();
          }
        );
      });
    }
  );
}

function toLayer(policy: StoredEnginePolicy | null): { policy: EnginePolicyOverride; version: number } | null {
  if (!policy) return null;
  const { version, ...value } = policy;
  return { policy: value as EnginePolicyOverride, version };
}
