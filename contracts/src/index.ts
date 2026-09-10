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

export type AgentEngineKind = "hermes" | "codex" | "claude-code";
export type EnginePolicySource = "task" | "workflow" | "agent" | "global";

export interface EngineRoute {
  engine: AgentEngineKind;
  configuration: string;
  model?: string;
  credentialEnv?: string;
  billingMode: "subscription" | "api" | "local";
}

export interface EnginePolicy {
  primary: EngineRoute;
  fallbacks: EngineRoute[];
  fallbackEnabled: boolean;
}

/** A layer may override individual route fields while inheriting the rest. */
export interface EnginePolicyOverride {
  primary?: Partial<EngineRoute>;
  fallbacks?: EngineRoute[];
  fallbackEnabled?: boolean;
  version?: number;
}

export interface ResolvedEnginePlan {
  primary: EngineRoute;
  fallbacks: EngineRoute[];
  source: EnginePolicySource;
  configurationVersions: Record<EnginePolicySource, number | null>;
}

export interface EngineReadiness {
  state: "ready" | "unavailable" | "unmeasured";
  reason: string;
  checkedAt: string;
}

export interface EngineConsent {
  crossEngineFallback: boolean;
  paidFallback: boolean;
  acceptedAt: string | null;
}

export interface EngineConfigDocument {
  version: 1;
  global: EnginePolicyOverride & { version: number };
  workflows: Record<string, EnginePolicyOverride & { version: number }>;
  agents: Record<string, EnginePolicyOverride & { version: number }>;
  consent: EngineConsent;
}
