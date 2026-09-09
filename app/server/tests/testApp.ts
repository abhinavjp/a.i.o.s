import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { buildApp, type BuildAppOptions } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";

// Public-boundary tests isolate both stores; parallel files must never share .data.
const apps: Array<{ app: ReturnType<typeof buildApp>; directory: string }> = [];
export function createTestApp(manager: Parameters<typeof buildApp>[0], options: BuildAppOptions = {}) {
  const directory = mkdtempSync(join(tmpdir(), "sarathi-app-test-"));
  const app = buildApp(manager, { taskStore: new FileTaskStore(join(directory, "tasks.json")),
    sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), ...options });
  apps.push({ app, directory });
  return app;
}
afterEach(async () => {
  for (const { app, directory } of apps.splice(0)) {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  }
});
