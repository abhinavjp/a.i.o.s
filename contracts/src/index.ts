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
  readonly billingMode: "fake" | "subscription" | "api" | "unmeasured";
}

/** Fixed-route evidence captured before runtime work begins. */
export interface RouteSelection {
  readonly requestedRoute: ResolvedRoute;
  readonly effectiveRoute: ResolvedRoute;
  readonly authenticationMode: ProviderAuthenticationMode | "fake";
  readonly billingMode: ResolvedRoute["billingMode"];
  readonly reason: string;
}

/** Operator-editable policy fields; omitted fields inherit from lower precedence. */
export interface RoutePolicyOverride {
  readonly primary?: ResolvedRoute;
  readonly fallbacks?: ReadonlyArray<ResolvedRoute>;
}

/** Immutable policy evidence retained with a resolved execution plan. */
export interface RoutePolicySnapshot {
  readonly version: string;
  readonly policy: RoutePolicyOverride;
}

export type RoutePolicyScope = "global" | "specialist" | "workflow" | "task";

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
  readonly selection?: RouteSelection;
  readonly fallbackRoutes: ReadonlyArray<ResolvedRoute>;
  readonly configurationVersions: EffectiveConfigurationVersions;
  readonly configurationSnapshots: {
    readonly task: RoutePolicySnapshot;
    readonly workflow: RoutePolicySnapshot;
    readonly specialist: RoutePolicySnapshot;
    readonly global: RoutePolicySnapshot;
  };
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
  readonly selection?: RouteSelection;
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
  /** The only tool capability runtime adapters receive. */
  executeTool(intent: ToolIntent): Promise<ToolExecutionResult>;
}

/** Injectable seam for runtime adapters; it never owns task durability. */
export interface RuntimeRouter {
  run(input: RoutedExecutionInput): AsyncIterable<NormalizedRuntimeEvent>;
}

/** Authentication evidence for a provider catalog; no secret values are stored. */
export type ProviderAuthenticationMode = "none" | "subscription" | "environment-reference" | "unmeasured";

/** Evidence is explicit so unknown capability claims cannot make a route eligible. */
export type QualificationEvidence = "qualified" | "unqualified" | "unknown";

export interface ModelQualification {
  readonly health: QualificationEvidence;
  readonly streaming: QualificationEvidence;
  readonly structuredOutput: QualificationEvidence;
  readonly toolCalling: QualificationEvidence;
}

export interface DiscoveredProviderModel {
  readonly model: string;
  /** Omitted legacy discovery records inherit enabled from configured. */
  readonly enabled?: boolean;
  readonly configured: boolean;
  readonly qualification: ModelQualification;
}

export interface ProviderCatalogDiscovery {
  readonly authenticationMode: ProviderAuthenticationMode;
  readonly provenance: string;
  readonly observedAt: string;
  readonly completeness: "complete" | "incomplete";
  readonly models: ReadonlyArray<DiscoveredProviderModel>;
}

/** Injectable provider boundary; production adapters arrive in later tickets. */
export interface ProviderCatalogAdapter {
  readonly provider: string;
  discover(): Promise<ProviderCatalogDiscovery>;
}

export interface ProviderCatalogModel extends DiscoveredProviderModel {
  readonly id: string;
  readonly enabled: boolean;
  readonly eligible: boolean;
}

export interface ProviderCatalog {
  readonly provider: string;
  readonly authenticationMode: ProviderAuthenticationMode;
  readonly provenance: string;
  readonly observedAt: string;
  readonly completeness: "complete" | "incomplete";
  readonly stale: boolean;
  readonly refreshError: string | null;
  readonly models: ReadonlyArray<ProviderCatalogModel>;
}

/** Sarathi-owned, named tool surface exposed to every runtime. */
export interface ToolDefinition {
  readonly tool: string;
  readonly operations: ReadonlyArray<string>;
}

/** A runtime can request an intent, but never execute it directly. */
export interface ToolIntent {
  readonly tool: string;
  readonly operation: string;
  readonly target: string;
  readonly context: Readonly<Record<string, string>>;
}

export type PermissionRuleDecision = "deny" | "ask" | "allow";
export type ApprovalLifetime = "once" | "session" | "project" | "global";

/** A narrow structured rule; raw commands are intentionally not representable. */
export interface PermissionRule {
  readonly id: string;
  readonly decision: PermissionRuleDecision;
  readonly tool: string;
  readonly operation: string;
  readonly target: string;
  readonly lifetime: ApprovalLifetime;
  readonly context: Readonly<Record<string, string>>;
  readonly remainingUses: number | null;
  readonly createdAt: string;
}

/** Operator authority is bound to the whole proposed intent and its context. */
export interface ActionBoundApproval {
  readonly id: string;
  readonly intent: ToolIntent;
  readonly lifetime: ApprovalLifetime;
  readonly remainingUses: number | null;
  readonly createdAt: string;
}

export type PermissionDecision =
  | { readonly outcome: "allowed"; readonly reason: string }
  | { readonly outcome: "denied"; readonly reason: string }
  | { readonly outcome: "requires_approval"; readonly reason: string };

export interface ToolExecutionResult {
  readonly decision: PermissionDecision;
  readonly output?: string;
}

export interface SarathiToolExecutor {
  readonly definitions: ReadonlyArray<ToolDefinition>;
  execute(intent: ToolIntent): Promise<{ readonly output: string }>;
}

/** Optional semantic classifier; it may only identify unresolved low-risk work. */
export interface PermissionSemanticClassifier {
  classify(intent: ToolIntent): Promise<"low-risk" | "requires-approval">;
}
