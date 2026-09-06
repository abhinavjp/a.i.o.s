import { randomUUID } from "node:crypto";
import type { AgentAbstraction, ResolvedExecutionPlan, RoutePolicyOverride, RuntimeRouter, TaskOutcome, ToolExecutionResult, ToolIntent } from "@aios/contracts";
import { AgentRuntimeRouter } from "./sarathi/AgentRuntimeRouter.js";
import {
  DefaultExecutionPlanResolver,
  snapshotExecutionPlan,
  type ExecutionPlanResolver
} from "./sarathi/ExecutionPlanResolver.js";
import type { StoredTask, TaskStore } from "./TaskStore.js";
import { IneligibleRouteError, type ExecutionPlanAdmissionValidator, type FixedRouteSelector } from "./sarathi/RouteEligibility.js";

interface TaskListener {
  onChunk: (chunk: string) => void;
  onDone: (outcome: TaskOutcome) => void;
}

export interface TaskExecutionObserver {
  record(task: StoredTask): void;
}

export interface TaskToolMediator {
  execute(intent: ToolIntent): Promise<ToolExecutionResult>;
}

/**
 * Coordinates live listeners while TaskStore owns canonical task, plan, and
 * attempt durability. Router adapters only produce normalized events.
 */
export class TaskRunRegistry {
  private readonly listeners = new Map<string, TaskListener>();

  constructor(
    private readonly store: TaskStore,
    private readonly runtimeRouter: RuntimeRouter = new AgentRuntimeRouter(),
    private readonly planResolver: ExecutionPlanResolver = new DefaultExecutionPlanResolver(),
    private readonly observer?: TaskExecutionObserver,
    private readonly planAdmissionValidator?: ExecutionPlanAdmissionValidator,
    private readonly fixedRouteSelector?: FixedRouteSelector,
    private readonly toolMediator?: TaskToolMediator
  ) {}

  start(
    agent: AgentAbstraction,
    task: string,
    sessionKey: string,
    routing: { specialistId?: string; workflowId?: string; taskPolicy?: RoutePolicyOverride } = {}
  ): string {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const resolvedPlan = this.planResolver.resolve({ taskId, agent, ...routing });
    const resolvedExecutionPlan = snapshotExecutionPlan(this.fixedRouteSelector?.select(resolvedPlan) ?? resolvedPlan);
    this.planAdmissionValidator?.validate(resolvedExecutionPlan);
    this.assertSelectedAgentHealthy(agent, resolvedExecutionPlan);
    this.store.create({
      taskId,
      task,
      sessionKey,
      chunks: [],
      status: "running",
      outcome: null,
      createdAt: now,
      updatedAt: now,
      resolvedExecutionPlan,
      attempts: [
        {
          attemptId: randomUUID(),
          route: { ...resolvedExecutionPlan.route },
          ...(resolvedExecutionPlan.selection ? { selection: cloneSelection(resolvedExecutionPlan.selection) } : {}),
          status: "running",
          outcome: null,
          startedAt: now,
          completedAt: null,
          events: []
        }
      ]
    });
    this.notify(taskId);

    void this.execute({ taskId, task, sessionKey, plan: resolvedExecutionPlan, agent });
    return taskId;
  }

  has(taskId: string): boolean {
    return this.store.get(taskId) !== undefined;
  }

  get(taskId: string) {
    return this.store.get(taskId);
  }

  attach(
    taskId: string,
    onChunk: (chunk: string) => void,
    onDone: (outcome: TaskOutcome) => void
  ): boolean {
    const record = this.store.get(taskId);
    if (!record) {
      return false;
    }

    for (const chunk of record.chunks) {
      onChunk(chunk);
    }

    if (record.outcome) {
      onDone(record.outcome);
    } else {
      this.listeners.set(taskId, { onChunk, onDone });
    }

    return true;
  }

  private async execute(input: Omit<Parameters<RuntimeRouter["run"]>[0], "executeTool">): Promise<void> {
    try {
      for await (const event of this.runtimeRouter.run({
        ...input,
        executeTool: (intent) => this.toolMediator?.execute(intent) ?? Promise.resolve({
          decision: { outcome: "denied", reason: "Sarathi has no tool authority configured" }
        })
      })) {
        if (event.type === "progress") {
          this.store.applyRuntimeEvent(input.taskId, event);
          this.listeners.get(input.taskId)?.onChunk(event.text);
          this.notify(input.taskId);
          continue;
        }

        this.finish(input.taskId, event.outcome);
        return;
      }
      this.finish(input.taskId, {
        status: "failed",
        message: "runtime ended without a terminal outcome"
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "runtime execution failed";
      this.finish(input.taskId, { status: "failed", message });
    }
  }

  private finish(taskId: string, outcome: TaskOutcome): void {
    this.store.applyRuntimeEvent(taskId, { type: "terminal", outcome });
    this.notify(taskId);
    const listener = this.listeners.get(taskId);
    if (listener) {
      this.listeners.delete(taskId);
      listener.onDone(outcome);
    }
  }

  private notify(taskId: string): void {
    const task = this.store.get(taskId);
    if (task) {
      this.observer?.record(task);
    }
  }

  private assertSelectedAgentHealthy(agent: AgentAbstraction, plan: ResolvedExecutionPlan): void {
    if (!plan.selection || plan.selection.authenticationMode === "fake" ||
      (plan.route.runtime === "unmeasured" && plan.route.billingMode === "unmeasured")) {
      return;
    }
    try {
      const health = agent.checkHealth();
      if (!health.ok) {
        throw new IneligibleRouteError(health.reason);
      }
    } catch (error) {
      if (error instanceof IneligibleRouteError) {
        throw error;
      }
      throw new IneligibleRouteError(error instanceof Error ? error.message : "selected runtime health check failed");
    }
  }
}

function cloneSelection(selection: NonNullable<ResolvedExecutionPlan["selection"]>): NonNullable<ResolvedExecutionPlan["selection"]> {
  return {
    requestedRoute: { ...selection.requestedRoute },
    effectiveRoute: { ...selection.effectiveRoute },
    authenticationMode: selection.authenticationMode,
    billingMode: selection.billingMode,
    reason: selection.reason
  };
}
