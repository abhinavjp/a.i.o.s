import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MissionControlBoard, MissionControlBoardItem, MissionControlRegion, StageKind } from "@aios/contracts";
import type { ActionResult, AutopilotSettings, BoardLoad, ConnectorOverview, DiscussionRefreshResult, JiraRefreshResult } from "./api.js";
import { ConnectorCenter } from "./ConnectorCenter.js";
import "./MissionControlShell.css";

type ShellAsk = { id: string; kind: string; risk?: "low" | "medium" | "high"; workItemId: string | null; createdAt: string; intent: { tool: string; operation?: string; target?: string; context: Record<string, string> } };
type ShellAction = ActionResult | void;
interface ShellDashboard {
  asks: ReadonlyArray<ShellAsk>;
  automaticDecisions?: ReadonlyArray<{ id: string; intent: { operation: string; target: string }; source: "standing rule" | "autopilot"; sourceDetail: string; workItemId: string | null; createdAt: string; undone: boolean; undoable: boolean }>;
  standingRuleSuggestions?: ReadonlyArray<{ id: string; askKind: string; scope: string; state?: "offered" | "accepted" | "dismissed" }>;
  standingRules?: ReadonlyArray<{ id: string; label: string; askKind: string; scope: string; enabled: boolean; firedCount: number }>;
  autopilot?: AutopilotSettings;
  activity: ReadonlyArray<{ id: string; occurredAt: string; agent: string; workItemId: string | null; what: string }>;
  specialists: ReadonlyArray<{ id: string; name: string; role: string; runtime?: string; status: "pending_approval" | "active"; scope?: string; slotLimit: number; capabilityTags?: ReadonlyArray<string> }>;
  recentTasks?: ReadonlyArray<{ id: string; title: string; status: string }>;
  controls: { manualPaused: boolean };
  runtime: { name: string; state: "unavailable" | "unverified" | "ready" };
}

type WorkProgress = { tasks: { completed: number; total: number } | null; checks: { completed: number; total: number } | null; diff: { filesChanged: number; linesAdded: number; linesRemoved: number } | null; pipelineJobs: { completed: number; total: number } | null };
type WorkProgressState = { status: "loading" | "available" | "error"; data?: WorkProgress; message?: string };
type ShellAgentHealth = { id: string; kind: string; displayName: string; health: { ok: true } | { ok: false; reason: string } };
type ShellAgentSlot = { id: string; slotLimit: number; slotsInUse: number; full: boolean };
type AvailableRegion<T> = Extract<T, { status: "available" }> extends { data: infer Data } ? Data : never;
type WorkPhase = AvailableRegion<MissionControlBoardItem["phases"]>[number];
type WorkArtifact = AvailableRegion<MissionControlBoardItem["artifacts"]>[number];
type WorkMergeRequest = AvailableRegion<MissionControlBoardItem["mergeRequests"]>[number];
type DetailTarget =
  | { type: "ask"; ask: ShellAsk }
  | { type: "work"; item: MissionControlBoardItem }
  | { type: "stage"; item: MissionControlBoardItem; stageKind: StageKind }
  | { type: "phase"; item: MissionControlBoardItem; phase: WorkPhase }
  | { type: "task"; item: MissionControlBoardItem; phase: WorkPhase; task: WorkPhase["tasks"][number] }
  | { type: "artifact"; item: MissionControlBoardItem; artifact: WorkArtifact }
  | { type: "merge-request"; item: MissionControlBoardItem; mergeRequest: WorkMergeRequest }
  | { type: "agent"; specialist: ShellDashboard["specialists"][number] }
  | { type: "engine"; engine: ShellAgentHealth };
type ArtifactContentState = { status: "loading" } | { status: "available"; content: string } | { status: "unavailable"; message: string };

