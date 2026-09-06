import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname } from "node:path";
import type { RoutePolicyOverride, RoutePolicyScope, TaskStatus } from "@aios/contracts";
import type { StoredTask } from "../TaskStore.js";

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
      runtime: plan.route.runtime,
      planId: plan.planId,
      attemptId: attempt.attemptId,
      evidence
    };
    this.state.recentTasks = [
      summary,
      ...this.state.recentTasks.filter((candidate) => candidate.id !== task.taskId)
    ].slice(0, 10);
    this.state.runtime = {
      name: runtimeName(plan.route.runtime),
      state: plan.route.billingMode === "unmeasured" ? "unverified" : task.status === "unavailable" ? "unavailable" : "ready",
      billingMode: plan.route.billingMode === "subscription" ? "subscription-only" : plan.route.billingMode,
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
    const existing = this.state.routing.policies.find(
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
    this.state.routing.policies = [
      ...this.state.routing.policies.filter((candidate) => policyKey(candidate.scope, candidate.id) !== policyKey(scope, id)),
      next
    ];
    this.persist();
    return clone(next);
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
