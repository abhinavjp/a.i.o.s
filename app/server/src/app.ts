import Fastify from "fastify";
import { join } from "node:path";
import type { AgentManager } from "@aios/agents";
import { registerAgentsRoute } from "./routes/agents.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerSarathiRoutes } from "./sarathi/routes.js";
import { FileTaskStore } from "./TaskStore.js";
import type { TaskStore } from "./TaskStore.js";
import { FileSarathiStore } from "./sarathi/SarathiStore.js";
import type { SarathiStore } from "./sarathi/SarathiStore.js";
import { FileEngineConfigStore } from "./engine/EngineConfigStore.js";
import type { EngineConfigStore } from "./engine/EngineConfigStore.js";
import { registerEngineRoutes } from "./engine/routes.js";

export interface BuildAppOptions {
  taskStore?: TaskStore;
  sarathiStore?: SarathiStore;
  engineConfigStore?: EngineConfigStore;
}

export function buildApp(manager: AgentManager, options: BuildAppOptions = {}) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  const taskStore = options.taskStore ?? new FileTaskStore(join(process.cwd(), ".data", "tasks.json"));
  const sarathiStore =
    options.sarathiStore ?? new FileSarathiStore(join(process.cwd(), ".data", "sarathi.json"));
  const engineConfigStore =
    options.engineConfigStore ?? new FileEngineConfigStore(join(process.cwd(), ".data", "engine-routing.json"));
  registerTaskRoutes(app, manager, taskStore, engineConfigStore);
  registerSarathiRoutes(app, sarathiStore);
  registerEngineRoutes(app, engineConfigStore);
  return app;
}
