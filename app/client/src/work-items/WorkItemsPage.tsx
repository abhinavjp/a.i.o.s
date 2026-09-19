import { useEffect, useState } from "react";
import type { WorkItem } from "@aios/contracts";
type MergeRequest = { repository: string; number: number; title: string; state: string; pipelineResult: string; jobsCompleted: number; jobsTotal: number; };
type Artifact = { id: string; name: string; version: number; approvalState: string; kind: "authored" | "derived"; };
type Phase = { phase: { number: number; name: string; demoSentence: string } };

export function WorkItemsPage() {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [title, setTitle] = useState("");
  const [repositories, setRepositories] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [mergeRequests, setMergeRequests] = useState<Record<string, MergeRequest[]>>({});
  const [artifacts, setArtifacts] = useState<Record<string, Artifact[]>>({});
  const [preview, setPreview] = useState<string | null>(null);
  const [phases, setPhases] = useState<Record<string, Phase[]>>({});

  useEffect(() => { void fetch("/api/work-items").then((response) => response.json()).then((data) => setWorkItems(data.workItems ?? [])); }, []);

  async function addWorkItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const response = await fetch("/api/work-items", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, repositories: repositories.split(",").map((value) => value.trim()).filter(Boolean) })
    });
    const data = await response.json();
    if (!response.ok || !data.workItem) { setMessage(data.error ?? "Work item could not be created."); return; }
    setWorkItems((current) => [...current, data.workItem]);
    setTitle(""); setRepositories("");
  }

  async function importTickets() {
    const response = await fetch("/api/work-items/import", { method: "POST" });
    const data = await response.json();
    if (!response.ok) { setMessage(data.error ?? "Tickets could not be imported."); return; }
    setWorkItems(data.workItems ?? []);
    setMessage(`${data.imported} imported, ${data.skipped} skipped.`);
  }

  async function approveTrack(workItemId: string, startingPoint: string) {
    setMessage(null);
    const response = await fetch(`/api/work-items/${workItemId}/track`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startingPoint })
    });
    const data = await response.json();
    if (!response.ok || !data.workItem) { setMessage(data.error ?? "Track could not be approved."); return; }
    setWorkItems((current) => current.map((workItem) => workItem.id === workItemId ? data.workItem : workItem));
  }

  async function setStageState(workItemId: string, stageKind: string, state: string) {
    const response = await fetch(`/api/work-items/${workItemId}/stages/${stageKind}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ state }) });
    const data = await response.json();
    if (!response.ok || !data.workItem) { setMessage(data.error ?? "Stage could not be updated."); return; }
    setWorkItems((current) => current.map((workItem) => workItem.id === workItemId ? data.workItem : workItem));
  }

  async function openWorkItem(workItemId: string) {
    const [response, artifactResponse, phaseResponse] = await Promise.all([fetch(`/api/work-items/${workItemId}/merge-requests`), fetch(`/api/work-items/${workItemId}/artifacts`), fetch(`/api/work-items/${workItemId}/phases`)]);
    const data = await response.json(); const artifactData = await artifactResponse.json(); const phaseData = await phaseResponse.json();
    if (!response.ok) { setMessage(data.error ?? "Merge requests could not be loaded."); return; }
    setMergeRequests((current) => ({ ...current, [workItemId]: data.mergeRequests ?? [] }));
    setArtifacts((current) => ({ ...current, [workItemId]: artifactData.artifacts ?? [] }));
    setPhases((current) => ({ ...current, [workItemId]: phaseData.phases ?? [] }));
  }

  async function previewArtifact(artifact: Artifact) { setPreview(null); const response = await fetch(`/api/artifacts/${artifact.id}/content`); const data = await response.json(); setPreview(!data.available ? "Artifact unavailable." : artifact.kind === "derived" ? (data.filesChanged !== undefined ? `${data.filesChanged} files changed · ${data.linesAdded} added · ${data.linesRemoved} removed` : (data.mergeRequests ?? []).map((mergeRequest: MergeRequest) => `${mergeRequest.repository}: ${mergeRequest.state}`).join("\n")) : data.content); }

  return <section className="panel work-items-panel">
    <div className="panel-heading"><div><span className="eyebrow">Delivery pipeline</span><h2>Work items</h2></div><button type="button" onClick={() => void importTickets()}>Import assigned tickets</button></div>
    <form className="specialist-form" onSubmit={addWorkItem}>
      <label>Title<input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <label>Repositories<input aria-label="Repositories" value={repositories} onChange={(event) => setRepositories(event.target.value)} placeholder="payroll-api, web-console" /></label>
      <button className="specialist-submit" type="submit">Add work item</button>
    </form>
    {message && <p role="alert" className="specialist-message">{message}</p>}
    <div className="work-item-list">{workItems.length === 0 ? <p className="empty-state">No work items yet.</p> : workItems.map((workItem) => <article className="work-item-row" key={workItem.id}><strong>{workItem.title}</strong><small>{workItem.repositories.join(", ") || "No repositories"}</small><button type="button" onClick={() => void openWorkItem(workItem.id)}>Open work item</button>{phases[workItem.id]?.map(({ phase }) => <p key={phase.number}><strong>{phase.name}</strong> — {phase.demoSentence}</p>)}{mergeRequests[workItem.id] && <section><h3>Merge requests</h3>{mergeRequests[workItem.id].length === 0 ? <p>No merge requests.</p> : mergeRequests[workItem.id].map((mergeRequest) => <p key={`${mergeRequest.repository}-${mergeRequest.number}`}>{mergeRequest.repository} !{mergeRequest.number} — {mergeRequest.state} — {mergeRequest.pipelineResult} — {mergeRequest.jobsCompleted}/{mergeRequest.jobsTotal}</p>)}</section>}{artifacts[workItem.id]?.map((artifact) => <button key={artifact.id} type="button" onClick={() => void previewArtifact(artifact)}>{artifact.name} v{artifact.version} · {artifact.approvalState}</button>)}{preview && <pre>{preview}</pre>}{workItem.track ? <ol className="stage-list">{workItem.stages.map((stage) => <li key={stage.kind}>{stage.kind} <select aria-label={`State for ${stage.kind}`} value={stage.state} onChange={(event) => void setStageState(workItem.id, stage.kind, event.target.value)}>{["not-started", "running", "waiting", "blocked", "done", "skipped"].map((state) => <option key={state}>{state}</option>)}</select></li>)}</ol> : <div className="track-approval"><span>Needs a track</span><select aria-label={`Starting point for ${workItem.title}`} defaultValue="standard"><option value="full">Full</option><option value="standard">Standard</option><option value="fast">Fast</option><option value="analysis-only">Analysis only</option></select><button type="button" onClick={(event) => { const select = event.currentTarget.previousElementSibling as HTMLSelectElement; void approveTrack(workItem.id, select.value); }}>Approve track</button></div>}</article>)}</div>
  </section>;
}
