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
        ? `Jira check complete: ${result.imported} new work items, ${result.updated} updated, ${result.skipped} unchanged, ${result.missing} no longer found in the latest search.`
        : result.message);
    } catch {
      setActionError(true);
      setActionMessage("Could not check Jira right now. Try again after checking the connection.");
    } finally { setJiraBusy(false); }
  }

  async function refreshGitLab() {
    setGitLabBusy(true);
    setActionMessage(null);
    try {
      const result = await props.onRefreshGitLab();
      setActionError(!result.ok);
      setActionMessage(result.ok ? "GitLab discussion check complete." : result.message);
    } catch {
      setActionError(true);
      setActionMessage("Could not check GitLab right now. Try again after checking the connection.");
    } finally { setGitLabBusy(false); }
  }

  const content = <section className="mc-section mc-connector-center" role="region" aria-label="Connections and setup">
    <div className="mc-section-heading"><div><p className="mc-eyebrow">Connections</p><h2>{props.isSetup ? "Connect Sarathi" : "Connections and setup"}</h2></div>{props.onClose && <button className="mc-tool" type="button" onClick={props.onClose}>Close</button>}</div>
    {(props.isSetup || props.overview.workSource.status === "unconfigured" || props.overview.codeHost.status === "unconfigured") && <p className="mc-connector-intro">Set up Jira for work items, GitLab for code reviews, and an agent to do the work. Saving a token does not connect Jira or GitLab by itself; Sarathi checks each connection before showing it as ready.</p>}
    {ready && <p className="mc-setup-ready" role="status">Jira, GitLab, and an agent are ready.</p>}
    <div className="mc-connector-grid">
      <article className="mc-connector-card">
        <div className="mc-connector-card-heading"><div><h3>{props.isSetup ? "1. Jira work items" : "Jira work items"}</h3><p>{workSourceReadiness(props.overview.jiraSync)}</p></div></div>
        <ConnectorEvidence label="Jira connection" state={props.overview.workSource} />
        <SyncEvidence label="Jira work item check" state={props.overview.jiraSync} />
        {props.isSetup && <button className="mc-tool" type="button" title="Move to the field for your Jira API token." onClick={() => document.getElementById("jira-token-value")?.focus()}>Enter Jira token</button>}
        <button className="mc-tool" type="button" title="Read work items from Jira. This does not change anything in Jira." onClick={() => void refreshJira()} disabled={jiraBusy}>{jiraBusy ? "Checking Jira…" : "Check Jira for work items"}</button>
        <CredentialEntry kind="work source" initialReference={connectionReference(props.overview.workSource)} onSave={props.onSaveCredential} expanded={props.isSetup || props.overview.workSource.status === "unconfigured"} />
      </article>
      <article className="mc-connector-card">
        <div className="mc-connector-card-heading"><div><h3>{props.isSetup ? "2. GitLab code reviews" : "GitLab code reviews"}</h3><p>{connectionReadiness(props.overview.codeHost, "GitLab")}</p></div></div>
        <ConnectorEvidence label="GitLab connection" state={props.overview.codeHost} />
        <SyncEvidence label="GitLab discussion check" state={props.overview.gitLabSync} />
        {props.isSetup && <button className="mc-tool" type="button" title="Move to the field for your GitLab access token." onClick={() => document.getElementById("gitlab-token-value")?.focus()}>Enter GitLab token</button>}
        <button className="mc-tool" type="button" title="Read code review discussions from GitLab. This does not change anything in GitLab." onClick={() => void refreshGitLab()} disabled={gitLabBusy}>{gitLabBusy ? "Checking GitLab…" : "Check GitLab discussions"}</button>
        <CredentialEntry kind="code host" initialReference={connectionReference(props.overview.codeHost)} onSave={props.onSaveCredential} expanded={props.isSetup || props.overview.codeHost.status === "unconfigured"} />
      </article>
      <article className="mc-connector-card">
        <div className="mc-connector-card-heading"><div><h3>{props.isSetup ? "3. Agents" : "Agents"}</h3><p>{agentReadiness(props.agentsStatus, healthyAgents.length)}</p></div></div>
        {props.agentsStatus === "loading" ? <p className="mc-connector-evidence">Checking which agents can run tasks…</p> : props.agentsStatus === "error" ? <p className="mc-connector-unavailable">Could not check agents right now.</p> : healthyAgents.length > 0 ? <ul className="mc-connector-agent-list">{props.agents.map((agent) => <li key={agent.displayName}>{agent.displayName}: {agent.health.ok ? "Ready to run tasks" : `Not ready · ${friendlyAgentReason(agent.health.reason)}`}</li>)}</ul> : <p className="mc-connector-evidence">No agent is ready to run tasks yet.</p>}
        <button className="mc-tool" type="button" title="Open settings to choose or configure an agent." onClick={props.onOpenAgentSettings}>Open agent settings</button>
      </article>
    </div>
    {ready && props.isSetup && props.onContinue && <button className="mc-tool mc-setup-continue" type="button" onClick={props.onContinue}>Continue to command center</button>}
    {actionMessage && <p className={actionError ? "mc-action-message" : "mc-connector-result"} role={actionError ? "alert" : "status"}>{actionMessage}</p>}
    <p className="mc-connector-note">The check buttons only read Jira work items and GitLab discussions. They do not edit either service or start an agent task.</p>
  </section>;

  return props.isSetup
    ? <main className="mc-root mc-setup-root" aria-label="Sarathi setup">{content}</main>
    : content;
}

