import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import { FileArtifactStore } from "../src/ArtifactStore.js";
import { FilePhaseStore } from "../src/PhaseStore.js";
import { FakeCodeHost, FakeWorkSource, GitLabCodeHost, JiraWorkSource, type CodeHost, type WorkSource } from "@aios/connectors";

const apps: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];
afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function createApp(workSource?: WorkSource, codeHost?: CodeHost) {
  const directory = await mkdtemp(join(tmpdir(), "aios-work-items-"));
  directories.push(directory);
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  const result = buildApp(new AgentManager(configurator, "fake"), {
    taskStore: new FileTaskStore(join(directory, "tasks.json")),
    sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")),
    engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")),
    workItemStore: new FileWorkItemStore(join(directory, "work-items.json")), artifactStore: new FileArtifactStore(join(directory, "artifacts.json")), phaseStore: new FilePhaseStore(join(directory, "phases.json")), workSource, codeHost
  });
  apps.push(result);
  return { app: result, directory };
}

describe("work-item API", () => {
  test("reads GitLab merge requests and authored content through existing work-item paths", async () => {
    const token = "gitlab-token-must-not-persist";
    const host = new GitLabCodeHost({ siteUrl: "http://gitlab.internal", projectId: "group/project", defaultBranch: "trunk", credentialReference: "GITLAB_TOKEN", credentialResolver: { resolve: async () => ({ value: token, expiresAt: "2026-09-10T00:00:00.000Z" }) }, transport: { listMergeRequests: async ({ branch }) => [{ iid: 42, title: "Fix export", source_branch: branch, state: "opened", head_pipeline: { status: "running" } }], readPipeline: async () => null, readFile: async () => "# Real branch", readDiff: async () => "a\nb\n" } }, () => Date.parse("2026-09-07T00:00:00Z"));
    const { app, directory } = await createApp(undefined, host);
    const workItemId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "GitLab work", repositories: [] } })).json().workItem.id;
    expect((await app.inject({ method: "GET", url: `/api/work-items/${workItemId}/merge-requests` })).json().mergeRequests[0]).toMatchObject({ repository: "group/project", number: 42, pipelineResult: "running" });
    expect((await app.inject({ method: "GET", url: "/api/code-host/connection" })).json()).toEqual({ connection: { siteUrl: "http://gitlab.internal", credentialReference: "GITLAB_TOKEN", daysUntilExpiry: 3, expiresSoon: true } });
    await expect(readFile(join(directory, "work-items.json"), "utf8")).resolves.not.toContain(token);
  });
  test("imports Jira tickets through the existing path, reports expiry, and never persists a token", async () => {
    const token = "jira-token-must-not-persist";
    const source = new JiraWorkSource({ siteUrl: "https://jira.example.test", searchQuery: "assignee = currentUser()", credentialReference: "JIRA_TOKEN", credentialResolver: { resolve: async () => ({ value: token, expiresAt: "2026-09-10T00:00:00.000Z" }) }, transport: { search: async () => [{ key: "OPS-301", fields: { summary: "Import Jira work", issuetype: { name: "Task" }, status: { name: "Open" }, description: "Read only" } }], read: async () => null } }, () => Date.parse("2026-09-07T00:00:00Z"));
    const { app, directory } = await createApp(source);
    expect((await app.inject({ method: "POST", url: "/api/work-items/import" })).json()).toMatchObject({ imported: 1, skipped: 0, workItems: [{ workSourceKey: "OPS-301", title: "Import Jira work" }] });
    expect((await app.inject({ method: "GET", url: "/api/work-items/connection" })).json()).toEqual({ connection: { siteUrl: "https://jira.example.test", credentialReference: "JIRA_TOKEN", daysUntilExpiry: 3, expiresSoon: true } });
    await expect(readFile(join(directory, "work-items.json"), "utf8")).resolves.not.toContain(token);
  });

  test("reports a Jira connection failure and imports no work items", async () => {
    const source = new JiraWorkSource({ siteUrl: "https://jira.example.test", searchQuery: "assignee = currentUser()", credentialReference: "JIRA_TOKEN", credentialResolver: { resolve: async () => ({ value: "token" }) }, transport: { search: async () => { throw new Error("Jira is unavailable"); }, read: async () => null } });
    const { app } = await createApp(source);
    const response = await app.inject({ method: "POST", url: "/api/work-items/import" });
    expect(response.statusCode).toBe(502);
    expect(response.json()).toEqual({ error: "work source import failed: Jira is unavailable" });
    expect((await app.inject({ method: "GET", url: "/api/work-items" })).json()).toEqual({ workItems: [] });
  });
  test("lists no work items on a fresh install", async () => {
    const { app } = await createApp();
    const response = await app.inject({ method: "GET", url: "/api/work-items" });
    expect(response.json()).toEqual({ workItems: [] });
  });

  test("imports fake tickets once, then reports duplicates as skipped", async () => {
    const { app } = await createApp(new FakeWorkSource());
    expect((await app.inject({ method: "POST", url: "/api/work-items/import" })).json()).toMatchObject({ imported: 2, skipped: 0 });
    expect((await app.inject({ method: "POST", url: "/api/work-items/import" })).json()).toMatchObject({ imported: 0, skipped: 2 });
    expect((await app.inject({ method: "GET", url: "/api/work-items" })).json().workItems).toMatchObject([{ workSourceKey: "OPS-101", track: null }, { workSourceKey: "OPS-102", track: null }]);
  });

  test("imports nothing from the null work source", async () => {
    const { app } = await createApp();
    expect((await app.inject({ method: "POST", url: "/api/work-items/import" })).json()).toMatchObject({ imported: 0, skipped: 0, workItems: [] });
  });

  test("returns code-host merge requests without calculating their job counts", async () => {
    const { app } = await createApp(undefined, new FakeCodeHost());
    const workItemId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Repair payroll export", repositories: [] } })).json().workItem.id as string;
    expect((await app.inject({ method: "GET", url: `/api/work-items/${workItemId}/merge-requests` })).json()).toEqual({ mergeRequests: [{ repository: "payroll-api", number: 42, title: "Repair export batching", branch: workItemId, state: "opened", pipelineResult: "running", jobsCompleted: 3, jobsTotal: 5 }] });
  });

  test("returns no merge requests from the null code host", async () => {
    const { app } = await createApp();
    const workItemId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Repair payroll export", repositories: [] } })).json().workItem.id as string;
    expect((await app.inject({ method: "GET", url: `/api/work-items/${workItemId}/merge-requests` })).json()).toEqual({ mergeRequests: [] });
  });

  test("reads authored artifact content fresh from the code host", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-artifact-preview-")); directories.push(directory);
    const artifactStore = new FileArtifactStore(join(directory, "artifacts.json"));
    artifactStore.save({ id: "artifact-1", workItemId: "work", stageKind: "plan", name: "plan.md", version: 1, approvalState: "awaiting", kind: "authored", branch: "work/one", filePath: "plan.md" });
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore: new FileWorkItemStore(join(directory, "work-items.json")), artifactStore, codeHost: new FakeCodeHost() }); apps.push(app);
    expect((await app.inject({ method: "GET", url: "/api/artifacts/artifact-1/content" })).json()).toEqual({ available: true, content: "# plan.md\n\nPreview from work/one." });
  });

  test("reads derived diff and merge views from the code host without storing content", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-derived-preview-")); directories.push(directory);
    const artifactStore = new FileArtifactStore(join(directory, "artifacts.json"));
    artifactStore.save({ id: "diff", workItemId: "work", stageKind: "plan", name: "Phase diff", version: 1, approvalState: "approved", kind: "derived", codeHostView: "phase-diff" });
    artifactStore.save({ id: "merge", workItemId: "work", stageKind: "merge", name: "Merge result", version: 1, approvalState: "approved", kind: "derived", codeHostView: "merge-result" });
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore: new FileWorkItemStore(join(directory, "work-items.json")), artifactStore, codeHost: new FakeCodeHost() }); apps.push(app);
    expect((await app.inject({ method: "GET", url: "/api/artifacts/diff/content" })).json()).toEqual({ available: true, filesChanged: 4, linesAdded: 26, linesRemoved: 8 });
    expect((await app.inject({ method: "GET", url: "/api/artifacts/merge/content" })).json().mergeRequests[0]).toMatchObject({ repository: "payroll-api", number: 42 });
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

  test("links phase task ids and reads task details from the existing task store", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-phase-tasks-")); directories.push(directory);
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    const phaseStore = new FilePhaseStore(join(directory, "phases.json"));
    phaseStore.create({ workItemId: "work-1", stageKind: "implementation", phase: { number: 1, name: "Build", state: "running", demoSentence: "Show the build.", taskIds: [] } });
    taskStore.create({ taskId: "task-1", task: "Implement the export", sessionKey: "session", chunks: [], status: "completed", outcome: { status: "completed" }, createdAt: "2026-09-19T00:00:00.000Z", updatedAt: "2026-09-19T00:00:00.000Z", resolvedExecutionPlan: { planId: "plan", taskId: "task-1", route: { runtime: "codex", provider: "openai", model: "gpt", billingMode: "fake" }, fallbackRoutes: [], configurationVersions: { task: "task", workflow: "workflow", specialist: "specialist", global: "global" }, configurationSnapshots: { task: { version: "task", policy: {} }, workflow: { version: "workflow", policy: {} }, specialist: { version: "specialist", policy: {} }, global: { version: "global", policy: {} } }, resolvedAt: "2026-09-19T00:00:00.000Z" }, attempts: [] });
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"), { taskStore, sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore: new FileWorkItemStore(join(directory, "work-items.json")), artifactStore: new FileArtifactStore(join(directory, "artifacts.json")), phaseStore }); apps.push(app);

    const missing = await app.inject({ method: "POST", url: "/api/work-items/work-1/phases/1/tasks", payload: { taskId: "missing" } });
    expect(missing.statusCode).toBe(400);
    expect(missing.json()).toEqual({ error: "task was not found: missing" });
    expect((await app.inject({ method: "POST", url: "/api/work-items/work-1/phases/1/tasks", payload: { taskId: "task-1" } })).statusCode).toBe(200);
    expect(JSON.parse(await readFile(join(directory, "phases.json"), "utf8")).phases[0].phase).toEqual(expect.objectContaining({ taskIds: ["task-1"] }));
    expect((await app.inject({ method: "GET", url: "/api/work-items/work-1/phases" })).json()).toEqual({ phases: [{ workItemId: "work-1", stageKind: "implementation", phase: { number: 1, name: "Build", state: "running", demoSentence: "Show the build.", taskIds: ["task-1"] }, tasks: [{ taskId: "task-1", name: "Implement the export", agent: "codex", status: "completed" }] }] });
  });

  test("returns only evidenced progress counts and keeps missing sources unknown", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-counted-progress-")); directories.push(directory);
    const artifactStore = new FileArtifactStore(join(directory, "artifacts.json")); let evidenceBranch = "";
    const codeHost: CodeHost = {
      async listMergeRequests(branch) { return branch === evidenceBranch ? [{ repository: "payroll-api", number: 42, title: "Repair export batching", branch, state: "opened", pipelineResult: "running", jobsCompleted: 3, jobsTotal: 5 }] : []; },
      async readPipeline() { return null; },
      async readFile(_branch, path) { return path === "plan.md" ? { available: true, content: "- [x] Build\n- [ ] Verify" } : path === "eval.md" ? { available: true, content: "- [x] Unit test\n- [ ] Contract test\n- [ ] Smoke test" } : { available: false, content: null }; },
      async readDiffSummary(branch) { return branch === evidenceBranch ? { available: true, filesChanged: 4, linesAdded: 26, linesRemoved: 8 } : { available: false, filesChanged: 0, linesAdded: 0, linesRemoved: 0 }; }
    };
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore: new FileWorkItemStore(join(directory, "work-items.json")), artifactStore, phaseStore: new FilePhaseStore(join(directory, "phases.json")), codeHost }); apps.push(app);
    const workItemId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Repair payroll export", repositories: [] } })).json().workItem.id as string;
    evidenceBranch = workItemId;
    artifactStore.save({ id: "plan", workItemId, stageKind: "plan", name: "plan.md", version: 1, approvalState: "approved", kind: "authored", branch: workItemId, filePath: "plan.md" });
    artifactStore.save({ id: "eval", workItemId, stageKind: "spec-and-eval", name: "eval.md", version: 1, approvalState: "approved", kind: "authored", branch: workItemId, filePath: "eval.md" });
    expect((await app.inject({ method: "GET", url: `/api/work-items/${workItemId}/progress` })).json()).toEqual({ progress: { tasks: { completed: 1, total: 2 }, checks: { completed: 1, total: 3 }, diff: { filesChanged: 4, linesAdded: 26, linesRemoved: 8 }, pipelineJobs: { completed: 3, total: 5 } } });
    const emptyId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "No evidence", repositories: [] } })).json().workItem.id as string;
    expect((await app.inject({ method: "GET", url: `/api/work-items/${emptyId}/progress` })).json()).toEqual({ progress: { tasks: null, checks: null, diff: null, pipelineJobs: null } });
  });
});
