import type { AgentAbstraction, EngineReadiness, EngineRoute, ResolvedEnginePlan, TaskOutcome } from "@aios/contracts";
import { AgentConfigurator } from "./AgentConfigurator.js";
import { EngineRegistry } from "./EngineRegistry.js";
import { readinessFromHealth } from "./EngineReadiness.js";

export class AgentManager {
  private activeAgent: AgentAbstraction;
  private readonly registry?: EngineRegistry;

  constructor(configurator: AgentConfigurator, defaultKind: string, registry?: EngineRegistry) {
    this.registry = registry;
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

  resolveEngine(plan: ResolvedEnginePlan): { ok: true; agent: AgentAbstraction; readiness: EngineReadiness } | { ok: false; outcome: TaskOutcome; readiness: EngineReadiness } {
    const route = plan.primary;
    const agent = this.registry?.create(route);
    if (!agent) {
      const readiness = { state: "unavailable", reason: `${route.engine} engine is not registered`, checkedAt: new Date().toISOString() } as EngineReadiness;
      return { ok: false, readiness, outcome: { status: "unavailable", message: readiness.reason } };
    }
    const health = agent.checkHealth();
    const readiness = readinessFromHealth(health);
    return health.ok
      ? { ok: true, agent, readiness }
      : { ok: false, readiness, outcome: { status: "unavailable", message: health.reason } };
  }

  getEngineRegistry(): EngineRegistry | undefined { return this.registry; }
}