function CredentialEntry(props: { kind: "work source" | "code host"; initialReference: string; expanded: boolean; onSave: (reference: string, value: string) => Promise<ActionResult> }) {
  const [reference, setReference] = useState(props.initialReference || (props.kind === "code host" ? "GITLAB_TOKEN" : "JIRA_TOKEN"));
  const [credential, setCredential] = useState("");
  const [referenceEdited, setReferenceEdited] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const code = props.kind === "code host";
  const service = code ? "GitLab" : "Jira";
  const nameHelp = `Only change this if your existing ${service} connection was configured to look up a different token name. This is a local lookup name, not the token itself.`;
  const credentialHelp = `Sarathi saves this token locally as ${reference || (code ? "GITLAB_TOKEN" : "JIRA_TOKEN")}. It does not show the token again. Saving it does not verify the ${service} connection.`;
  const helpId = code ? "gitlab-token-name-help" : "jira-token-name-help";
  useEffect(() => {
    if (!referenceEdited && props.initialReference) setReference(props.initialReference);
  }, [props.initialReference, referenceEdited]);
  const fields = <form className="mc-credential-form" onSubmit={(event) => void submit(event)}>
    <label>{code ? "GitLab access token" : "Jira API token"}<input id={code ? "gitlab-token-value" : "jira-token-value"} type="password" autoComplete="new-password" title={`Paste your ${service} token. It will be cleared from this form after you save it.`} value={credential} onChange={(event) => setCredential(event.currentTarget.value)} /></label>
    <button className="mc-tool" type="submit" title={`Save the ${service} token in local credential storage. This does not connect ${service} by itself.`} disabled={saving || !reference.trim() || !credential}>{saving ? `Saving ${service} token…` : `Save ${service} token`}</button>
    <details className="mc-token-name-details"><summary>Use a different saved token name</summary><label>Token name used by your {service} connection<input id={code ? "code-host-credential-reference" : "work-source-credential-reference"} type="text" autoComplete="off" aria-describedby={helpId} title={nameHelp} value={reference} onChange={(event) => { setReferenceEdited(true); setReference(event.currentTarget.value); }} /></label><p id={helpId} className="mc-credential-help">{nameHelp}</p></details>
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
      setMessage(result.ok ? `${service} token saved locally and cleared from this form. Check the connection to confirm it works.` : result.message);
    } catch {
      setMessage(`Could not save the ${service} token. Check that local credential storage is available, then try again.`);
    } finally {
      setCredential("");
      setSaving(false);
    }
  }

  return props.expanded ? <div className="mc-credential-wrap">{fields}<p className="mc-credential-help">{credentialHelp}</p></div>
    : <details className="mc-credential-details"><summary>Update {service} token</summary>{fields}<p className="mc-credential-help">{credentialHelp}</p></details>;
}

