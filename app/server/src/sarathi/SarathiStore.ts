import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { ActionBoundApproval, PermissionRule, ProviderCatalog, RouteCircuit, RoutePolicyOverride, RoutePolicyScope, RuntimeProof, RuntimeUsage, RuntimeAttribution, TaskStatus, ToolIntent } from "@aios/contracts";
import type { StoredTask } from "../TaskStore.js";
import { defaultModelEnabled } from "./ProviderCatalog.js";

export type SarathiTicketStatus = "complete" | "blocked" | "unmeasured" | "pending";
export type SpecialistStatus = "pending_approval" | "active";

export interface SarathiTicket {
  id: string;
  title: string;
  status: SarathiTicketStatus;
  reason: string;
}

export interface Specialist {
  id: string;
  name: string;
  role: string;
  runtime: string;
  status: SpecialistStatus;
  scope: string;
}

export interface RuntimeStatus {
  name: string;
  state: "unavailable" | "unverified" | "ready";
  billingMode: "fake" | "subscription-only" | "api" | "unmeasured";
  reason: string;
}

export interface RoutePolicyRecord {
  scope: RoutePolicyScope;
  id: string;
  version: string;
  policy: RoutePolicyOverride;
}

export interface DiscoveryState {
  status: "blocked" | "ready";
  reason: string;
  lastCheckedAt: string | null;
  mergeRequests: Array<{
    id: string;
    title: string;
    project: string;
    role: "assignee" | "reviewer";
    coverage: "unknown" | "complete";
  }>;
}

export interface SarathiDashboard {
  runtime: RuntimeStatus;
  routing: { policies: RoutePolicyRecord[] };
  permissions: { rules: PermissionRule[]; approvals: ActionBoundApproval[] };
  providerCatalogs: ProviderCatalog[];
  routeCircuits: RouteCircuit[];
  proofs: RuntimeProof[];
  controls: { manualPaused: boolean; changedAt: string | null };
  discovery: DiscoveryState;
  tickets: SarathiTicket[];
  specialists: Specialist[];
  recentTasks: Array<{
    id: string;
    title: string;
    status: TaskStatus;
    runtime: string;
    planId: string;
    attemptId: string;
    evidence: string | null;
    selectionReason: string | null;
    retryCount: number;
    fallbackCount: number;
    outcomeMessage: string | null;
    usage?: RuntimeUsage;
    attribution?: RuntimeAttribution;
  }>;
  groups: Array<{ id: string; label: string; status: "unresolved" | "ready" | "blocked" }>;
  reviewRounds: Array<{ id: string; label: string; status: "draft" | "blocked" | "published" }>;
  actionBatches: Array<{
    id: string;
    label: string;
    status: "needs_approval" | "approved" | "blocked";
  }>;
  report: { merged: number; blocked: number; skipped: number };
}

export interface SarathiStore {
  snapshot(): SarathiDashboard;
  setPaused(paused: boolean): SarathiDashboard;
  checkDiscovery(): SarathiDashboard;
  recordTask(task: StoredTask): SarathiDashboard;
  createSpecialist(input: { name: string; role: string; runtime: string }): Specialist;
  approveSpecialist(id: string): Specialist | undefined;
  getPolicy(scope: "global" | "specialist" | "workflow", id?: string): RoutePolicyRecord;
  setRoutePolicy(scope: "global" | "specialist" | "workflow", id: string | undefined, policy: RoutePolicyOverride): RoutePolicyRecord;
  recordProviderCatalog(catalog: ProviderCatalog): SarathiDashboard;
  markProviderCatalogStale(provider: string, refreshError: string): ProviderCatalog | null;
  addPermissionRule(rule: PermissionRule): PermissionRule;
  matchAndConsumePermissionRule(intent: ToolIntent, decision: PermissionRule["decision"]): PermissionRule | undefined;
  addApproval(approval: ActionBoundApproval): ActionBoundApproval;
  findMatchingApproval(intent: ToolIntent): ActionBoundApproval | undefined;
  consumeApproval(id: string): void;
  recordCircuit(circuit: RouteCircuit): void;
  recordProof(proof: RuntimeProof): RuntimeProof;
}

export class FileSarathiStore implements SarathiStore {
  private state: SarathiDashboard;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  snapshot(): SarathiDashboard {
    return clone(this.state);
  }

  setPaused(paused: boolean): SarathiDashboard {
    this.state.controls = {
      manualPaused: paused,
      changedAt: new Date().toISOString()
    };
    this.persist();
    return this.snapshot();
  }