export function MissionControlShell(props: {
  board: BoardLoad;
  dashboard: ShellDashboard;
  dashboardStatus: "loading" | "available" | "error";
  agents?: ReadonlyArray<ShellAgentHealth>;
  agentsStatus?: "loading" | "available" | "error";
  agentSlots?: ReadonlyArray<ShellAgentSlot>;
  agentSlotsStatus?: "loading" | "available" | "error";
  onAdvanced: () => void;
  onPause: () => void;
  onDecideAsk: (id: string, decision: "approved" | "declined") => ShellAction | Promise<ShellAction>;
  onAutopilotChange?: (settings: AutopilotSettings) => ShellAction | Promise<ShellAction>;
  onStandingRuleToggle?: (id: string, enabled: boolean) => ShellAction | Promise<ShellAction>;
  onResolveSuggestion?: (id: string, action: "accept" | "dismiss") => ShellAction | Promise<ShellAction>;
  onUndoAutomaticDecision?: (id: string) => ShellAction | Promise<ShellAction>;
  connectorOverview?: ConnectorOverview;
  setupReadFailed?: boolean;
  onRetrySetup?: () => void;
  onRefreshJira?: () => Promise<JiraRefreshResult>;
  onRefreshGitLab?: () => Promise<DiscussionRefreshResult>;
  onSaveCredential?: (reference: string, value: string) => Promise<ActionResult>;
  onRefreshConnections?: () => void;
  onOpenAgentSettings?: () => void;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const [connectionsOpen, setConnectionsOpen] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const [catchUpIndex, setCatchUpIndex] = useState(0);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [detail, setDetail] = useState<DetailTarget | null>(null);
  const catchUpButton = useRef<HTMLButtonElement>(null);
  const connectionsButton = useRef<HTMLButtonElement>(null);
  const connectionsTrigger = useRef<HTMLButtonElement | null>(null);
  const detailCloseButton = useRef<HTMLButtonElement>(null);
  const detailTrigger = useRef<HTMLElement | null>(null);
  const progressReadId = useRef(0);
  const artifactReadId = useRef(0);
  const [progress, setProgress] = useState<WorkProgressState | null>(null);
  const [artifactContent, setArtifactContent] = useState<ArtifactContentState | null>(null);
  const agents = props.agents ?? [];
  const agentsStatus = props.agentsStatus ?? "loading";
  const agentSlots = props.agentSlots ?? [];
  const agentSlotsStatus = props.agentSlotsStatus ?? "loading";
  const closeCatchUp = () => { setCatchUpOpen(false); setCatchUpIndex(0); catchUpButton.current?.focus(); };
  const closeDetail = () => { progressReadId.current += 1; artifactReadId.current += 1; setDetail(null); detailTrigger.current?.focus(); };
  const openWork = (item: MissionControlBoardItem, trigger: HTMLElement) => {
    const readId = ++progressReadId.current;
    artifactReadId.current += 1;
    detailTrigger.current = trigger;
    setProgress({ status: "loading" });
    setDetail({ type: "work", item });
    void fetch(`/api/work-items/${encodeURIComponent(item.workItem.id)}/progress`).then(async (response) => {
      const data = await response.json() as { progress?: unknown; error?: string };
      if (response.ok === false || !isWorkProgress(data.progress)) throw new Error(data.error ?? "Progress is unavailable or incomplete");
      if (readId === progressReadId.current) setProgress({ status: "available", data: data.progress });
    }).catch((error: unknown) => { if (readId === progressReadId.current) setProgress({ status: "error", message: error instanceof Error ? error.message : "Progress is unavailable" }); });
  };
  const openStage = (item: MissionControlBoardItem, stageKind: StageKind, trigger: HTMLElement) => {
    detailTrigger.current = trigger;
    setDetail({ type: "stage", item, stageKind });
  };
  const openStageFromWork = (item: MissionControlBoardItem, stageKind: StageKind) => setDetail({ type: "stage", item, stageKind });
  const openArtifact = (item: MissionControlBoardItem, artifact: WorkArtifact) => {
    const readId = ++artifactReadId.current;
    setArtifactContent({ status: "loading" });
    setDetail({ type: "artifact", item, artifact });
    void fetch(`/api/artifacts/${encodeURIComponent(artifact.id)}/content`).then(async (response) => {
      const data = await response.json() as { available?: unknown; content?: unknown; filesChanged?: unknown; linesAdded?: unknown; linesRemoved?: unknown; mergeRequests?: unknown; error?: unknown };
      if (response.ok === false || data.available !== true) {
        if (readId === artifactReadId.current) setArtifactContent({ status: "unavailable", message: typeof data.error === "string" ? data.error : "The code host did not return artifact content." });
        return;
      }
      const content = artifactContentText(data);
      if (readId === artifactReadId.current) {
        if (content === null) setArtifactContent({ status: "unavailable", message: "The code host returned no readable artifact content." });
        else setArtifactContent({ status: "available", content });
      }
    }).catch((error: unknown) => { if (readId === artifactReadId.current) setArtifactContent({ status: "unavailable", message: error instanceof Error ? error.message : "Artifact content is unavailable" }); });
  };
  const backToWork = (item: MissionControlBoardItem) => setDetail({ type: "work", item });
  const openSpecialist = (specialist: ShellDashboard["specialists"][number], trigger: HTMLElement) => { detailTrigger.current = trigger; setDetail({ type: "agent", specialist }); };
  const openEngine = (engine: ShellAgentHealth, trigger: HTMLElement) => { detailTrigger.current = trigger; setDetail({ type: "engine", engine }); };
  const openAsk = (ask: ShellAsk, trigger: HTMLElement) => { detailTrigger.current = trigger; setActionMessage(null); setDetail({ type: "ask", ask }); };
  const runAction = async (action: (() => ShellAction | Promise<ShellAction>) | undefined) => {
    if (!action) return;
    setActionMessage(null);
    try {
      const result = await action();
      if (result && !result.ok) setActionMessage(result.message);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Sarathi could not complete the action.");
    }
  };
  const decideAsk = async (askId: string, decision: "approved" | "declined") => {
    setActionMessage(null);
    try {
      const result = await props.onDecideAsk(askId, decision);
      if (result && !result.ok) { setActionMessage(result.message); return false; }
      return true;
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Sarathi could not complete this decision.");
      return false;
    }
  };
  const decideCatchUpAsk = async (decision: "approved" | "declined") => {
    const ask = asks[catchUpIndex];
    if (!ask) return;
    const currentIndex = catchUpIndex;
    const remaining = asks.length;
    if (await decideAsk(ask.id, decision)) {
      if (remaining <= 1) closeCatchUp();
      else setCatchUpIndex(Math.min(currentIndex, remaining - 2));
    }
  };

  useEffect(() => { if (detail) detailCloseButton.current?.focus(); }, [detail]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"][aria-modal="true"]');
        if (dialog) {
          const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(
            'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
          )).filter((element) => element.getClientRects().length > 0);
          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          if (!first || !last) {
            event.preventDefault();
            dialog.focus();
          } else if (!dialog.contains(document.activeElement)) {
            event.preventDefault();
            first.focus();
          } else if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first.focus();
          }
        }
      }
      if (event.key === "Escape" && connectionsOpen) { setConnectionsOpen(false); (connectionsTrigger.current ?? connectionsButton.current)?.focus(); return; }
      if (event.key === "Escape" && catchUpOpen) { closeCatchUp(); return; }
      if (event.key === "Escape" && detail) { closeDetail(); return; }
      const target = event.target;
      const editable = target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]");
      if (editable || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key.toLowerCase() === "c" && !catchUpOpen && props.dashboard.asks.length > 0) {
        event.preventDefault();
        setCatchUpIndex(0);
        setCatchUpOpen(true);
      } else if (catchUpOpen && event.key.toLowerCase() === "s" && asks.length > 0) {
        event.preventDefault();
        setCatchUpIndex((index) => (index + 1) % asks.length);
      } else if (catchUpOpen && event.key.toLowerCase() === "a") {
        event.preventDefault();
        void decideCatchUpAsk("approved");
      } else if (catchUpOpen && event.key.toLowerCase() === "d") {
        event.preventDefault();
        void decideCatchUpAsk("declined");
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [connectionsOpen, catchUpOpen, detail, props.dashboard.asks, catchUpIndex]);

  const items = props.board.status === "available" && props.board.board.workItems.status === "available" ? props.board.board.workItems.data : [];
  const asks = props.dashboard.asks;
  const automaticDecisions = props.dashboard.automaticDecisions ?? [];
  const standingRuleSuggestions = (props.dashboard.standingRuleSuggestions ?? []).filter((suggestion) => !suggestion.state || suggestion.state === "offered");
  const standingRules = props.dashboard.standingRules ?? [];
  const autopilot = props.dashboard.autopilot ?? { low: "ask", medium: "ask", high: "ask" };
  const catchUpAsk = asks[catchUpIndex];
  const detailAskPending = detail?.type !== "ask" || asks.some((ask) => ask.id === detail.ask.id);
  const specialists = props.dashboard.specialists;
  const connectionIssue = (agentsStatus === "available" && !agents.some((agent) => agent.health.ok)) || (props.connectorOverview && ([props.connectorOverview.workSource, props.connectorOverview.codeHost].some((connection) => connection.status === "unconfigured" || connection.status === "error") || (props.connectorOverview.jiraSync.status === "available" && props.connectorOverview.jiraSync.data.state !== "available") || (props.connectorOverview.gitLabSync.status === "available" && props.connectorOverview.gitLabSync.data.state !== "available")));
  const openConnections = (trigger: HTMLButtonElement) => { connectionsTrigger.current = trigger; props.onRefreshConnections?.(); setConnectionsOpen(true); };

  return <main className={`mc-root${railOpen ? " mc-rail-expanded" : ""}`} aria-label="Sarathi Mission Control">
    <a className="mc-skip" href="#mc-asks">Skip to asks</a>
    <header className="mc-header">
      <div className="mc-brand"><span className="mc-brand-mark" aria-hidden="true">✳</span><span>Sarathi</span><span className="mc-header-divider" aria-hidden="true" /><span className="mc-header-context">Mission Control</span></div>
      <div className="mc-header-actions">
        <span className={`mc-connection mc-${props.dashboard.runtime.state}`}>{props.dashboard.runtime.name} · {props.dashboard.runtime.state}</span>
        <button type="button" className="mc-tool" onClick={props.onPause}>{props.dashboard.controls.manualPaused ? "Resume" : "Pause"}</button>
        <button ref={connectionsButton} type="button" className="mc-tool" onClick={(event) => openConnections(event.currentTarget)}>Connections</button>
        <button type="button" className="mc-tool" onClick={props.onAdvanced}>Advanced controls</button>
        <button type="button" className="mc-tool mc-agent-toggle" onClick={() => setRailOpen((open) => !open)} aria-expanded={railOpen} aria-controls="mc-agent-rail">Agents</button>
      </div>
    </header>
    <div className="mc-layout">
      <div className="mc-page">
        {(props.setupReadFailed || connectionIssue) && <section className="mc-connection-notice" aria-label="Connection status">
          <div><p className="mc-eyebrow">Getting started</p><h2>{props.setupReadFailed ? "Connection status could not be checked" : "Bring your work into Mission Control"}</h2><p role={props.setupReadFailed ? "alert" : undefined}>{props.setupReadFailed ? "Could not read setup status. Mission Control is still available. Retry the status check, or open Connections to inspect Jira and GitLab." : "Set up Jira for work items, GitLab for code reviews, and an agent to run tasks. You can explore Mission Control while setup is incomplete."}</p></div>
          <div className="mc-connection-notice-actions"><button type="button" className="mc-primary" onClick={(event) => openConnections(event.currentTarget)}>Set up connections</button>{props.setupReadFailed && <button type="button" className="mc-tool" onClick={props.onRetrySetup}>Retry setup read</button>}</div>
        </section>}
        <section className="mc-hero" aria-labelledby="mc-hero-title">
          <div><p className="mc-eyebrow">Your control room</p><h1 id="mc-hero-title">{props.dashboardStatus === "error" ? "Decisions unavailable" : props.dashboardStatus === "loading" ? "Loading decisions" : asks.length > 0 ? `${asks.length} ${asks.length === 1 ? "thing" : "things"} need you` : "No decisions waiting"}</h1>
            <p className="mc-hero-detail">{props.dashboardStatus === "error" ? "Sarathi could not read the latest decisions." : props.dashboardStatus === "loading" ? "Reading the latest decisions and activity." : asks.length > 0 ? "Review the decisions waiting for you, then follow work as it moves." : "There are no decisions waiting for you right now."}</p>
            <div className="mc-hero-stats"><BoardSummary board={props.board} count={items.length} /></div>
          </div>
          <button ref={catchUpButton} type="button" className="mc-primary" disabled={asks.length === 0} onClick={() => setCatchUpOpen(true)}>{asks.length > 0 ? `Catch up on ${asks.length}` : "Nothing to do"}</button>
        </section>
        <section id="mc-asks" className="mc-section" role="region" aria-label="Asks">
          <SectionHeading eyebrow="Decision queue" title="Asks" detail={asks.length > 0 ? `${asks.length} waiting` : "All clear"} />
          {props.dashboardStatus === "loading" ? <StateText>Loading decisions…</StateText> : props.dashboardStatus === "error" ? <StateText>Decisions are unavailable. Try again from Advanced controls.</StateText> : asks.length === 0 ? <StateText>No asks are waiting.</StateText> :
            <div className="mc-ask-grid">{asks.slice(0, 3).map((ask) => <article className="mc-ask" key={ask.id}><span className="mc-ask-kind">{ask.kind.replaceAll(".", " · ")}</span><h3>{ask.intent.context.repository ?? ask.workItemId ?? ask.intent.target ?? "Sarathi decision"}</h3><p>{ask.intent.context.body ?? "Your decision is needed before this work can continue."}</p><span className="mc-ask-time">{ask.risk ? `${ask.risk} risk · ` : ""}Observed {ask.createdAt}</span><button type="button" aria-label={`Review ${ask.kind}`} onClick={(event) => openAsk(ask, event.currentTarget)}>Review decision</button></article>)}</div>}
        </section>
        <section className="mc-section mc-rules" role="region" aria-label="Rules and autopilot">
          <SectionHeading eyebrow="Decision policy" title="Rules & autopilot" detail={props.dashboardStatus === "available" ? `${standingRules.filter((rule) => rule.enabled).length} enabled rules` : "Observation"} />
          {props.dashboardStatus === "loading" ? <StateText>Loading decision policy…</StateText> : props.dashboardStatus === "error" ? <StateText>Decision policy unavailable.</StateText> : <>
          <p className="mc-floor-note">The immutable floor always takes precedence over standing rules and autopilot.</p>
          <div className="mc-policy-grid">
            <section className="mc-policy-card" aria-label="Standing rule suggestions"><h3>Suggestions</h3>{standingRuleSuggestions.length === 0 ? <p>No standing rule suggestions.</p> : standingRuleSuggestions.map((suggestion) => <div className="mc-policy-row" key={suggestion.id}><span><strong>{suggestion.askKind}</strong><small>{suggestion.scope}</small></span><button type="button" onClick={() => void runAction(() => props.onResolveSuggestion?.(suggestion.id, "accept"))} aria-label={`Accept suggestion ${suggestion.askKind}`}>Accept</button><button type="button" onClick={() => void runAction(() => props.onResolveSuggestion?.(suggestion.id, "dismiss"))} aria-label={`Dismiss suggestion ${suggestion.askKind}`}>Dismiss</button></div>)}</section>
            <section className="mc-policy-card" aria-label="Standing rules"><h3>Standing rules</h3>{standingRules.length === 0 ? <p>No standing rules are configured.</p> : standingRules.map((rule) => <div className="mc-policy-row" key={rule.id}><span><strong>{rule.label}</strong><small>{rule.askKind} · {rule.scope} · fired {rule.firedCount} times</small></span><button type="button" onClick={() => void runAction(() => props.onStandingRuleToggle?.(rule.id, !rule.enabled))} aria-label={`${rule.enabled ? "Disable" : "Enable"} rule ${rule.label}`}>{rule.enabled ? "Disable" : "Enable"}</button></div>)}</section>
            <section className="mc-policy-card" aria-label="Autopilot tiers"><h3>Autopilot</h3>{(["low", "medium", "high"] as const).map((tier) => <label className="mc-tier-row" key={tier} htmlFor={`mc-autopilot-${tier}`}>{tier} risk decisions<select id={`mc-autopilot-${tier}`} aria-label={`Autopilot ${tier}-risk decisions`} value={autopilot[tier]} onChange={(event) => void runAction(() => props.onAutopilotChange?.({ ...autopilot, [tier]: event.target.value as "ask" | "automatic" }))}><option value="ask">Ask first</option><option value="automatic">Automatic when allowed</option></select></label>)}</section>
            <section className="mc-policy-card" aria-label="Automatic decision audit"><h3>Automatic decision audit</h3>{automaticDecisions.length === 0 ? <p>No automatic decisions recorded.</p> : automaticDecisions.map((decision) => <div className="mc-policy-row" key={decision.id}><span><strong>Automatic decision: {decision.intent.operation} · {decision.intent.target}</strong><small>{decision.source}: {decision.sourceDetail} · {decision.workItemId ?? "No work item"} · {decision.createdAt}{decision.undone ? " · undone" : decision.undoable ? " · undo available" : " · cannot be undone"}</small></span><button type="button" disabled={decision.undone || !decision.undoable} onClick={() => void runAction(() => props.onUndoAutomaticDecision?.(decision.id))} aria-label={`Undo ${decision.id}`}>Undo</button></div>)}</section>
          </div>
          {actionMessage && <p className="mc-action-message" role="alert">{actionMessage}</p>}
          </>}
        </section>
        <section className="mc-section" role="region" aria-label="Work pipeline">
          <SectionHeading eyebrow="Current work" title="Work pipeline" detail={props.board.status === "available" && props.board.board.workItems.status === "available" ? `${items.length} work items` : "Observation"} />
          <WorkPipeline board={props.board} onOpenWork={openWork} onOpenStage={openStage} />
        </section>
        <DiscussionRemediation board={props.board} asks={asks} onReviewAsk={openAsk} />
        <section className="mc-section" role="region" aria-label="Activity">
          <SectionHeading eyebrow="Latest signals" title="Activity" detail={props.dashboard.activity.length > 0 ? `${props.dashboard.activity.length} events` : "Quiet"} />
          {props.dashboardStatus === "loading" ? <StateText>Loading activity…</StateText> : props.dashboardStatus === "error" ? <StateText>Activity is unavailable.</StateText> : props.dashboard.activity.length === 0 ? <StateText>No activity recorded yet.</StateText> : <ol className="mc-activity-list">{props.dashboard.activity.slice(0, 8).map((entry) => <li key={entry.id}><time dateTime={entry.occurredAt}>{entry.occurredAt}</time><span>{entry.what}</span><small>{entry.agent}{entry.workItemId ? ` · ${entry.workItemId}` : ""}</small></li>)}</ol>}
        </section>
      </div>
      <aside id="mc-agent-rail" className="mc-agent-rail" role="region" aria-label="Agents"><h2>{railOpen ? "Agent pool" : "Agents"}</h2>
        {props.dashboardStatus === "loading" ? <p className="mc-rail-empty">Loading agents…</p> : props.dashboardStatus === "error" ? <p className="mc-rail-empty">Agent list unavailable.</p> : specialists.length === 0 ? <p className="mc-rail-empty">{railOpen ? "No specialists configured" : "0"}</p> : specialists.map((specialist) => <button className="mc-agent" key={specialist.id} title={`${specialist.name} · ${specialist.role}`} aria-label={`Details for ${specialist.name}`} onClick={(event) => openSpecialist(specialist, event.currentTarget)} type="button"><span className="mc-avatar">{specialist.name.slice(0, 1).toUpperCase()}</span>{railOpen && <span><strong>{specialist.name}</strong><small>{specialist.status === "active" ? "Active" : "Pending approval"}{specialist.slotLimit ? ` · ${specialist.slotLimit} configured slots` : ""}</small></span>}</button>)}
        {railOpen && <section className="mc-engine-health"><h3>Runtime health</h3>{agentsStatus === "loading" ? <p>Loading agent health…</p> : agentsStatus === "error" ? <p>Agent health unavailable.</p> : agents.length === 0 ? <p>No agent health observations.</p> : agents.map((engine) => <button type="button" key={engine.id} onClick={(event) => openEngine(engine, event.currentTarget)}>{engine.displayName} · {engine.health.ok ? "healthy" : "unavailable"}</button>)}</section>}
      </aside>
    </div>
    {detail && <div className="mc-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeDetail(); }}><section className="mc-drawer" role="dialog" aria-modal="true" aria-label={detail.type === "ask" ? "Decision details" : detail.type === "work" ? "Work item details" : detail.type === "stage" ? "Stage details" : detail.type === "phase" ? "Phase details" : detail.type === "task" ? "Task details" : detail.type === "artifact" ? "Artifact details" : detail.type === "merge-request" ? "Merge request details" : "Agent details"}>
      <div className="mc-drawer-header"><div><p className="mc-eyebrow">{detail.type === "ask" ? "Pending decision" : detail.type === "work" ? "Work item" : detail.type === "stage" ? "Stage" : detail.type === "phase" ? "Phase" : detail.type === "task" ? "Task" : detail.type === "artifact" ? "Artifact" : detail.type === "merge-request" ? "Merge request" : detail.type === "agent" ? "Specialist" : "Agent engine"}</p><h2>{detail.type === "ask" ? detail.ask.kind : detail.type === "work" ? detail.item.workItem.title : detail.type === "stage" ? stageLabel(detail.stageKind) : detail.type === "phase" ? detail.phase.phase.name : detail.type === "task" ? detail.task.name : detail.type === "artifact" ? detail.artifact.name : detail.type === "merge-request" ? detail.mergeRequest.title : detail.type === "agent" ? detail.specialist.name : detail.engine.displayName}</h2></div><button ref={detailCloseButton} type="button" onClick={closeDetail} aria-label="Close details">Close</button></div>
      {detail.type === "ask" && <>
        <section className="mc-detail-section"><h3>Decision context</h3><p>Risk: <strong>{detail.ask.risk ?? "unknown"}</strong></p><p>Tool: {detail.ask.intent.tool}</p><p>Operation: {detail.ask.intent.operation ?? detail.ask.kind}</p><p>Target: {detail.ask.intent.target ?? detail.ask.workItemId ?? "unknown"}</p><p>Work item: {detail.ask.workItemId ?? "No work item linked"}</p><p>Created: <time dateTime={detail.ask.createdAt}>{detail.ask.createdAt}</time></p>
          {detail.ask.intent.context.repository && <p>Repository: {detail.ask.intent.context.repository}</p>}
          {detail.ask.intent.context.mergeRequestIid && <p>Merge request: !{detail.ask.intent.context.mergeRequestIid}</p>}
          {detail.ask.intent.context.version && <p>Version: {detail.ask.intent.context.version} · {detail.ask.intent.context.channel ?? "channel unknown"}</p>}
          {detail.ask.intent.context.notes && <p>Notes: {detail.ask.intent.context.notes}</p>}
          {detail.ask.intent.context.body && <p>Observed request: {detail.ask.intent.context.body}</p>}
          {detail.ask.kind === "track.change" && <TrackChangeDetails context={detail.ask.intent.context} />}
          <p>This decision is handled by Sarathi’s permission engine. The immutable floor remains in force.</p>
        </section>
        {actionMessage && <p className="mc-action-message" role="alert">{actionMessage}</p>}
        {!detailAskPending && <p className="mc-action-message" role="status">This decision is no longer pending in Sarathi.</p>}
        <div className="mc-decision-actions"><button type="button" disabled={!detailAskPending} onClick={() => void decideAsk(detail.ask.id, "approved").then((ok) => { if (ok) closeDetail(); })}>Approve</button><button type="button" disabled={!detailAskPending} onClick={() => void decideAsk(detail.ask.id, "declined").then((ok) => { if (ok) closeDetail(); })}>Decline</button></div>
      </>}
      {detail.type === "work" && <>
        <p className="mc-drawer-source">{detail.item.workItem.workSourceKey ?? "Local work"} · {detail.item.workItem.repositories.join(", ") || "No repositories"}</p>
        <section className="mc-detail-section"><h3>Counted progress</h3><p>{detail.item.stages.completed} / {detail.item.stages.total} stages complete</p><p>{detail.item.tasks ? `${detail.item.tasks.completed} / ${detail.item.tasks.total} phase tasks complete` : "Task progress unknown"}</p>
          {progress?.status === "loading" ? <p>Loading checklist and pipeline counts…</p> : progress?.status === "error" ? <p role="status">Detailed progress unavailable: {progress.message}</p> : progress?.status === "available" && progress.data ? <div className="mc-progress-grid"><p>Checklist tasks: {formatCount(progress.data.tasks)}</p><p>Checks: {formatCount(progress.data.checks)}</p><p>Changed files: {progress.data.diff?.filesChanged ?? "unknown"}</p><p>Changed lines: {progress.data.diff ? `+${progress.data.diff.linesAdded} / −${progress.data.diff.linesRemoved}` : "unknown"}</p><p>Pipeline jobs: {formatCount(progress.data.pipelineJobs)}</p></div> : null}</section>
        <section className="mc-detail-section"><h3>Stages</h3><div className="mc-detail-list">{detail.item.workItem.stages.map((stage) => <button key={stage.kind} type="button" onClick={() => openStageFromWork(detail.item, stage.kind)}>{stageLabel(stage.kind)} stage: {stage.state}</button>)}</div></section>
        <DetailRegion title="Phases" region={detail.item.phases} empty="No phases observed.">{(phases) => <div className="mc-detail-list">{phases.map((phase) => <button key={phase.phase.number} type="button" onClick={() => setDetail({ type: "phase", item: detail.item, phase })}>Phase {phase.phase.number}: {phase.phase.name}</button>)}</div>}</DetailRegion>
        <DetailRegion title="Artifacts" region={detail.item.artifacts} empty="No artifacts observed.">{(artifacts) => <div className="mc-detail-list">{artifacts.map((artifact) => <button key={artifact.id} type="button" onClick={() => openArtifact(detail.item, artifact)}>Artifact: {artifact.name} v{artifact.version} · {artifact.approvalState}</button>)}</div>}</DetailRegion>
        <DetailRegion title="Merge requests" region={detail.item.mergeRequests} empty="No merge requests observed.">{(mergeRequests) => <div className="mc-detail-list">{mergeRequests.map((mergeRequest) => <button key={`${mergeRequest.repository}-${mergeRequest.number}`} type="button" onClick={() => setDetail({ type: "merge-request", item: detail.item, mergeRequest })}>Merge request: {mergeRequest.repository} !{mergeRequest.number}</button>)}</div>}</DetailRegion>
      </>}
      {detail.type === "stage" && <><button className="mc-back-button" type="button" onClick={() => backToWork(detail.item)}>Back to work item</button><section className="mc-detail-section"><h3>{detail.item.workItem.title}</h3><p>{stageLabel(detail.stageKind)} stage state: <strong>{detail.item.workItem.stages.find((stage) => stage.kind === detail.stageKind)?.state ?? "unknown"}</strong></p></section></>}
      {detail.type === "phase" && <><button className="mc-back-button" type="button" onClick={() => backToWork(detail.item)}>Back to work item</button><section className="mc-detail-section"><h3>Phase {detail.phase.phase.number} · {detail.phase.phase.state}</h3><p>{detail.phase.phase.demoSentence}</p><h3>Tasks</h3>{detail.phase.tasks.length === 0 ? <p>No tasks observed for this phase.</p> : <div className="mc-detail-list">{detail.phase.tasks.map((task) => <button key={task.taskId} type="button" onClick={() => setDetail({ type: "task", item: detail.item, phase: detail.phase, task })}>Task: {task.name}</button>)}</div>}</section></>}
      {detail.type === "task" && <><button className="mc-back-button" type="button" onClick={() => setDetail({ type: "phase", item: detail.item, phase: detail.phase })}>Back to phase</button><section className="mc-detail-section"><h3>{detail.task.name}</h3><p>Observed task status: <strong>{detail.task.status}</strong></p><p>Phase: {detail.phase.phase.name}</p></section></>}
      {detail.type === "artifact" && <><button className="mc-back-button" type="button" onClick={() => backToWork(detail.item)}>Back to work item</button><section className="mc-detail-section"><h3>Artifact record</h3><p>Version {detail.artifact.version} · approval {detail.artifact.approvalState}</p><p>Stage: {stageLabel(detail.artifact.stageKind)}</p>{artifactContent?.status === "loading" ? <p>Loading artifact content…</p> : artifactContent?.status === "unavailable" ? <p role="status">Artifact content unavailable. {artifactContent.message}</p> : artifactContent?.status === "available" ? <pre className="mc-artifact-content">{artifactContent.content}</pre> : <p>Artifact content has not been read.</p>}</section></>}
      {detail.type === "merge-request" && <><button className="mc-back-button" type="button" onClick={() => backToWork(detail.item)}>Back to work item</button><section className="mc-detail-section"><h3>{detail.mergeRequest.repository} !{detail.mergeRequest.number}</h3><p>Observed state: <strong>{detail.mergeRequest.state}</strong></p><p>Pipeline: <strong className={`mc-pipeline-${detail.mergeRequest.pipelineResult}`}>{detail.mergeRequest.pipelineResult}</strong></p><p>Jobs: {detail.mergeRequest.jobsCompleted} / {detail.mergeRequest.jobsTotal}</p><p>Branch: {detail.mergeRequest.branch}</p></section></>}
      {detail.type === "agent" && <section className="mc-detail-section"><h3>Assignment</h3><p>Role: {detail.specialist.role}</p><p>Runtime: {detail.specialist.runtime ?? "unknown"}</p><p>Approval state: {detail.specialist.status === "active" ? "active" : "pending approval"}</p><p>Health: {describeAgentHealth(detail.specialist.runtime, agents, agentsStatus)}</p><p>Slots in use: {describeAgentSlots(detail.specialist.id, agentSlots, agentSlotsStatus)}</p><p>Scope: {detail.specialist.scope || "No scope recorded"}</p><h3>Capability tags</h3>{detail.specialist.capabilityTags?.length ? <ul className="mc-capability-list">{detail.specialist.capabilityTags.map((tag) => <li key={tag}>{tag}</li>)}</ul> : <p>No capability tags configured.</p>}<h3>Recent task state</h3><p>System-wide; specialist attribution unavailable.</p>{props.dashboard.recentTasks?.length ? <ul className="mc-capability-list">{props.dashboard.recentTasks.slice(0, 5).map((task) => <li key={task.id}>{task.title} · {task.status}</li>)}</ul> : <p>No recent tasks recorded.</p>}</section>}
      {detail.type === "engine" && <section className="mc-detail-section"><h3>Observed health</h3><p>Engine: {detail.engine.kind}</p><p>Health: {detail.engine.health.ok ? "healthy" : `unavailable: ${detail.engine.health.reason}`}</p><p>Slot capacity unknown: runtime health has no specialist slot assignment.</p></section>}
    </section></div>}
    {catchUpOpen && <div className="mc-modal-backdrop"><section className="mc-catchup" role="dialog" aria-modal="true" aria-label="Catch up"><div className="mc-catchup-header"><h2>Decisions waiting</h2><button type="button" onClick={closeCatchUp} autoFocus>Leave catch-up</button></div>{catchUpAsk ? <article key={catchUpAsk.id}><span>{catchUpIndex + 1} of {asks.length}</span><strong>{catchUpAsk.kind.replaceAll(".", " · ")}</strong><p>{catchUpAsk.intent.context.body ?? catchUpAsk.workItemId ?? catchUpAsk.intent.target ?? "Sarathi decision"}</p>{catchUpAsk.kind === "track.change" && <TrackChangeDetails context={catchUpAsk.intent.context} />}<div><button type="button" onClick={() => void decideCatchUpAsk("approved")}>Approve (A)</button><button type="button" onClick={() => void decideCatchUpAsk("declined")}>Decline (D)</button><button type="button" onClick={() => setCatchUpIndex((index) => (index + 1) % asks.length)}>Skip (S)</button></div></article> : <article><p>No asks are waiting in the canonical queue.</p><button type="button" onClick={closeCatchUp}>Leave catch-up</button></article>}{actionMessage && <p role="alert" className="mc-action-message">{actionMessage}</p>}</section></div>}
    {connectionsOpen && <div className="mc-modal-backdrop"><section className="mc-connector-dialog" role="dialog" aria-modal="true" aria-label="Connections and setup"><ConnectorCenter
      overview={props.connectorOverview ?? loadingConnectorOverview}
      agents={agents.map((agent) => ({ displayName: agent.displayName, health: agent.health }))}
      agentsStatus={agentsStatus}
      isSetup={false}
      onRefreshJira={props.onRefreshJira ?? (async () => ({ ok: false, message: "Jira refresh is unavailable." }))}
      onRefreshGitLab={props.onRefreshGitLab ?? (async () => ({ ok: false, message: "GitLab discussion refresh is unavailable." }))}
      onSaveCredential={props.onSaveCredential ?? (async () => ({ ok: false, message: "Credential storage is unavailable." }))}
      onOpenAgentSettings={props.onOpenAgentSettings ?? props.onAdvanced}
      onClose={() => { setConnectionsOpen(false); (connectionsTrigger.current ?? connectionsButton.current)?.focus(); }}
    /></section></div>}
  </main>;
}

