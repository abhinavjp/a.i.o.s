import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";

const apps: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createApp() {
  const directory = await mkdtemp(join(tmpdir(), "aios-work-items-"));
  directories.push(directory);
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  const result = buildApp(new AgentManager(configurator, "fake"), {
    taskStore: new FileTaskStore(join(directory, "tasks.json")),
    sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")),
    engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")),
    workItemStore: new FileWorkItemStore(join(directory, "work-items.json"))
  });
  apps.push(result);
  return { app: result, directory };
}

describe("work-item API", () => {
  test("lists no work items on a fresh install", async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/work-items" });
    expect(response.json()).toEqual({ workItems: [] });
  });

  test("creates and persists a directly-added work item", async () => {
    const first = await createApp();
    const created = await first.app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Repair payroll export", repositories: ["payroll-api"] } });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ workItem: { title: "Repair payroll export", repositories: ["payroll-api"], workSourceKey: null, track: null, id: expect.any(String), createdAt: expect.any(String) } });
    await first.app.close();
    apps.splice(apps.indexOf(first.app), 1);

    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const restarted = buildApp(new AgentManager(configurator, "fake"), {
      taskStore: new FileTaskStore(join(first.directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(first.directory, "sarathi.json")),
      engineConfigStore: new FileEngineConfigStore(join(first.directory, "engine.json")), workItemStore: new FileWorkItemStore(join(first.directory, "work-items.json"))
    });
    apps.push(restarted);
    expect((await restarted.inject({ method: "GET", url: "/api/work-items" })).json().workItems).toHaveLength(1);
  });

  test("rejects an empty work-item title", async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "  ", repositories: [] } });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ error: "title is required" });
  });

  test("approves a starting point once and persists its plain track and stages", async () => {
    const { app, directory } = await createApp();
    const created = await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Repair payroll export", repositories: [] } });
    const workItemId = created.json().workItem.id as string;

    const approved = await app.inject({ method: "POST", url: `/api/work-items/${workItemId}/track`, payload: { startingPoint: "fast" } });
    expect(approved.statusCode).toBe(200);
    expect(approved.json()).toMatchObject({ workItem: {
      track: { stages: ["plan", "implementation", "merge"] },
      stages: [
        { kind: "plan", state: "not-started", artifacts: [] },
        { kind: "implementation", state: "not-started", artifacts: [] },
        { kind: "merge", state: "not-started", artifacts: [] }
      ]
    } });
    const secondApproval = await app.inject({ method: "POST", url: `/api/work-items/${workItemId}/track`, payload: { startingPoint: "full" } });
    expect(secondApproval.statusCode).toBe(400);
    expect(secondApproval.json()).toEqual({ error: "a track has already been approved for this work item" });
    await app.close();
    apps.splice(apps.indexOf(app), 1);

    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const restarted = buildApp(new AgentManager(configurator, "fake"), {
      taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")),
      engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore: new FileWorkItemStore(join(directory, "work-items.json"))
    });
    apps.push(restarted);
    expect((await restarted.inject({ method: "GET", url: "/api/work-items" })).json().workItems[0].stages).toHaveLength(3);
  });

  test("changes an approved stage state, persists it, and rejects invalid stages or states", async () => {
    const { app, directory } = await createApp();
    const workItemId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Repair payroll export", repositories: [] } })).json().workItem.id as string;
    await app.inject({ method: "POST", url: `/api/work-items/${workItemId}/track`, payload: { startingPoint: "fast" } });
    const changed = await app.inject({ method: "PUT", url: `/api/work-items/${workItemId}/stages/plan`, payload: { state: "running" } });
    expect(changed.statusCode).toBe(200);
    expect(changed.json().workItem.stages[0]).toMatchObject({ kind: "plan", state: "running" });
    expect((await app.inject({ method: "PUT", url: `/api/work-items/${workItemId}/stages/merge`, payload: { state: "unknown" } })).json()).toEqual({ error: "state must be not-started, running, waiting, blocked, done, or skipped" });
    expect((await app.inject({ method: "PUT", url: `/api/work-items/${workItemId}/stages/final-review`, payload: { state: "done" } })).json()).toEqual({ error: "stage final-review is not in this work item's track" });
    await app.close();
    apps.splice(apps.indexOf(app), 1);
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const restarted = buildApp(new AgentManager(configurator, "fake"), {
      taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")),
      engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore: new FileWorkItemStore(join(directory, "work-items.json"))
    });
    apps.push(restarted);
    expect((await restarted.inject({ method: "GET", url: "/api/work-items" })).json().workItems[0].stages[0].state).toBe("running");
  });
});
