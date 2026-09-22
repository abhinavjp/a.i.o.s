import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import { FileArtifactStore } from "../src/ArtifactStore.js";
import { FilePhaseStore } from "../src/PhaseStore.js";
import { FileReleaseChannelStore } from "../src/ReleaseChannel.js";
import { FileCredentialReferenceStore } from "@aios/connectors";

describe("activity feed API", () => {
  test("records durable stage, ask, task, and artifact activity newest first", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-activity-"));
    const sarathiStore = new FileSarathiStore(join(directory, "sarathi.json"));
    const artifactStore = new FileArtifactStore(join(directory, "artifacts.json"));
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    taskStore.create({ taskId: "recovered-terminal", task: "Recover finished task", sessionKey: "test", agentId: "recovery-agent", chunks: [], status: "completed", outcome: { status: "completed" }, createdAt: "2026-09-21T00:00:00.000Z", updatedAt: "2026-09-21T00:00:01.000Z" });
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const options = {
      taskStore,
      sarathiStore,
      engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")),
      workItemStore: new FileWorkItemStore(join(directory, "work-items.json")),
      artifactStore,
      phaseStore: new FilePhaseStore(join(directory, "phases.json")),
      releaseChannelStore: new FileReleaseChannelStore(join(directory, "release-channel.json")),
      credentialStore: new FileCredentialReferenceStore(join(directory, "credentials.json")),
      runtimeRouter: { async *run() { yield { type: "terminal" as const, outcome: { status: "completed" as const, message: "task finished" } }; } },
      executionPlanResolver: { resolve: ({ taskId }: { taskId: string }) => ({ planId: "activity-plan", taskId, route: { runtime: "fake", provider: "test", model: "fake", billingMode: "fake" as const }, configurationVersions: { task: "v1", workflow: "v1", specialist: "v1", global: "v1" }, resolvedAt: "2026-09-21T00:00:00.000Z" }) }
    };
    const app = buildApp(manager, options);
    try {
      const workItemId = (await app.inject({ method: "POST", url: "/api/work-items", payload: { title: "Activity work", repositories: [] } })).json().workItem.id;
      await app.inject({ method: "POST", url: `/api/work-items/${workItemId}/track`, payload: { startingPoint: "fast" } });
      await app.inject({ method: "PUT", url: `/api/work-items/${workItemId}/stages/plan`, payload: { state: "running" } });
      await app.inject({ method: "PUT", url: `/api/work-items/${workItemId}/stages/plan`, payload: { state: "running" } });

      const ask = sarathiStore.addPendingAsk({ kind: "question", workItemId, intent: { tool: "delivery-pipeline", operation: "ask", target: workItemId, context: {} } });
      await app.inject({ method: "POST", url: `/api/sarathi/asks/${ask.id}/decide`, payload: { decision: "approved" } });
      const taskId = (await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "Finish activity task" } })).json().taskId;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if ((await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json().outcome) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
      }
      expect((await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json().outcome).toMatchObject({ status: "completed" });
      artifactStore.save({ id: "activity-artifact", workItemId, stageKind: "plan", name: "plan.md", version: 1, approvalState: "draft", kind: "authored", branch: "activity", filePath: "plan.md" });

      const response = await app.inject({ method: "GET", url: "/api/sarathi/dashboard" });
      expect(response.statusCode).toBe(200);
      expect(response.json().activity.map((entry: { what: string }) => entry.what)).toEqual([
        "Artifact plan.md written",
        "Task finished: Finish activity task",
        "Ask approved",
        "Stage plan changed to running",
        "Task finished: Recover finished task"
      ]);
      expect(response.json().activity).toEqual(expect.arrayContaining([
        expect.objectContaining({ agent: "Sarathi", workItemId }),
        expect.objectContaining({ agent: "sarathi", workItemId: null, what: "Task finished: Finish activity task" })
      ]));

      await app.close();
      const restarted = buildApp(manager, { ...options, sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), artifactStore: new FileArtifactStore(join(directory, "artifacts.json")) });
      try {
        expect((await restarted.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json().activity).toHaveLength(5);
      } finally { await restarted.close(); }
    } finally {
      await app.close().catch(() => undefined);
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("replays source-durable stage and artifact activity after an interrupted dashboard write", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-activity-replay-"));
    const workItemStore = new FileWorkItemStore(join(directory, "work-items.json"));
    const workItem = workItemStore.create({ title: "Recovered activity", repositories: [] });
    workItemStore.approveTrack(workItem.id, ["plan"]);
    const artifactStore = new FileArtifactStore(join(directory, "artifacts.json"));
    artifactStore.save({ id: "recovered-artifact", workItemId: workItem.id, stageKind: "plan", name: "plan.md", version: 1, approvalState: "draft", kind: "authored", branch: "recovery", filePath: "plan.md" });
    workItemStore.setStageState(workItem.id, "plan", "done");
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"), {
      taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), engineConfigStore: new FileEngineConfigStore(join(directory, "engine.json")), workItemStore, artifactStore, phaseStore: new FilePhaseStore(join(directory, "phases.json")), releaseChannelStore: new FileReleaseChannelStore(join(directory, "release-channel.json")), credentialStore: new FileCredentialReferenceStore(join(directory, "credentials.json"))
    });
    try {
      expect((await app.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json().activity.map((entry: { what: string }) => entry.what)).toEqual(["Stage plan changed to done", "Artifact plan.md written"]);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
