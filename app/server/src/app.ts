import Fastify from "fastify";
import { mkdirSync } from "node:fs";
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
import { FileEngineConfigStore } from "./engine/EngineConfigStore.js";
import type { EngineConfigStore } from "./engine/EngineConfigStore.js";
import { registerEngineRoutes } from "./engine/routes.js";
import { ProviderCatalogManager } from "./sarathi/ProviderCatalog.js";
import { ProviderCatalogEligibilityValidator } from "./sarathi/RouteEligibility.js";
import { PermissionEngine } from "./sarathi/PermissionEngine.js";
import { withDeliveryPipelineTools } from "./sarathi/DeliveryPipelineTools.js";
import { RouteResilience } from "./sarathi/RouteResilience.js";
import { AgentRuntimeRouter } from "./sarathi/AgentRuntimeRouter.js";
import { RuntimeRouterRegistry, type RuntimeAdapterRegistration } from "./sarathi/RuntimeAdapters.js";
import type { ProviderRuntimeAdapter } from "./sarathi/ProviderAdapters.js";
import { AutoRouteSelector, type AutoRoutingOptions } from "./sarathi/AutoRouting.js";
import { OptInProofHarness, type LiveProofHarness } from "./sarathi/ProofHarness.js";
import { applicationDataDirectory } from "./ApplicationDataDirectory.js";
import { FileWorkItemStore, type WorkItemStore } from "./WorkItemStore.js";
import { registerWorkItemRoutes } from "./routes/workItems.js";
import type { CodeHost, WorkSource } from "@aios/connectors";

export interface BuildAppOptions {
  taskStore?: TaskStore;
  sarathiStore?: SarathiStore;
  engineConfigStore?: EngineConfigStore;
  workItemStore?: WorkItemStore;
  workSource?: WorkSource;
  codeHost?: CodeHost;
  runtimeRouter?: RuntimeRouter;
  /** Explicit provider/runtime adapters. Missing live adapters remain UNMEASURED. */
  runtimeAdapters?: ReadonlyArray<RuntimeAdapterRegistration>;
  providerAdapters?: ReadonlyArray<ProviderRuntimeAdapter>;
  autoRouting?: AutoRoutingOptions;
  proofHarness?: LiveProofHarness;
  runtimeClock?: RuntimeClock;
  executionPlanResolver?: ExecutionPlanResolver;
  providerCatalogAdapters?: ReadonlyArray<ProviderCatalogAdapter>;
  permissionTools?: SarathiToolExecutor;
  permissionSemanticClassifier?: PermissionSemanticClassifier;
}

export function buildApp(manager: AgentManager, options: BuildAppOptions = {}) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  const needsDefaultStore = !options.taskStore || !options.sarathiStore || !options.engineConfigStore || !options.workItemStore;
  const dataDirectory = needsDefaultStore ? applicationDataDirectory() : "";
  if (needsDefaultStore) mkdirSync(dataDirectory, { recursive: true });
  const taskStore = options.taskStore ?? new FileTaskStore(join(dataDirectory, "tasks.json"), options.runtimeClock ? () => options.runtimeClock!.now() : undefined);
  const sarathiStore =
    options.sarathiStore ?? new FileSarathiStore(join(dataDirectory, "sarathi.json"));
  const engineConfigStore =
    options.engineConfigStore ?? new FileEngineConfigStore(join(dataDirectory, "engine-routing.json"));
  const workItemStore = options.workItemStore ?? new FileWorkItemStore(join(dataDirectory, "work-items.json"));
  const providerAdapters = options.providerAdapters ?? [];
  const providerCatalogManager = new ProviderCatalogManager([
    ...(options.providerCatalogAdapters ?? []),
    ...providerAdapters
  ], sarathiStore);
  const resilience = new RouteResilience(sarathiStore, options.runtimeClock);
  const autoSelector = options.autoRouting ? new AutoRouteSelector(sarathiStore, resilience, options.autoRouting) : undefined;
  const providerRegistrations: RuntimeAdapterRegistration[] = providerAdapters.flatMap((adapter) => [
    { runtime: adapter.runtime, adapter },
    { runtime: adapter.provider, adapter }
  ]);
  const runtimeRouter = options.runtimeRouter ?? (options.runtimeAdapters || providerRegistrations.length
    ? new RuntimeRouterRegistry([...(options.runtimeAdapters ?? []), ...providerRegistrations], new AgentRuntimeRouter())
    : undefined);
  const routeEligibility = new ProviderCatalogEligibilityValidator(sarathiStore, resilience, autoSelector);
  const permissionEngine = options.permissionTools
    ? new PermissionEngine(sarathiStore, withDeliveryPipelineTools(options.permissionTools), options.permissionSemanticClassifier)
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
  }, engineConfigStore);
  registerSarathiRoutes(app, sarathiStore, providerCatalogManager, permissionEngine, resilience, runtimeRouter, options.proofHarness ?? new OptInProofHarness());
  registerEngineRoutes(app, engineConfigStore, manager);
  registerWorkItemRoutes(app, workItemStore, options.workSource, options.codeHost);
  return app;
}