function ConnectorEvidence(props: { label: string; state: ConnectorRead<ConnectorConnection> }) {
  return <p className={props.state.status === "error" ? "mc-connector-unavailable" : "mc-connector-evidence"}>{props.label}: {connectionReadiness(props.state, props.label)}{props.state.status === "available" ? ` · ${props.state.data.siteUrl} · token saved as ${props.state.data.credentialReference}` : ""}{props.state.status === "available" && props.state.data.expiresSoon ? ` · token expires soon${props.state.data.daysUntilExpiry === null ? "" : ` (${props.state.data.daysUntilExpiry} days)`}` : ""}</p>;
}

function SyncEvidence(props: { label: string; state: ConnectorOverview["jiraSync"] }) {
  let message = "Checking…";
  let failed = false;
  if (props.state.status === "unconfigured") message = "Waiting for connection setup";
  else if (props.state.status === "error") { message = props.state.message; failed = true; }
  else if (props.state.status === "available") {
    const sync = props.state.data;
    if (!sync.configured || sync.state === "unconfigured") message = "Waiting for connection setup";
    else if (sync.state === "syncing") message = "Check in progress";
    else if (sync.state === "failed" || sync.failed) { message = "The latest check failed"; failed = true; }
    else if (sync.lastSuccessAt) message = `Last checked successfully ${sync.lastSuccessAt}`;
    else message = "No successful check yet";
    if ("stale" in sync && sync.stale) { message = `May be out of date · ${message}`; failed = true; }
  }
  return <p className={failed ? "mc-connector-unavailable" : "mc-connector-evidence"}>{props.label}: {message}</p>;
}

function connectionReference(state: ConnectorRead<ConnectorConnection>): string { return state.status === "available" ? state.data.credentialReference : ""; }
function connectionReadiness(state: ConnectorRead<ConnectorConnection>, label: string): string {
  if (state.status === "loading") return "Checking…";
  if (state.status === "unconfigured") return "Settings are missing";
  if (state.status === "error") return state.message || `${label} connection check unavailable`;
  return "Connection checked successfully";
}
function workSourceReadiness(state: ConnectorOverview["jiraSync"]): string {
  if (state.status === "loading") return "Checking Jira…";
  if (state.status === "error") return state.message;
  if (state.status === "unconfigured" || !state.data.configured || state.data.state === "unconfigured") return "Jira isn't connected yet.";
  if (state.data.state === "syncing") return "Checking Jira work items…";
  if (state.data.state === "failed" || state.data.failed) return "Could not check Jira work items";
  return state.data.lastSuccessAt ? "Jira work items checked successfully" : "Jira has not been checked successfully yet";
}
function agentReadiness(status: "loading" | "available" | "error", healthyCount: number): string {
  if (status === "loading") return "Checking agents…";
  if (status === "error") return "Could not check agents";
  return healthyCount > 0 ? `${healthyCount} agent${healthyCount === 1 ? " is" : "s are"} ready to run tasks` : "No agent is ready to run tasks";
}
function friendlyAgentReason(reason: string): string { return /readiness is UNMEASURED/i.test(reason) ? "Readiness has not been checked yet" : reason.replace(/UNMEASURED/g, "not checked yet"); }
function jiraHasSuccessfulRead(state: ConnectorOverview["jiraSync"]): boolean { return state.status === "available" && state.data.configured && state.data.state === "available" && state.data.lastSuccessAt !== null && !state.data.failed; }
