import { randomUUID } from "node:crypto";
import type { AgentAbstraction, RoutePolicyOverride, RuntimeRouter, TaskOutcome } from "@aios/contracts";
import { AgentRuntimeRouter } from "./sarathi/AgentRuntimeRouter.js";
import {
  DefaultExecutionPlanResolver,
  snapshotExecutionPlan,
  type ExecutionPlanResolver
} from "./sarathi/ExecutionPlanResolver.js";
import type { StoredTask, TaskStore } from "./TaskStore.js";

interface TaskListener {
  onChunk: (chunk: string) => void;
  onDone: (outcome: TaskOutcome) => void;
}

export interface TaskExecutionObserver {
  record(task: StoredTask): void;
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
    private readonly observer?: TaskExecutionObserver
  ) {}

  start(
    agent: AgentAbstraction,
    task: string,
    sessionKey: string,
    routing: { specialistId?: string; workflowId?: string; taskPolicy?: RoutePolicyOverride } = {}
  ): string {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    const resolvedExecutionPlan = snapshotExecutionPlan(this.planResolver.resolve({ taskId, agent, ...routing }));
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

  private async execute(input: Parameters<RuntimeRouter["run"]>[0]): Promise<void> {
    try {
      for await (const event of this.runtimeRouter.run(input)) {
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
}
