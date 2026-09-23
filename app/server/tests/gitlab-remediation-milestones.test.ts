import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileTaskStore, type StoredTask } from "../src/TaskStore.js";
import { AgentSlotManager } from "../src/sarathi/AgentSlots.js";
import { PermissionEngine } from "../src/sarathi/PermissionEngine.js";
import { RemediationAdmissionCoordinator } from "../src/mission-control/RemediationAdmissionCoordinator.js";
import { FakeAgent, type AgentManager } from "@aios/agents";
import type { TaskRunRegistry } from "../src/TaskRunRegistry.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("GitLab remediation milestones", () => {
  test("reconciles a task that finishes before its discussion admission link is stored", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-remediation-fast-task-"));
    directories.push(directory);
    const store = new FileSarathiStore(join(directory, "sarathi.json"));
    const tasks = new FileTaskStore(join(directory, "tasks.json"));
    store.applyGitLabDiscussionObservationBatch([observation()], "2026-09-23T08:00:00.000Z");
    const ask = store.snapshot().asks[0]!;
    const specialist = store.createSpecialist({ name: "Reviewer", role: "remediator", runtime: "fake", capabilityTags: ["gitlab.discussion.remediate"] });
    store.approveSpecialist(specialist.id);
    const permissions = new PermissionEngine(store, { definitions: [], async execute() { return { output: "unused" }; } });
    permissions.approve(ask.intent, "once");
    const finishedAt = "2026-09-23T08:03:00.000Z";
    const registry = {
      async start(_agent: unknown, _text: string, _session: string, _routing: unknown, metadata: { taskId: string }) {
        tasks.create({ ...task("completed", finishedAt), taskId: metadata.taskId, canonicalHistory: [] });
        return metadata.taskId;
      },
      get(taskId: string) { return tasks.get(taskId); }
    } as unknown as TaskRunRegistry;
    const manager = { getActiveAgent: () => new FakeAgent() } as AgentManager;
    const coordinator = new RemediationAdmissionCoordinator(store, new AgentSlotManager(store, tasks), permissions, registry, manager);

    await coordinator.admitApproved(ask);

    expect(store.snapshot().gitLabDiscussions.observations[0]!.milestones.fixProduced).toMatchObject({ taskId: expect.any(String), observedAt: finishedAt, source: "sarathi-task-outcome" });
  });

  test("keeps task admission distinct from local and GitLab milestones", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-remediation-milestones-"));
    directories.push(directory);
    const store = new FileSarathiStore(join(directory, "sarathi.json"));
    const observedAt = "2026-09-23T08:00:00.000Z";
    store.applyGitLabDiscussionObservationBatch([{
      workItemId: "work-17",
      mergeRequest: { repository: "group/payroll", number: 42, title: "Repair exports", branch: "work-17", state: "opened", pipelineId: null, pipelineResult: "running", jobsCompleted: 0, jobsTotal: 0 },
      discussion: {
        projectId: "group/payroll", mergeRequestIid: 42, discussionId: "thread-77", resolved: false,
        notes: [{ id: 7701, body: "Please handle empty exports.", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human", system: false, resolvable: true, resolved: false, createdAt: observedAt, updatedAt: observedAt }]
      }
    }], observedAt);
    const discussionId = store.snapshot().gitLabDiscussions.observations[0]!.id;
    const admittedAt = "2026-09-23T08:02:00.000Z";

    store.recordGitLabDiscussionAdmission(discussionId, { state: "admitted", taskId: "remediation-17" }, admittedAt);

    expect(store.snapshot().gitLabDiscussions.observations[0]).toMatchObject({
      taskId: "remediation-17",
      milestones: {
        admitted: { taskId: "remediation-17", observedAt: admittedAt, source: "sarathi" },
        fixProduced: null,
        pushed: null,
        pipeline: null,
        resolved: null
      }
    });
  });

  test("keeps local outcomes and GitLab observations separate across restart and out-of-order sync", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-remediation-sequence-"));
    directories.push(directory);
    const path = join(directory, "sarathi.json");
    const store = new FileSarathiStore(path);
    const firstObservedAt = "2026-09-23T08:00:00.000Z";
    store.applyGitLabDiscussionObservationBatch([observation({
      mergeRequest: { pipelineId: "base-pipeline", pipelineResult: "passed" },
      pipelineObservation: pipeline("base-pipeline", "base-commit", "2026-09-23T08:00:00.000Z")
    })], firstObservedAt);
    const id = store.snapshot().gitLabDiscussions.observations[0]!.id;
    store.recordGitLabDiscussionAdmission(id, { state: "admitted", taskId: "remediation-18" }, "2026-09-23T08:02:00.000Z");

    store.recordTask(task("failed", "2026-09-23T08:02:30.000Z"));
    store.recordTask(task("cancelled", "2026-09-23T08:02:45.000Z"));
    expect(store.snapshot().gitLabDiscussions.observations[0]!.milestones.fixProduced).toBeNull();
    store.recordTask(task("completed", "2026-09-23T08:03:00.000Z"));
    store.applyGitLabDiscussionObservationBatch([observation({
      mergeRequest: { pipelineId: "fix-pipeline", pipelineResult: "running" },
      pipelineObservation: pipeline("fix-pipeline", "fix-commit", "2026-09-23T08:04:00.000Z")
    })], "2026-09-23T08:04:00.000Z");
    store.applyGitLabDiscussionObservationBatch([observation({
      mergeRequest: { pipelineId: "fix-pipeline", pipelineResult: "passed" },
      discussion: { resolved: true },
      pipelineObservation: pipeline("fix-pipeline", "fix-commit", "2026-09-23T08:05:00.000Z")
    })], "2026-09-23T08:05:00.000Z");

    const restarted = new FileSarathiStore(path);
    const current = restarted.snapshot().gitLabDiscussions.observations[0]!;
    expect(current.milestones).toEqual({
      admitted: { taskId: "remediation-18", observedAt: "2026-09-23T08:02:00.000Z", source: "sarathi", pipelineIdAtAdmission: "base-pipeline", pipelineShaAtAdmission: "base-commit" },
      fixProduced: { taskId: "remediation-18", observedAt: "2026-09-23T08:03:00.000Z", source: "sarathi-task-outcome" },
      pushed: { pipelineId: "fix-pipeline", commitSha: "fix-commit", observedAt: "2026-09-23T08:04:00.000Z", source: "gitlab" },
      pipeline: { pipelineId: "fix-pipeline", result: "passed", commitSha: "fix-commit", ref: "work-18", observedAt: "2026-09-23T08:05:00.000Z", source: "gitlab" },
      resolved: { discussionId: "thread-77", observedAt: "2026-09-23T08:05:00.000Z", source: "gitlab" }
    });

    restarted.applyGitLabDiscussionObservationBatch([observation({
      mergeRequest: { pipelineId: "base-pipeline", pipelineResult: "failed" },
      pipelineObservation: pipeline("base-pipeline", "base-commit", "2026-09-23T08:03:30.000Z")
    })], "2026-09-23T08:03:30.000Z");

    expect(restarted.snapshot().gitLabDiscussions.observations[0]).toMatchObject({
      lastObservedAt: "2026-09-23T08:05:00.000Z",
      discussion: { resolved: true },
      milestones: current.milestones
    });
  });

  test("does not treat a rerun of the same GitLab commit as a newly pushed fix", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-remediation-rerun-"));
    directories.push(directory);
    const store = new FileSarathiStore(join(directory, "sarathi.json"));
    const baseline = Object.assign(observation({ mergeRequest: { pipelineId: "base-pipeline", pipelineResult: "passed" } }), { pipelineObservation: {
      id: "base-pipeline", repository: "group/payroll", status: "success", ref: "work-18", sha: "same-commit", webUrl: null, updatedAt: "2026-09-23T08:00:00.000Z"
    } });
    store.applyGitLabDiscussionObservationBatch([baseline], "2026-09-23T08:00:00.000Z");
    const id = store.snapshot().gitLabDiscussions.observations[0]!.id;
    store.recordGitLabDiscussionAdmission(id, { state: "admitted", taskId: "remediation-19" }, "2026-09-23T08:02:00.000Z");
    const rerun = Object.assign(observation({
      mergeRequest: { pipelineId: "rerun-pipeline", pipelineResult: "running" }
    }), { pipelineObservation: {
      id: "rerun-pipeline", repository: "group/payroll", status: "running", ref: "work-18", sha: "same-commit", webUrl: null, updatedAt: "2026-09-23T08:03:00.000Z"
    } });

    store.applyGitLabDiscussionObservationBatch([rerun], "2026-09-23T08:03:00.000Z");

    expect(store.snapshot().gitLabDiscussions.observations[0]!.milestones.pushed).toBeNull();
  });

  test("migrates a schema-8 admitted link without inventing its admission time", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-remediation-migration-"));
    directories.push(directory);
    const path = join(directory, "sarathi.json");
    const store = new FileSarathiStore(path);
    store.applyGitLabDiscussionObservationBatch([observation({
      mergeRequest: { pipelineId: "pre-admission-pipeline", pipelineResult: "passed" }
    })], "2026-09-23T08:00:00.000Z");
    const id = store.snapshot().gitLabDiscussions.observations[0]!.id;
    store.recordGitLabDiscussionAdmission(id, { state: "admitted", taskId: "legacy-remediation" }, "2026-09-23T08:02:00.000Z");
    const legacy = JSON.parse(await readFile(path, "utf8"));
    legacy.schemaVersion = 8;
    delete legacy.dashboard.gitLabDiscussions.observations[0].milestones;
    await writeFile(path, JSON.stringify(legacy));

    const migrated = new FileSarathiStore(path).snapshot().gitLabDiscussions.observations[0]!;

    expect(migrated).toMatchObject({
      taskId: "legacy-remediation",
      milestones: {
        admitted: { taskId: "legacy-remediation", observedAt: null, source: "sarathi", pipelineIdAtAdmission: "pre-admission-pipeline", pipelineShaAtAdmission: null },
        fixProduced: null,
        pushed: null,
        pipeline: null,
        resolved: null
      }
    });
  });
});

