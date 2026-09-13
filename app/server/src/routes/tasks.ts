import type { FastifyInstance } from "fastify";
import type { AgentManager } from "@aios/agents";
import type { AgentEngineKind, EnginePolicyOverride, RoutePolicyOverride, RuntimeRouter, TaskOutcome } from "@aios/contracts";
import { NullAgent } from "@aios/agents";
import { TaskRunRegistry, type TaskExecutionObserver, type TaskToolMediator } from "../TaskRunRegistry.js";
import { computeSessionKey } from "../sessionKey.js";
import type { ExecutionPlanResolver } from "../sarathi/ExecutionPlanResolver.js";
import { IneligibleRouteError, type ExecutionPlanAdmissionValidator, type FixedRouteSelector } from "../sarathi/RouteEligibility.js";
import { isRoutePolicyOverride } from "../sarathi/RoutePolicy.js";
import type { TaskStore } from "../TaskStore.js";
import type { EngineConfigStore, StoredEnginePolicy } from "../engine/EngineConfigStore.js";
import { resolveEnginePolicy } from "../engine/resolveEnginePolicy.js";
import { validatePolicy } from "../engine/EngineConfigStore.js";
import type { RouteResilience } from "../sarathi/RouteResilience.js";

interface SubmitTaskBody {
  task: string;
  workflowId?: string;
  agentId?: string;
  engineOverride?: EnginePolicyOverride | AgentEngineKind;
  safeBoundary?: boolean;
  orchestration?: string;
  specialistId?: string;
  routePolicy?: RoutePolicyOverride;
}

interface StreamParams {
  taskId: string;
}

export interface TaskRouteOptions {
  runtimeRouter?: RuntimeRouter;
  planResolver?: ExecutionPlanResolver;
  executionObserver?: TaskExecutionObserver;
  planAdmissionValidator?: ExecutionPlanAdmissionValidator;
  fixedRouteSelector?: FixedRouteSelector;
  toolMediator?: TaskToolMediator;
  resilience?: RouteResilience;
}

export function registerTaskRoutes(
  app: FastifyInstance,
  manager: AgentManager,
  store: TaskStore,
  options: TaskRouteOptions = {},
  engineStore?: EngineConfigStore
): void {
  const registry = new TaskRunRegistry(
    store,
    options.runtimeRouter,
    options.planResolver,
    options.executionObserver,
    options.planAdmissionValidator,
    options.fixedRouteSelector,
    options.toolMediator,
    options.resilience
  );
  app.addHook("onClose", async () => registry.close());

  app.post<{ Params: StreamParams }>("/api/agents/active/tasks/:taskId/cancel", async (request, reply) => {
    const task = await registry.cancel(request.params.taskId);
    if (!task) { reply.code(404); return { error: "Task not found" }; }
    return { taskId: task.taskId, status: task.status, outcome: task.outcome, chunks: task.chunks };
  });

  app.post<{ Body: SubmitTaskBody }>("/api/agents/active/tasks", async (request, reply) => {
    if (!request.body || typeof request.body.task !== "string" || !request.body.task.trim()) {
      reply.code(400);
      return { error: "task is required" };
    }
    const { task, workflowId, agentId, engineOverride, safeBoundary = false, orchestration } = request.body;
    if (request.body.routePolicy !== undefined && !isRoutePolicyOverride(request.body.routePolicy)) {
      reply.code(400);
      return { error: "routePolicy must contain valid primary and fallback routes" };
    }
    const sessionKey = computeSessionKey("default-operator", "default");
    const routingEnabled = Boolean(manager.getEngineRegistry()?.kinds().length);
    if (!routingEnabled || !engineStore) {
      let taskId: string;
      try {
        taskId = await registry.start(manager.getActiveAgent(), task, sessionKey, { specialistId: request.body.specialistId, workflowId: request.body.workflowId, taskPolicy: request.body.routePolicy });
      } catch (error) {
        if (error instanceof IneligibleRouteError) { reply.code(400); return { error: error.message }; }
        throw error;
      }
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
      const taskId = await registry.start(new NullAgent(), task, sessionKey, {}, {
        resolvedEnginePlan: resolved,
        routingSource: resolved.source,
        readiness: { state: "unavailable", reason: "Hermes Kanban is incompatible with the selected engine", checkedAt: new Date().toISOString() },
        initialOutcome: { status: "blocked", message: "Hermes Kanban is incompatible with the selected engine" }
      });
      reply.code(202);
      return { taskId, resolvedEnginePlan: resolved, readiness: { state: "unavailable", reason: "Hermes Kanban is incompatible with the selected engine", checkedAt: new Date().toISOString() }, outcome: { status: "blocked", message: "Hermes Kanban is incompatible with the selected engine" } };
    }
    const attemptedEngineRoutes = [resolved.primary];
    let executedEngineRoute = resolved.primary;
    let admission = await manager.resolveEngine(resolved);
    if (!admission.ok && resolved.fallbacks.length && resolved.primary.engine !== resolved.fallbacks[0]?.engine) {
      const consent = engineStore.snapshot().consent;
      const fallbackAllowed = resolved.primary.billingMode !== "api" && resolved.fallbacks.every((route) => route.billingMode !== "api") || consent.paidFallback;
      if (resolved.primary.engine !== resolved.fallbacks[0]?.engine && consent.crossEngineFallback && fallbackAllowed && safeBoundary) {
        for (const fallback of resolved.fallbacks) {
          attemptedEngineRoutes.push(fallback);
          const candidate = await manager.resolveEngine({ ...resolved, primary: fallback });
          if (candidate.ok) { admission = candidate; executedEngineRoute = fallback; break; }
        }
      } else {
        admission = { ...admission, outcome: { status: "blocked", message: "fallback blocked: explicit consent, billing, and safe durable boundary are required" } };
      }
    }
    const taskId = await registry.start(admission.ok ? admission.agent : new NullAgent(), task, sessionKey, {
      specialistId: request.body.specialistId,
      workflowId: request.body.workflowId,
      taskPolicy: request.body.routePolicy
    }, {
      resolvedEnginePlan: resolved,
      executedEngineRoute,
      attemptedEngineRoutes,
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
        updatedAt: record.updatedAt,
        resolvedExecutionPlan: record.resolvedExecutionPlan,
        attempts: record.attempts ?? [],
        canonicalHistory: record.canonicalHistory ?? []
        ,resolvedEnginePlan: record.resolvedEnginePlan
        ,executedEngineRoute: record.executedEngineRoute
        ,attemptedEngineRoutes: record.attemptedEngineRoutes
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
