import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  CanonicalHistoryEntry, CanonicalHistoryEvent, NormalizedRuntimeEvent,
  ResolvedExecutionPlan, RuntimeAttempt, TaskOutcome, TaskStatus
} from "@aios/contracts";

export interface StoredTask {
  taskId: string;
  task: string;
  sessionKey: string;
  chunks: string[];
  status: TaskStatus;
  outcome: TaskOutcome | null;
  createdAt: string;
  updatedAt: string;
  resolvedExecutionPlan?: ResolvedExecutionPlan;
  attempts?: RuntimeAttempt[];
  canonicalHistory?: CanonicalHistoryEntry[];
}

export interface TaskStore {
  get(taskId: string): StoredTask | undefined;
  list(): StoredTask[];
  create(task: StoredTask): void;
  applyRuntimeEvent(taskId: string, event: NormalizedRuntimeEvent, terminalTask?: boolean): void;
  appendHistory(taskId: string, event: CanonicalHistoryEvent): void;
  startAttempt(taskId: string, attempt: RuntimeAttempt): void;
  completeTask(taskId: string, outcome: TaskOutcome): void;
}

/** A started effect without a confirmed result cannot be silently replayed. */
export function needsReconciliation(task: StoredTask): boolean {
  const history = task.canonicalHistory ?? [];
  return history.some((event) => event.type === "tool-started" && !event.idempotent &&
    !history.some((result) => result.type === "tool-result" && result.idempotencyKey === event.idempotencyKey && result.result.effect === "completed"));
}

export class FileTaskStore implements TaskStore {
  private readonly records = new Map<string, StoredTask>();

  constructor(private readonly filePath: string, private readonly now: () => number = Date.now) {
    this.load();
  }

  get(taskId: string): StoredTask | undefined {
    const record = this.records.get(taskId);
    return record ? clone(record) : undefined;
  }

  list(): StoredTask[] { return [...this.records.values()].map(clone); }

  create(task: StoredTask): void {
    if (this.records.has(task.taskId)) throw new Error(`Task already exists: ${task.taskId}`);
    const record = clone(task);
    this.seedHistory(record);
    this.records.set(task.taskId, record);
    this.persist();
  }

  applyRuntimeEvent(taskId: string, event: NormalizedRuntimeEvent, terminalTask = true): void {
    const record = this.require(taskId);
    const attempt = record.attempts?.at(-1);
    if (!attempt) throw new Error(`Task has no durable attempt: ${taskId}`);
    if (record.outcome || attempt.outcome) return;
    const now = this.timestamp();
    record.attempts = [...record.attempts!.slice(0, -1), {
      ...attempt,
      ...(event.type === "resume" ? { resumeMetadata: clone(event.metadata) } : {}),
      ...(event.type === "usage" ? { usage: clone(event.usage), ...(event.attribution ? { attribution: clone(event.attribution) } : {}) } : {}),
      ...(event.type === "terminal" && event.outcome.usage ? { usage: clone(event.outcome.usage) } : {}),
      ...(event.type === "terminal" && event.outcome.attribution ? { attribution: clone(event.outcome.attribution) } : {}),
      status: event.type === "terminal" ? event.outcome.status : attempt.status,
      outcome: event.type === "terminal" ? clone(event.outcome) : null,
      completedAt: event.type === "terminal" ? now : null,
      events: [...attempt.events, { ...clone(event), observedAt: now }]
    }];
    if (event.type === "progress") {
      record.chunks.push(event.text);
      this.append(record, { type: "message", role: "assistant", text: event.text });
    } else if (event.type === "terminal") {
      this.append(record, { type: "attempt-finished", outcome: event.outcome });
      if (terminalTask) this.complete(record, event.outcome);
    }
    record.updatedAt = now;
    this.persist();
  }

  appendHistory(taskId: string, event: CanonicalHistoryEvent): void {
    const record = this.require(taskId);
    if (record.outcome) return;
    this.append(record, event);
    this.persist();
  }

