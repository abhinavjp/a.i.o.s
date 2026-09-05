import Fastify from "fastify";
import { join } from "node:path";
import type { AgentManager } from "@aios/agents";
import { registerAgentsRoute } from "./routes/agents.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { FileTaskStore } from "./TaskStore.js";
import type { TaskStore } from "./TaskStore.js";

export interface BuildAppOptions {
  taskStore?: TaskStore;
}

export function buildApp(manager: AgentManager, options: BuildAppOptions = {}) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  const taskStore = options.taskStore ?? new FileTaskStore(join(process.cwd(), ".data", "tasks.json"));
  registerTaskRoutes(app, manager, taskStore);
  return app;
}
