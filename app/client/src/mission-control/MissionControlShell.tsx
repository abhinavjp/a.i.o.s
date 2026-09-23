import { useEffect, useRef, useState, type ReactNode } from "react";
import type { MissionControlBoard } from "@aios/contracts";
import type { BoardLoad } from "./api.js";
import "./MissionControlShell.css";

interface ShellDashboard {
  asks: ReadonlyArray<{ id: string; kind: string; workItemId: string | null; createdAt: string; intent: { tool: string; context: Record<string, string> } }>;
  activity: ReadonlyArray<{ id: string; occurredAt: string; agent: string; workItemId: string | null; what: string }>;
  specialists: ReadonlyArray<{ id: string; name: string; role: string; status: "pending_approval" | "active"; slotLimit: number }>;
  controls: { manualPaused: boolean };
  runtime: { name: string; state: "unavailable" | "unverified" | "ready" };
}

export function MissionControlShell(props: {
  board: BoardLoad;
  dashboard: ShellDashboard;
  dashboardStatus: "loading" | "available" | "error";
  onAdvanced: () => void;
  onPause: () => void;
  onDecideAsk: (id: string, decision: "approved" | "declined") => void;
}) {
  const [railOpen, setRailOpen] = useState(false);
  const [catchUpOpen, setCatchUpOpen] = useState(false);
  const catchUpButton = useRef<HTMLButtonElement>(null);
  const closeCatchUp = () => { setCatchUpOpen(false); catchUpButton.current?.focus(); };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && catchUpOpen) { closeCatchUp(); return; }
      const target = event.target;
      if (event.key.toLowerCase() === "c" && !event.altKey && !event.ctrlKey && !event.metaKey && !(target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) && props.dashboard.asks.length > 0) {
        event.preventDefault();
        setCatchUpOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [catchUpOpen, props.dashboard.asks.length]);

  const items = props.board.status === "available" && props.board.board.workItems.status === "available" ? props.board.board.workItems.data : [];
  const asks = props.dashboard.asks;
  const activeAgents = props.dashboard.specialists.filter((agent) => agent.status === "active");

  return <main className={`mc-root${railOpen ? " mc-rail-expanded" : ""}`} aria-label="Sarathi Mission Control">
    <a className="mc-skip" href="#mc-asks">Skip to asks</a>
    <header className="mc-header">
      <div className="mc-brand"><span className="mc-brand-mark" aria-hidden="true">✳</span><span>Sarathi</span><span className="mc-header-divider" aria-hidden="true" /><span className="mc-header-context">Mission Control</span></div>
      <div className="mc-header-actions">
        <span className={`mc-connection mc-${props.dashboard.runtime.state}`}>{props.dashboard.runtime.name} · {props.dashboard.runtime.state}</span>
        <button type="button" className="mc-tool" onClick={props.onPause}>{props.dashboard.controls.manualPaused ? "Resume" : "Pause"}</button>
        <button type="button" className="mc-tool" onClick={props.onAdvanced}>Advanced controls</button>
        <button type="button" className="mc-tool mc-agent-toggle" onClick={() => setRailOpen((open) => !open)} aria-expanded={railOpen} aria-controls="mc-agent-rail">Agents</button>
      </div>
    </header>
    <div className="mc-layout">
      <div className="mc-page">
        <section className="mc-hero" aria-labelledby="mc-hero-title">
          <div><p className="mc-eyebrow">Your control room</p><h1 id="mc-hero-title">{props.dashboardStatus === "error" ? "Decisions unavailable" : props.dashboardStatus === "loading" ? "Loading decisions" : asks.length > 0 ? `${asks.length} ${asks.length === 1 ? "thing" : "things"} need you` : "No decisions waiting"}</h1>
            <p className="mc-hero-detail">{props.dashboardStatus === "error" ? "Sarathi could not read the latest decisions." : props.dashboardStatus === "loading" ? "Reading the latest decisions and activity." : asks.length > 0 ? "Review the decisions waiting for you, then follow work as it moves." : "There are no decisions waiting for you right now."}</p>
            <div className="mc-hero-stats"><span><strong>{items.length}</strong> observed work items</span></div>
          </div>
          <button ref={catchUpButton} type="button" className="mc-primary" disabled={asks.length === 0} onClick={() => setCatchUpOpen(true)}>{asks.length > 0 ? `Catch up on ${asks.length}` : "Nothing to do"}</button>
        </section>
        <section id="mc-asks" className="mc-section" role="region" aria-label="Asks">
          <SectionHeading eyebrow="Decision queue" title="Asks" detail={asks.length > 0 ? `${asks.length} waiting` : "All clear"} />
          {props.dashboardStatus === "loading" ? <StateText>Loading decisions…</StateText> : props.dashboardStatus === "error" ? <StateText>Decisions are unavailable. Try again from Advanced controls.</StateText> : asks.length === 0 ? <StateText>No asks are waiting.</StateText> :
            <div className="mc-ask-grid">{asks.slice(0, 3).map((ask) => <article className="mc-ask" key={ask.id}><span className="mc-ask-kind">{ask.kind.replaceAll(".", " · ")}</span><h3>{ask.intent.context.repository ?? ask.workItemId ?? "Sarathi decision"}</h3><p>{ask.intent.context.body ?? "Your decision is needed before this work can continue."}</p><span className="mc-ask-time">Observed {ask.createdAt}</span></article>)}</div>}
        </section>
        <section className="mc-section" role="region" aria-label="Work pipeline">
          <SectionHeading eyebrow="Current work" title="Work pipeline" detail={props.board.status === "available" && props.board.board.workItems.status === "available" ? `${items.length} work items` : "Observation"} />
          {props.board.status === "loading" ? <StateText>Loading work pipeline…</StateText> : props.board.status === "error" ? <StateText>{props.board.message}</StateText> : props.board.status === "available" && props.board.board.workItems.status !== "available" ? <StateText>{props.board.board.workItems.reason}</StateText> : items.length === 0 ? <StateText>No work items are in the pipeline.</StateText> :
            <div className="mc-pipeline-list">{items.map((item) => <article className="mc-work-row" key={item.workItem.id}><div><strong>{item.workItem.title}</strong><small>{item.workItem.workSourceKey ?? "Local work"}</small></div><span>{item.stages.completed} / {item.stages.total} stages</span><span>{item.tasks ? `${item.tasks.completed} / ${item.tasks.total} tasks` : "Tasks unmeasured"}</span><span className="mc-row-state">{item.workItem.sourceObservation?.status ?? "Observed"}</span></article>)}</div>}
        </section>
        <section className="mc-section" role="region" aria-label="Activity">
          <SectionHeading eyebrow="Latest signals" title="Activity" detail={props.dashboard.activity.length > 0 ? `${props.dashboard.activity.length} events` : "Quiet"} />
          {props.dashboardStatus === "loading" ? <StateText>Loading activity…</StateText> : props.dashboardStatus === "error" ? <StateText>Activity is unavailable.</StateText> : props.dashboard.activity.length === 0 ? <StateText>No activity recorded yet.</StateText> : <ol className="mc-activity-list">{props.dashboard.activity.slice(0, 8).map((entry) => <li key={entry.id}><time dateTime={entry.occurredAt}>{entry.occurredAt}</time><span>{entry.what}</span><small>{entry.agent}{entry.workItemId ? ` · ${entry.workItemId}` : ""}</small></li>)}</ol>}
        </section>
      </div>
      <aside id="mc-agent-rail" className="mc-agent-rail" role="region" aria-label="Agents"><h2>{railOpen ? "Agent pool" : "Agents"}</h2>{activeAgents.length === 0 ? <p className="mc-rail-empty">{railOpen ? "No active agents" : "0"}</p> : activeAgents.map((agent) => <div className="mc-agent" key={agent.id} title={`${agent.name} · ${agent.role}`}><span className="mc-avatar">{agent.name.slice(0, 1).toUpperCase()}</span>{railOpen && <span><strong>{agent.name}</strong><small>{agent.role}</small></span>}</div>)}</aside>
    </div>
    {catchUpOpen && <div className="mc-modal-backdrop"><section className="mc-catchup" role="dialog" aria-modal="true" aria-label="Catch up"><div className="mc-catchup-header"><h2>Decisions waiting</h2><button type="button" onClick={closeCatchUp} autoFocus>Close</button></div>{asks.map((ask) => <article key={ask.id}><strong>{ask.kind.replaceAll(".", " · ")}</strong><p>{ask.intent.context.body ?? ask.workItemId ?? "Sarathi decision"}</p><div><button type="button" onClick={() => { props.onDecideAsk(ask.id, "approved"); closeCatchUp(); }}>Approve</button><button type="button" onClick={() => { props.onDecideAsk(ask.id, "declined"); closeCatchUp(); }}>Decline</button></div></article>)}</section></div>}
  </main>;
}

function SectionHeading(props: { eyebrow: string; title: string; detail: string }) { return <div className="mc-section-heading"><div><p className="mc-eyebrow">{props.eyebrow}</p><h2>{props.title}</h2></div><span>{props.detail}</span></div>; }
function StateText(props: { children: ReactNode }) { return <p className="mc-region-state">{props.children}</p>; }
