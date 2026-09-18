import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
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
});
