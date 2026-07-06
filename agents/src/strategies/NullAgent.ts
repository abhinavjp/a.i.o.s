import type {
  AgentAbstraction,
  AgentInfo,
  HealthStatus,
  OrchestratorCapability,
  TaskStream
} from "@aios/contracts";

export class NullAgent implements AgentAbstraction {
  getInfo(): AgentInfo {
    return { id: "null", kind: "null", displayName: "No Agent Available" };
  }

  checkHealth(): HealthStatus {
    return { ok: false, reason: "no agent available" };
  }

  runTask(task: string, sessionKey: string): TaskStream {
    return (async function* (): TaskStream {
      yield "no agent available";
    })();
  }

  asOrchestrator(): OrchestratorCapability | null {
    return null;
  }
}
