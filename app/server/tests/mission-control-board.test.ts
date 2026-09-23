import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import { FileArtifactStore } from "../src/ArtifactStore.js";
import { FilePhaseStore } from "../src/PhaseStore.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FakeCodeHost } from "@aios/connectors";

const directories: string[] = [];
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-board-"));
  directories.push(directory);
  return { directory, path: join(directory, "work-items.json") };
}

describe("work source observation migration", () => {
  test("opens a v2 document and round-trips every legacy field while marking observation unknown", async () => {
    const { path } = await fixture();
    const old = { schemaVersion: 2, metadata: { retained: true }, workItems: [{ id: "old", title: "Existing", workSourceKey: "OPS-1", repositories: ["api"], track: { stages: ["plan"] }, stages: [{ kind: "plan", state: "running", artifacts: ["legacy"] }], createdAt: "2024-01-01", extra: { retained: true } }, { id: "manual", title: "Manual", workSourceKey: null, repositories: [], track: null, stages: [], createdAt: "2024-01-02" }] };
    await writeFile(path, JSON.stringify(old));
    const store = new FileWorkItemStore(path);
    expect(store.list()[0]).toMatchObject({ ...old.workItems[0], sourceObservation: { source: "jira", status: "unobserved", lastObservedAt: null, lastCheckedAt: null, lastState: null } });
    expect(store.list()[1]).toMatchObject({ ...old.workItems[1], sourceObservation: null });
    const persisted = JSON.parse(await readFile(path, "utf8"));
    expect(persisted.schemaVersion).toBe(4);
    expect(new FileWorkItemStore(path).list()).toEqual(store.list());
    expect(persisted.workItems[0].extra).toEqual({ retained: true });
    expect(persisted.metadata).toEqual({ retained: true });
  });

  test("upserts by source identity, preserves local track, and records loss of observation without deleting work", async () => {
    const { path } = await fixture();
    const store = new FileWorkItemStore(path);
    const manual = store.create({ title: "Manual", repositories: ["api"] });
    const first = store.upsertSourceObservation({ workSourceKey: "OPS-1", title: "Old title", state: "Open", observedAt: "2026-09-01T00:00:00Z" });
    store.approveTrack(first.id, ["plan"]);
    const changed = store.upsertSourceObservation({ workSourceKey: "OPS-1", title: "New title", state: "In Progress", observedAt: "2026-09-02T00:00:00Z" });
    expect(changed.id).toBe(first.id);
    expect(changed).toMatchObject({ title: "New title", track: { stages: ["plan"] }, sourceObservation: { status: "observed", lastState: "In Progress", lastObservedAt: "2026-09-02T00:00:00Z" } });
    store.markSourceMissing(["OPS-2"], "2026-09-03T00:00:00Z");
    expect(store.list()).toHaveLength(2);
    expect(store.list().find((item) => item.id === first.id)?.sourceObservation).toMatchObject({ status: "missing", lastState: "In Progress", lastObservedAt: "2026-09-02T00:00:00Z", lastCheckedAt: "2026-09-03T00:00:00Z" });
    expect(store.list().find((item) => item.id === manual.id)?.sourceObservation).toBeNull();
    expect(new FileWorkItemStore(path).list()).toEqual(store.list());
  });
});

describe("Mission Control board projection", () => {
  test("composes canonical work, phases and artifacts, with unavailable code-host state", async () => {
    const { directory, path } = await fixture();
    const workItemStore = new FileWorkItemStore(path);
    const work = workItemStore.create({ title: "Ship feature", repositories: ["api"] });
    workItemStore.approveTrack(work.id, ["plan", "implementation"]);
    workItemStore.setStageState(work.id, "plan", "done");
    const artifactStore = new FileArtifactStore(join(directory, "artifacts.json"));
    artifactStore.save({ id: "plan-1", workItemId: work.id, stageKind: "plan", name: "plan.md", version: 1, approvalState: "approved", kind: "authored", branch: "work/one", filePath: "plan.md" });
    const phaseStore = new FilePhaseStore(join(directory, "phases.json"));
    phaseStore.create({ workItemId: work.id, stageKind: "implementation", phase: { number: 1, name: "Build", state: "running", demoSentence: "Feature runs", taskIds: ["task-1"] } });
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    taskStore.create({ taskId: "task-1", task: "Build feature", sessionKey: "test", chunks: [], status: "completed", outcome: { status: "completed" }, createdAt: "2026-09-01", updatedAt: "2026-09-02" });
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"), { workItemStore, artifactStore, phaseStore, taskStore }); apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/mission-control/board" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ workItems: { status: "available", data: [{ workItem: { id: work.id, title: "Ship feature", track: { stages: ["plan", "implementation"] } }, stages: { completed: 1, total: 2 }, tasks: { completed: 1, total: 1 }, phases: { status: "available", data: [{ phase: { name: "Build" }, tasks: [{ taskId: "task-1", status: "completed" }] }] }, artifacts: { status: "available", data: [{ id: "plan-1" }] }, mergeRequests: { status: "unavailable", reason: "code host is not configured" } }] } });
  });

  test("reports code-host failures per work item without hiding local work", async () => {
    const { path } = await fixture();
    const store = new FileWorkItemStore(path);
    store.create({ title: "Local work", repositories: [] });
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const codeHost = new FakeCodeHost();
    codeHost.listMergeRequests = async () => { throw new Error("host offline"); };
    const app = buildApp(new AgentManager(configurator, "fake"), { workItemStore: store, codeHost }); apps.push(app);
    const response = await app.inject({ method: "GET", url: "/api/mission-control/board" });
    expect(response.json().workItems).toMatchObject({ status: "available", data: [{ workItem: { title: "Local work" }, mergeRequests: { status: "error", reason: "host offline" } }] });
  });
});
