import type { AgentAbstraction } from "@aios/contracts";
import { AgentConfigurator } from "./AgentConfigurator.js";

export class AgentManager {
  private activeAgent: AgentAbstraction;

  constructor(configurator: AgentConfigurator, defaultKind: string) {
    this.activeAgent = configurator.resolve(defaultKind);
  }

  getActiveAgent(): AgentAbstraction {
    return this.activeAgent;
  }
}
