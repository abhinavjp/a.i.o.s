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
import { AgentSlotManager } from "./sarathi/AgentSlots.js";
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
import { FileArtifactStore, type ArtifactStore } from "./ArtifactStore.js";
import { FilePhaseStore, type PhaseStore } from "./PhaseStore.js";
import { registerWorkItemRoutes } from "./routes/workItems.js";
import { RUNNING_VERSION } from "./Version.js";
import { DEFAULT_RELEASE_CHANNEL_PUBLIC_KEY, FetchReleaseChannelTransport, FileReleaseChannelStore, type ReleaseChannelStore, type ReleaseChannelTransport, ReleaseChannelManager } from "./ReleaseChannel.js";
import { registerReleaseChannelRoutes } from "./routes/releaseChannel.js";
import { type UpdateInstaller, UpdateInstallerConfigurator, UpdateManager } from "./UpdateInstaller.js";
import { createOperatingSystemKeychain, CredentialConfigurator, CredentialManager, EnvironmentSecretCommandRunner, FileCredentialReferenceStore, KeychainCredentialStrategy, SecretCommandCredentialStrategy, type CodeHost, type CredentialReferenceStore, type WorkSource } from "@aios/connectors";
import { registerCredentialRoutes } from "./routes/credentials.js";

export interface BuildAppOptions {
  taskStore?: TaskStore;
  sarathiStore?: SarathiStore;
  engineConfigStore?: EngineConfigStore;
  workItemStore?: WorkItemStore;
  artifactStore?: ArtifactStore;
  phaseStore?: PhaseStore;
  workSource?: WorkSource;
  codeHost?: CodeHost;
  credentialStore?: CredentialReferenceStore;
  credentialManager?: CredentialManager;
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
  releaseChannelStore?: ReleaseChannelStore;
  releaseChannelTransport?: ReleaseChannelTransport;
  releaseChannelPublicKey?: string;
  updateInstaller?: UpdateInstaller;
}

