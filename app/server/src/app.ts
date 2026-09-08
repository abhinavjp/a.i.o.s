import Fastify from "fastify";
import { join } from "node:path";
import type { AgentManager } from "@aios/agents";
import type { PermissionSemanticClassifier, ProviderCatalogAdapter, RuntimeClock, RuntimeRouter, SarathiToolExecutor } from "@aios/contracts";
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
import { PermissionEngine } from "./sarathi/PermissionEngine.js";
import { RouteResilience } from "./sarathi/RouteResilience.js";
import { AgentRuntimeRouter } from "./sarathi/AgentRuntimeRouter.js";
import { RuntimeRouterRegistry, type RuntimeAdapterRegistration } from "./sarathi/RuntimeAdapters.js";

export interface BuildAppOptions {
  taskStore?: TaskStore;
  sarathiStore?: SarathiStore;
  runtimeRouter?: RuntimeRouter;
  /** Explicit provider/runtime adapters. Missing live adapters remain UNMEASURED. */
  runtimeAdapters?: ReadonlyArray<RuntimeAdapterRegistration>;
  runtimeClock?: RuntimeClock;
  executionPlanResolver?: ExecutionPlanResolver;
  providerCatalogAdapters?: ReadonlyArray<ProviderCatalogAdapter>;
  permissionTools?: SarathiToolExecutor;
  permissionSemanticClassifier?: PermissionSemanticClassifier;
}

export function buildApp(manager: AgentManager, options: BuildAppOptions = {}) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  const taskStore = options.taskStore ?? new FileTaskStore(join(process.cwd(), ".data", "tasks.json"), options.runtimeClock ? () => options.runtimeClock!.now() : undefined);
  const sarathiStore =
    options.sarathiStore ?? new FileSarathiStore(join(process.cwd(), ".data", "sarathi.json"));
  const providerCatalogManager = new ProviderCatalogManager(options.providerCatalogAdapters ?? [], sarathiStore);
  const resilience = new RouteResilience(sarathiStore, options.runtimeClock);
  const runtimeRouter = options.runtimeRouter ?? (options.runtimeAdapters
    ? new RuntimeRouterRegistry(options.runtimeAdapters, new AgentRuntimeRouter())
    : undefined);
  const routeEligibility = new ProviderCatalogEligibilityValidator(sarathiStore, resilience);
  const permissionEngine = options.permissionTools
    ? new PermissionEngine(sarathiStore, options.permissionTools, options.permissionSemanticClassifier)
    : undefined;
  app.addHook("onReady", async () => providerCatalogManager.refreshAll());
  // Task history is authoritative if the dashboard projection lagged a crash.
  for (const task of taskStore.list().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) sarathiStore.recordTask(task);
  registerTaskRoutes(app, manager, taskStore, {
    runtimeRouter,
    planResolver: options.executionPlanResolver ?? new LayeredExecutionPlanResolver(sarathiStore),
    executionObserver: { record: (task) => sarathiStore.recordTask(task) },
    planAdmissionValidator: routeEligibility,
    fixedRouteSelector: routeEligibility,
    toolMediator: permissionEngine,
    resilience
  });
  registerSarathiRoutes(app, sarathiStore, providerCatalogManager, permissionEngine, resilience, runtimeRouter);
  return app;
}
