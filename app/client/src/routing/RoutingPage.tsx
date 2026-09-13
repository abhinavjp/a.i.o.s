import { useEffect, useState } from "react";
import type { AgentEngineKind, EnginePolicyOverride } from "@aios/contracts";
import { getRouting, saveAgentRouting, saveGlobalRouting, saveRoutingConsent, saveWorkflowRouting } from "./api.js";
import "./RoutingPage.css";

const ENGINES: Array<{ id: AgentEngineKind; label: string; note: string }> = [
  { id: "hermes", label: "Hermes", note: "Native harness and Kanban orchestration" },
  { id: "codex", label: "Codex", note: "OpenAI coding-agent CLI" },
  { id: "claude-code", label: "Claude Code", note: "Anthropic coding-agent CLI" }
];

export function RoutingPage() {
  const [routing, setRouting] = useState<Awaited<ReturnType<typeof getRouting>> | null>(null);
  const [engine, setEngine] = useState<AgentEngineKind>("hermes");
  const [configuration, setConfiguration] = useState("default");
  const [model, setModel] = useState("");
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [agentId, setAgentId] = useState("");
  const [workflowId, setWorkflowId] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void getRouting().then((data) => {
      setRouting(data);
      const primary = data.global.primary;
      if (primary?.engine) setEngine(primary.engine);
      if (primary?.configuration) setConfiguration(primary.configuration);
      setModel(primary?.model ?? "");
      setFallbackEnabled(data.global.fallbackEnabled === true);
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "routing unavailable"));
  }, []);

  async function saveGlobal() {
    if (fallbackEnabled && !routing?.consent.crossEngineFallback && !window.confirm("Enable explicit cross-engine fallback?")) return;
    setSaving(true); setMessage(null);
    try {
      const policy: EnginePolicyOverride = { primary: { engine, configuration, billingMode: "subscription", ...(model ? { model } : {}) }, fallbackEnabled };
      let next = routing ?? await getRouting();
      if (fallbackEnabled && !next.consent.crossEngineFallback) next = await saveRoutingConsent({ ...next.consent, crossEngineFallback: true, acceptedAt: new Date().toISOString() });
      next = await saveGlobalRouting(policy);
      setRouting(next); setMessage("Global routing saved.");
    } catch (error: unknown) { setMessage(error instanceof Error ? error.message : "routing could not be saved"); }
    finally { setSaving(false); }
  }

  async function saveAgent() {
    if (!agentId.trim()) return;
    setSaving(true); setMessage(null);
    try { setRouting(await saveAgentRouting(agentId.trim(), { primary: { engine, configuration, billingMode: "subscription" } })); setMessage("Agent override saved."); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : "agent override could not be saved"); }
    finally { setSaving(false); }
  }

  async function saveWorkflow() {
    if (!workflowId.trim()) return;
    setSaving(true); setMessage(null);
    try { setRouting(await saveWorkflowRouting(workflowId.trim(), { primary: { engine, configuration, billingMode: "subscription" } })); setMessage("Workflow override saved."); }
    catch (error: unknown) { setMessage(error instanceof Error ? error.message : "workflow override could not be saved"); }
    finally { setSaving(false); }
  }

  return <section className="routing-page" id="routing">
    <div className="routing-heading"><div><span className="eyebrow">Routing</span><h1>Choose the engine that moves work.</h1><p>Every admitted task keeps its resolved engine and configuration. Edits apply to new tasks only.</p></div><span className="routing-source">effective source · global</span></div>
    <div className="engine-cards">{ENGINES.map((item) => <button type="button" key={item.id} className={`engine-card ${engine === item.id ? "selected" : ""}`} onClick={() => setEngine(item.id)}><span className="engine-card-status" /> <strong>{item.label}</strong><small>{item.note}</small><em>{item.id === "hermes" ? "Configured · unavailable" : "UNMEASURED until live proof"}</em></button>)}</div>
    <div className="routing-grid">
      <div className="routing-form panel"><div className="panel-heading"><div><span className="eyebrow">Global default</span><h2>Primary policy</h2></div><span className="state-chip pending">new tasks</span></div>
        <label>Engine<select aria-label="Global engine" value={engine} onChange={(event) => setEngine(event.target.value as AgentEngineKind)}>{ENGINES.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
        <label>Named configuration<input aria-label="Named configuration" value={configuration} onChange={(event) => setConfiguration(event.target.value)} /></label>
        <label>Optional model<input aria-label="Optional model" value={model} onChange={(event) => setModel(event.target.value)} placeholder="Leave blank for native default" /></label>
        <label className="checkbox-line"><input type="checkbox" checked={fallbackEnabled} onChange={(event) => setFallbackEnabled(event.target.checked)} /> Enable cross-engine fallback</label>
        <p className="routing-warning">Fallback is disabled by default. Enabling it requires visible destination, billing/data-boundary consent, readiness, and a safe durable boundary.</p>
        <button className="routing-save" type="button" disabled={saving} onClick={saveGlobal}>Save global policy</button>
      </div>
      <div className="routing-form panel"><div className="panel-heading"><div><span className="eyebrow">Agent override</span><h2>Specialist policy</h2></div><span className="state-chip">Inherit</span></div>
        <label>Agent id<input aria-label="Agent id" value={agentId} onChange={(event) => setAgentId(event.target.value)} placeholder="e.g. reviewer" /></label>
        <p className="effective-value">Inherit → <strong>{ENGINES.find((item) => item.id === engine)?.label}</strong> <span>from global</span></p>
        <button className="routing-save" type="button" disabled={saving || !agentId.trim()} onClick={saveAgent}>Save agent override</button>
        <p className="routing-warning">Credentials are referenced by environment-variable name only. Secret values are never accepted or rendered.</p>
      </div>
      <div className="routing-form panel"><div className="panel-heading"><div><span className="eyebrow">Workflow override</span><h2>Flow policy</h2></div><span className="state-chip">Inherit</span></div>
        <label>Workflow id<input aria-label="Workflow id" value={workflowId} onChange={(event) => setWorkflowId(event.target.value)} placeholder="e.g. review-queue" /></label>
        <p className="effective-value">Inherit → <strong>{ENGINES.find((item) => item.id === engine)?.label}</strong> <span>from global</span></p>
        <button className="routing-save" type="button" disabled={saving || !workflowId.trim()} onClick={saveWorkflow}>Save workflow override</button>
      </div>
    </div>
    {routing && <div className="routing-status panel"><span className="status-dot amber" /><strong>Hermes</strong><span>unavailable</span><p>Native runtime launch is not verified on this host. Repair the Hermes UV/Python launcher before execution.</p><span className="state-chip blocked">blocked</span></div>}
    {message && <p className="routing-message" role="status">{message}</p>}
  </section>;
}
