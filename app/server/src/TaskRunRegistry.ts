import { randomUUID } from "node:crypto";
import type { AgentAbstraction, TaskOutcome } from "@aios/contracts";
import type { TaskStore } from "./TaskStore.js";

interface TaskListener {
  onChunk: (chunk: string) => void;
  onDone: (outcome: TaskOutcome) => void;
}

/**
 * Coordinates live listeners while the TaskStore owns task durability.
 *
 * `start` consumes the agent stream immediately and persists every chunk and
 * terminal outcome. `attach` replays persisted chunks before subscribing to
 * the live listener, so reconnects never execute the agent again.
 */
export class TaskRunRegistry {
  private readonly listeners = new Map<string, TaskListener>();

  constructor(private readonly store: TaskStore) {}

  start(agent: AgentAbstraction, task: string, sessionKey: string): string {
    const taskId = randomUUID();
    const now = new Date().toISOString();
    this.store.create({
      taskId,
      task,
      sessionKey,
      chunks: [],
      status: "running",
      outcome: null,
      createdAt: now,
      updatedAt: now
    });

    void (async () => {
      let health;
      try {
        health = agent.checkHealth();
      } catch (error) {
        const message = error instanceof Error ? error.message : "agent health check failed";
        this.finish(taskId, { status: "unavailable", message });
        return;
      }

      if (!health.ok) {
        this.store.appendChunk(taskId, health.reason);
        this.finish(taskId, { status: "unavailable", message: health.reason });
        return;
      }

      try {
        for await (const chunk of agent.runTask(task, sessionKey)) {
          this.store.appendChunk(taskId, chunk);
          this.listeners.get(taskId)?.onChunk(chunk);
        }
        this.finish(taskId, { status: "completed" });
      } catch (error) {
        const message = error instanceof Error ? error.message : "task failed";
        this.finish(taskId, { status: "failed", message });
      }
    })();

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

  private finish(taskId: string, outcome: TaskOutcome): void {
    this.store.complete(taskId, outcome);
    const listener = this.listeners.get(taskId);
    if (listener) {
      this.listeners.delete(taskId);
      listener.onDone(outcome);
    }
  }
}
