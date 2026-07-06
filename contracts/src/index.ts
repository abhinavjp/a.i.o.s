export type HealthStatus =
  | { ok: true }
  | { ok: false; reason: string };

export interface AgentInfo {
  id: string;
  kind: string;
  displayName: string;
}

export interface AgentAbstraction {
  getInfo(): AgentInfo;
  checkHealth(): HealthStatus;
}
