import type { AgentAbstraction, AgentEngineKind, EngineRoute } from "@aios/contracts";

export type EngineFactory = (route: EngineRoute) => AgentAbstraction;

const REGISTERED_ENGINES: readonly AgentEngineKind[] = ["hermes", "codex", "claude-code"];

export class EngineRegistry {
  private readonly factories = new Map<AgentEngineKind, EngineFactory>();

  register(kind: AgentEngineKind, factory: EngineFactory): void {
    if (!REGISTERED_ENGINES.includes(kind)) throw new Error(`unknown engine: ${kind}`);
    this.factories.set(kind, factory);
  }

  registerAgent(kind: AgentEngineKind, agent: AgentAbstraction): void {
    this.register(kind, () => agent);
  }

  has(kind: string): kind is AgentEngineKind {
    return REGISTERED_ENGINES.includes(kind as AgentEngineKind) && this.factories.has(kind as AgentEngineKind);
  }

  create(route: EngineRoute): AgentAbstraction | undefined {
    return this.factories.get(route.engine)?.(route);
  }

  kinds(): AgentEngineKind[] {
    return REGISTERED_ENGINES.filter((kind) => this.factories.has(kind));
  }
}
