import Fastify from "fastify";
import type { AgentManager } from "@aios/agents";
import { registerAgentsRoute } from "./routes/agents.js";

export function buildApp(manager: AgentManager) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  return app;
}