export function buildApp(manager: AgentManager, options: BuildAppOptions = {}) {
  const app = Fastify();
  registerAgentsRoute(app, manager);
  const needsDefaultStore = !options.taskStore || !options.sarathiStore || !options.engineConfigStore || !options.workItemStore || !options.artifactStore || !options.phaseStore || !options.releaseChannelStore || (!options.credentialStore && !options.credentialManager);
  const dataDirectory = needsDefaultStore ? applicationDataDirectory() : "";
  if (needsDefaultStore) mkdirSync(dataDirectory, { recursive: true });
  const taskStore = options.taskStore ?? new FileTaskStore(join(dataDirectory, "tasks.json"), options.runtimeClock ? () => options.runtimeClock!.now() : undefined);
  const sarathiStore =
    options.sarathiStore ?? new FileSarathiStore(join(dataDirectory, "sarathi.json"));
  const agentSlots = new AgentSlotManager(sarathiStore, taskStore);
  const engineConfigStore =
    options.engineConfigStore ?? new FileEngineConfigStore(join(dataDirectory, "engine-routing.json"));
  const workItemStore = options.workItemStore ?? new FileWorkItemStore(join(dataDirectory, "work-items.json"));
  const artifactStore = options.artifactStore ?? new FileArtifactStore(join(dataDirectory, "artifacts.json"));
  artifactStore.setActivityStore(sarathiStore);
  const phaseStore = options.phaseStore ?? new FilePhaseStore(join(dataDirectory, "phases.json"));
  const credentialStore = options.credentialStore ?? (options.credentialManager ? undefined : new FileCredentialReferenceStore(join(dataDirectory, "credentials.json")));
  const credentialManager = options.credentialManager ?? defaultCredentialManager(credentialStore!);
  const releaseChannel = new ReleaseChannelManager(options.releaseChannelStore ?? new FileReleaseChannelStore(join(dataDirectory, "release-channel.json")), options.releaseChannelTransport ?? new FetchReleaseChannelTransport(), RUNNING_VERSION, options.releaseChannelPublicKey ?? DEFAULT_RELEASE_CHANNEL_PUBLIC_KEY);
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
  const updateInstallerConfigurator = new UpdateInstallerConfigurator();
  if (options.updateInstaller) updateInstallerConfigurator.register("default", options.updateInstaller);
  const updateManager = new UpdateManager(updateInstallerConfigurator.select(), sarathiStore, RUNNING_VERSION);
  app.get("/api/version", async () => ({ version: updateManager.version() }));
  app.get("/api/setup", async () => {
    const steps = { workSource: Boolean(options.workSource), codeHost: Boolean(options.codeHost), agent: manager.getActiveAgent().checkHealth().ok };
    return { firstRun: workItemStore.list().length === 0 && !steps.workSource && !steps.codeHost && !steps.agent, steps };
  });
  const permissionTools: SarathiToolExecutor = options.permissionTools ?? {
    definitions: [{ tool: "system-update", operations: ["apply"] }],
    async execute(intent) { if (intent.tool === "system-update") { await updateManager.apply(intent.context); return { output: "update installed" }; } throw new Error("system update execution is not configured"); }
  };
  const permissionEngine = new PermissionEngine(sarathiStore, withDeliveryPipelineTools(permissionTools), options.permissionSemanticClassifier);
  app.addHook("onReady", async () => providerCatalogManager.refreshAll());
  // Task history is authoritative if the dashboard projection lagged a crash.
  for (const activity of workItemStore.stageActivity()) sarathiStore.recordStageState(activity);
  for (const activity of artifactStore.activityEntries()) sarathiStore.recordArtifactWritten(activity.artifact, activity.occurredAt);
  for (const task of taskStore.list().sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))) sarathiStore.recordTask(task, phaseStore.workItemForTask(task.taskId));
  registerTaskRoutes(app, manager, taskStore, {
    runtimeRouter,
    planResolver: options.executionPlanResolver ?? new LayeredExecutionPlanResolver(sarathiStore),
    executionObserver: { record: (task) => sarathiStore.recordTask(task, phaseStore.workItemForTask(task.taskId)) },
    planAdmissionValidator: routeEligibility,
    fixedRouteSelector: routeEligibility,
    toolMediator: permissionEngine,
    resilience,
    agentSlots,
    stallThresholds: () => sarathiStore.snapshot().stallThresholds
  }, engineConfigStore);
  registerSarathiRoutes(app, sarathiStore, providerCatalogManager, permissionEngine, resilience, runtimeRouter, options.proofHarness ?? new OptInProofHarness(), (intent, decision, note) => {
    if (intent.tool === "system-update" && intent.operation === "apply" && decision === "approved") return updateManager.apply(intent.context);
    if (intent.tool !== "delivery-pipeline" || intent.operation !== "artifact.approve") return;
    const artifact = artifactStore.get(intent.target);
    if (!artifact || artifact.approvalState !== "awaiting") return;
    artifactStore.update(artifact.id, decision === "approved" ? { approvalState: "approved" } : { approvalState: "rejected", rejectionNote: note });
  }, (artifactId) => {
    const artifact = artifactStore.get(artifactId);
    if (!artifact || (artifact.approvalState !== "draft" && artifact.approvalState !== "rejected")) return undefined;
    artifactStore.update(artifactId, { approvalState: "awaiting", rejectionNote: undefined });
    return { tool: "delivery-pipeline", operation: "artifact.approve", target: artifactId, context: { workItemId: artifact.workItemId } };
  }, agentSlots);
  registerEngineRoutes(app, engineConfigStore, manager);
  registerWorkItemRoutes(app, workItemStore, options.workSource, options.codeHost, artifactStore, phaseStore, taskStore, sarathiStore);
  registerCredentialRoutes(app, credentialManager);
  registerReleaseChannelRoutes(app, releaseChannel, permissionEngine);
  app.get("/api/update-audit", async () => ({ entries: sarathiStore.snapshot().updateAudit }));
  app.post("/api/update/rollback", async (_request, reply) => {
    try { return { version: await updateManager.rollback() }; }
    catch (error) { const message = error instanceof Error ? error.message : "rollback could not be completed"; reply.code(message === "no retained previous version is available" ? 409 : 500); return { error: message }; }
  });
  return app;
}

function defaultCredentialManager(store: CredentialReferenceStore): CredentialManager {
  const configurator = new CredentialConfigurator();
  const keychain = createOperatingSystemKeychain();
  if (keychain) configurator.register("keychain", new KeychainCredentialStrategy(keychain));
  configurator.register("command", new SecretCommandCredentialStrategy(new EnvironmentSecretCommandRunner()));
  return new CredentialManager(store, configurator);
}
