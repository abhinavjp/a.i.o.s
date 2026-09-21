import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileReleaseChannelStore } from "../src/ReleaseChannel.js";
import { FileCredentialReferenceStore } from "@aios/connectors";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import { FileArtifactStore } from "../src/ArtifactStore.js";
import { FilePhaseStore } from "../src/PhaseStore.js";

// Public-boundary tests inject stores so parallel files never share persisted state.
const apps: Array<{ app: ReturnType<typeof buildApp>; directory?: string }> = [];
export function createTestApp(manager: Parameters<typeof buildApp>[0], options: BuildAppOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "sarathi-app-test-"));
  const app = buildApp(manager, { taskStore: new FileTaskStore(join(directory, "tasks.json")),
    sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")),
    releaseChannelStore: new FileReleaseChannelStore(join(directory, "release-channel.json")),
    credentialStore: new FileCredentialReferenceStore(join(directory, "credentials.json")),
    engineConfigStore: new FileEngineConfigStore(join(directory, "engine-routing.json")),
    workItemStore: new FileWorkItemStore(join(directory, "work-items.json")),
    artifactStore: new FileArtifactStore(join(directory, "artifacts.json")),
    phaseStore: new FilePhaseStore(join(directory, "phases.json")), ...options });
  apps.push({ app, directory });
  return app;
}

export function createDefaultStoreTestApp(manager: Parameters<typeof buildApp>[0], options: BuildAppOptions = {}) {
  const app = buildApp(manager, options);
  apps.push({ app });
  return app;
}
afterEach(async () => {
  for (const { app, directory } of apps.splice(0)) {
    await app.close();
    if (directory) await rm(directory, { recursive: true, force: true });
  }
});