  checkDiscovery(): SarathiDashboard {
    this.state.discovery = {
      ...this.state.discovery,
      status: "blocked",
      reason: "GitLab adapter not configured; no external reads attempted.",
      lastCheckedAt: new Date().toISOString()
    };
    this.persist();
    return this.snapshot();
  }

  recordTask(task: StoredTask): SarathiDashboard {
    const plan = task.resolvedExecutionPlan;
    const attempt = task.attempts?.at(-1);
    if (!plan || !attempt) {
      return this.snapshot();
    }

    const lastProgress = [...attempt.events].reverse().find((event) => event.type === "progress");
    const evidence = lastProgress?.type === "progress" ? lastProgress.text : null;
    const summary = {
      id: task.taskId,
      title: task.task,
      status: task.status,
      runtime: attempt.route.runtime,
      planId: plan.planId,
      attemptId: attempt.attemptId,
      evidence,
      selectionReason: attempt.selection?.reason ?? plan.selection?.reason ?? null,
      retryCount: task.canonicalHistory?.filter((event) => event.type === "retry").length ?? 0,
      fallbackCount: task.canonicalHistory?.filter((event) => event.type === "fallback").length ?? 0,
      outcomeMessage: task.outcome?.message ?? null,
      ...(attempt.usage ? { usage: clone(attempt.usage) } : {}),
      ...(attempt.attribution ? { attribution: clone(attempt.attribution) } : {})
    };
    this.state.recentTasks = [
      summary,
      ...this.state.recentTasks.filter((candidate) => candidate.id !== task.taskId)
    ].slice(0, 10);
    this.state.runtime = {
      name: runtimeName(attempt.route.runtime),
      state: attempt.route.billingMode === "unmeasured" ? "unverified" : task.status === "unavailable" ? "unavailable" : "ready",
      billingMode: attempt.route.billingMode === "subscription" ? "subscription-only" : attempt.route.billingMode,
      reason: task.outcome?.message ?? `Attempt ${attempt.attemptId} is ${task.status}.`
    };
    this.persist();
    return this.snapshot();
  }

  createSpecialist(input: { name: string; role: string; runtime: string }): Specialist {
    const specialist: Specialist = {
      id: randomUUID(),
      name: input.name.trim(),
      role: input.role.trim(),
      runtime: input.runtime.trim() || "unselected",
      status: "pending_approval",
      scope: "project context required"
    };
    this.state.specialists.push(specialist);
    this.persist();
    return { ...specialist };
  }

  approveSpecialist(id: string): Specialist | undefined {
    const specialist = this.state.specialists.find((candidate) => candidate.id === id);
    if (!specialist) {
      return undefined;
    }
    specialist.status = "active";
    this.persist();
    return { ...specialist };
  }

  getPolicy(scope: "global" | "specialist" | "workflow", id?: string): RoutePolicyRecord {
    const existing = [...this.state.routing.policies].reverse().find(
      (policy) => policyKey(policy.scope, policy.id) === policyKey(scope, id)
    );
    return clone(existing ?? defaultPolicy(scope, id));
  }

  setRoutePolicy(
    scope: "global" | "specialist" | "workflow",
    id: string | undefined,
    policy: RoutePolicyOverride
  ): RoutePolicyRecord {
    const current = this.getPolicy(scope, id);
    const next: RoutePolicyRecord = {
      scope,
      id: scope === "global" ? "global" : id ?? "",
      version: `${scope}-v${versionNumber(current.version) + 1}`,
      policy: clonePolicy(policy)
    };
    this.state.routing.policies = [...this.state.routing.policies, next];
    if (JSON.stringify(current.policy) !== JSON.stringify(next.policy)) {
      const routes = [current.policy.primary, next.policy.primary, ...(current.policy.fallbacks ?? []), ...(next.policy.fallbacks ?? [])].filter(Boolean);
      this.state.routeCircuits = this.state.routeCircuits.map((circuit) =>
        (circuit.failureKind === "authentication" || circuit.failureKind === "configuration") &&
        routes.some((route) => route!.runtime === circuit.route.runtime && route!.provider === circuit.route.provider && route!.model === circuit.route.model && route!.billingMode === circuit.route.billingMode)
          ? { ...circuit, state: "closed", failureKind: null, consecutiveFailures: 0, openedAt: null, retryAt: null } : circuit);
    }
    this.persist();
    return clone(next);
  }

