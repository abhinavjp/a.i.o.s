import { useEffect, useState, type FormEvent } from "react";
import type { ActionResult, ConnectorConnection, ConnectorOverview, ConnectorRead, DiscussionRefreshResult, JiraRefreshResult } from "./api.js";

type SetupAgent = { displayName: string; health: { ok: true } | { ok: false; reason: string } };

export function ConnectorCenter(props: {
  overview: ConnectorOverview;
  agents: ReadonlyArray<SetupAgent>;
  agentsStatus: "loading" | "available" | "error";
  isSetup: boolean;
  onRefreshJira: () => Promise<JiraRefreshResult>;
  onRefreshGitLab: () => Promise<DiscussionRefreshResult>;
  onSaveCredential: (reference: string, value: string) => Promise<ActionResult>;
  onOpenAgentSettings: () => void;
  onContinue?: () => void;
  onClose?: () => void;
}) {
  const healthyAgents = props.agents.filter((agent) => agent.health.ok);
  const ready = jiraHasSuccessfulRead(props.overview.jiraSync) && props.overview.codeHost.status === "available" && props.agentsStatus === "available" && healthyAgents.length > 0;
  const [jiraBusy, setJiraBusy] = useState(false);
  const [gitLabBusy, setGitLabBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState(false);

  async function refreshJira() {
    setJiraBusy(true);
    setActionMessage(null);
    try {
      const result = await props.onRefreshJira();
      setActionError(!result.ok);
      setActionMessage(result.ok
        ? `Jira read complete: ${result.imported} added, ${result.updated} updated, ${result.skipped} unchanged, ${result.missing} not observed.`
        : result.message);
    } catch {
      setActionError(true);
      setActionMessage("Jira refresh is unavailable.");
    } finally { setJiraBusy(false); }
  }

  async function refreshGitLab() {
    setGitLabBusy(true);
    setActionMessage(null);
    try {
      const result = await props.onRefreshGitLab();
      setActionError(!result.ok);
      setActionMessage(result.ok ? "GitLab discussion refresh completed." : result.message);
    } catch {
      setActionError(true);
      setActionMessage("GitLab discussion refresh is unavailable.");
    } finally { setGitLabBusy(false); }
  }

  const content = <section className="mc-section mc-connector-center" role="region" aria-label="Connections and setup">
    <div className="mc-section-heading"><div><p className="mc-eyebrow">Connections</p><h2>{props.isSetup ? "Connect Sarathi" : "Connections and setup"}</h2></div>{props.onClose && <button className="mc-tool" type="button" onClick={props.onClose}>Close</button>}</div>
    {props.isSetup && <p className="mc-connector-intro">Setup shows observed readiness for the work source, code host, and agent. A saved credential reference does not by itself mean a connector is ready.</p>}
    {ready && <p className="mc-setup-ready" role="status">All three setup concerns have observed readiness.</p>}
    <div className="mc-connector-grid">
      <article className="mc-connector-card">
        <div className="mc-connector-card-heading"><div><h3>{props.isSetup ? "1. Work source" : "Work source"}</h3><p>{workSourceReadiness(props.overview.jiraSync)}</p></div></div>
        <ConnectorEvidence label="Credential reference" state={props.overview.workSource} />
        <SyncEvidence label="Jira read" state={props.overview.jiraSync} />
        {props.isSetup && <button className="mc-tool" type="button" onClick={() => document.getElementById("work-source-credential-reference")?.focus()}>Connect work source</button>}
        <button className="mc-tool" type="button" onClick={() => void refreshJira()} disabled={jiraBusy}>{jiraBusy ? "Refreshing Jira…" : "Refresh Jira work items"}</button>
        <CredentialEntry kind="work source" initialReference={connectionReference(props.overview.workSource)} onSave={props.onSaveCredential} expanded={props.isSetup} />
      </article>
      <article className="mc-connector-card">
        <div className="mc-connector-card-heading"><div><h3>{props.isSetup ? "2. Code host" : "Code host"}</h3><p>{connectionReadiness(props.overview.codeHost, "Code host")}</p></div></div>
        <ConnectorEvidence label="Code host" state={props.overview.codeHost} />
        <SyncEvidence label="GitLab discussion read" state={props.overview.gitLabSync} />
        {props.isSetup && <button className="mc-tool" type="button" onClick={() => document.getElementById("code-host-credential-reference")?.focus()}>Connect code host</button>}
        <button className="mc-tool" type="button" onClick={() => void refreshGitLab()} disabled={gitLabBusy}>{gitLabBusy ? "Refreshing GitLab…" : "Refresh GitLab discussions"}</button>
        <CredentialEntry kind="code host" initialReference={connectionReference(props.overview.codeHost)} onSave={props.onSaveCredential} expanded={props.isSetup} />
      </article>
      <article className="mc-connector-card">
        <div className="mc-connector-card-heading"><div><h3>{props.isSetup ? "3. Agent" : "Agent"}</h3><p>{agentReadiness(props.agentsStatus, healthyAgents.length)}</p></div></div>
        {props.agentsStatus === "loading" ? <p className="mc-connector-evidence">Checking agent health…</p> : props.agentsStatus === "error" ? <p className="mc-connector-unavailable">Agent health is unavailable.</p> : healthyAgents.length > 0 ? <ul className="mc-connector-agent-list">{props.agents.map((agent) => <li key={agent.displayName}>{agent.displayName}: {agent.health.ok ? "healthy" : `unavailable · ${agent.health.reason}`}</li>)}</ul> : <p className="mc-connector-evidence">No healthy agent is observed.</p>}
        <button className="mc-tool" type="button" onClick={props.onOpenAgentSettings}>Connect agent</button>
      </article>
    </div>
    {ready && props.isSetup && props.onContinue && <button className="mc-tool mc-setup-continue" type="button" onClick={props.onContinue}>Continue to command center</button>}
    {actionMessage && <p className={actionError ? "mc-action-message" : "mc-connector-result"} role={actionError ? "alert" : "status"}>{actionMessage}</p>}
    <p className="mc-connector-note">Jira refresh reads assigned work and never writes to Jira. GitLab refresh reads discussions. Neither action admits a task or changes a discussion.</p>
  </section>;

  return props.isSetup
    ? <main className="mc-root mc-setup-root" aria-label="Sarathi setup">{content}</main>
    : content;
}

function CredentialEntry(props: { kind: "work source" | "code host"; initialReference: string; expanded: boolean; onSave: (reference: string, value: string) => Promise<ActionResult> }) {
  const [reference, setReference] = useState(props.initialReference);
  const [credential, setCredential] = useState("");
  const [referenceEdited, setReferenceEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const code = props.kind === "code host";
  const title = code ? "Code host" : "Work source";
  useEffect(() => {
    if (!referenceEdited && props.initialReference) setReference(props.initialReference);
  }, [props.initialReference, referenceEdited]);
  const fields = <form className="mc-credential-form" onSubmit={(event) => void submit(event)}>
    <label>{title} credential reference<input id={code ? "code-host-credential-reference" : "work-source-credential-reference"} type="text" autoComplete="off" value={reference} onChange={(event) => { setReferenceEdited(true); setReference(event.currentTarget.value); }} /></label>
    <label>{title} credential value<input type="password" autoComplete="new-password" value={credential} onChange={(event) => setCredential(event.currentTarget.value)} /></label>
    <button className="mc-tool" type="submit" disabled={saving || !reference.trim() || !credential}>{saving ? "Saving credential…" : `Save ${props.kind} credential`}</button>
    {message && <p role="status" className="mc-credential-status">{message}</p>}
  </form>;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reference.trim() || !credential) return;
    const submittedCredential = credential;
    setCredential("");
    setSaving(true);
    setMessage(null);
    try {
      const result = await props.onSave(reference, submittedCredential);
      setMessage(result.ok ? "Credential reference saved to the local keychain. The secret was cleared." : result.message);
    } catch {
      setMessage("Credential could not be stored. Check local keychain availability.");
    } finally {
      setCredential("");
      setSaving(false);
    }
  }

  return props.expanded ? <div className="mc-credential-wrap">{fields}<p className="mc-credential-help">The value is sent once to the local credential service. Sarathi stores a reference; it does not read the secret back into the interface.</p></div>
    : <details className="mc-credential-details"><summary>Update credential reference</summary>{fields}<p className="mc-credential-help">The value is sent once to the local credential service. Sarathi stores a reference; it does not read the secret back into the interface.</p></details>;
}

