import Fastify from "fastify";
import { join } from "node:path";
import type { AgentManager } from "@aios/agents";
import type { ProviderCatalogAdapter, RuntimeRouter } from "@aios/contracts";
import { registerAgentsRoute } from "./routes/agents.js";
import { registerTaskRoutes } from "./routes/tasks.js";
import { registerSarathiRoutes } from "./sarathi/routes.js";
import { LayeredExecutionPlanResolver, type ExecutionPlanResolver } from "./sarathi/ExecutionPlanResolver.js";
import { FileTaskStore } from "./TaskStore.js";
import type { TaskStore } from "./TaskStore.js";
import { FileSarathiStore } from "./sarathi/SarathiStore.js";
import type { SarathiStore } from "./sarathi/SarathiStore.js";
import { ProviderCatalogManager } from "./sarathi/ProviderCatalog.js";
import { ProviderCatalogEligibilityValidator } from "./sarathi/RouteEligibility.js";

export interface BuildAppOptions {
  taskStore?: TaskStore;
  sarathiStore?: SarathiStore;
  runtimeRouter?: RuntimeRouter;
  executionPlanResolver?: ExecutionPlanResolver;
  providerCatalogAdapters?: ReadonlyArray<ProviderCatalogAdapter>;
}

export function buildApp(manager: AgentManager, options: BuildAppOptions = {}) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  const taskStore = options.taskStore ?? new FileTaskStore(join(process.cwd(), ".data", "tasks.json"));
  const sarathiStore =
    options.sarathiStore ?? new FileSarathiStore(join(process.cwd(), ".data", "sarathi.json"));
  const providerCatalogManager = new ProviderCatalogManager(options.providerCatalogAdapters ?? [], sarathiStore);
  const routeEligibility = new ProviderCatalogEligibilityValidator(sarathiStore);
  app.addHook("onReady", async () => providerCatalogManager.refreshAll());
  registerTaskRoutes(app, manager, taskStore, {
    runtimeRouter: options.runtimeRouter,
    planResolver: options.executionPlanResolver ?? new LayeredExecutionPlanResolver(sarathiStore),
    executionObserver: { record: (task) => sarathiStore.recordTask(task) },
    planAdmissionValidator: routeEligibility,
    fixedRouteSelector: routeEligibility
  });
  registerSarathiRoutes(app, sarathiStore, providerCatalogManager);
  return app;
}
