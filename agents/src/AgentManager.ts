import type { AgentAbstraction } from "@aios/contracts";
import { AgentConfigurator } from "./AgentConfigurator.js";

export class AgentManager {
  private activeAgent: AgentAbstraction;

  constructor(configurator: AgentConfigurator, defaultKind: string) {
    const resolved = configurator.resolve(defaultKind);
    const health = resolved.checkHealth();

    if (health.ok) {
      this.activeAgent = resolved;
    } else {
      console.warn(
        `AgentManager: agent of kind "${defaultKind}" is unhealthy (${health.reason}); falling back to NullAgent.`
      );
      this.activeAgent = configurator.getFallback();
    }
  }

  getActiveAgent(): AgentAbstraction {
    return this.activeAgent;
  }
}
