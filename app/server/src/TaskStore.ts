import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type {
  NormalizedRuntimeEvent,
  ResolvedExecutionPlan,
  RuntimeAttempt,
  TaskOutcome,
  TaskStatus
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
}

export interface TaskStore {
  get(taskId: string): StoredTask | undefined;
  create(task: StoredTask): void;
  applyRuntimeEvent(taskId: string, event: NormalizedRuntimeEvent): void;
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

  applyRuntimeEvent(taskId: string, event: NormalizedRuntimeEvent): void {
    const record = this.require(taskId);
    const attempt = record.attempts?.at(-1);
    if (!attempt) {
      throw new Error(`Task has no durable attempt: ${taskId}`);
    }
    const now = new Date().toISOString();
    const observedEvent = { ...event, observedAt: now };
    record.attempts = [
      ...(record.attempts ?? []).slice(0, -1),
      {
        ...attempt,
        status: event.type === "terminal" ? event.outcome.status : attempt.status,
        outcome: event.type === "terminal" ? { ...event.outcome } : attempt.outcome,
        completedAt: event.type === "terminal" ? now : attempt.completedAt,
        events: [...attempt.events, observedEvent]
      }
    ];
    if (event.type === "progress") {
      record.chunks.push(event.text);
    } else {
      record.status = event.outcome.status;
      record.outcome = { ...event.outcome };
    }
    record.updatedAt = now;
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
      const attempt = task.attempts?.at(-1);
      const terminal = [...(attempt?.events ?? [])]
        .reverse()
        .find((event) => event.type === "terminal");
      if ((task.status === "queued" || task.status === "running") && terminal?.type === "terminal") {
        task.status = terminal.outcome.status;
        task.outcome = { ...terminal.outcome };
        if (attempt) {
          task.attempts = [
            ...(task.attempts ?? []).slice(0, -1),
            {
              ...attempt,
              status: terminal.outcome.status,
              outcome: { ...terminal.outcome },
              completedAt: terminal.observedAt
            }
          ];
        }
        recovered = true;
      } else if (task.status === "queued" || task.status === "running") {
        const now = new Date().toISOString();
        task.status = "unavailable";
        task.outcome = { status: "unavailable", message: INTERRUPTED_MESSAGE };
        if (attempt) {
          task.attempts = [
            ...(task.attempts ?? []).slice(0, -1),
            {
              ...attempt,
              status: "unavailable",
              outcome: { ...task.outcome },
              completedAt: now,
              events: [
                ...attempt.events,
                { type: "terminal", outcome: { ...task.outcome }, observedAt: now }
              ]
            }
          ];
        }
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
    updatedAt: record.updatedAt,
    resolvedExecutionPlan: record.resolvedExecutionPlan
      ? {
          ...record.resolvedExecutionPlan,
          route: { ...record.resolvedExecutionPlan.route },
          ...(record.resolvedExecutionPlan.selection ? {
            selection: {
              ...record.resolvedExecutionPlan.selection,
              requestedRoute: { ...record.resolvedExecutionPlan.selection.requestedRoute },
              effectiveRoute: { ...record.resolvedExecutionPlan.selection.effectiveRoute }
            }
          } : {}),
          fallbackRoutes: (record.resolvedExecutionPlan.fallbackRoutes ?? []).map((route) => ({ ...route })),
          configurationVersions: { ...record.resolvedExecutionPlan.configurationVersions },
          configurationSnapshots: cloneConfigurationSnapshots(record.resolvedExecutionPlan.configurationSnapshots)
        }
      : undefined,
    attempts: record.attempts?.map((attempt) => ({
      ...attempt,
      route: { ...attempt.route },
      ...(attempt.selection ? {
        selection: {
          ...attempt.selection,
          requestedRoute: { ...attempt.selection.requestedRoute },
          effectiveRoute: { ...attempt.selection.effectiveRoute }
        }
      } : {}),
      outcome: attempt.outcome ? { ...attempt.outcome } : null,
      events: attempt.events.map((event) =>
        event.type === "progress"
          ? { ...event }
          : { ...event, outcome: { ...event.outcome } }
      )
    }))
  };
}

function cloneConfigurationSnapshots(
  snapshots: ResolvedExecutionPlan["configurationSnapshots"] | undefined
): ResolvedExecutionPlan["configurationSnapshots"] {
  const source = snapshots ?? {
    task: { version: "task-legacy-v1", policy: {} }, workflow: { version: "workflow-legacy-v1", policy: {} },
    specialist: { version: "specialist-legacy-v1", policy: {} }, global: { version: "global-legacy-v1", policy: {} }
  };
  const copy = (snapshot: (typeof source)["task"]) => ({
    version: snapshot.version,
    policy: {
      ...(snapshot.policy.primary ? { primary: { ...snapshot.policy.primary } } : {}),
      ...(snapshot.policy.fallbacks ? { fallbacks: snapshot.policy.fallbacks.map((route) => ({ ...route })) } : {})
    }
  });
  return { task: copy(source.task), workflow: copy(source.workflow), specialist: copy(source.specialist), global: copy(source.global) };
}
