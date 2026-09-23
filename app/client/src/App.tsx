import { useEffect, useRef, useState } from "react";
import type {
  AgentInfo,
  AgentEngineKind,
  EngineRoute,
  EngineReadiness,
  ResolvedEnginePlan,
  CanonicalHistoryEntry,
  RouteCircuit,
  HealthStatus,
  TaskOutcome,
  TaskTerminalStatus,
  RuntimeAttribution,
  RuntimeProof,
  RuntimeUsage
} from "@aios/contracts";
import { RoutingPage } from "./routing/RoutingPage.js";
import { WorkItemsPage } from "./work-items/WorkItemsPage.js";
import { MissionControlShell } from "./mission-control/MissionControlShell.js";
import { ConnectorCenter } from "./mission-control/ConnectorCenter.js";
import { decideCanonicalAsk, readConnectorOverview, readMissionControlBoard, refreshGitLabDiscussions, refreshJiraWorkItems, resolveCanonicalStandingRuleSuggestion, saveCanonicalAutopilot, saveCredentialToKeychain, setCanonicalStandingRule, undoCanonicalAutomaticDecision, type AutopilotSettings, type BoardLoad, type ConnectorOverview } from "./mission-control/api.js";
import "./App.css";

type AgentListItem = AgentInfo & { health: HealthStatus };
type AgentSlot = { id: string; slotLimit: number; slotsInUse: number; full: boolean };
type RunStatus = "idle" | "running" | TaskTerminalStatus;
type TaskStall = { state: "active" | "nudge" | "stop"; lastOutputAt: string | null };

type Dashboard = {
  activity: Array<{ id: string; occurredAt: string; agent: string; workItemId: string | null; what: string }>;
  asks: Array<{ id: string; kind: string; risk?: "low" | "medium" | "high"; workItemId: string | null; createdAt: string; intent: { tool: string; operation?: string; target?: string; context: Record<string, string> } }>;
  automaticDecisions: Array<{ id: string; intent: { operation: string; target: string }; source: "standing rule" | "autopilot"; sourceDetail: string; workItemId: string | null; createdAt: string; undone: boolean; undoable: boolean }>;
  standingRuleSuggestions: Array<{ id: string; askKind: string; scope: string; state?: "offered" | "accepted" | "dismissed" }>;
  standingRules: Array<{ id: string; label: string; askKind: string; scope: string; enabled: boolean; firedCount: number }>;
  autopilot: AutopilotSettings;
  runtime: {
    name: string;
    state: "unavailable" | "unverified" | "ready";
    billingMode: "fake" | "subscription-only" | "api" | "unmeasured";
    reason: string;
  };
  controls: { manualPaused: boolean; changedAt: string | null };
  routing: { policies: Array<{ scope: "global" | "specialist" | "workflow" | "task"; id: string; version: string }> };
  providerCatalogs: Array<{
    provider: string;
    authenticationMode: "none" | "subscription" | "environment-reference" | "unmeasured";
    provenance: string;
    observedAt: string;
    completeness: "complete" | "incomplete";
    stale: boolean;
    refreshError: string | null;
    securityStatus?: "measured" | "unmeasured";
    credentialReference?: string;
    models: Array<{
      id: string;
      model: string;
      enabled: boolean;
      configured: boolean;
      eligible: boolean;
      tier?: string;
      contextWindow?: number | "unknown";
      qualification: { health: string; streaming: string; structuredOutput: string; toolCalling: string };
    }>;
  }>;
  routeCircuits: RouteCircuit[];
  discovery: {
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
  };
  tickets: Array<{
    id: string;
    title: string;
    status: "complete" | "blocked" | "unmeasured" | "pending";
    reason: string;
  }>;
  specialists: Array<{
    id: string;
    name: string;
    role: string;
    runtime: string;
    status: "pending_approval" | "active";
    scope: string;
    slotLimit: number;
    capabilityTags?: string[];
  }>;
  recentTasks: Array<{
    id: string;
    title: string;
    status: "queued" | "running" | "completed" | "failed" | "blocked" | "unavailable" | "cancelled";
    runtime: string;
    planId: string;
    attemptId: string;
    evidence: string | null;
    selectionReason: string | null;
    retryCount?: number;
    fallbackCount?: number;
    outcomeMessage?: string | null;
    usage?: RuntimeUsage;
    attribution?: RuntimeAttribution;
  }>;
  proofs: RuntimeProof[];
  groups: Array<{ id: string; label: string; status: "unresolved" | "ready" | "blocked" }>;
  reviewRounds: Array<{ id: string; label: string; status: "draft" | "blocked" | "published" }>;
  actionBatches: Array<{
    id: string;
    label: string;
    status: "needs_approval" | "approved" | "blocked";
  }>;
  report: { merged: number; blocked: number; skipped: number };
};

type Specialist = Dashboard["specialists"][number];

const LAST_TASK_STORAGE_KEY = "lastTaskId";
const DEFAULT_PROOFS: RuntimeProof[] = ["codex", "claude", "ollama", "custom-openai-compatible", "openai", "anthropic", "openrouter"].map((route) => ({
  route: route as RuntimeProof["route"], status: "UNMEASURED", reason: "Live contract proof is opt-in and has not been authorized on this host.", checkedAt: null
}));

const DEFAULT_DASHBOARD: Dashboard = {
  activity: [],
  asks: [],
  automaticDecisions: [],
  standingRuleSuggestions: [],
  standingRules: [],
  autopilot: { low: "ask", medium: "ask", high: "ask" },
  runtime: {
    name: "Hermes",
    state: "unavailable",
    billingMode: "subscription-only",
    reason: "Native runtime launch is not verified on this host."
  },
  controls: { manualPaused: false, changedAt: null },
  routing: { policies: [] },
  providerCatalogs: [],
  routeCircuits: [],
  proofs: DEFAULT_PROOFS,
  discovery: {
    status: "blocked",
    reason: "GitLab adapter not configured; no external reads attempted.",
    lastCheckedAt: null,
    mergeRequests: []
  },
  tickets: [],
  specialists: [],
  recentTasks: [],
  groups: [],
  reviewRounds: [],
  actionBatches: [],
  report: { merged: 0, blocked: 0, skipped: 0 }
};

function parseTaskOutcome(data: string): TaskOutcome {
  if (!data) {
    return { status: "completed" };
  }

  try {
    const parsed: unknown = JSON.parse(data);
    if (typeof parsed === "object" && parsed !== null) {
      const status = (parsed as { status?: unknown }).status;
      if (
        status === "completed" ||
        status === "failed" ||
        status === "blocked" ||
        status === "cancelled" ||
        status === "unavailable"
      ) {
        const message = (parsed as { message?: unknown }).message;
        const failure = (parsed as { failure?: TaskOutcome["failure"] }).failure;
        const usage = (parsed as { usage?: RuntimeUsage }).usage;
        const attribution = (parsed as { attribution?: RuntimeAttribution }).attribution;
        return { status, ...(typeof message === "string" ? { message } : {}), ...(failure ? { failure } : {}), ...(usage ? { usage } : {}), ...(attribution ? { attribution } : {}) };
      }
    }
  } catch {
    // Invalid terminal data is a failed outcome, never a successful one.
  }

  return { status: "failed", message: "task returned an invalid outcome" };
}

