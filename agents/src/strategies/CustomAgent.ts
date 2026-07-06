import type {
  AgentAbstraction,
  AgentInfo,
  HealthStatus,
  OrchestratorCapability,
  TaskStream
} from "@aios/contracts";

/**
 * CustomAgent is the bring-your-own-agent (BYOA) template.
 *
 * Copy this file to build your own agent strategy: rename the class,
 * fill in getInfo/checkHealth with your agent's real identity and
 * health check, and replace runTask with calls into your actual agent.
 */
export class CustomAgent implements AgentAbstraction {
  getInfo(): AgentInfo {
    return { id: "custom", kind: "custom", displayName: "Custom Agent" };
  }

  checkHealth(): HealthStatus {
    return { ok: true };
  }

  runTask(task: string, sessionKey: string): TaskStream {
    return (async function* (): TaskStream {
      yield `Custom agent handled: ${task}`;
    })();
  }

  asOrchestrator(): OrchestratorCapability | null {
    return null;
  }
}