const loadingConnectorOverview: ConnectorOverview = {
  workSource: { status: "loading" },
  codeHost: { status: "loading" },
  jiraSync: { status: "loading" },
  gitLabSync: { status: "loading" }
};

function DiscussionRemediation(props: { board: BoardLoad; asks: ReadonlyArray<ShellAsk>; onReviewAsk: (ask: ShellAsk, trigger: HTMLElement) => void }) {
  return <section className="mc-section" role="region" aria-label="GitLab discussions and remediation">
    <SectionHeading eyebrow="Observed code review" title="GitLab discussions" detail={discussionSummary(props.board)} />
    {props.board.status === "loading" ? <StateText>Loading GitLab discussions…</StateText>
      : props.board.status === "error" ? <StateText>GitLab discussion observation is unavailable: {props.board.message}</StateText>
        : props.board.status === "unsupported" ? <StateText>GitLab discussion observation is unsupported by this server.</StateText>
          : props.board.board.gitLabDiscussions.observations.length === 0 ? <StateText>{emptyDiscussionMessage(props.board.board.gitLabDiscussions.sync)}</StateText>
            : <div className="mc-discussion-list">{props.board.board.gitLabDiscussions.observations.map((observation) => {
              const linkedAsk = observation.askId ? props.asks.find((ask) => ask.id === observation.askId) : undefined;
              const milestones = observation.milestones;
              return <article className="mc-discussion-card" key={observation.id}>
                <header><div><p className="mc-eyebrow">{observation.repository} !{observation.mergeRequestIid}</p><h3>{observation.mergeRequestTitle}</h3></div><span className={`mc-discussion-state mc-discussion-${observation.status}`}>{discussionStatus(observation)}</span></header>
                <p className="mc-discussion-identity">Discussion {observation.discussionId} · last observed {observation.lastObservedAt}</p>
                {observation.notes.length > 0 ? <ul className="mc-discussion-notes">{observation.notes.map((note) => <li key={note.id}><span>{note.author?.name ?? note.author?.username ?? (note.system ? "GitLab system" : "GitLab user")}{note.system ? " · system note" : ""}</span><p>{note.body}</p></li>)}</ul> : <p className="mc-discussion-identity">No discussion notes observed.</p>}
                {observation.admissionState === "blocked" && <p className="mc-discussion-blocked">Blocked: {observation.blockedReason ?? "No eligible agent capability was observed."}</p>}
                {observation.admissionState === "pending" && <p className="mc-discussion-identity">{linkedAsk ? "Waiting for the canonical Sarathi decision." : "Admission has not been observed."}</p>}
                {observation.admissionState === "admitted" && <p className="mc-discussion-identity">{milestones.admitted ? `Task admitted: ${milestones.admitted.taskId}` : observation.taskId ? `Task admitted: ${observation.taskId}` : "Admission observed; task identifier unavailable."}</p>}
                <ul className="mc-remediation-milestones" aria-label="Remediation milestones">
                  <li>Task admitted: {milestones.admitted ? milestones.admitted.taskId : "not observed"}</li>
                  <li>Fix produced: {milestones.fixProduced ? milestones.fixProduced.taskId : "not observed"}</li>
                  <li>Commit pushed: {milestones.pushed ? milestones.pushed.commitSha : "not observed"}</li>
                  <li>Pipeline {milestones.pipeline ? `${milestones.pipeline.result} · ${milestones.pipeline.pipelineId}` : "result not observed"}</li>
                  <li>{milestones.resolved || observation.resolved ? "Thread resolved by GitLab" : "Thread resolution not observed"}</li>
                </ul>
                {linkedAsk ? <button type="button" className="mc-tool" aria-label="Review canonical ask" onClick={(event) => props.onReviewAsk(linkedAsk, event.currentTarget)}>Review canonical ask</button> : observation.askId ? <p className="mc-discussion-identity">Canonical ask is no longer pending.</p> : null}
              </article>;
            })}</div>}
  </section>;
}

