import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { FakeCodeHost, FileCredentialReferenceStore, type MergeRequestDiscussion } from "@aios/connectors";
import { FileArtifactStore } from "../src/ArtifactStore.js";
import { FilePhaseStore } from "../src/PhaseStore.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileReleaseChannelStore } from "../src/ReleaseChannel.js";
import { buildApp } from "../src/app.js";
import { PermissionEngine } from "../src/sarathi/PermissionEngine.js";
import type { SarathiStore } from "../src/sarathi/SarathiStore.js";
import type { TaskStore } from "../src/TaskStore.js";

const apps: Array<ReturnType<typeof buildApp>> = [];
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GitLab remediation admission", () => {
  test("admits one ordinary task after the discussion ask is approved", async () => {
    const { app, ask, specialist, taskStore } = await fixture();

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask!.id}/decide`, payload: { decision: "approved" } });

    expect(response.statusCode).toBe(200);
    expect(taskStore.list()).toHaveLength(1);
    expect(taskStore.list()[0]).toMatchObject({
      agentId: specialist.id,
      task: expect.stringContaining("group/payroll")
    });
    expect(taskStore.list()[0]?.task).toContain("discussion-77");
    expect(taskStore.list()[0]?.task).toContain("Please handle empty exports.");

    const duplicate = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask!.id}/decide`, payload: { decision: "approved" } });
    expect(duplicate.statusCode).toBe(409);
    expect(taskStore.list()).toHaveLength(1);
  });

  test("serializes concurrent approval requests without leaving an unused approval", async () => {
    const { app, ask, sarathiStore, taskStore } = await fixture();
    const url = `/api/sarathi/asks/${ask!.id}/decide`;

    const responses = await Promise.all([
      app.inject({ method: "POST", url, payload: { decision: "approved" } }),
      app.inject({ method: "POST", url, payload: { decision: "approved" } })
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([200, 409]);
    expect(taskStore.list()).toHaveLength(1);
    expect(sarathiStore.snapshot().permissions.approvals.filter((approval) => approval.remainingUses !== 0)).toHaveLength(0);
  });

  test("keeps an approved discussion blocked when no active agent has the required capability", async () => {
    const { app, ask, sarathiStore, taskStore } = await fixture({ capability: false });

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask!.id}/decide`, payload: { decision: "approved" } });

    expect(response.statusCode).toBe(409);
    expect(taskStore.list()).toHaveLength(0);
    expect(sarathiStore.snapshot().asks).toContainEqual(expect.objectContaining({ id: ask!.id }));
    expect(sarathiStore.snapshot().gitLabDiscussions.observations[0]).toMatchObject({
      admissionState: "blocked",
      blockedReason: expect.stringContaining("gitlab.discussion.remediate")
    });
  });

  test("allows the operator to decline a discussion ask without an eligible agent", async () => {
    const { app, ask, sarathiStore, taskStore } = await fixture({ capability: false });

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask!.id}/decide`, payload: { decision: "declined" } });

    expect(response.statusCode).toBe(200);
    expect(taskStore.list()).toHaveLength(0);
    expect(sarathiStore.getPendingAsk(ask!.id)).toBeUndefined();
  });

  test("does not admit a discussion task when the only capable agent has no free slot", async () => {
    const { app, ask, specialist, sarathiStore, taskStore } = await fixture({ occupySlot: true });

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask!.id}/decide`, payload: { decision: "approved" } });

    expect(response.statusCode).toBe(409);
    expect(taskStore.list()).toHaveLength(1);
    expect(taskStore.list()[0]?.agentId).toBe(specialist.id);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations[0]).toMatchObject({
      admissionState: "blocked",
      blockedReason: expect.stringMatching(/free slot|slot/i)
    });
  });

  test("does not admit a discussion after the latest GitLab observation resolves it", async () => {
    const { app, ask, sarathiStore, taskStore, workItem } = await fixture();
    sarathiStore.applyGitLabDiscussionObservationBatch([{
      workItemId: workItem.id,
      mergeRequest: mergeRequest(workItem.id),
      discussion: discussion({ resolved: true, notes: [{ ...discussion().notes[0]!, resolved: true }] })
    }], "2026-09-22T10:06:00.000Z");

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask!.id}/decide`, payload: { decision: "approved" } });

    expect(response.statusCode).toBe(409);
    expect(taskStore.list()).toHaveLength(0);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations[0]).toMatchObject({
      discussion: { resolved: true },
      admissionState: "blocked",
      blockedReason: expect.stringMatching(/resolved|stale|no longer actionable/i)
    });
  });

  test("admits through a standing permission rule without creating a floor bypass", async () => {
    const { sarathiStore, taskStore, specialist } = await fixture({ observation: false, standingRule: true });
    const permissionEngine = new PermissionEngine(sarathiStore, { definitions: [], async execute() { return { output: "unused" }; } });
    const floorRuleRejected = (() => {
      try { permissionEngine.buildStandingRule("push", "all"); return false; }
      catch { return true; }
    })();

    expect(floorRuleRejected).toBe(true);
    expect(taskStore.list()).toHaveLength(1);
    expect(taskStore.list()[0]).toMatchObject({ agentId: specialist.id, task: expect.stringContaining("discussion-77") });
    expect(sarathiStore.snapshot().automaticDecisions).toMatchObject([{ source: "standing rule", sourceDetail: "Remediate payroll discussions", undoable: false }]);
    expect(sarathiStore.snapshot().asks).toHaveLength(0);
    expect(sarathiStore.snapshot().gitLabDiscussions.observations[0]).toMatchObject({ admissionState: "admitted", taskId: taskStore.list()[0]?.taskId });
  });

  test("does not admit an approved floor intent as a GitLab remediation task", async () => {
    const { app, sarathiStore, taskStore, specialist } = await fixture({ observation: false });
    const ask = sarathiStore.addPendingAsk({
      kind: "push",
      workItemId: null,
      intent: { tool: "code-host", operation: "push", target: "main", context: { branch: "main" } }
    });
    expect(specialist).toBeDefined();

    const response = await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask.id}/decide`, payload: { decision: "approved" } });

    expect(response.statusCode).toBe(200);
    expect(taskStore.list()).toHaveLength(0);
  });
});

interface FixtureOptions { capability?: boolean; occupySlot?: boolean; observation?: boolean; standingRule?: boolean; }

async function fixture(options: FixtureOptions = {}): Promise<{
  app: ReturnType<typeof buildApp>;
  ask: ReturnType<SarathiStore["snapshot"]>["asks"][number] | undefined;
  specialist: ReturnType<SarathiStore["createSpecialist"]>;
  sarathiStore: FileSarathiStore;
  taskStore: FileTaskStore;
  workItem: ReturnType<FileWorkItemStore["create"]>;
}> {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-remediation-admission-"));
  directories.push(directory);
  const taskStore = new FileTaskStore(join(directory, "tasks.json"));
  const sarathiStore = new FileSarathiStore(join(directory, "sarathi.json"));
  const workItemStore = new FileWorkItemStore(join(directory, "work-items.json"));
  const workItem = workItemStore.create({ title: "Repair exports", repositories: ["group/payroll"] });
  const specialist = sarathiStore.createSpecialist({ name: "Code reviewer", role: "remediator", runtime: "fake", slotLimit: 1, capabilityTags: options.capability === false ? [] : ["gitlab.discussion.remediate"] });
  if (options.capability !== false) sarathiStore.approveSpecialist(specialist.id);
  if (options.occupySlot) taskStore.create({ taskId: "occupy-remediator-slot", task: "Existing remediation", sessionKey: "default", agentId: specialist.id, chunks: [], status: "running", outcome: null, createdAt: "2026-09-22T10:00:00.000Z", updatedAt: "2026-09-22T10:00:00.000Z" });
  if (options.standingRule) {
    const permissionEngine = new PermissionEngine(sarathiStore, { definitions: [], async execute() { return { output: "unused" }; } });
    const permissionRule = permissionEngine.buildStandingRule("gitlab.discussion.remediate", "group/payroll");
    sarathiStore.addStandingRule({ id: "rule-remediate", label: "Remediate payroll discussions", askKind: "gitlab.discussion.remediate", scope: "group/payroll", enabled: true, firedCount: 0, permissionRule });
  }
  if (options.observation !== false && !options.standingRule) sarathiStore.applyGitLabDiscussionObservationBatch([{
    workItemId: workItem.id,
    mergeRequest: mergeRequest(workItem.id),
    discussion: discussion()
  }], "2026-09-22T10:05:00.000Z");

  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  const codeHost = options.standingRule ? new FakeCodeHost() : undefined;
  if (codeHost) {
    codeHost.listMergeRequests = async () => [mergeRequest(workItem.id)];
    codeHost.listDiscussions = async () => [discussion()];
  }
  const app = buildApp(new AgentManager(configurator, "fake"), {
    taskStore,
    sarathiStore,
    workItemStore,
    engineConfigStore: new FileEngineConfigStore(join(directory, "engine-routing.json")),
    artifactStore: new FileArtifactStore(join(directory, "artifacts.json")),
    phaseStore: new FilePhaseStore(join(directory, "phases.json")),
    releaseChannelStore: new FileReleaseChannelStore(join(directory, "release-channel.json")),
    credentialStore: new FileCredentialReferenceStore(join(directory, "credentials.json")),
    permissionTools: { definitions: [{ tool: "gitlab", operations: ["discussion.remediate"] }], async execute() { return { output: "unused" }; } },
    ...(codeHost ? { codeHost } : {})
  });
  apps.push(app);
  await app.ready();
  const ask = sarathiStore.snapshot().asks[0];
  if (!ask && options.observation !== false && !options.standingRule) throw new Error("discussion ask fixture was not created");
  return { app, ask, specialist, sarathiStore, taskStore, workItem };
}

function mergeRequest(branch: string) {
  return { repository: "group/payroll", number: 42, title: "Repair exports", branch, state: "opened", pipelineResult: "running" as const, jobsCompleted: 0, jobsTotal: 0 };
}

function discussion(overrides: Partial<MergeRequestDiscussion> = {}): MergeRequestDiscussion {
  const observedAt = "2026-09-22T10:05:00.000Z";
  return {
    projectId: "group/payroll", mergeRequestIid: 42, discussionId: "discussion-77", resolved: false,
    notes: [{ id: 7701, body: "Please handle empty exports.", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: true, resolved: false, createdAt: observedAt, updatedAt: observedAt }],
    ...overrides
  };
}