function trackChangeSummary(ask: Dashboard["asks"][number]): string | null {
  if (ask.kind !== "track.change") return null;
  try {
    const current = JSON.parse(ask.intent.context.currentTrack ?? "") as unknown;
    const proposed = JSON.parse(ask.intent.context.proposedTrack ?? "") as unknown;
    if (!Array.isArray(current) || !Array.isArray(proposed) || current.some((stage) => typeof stage !== "string") || proposed.some((stage) => typeof stage !== "string")) return null;
    return `Current track: ${current.join(" → ")}\nProposed track: ${proposed.join(" → ")}`;
  } catch { return null; }
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
}

function formatUsage(usage?: RuntimeUsage): string {
  if (!usage) return "usage unknown";
  const tokens = [usage.inputTokens, usage.outputTokens].every((value) => typeof value === "number")
    ? `${usage.inputTokens} in · ${usage.outputTokens} out tokens` : "tokens unknown";
  const cost = usage.cost === "unknown" ? "cost unknown" : `${usage.costKind} cost ${usage.cost}${usage.currency ? ` ${usage.currency}` : ""}`;
  return `${tokens} · ${cost}`;
}

function describeHistory(entry: CanonicalHistoryEntry): string {
  switch (entry.type) {
    case "message": return `${entry.role}: ${entry.text}`;
    case "tool-intent": return `${entry.intent.tool}: ${entry.intent.operation} ${entry.intent.target}`;
    case "permission-decision": return `Permission: ${entry.decision.outcome} · ${entry.decision.reason}`;
    case "tool-result": return `Tool result: ${entry.result.output ?? entry.result.error ?? entry.result.decision.outcome}`;
    case "attempt-started": return `Attempt started: ${entry.route.provider}/${entry.route.model}`;
    case "attempt-finished": return `Attempt finished: ${entry.outcome.status}`;
    case "retry": return `Retry ${entry.retryNumber} after ${entry.delayMs} ms`;
    case "fallback": return `Fallback: ${entry.to.provider}/${entry.to.model} · ${entry.reason}`;
    case "tool-started": return "Tool execution started";
    case "cancellation-requested": return "Operator requested cancellation";
    case "outcome": return `Outcome: ${entry.outcome.status} · ${entry.outcome.message ?? ""}`;
  }
}

function formatToday(): string {
  return new Intl.DateTimeFormat("en", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric"
  }).format(new Date());
}