  recordProviderCatalog(catalog: ProviderCatalog): SarathiDashboard {
    this.state.providerCatalogs = [
      ...this.state.providerCatalogs.filter((candidate) => candidate.provider !== catalog.provider),
      clone(catalog)
    ];
    this.persist();
    return this.snapshot();
  }

  markProviderCatalogStale(provider: string, refreshError: string): ProviderCatalog | null {
    const catalog = this.state.providerCatalogs.find((candidate) => candidate.provider === provider);
    if (!catalog) {
      return null;
    }
    const staleCatalog: ProviderCatalog = { ...catalog, stale: true, refreshError };
    this.state.providerCatalogs = this.state.providerCatalogs.map((candidate) =>
      candidate.provider === provider ? staleCatalog : candidate
    );
    this.persist();
    return clone(staleCatalog);
  }

  addPermissionRule(rule: PermissionRule): PermissionRule {
    this.state.permissions.rules.push(clone(rule));
    this.persist();
    return clone(rule);
  }

  matchAndConsumePermissionRule(intent: ToolIntent, decision: PermissionRule["decision"]): PermissionRule | undefined {
    const index = [...this.state.permissions.rules].reverse().findIndex((rule) => rule.decision === decision && matchesPermissionRule(rule, intent));
    if (index < 0) return undefined;
    const actualIndex = this.state.permissions.rules.length - 1 - index;
    const rule = this.state.permissions.rules[actualIndex]!;
    const remainingUses = rule.remainingUses;
    if (remainingUses !== null) {
      this.state.permissions.rules = this.state.permissions.rules.map((candidate, candidateIndex) =>
        candidateIndex === actualIndex ? { ...candidate, remainingUses: Math.max(0, remainingUses - 1) } : candidate
      );
      this.persist();
    }
    return clone(rule);
  }

  addApproval(approval: ActionBoundApproval): ActionBoundApproval {
    this.state.permissions.approvals.push(clone(approval));
    this.persist();
    return clone(approval);
  }

  findMatchingApproval(intent: ToolIntent): ActionBoundApproval | undefined {
    const approval = [...this.state.permissions.approvals].reverse().find((candidate) =>
      candidate.remainingUses !== 0 && sameIntent(candidate.intent, intent)
    );
    return approval ? clone(approval) : undefined;
  }

  consumeApproval(id: string): void {
    const approval = this.state.permissions.approvals.find((candidate) => candidate.id === id);
    if (!approval || approval.remainingUses === null || approval.remainingUses === 0) return;
    this.state.permissions.approvals = this.state.permissions.approvals.map((candidate) =>
      candidate.id === id ? { ...candidate, remainingUses: candidate.remainingUses! - 1 } : candidate
    );
    this.persist();
  }

  recordCircuit(circuit: RouteCircuit): void {
    this.state.routeCircuits = [...this.state.routeCircuits.filter((entry) =>
      entry.route.runtime !== circuit.route.runtime || entry.route.provider !== circuit.route.provider ||
      entry.route.model !== circuit.route.model || entry.route.billingMode !== circuit.route.billingMode), clone(circuit)];
    this.persist();
  }

  recordProof(proof: RuntimeProof): RuntimeProof {
    this.state.proofs = [...this.state.proofs.filter((entry) => entry.route !== proof.route), clone(proof)];
    this.persist();
    return clone(proof);
  }

  private load(): SarathiDashboard {
    if (!existsSync(this.filePath)) {
      return defaultDashboard();
    }
    return normalizeDashboard(JSON.parse(readFileSync(this.filePath, "utf8")) as SarathiDashboard);
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.state, null, 2));
    renameSync(temporaryPath, this.filePath);
  }
}

const TICKET_TITLES: ReadonlyArray<[string, string]> = [
  ["01", "Close launch decisions"],
  ["02", "Resume a task after restart"],
  ["03", "Configure and chat with specialists"],
  ["04", "Run through one subscription-backed runtime"],
  ["05", "Load scoped context and recover knowledge"],
  ["06", "Use and safely update skills"],
  ["07", "Coordinate bounded delegated work"],
  ["08", "Start at login and control pause"],
  ["09", "Discover assigned MRs"],
  ["10", "Group MRs and untangle Jira links"],
  ["11", "Review a group into evidence-backed drafts"],
  ["12", "Approve revision-bound action batches"],
  ["13", "Publish and maintain inline findings"],
  ["14", "Apply Jira assignment and severity policy"],
  ["15", "Merge eligible groups and complete Jira"],
  ["16", "Confirm Teams identity and send a notification"],
  ["17", "Confirm team holidays"],
  ["18", "Send bounded working-hour reminders"],
  ["19", "Present consolidated delivery reports"],
  ["20", "Verify and package the first release"]
];