  startAttempt(taskId: string, attempt: RuntimeAttempt): void {
    const record = this.require(taskId);
    if (record.outcome || !record.attempts?.at(-1)?.outcome) throw new Error("Attempt requires a durable finished boundary");
    record.attempts = [...record.attempts, clone(attempt)];
    this.append(record, { type: "attempt-started", route: attempt.route });
    this.persist();
  }

  completeTask(taskId: string, outcome: TaskOutcome): void {
    const record = this.require(taskId);
    if (record.outcome) return;
    this.complete(record, outcome);
    this.persist();
  }

  private complete(record: StoredTask, outcome: TaskOutcome): void {
    record.status = outcome.status;
    record.outcome = clone(outcome);
    this.append(record, { type: "outcome", outcome });
  }

  private append(record: StoredTask, event: CanonicalHistoryEvent, attemptId = record.attempts?.at(-1)?.attemptId ?? null): void {
    record.canonicalHistory ??= [];
    record.updatedAt = this.timestamp();
    record.canonicalHistory.push({ ...clone(event), sequence: record.canonicalHistory.length + 1,
      observedAt: record.updatedAt, attemptId });
  }

  private seedHistory(record: StoredTask): void {
    if (record.canonicalHistory) return;
    this.append(record, { type: "message", role: "user", text: record.task }, null);
    for (const attempt of record.attempts ?? []) {
      this.append(record, { type: "attempt-started", route: attempt.route }, attempt.attemptId);
      for (const event of attempt.events) {
        if (event.type === "progress") this.append(record, { type: "message", role: "assistant", text: event.text }, attempt.attemptId);
        if (event.type === "terminal") this.append(record, { type: "attempt-finished", outcome: event.outcome }, attempt.attemptId);
      }
    }
    if (!record.attempts?.length) for (const text of record.chunks) this.append(record, { type: "message", role: "assistant", text });
    if (record.outcome) this.append(record, { type: "outcome", outcome: record.outcome });
  }

  private load(): void {
    if (!existsSync(this.filePath)) return;
    const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!Array.isArray(parsed)) throw new Error(`Task store must contain an array: ${this.filePath}`);
    let recovered = false;
    for (const value of parsed) {
      const task = clone(value as StoredTask);
      if (!task.canonicalHistory) { this.seedHistory(task); recovered = true; }
      this.records.set(task.taskId, task);
    }
    for (const task of this.records.values()) {
      if (task.status !== "queued" && task.status !== "running") continue;
      const attempt = task.attempts?.at(-1);
      const terminal = [...(attempt?.events ?? [])].reverse().find((event) => event.type === "terminal");
      const cancelled = task.canonicalHistory?.some((event) => event.type === "cancellation-requested");
      const outcome: TaskOutcome = cancelled ? { status: "cancelled", message: "Cancellation recovered after backend restart" }
        : needsReconciliation(task) ? { status: "blocked", message: "Uncertain non-idempotent effect requires reconciliation" }
        : terminal?.type === "terminal" ? terminal.outcome
        : { status: "unavailable", message: "task interrupted by backend restart" };
      if (attempt && !attempt.outcome) {
        task.attempts = [...task.attempts!.slice(0, -1), { ...attempt, status: outcome.status, outcome: clone(outcome),
          completedAt: this.timestamp(), events: terminal ? attempt.events : [...attempt.events, { type: "terminal", outcome: clone(outcome), observedAt: this.timestamp() }] }];
        if (!terminal) this.append(task, { type: "attempt-finished", outcome });
      }
      this.complete(task, outcome);
      recovered = true;
    }
    if (recovered) this.persist();
  }

  private timestamp(): string { return new Date(this.now()).toISOString(); }

  private require(taskId: string): StoredTask {
    const record = this.records.get(taskId);
    if (!record) throw new Error(`Task not found: ${taskId}`);
    return record;
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify([...this.records.values()], null, 2));
    renameSync(temporaryPath, this.filePath);
  }
}

function clone<T>(value: T): T { return JSON.parse(JSON.stringify(value)) as T; }
