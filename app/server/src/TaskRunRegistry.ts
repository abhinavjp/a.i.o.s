import { randomUUID } from "node:crypto";
import type { AgentAbstraction } from "@aios/contracts";

interface TaskRecord {
  chunks: string[];
  done: boolean;
  listener: { onChunk: (chunk: string) => void; onDone: () => void } | null;
}

/**
 * In-memory registry of running/completed agent task streams.
 *
 * `start` kicks off consumption of the agent's async iterable immediately
 * (not lazily on first attach) and buffers every chunk it yields. `attach`
 * lets a single stream reader replay everything buffered so far and then
 * keep receiving new chunks/completion as they happen. This is v1: single
 * process, no persistence, at most one live listener per task.
 */
export class TaskRunRegistry {
  private readonly records = new Map<string, TaskRecord>();

  start(agent: AgentAbstraction, task: string, sessionKey: string): string {
    const taskId = randomUUID();
    const record: TaskRecord = { chunks: [], done: false, listener: null };
    this.records.set(taskId, record);

    void (async () => {
      for await (const chunk of agent.runTask(task, sessionKey)) {
        record.chunks.push(chunk);
        record.listener?.onChunk(chunk);
      }
      record.done = true;
      record.listener?.onDone();
    })();

    return taskId;
  }

  has(taskId: string): boolean {
    return this.records.has(taskId);
  }

  attach(taskId: string, onChunk: (chunk: string) => void, onDone: () => void): boolean {
    const record = this.records.get(taskId);
    if (!record) {
      return false;
    }

    for (const chunk of record.chunks) {
      onChunk(chunk);
    }

    if (record.done) {
      onDone();
    } else {
      record.listener = { onChunk, onDone };
    }

    return true;
  }
}
