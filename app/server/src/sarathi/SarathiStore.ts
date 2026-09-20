import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import { runMigrations, type StoreMigration } from "../StoreMigrations.js";
import type { ActionBoundApproval, PermissionRule, ProviderCatalog, RouteCircuit, RoutePolicyOverride, RoutePolicyScope, RuntimeProof, RuntimeUsage, RuntimeAttribution, TaskStatus, ToolIntent } from "@aios/contracts";
import type { StoredTask } from "../TaskStore.js";
import { defaultModelEnabled, isModelEligible } from "./ProviderCatalog.js";
import { FLOOR_RULES, isFloorAskKind, isFloorRule } from "./DecisionFloor.js";
import { riskOf, type AskRisk } from "./AskRisk.js";

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

export interface PendingAsk { id: string; kind: string; risk: AskRisk; workItemId: string | null; intent: ToolIntent; createdAt: string; }
export type Autopilot = Record<AskRisk, "ask" | "automatic">;
export interface AutomaticDecision { id: string; intent: ToolIntent; source: "standing rule" | "autopilot"; sourceDetail: string; workItemId: string | null; createdAt: string; undone: boolean; undoable: boolean; }
export interface StandingRuleSuggestion { id: string; askKind: string; scope: string | "all"; state: "offered" | "dismissed" | "accepted"; }
export interface AskAuditEntry { askId: string; decision: "approved" | "declined"; createdAt: string; }
export interface StandingRule { id: string; label: string; askKind: string; scope: string | "all"; enabled: boolean; firedCount: number; permissionRule: PermissionRule; }

export interface SarathiDashboard {
  asks: PendingAsk[];
  automaticDecisions: AutomaticDecision[];
  standingRuleSuggestions: StandingRuleSuggestion[];
  approvalStreak: { askKind: string; scope: string | "all"; count: number } | null;
  askAudit: AskAuditEntry[];
  standingRules: StandingRule[];
  autopilot: Autopilot;
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
  updatePermissionRule(id: string, update: PermissionRule): PermissionRule | undefined;
  deletePermissionRule(id: string): PermissionRule | undefined;
  matchAndConsumePermissionRule(intent: ToolIntent, decision: PermissionRule["decision"]): PermissionRule | undefined;
  matchAndConsumeStandingRule(intent: ToolIntent): StandingRule | undefined;
  addApproval(approval: ActionBoundApproval): ActionBoundApproval;
  findMatchingApproval(intent: ToolIntent): ActionBoundApproval | undefined;
  consumeApproval(id: string): void;
  recordCircuit(circuit: RouteCircuit): void;
  addPendingAsk(input: Omit<PendingAsk, "id" | "createdAt" | "risk">): PendingAsk;
  addStandingRule(rule: StandingRule): StandingRule;
  setStandingRuleEnabled(id: string, enabled: boolean): StandingRule | undefined;
  setAutopilot(autopilot: Autopilot): Autopilot;
  matchesAutopilot(kind: string): boolean;
  addAutomaticDecision(input: Omit<AutomaticDecision, "id" | "createdAt" | "undone">): AutomaticDecision;
  undoAutomaticDecision(id: string): { decision: AutomaticDecision; ask: PendingAsk } | undefined;
  getAutomaticDecision(id: string): AutomaticDecision | undefined;
  recordApprovedAsk(ask: PendingAsk): StandingRuleSuggestion | undefined;
  setStandingRuleSuggestionState(id: string, state: StandingRuleSuggestion["state"]): StandingRuleSuggestion | undefined;
  decideAsk(id: string, decision: AskAuditEntry["decision"]): PendingAsk | undefined;
  recordProof(proof: RuntimeProof): RuntimeProof;
}

const SCHEMA_VERSION = 4;
interface SarathiStoreDocument { schemaVersion: number; dashboard: SarathiDashboard; }
const MIGRATIONS: ReadonlyArray<StoreMigration<SarathiStoreDocument>> = [
  { fromVersion: 0, migrate: (document) => ({ ...document, schemaVersion: 1 }) },
  { fromVersion: 1, migrate: (document) => ({ ...document, schemaVersion: 2, dashboard: { ...document.dashboard, asks: document.dashboard.asks ?? [] } }) }
  , { fromVersion: 2, migrate: (document) => ({ ...document, schemaVersion: 3, dashboard: { ...document.dashboard, askAudit: document.dashboard.askAudit ?? [] } }) }
  , { fromVersion: 3, migrate: (document) => ({ ...document, schemaVersion: 4, dashboard: withFloorRules(document.dashboard) }) }
];

export class FileSarathiStore implements SarathiStore {
  private state: SarathiDashboard;
  private migratedOnOpen = false;

  constructor(private readonly filePath: string) {
    this.state = this.load();
    if (this.migratedOnOpen) this.persist();
  }