function discussionSummary(board: BoardLoad): string {
  if (board.status !== "available") return "Observation state";
  const status = board.board.gitLabDiscussions.sync;
  if (status.state === "failed") return "Last refresh failed";
  if (status.stale) return "Stale observation";
  if (status.state === "syncing") return "Refresh in progress";
  if (status.lastSuccessAt) return `Last read ${status.lastSuccessAt}`;
  return status.configured ? "Waiting for first read" : "Not configured";
}

function emptyDiscussionMessage(sync: MissionControlBoard["gitLabDiscussions"]["sync"]): string {
  if (sync.state === "failed") return "Last GitLab discussion read failed. No empty result was recorded.";
  if (sync.stale) return "GitLab discussion observation is stale. No current empty result is available.";
  if (sync.state === "syncing") return "GitLab discussion refresh is in progress.";
  if (!sync.configured || sync.state === "unconfigured") return "GitLab discussions are not configured.";
  if (!sync.lastSuccessAt) return "Waiting for a successful GitLab discussion read.";
  return "No GitLab discussions observed in the last successful read.";
}

function discussionStatus(observation: MissionControlBoard["gitLabDiscussions"]["observations"][number]): string {
  if (observation.status === "stale") return "Stale observation";
  if (observation.status === "not-observed") return "Not in latest read";
  return observation.resolved || observation.milestones.resolved ? "Resolved by GitLab" : "Open at last read";
}

