export type HealthStatus =
  | { ok: true }
  | { ok: false; reason: string };

export interface AgentInfo {
  id: string;
  kind: string;
  displayName: string;
}

export type TaskStream = AsyncIterable<string>;

export interface OrchestratorCapability {
  readonly kind: string;
}

export interface AgentAbstraction {
  getInfo(): AgentInfo;
  checkHealth(): HealthStatus;
  runTask(task: string, sessionKey: string): TaskStream;
  asOrchestrator(): OrchestratorCapability | null;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked"
  | "unavailable";

export type TaskTerminalStatus = Exclude<TaskStatus, "queued" | "running">;

export interface TaskOutcome {
  status: TaskTerminalStatus;
  message?: string;
}
