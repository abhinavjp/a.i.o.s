import type { AgentAbstraction } from "@aios/contracts";
import { NullAgent } from "./strategies/NullAgent.js";

export class AgentConfigurator {
  private readonly strategies = new Map<string, AgentAbstraction>();
  private readonly fallback: AgentAbstraction = new NullAgent();

  register(kind: string, agent: AgentAbstraction): void {
    this.strategies.set(kind, agent);
  }

  resolve(kind: string): AgentAbstraction {
    return this.strategies.get(kind) ?? this.fallback;
  }

  getFallback(): AgentAbstraction {
    return this.fallback;
  }
}