  snapshot(): SarathiDashboard {
    const snapshot = clone(this.state);
    snapshot.asks.sort((left, right) => askPriority(left.kind) - askPriority(right.kind) || left.createdAt.localeCompare(right.createdAt));
    return snapshot;
  }

  addPendingAsk(input: Omit<PendingAsk, "id" | "createdAt" | "risk">): PendingAsk {
    const existing = this.state.asks.find((ask) => ask.intent.tool === input.intent.tool && ask.intent.operation === input.intent.operation && ask.intent.target === input.intent.target && JSON.stringify(ask.intent.context) === JSON.stringify(input.intent.context));
    if (existing) return clone(existing);
    const ask = { ...input, risk: riskOf(input.kind), id: randomUUID(), createdAt: new Date().toISOString() };
    this.state.asks.push(ask); this.persist(); return clone(ask);
  }

  addStandingRule(rule: StandingRule): StandingRule {
    this.state.standingRules.push(clone(rule));
    this.state.permissions.rules.push(clone(rule.permissionRule));
    this.persist();
    return clone(rule);
  }

  setStandingRuleEnabled(id: string, enabled: boolean): StandingRule | undefined {
    const rule = this.state.standingRules.find((candidate) => candidate.id === id);
    if (!rule) return undefined;
    rule.enabled = enabled;
    this.state.permissions.rules = this.state.permissions.rules.filter((candidate) => candidate.id !== rule.permissionRule.id);
    if (enabled) this.state.permissions.rules.push(clone(rule.permissionRule));
    this.persist();
    return clone(rule);
  }
  setAutopilot(autopilot: Autopilot): Autopilot { this.state.autopilot = clone(autopilot); this.persist(); return clone(this.state.autopilot); }
  matchesAutopilot(kind: string): boolean { return this.state.autopilot[riskOf(kind)] === "automatic"; }
  addAutomaticDecision(input: Omit<AutomaticDecision, "id" | "createdAt" | "undone">): AutomaticDecision {
    const decision = { ...input, id: randomUUID(), createdAt: new Date().toISOString(), undone: false };
    this.state.automaticDecisions.push(decision); this.persist(); return clone(decision);
  }
  getAutomaticDecision(id: string): AutomaticDecision | undefined {
    const decision = this.state.automaticDecisions.find((entry) => entry.id === id);
    return decision ? clone(decision) : undefined;
  }
  undoAutomaticDecision(id: string): { decision: AutomaticDecision; ask: PendingAsk } | undefined {
    const decision = this.state.automaticDecisions.find((entry) => entry.id === id);
    if (!decision || decision.undone) return undefined;
    decision.undone = true;
    const ask = this.addPendingAsk({ kind: decision.intent.operation, workItemId: decision.workItemId, intent: decision.intent });
    this.persist(); return { decision: clone(decision), ask };
  }
  recordApprovedAsk(ask: PendingAsk): StandingRuleSuggestion | undefined {
    const scope = ask.intent.context.repository ?? "all";
    if (isFloorAskKind(ask.kind)) return undefined;
    const streak = this.state.approvalStreak;
    this.state.approvalStreak = streak?.askKind === ask.kind && streak.scope === scope ? { ...streak, count: streak.count + 1 } : { askKind: ask.kind, scope, count: 1 };
    if (this.state.approvalStreak.count !== 3 || this.state.standingRuleSuggestions.some((item) => item.askKind === ask.kind && item.scope === scope)) { this.persist(); return undefined; }
    const suggestion = { id: randomUUID(), askKind: ask.kind, scope, state: "offered" as const }; this.state.standingRuleSuggestions.push(suggestion); this.persist(); return clone(suggestion);
  }
  setStandingRuleSuggestionState(id: string, state: StandingRuleSuggestion["state"]): StandingRuleSuggestion | undefined { const item = this.state.standingRuleSuggestions.find((entry) => entry.id === id); if (!item || item.state !== "offered") return undefined; item.state = state; this.persist(); return clone(item); }

