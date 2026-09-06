import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
  AgentAbstraction,
  AgentInfo,
  HealthStatus,
  OrchestratorCapability,
  TaskStream
} from "@aios/contracts";
import { describe, expect, test, vi } from "vitest";
import { AgentConfigurator, AgentManager, CustomAgent, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTaskStore<T>(run: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "aios-tasks-"));
  const path = join(directory, "tasks.json");

  try {
    return await run(path);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

class FailingAgent implements AgentAbstraction {
  getInfo(): AgentInfo {
    return { id: "failing", kind: "failing", displayName: "Failing Agent" };
  }

  checkHealth(): HealthStatus {
    return { ok: true };
  }

  runTask(): TaskStream {
    return (async function* (): TaskStream {
      yield "before failure";
      throw new Error("simulated failure");
    })();
  }

  asOrchestrator(): OrchestratorCapability | null {
    return null;
  }
}

describe("POST /api/agents/active/tasks", () => {
  test("returns 202 with a taskId immediately", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const response = await app.inject({
      method: "POST",
      url: "/api/agents/active/tasks",
      payload: { task: "do the thing" }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.taskId).toMatch(UUID_RE);
  });
});

describe("GET /api/agents/active/tasks/:taskId/stream", () => {
  test("records the active Agent Abstraction identity in the default compatibility plan", async () => {
    await withTaskStore(async (path) => {
      const configurator = new AgentConfigurator();
      configurator.register("custom", new CustomAgent());
      const app = buildApp(new AgentManager(configurator, "custom"), {
        taskStore: new FileTaskStore(path)
      });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "record the active facade" }
      });
      const { taskId } = submitted.json();
      await wait(10);

      const task = await app.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}`
      });
      expect(task.json().resolvedExecutionPlan.route).toMatchObject({
        runtime: "agent-abstraction",
        provider: "custom",
        model: "custom"
      });
      await app.close();
    });
  });

  test("persists an immutable routed plan and fake-runtime attempt through restart", async () => {
    await withTaskStore(async (path) => {
      const router = {
        async *run() {
          yield { type: "progress", text: "Fake router accepted the work." };
          yield {
            type: "terminal",
            outcome: { status: "completed", message: "fake runtime completed" }
          };
        }
      };
      const sarathiPath = join(dirname(path), "sarathi.json");
      const configurator = new AgentConfigurator();
      configurator.register("fake", new FakeAgent());
      const firstApp = buildApp(new AgentManager(configurator, "fake"), {
        taskStore: new FileTaskStore(path),
        sarathiStore: new FileSarathiStore(sarathiPath),
        runtimeRouter: router,
        executionPlanResolver: {
          resolve: ({ taskId }) => ({
            planId: "fake-plan-v1",
            taskId,
            route: { runtime: "fake", provider: "test", model: "fake-v1", billingMode: "fake" },
            configurationVersions: {
              task: "task-default-v1",
              workflow: "workflow-default-v1",
              specialist: "specialist-default-v1",
              global: "global-default-v1"
            },
            resolvedAt: "2026-09-06T00:00:00.000Z"
          })
        }
      });

      const submitted = await firstApp.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "route this through the fake runtime" }
      });
      const { taskId } = submitted.json();
      await wait(10);

      const task = await firstApp.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}`
      });
      expect(task.json()).toMatchObject({
        taskId,
        status: "completed",
        chunks: ["Fake router accepted the work."],
        outcome: { status: "completed", message: "fake runtime completed" },
        resolvedExecutionPlan: {
          route: { runtime: "fake", provider: "test", model: "fake-v1" },
          configurationVersions: {
            task: "task-default-v1",
            workflow: "workflow-default-v1",
            specialist: "specialist-default-v1",
            global: "global-default-v1"
          }
        },
        attempts: [
          {
            status: "completed",
            outcome: { status: "completed", message: "fake runtime completed" },
            events: [
              { type: "progress", text: "Fake router accepted the work." },
              { type: "terminal", outcome: { status: "completed" } }
            ]
          }
        ]
      });

      const dashboard = await firstApp.inject({ method: "GET", url: "/api/sarathi/dashboard" });
      expect(dashboard.json()).toMatchObject({
        runtime: { name: "Fake runtime", state: "ready", billingMode: "fake" },
        recentTasks: [
          {
            id: taskId,
            status: "completed",
            runtime: "fake",
            evidence: "Fake router accepted the work."
          }
        ]
      });
      await firstApp.close();

      const restarted = buildApp(new AgentManager(configurator, "fake"), {
        taskStore: new FileTaskStore(path),
        sarathiStore: new FileSarathiStore(sarathiPath)
      });
      const recovered = await restarted.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}`
      });
      expect(recovered.json()).toMatchObject({
        resolvedExecutionPlan: task.json().resolvedExecutionPlan,
        attempts: task.json().attempts
      });
      await restarted.close();
    });
  });

  test("streams buffered chunks then done for a task that already finished", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const postResponse = await app.inject({
      method: "POST",
      url: "/api/agents/active/tasks",
      payload: { task: "do the thing" }
    });
    const { taskId } = postResponse.json();

    // Give the background task a tick to finish (FakeAgent is deterministic, no real delay).
    await wait(10);

    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/agents/active/tasks/${taskId}/stream`
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toBe("text/event-stream");
    expect(streamResponse.headers["cache-control"]).toBe("no-cache");
    expect(streamResponse.headers["connection"]).toBe("keep-alive");
    expect(streamResponse.body).toBe(
      "data: Fake task received: do the thing\n\n" +
        "data: Fake task complete.\n\n" +
        'event: done\ndata: {"status":"completed"}\n\n'
    );
  });

  test("returns 404 for an unknown taskId", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const response = await app.inject({
      method: "GET",
      url: "/api/agents/active/tasks/does-not-exist/stream"
    });

    expect(response.statusCode).toBe(404);
  });

  test("replays a completed task after rebuilding the app without rerunning the agent", async () => {
    await withTaskStore(async (path) => {
      const firstAgent = new FakeAgent();
      const firstConfigurator = new AgentConfigurator();
      firstConfigurator.register("fake", firstAgent);
      const firstApp = buildApp(new AgentManager(firstConfigurator, "fake"), {
        taskStore: new FileTaskStore(path)
      });

      const postResponse = await firstApp.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "recover me" }
      });
      const { taskId } = postResponse.json();
      await wait(10);
      await firstApp.close();

      const secondAgent = new FakeAgent();
      const runTaskSpy = vi.spyOn(secondAgent, "runTask");
      const secondConfigurator = new AgentConfigurator();
      secondConfigurator.register("fake", secondAgent);
      const secondApp = buildApp(new AgentManager(secondConfigurator, "fake"), {
        taskStore: new FileTaskStore(path)
      });

      const streamResponse = await secondApp.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}/stream`
      });

      expect(streamResponse.statusCode).toBe(200);
      expect(streamResponse.body).toContain("Fake task received: recover me");
      expect(streamResponse.body).toContain(
        'event: done\ndata: {"status":"completed"}\n\n'
      );
      expect(runTaskSpy).not.toHaveBeenCalled();
      await secondApp.close();
    });
  });

  test("returns a structured failed outcome and preserves streamed chunks", async () => {
    await withTaskStore(async (path) => {
      const configurator = new AgentConfigurator();
      configurator.register("failing", new FailingAgent());
      const app = buildApp(new AgentManager(configurator, "failing"), {
        taskStore: new FileTaskStore(path)
      });

      const postResponse = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "fail me" }
      });
      const { taskId } = postResponse.json();
      await wait(10);

      const statusResponse = await app.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}`
      });
      expect(statusResponse.json()).toMatchObject({
        taskId,
        status: "failed",
        outcome: { status: "failed", message: "simulated failure" },
        chunks: ["before failure"]
      });

      const streamResponse = await app.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}/stream`
      });
      expect(streamResponse.body).toContain("data: before failure\n\n");
      expect(streamResponse.body).toContain(
        'event: done\ndata: {"status":"failed","message":"simulated failure"}\n\n'
      );
      await app.close();
    });
  });

  test("marks work unavailable without invoking an unhealthy agent", async () => {
    await withTaskStore(async (path) => {
      const configurator = new AgentConfigurator();
      const manager = new AgentManager(configurator, "unregistered-kind");
      const app = buildApp(manager, { taskStore: new FileTaskStore(path) });

      const postResponse = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "wait for an agent" }
      });
      const { taskId } = postResponse.json();

      const statusResponse = await app.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}`
      });
      expect(statusResponse.json()).toMatchObject({
        taskId,
        status: "unavailable",
        outcome: { status: "unavailable", message: "no agent available" },
        chunks: ["no agent available"]
      });
      await app.close();
    });
  });

  test("reconciles an interrupted running task as unavailable on restart", async () => {
    await withTaskStore(async (path) => {
      const taskId = "interrupted-task";
      const store = new FileTaskStore(path);
      const now = new Date().toISOString();
      store.create({
        taskId,
        task: "interrupted work",
        sessionKey: "session-1",
        chunks: ["last durable chunk"],
        status: "running",
        outcome: null,
        createdAt: now,
        updatedAt: now
      });

      const agent = new FakeAgent();
      const runTaskSpy = vi.spyOn(agent, "runTask");
      const configurator = new AgentConfigurator();
      configurator.register("fake", agent);
      const app = buildApp(new AgentManager(configurator, "fake"), {
        taskStore: new FileTaskStore(path)
      });

      const statusResponse = await app.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}`
      });
      expect(statusResponse.json()).toMatchObject({
        taskId,
        status: "unavailable",
        outcome: {
          status: "unavailable",
          message: "task interrupted by backend restart"
        }
      });

      const streamResponse = await app.inject({
        method: "GET",
        url: `/api/agents/active/tasks/${taskId}/stream`
      });
      expect(streamResponse.body).toContain("data: last durable chunk\n\n");
      expect(runTaskSpy).not.toHaveBeenCalled();
      await app.close();
    });
  });
});
