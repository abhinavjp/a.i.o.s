import type { AgentAbstraction, AgentInfo, HealthStatus } from "@aios/contracts";

export class FakeAgent implements AgentAbstraction {
  getInfo(): AgentInfo {
    return { id: "fake", kind: "fake", displayName: "Fake Agent" };
  }

  checkHealth(): HealthStatus {
    return { ok: true };
  }
}