function WorkPipeline(props: { board: BoardLoad; onOpenWork: (item: MissionControlBoardItem, trigger: HTMLElement) => void; onOpenStage: (item: MissionControlBoardItem, stageKind: StageKind, trigger: HTMLElement) => void }) {
  if (props.board.status === "loading") return <StateText>Loading work pipeline…</StateText>;
  if (props.board.status === "error") return <StateText>{props.board.message}</StateText>;
  if (props.board.status !== "available") return <StateText>Work pipeline is unsupported by this server.</StateText>;
  if (props.board.board.workItems.status !== "available") return <StateText>{props.board.board.workItems.reason}</StateText>;
  const items = props.board.board.workItems.data;
  if (items.length === 0) return <StateText>No work items are in the pipeline.</StateText>;
  const groups = new Map<string, MissionControlBoardItem[]>();
  for (const item of items) {
    const key = item.workItem.track ? item.workItem.track.stages.join(" → ") || "(no stages configured)" : "(no track assigned)";
    groups.set(key, [...(groups.get(key) ?? []), item]);
  }
  return <div className="mc-track-groups">{[...groups.entries()].map(([track, groupItems]) => {
    const stageKinds = groupItems[0]!.workItem.track?.stages ?? [...new Set(groupItems.flatMap((item) => item.workItem.stages.map((stage) => stage.kind)))];
    return <section className="mc-track-group" role="region" aria-label={`Track: ${track.replaceAll("(no track assigned)", "no track assigned").replaceAll("(no stages configured)", "no stages configured")}`} key={track}>
      <h3>{track.startsWith("(") ? track.slice(1, -1) : track}</h3>
      <div className="mc-track-work-list">{groupItems.map((item) => <article className="mc-track-work" key={item.workItem.id}><div><strong>{item.workItem.title}</strong><small>{item.workItem.workSourceKey ?? "Local work"}</small></div><span>{item.stages.completed} / {item.stages.total} stages · {item.tasks ? `${item.tasks.completed} / ${item.tasks.total} tasks` : "task count unknown"}</span><button type="button" onClick={(event) => props.onOpenWork(item, event.currentTarget)} aria-label={`Details for ${item.workItem.title}`}>Details</button></article>)}</div>
      <div className="mc-stage-grid">{stageKinds.length === 0 ? <p className="mc-region-state">No stages are defined for this track.</p> : stageKinds.map((kind) => <section className="mc-stage-lane" role="region" aria-label={`Stage lane: ${stageLabel(kind)}`} key={kind}>
        <h4>{stageLabel(kind)}</h4>
        {groupItems.map((item) => {
          const stage = item.workItem.stages.find((candidate) => candidate.kind === kind);
          if (!stage) return null;
          return <article className="mc-stage-card" key={item.workItem.id}><span className="mc-stage-work-title">{item.workItem.title}</span><button type="button" className={`mc-stage-state mc-stage-${stage.state}`} aria-label={`${item.workItem.title} ${stageLabel(kind)} stage: ${stage.state}`} onClick={(event) => props.onOpenStage(item, kind, event.currentTarget)}>{stage.state}</button></article>;
        })}
      </section>)}</div>
    </section>;
  })}</div>;
}

