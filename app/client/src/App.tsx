import { useEffect, useRef, useState } from "react";
import type {
  AgentInfo,
  HealthStatus,
  TaskOutcome,
  TaskTerminalStatus
} from "@aios/contracts";
import "./App.css";

type AgentListItem = AgentInfo & { health: HealthStatus };
type RunStatus = "idle" | "running" | TaskTerminalStatus;

type Dashboard = {
  runtime: {
    name: string;
    state: "unavailable" | "unverified" | "ready";
    billingMode: "subscription-only";
    reason: string;
  };
  controls: { manualPaused: boolean; changedAt: string | null };
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
  }>;
  recentTasks: Array<{
    id: string;
    title: string;
    status: "completed" | "failed" | "blocked" | "unavailable";
  }>;
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

const DEFAULT_DASHBOARD: Dashboard = {
  runtime: {
    name: "Hermes",
    state: "unavailable",
    billingMode: "subscription-only",
    reason: "Native runtime launch is not verified on this host."
  },
  controls: { manualPaused: false, changedAt: null },
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
        status === "unavailable"
      ) {
        const message = (parsed as { message?: unknown }).message;
        return typeof message === "string" ? { status, message } : { status };
      }
    }
  } catch {
    // Invalid terminal data is a failed outcome, never a successful one.
  }

  return { status: "failed", message: "task returned an invalid outcome" };
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ");
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
  const [agents, setAgents] = useState<AgentListItem[]>([]);
  const [dashboard, setDashboard] = useState<Dashboard>(DEFAULT_DASHBOARD);
  const [task, setTask] = useState("");
  const [status, setStatus] = useState<RunStatus>("idle");
  const [output, setOutput] = useState<string[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSpecialistFormOpen, setIsSpecialistFormOpen] = useState(false);
  const [specialistDraft, setSpecialistDraft] = useState({
    name: "",
    role: "",
    runtime: "unselected"
  });
  const [specialistMessage, setSpecialistMessage] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  function openTaskStream(taskId: string) {
    eventSourceRef.current?.close();
    setOutput([]);
    setStatus("running");
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
    });
  }

  async function refreshDashboard() {
    try {
      const response = await fetch("/api/sarathi/dashboard");
      const next = (await response.json()) as Partial<Dashboard>;
      if (Array.isArray(next.tickets) && next.runtime && next.discovery) {
        setDashboard(next as Dashboard);
      }
    } catch {
      // Keep the explicit local fallback while the API is down.
    }
  }

  useEffect(() => {
    fetch("/api/agents")
      .then((response) => response.json())
      .then((data) => setAgents(data.agents))
      .catch(() => setAgents([]));
    void refreshDashboard();

    const lastTaskId = localStorage.getItem(LAST_TASK_STORAGE_KEY);
    if (lastTaskId) {
      openTaskStream(lastTaskId);
    }
  }, []);

  useEffect(() => () => eventSourceRef.current?.close(), []);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/agents/active/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task })
    });
    const { taskId } = await response.json();
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

  async function handleCreateSpecialist(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSpecialistMessage(null);
    const response = await fetch("/api/sarathi/specialists", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(specialistDraft)
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
    setSpecialistDraft({ name: "", role: "", runtime: "unselected" });
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

  const blockedTickets = dashboard.tickets.filter((ticket) => ticket.status === "blocked");
  const activeAgent = agents[0];
  const todayLabel = formatToday();

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
        </nav>
        <div className="rail-footer">
          <div className="rail-caption">Current host</div>
          <div className="host-line"><span className="status-dot amber" /> Windows local</div>
          <div className="host-line muted">Browser is a window, not the worker.</div>
        </div>
      </aside>

      <main className="dashboard" id="command">
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
          <div className="signal-cell"><span>Usage</span><strong>—</strong><small>not measured</small></div>
        </section>

        <div className="content-grid">
          <div className="main-column">
            <section className="panel loop-panel"><div className="panel-heading"><div><span className="eyebrow">The loop</span><h2>From signal to safe handoff</h2></div><span className="quiet-tag">policy first</span></div><div className="workflow-track">{[["01", "Discover"], ["02", "Group"], ["03", "Review"], ["04", "Approve"], ["05", "Verify"]].map(([number, label]) => <div className="workflow-step waiting" key={number}><span className="step-number">{number}</span><span className="step-label">{label}</span><span className="step-state">waiting</span></div>)}</div><div className="panel-note"><span className="status-dot amber" /> The first external boundary is deliberately stopped until its adapter and account route are proven.</div></section>

            <section className="panel review-panel" id="review"><div className="panel-heading"><div><span className="eyebrow">Review queue</span><h2>Assigned merge requests</h2></div><button className="text-button" type="button" onClick={checkNow} disabled={isRefreshing}>Check now <span>↗</span></button></div>{dashboard.discovery.status === "blocked" ? <div className="blocked-state"><div className="blocked-icon">!</div><div><strong>Discovery is waiting for a real adapter.</strong><p>{dashboard.discovery.reason}</p></div><span className="state-chip blocked">blocked</span></div> : dashboard.discovery.mergeRequests.length === 0 ? <div className="empty-state"><span>◌</span><p>No assigned merge requests in this check.</p></div> : <div className="mr-list">{dashboard.discovery.mergeRequests.map((mergeRequest) => <div className="mr-row" key={mergeRequest.id}><strong>{mergeRequest.title}</strong><span>{mergeRequest.project}</span><span>{mergeRequest.role}</span><span>{mergeRequest.coverage}</span></div>)}</div>}</section>

            <section className="panel task-panel" id="knowledge"><div className="panel-heading"><div><span className="eyebrow">Direct task</span><h2>Ask the coordinator</h2></div><span className="quiet-tag">fake seam available</span></div><form className="task-form" onSubmit={handleSubmit}><label htmlFor="task-input">Task <span>· what should move next?</span></label><div className="task-input-row"><input id="task-input" value={task} onChange={(event) => setTask(event.target.value)} placeholder="e.g. Summarise what is waiting on me" /><button type="submit">Run task <span>↗</span></button></div></form>{output.length > 0 && <pre className="task-output">{output.join("\n")}</pre>}{status !== "idle" && <div className={`task-status ${status}`}><span className="status-dot" /> Run status: {statusLabel(status)}</div>}</section>
          </div>

          <aside className="side-column">
            <section className="panel gates-panel"><div className="panel-heading"><div><span className="eyebrow">Readiness gates</span><h2>What still needs proof</h2></div><span className="gate-count">{blockedTickets.length}</span></div><div className="gate-list">{blockedTickets.slice(0, 6).map((ticket) => <div className="gate-row" key={ticket.id}><span className="gate-index">{ticket.id}</span><div><strong>{ticket.title}</strong><small>{ticket.reason}</small></div><span className="state-chip blocked">blocked</span></div>)}</div>{blockedTickets.length > 6 && <p className="more-note">+ {blockedTickets.length - 6} more gates in the ticket map</p>}</section>

            <section className="panel specialists-panel" id="specialists"><div className="panel-heading"><div><span className="eyebrow">The bench</span><h2>Specialists</h2></div><button className="icon-button" type="button" aria-label="Add specialist" aria-expanded={isSpecialistFormOpen} onClick={() => { setIsSpecialistFormOpen((open) => !open); setSpecialistMessage(null); }}>{isSpecialistFormOpen ? "×" : "+"}</button></div>{isSpecialistFormOpen && <form className="specialist-form" onSubmit={handleCreateSpecialist}><label htmlFor="specialist-name">Name<input id="specialist-name" value={specialistDraft.name} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, name: event.target.value }))} placeholder="e.g. Review analyst" required /></label><label htmlFor="specialist-role">Role<input id="specialist-role" value={specialistDraft.role} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, role: event.target.value }))} placeholder="e.g. reviewer" required /></label><label htmlFor="specialist-runtime">Runtime<select id="specialist-runtime" value={specialistDraft.runtime} onChange={(event) => setSpecialistDraft((draft) => ({ ...draft, runtime: event.target.value }))}><option value="unselected">Select after runtime proof</option><option value="fake">Fake test seam</option><option value="hermes">Hermes (unverified)</option></select></label><button className="specialist-submit" type="submit">Save pending specialist</button></form>}<div className="specialist-list">{dashboard.specialists.map((specialist) => <div className="specialist-row" key={specialist.id}><span className="avatar">{specialist.name.slice(0, 1)}</span><div><strong>{specialist.name}</strong><small>{specialist.role} · {specialist.runtime}</small></div>{specialist.status === "pending_approval" ? <button className="approve-button" type="button" onClick={() => approveSpecialist(specialist.id)}>Approve</button> : <span className="state-chip ready">active</span>}</div>)}</div>{specialistMessage && <p className="specialist-message" role="status">{specialistMessage}</p>}<p className="panel-note subtle">Permanent agents stay pending until you approve their shape and scope.</p></section>

            <section className="panel runtime-panel"><div className="panel-heading"><div><span className="eyebrow">Runtime</span><h2>Attributable, or stopped</h2></div></div><div className="runtime-card"><div className="runtime-card-top"><span className={`status-dot ${dashboard.runtime.state === "ready" ? "green" : "amber"}`} /><strong>{dashboard.runtime.name}</strong><span className="state-chip">{statusLabel(dashboard.runtime.state)}</span></div><p>{dashboard.runtime.reason}</p>{activeAgent ? <small className="agent-health"><strong>{activeAgent.displayName}</strong><span> · </span><span>{activeAgent.health.ok ? "healthy" : activeAgent.health.reason}</span></small> : <small>Agent health unavailable</small>}</div><div className="runtime-footnote">Billing mode: <strong>{dashboard.runtime.billingMode}</strong></div></section>
          </aside>
        </div>
      </main>
    </div>
  );
}