  decideAsk(id: string, decision: AskAuditEntry["decision"]): PendingAsk | undefined {
    const index = this.state.asks.findIndex((ask) => ask.id === id);
    if (index < 0) return undefined;
    const [ask] = this.state.asks.splice(index, 1);
    this.state.askAudit.push({ askId: id, decision, createdAt: new Date().toISOString() });
    this.persist(); return clone(ask);
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

  updatePermissionRule(id: string, update: PermissionRule): PermissionRule | undefined {
    const index = this.state.permissions.rules.findIndex((rule) => rule.id === id);
    if (index < 0) return undefined;
    if (isFloorRule(this.state.permissions.rules[index]!)) throw new Error("floor rules cannot be edited");
    if (this.isStandingRuleId(id)) throw new Error("standing rules are managed through standing rules");
    this.state.permissions.rules[index] = clone(update); this.persist(); return clone(update);
  }

  deletePermissionRule(id: string): PermissionRule | undefined {
    const index = this.state.permissions.rules.findIndex((rule) => rule.id === id);
    if (index < 0) return undefined;
    const rule = this.state.permissions.rules[index]!;
    if (isFloorRule(rule)) throw new Error("floor rules cannot be deleted");
    if (this.isStandingRuleId(id)) throw new Error("standing rules are managed through standing rules");
    this.state.permissions.rules.splice(index, 1); this.persist(); return clone(rule);
  }

  private isStandingRuleId(permissionRuleId: string): boolean {
    return this.state.standingRules.some((rule) => rule.permissionRule.id === permissionRuleId);
  }

  matchAndConsumeStandingRule(intent: ToolIntent): StandingRule | undefined {
    const standing = this.state.standingRules.find((rule) => rule.enabled && matchesPermissionRule(rule.permissionRule, intent));
    if (!standing) return undefined;
    standing.firedCount += 1;
    this.persist();
    return clone(standing);
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
    const parsed: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
    if (!parsed || typeof parsed !== "object") throw new Error(`Invalid Sarathi store document: ${this.filePath}`);
    const document = "dashboard" in parsed
      ? parsed as SarathiStoreDocument
      : { schemaVersion: 1, dashboard: parsed as SarathiDashboard };
    const schemaVersion = "schemaVersion" in document ? document.schemaVersion : 1;
    if (!Number.isInteger(schemaVersion)) throw new Error(`Invalid Sarathi store schema version: ${this.filePath}`);
    if (schemaVersion > SCHEMA_VERSION) throw new Error(`Sarathi store schema version ${schemaVersion} is newer than supported version ${SCHEMA_VERSION}`);
    this.migratedOnOpen = document.schemaVersion < SCHEMA_VERSION;
    return normalizeDashboard(runMigrations(document, SCHEMA_VERSION, MIGRATIONS).dashboard);
  }

  private persist(): void {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify({ schemaVersion: SCHEMA_VERSION, dashboard: this.state }, null, 2));
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
    asks: [],
    automaticDecisions: [],
    standingRuleSuggestions: [], approvalStreak: null,
    askAudit: [], standingRules: [], autopilot: defaultAutopilot(),
    runtime: {
      name: "Hermes",
      state: "unavailable",
      billingMode: "subscription-only",
      reason: "Native runtime launch is not verified on this host."
    },
    routing: { policies: [defaultPolicy("global")] },
    permissions: { rules: FLOOR_RULES.map(clone), approvals: [] },
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
  state.asks ??= [];
  state.automaticDecisions ??= [];
  state.standingRuleSuggestions ??= []; state.approvalStreak ??= null;
  state.asks = state.asks.map((ask) => ({ ...ask, risk: ask.risk ?? riskOf(ask.kind) }));
  state.askAudit ??= [];
  state.standingRules ??= [];
  state.autopilot ??= defaultAutopilot();
  state.routing ??= { policies: [defaultPolicy("global")] };
  state.permissions ??= { rules: [], approvals: [] };
  state = withFloorRules(state);
  state.routeCircuits ??= [];
  state.proofs ??= proofDefaults();
  state.providerCatalogs = (state.providerCatalogs ?? []).map((catalog) => ({
    ...catalog,
    models: catalog.models.map((model) => ({
      ...model,
      enabled: defaultModelEnabled(catalog.provider, model.configured, model.enabled),
      eligible: isModelEligible(catalog.provider, model),
      tier: model.tier ?? "unclassified"
    }))
  }));
  if (!state.routing.policies.some((policy) => policy.scope === "global")) {
    state.routing.policies.push(defaultPolicy("global"));
  }
  return state;
}
function defaultAutopilot(): Autopilot { return { low: "ask", medium: "ask", high: "ask" }; }

function withFloorRules(state: SarathiDashboard): SarathiDashboard {
  state.permissions ??= { rules: [], approvals: [] };
  for (const floor of FLOOR_RULES) if (!state.permissions.rules.some((rule) => rule.id === floor.id)) state.permissions.rules.push(clone(floor));
  return state;
}

function askPriority(kind: string): number {
  if (kind.includes("recovery")) return 0;
  if (kind.includes("review")) return 1;
  if (kind === "track.change") return 2;
  if (kind.includes("approve") || kind.includes("approval")) return 3;
  if (kind.includes("question")) return 4;
  return 5;
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

export function matchesPermissionRule(rule: PermissionRule, intent: ToolIntent): boolean {
  if (rule.remainingUses === 0 || rule.operation !== intent.operation) return false;
  if (!matchesField(rule.tool, intent.tool) || !matchesField(rule.target, intent.target)) return false;
  return Object.entries(rule.context).every(([key, value]) => intent.context[key] === value);
}

function matchesField(ruleValue: string, intentValue: string): boolean {
  return ruleValue === "*" || ruleValue === intentValue;
}

function sorted(context: Readonly<Record<string, string>>): Record<string, string> {
  return Object.fromEntries(Object.entries(context).sort(([left], [right]) => left.localeCompare(right)));
}