function ConnectorEvidence(props: { label: string; state: ConnectorRead<ConnectorConnection> }) {
  return <p className={props.state.status === "error" ? "mc-connector-unavailable" : "mc-connector-evidence"}>{props.label}: {connectionReadiness(props.state, props.label)}{props.state.status === "available" ? ` · ${props.state.data.siteUrl} · ref ${props.state.data.credentialReference}` : ""}{props.state.status === "available" && props.state.data.expiresSoon ? ` · credential expires soon${props.state.data.daysUntilExpiry === null ? "" : ` (${props.state.data.daysUntilExpiry} days)`}` : ""}</p>;
}

function SyncEvidence(props: { label: string; state: ConnectorOverview["jiraSync"] }) {
  let message = "Checking sync status…";
  let failed = false;
  if (props.state.status === "unconfigured") message = "Not configured";
  else if (props.state.status === "error") { message = props.state.message; failed = true; }
  else if (props.state.status === "available") {
    const sync = props.state.data;
    if (!sync.configured || sync.state === "unconfigured") message = "Not configured";
    else if (sync.state === "syncing") message = "Refresh in progress";
    else if (sync.state === "failed" || sync.failed) { message = "Latest refresh failed"; failed = true; }
    else if (sync.lastSuccessAt) message = `Last successful read ${sync.lastSuccessAt}`;
    else message = "No successful read observed";
    if ("stale" in sync && sync.stale) { message = `Stale · ${message}`; failed = true; }
  }
  return <p className={failed ? "mc-connector-unavailable" : "mc-connector-evidence"}>{props.label}: {message}</p>;
}

