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

/** One executable runtime/provider/model choice captured at task admission. */
export interface ResolvedRoute {
  readonly runtime: string;
  readonly provider: string;
  readonly model: string;
  readonly billingMode: "fake" | "subscription" | "api";
}

/** Version identifiers of every configuration layer effective for one task. */
export interface EffectiveConfigurationVersions {
  readonly task: string;
  readonly workflow: string;
  readonly specialist: string;
  readonly global: string;
}

/** Immutable route decision persisted before a runtime receives task work. */
export interface ResolvedExecutionPlan {
  readonly planId: string;
  readonly taskId: string;
  readonly route: ResolvedRoute;
  readonly configurationVersions: EffectiveConfigurationVersions;
  readonly resolvedAt: string;
}

/** Provider-neutral runtime output consumed by Sarathi orchestration. */
export type NormalizedRuntimeEvent =
  | { type: "progress"; text: string }
  | { type: "terminal"; outcome: TaskOutcome };

/** A durable, attributable execution of a resolved plan. */
export interface RuntimeAttempt {
  readonly attemptId: string;
  readonly route: ResolvedRoute;
  readonly status: TaskStatus;
  readonly outcome: TaskOutcome | null;
  readonly startedAt: string;
  readonly completedAt: string | null;
  readonly events: ReadonlyArray<NormalizedRuntimeEvent & { readonly observedAt: string }>;
}

export interface RoutedExecutionInput {
  readonly taskId: string;
  readonly task: string;
  readonly sessionKey: string;
  readonly plan: ResolvedExecutionPlan;
  readonly agent: AgentAbstraction;
}

/** Injectable seam for runtime adapters; it never owns task durability. */
export interface RuntimeRouter {
  run(input: RoutedExecutionInput): AsyncIterable<NormalizedRuntimeEvent>;
}