function BoardSummary(props: { board: BoardLoad; count: number }) {
  if (props.board.status === "loading") return <span>Work items loading</span>;
  if (props.board.status === "error") return <span>Work item observation unavailable: {props.board.message}</span>;
  if (props.board.status === "unsupported") return <span>Work item observation is unsupported</span>;
  if (props.board.board.workItems.status !== "available") return <span>Work item observation unavailable: {props.board.board.workItems.reason}</span>;
  return <span><strong>{props.count}</strong> observed work items</span>;
}

function TrackChangeDetails(props: { context: Readonly<Record<string, string>> }) {
  const current = parseTrackStages(props.context.currentTrack);
  const proposed = parseTrackStages(props.context.proposedTrack);
  if (!current || !proposed) return <p>Current and proposed track details are unavailable.</p>;
  return <div className="mc-track-change-details"><p>Current track: {current.join(" → ")}</p><p>Proposed track: {proposed.join(" → ")}</p>{props.context.stageKind && <p>Stage to add: {props.context.stageKind} at position {props.context.index ?? "unknown"}</p>}</div>;
}

function parseTrackStages(value: string | undefined): string[] | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && parsed.every((stage) => typeof stage === "string") ? parsed : null;
  } catch { return null; }
}

function DetailRegion<T>(props: { title: string; region: MissionControlRegion<ReadonlyArray<T>>; empty: string; children: (data: ReadonlyArray<T>) => ReactNode }) {
  return <section className="mc-detail-section"><h3>{props.title}</h3>{props.region.status !== "available" ? <p role="status">{props.title} unavailable: {props.region.reason}</p> : props.region.data.length === 0 ? <p>{props.empty}</p> : props.children(props.region.data)}</section>;
}

