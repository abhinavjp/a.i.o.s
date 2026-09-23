import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { FakeCodeHost, FileCredentialReferenceStore } from "@aios/connectors";
import { FileArtifactStore } from "../src/ArtifactStore.js";
import { FilePhaseStore } from "../src/PhaseStore.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileReleaseChannelStore } from "../src/ReleaseChannel.js";
import { buildApp } from "../src/app.js";
import type { MergeRequestDiscussion } from "@aios/connectors";
import type { JiraSyncScheduler } from "../src/JiraSyncCoordinator.js";

const directories: string[] = [];
const apps: ReturnType<typeof buildApp>[] = [];

class ControlledScheduler implements JiraSyncScheduler {
  callback: (() => void) | undefined;
  intervalMs = 0;
  active = false;

  setInterval(callback: () => void, intervalMs: number): unknown { this.callback = callback; this.intervalMs = intervalMs; this.active = true; return this; }
  clearInterval(): void { this.active = false; }
  tick(): void { if (this.active) this.callback?.(); }
}

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function discussion(overrides: Partial<MergeRequestDiscussion> = {}): MergeRequestDiscussion {
  return {
    projectId: "group/payroll",
    mergeRequestIid: 42,
    discussionId: "discussion-77",
    resolved: false,
    notes: [{ id: 7701, body: "Please handle empty exports.", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: true, resolved: false, createdAt: "2026-09-22T10:00:00Z", updatedAt: "2026-09-22T10:00:00Z" }],
    ...overrides
  };
}

function makeApp(directory: string, sarathiStore: FileSarathiStore, workItemStore: FileWorkItemStore, codeHost: FakeCodeHost, scheduler?: JiraSyncScheduler) {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  const app = buildApp(new AgentManager(configurator, "fake"), {
    taskStore: new FileTaskStore(join(directory, "tasks.json")),
    sarathiStore,
    engineConfigStore: new FileEngineConfigStore(join(directory, "engine-routing.json")),
    workItemStore,
    artifactStore: new FileArtifactStore(join(directory, "artifacts.json")),
    phaseStore: new FilePhaseStore(join(directory, "phases.json")),
    releaseChannelStore: new FileReleaseChannelStore(join(directory, "release-channel.json")),
    credentialStore: new FileCredentialReferenceStore(join(directory, "credentials.json")),
    codeHost,
    ...(scheduler ? { gitLabDiscussionSyncIntervalMs: 17, gitLabDiscussionSyncScheduler: scheduler } : {})
  });
  apps.push(app);
  return app;
}

async function fixture(initialDiscussions: MergeRequestDiscussion[] = [discussion()]) {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-gitlab-discussions-"));
  directories.push(directory);
  const workItemStore = new FileWorkItemStore(join(directory, "work-items.json"));
  const workItem = workItemStore.create({ title: "Repair exports", repositories: ["group/payroll"] });
  const sarathiStore = new FileSarathiStore(join(directory, "sarathi.json"));
  const codeHost = new FakeCodeHost();
  codeHost.listMergeRequests = async (branch) => branch === workItem.id ? [{ repository: "group/payroll", number: 42, title: "Repair exports", branch, state: "opened", pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 }] : [];
  let discussions = initialDiscussions;
  let failure: string | null = null;
  let reads = 0;
  let heldRead: Promise<ReadonlyArray<MergeRequestDiscussion>> | null = null;
  codeHost.listDiscussions = async () => {
    reads += 1;
    if (heldRead) { const pending = heldRead; heldRead = null; return pending; }
    if (failure) throw new Error(failure);
    return discussions;
  };
  const app = makeApp(directory, sarathiStore, workItemStore, codeHost);
  return {
    app, directory, workItem, workItemStore, sarathiStore, codeHost,
    setDiscussions(value: MergeRequestDiscussion[]) { discussions = value; },
    setFailure(value: string | null) { failure = value; },
    holdNextRead(value: Promise<ReadonlyArray<MergeRequestDiscussion>>) { heldRead = value; },
    discussionReadCount() { return reads; }
  };
}

