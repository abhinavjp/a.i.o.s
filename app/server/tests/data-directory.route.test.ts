import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createDefaultStoreTestApp } from "./testApp.js";

const directories: string[] = [];

afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function manager(): AgentManager {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

async function submitTask() {
  const response = await createDefaultStoreTestApp(manager()).inject({
    method: "POST",
    url: "/api/agents/active/tasks",
    payload: { task: "persist outside the working directory" }
  });
  expect(response.statusCode).toBe(202);
}

describe("default server stores", () => {
  test("writes state to AIOS_DATA_DIR instead of the working directory", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "adhisthana-data-"));
    directories.push(dataDirectory);
    vi.stubEnv("AIOS_DATA_DIR", dataDirectory);

    await submitTask();

    expect(existsSync(join(dataDirectory, "tasks.json"))).toBe(true);
  });

  test("uses the host application-data directory when no override is set", async () => {
    const appDataRoot = await mkdtemp(join(tmpdir(), "adhisthana-appdata-"));
    directories.push(appDataRoot);
    vi.stubEnv("AIOS_DATA_DIR", "");
    vi.stubEnv("APPDATA", appDataRoot);
    vi.stubEnv("HOME", appDataRoot);

    await submitTask();

    const expectedDirectory = process.platform === "win32"
      ? join(appDataRoot, "adhisthana")
      : join(process.env.HOME!, ".local", "share", "adhisthana");
    expect(existsSync(join(expectedDirectory, "tasks.json"))).toBe(true);
  });

  test("creates the configured application data directory when the server starts", async () => {
    const parentDirectory = await mkdtemp(join(tmpdir(), "adhisthana-parent-"));
    directories.push(parentDirectory);
    const dataDirectory = join(parentDirectory, "state");
    vi.stubEnv("AIOS_DATA_DIR", dataDirectory);

    createDefaultStoreTestApp(manager());

    expect(existsSync(dataDirectory)).toBe(true);
  });

  test.each([
    ["tasks.json", { schemaVersion: 2, records: [] }],
    ["sarathi.json", { schemaVersion: 9, dashboard: {} }],
    ["engine-routing.json", { schemaVersion: 2, version: 1, global: {}, workflows: {}, agents: {}, consent: {} }]
  ])("refuses a newer schema version in %s without changing the file", async (fileName, document) => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "adhisthana-newer-schema-"));
    directories.push(dataDirectory);
    vi.stubEnv("AIOS_DATA_DIR", dataDirectory);
    const path = join(dataDirectory, fileName);
    const original = JSON.stringify(document);
    await writeFile(path, original, "utf8");

    expect(() => createDefaultStoreTestApp(manager())).toThrow(fileName === "sarathi.json" ? "schema version 9 is newer than supported version 8" : "schema version 2 is newer than supported version 1");
    expect(await readFile(path, "utf8")).toBe(original);
  });

  test("upgrades an older task-store document when the server opens it", async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), "adhisthana-old-schema-"));
    directories.push(dataDirectory);
    vi.stubEnv("AIOS_DATA_DIR", dataDirectory);
    const path = join(dataDirectory, "tasks.json");
    await writeFile(path, JSON.stringify({ schemaVersion: 0, records: [] }), "utf8");

    createDefaultStoreTestApp(manager());

    expect(JSON.parse(await readFile(path, "utf8"))).toEqual({ schemaVersion: 1, records: [] });
  });
});