function artifactContentText(data: { content?: unknown; filesChanged?: unknown; linesAdded?: unknown; linesRemoved?: unknown; mergeRequests?: unknown }): string | null {
  if (typeof data.content === "string") return data.content;
  if (typeof data.filesChanged === "number" && typeof data.linesAdded === "number" && typeof data.linesRemoved === "number") return `${data.filesChanged} files changed · ${data.linesAdded} added · ${data.linesRemoved} removed`;
  if (Array.isArray(data.mergeRequests) && data.mergeRequests.length > 0) {
    const summaries = data.mergeRequests.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const record = entry as { repository?: unknown; number?: unknown; state?: unknown };
      if (typeof record.repository !== "string" || typeof record.number !== "number" || typeof record.state !== "string") return [];
      return [`${record.repository} !${record.number} · ${record.state}`];
    });
    return summaries.length > 0 ? summaries.join("\n") : null;
  }
  return null;
}

function describeAgentHealth(runtime: string | undefined, agents: ReadonlyArray<ShellAgentHealth>, status: "loading" | "available" | "error"): string {
  if (status === "loading") return "observation loading";
  if (status === "error") return "unavailable (health read failed)";
  if (!runtime) return "unknown (runtime is not configured)";
  const engine = agents.find((candidate) => candidate.kind.toLowerCase() === runtime.toLowerCase());
  if (!engine) return "unknown (no matching engine observation)";
  return engine.health.ok ? "healthy" : `unavailable: ${engine.health.reason}`;
}