function task(status: "failed" | "cancelled" | "completed", updatedAt: string): StoredTask {
  return {
    taskId: "remediation-18", task: "Remediate thread-77", sessionKey: "default", chunks: [],
    status, outcome: { status, message: `Agent ${status}` }, createdAt: "2026-09-23T08:02:00.000Z", updatedAt
  };
}

function observation(overrides: {
  mergeRequest?: { pipelineId: string; pipelineResult: "passed" | "failed" | "running" };
  discussion?: { resolved: boolean };
  pipelineObservation?: ReturnType<typeof pipeline>;
} = {}) {
  const observedAt = "2026-09-23T08:00:00.000Z";
  return {
    workItemId: "work-18",
    mergeRequest: {
      repository: "group/payroll", number: 42, title: "Repair exports", branch: "work-18", state: "opened",
      pipelineId: overrides.mergeRequest?.pipelineId ?? null,
      pipelineResult: overrides.mergeRequest?.pipelineResult ?? "running",
      jobsCompleted: 0, jobsTotal: 0
    },
    pipelineObservation: overrides.pipelineObservation ?? null,
    discussion: {
      projectId: "group/payroll", mergeRequestIid: 42, discussionId: "thread-77", resolved: overrides.discussion?.resolved ?? false,
      notes: [{ id: 7701, body: "Please handle empty exports.", author: { id: 8, username: "reviewer", name: "Review User" }, authorship: "human" as const, system: false, resolvable: true, resolved: overrides.discussion?.resolved ?? false, createdAt: observedAt, updatedAt: observedAt }]
    }
  };
}

function pipeline(id: string, sha: string, updatedAt: string) {
  return { id, repository: "group/payroll", status: "success", ref: "work-18", sha, webUrl: null, updatedAt };
}
