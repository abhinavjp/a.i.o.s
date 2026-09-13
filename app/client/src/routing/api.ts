import type { AgentEngineKind, EngineConfigDocument, EnginePolicyOverride, EngineConsent, EngineReadiness } from "@aios/contracts";

export type EngineReadinessMap = Partial<Record<AgentEngineKind, EngineReadiness>>;

export async function getEngineReadiness(): Promise<EngineReadinessMap> {
  const response = await fetch("/api/routing/readiness");
  if (!response.ok) throw new Error("engine readiness unavailable");
  const data = await response.json() as { engines?: EngineReadinessMap };
  return data.engines ?? {};
}

export async function getRouting(): Promise<EngineConfigDocument> {
  const response = await fetch("/api/routing");
  if (!response.ok) throw new Error("routing configuration unavailable");
  return response.json() as Promise<EngineConfigDocument>;
}

export async function saveGlobalRouting(policy: EnginePolicyOverride): Promise<EngineConfigDocument> {
  const response = await fetch("/api/routing/global", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
  const data = await response.json() as { routing?: EngineConfigDocument; error?: string };
  if (!response.ok || !data.routing) throw new Error(data.error ?? "routing policy could not be saved");
  return data.routing;
}

export async function saveAgentRouting(id: string, policy: EnginePolicyOverride): Promise<EngineConfigDocument> {
  const response = await fetch(`/api/routing/agents/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
  const data = await response.json() as { routing?: EngineConfigDocument; error?: string };
  if (!response.ok || !data.routing) throw new Error(data.error ?? "agent policy could not be saved");
  return data.routing;
}

export async function saveWorkflowRouting(id: string, policy: EnginePolicyOverride): Promise<EngineConfigDocument> {
  const response = await fetch(`/api/routing/workflows/${encodeURIComponent(id)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
  const data = await response.json() as { routing?: EngineConfigDocument; error?: string };
  if (!response.ok || !data.routing) throw new Error(data.error ?? "workflow policy could not be saved");
  return data.routing;
}

export async function saveRoutingConsent(consent: EngineConsent): Promise<EngineConfigDocument> {
  const response = await fetch("/api/routing/consent", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(consent) });
  const data = await response.json() as { consent?: EngineConsent; error?: string };
  if (!response.ok || !data.consent) throw new Error(data.error ?? "consent could not be saved");
  return getRouting();
}
