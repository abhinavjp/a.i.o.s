import type { FastifyInstance } from "fastify";
import type { AgentManager } from "@aios/agents";

export function registerAgentsRoute(app: FastifyInstance, manager: AgentManager): void {
  app.get("/api/agents", async () => {
    const registry = manager.getEngineRegistry();
    if (registry?.kinds().length) {
      return { agents: registry.kinds().map((kind) => {
        const agent = registry.create({ engine: kind, configuration: "default", billingMode: "subscription" });
        return { ...agent!.getInfo(), health: agent!.checkHealth() };
      }) };
    }
    const agent = manager.getActiveAgent();
    return {
      agents: [
        {
          ...agent.getInfo(),
          health: agent.checkHealth()
        }
      ]
    };
  });
}
