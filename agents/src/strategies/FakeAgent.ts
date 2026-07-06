import type {
  AgentAbstraction,
  AgentInfo,
  HealthStatus,
  OrchestratorCapability,
  TaskStream
} from "@aios/contracts";

export class FakeAgent implements AgentAbstraction {
  getInfo(): AgentInfo {
    return { id: "fake", kind: "fake", displayName: "Fake Agent" };
  }

  checkHealth(): HealthStatus {
    return { ok: true };
  }

  runTask(task: string, sessionKey: string): TaskStream {
    return (async function* (): TaskStream {
      yield `Fake task received: ${task}`;
      yield "Fake task complete.";
    })();
  }

  asOrchestrator(): OrchestratorCapability | null {
    return null;
  }
}