export function App() {
  const [runningVersion, setRunningVersion] = useState<string | null>(null);
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [agentsStatus, setAgentsStatus] = useState<"loading" | "available" | "error">("loading");
  const [agentSlots, setAgentSlots] = useState<AgentSlot[]>([]);
  const [agentSlotsStatus, setAgentSlotsStatus] = useState<"loading" | "available" | "error">("loading");
  const [dashboard, setDashboard] = useState<Dashboard>(DEFAULT_DASHBOARD);
  const [dashboardStatus, setDashboardStatus] = useState<"loading" | "available" | "error">("loading");
  const [boardLoad, setBoardLoad] = useState<BoardLoad>({ status: "loading" });
  const [connectorOverview, setConnectorOverview] = useState<ConnectorOverview>({ workSource: { status: "loading" }, codeHost: { status: "loading" }, jiraSync: { status: "loading" }, gitLabSync: { status: "loading" } });
  const [task, setTask] = useState("");
  const [taskRouting, setTaskRouting] = useState({ specialistId: "", workflowId: "", capabilityTag: "", overridePrimary: false, primaryModel: "fake", overrideFallback: false, fallbackModel: "" });
  const [status, setStatus] = useState<RunStatus>("idle");
  const [activeStall, setActiveStall] = useState<TaskStall | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [executionMessage, setExecutionMessage] = useState<string | null>(null);
  const [history, setHistory] = useState<CanonicalHistoryEntry[] | null>(null);
  const [output, setOutput] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSpecialistFormOpen, setIsSpecialistFormOpen] = useState(false);
  const [specialistDraft, setSpecialistDraft] = useState({
    name: "",
    role: "",
    runtime: "unselected",
    slotLimit: 1,
    capabilityTags: ""
  });
  const [specialistMessage, setSpecialistMessage] = useState<string | null>(null);
  const [view, setView] = useState<"command" | "legacy" | "advanced-routing" | "work-items">("command");
  const [advancedSpecialistId, setAdvancedSpecialistId] = useState<string | null>(null);
  const [catchUpIndex, setCatchUpIndex] = useState<number | null>(null);
  const [taskEngine, setTaskEngine] = useState<"inherit" | AgentEngineKind>("inherit");
  const [taskConfiguration, setTaskConfiguration] = useState("default");
  const [taskModel, setTaskModel] = useState("");
  const [admission, setAdmission] = useState<{ plan?: ResolvedEnginePlan; executedEngineRoute?: EngineRoute; attemptedEngineRoutes?: EngineRoute[]; readiness?: EngineReadiness; outcome?: TaskOutcome } | null>(null);
  const [routeDraft, setRouteDraft] = useState({ scope: "global" as "global" | "specialist" | "workflow", id: "", primaryModel: "fake", fallbackModel: "", overridePrimary: true, overrideFallback: false });
  const [routeMessage, setRouteMessage] = useState<string | null>(null);
  const [proofMessage, setProofMessage] = useState<string | null>(null);
  const [setup, setSetup] = useState<{ firstRun: boolean; steps: { workSource: boolean; codeHost: boolean; agent: boolean } } | null>(null);
  const [setupDismissed, setSetupDismissed] = useState(false);
  const eventSourceRef = useRef<EventSource | null>(null);
  const dashboardRefreshGeneration = useRef(0);
  const connectorRefreshGeneration = useRef(0);

  function openTaskStream(taskId: string) {
    eventSourceRef.current?.close();
    setOutput([]);
    setStatus("running");
    setActiveTaskId(taskId);
    setExecutionMessage(null);
    localStorage.setItem(LAST_TASK_STORAGE_KEY, taskId);

    const eventSource = new EventSource(`/api/agents/active/tasks/${taskId}/stream`);
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      setOutput((previous) => [...previous, event.data]);
    };

    eventSource.addEventListener("done", (event) => {
      const outcome = parseTaskOutcome((event as MessageEvent<string>).data);
      eventSource.close();
      setStatus(outcome.status);
      void refreshDashboard();
    });
  }

  async function refreshDashboard() {
    const generation = dashboardRefreshGeneration.current + 1;
    dashboardRefreshGeneration.current = generation;
    const [dashboardRead, slotsRead] = await Promise.allSettled([
      fetch("/api/sarathi/dashboard").then(async (response) => ({ response, data: await response.json() as Partial<Dashboard> })),
      fetch("/api/sarathi/agents").then(async (response) => ({ response, data: await response.json() as { agents?: AgentSlot[] } }))
    ]);
    if (generation !== dashboardRefreshGeneration.current) return;
    if (slotsRead.status === "fulfilled" && slotsRead.value.response.ok !== false && Array.isArray(slotsRead.value.data.agents)) {
      setAgentSlots(slotsRead.value.data.agents);
      setAgentSlotsStatus("available");
    } else setAgentSlotsStatus("error");
    if (dashboardRead.status === "fulfilled" && dashboardRead.value.response.ok !== false) {
      const next = dashboardRead.value.data;
      if (Array.isArray(next.tickets) && next.runtime && next.discovery) {
        setDashboard({ ...DEFAULT_DASHBOARD, ...next, activity: next.activity ?? [], providerCatalogs: next.providerCatalogs ?? [], proofs: next.proofs ?? DEFAULT_PROOFS });
        setDashboardStatus("available");
        return;
      }
    }
    setDashboardStatus("error");
  }

  async function refreshConnectorOverview() {
    const generation = connectorRefreshGeneration.current + 1;
    connectorRefreshGeneration.current = generation;
    const next = await readConnectorOverview();
    if (generation === connectorRefreshGeneration.current) setConnectorOverview(next);
  }

  async function refreshMissionControlBoard() {
    setBoardLoad(await readMissionControlBoard());
  }

  async function refreshJiraFromMissionControl() {
    const result = await refreshJiraWorkItems();
    await Promise.all([refreshConnectorOverview(), refreshDashboard(), refreshMissionControlBoard()]);
    return result;
  }

  async function refreshGitLabFromMissionControl() {
    const result = await refreshGitLabDiscussions();
    await Promise.all([refreshConnectorOverview(), refreshDashboard(), refreshMissionControlBoard()]);
    return result;
  }

  async function saveConnectorCredential(reference: string, value: string) {
    const result = await saveCredentialToKeychain(reference, value);
    await refreshConnectorOverview();
    return result;
  }

  useEffect(() => {
    fetch("/api/agents")
      .then(async (response) => ({ response, data: await response.json() as { agents?: AgentListItem[] } }))
      .then(({ response, data }) => {
        if (response.ok !== false && Array.isArray(data.agents)) { setAgents(data.agents); setAgentsStatus("available"); }
        else setAgentsStatus("error");
      })
      .catch(() => setAgentsStatus("error"));
    void refreshDashboard();
    void refreshMissionControlBoard();
    void refreshConnectorOverview();
    fetch("/api/version").then((response) => response.json()).then((data: { version?: unknown }) => {
      if (typeof data.version === "string") setRunningVersion(data.version);
    }).catch(() => setRunningVersion(null));
    fetch("/api/setup").then((response) => response.json()).then((data: { firstRun?: unknown; steps?: { workSource?: unknown; codeHost?: unknown; agent?: unknown } }) => setSetup(typeof data.firstRun === "boolean" ? { firstRun: data.firstRun, steps: { workSource: data.steps?.workSource === true, codeHost: data.steps?.codeHost === true, agent: data.steps?.agent === true } } : null)).catch(() => setSetup(null));

    const lastTaskId = localStorage.getItem(LAST_TASK_STORAGE_KEY);
    if (lastTaskId) {
      openTaskStream(lastTaskId);
    }
    return () => { connectorRefreshGeneration.current += 1; };
  }, []);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  useEffect(() => {
    if (!activeTaskId || status !== "running") { setActiveStall(null); return; }
    let disposed = false;
    const refresh = async () => {
      try {
        const response = await fetch(`/api/agents/active/tasks/${activeTaskId}`);
        const task = await response.json() as { stall?: TaskStall };
        if (!disposed && task.stall) setActiveStall(task.stall);
      } catch {
        // The stream remains the task's primary runtime channel.
      }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    return () => { disposed = true; window.clearInterval(interval); };
  }, [activeTaskId, status]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let specialistId = taskRouting.specialistId.trim();
    if (taskRouting.capabilityTag.trim()) {
      const suggestion = await fetch(`/api/sarathi/agents/suggest?capabilityTag=${encodeURIComponent(taskRouting.capabilityTag.trim())}`);
      const result = await suggestion.json() as { agent?: { id: string; name: string } | null; reason?: string | null };
      if (!result.agent) { setExecutionMessage(result.reason ?? "No agent suggestion is available."); setStatus("unavailable"); return; }
      if (!specialistId) specialistId = result.agent.id;
      setExecutionMessage(`Suggested agent: ${result.agent.name}`);
    }
    const body = taskEngine === "inherit" ? { task } : { task, engineOverride: { primary: { engine: taskEngine, configuration: taskConfiguration, billingMode: "subscription" as const, ...(taskModel ? { model: taskModel } : {}) } } };
    const response = await fetch("/api/agents/active/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...body,
        ...(specialistId ? { specialistId } : {}),
        ...(taskRouting.workflowId.trim() ? { workflowId: taskRouting.workflowId.trim() } : {}),
        ...(taskRouting.overridePrimary || taskRouting.overrideFallback ? {
          routePolicy: {
            ...(taskRouting.overridePrimary ? { primary: { runtime: "fake", provider: "test", model: taskRouting.primaryModel, billingMode: "fake" } } : {}),
            ...(taskRouting.overrideFallback ? { fallbacks: taskRouting.fallbackModel ? [{ runtime: "fake", provider: "test", model: taskRouting.fallbackModel, billingMode: "fake" }] : [] } : {})
          }
        } : {})
      })
    });
    const next = (await response.json()) as { taskId?: string; error?: string; resolvedEnginePlan?: ResolvedEnginePlan; executedEngineRoute?: EngineRoute; attemptedEngineRoutes?: EngineRoute[]; readiness?: EngineReadiness; outcome?: TaskOutcome };
    if (!response.ok || !next.taskId) {
      setOutput([next.error ?? "Task route was rejected before runtime work started."]);
      setStatus("unavailable");
      return;
    }
    const { taskId } = next;
    setAdmission({ plan: next.resolvedEnginePlan, executedEngineRoute: next.executedEngineRoute, attemptedEngineRoutes: next.attemptedEngineRoutes, readiness: next.readiness, outcome: next.outcome });
    void refreshDashboard();
    openTaskStream(taskId);
  }

  async function togglePause() {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/sarathi/control/pause", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: !dashboard.controls.manualPaused })
      });
      const next = await response.json();
      setDashboard((current) => ({ ...current, controls: next.controls }));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function decideAsk(askId: string, decision: "approved" | "declined") {
    const result = await decideCanonicalAsk(askId, decision);
    await refreshDashboard();
    return result;
  }

  async function rollbackUpdate() {
    const response = await fetch("/api/update/rollback", { method: "POST" });
    const data: { version?: unknown } = await response.json();
    if (response.ok && typeof data.version === "string") setRunningVersion(data.version);
  }

  async function undoAutomaticDecision(decisionId: string) {
    const result = await undoCanonicalAutomaticDecision(decisionId);
    await refreshDashboard();
    return result;
  }

  async function resolveStandingRuleSuggestion(id: string, action: "accept" | "dismiss") {
    const result = await resolveCanonicalStandingRuleSuggestion(id, action);
    await refreshDashboard();
    return result;
  }

  async function toggleStandingRule(id: string, enabled: boolean) {
    const result = await setCanonicalStandingRule(id, enabled);
    await refreshDashboard();
    return result;
  }

  async function changeAutopilot(settings: AutopilotSettings) {
    const result = await saveCanonicalAutopilot(settings);
    await refreshDashboard();
    return result;
  }

  useEffect(() => {
    if (catchUpIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const ask = dashboard.asks[catchUpIndex];
      if (event.key === "Escape") setCatchUpIndex(null);
      else if (event.key.toLowerCase() === "s") setCatchUpIndex((index) => index === null || dashboard.asks.length === 0 ? null : (index + 1) % dashboard.asks.length);
      else if (ask && event.key.toLowerCase() === "a") { void decideAsk(ask.id, "approved"); setCatchUpIndex((index) => dashboard.asks.length <= 1 ? null : Math.min(index ?? 0, dashboard.asks.length - 2)); }
      else if (ask && event.key.toLowerCase() === "d") { void decideAsk(ask.id, "declined"); setCatchUpIndex((index) => dashboard.asks.length <= 1 ? null : Math.min(index ?? 0, dashboard.asks.length - 2)); }
    };
    window.addEventListener("keydown", onKeyDown); return () => window.removeEventListener("keydown", onKeyDown);
  }, [catchUpIndex, dashboard.asks]);

  async function checkNow() {
    setIsRefreshing(true);
    try {
      const response = await fetch("/api/sarathi/discovery/check", { method: "POST" });
      const next = await response.json();
      setDashboard((current) => ({ ...current, ...next }));
    } finally {
      setIsRefreshing(false);
    }
  }

  async function suggestAgent() {
    const tag = taskRouting.capabilityTag.trim();
    if (!tag) { setExecutionMessage("A capability tag is required."); return; }
    const response = await fetch(`/api/sarathi/agents/suggest?capabilityTag=${encodeURIComponent(tag)}`);
    const result = await response.json() as { agent?: { id: string; name: string } | null; reason?: string | null };
    if (!result.agent) { setExecutionMessage(result.reason ?? "No agent suggestion is available."); return; }
    setTaskRouting((current) => ({ ...current, specialistId: result.agent!.id }));
    setExecutionMessage(`Suggested agent: ${result.agent.name}`);
  }

  async function stopTask() {
    if (!activeTaskId) return;
    const source = eventSourceRef.current;
    setIsStopping(true);
    try {
      const response = await fetch(`/api/agents/active/tasks/${activeTaskId}/cancel`, { method: "POST" });
      const result = await response.json();
      if (eventSourceRef.current !== source) return;
      if (!response.ok || !result.outcome) throw new Error(result.error ?? "Task could not be stopped");
      eventSourceRef.current?.close();
      setStatus(parseTaskOutcome(JSON.stringify(result.outcome)).status);
      setOutput(result.chunks);
      void refreshDashboard();
    } catch (error) {
      if (eventSourceRef.current === source) setExecutionMessage(error instanceof Error ? error.message : "Task could not be stopped");
    } finally { setIsStopping(false); }
  }

  async function viewHistory(taskId: string) {
    try {
      const response = await fetch(`/api/agents/active/tasks/${taskId}`);
      if (!response.ok) throw new Error("Task history unavailable");
      setHistory((await response.json()).canonicalHistory ?? []);
    } catch { setExecutionMessage("Task history unavailable"); }
  }

  async function refreshProviderCatalog(provider: string) {
    setIsRefreshing(true);
    try {
      const response = await fetch(`/api/sarathi/providers/${encodeURIComponent(provider)}/catalog/refresh`, { method: "POST" });
      const next = await response.json();
      if (next.catalog) {
        setDashboard((current) => ({
          ...current,
          providerCatalogs: current.providerCatalogs.map((catalog) =>
            catalog.provider === provider ? next.catalog : catalog
          )
        }));
      }
    } finally {
      setIsRefreshing(false);
    }
  }

  async function runProof(route: RuntimeProof["route"]) {
    setProofMessage(null);
    const response = await fetch(`/api/sarathi/proofs/${encodeURIComponent(route)}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ optIn: true })
    });
    const next = await response.json() as { proof?: RuntimeProof; error?: string };
    if (!response.ok || !next.proof) { setProofMessage(next.error ?? "Proof could not run."); return; }
    setDashboard((current) => ({ ...current, proofs: [...current.proofs.filter((proof) => proof.route !== route), next.proof!] }));
    setProofMessage(`${route}: ${next.proof.status}`);
  }

  async function handleCreateSpecialist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSpecialistMessage(null);
    const response = await fetch("/api/sarathi/specialists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...specialistDraft, capabilityTags: specialistDraft.capabilityTags.split(",").map((tag) => tag.trim()).filter(Boolean) })
    });
    const next = (await response.json()) as { specialist?: Specialist; error?: string };
    if (!response.ok || !next.specialist) {
      setSpecialistMessage(next.error ?? "Specialist could not be created.");
      return;
    }
    setDashboard((current) => ({
      ...current,
      specialists: [...current.specialists, next.specialist!]
    }));
    setSpecialistDraft({ name: "", role: "", runtime: "unselected", slotLimit: 1, capabilityTags: "" });
    setIsSpecialistFormOpen(false);
    setSpecialistMessage("Specialist saved and waiting for approval.");
  }

  async function approveSpecialist(id: string) {
    setSpecialistMessage(null);
    const response = await fetch(`/api/sarathi/specialists/${id}/approve`, { method: "POST" });
    const next = (await response.json()) as { specialist?: Specialist; error?: string };
    if (!response.ok || !next.specialist) {
      setSpecialistMessage(next.error ?? "Specialist could not be approved.");
      return;
    }
    setDashboard((current) => ({
      ...current,
      specialists: current.specialists.map((specialist) =>
        specialist.id === id ? next.specialist! : specialist
      )
    }));
    setSpecialistMessage(`${next.specialist.name} is active.`);
  }

  async function saveRoutePolicy(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (routeDraft.scope !== "global" && !routeDraft.id.trim()) {
      setRouteMessage("Name the specialist or workflow.");
      return;
    }
    const route = (model: string) => ({ runtime: "fake", provider: "test", model, billingMode: "fake" });
    const response = await fetch(
      `/api/sarathi/routing/policies/${routeDraft.scope}${routeDraft.scope === "global" ? "" : `/${encodeURIComponent(routeDraft.id)}`}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(routeDraft.overridePrimary ? { primary: route(routeDraft.primaryModel) } : {}),
          ...(routeDraft.overrideFallback ? { fallbacks: routeDraft.fallbackModel ? [route(routeDraft.fallbackModel)] : [] } : {})
        })
      }
    );
    if (!response.ok) {
      setRouteMessage("Route policy was rejected.");
      return;
    }
    const next = await response.json();
    setDashboard((current) => ({ ...current, routing: next.routing }));
    setRouteMessage(`Saved ${next.policy.version}; active tasks remain pinned.`);
  }

  const blockedTickets = dashboard.tickets.filter((ticket) => ticket.status === "blocked");
  const activeAgent = agents[0];
  const latestUsage = dashboard.recentTasks.find((task) => task.usage)?.usage;
  const todayLabel = formatToday();

  if (setup?.firstRun && !setupDismissed && view !== "legacy") return <ConnectorCenter overview={connectorOverview} agents={agents.map((agent) => ({ displayName: agent.displayName, health: agent.health }))} agentsStatus={agentsStatus} isSetup onRefreshJira={refreshJiraFromMissionControl} onRefreshGitLab={refreshGitLabFromMissionControl} onSaveCredential={saveConnectorCredential} onOpenAgentSettings={() => setView("legacy")} onContinue={() => { setSetupDismissed(true); setView("command"); }} />;

  if (view === "command" && (setup?.firstRun === false || setupDismissed) && (boardLoad.status === "available" || boardLoad.status === "error")) {
    return <MissionControlShell board={boardLoad} dashboard={dashboard} dashboardStatus={dashboardStatus} agents={agents} agentsStatus={agentsStatus} agentSlots={agentSlots} agentSlotsStatus={agentSlotsStatus} connectorOverview={connectorOverview} onRefreshConnections={() => { void refreshConnectorOverview(); }} onRefreshJira={refreshJiraFromMissionControl} onRefreshGitLab={refreshGitLabFromMissionControl} onSaveCredential={saveConnectorCredential} onOpenAgentSettings={() => setView("legacy")} onAdvanced={() => setView("legacy")} onPause={() => { void togglePause(); }} onDecideAsk={decideAsk} onAutopilotChange={changeAutopilot} onStandingRuleToggle={toggleStandingRule} onResolveSuggestion={resolveStandingRuleSuggestion} onUndoAutomaticDecision={undoAutomaticDecision} />;
  }


  if (view === "advanced-routing") {
    const specialist = dashboard.specialists.find((candidate) => candidate.id === advancedSpecialistId);
    return <div className="sarathi-shell"><aside className="rail"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">✳</span><div><strong>Sarathi</strong><span>local command center</span></div></div><nav className="primary-nav" aria-label="Primary navigation"><button className="nav-item" type="button" onClick={() => setView("command")}><span>01</span>Command</button><button className="nav-item active" type="button"><span>02</span>Advanced settings</button></nav></aside><main className="dashboard"><p className="topbar-title">Advanced settings · {specialist?.name ?? "Agent"}</p><RoutingPage /></main></div>;
  }
  if (view === "work-items") return <div className="sarathi-shell"><aside className="rail"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true">✳</span><div><strong>Sarathi</strong><span>local command center</span></div></div><nav className="primary-nav" aria-label="Primary navigation"><button className="nav-item" type="button" onClick={() => setView("command")}><span>01</span>Command</button><button className="nav-item active" type="button"><span>02</span>Work items</button></nav></aside><main className="dashboard"><WorkItemsPage /></main></div>;

    return (
      <div className="sarathi-shell">
      <aside className="rail">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">✳</span>
          <div><strong>Sarathi</strong><span>local command center</span></div>
        </div>
        <nav className="primary-nav" aria-label="Primary navigation">
          <a className="nav-item active" href="#command"><span>01</span>Command</a>
          <a className="nav-item" href="#specialists"><span>02</span>Specialists</a>
          <a className="nav-item" href="#review"><span>03</span>Review queue</a>
          <a className="nav-item" href="#knowledge"><span>04</span>Knowledge</a>
          <button className="nav-item" type="button" onClick={() => setView("work-items")}><span>05</span>Work items</button>
        </nav>
        <div className="rail-footer">
          <div className="rail-caption">Current host</div>
          <div className="host-line"><span className="status-dot amber" /> Windows local</div>
          <div className="host-line muted">Browser is a window, not the worker.</div>
        </div>
      </aside>

      <main className="dashboard" id="command">
        {setup?.firstRun && !setupDismissed && view === "legacy" && <section className="panel mc-setup-recovery"><div className="panel-heading"><div><span className="eyebrow">Setup</span><h2>Agent settings</h2></div><button type="button" onClick={() => setView("command")}>Back to setup</button></div></section>}
        <header className="topbar">
          <div><span className="eyebrow">{todayLabel}</span><p className="topbar-title">Operator view <span>/</span> Today</p></div>
          <div className="topbar-actions">
            <span className={`runtime-pill ${dashboard.runtime.state}`}><span className="status-dot" /> {dashboard.runtime.name} · {statusLabel(dashboard.runtime.state)}</span>
            <button className="pause-button" type="button" onClick={togglePause} disabled={isRefreshing}><span aria-hidden="true">{dashboard.controls.manualPaused ? "▶" : "Ⅱ"}</span> {dashboard.controls.manualPaused ? "Resume dispatch" : "Pause dispatch"}</button>
          </div>
        </header>

        <section className="hero-panel">
          <div className="hero-copy"><span className="eyebrow signal-eyebrow">The handoff layer</span><h1 aria-label="The work queue, without the reassembly.">The work queue,<br /><em>without the reassembly.</em></h1><p>One place to see what moved, what is waiting, and which decision is yours.</p><div className="hero-meta"><span className="status-dot green" /> {dashboard.controls.manualPaused ? "Manual pause is holding new dispatch." : "Local state is recording evidence."}</div></div>
          <div className="loop-orbit" aria-label="Workflow loop"><div className="orbit-ring ring-one" /><div className="orbit-ring ring-two" /><div className="orbit-core"><span>●</span><small>LIVE<br />LOOP</small></div><span className="orbit-label label-top">context</span><span className="orbit-label label-right">review</span><span className="orbit-label label-bottom">authority</span><span className="orbit-label label-left">memory</span></div>
        </section>

        <section className="signal-strip" aria-label="Current counts">
          <div className="signal-cell"><span>Work in motion</span><strong>{status === "running" ? "1" : "0"}</strong><small>local task</small></div>
          <div className="signal-cell"><span>Waiting on you</span><strong>{blockedTickets.length}</strong><small>gates in view</small></div>
          <div className="signal-cell"><span>Remote effects</span><strong>0</strong><small>no fixture armed</small></div>
          <div className="signal-cell"><span>Usage</span><strong>{latestUsage?.outputTokens ?? "—"}</strong><small>{latestUsage ? formatUsage(latestUsage) : "unknown until reported"}</small></div>
        </section>

        <div className="content-grid">
          <div className="main-column">
            <section className="panel" aria-label="Standing rule suggestions"><div className="panel-heading"><div><span className="eyebrow">Standing rules</span><h2>Suggested from approvals</h2></div></div>{dashboard.standingRuleSuggestions.length === 0 ? <p className="panel-note subtle">No standing rule suggestions.</p> : <div className="proof-list">{dashboard.standingRuleSuggestions.map((suggestion) => <div className="proof-row" key={suggestion.id}><div><strong>{suggestion.askKind}</strong><small>{suggestion.scope}</small></div><button type="button" onClick={() => void resolveStandingRuleSuggestion(suggestion.id, "accept")}>Accept</button><button type="button" onClick={() => void resolveStandingRuleSuggestion(suggestion.id, "dismiss")}>Dismiss</button></div>)}</div>}</section>
            <section className="panel loop-panel"><div className="panel-heading"><div><span className="eyebrow">The loop</span><h2>From signal to safe handoff</h2></div><span className="quiet-tag">policy first</span></div><div className="workflow-track">{[["01", "Discover"], ["02", "Group"], ["03", "Review"], ["04", "Approve"], ["05", "Verify"]].map(([number, label]) => <div className="workflow-step waiting" key={number}><span className="step-number">{number}</span><span className="step-label">{label}</span><span className="step-state">waiting</span></div>)}</div><div className="panel-note"><span className="status-dot amber" /> The first external boundary is deliberately stopped until its adapter and account route are proven.</div></section>

            <section className="panel review-panel" id="review"><div className="panel-heading"><div><span className="eyebrow">Review queue</span><h2>Assigned merge requests</h2></div><button className="text-button" type="button" onClick={checkNow} disabled={isRefreshing}>Check now <span>↗</span></button></div>{dashboard.discovery.status === "blocked" ? <div className="blocked-state"><div className="blocked-icon">!</div><div><strong>Discovery is waiting for a real adapter.</strong><p>{dashboard.discovery.reason}</p></div><span className="state-chip blocked">blocked</span></div> : dashboard.discovery.mergeRequests.length === 0 ? <div className="empty-state"><span>◌</span><p>No assigned merge requests in this check.</p></div> : <div className="mr-list">{dashboard.discovery.mergeRequests.map((mergeRequest) => <div className="mr-row" key={mergeRequest.id}><strong>{mergeRequest.title}</strong><span>{mergeRequest.project}</span><span>{mergeRequest.role}</span><span>{mergeRequest.coverage}</span></div>)}</div>}</section>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Operator queue</span><h2>Asks ({dashboard.asks.length})</h2></div>{dashboard.asks.length > 0 && <button type="button" onClick={() => setCatchUpIndex(0)}>Catch up</button>}</div>{dashboard.asks.length === 0 ? <p className="panel-note subtle">No pending asks.</p> : <div className="proof-list">{dashboard.asks.map((ask) => <div className="proof-row" key={ask.id}><div><strong>{ask.kind}</strong>{trackChangeSummary(ask) ? <small>{trackChangeSummary(ask)!.split("\n").map((line) => <span key={line}>{line}<br /></span>)}</small> : <small>{ask.intent.tool === "system-update" ? `${ask.intent.context.version} · ${ask.intent.context.channel} · ${ask.intent.context.notes}` : `${ask.workItemId ?? "No work item"} · waiting since ${ask.createdAt}`}</small>}</div><button type="button" onClick={() => void decideAsk(ask.id, "approved")}>Approve</button><button type="button" onClick={() => void decideAsk(ask.id, "declined")}>Decline</button></div>)}</div>}</section><section className="panel" aria-label="Automatic decisions"><div className="panel-heading"><div><span className="eyebrow">Automatic decisions</span><h2>Today ({dashboard.automaticDecisions.filter((decision) => decision.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).length})</h2></div></div>{dashboard.automaticDecisions.length === 0 ? <p className="panel-note subtle">No automatic decisions today.</p> : <div className="proof-list">{dashboard.automaticDecisions.map((decision) => <div className="proof-row" key={decision.id}><div><strong>{decision.intent.operation} · {decision.intent.target}</strong><small>{decision.source}: {decision.sourceDetail} · {decision.workItemId ?? "No work item"} · {decision.createdAt}</small></div><span className="state-chip">{decision.undone ? "undone" : decision.undoable ? "active" : "ask"}</span><button type="button" disabled={decision.undone || !decision.undoable} onClick={() => void undoAutomaticDecision(decision.id)}>Undo</button></div>)}</div>}</section>{catchUpIndex !== null && dashboard.asks[catchUpIndex] && <div role="dialog" aria-label="Catch-up mode" className="catch-up"><h2>{dashboard.asks[catchUpIndex].kind}</h2><p>{catchUpIndex + 1} of {dashboard.asks.length} asks remaining</p><p>{dashboard.asks[catchUpIndex].workItemId ?? "No work item"}</p><button onClick={() => void decideAsk(dashboard.asks[catchUpIndex].id, "approved")}>Approve (A)</button><button onClick={() => void decideAsk(dashboard.asks[catchUpIndex].id, "declined")}>Decline (D)</button><button onClick={() => setCatchUpIndex((catchUpIndex + 1) % dashboard.asks.length)}>Skip (S)</button><button onClick={() => setCatchUpIndex(null)}>Leave (Esc)</button></div>}

            <section className="panel task-panel" id="knowledge"><div className="panel-heading"><div><span className="eyebrow">Direct task</span><h2>Ask the coordinator</h2></div><span className="quiet-tag">{runningVersion ? `Adhisthana ${runningVersion}` : "version unknown"}</span></div><form className="task-form" onSubmit={handleSubmit}><div className="task-routing-fields"><label htmlFor="task-engine">Engine<select id="task-engine" aria-label="Task engine" value={taskEngine} onChange={(event) => setTaskEngine(event.target.value as "inherit" | AgentEngineKind)}><option value="inherit">Inherit</option><option value="hermes">Hermes</option><option value="codex">Codex</option><option value="claude-code">Claude Code</option></select></label>{taskEngine !== "inherit" && <><label htmlFor="task-configuration">Configuration<input id="task-configuration" value={taskConfiguration} onChange={(event) => setTaskConfiguration(event.target.value)} /></label><label htmlFor="task-model">Model<input id="task-model" value={taskModel} onChange={(event) => setTaskModel(event.target.value)} /></label></>}</div><label htmlFor="task-input">Task <span>· what should move next?</span></label><div className="task-input-row"><input id="task-input" value={task} onChange={(event) => setTask(event.target.value)} placeholder="e.g. Summarise what is waiting on me" /><button type="submit">Run task <span>↗</span></button></div><div className="task-routing"><label htmlFor="task-specialist">Specialist ID<input id="task-specialist" value={taskRouting.specialistId} onChange={(event) => setTaskRouting((draft) => ({ ...draft, specialistId: event.target.value }))} placeholder="optional specialist id" /></label><label htmlFor="task-workflow">Workflow ID<input id="task-workflow" value={taskRouting.workflowId} onChange={(event) => setTaskRouting((draft) => ({ ...draft, workflowId: event.target.value }))} placeholder="optional workflow id" /></label><label><input type="checkbox" checked={taskRouting.overridePrimary} onChange={(event) => setTaskRouting((draft) => ({ ...draft, overridePrimary: event.target.checked }))} /> Override task primary</label>{taskRouting.overridePrimary && <label htmlFor="task-primary">Primary override model<input id="task-primary" value={taskRouting.primaryModel} onChange={(event) => setTaskRouting((draft) => ({ ...draft, primaryModel: event.target.value }))} required /></label>}<label><input type="checkbox" checked={taskRouting.overrideFallback} onChange={(event) => setTaskRouting((draft) => ({ ...draft, overrideFallback: event.target.checked }))} /> Override task fallback chain</label>{taskRouting.overrideFallback && <label htmlFor="task-fallback">Fallback override model (blank clears)<input id="task-fallback" value={taskRouting.fallbackModel} onChange={(event) => setTaskRouting((draft) => ({ ...draft, fallbackModel: event.target.value }))} /></label>}</div></form>{admission?.plan && <div className="admission-summary">Resolved: <strong>{admission.plan.primary.engine}</strong>{admission.executedEngineRoute && <span> · executed {admission.executedEngineRoute.engine}/{admission.executedEngineRoute.configuration}</span>} · readiness {admission.readiness?.state ?? "unmeasured"}</div>}{status === "running" && <button type="button" onClick={() => void stopTask()} disabled={isStopping}>{isStopping ? "Stopping…" : "Stop task"}</button>}{activeStall && activeStall.state !== "active" && <p role="status">Task stalled: {activeStall.state} threshold passed.</p>}{executionMessage && <p role="alert">{executionMessage}</p>}{output.length > 0 && <pre className="task-output">{output.join("\n")}</pre>}{status !== "idle" && <div className={`task-status ${status}`}><span className="status-dot" /> Run status: {statusLabel(status)}</div>}</section>

            <section className="panel" aria-label="Agent suggestion"><div className="panel-heading"><div><span className="eyebrow">Capability tag</span><h2>Suggest an agent</h2></div></div><div className="task-routing"><label htmlFor="capability-tag">Required capability tag<input id="capability-tag" value={taskRouting.capabilityTag} onChange={(event) => setTaskRouting((draft) => ({ ...draft, capabilityTag: event.target.value }))} placeholder="e.g. Backend" /></label><label htmlFor="specialist-capability-tags">Capability tags for next specialist<input id="specialist-capability-tags" value={specialistDraft.capabilityTags} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, capabilityTags: event.target.value }))} placeholder="Planning, Backend" /></label><button type="button" onClick={() => void suggestAgent()}>Suggest agent</button></div></section>

            <section className="panel execution-panel" aria-label="Execution evidence">
              <div className="panel-heading"><div><span className="eyebrow">Durable execution</span><h2>Latest runtime evidence</h2></div></div>
              {dashboard.recentTasks.length === 0 ? <p className="panel-note subtle">No routed attempts recorded.</p> : <div className="gate-list">{dashboard.recentTasks.map((attempt) =>
                <div className="gate-row" key={attempt.id}><span className="gate-index">{statusLabel(attempt.status)}</span><div>
                  <strong>{attempt.title}</strong><small>{attempt.runtime} · plan {attempt.planId} · attempt {attempt.attemptId}</small>
                  {attempt.selectionReason && <small>{attempt.selectionReason}</small>}{attempt.evidence && <small>{attempt.evidence}</small>}
                   <small>Retries: {attempt.retryCount ?? 0} · Fallbacks: {attempt.fallbackCount ?? 0}</small>
                   <small>{formatUsage(attempt.usage)}{attempt.attribution?.providerRequestId ? ` · request ${attempt.attribution.providerRequestId}` : ""}{attempt.attribution?.effectiveProvider ? ` · effective ${attempt.attribution.effectiveProvider}/${attempt.attribution.effectiveModel ?? "unknown"}` : ""}</small>
                  {attempt.outcomeMessage && <small>{attempt.outcomeMessage}</small>}
                  <button type="button" onClick={() => void viewHistory(attempt.id)}>View history</button>
                </div><span className="state-chip">{statusLabel(attempt.status)}</span></div>)}</div>}
              {dashboard.routeCircuits.map((circuit) => <p className="panel-note" key={JSON.stringify(circuit.route)}>
                {circuit.route.provider}/{circuit.route.model}: {circuit.state} · {circuit.failureKind ?? "healthy"}{circuit.state === "open" ? ` · ${circuit.retryAt ? `Retry after ${circuit.retryAt}` : "Repair configuration or run a successful probe"}` : ""}
              </p>)}
              {history && <ol aria-label="Canonical task history">{history.map((entry) => <li key={entry.sequence}>{describeHistory(entry)}</li>)}</ol>}
            </section>
          </div>

          <aside className="side-column">
            <section className="panel" aria-label="Activity feed"><div className="panel-heading"><div><span className="eyebrow">Activity</span><h2>What moved</h2></div></div>{dashboard.activity.length === 0 ? <p className="panel-note subtle">No activity recorded yet.</p> : <div className="proof-list">{dashboard.activity.map((entry) => <div className="proof-row" key={entry.id}><div><strong>{entry.what}</strong><small><time dateTime={entry.occurredAt}>{entry.occurredAt}</time> · {entry.agent} · {entry.workItemId ?? "No work item"}</small></div></div>)}</div>}</section>
            <section className="panel"><div className="panel-heading"><div><span className="eyebrow">Installation</span><h2>Update recovery</h2></div></div><p className="panel-note">{runningVersion ? `Running ${runningVersion}` : "Running version unknown"}</p><button type="button" onClick={() => void rollbackUpdate()}>Roll back update</button></section>
            <section className="panel gates-panel"><div className="panel-heading"><div><span className="eyebrow">Readiness gates</span><h2>What still needs proof</h2></div><span className="gate-count">{blockedTickets.length}</span></div><div className="gate-list">{blockedTickets.slice(0, 6).map((ticket) => <div className="gate-row" key={ticket.id}><span className="gate-index">{ticket.id}</span><div><strong>{ticket.title}</strong><small>{ticket.reason}</small></div><span className="state-chip blocked">blocked</span></div>)}</div>{blockedTickets.length > 6 && <p className="more-note">+ {blockedTickets.length - 6} more gates in the ticket map</p>}</section>

            <section className="panel specialists-panel" id="specialists"><div className="panel-heading"><div><span className="eyebrow">The bench</span><h2>Specialists</h2></div><button className="icon-button" type="button" aria-label="Add specialist" aria-expanded={isSpecialistFormOpen} onClick={() => { setIsSpecialistFormOpen((open) => !open); setSpecialistMessage(null); }}>{isSpecialistFormOpen ? "×" : "+"}</button></div>{isSpecialistFormOpen && <form className="specialist-form" onSubmit={handleCreateSpecialist}><label htmlFor="specialist-name">Name<input id="specialist-name" value={specialistDraft.name} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Review analyst" required /></label><label htmlFor="specialist-role">Role<input id="specialist-role" value={specialistDraft.role} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, role: event.target.value }))} placeholder="e.g. reviewer" required /></label><label htmlFor="specialist-runtime">Runtime<select id="specialist-runtime" value={specialistDraft.runtime} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, runtime: event.target.value }))}><option value="unselected">Inherit global after runtime proof</option><option value="hermes">Hermes (unverified)</option><option value="codex">Codex (unverified)</option><option value="claude-code">Claude Code (unverified)</option></select></label><label htmlFor="specialist-slots">Slot limit<input id="specialist-slots" type="number" min="1" value={specialistDraft.slotLimit} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, slotLimit: Number(event.target.value) }))} required /></label><button className="specialist-submit" type="submit">Save pending specialist</button></form>}<div className="specialist-list">{dashboard.specialists.map((specialist) => { const slots = agentSlots.find((agent) => agent.id === specialist.id); return <div className="specialist-row" key={specialist.id}><span className="avatar">{specialist.name.slice(0, 1)}</span><div><strong>{specialist.name}</strong><small>{specialist.role} · {specialist.runtime}</small><small>{slots ? `${slots.slotsInUse} / ${slots.slotLimit} slots in use` : `${specialist.slotLimit} slots configured`}</small><small>{(specialist.capabilityTags ?? []).join(" · ") || "No capability tags"}</small></div>{specialist.status === "pending_approval" ? <button className="approve-button" type="button" onClick={() => approveSpecialist(specialist.id)}>Approve</button> : <span className={`state-chip ${slots?.full ? "blocked" : "ready"}`}>{slots?.full ? "full" : "active"}</span>}<button type="button" onClick={() => { setAdvancedSpecialistId(specialist.id); setView("advanced-routing"); }} aria-label={`Advanced settings for ${specialist.name}`}>Advanced settings</button></div>; })}</div>{specialistMessage && <p className="specialist-message" role="status">{specialistMessage}</p>}<p className="panel-note subtle">Permanent agents stay pending until you approve their shape and scope.</p></section>

            <section className="panel routing-panel"><div className="panel-heading"><div><span className="eyebrow">Routing policy</span><h2>New work only</h2></div></div><form className="specialist-form" onSubmit={saveRoutePolicy}><label htmlFor="route-scope">Scope<select id="route-scope" value={routeDraft.scope} onChange={(event) => setRouteDraft((draft) => ({ ...draft, scope: event.target.value as "global" | "specialist" | "workflow" }))}><option value="global">Global</option><option value="specialist">Specialist</option><option value="workflow">Workflow</option></select></label>{routeDraft.scope !== "global" && <label htmlFor="route-scope-id">Scope name<input id="route-scope-id" value={routeDraft.id} onChange={(event) => setRouteDraft((draft) => ({ ...draft, id: event.target.value }))} required /></label>}<label><input type="checkbox" checked={routeDraft.overridePrimary} onChange={(event) => setRouteDraft((draft) => ({ ...draft, overridePrimary: event.target.checked }))} /> Override primary</label>{routeDraft.overridePrimary && <label htmlFor="route-primary">Primary model<input id="route-primary" value={routeDraft.primaryModel} onChange={(event) => setRouteDraft((draft) => ({ ...draft, primaryModel: event.target.value }))} required /></label>}<label><input type="checkbox" checked={routeDraft.overrideFallback} onChange={(event) => setRouteDraft((draft) => ({ ...draft, overrideFallback: event.target.checked }))} /> Override fallback chain</label>{routeDraft.overrideFallback && <label htmlFor="route-fallback">Fallback model (blank clears)<input id="route-fallback" value={routeDraft.fallbackModel} onChange={(event) => setRouteDraft((draft) => ({ ...draft, fallbackModel: event.target.value }))} /></label>}<button className="specialist-submit" type="submit">Save route policy</button></form>{routeMessage && <p className="specialist-message" role="status">{routeMessage}</p>}<p className="panel-note subtle">Task overrides are recorded at admission. Later edits apply only to new tasks.</p></section>

            <section className="panel provider-catalog-panel"><div className="panel-heading"><div><span className="eyebrow">Provider catalogs</span><h2>Observed, not assumed</h2></div></div>{dashboard.providerCatalogs.length === 0 ? <p className="panel-note subtle">No provider catalog observed. Missing evidence is not eligibility.</p> : <div className="catalog-list">{dashboard.providerCatalogs.map((catalog) => <div className="catalog-row" key={catalog.provider}><div><strong>{catalog.provider}</strong><small>{catalog.authenticationMode} · {catalog.completeness} · observed {catalog.observedAt}</small><small>{catalog.provenance}</small>{catalog.credentialReference && <small>credential ref: {catalog.credentialReference}</small>}<small>transport security: {catalog.securityStatus ?? "unknown"}</small>{catalog.refreshError && <small className="catalog-error">Refresh failed: {catalog.refreshError}</small>}</div><div><button className="text-button" type="button" aria-label={`Refresh ${catalog.provider}`} onClick={() => refreshProviderCatalog(catalog.provider)} disabled={isRefreshing}>Refresh</button><span className={`state-chip ${catalog.stale ? "blocked" : "ready"}`}>{catalog.stale ? "stale" : "current"}</span></div><ul>{catalog.models.map((model) => <li key={model.id}><strong>{model.model}</strong><span>{model.enabled ? "enabled" : "not enabled"} · {model.configured ? "configured" : "not configured"} · {model.eligible ? "eligible" : "ineligible"}</span><small>tier {model.tier ?? "unclassified"}; health {model.qualification.health}; stream {model.qualification.streaming}; structured {model.qualification.structuredOutput}; tools {model.qualification.toolCalling}{model.contextWindow ? ` · context ${model.contextWindow}` : ""}</small></li>)}</ul></div>)}</div>}<p className="panel-note subtle">A route must be enabled, configured, healthy, and capability-qualified before it is eligible.</p></section>

            <section className="panel proofs-panel"><div className="panel-heading"><div><span className="eyebrow">Live contract proofs</span><h2>Opt in per route</h2></div></div><div className="proof-list">{dashboard.proofs.map((proof) => <div className="proof-row" key={proof.route}><div><strong>{proof.route}</strong><small>{proof.reason}</small></div><span className={`state-chip ${proof.status === "passed" ? "ready" : proof.status === "UNMEASURED" ? "pending" : "blocked"}`}>{proof.status}</span><button className="text-button" type="button" aria-label={`Check ${proof.route} proof`} onClick={() => void runProof(proof.route)}>Opt-in check</button></div>)}</div>{proofMessage && <p className="panel-note" role="status">{proofMessage}</p>}<p className="panel-note subtle">No proof runs automatically; missing account, credential, endpoint, model, or fixture remains UNMEASURED.</p></section>

            <section className="panel runtime-panel"><div className="panel-heading"><div><span className="eyebrow">Runtime</span><h2>Attributable, or stopped</h2></div></div><div className="runtime-card"><div className="runtime-card-top"><span className={`status-dot ${dashboard.runtime.state === "ready" ? "green" : "amber"}`} /><strong>{dashboard.runtime.name}</strong><span className="state-chip">{statusLabel(dashboard.runtime.state)}</span></div><p>{dashboard.runtime.reason}</p>{activeAgent ? <small className="agent-health"><strong>{activeAgent.displayName}</strong><span> · </span><span>{activeAgent.health.ok ? "healthy" : activeAgent.health.reason}</span></small> : <small>Agent health unavailable</small>}</div><div className="runtime-footnote">Billing mode: <strong>{dashboard.runtime.billingMode}</strong></div></section>
          </aside>
        </div>
      </main>
    </div>
  );
}