function describeAgentSlots(id: string, slots: ReadonlyArray<ShellAgentSlot>, status: "loading" | "available" | "error"): string {
  if (status === "loading") return "observation loading";
  if (status === "error") return "unavailable (slot read failed)";
  const slot = slots.find((candidate) => candidate.id === id);
  if (!slot) return "unknown (no slot observation)";
  return `${slot.slotsInUse} / ${slot.slotLimit}${slot.full ? " · full" : ""}`;
}

function isWorkProgress(value: unknown): value is WorkProgress {
  if (!value || typeof value !== "object") return false;
  const progress = value as Partial<WorkProgress>;
  const isCount = (count: unknown): count is { completed: number; total: number } | null => count === null || !!count && typeof count === "object" && typeof (count as { completed?: unknown }).completed === "number" && Number.isFinite((count as { completed: number }).completed) && typeof (count as { total?: unknown }).total === "number" && Number.isFinite((count as { total: number }).total);
  const isDiff = (diff: unknown): diff is WorkProgress["diff"] => diff === null || !!diff && typeof diff === "object" && ["filesChanged", "linesAdded", "linesRemoved"].every((key) => typeof (diff as Record<string, unknown>)[key] === "number" && Number.isFinite((diff as Record<string, number>)[key]));
  return isCount(progress.tasks) && isCount(progress.checks) && isDiff(progress.diff) && isCount(progress.pipelineJobs);
}

function stageLabel(kind: StageKind): string { return kind.replaceAll("-", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()); }
function formatCount(count: { completed: number; total: number } | null): string { return count ? `${count.completed} / ${count.total}` : "unknown"; }

function SectionHeading(props: { eyebrow: string; title: string; detail: string }) { return <div className="mc-section-heading"><div><p className="mc-eyebrow">{props.eyebrow}</p><h2>{props.title}</h2></div><span>{props.detail}</span></div>; }
function StateText(props: { children: ReactNode }) { return <p className="mc-region-state">{props.children}</p>; }
