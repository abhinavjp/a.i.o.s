import type { FastifyInstance } from "fastify";
import type { AgentManager } from "@aios/agents";

export function registerAgentsRoute(app: FastifyInstance, manager: AgentManager): void {
  app.get("/api/agents", async () => {
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
