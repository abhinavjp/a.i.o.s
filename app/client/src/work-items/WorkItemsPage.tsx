import { useEffect, useState } from "react";
import type { WorkItem } from "@aios/contracts";

export function WorkItemsPage() {
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [title, setTitle] = useState("");
  const [repositories, setRepositories] = useState("");
  const [message, setMessage] = useState<string | null>(null);

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

  return <section className="panel work-items-panel">
    <div className="panel-heading"><div><span className="eyebrow">Delivery pipeline</span><h2>Work items</h2></div></div>
    <form className="specialist-form" onSubmit={addWorkItem}>
      <label>Title<input aria-label="Title" value={title} onChange={(event) => setTitle(event.target.value)} required /></label>
      <label>Repositories<input aria-label="Repositories" value={repositories} onChange={(event) => setRepositories(event.target.value)} placeholder="payroll-api, web-console" /></label>
      <button className="specialist-submit" type="submit">Add work item</button>
    </form>
    {message && <p role="alert" className="specialist-message">{message}</p>}
    <div className="work-item-list">{workItems.length === 0 ? <p className="empty-state">No work items yet.</p> : workItems.map((workItem) => <article className="work-item-row" key={workItem.id}><strong>{workItem.title}</strong><small>{workItem.repositories.join(", ") || "No repositories"}</small></article>)}</div>
  </section>;
}