describe("GitLab discussion synchronization", () => {
  test("creates one canonical ask for a new unresolved human discussion on startup", async () => {
    const { app, workItem, sarathiStore } = await fixture();

    await app.ready();

    expect(sarathiStore.snapshot().asks).toMatchObject([{
      kind: "gitlab.discussion.remediate",
      workItemId: workItem.id,
      intent: {
        tool: "gitlab",
        operation: "discussion.remediate",
        context: { repository: "group/payroll", workItemId: workItem.id, mergeRequestIid: "42", discussionId: "discussion-77", noteId: "7701" }
      }
    }]);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations).toHaveLength(1);
    const board = await app.inject({ method: "GET", url: "/api/mission-control/board" });
    expect(board.json().gitLabDiscussions).toMatchObject({
      sync: { state: "available", stale: false },
      observations: [{ workItemId: workItem.id, repository: "group/payroll", mergeRequestIid: 42, discussionId: "discussion-77", resolved: false, askId: sarathiStore.snapshot().asks[0].id }]
    });
  });

  test("does not duplicate an ask across manual polls or a store restart", async () => {
    const { app, directory, workItemStore, sarathiStore, codeHost } = await fixture();

    await app.ready();
    const firstAskId = sarathiStore.snapshot().asks[0]?.id;
    const refresh = await app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });
    expect(refresh.statusCode).toBe(200);
    expect(refresh.json().result).toMatchObject({ state: "available", asksCreated: 0 });
    expect(sarathiStore.snapshot().asks).toHaveLength(1);

    apps.splice(apps.indexOf(app), 1);
    await app.close();
    const restartedStore = new FileSarathiStore(join(directory, "sarathi.json"));
    const restarted = makeApp(directory, restartedStore, new FileWorkItemStore(join(directory, "work-items.json")), codeHost);
    await restarted.ready();

    expect(restartedStore.snapshot().asks).toHaveLength(1);
    expect(restartedStore.snapshot().asks[0].id).toBe(firstAskId);
  });

  test("single-flights interval polls with an in-progress manual refresh", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-gitlab-scheduler-"));
    directories.push(directory);
    const workItemStore = new FileWorkItemStore(join(directory, "work-items.json"));
    workItemStore.create({ title: "Repair exports", repositories: ["group/payroll"] });
    const sarathiStore = new FileSarathiStore(join(directory, "sarathi.json"));
    const codeHost = new FakeCodeHost();
    codeHost.listMergeRequests = async (branch) => [{ repository: "group/payroll", number: 42, title: "Repair exports", branch, state: "opened", pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 }];
    let reads = 0;
    let heldRead: Promise<ReadonlyArray<MergeRequestDiscussion>> | null = null;
    codeHost.listDiscussions = async () => { reads += 1; if (heldRead) { const pending = heldRead; heldRead = null; return pending; } return [discussion()]; };
    const scheduler = new ControlledScheduler();
    const app = makeApp(directory, sarathiStore, workItemStore, codeHost, scheduler);
    await app.ready();
    expect(reads).toBe(1);
    expect(scheduler.intervalMs).toBe(17);

    let release!: (value: ReadonlyArray<MergeRequestDiscussion>) => void;
    heldRead = new Promise((resolve) => { release = resolve; });
    const manual = app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });
    await vi.waitFor(() => expect(reads).toBe(2));
    scheduler.tick();
    expect(reads).toBe(2);
    release([discussion()]);
    await manual;
    scheduler.tick();
    await vi.waitFor(() => expect(reads).toBe(3));

    apps.splice(apps.indexOf(app), 1);
    await app.close();
    expect(scheduler.active).toBe(false);
  });

  test("does not ask for system-only or already-resolved discussions", async () => {
    const { app, sarathiStore } = await fixture([
      discussion(),
      discussion({ discussionId: "system-only", notes: [{ id: 7702, body: "System note", author: null, authorship: "system", system: true, resolvable: false, resolved: false, createdAt: "2026-09-22T10:01:00Z", updatedAt: "2026-09-22T10:01:00Z" }] }),
      discussion({ discussionId: "already-resolved", resolved: true, notes: [{ id: 7703, body: "Resolved request", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: true, resolved: true, createdAt: "2026-09-22T10:02:00Z", updatedAt: "2026-09-22T10:03:00Z" }] }),
      discussion({ discussionId: "non-resolvable", notes: [{ id: 7704, body: "General comment", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: false, resolved: false, createdAt: "2026-09-22T10:04:00Z", updatedAt: "2026-09-22T10:04:00Z" }] })
    ]);

    await app.ready();

    expect(sarathiStore.snapshot().asks).toHaveLength(1);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations).toHaveLength(4);
  });

  test("updates the same observation when GitLab later resolves a discussion", async () => {
    const { app, sarathiStore, setDiscussions } = await fixture();

    await app.ready();
    const first = sarathiStore.snapshot().gitLabDiscussions.observations[0];
    setDiscussions([discussion({ resolved: true, notes: [{ ...discussion().notes[0], resolved: true }] })]);

    const refresh = await app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });

    expect(refresh.statusCode).toBe(200);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations).toMatchObject([{ id: first.id, askId: first.askId, discussion: { resolved: true } }]);
    expect(sarathiStore.snapshot().asks).toHaveLength(0);
    expect(sarathiStore.getPendingAsk(first.askId!)).toBeUndefined();
  });

  test("retires a pending ask when its discussion disappears from a complete poll", async () => {
    const { app, sarathiStore, setDiscussions } = await fixture();
    await app.ready();
    const first = sarathiStore.snapshot().gitLabDiscussions.observations[0];
    setDiscussions([]);

    const refresh = await app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });

    expect(refresh.statusCode).toBe(200);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations).toMatchObject([{ id: first.id, askId: first.askId, status: "not-observed" }]);
    expect(sarathiStore.getPendingAsk(first.askId!)).toBeUndefined();
  });

  test("creates the first ask when an initially resolved thread becomes actionable", async () => {
    const resolved = discussion({ resolved: true, notes: [{ ...discussion().notes[0], resolved: true }] });
    const { app, sarathiStore, setDiscussions } = await fixture([resolved]);
    await app.ready();
    expect(sarathiStore.snapshot().asks).toHaveLength(0);
    const identity = sarathiStore.snapshot().gitLabDiscussions.observations[0].id;
    setDiscussions([discussion()]);

    const refresh = await app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });

    expect(refresh.json().result).toMatchObject({ asksCreated: 1 });
    expect(sarathiStore.snapshot().asks).toHaveLength(1);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations).toMatchObject([{ id: identity, askId: sarathiStore.snapshot().asks[0].id }]);
  });

  test("keeps last observations and marks them stale when a poll fails, then recovers", async () => {
    const { app, sarathiStore, setFailure } = await fixture();

    await app.ready();
    const observed = sarathiStore.snapshot().gitLabDiscussions.observations;
    setFailure("GitLab unavailable");

    const failed = await app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });

    expect(failed.statusCode).toBe(502);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations).toMatchObject([{ id: observed[0].id, askId: observed[0].askId, discussion: observed[0].discussion, status: "stale" }]);
    expect(sarathiStore.snapshot().gitLabDiscussions.sync).toMatchObject({ state: "failed", stale: true, lastError: "GitLab unavailable" });
    setFailure(null);
    const recovered = await app.inject({ method: "POST", url: "/api/code-host/discussions/sync" });
    expect(recovered.statusCode).toBe(200);
    expect(sarathiStore.snapshot().gitLabDiscussions.sync).toMatchObject({ state: "available", stale: false, lastError: null });
  });

  test("migrates an existing dashboard without dropping asks or activity", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-gitlab-migration-"));
    directories.push(directory);
    const path = join(directory, "sarathi.json");
    const legacy = new FileSarathiStore(path).snapshot();
    legacy.asks.push({ id: "ask-legacy", kind: "question", risk: "low", workItemId: null, intent: { tool: "operator", operation: "question", target: "legacy", context: {} }, createdAt: "2026-09-01T00:00:00Z" });
    legacy.activity.push({ id: "activity-legacy", occurredAt: "2026-09-01T00:00:00Z", agent: "Sarathi", workItemId: null, what: "Legacy activity" });
    await writeFile(path, JSON.stringify({ schemaVersion: 7, dashboard: legacy }));

    const migrated = new FileSarathiStore(path).snapshot();
    const stored = JSON.parse(await readFile(path, "utf8"));

    expect(migrated.asks).toMatchObject([{ id: "ask-legacy" }]);
    expect(migrated.activity).toMatchObject([{ id: "activity-legacy" }]);
    expect(migrated.gitLabDiscussions).toMatchObject({ sync: { state: "unconfigured" }, observations: [] });
    expect(stored.schemaVersion).toBe(8);
  });
});