function connectionReference(state: ConnectorRead<ConnectorConnection>): string { return state.status === "available" ? state.data.credentialReference : ""; }
function connectionReadiness(state: ConnectorRead<ConnectorConnection>, label: string): string {
  if (state.status === "loading") return "Checking…";
  if (state.status === "unconfigured") return "Not configured";
  if (state.status === "error") return state.message || `${label} connection check unavailable`;
  return "Read connection verified";
}
function workSourceReadiness(state: ConnectorOverview["jiraSync"]): string {
  if (state.status === "loading") return "Checking Jira read readiness…";
  if (state.status === "error") return state.message;
  if (state.status === "unconfigured" || !state.data.configured || state.data.state === "unconfigured") return "Not configured";
  if (state.data.state === "syncing") return "Jira read in progress";
  if (state.data.state === "failed" || state.data.failed) return "Jira read failed";
  return state.data.lastSuccessAt ? "Jira read observed" : "Waiting for first Jira read";
}
function agentReadiness(status: "loading" | "available" | "error", healthyCount: number): string {
  if (status === "loading") return "Checking agent health…";
  if (status === "error") return "Agent health unavailable";
  return healthyCount > 0 ? `${healthyCount} healthy agent${healthyCount === 1 ? "" : "s"} observed` : "No healthy agent observed";
}
function jiraHasSuccessfulRead(state: ConnectorOverview["jiraSync"]): boolean { return state.status === "available" && state.data.configured && state.data.state === "available" && state.data.lastSuccessAt !== null && !state.data.failed; }