function defaultDashboard(): SarathiDashboard {
  return {
    runtime: {
      name: "Hermes",
      state: "unavailable",
      billingMode: "subscription-only",
      reason: "Native runtime launch is not verified on this host."
    },
    routing: { policies: [defaultPolicy("global")] },
    permissions: { rules: [], approvals: [] },
    providerCatalogs: [],
    routeCircuits: [],
    proofs: proofDefaults(),
    controls: { manualPaused: false, changedAt: null },
    discovery: {
      status: "blocked",
      reason: "GitLab adapter not configured; no external reads attempted.",
      lastCheckedAt: null,
      mergeRequests: []
    },
    tickets: TICKET_TITLES.map(([id, title]) => ({
      id,
      title,
      status: id === "02" ? "complete" : "blocked",
      reason:
        id === "02"
          ? "Durable task results and restart replay are implemented."
          : "Blocked by unresolved policy, integration proof, or an earlier ticket."
    })),
    specialists: [
      {
        id: "sarathi",
        name: "Sarathi",
        role: "coordinator",
        runtime: "unselected",
        status: "active",
        scope: "local project"
      }
    ],
    recentTasks: [],
    groups: [],
    reviewRounds: [],
    actionBatches: [],
    report: { merged: 0, blocked: 0, skipped: 0 }
  };
}

function normalizeDashboard(state: SarathiDashboard): SarathiDashboard {
  state.routing ??= { policies: [defaultPolicy("global")] };
  state.permissions ??= { rules: [], approvals: [] };
  state.routeCircuits ??= [];
  state.proofs ??= proofDefaults();
  state.providerCatalogs = (state.providerCatalogs ?? []).map((catalog) => ({
    ...catalog,
    models: catalog.models.map((model) => ({
      ...model,
      enabled: defaultModelEnabled(catalog.provider, model.configured, model.enabled),
      eligible: defaultModelEnabled(catalog.provider, model.configured, model.enabled) && model.configured &&
        Object.values(model.qualification).every((evidence) => evidence === "qualified"),
      tier: model.tier ?? "unclassified"
    }))
  }));
  if (!state.routing.policies.some((policy) => policy.scope === "global")) {
    state.routing.policies.push(defaultPolicy("global"));
  }
  return state;
}

function defaultPolicy(scope: "global" | "specialist" | "workflow", id?: string): RoutePolicyRecord {
  return { scope, id: scope === "global" ? "global" : id ?? "", version: `${scope}-default-v1`, policy: {} };
}

function policyKey(scope: RoutePolicyScope, id?: string): string {
  return `${scope}:${scope === "global" ? "global" : id ?? ""}`;
}

function versionNumber(version: string): number {
  return Number(/-v(\d+)$/.exec(version)?.[1] ?? 0);
}

function clonePolicy(policy: RoutePolicyOverride): RoutePolicyOverride {
  return {
    ...(policy.primary ? { primary: { ...policy.primary } } : {}),
    ...(policy.fallbacks ? { fallbacks: policy.fallbacks.map((route) => ({ ...route })) } : {})
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function runtimeName(runtime: string): string {
  if (runtime === "fake") {
    return "Fake runtime";
  }
  return runtime === "unmeasured" ? "Unmeasured runtime" : runtime;
}

function proofDefaults(): RuntimeProof[] {
  const routes: RuntimeProof["route"][] = ["codex", "claude", "ollama", "custom-openai-compatible", "openai", "anthropic", "openrouter"];
  return routes.map((route) => ({ route, status: "UNMEASURED" as const, reason: "Live contract proof is opt-in and has not been authorized on this host.", checkedAt: null }));
}

function sameIntent(left: ToolIntent, right: ToolIntent): boolean {
  return left.tool === right.tool && left.operation === right.operation && left.target === right.target &&
    JSON.stringify(sorted(left.context)) === JSON.stringify(sorted(right.context));
}

function matchesPermissionRule(rule: PermissionRule, intent: ToolIntent): boolean {
  if (rule.remainingUses === 0 || rule.tool !== intent.tool || rule.operation !== intent.operation || rule.target !== intent.target) return false;
  return Object.entries(rule.context).every(([key, value]) => intent.context[key] === value);
}

function sorted(context: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(context).sort(([left], [right]) => left.localeCompare(right)));
}
