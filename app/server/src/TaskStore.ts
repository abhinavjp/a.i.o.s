import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { TaskOutcome, TaskStatus } from "@aios/contracts";

export interface StoredTask {
  taskId: string;
  task: string;
  sessionKey: string;
  chunks: string[];
  status: TaskStatus;
  outcome: TaskOutcome | null;
  createdAt: string;
  updatedAt: string;
}

export interface TaskStore {
  get(taskId: string): StoredTask | undefined;
  create(task: StoredTask): void;
  appendChunk(taskId: string, chunk: string): void;
  complete(taskId: string, outcome: TaskOutcome): void;
}

const INTERRUPTED_MESSAGE = "task interrupted by backend restart";

export class FileTaskStore implements TaskStore {
  private readonly records = new Map<string, StoredTask>();

  constructor(private readonly filePath: string) {
    this.load();
  }

  get(taskId: string): StoredTask | undefined {
    const record = this.records.get(taskId);
    return record ? cloneRecord(record) : undefined;
  }

  create(task: StoredTask): void {
    if (this.records.has(task.taskId)) {
      throw new Error(`Task already exists: ${task.taskId}`);
    }

    this.records.set(task.taskId, cloneRecord(task));
    this.persist();
  }

  appendChunk(taskId: string, chunk: string): void {
    const record = this.require(taskId);
    record.chunks.push(chunk);
    record.updatedAt = new Date().toISOString();
    this.persist();
  }

  complete(taskId: string, outcome: TaskOutcome): void {
    const record = this.require(taskId);
    record.status = outcome.status;
    record.outcome = { ...outcome };
    record.updatedAt = new Date().toISOString();
    this.persist();
  }

  private load(): void {
    if (!existsSync(this.filePath)) {
      return;
    }

    const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!Array.isArray(parsed)) {
      throw new Error(`Task store must contain an array: ${this.filePath}`);
    }

    let recovered = false;
    for (const value of parsed) {
      const task = cloneRecord(value as StoredTask);
      if (task.status === "queued" || task.status === "running") {
        const now = new Date().toISOString();
        task.status = "unavailable";
        task.outcome = { status: "unavailable", message: INTERRUPTED_MESSAGE };
        task.updatedAt = now;
        recovered = true;
      }
      this.records.set(task.taskId, task);
    }

    if (recovered) {
      this.persist();
    }
  }

  private require(taskId: string): StoredTask {
    const record = this.records.get(taskId);
    if (!record) {
      throw new Error(`Task not found: ${taskId}`);
    }
    return record;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify([...this.records.values()], null, 2));
    renameSync(temporaryPath, this.filePath);
  }
}

function cloneRecord(record: StoredTask): StoredTask {
  return {
    taskId: record.taskId,
    task: record.task,
    sessionKey: record.sessionKey,
    chunks: [...record.chunks],
    status: record.status,
    outcome: record.outcome ? { ...record.outcome } : null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}
