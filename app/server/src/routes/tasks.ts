import type { FastifyInstance } from "fastify";
import type { AgentManager } from "@aios/agents";
import type { RoutePolicyOverride, RuntimeRouter, TaskOutcome } from "@aios/contracts";
import { TaskRunRegistry, type TaskExecutionObserver, type TaskToolMediator } from "../TaskRunRegistry.js";
import { computeSessionKey } from "../sessionKey.js";
import type { ExecutionPlanResolver } from "../sarathi/ExecutionPlanResolver.js";
import { IneligibleRouteError, type ExecutionPlanAdmissionValidator, type FixedRouteSelector } from "../sarathi/RouteEligibility.js";
import { isRoutePolicyOverride } from "../sarathi/RoutePolicy.js";
import type { TaskStore } from "../TaskStore.js";
import type { RouteResilience } from "../sarathi/RouteResilience.js";

interface SubmitTaskBody {
  task: string;
  specialistId?: string;
  workflowId?: string;
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
  options: TaskRouteOptions = {}
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
    const { task } = request.body;
    if (request.body.routePolicy !== undefined && !isRoutePolicyOverride(request.body.routePolicy)) {
      reply.code(400);
      return { error: "routePolicy must contain valid primary and fallback routes" };
    }
    const agent = manager.getActiveAgent();
    const sessionKey = computeSessionKey("default-operator", "default");

    let taskId: string;
    try {
      taskId = await registry.start(agent, task, sessionKey, {
        specialistId: request.body.specialistId,
        workflowId: request.body.workflowId,
        taskPolicy: request.body.routePolicy
      });
    } catch (error) {
      if (error instanceof IneligibleRouteError) {
        reply.code(400);
        return { error: error.message };
      }
      throw error;
    }

    reply.code(202);
    return { taskId };
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
