import type { AgentAbstraction, AgentInfo, HealthStatus } from "@aios/contracts";

export class NullAgent implements AgentAbstraction {
  getInfo(): AgentInfo {
    return { id: "null", kind: "null", displayName: "No Agent Available" };
  }

  checkHealth(): HealthStatus {
    return { ok: false, reason: "no agent available" };
  }
}
