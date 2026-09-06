import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";

async function withStore<T>(run: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-"));
  try {
    return await run(join(directory, "state.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeManager() {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

describe("Sarathi dashboard routes", () => {
  test("keeps immutable policy snapshots and history after edits and restart", async () => {
    await withStore(async (sarathiPath) => {
      const taskPath = join(dirname(sarathiPath), "tasks.json");
      const route = (model: string) => ({ runtime: "fake", provider: "test", model, billingMode: "fake" });
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(taskPath)
      });
      await app.inject({ method: "PUT", url: "/api/sarathi/routing/policies/global", payload: { primary: route("global-v1") } });
      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "snapshot config", routePolicy: { fallbacks: [route("task-v1")] } }
      });
      await app.inject({ method: "PUT", url: "/api/sarathi/routing/policies/global", payload: { primary: route("global-v2") } });

      const restarted = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(taskPath)
      });
      const task = await restarted.inject({ method: "GET", url: `/api/agents/active/tasks/${submitted.json().taskId}` });
      expect(task.json().resolvedExecutionPlan.configurationSnapshots).toMatchObject({
        global: { policy: { primary: route("global-v1") } },
        task: { policy: { fallbacks: [route("task-v1")] } }
      });
      const dashboard = await restarted.inject({ method: "GET", url: "/api/sarathi/dashboard" });
      expect(dashboard.json().routing.policies).toEqual(expect.arrayContaining([
        expect.objectContaining({ version: "global-v2", policy: { primary: route("global-v1") } }),
        expect.objectContaining({ version: "global-v3", policy: { primary: route("global-v2") } })
      ]));
      await app.close();
      await restarted.close();
    });
  });

  test("resolves independently inherited route policies by precedence and pins admitted task plans", async () => {
    await withStore(async (sarathiPath) => {
      const taskPath = join(dirname(sarathiPath), "tasks.json");
      let release: (() => void) | undefined;
      const ready = new Promise<void>((resolve) => {
        release = resolve;
      });
      const router = {
        async *run() {
          await ready;
          yield { type: "terminal" as const, outcome: { status: "completed" as const } };
        }
      };
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(taskPath),
        runtimeRouter: router
      });

      const route = (model: string) => ({ runtime: "fake", provider: "test", model, billingMode: "fake" });
      await app.inject({
        method: "PUT",
        url: "/api/sarathi/routing/policies/global",
        payload: { primary: route("global-primary"), fallbacks: [route("global-fallback")] }
      });
      await app.inject({
        method: "PUT",
        url: "/api/sarathi/routing/policies/specialist/reviewer",
        payload: { fallbacks: [route("specialist-fallback")] }
      });
      await app.inject({
        method: "PUT",
        url: "/api/sarathi/routing/policies/workflow/review-flow",
        payload: { primary: route("workflow-primary") }
      });

      const first = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "first routing task",
          specialistId: "reviewer",
          workflowId: "review-flow",
          routePolicy: { fallbacks: [route("task-fallback")] }
        }
      });
      expect(first.statusCode).toBe(202);
      const firstTask = await app.inject({ method: "GET", url: `/api/agents/active/tasks/${first.json().taskId}` });
      expect(firstTask.json().resolvedExecutionPlan).toMatchObject({
        route: route("workflow-primary"),
        fallbackRoutes: [route("task-fallback")],
        configurationVersions: {
          task: expect.stringContaining("task"),
          workflow: expect.stringContaining("workflow"),
          specialist: expect.stringContaining("specialist"),
          global: expect.stringContaining("global")
        }
      });

      await app.inject({
        method: "PUT",
        url: "/api/sarathi/routing/policies/workflow/review-flow",
        payload: { primary: route("workflow-primary-v2") }
      });
      const second = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: { task: "second routing task", specialistId: "reviewer", workflowId: "review-flow" }
      });
      const secondTask = await app.inject({ method: "GET", url: `/api/agents/active/tasks/${second.json().taskId}` });
      expect(secondTask.json().resolvedExecutionPlan).toMatchObject({
        route: route("workflow-primary-v2"),
        fallbackRoutes: [route("specialist-fallback")]
      });
      expect(firstTask.json().resolvedExecutionPlan.route.model).toBe("workflow-primary");

      release?.();
      await app.close();
    });
  });

  test("returns the local workflow snapshot with explicit launch gates", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path)
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/sarathi/dashboard"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        runtime: { billingMode: "subscription-only" },
        controls: { manualPaused: false },
        discovery: { status: "blocked" }
      });
      expect(response.json().tickets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "02", status: "complete" }),
          expect.objectContaining({ id: "09", status: "blocked" })
        ])
      );
      await app.close();
    });
  });

  test("persists manual pause and reports discovery as blocked without an adapter", async () => {
    await withStore(async (path) => {
      const store = new FileSarathiStore(path);
      const app = buildApp(makeManager(), { sarathiStore: store });

      const pauseResponse = await app.inject({
        method: "POST",
        url: "/api/sarathi/control/pause",
        payload: { paused: true }
      });
      expect(pauseResponse.statusCode).toBe(200);
      expect(pauseResponse.json().controls.manualPaused).toBe(true);

      const discoveryResponse = await app.inject({
        method: "POST",
        url: "/api/sarathi/discovery/check"
      });
      expect(discoveryResponse.statusCode).toBe(200);
      expect(discoveryResponse.json().discovery).toMatchObject({
        status: "blocked",
        reason: expect.stringContaining("GitLab")
      });

      const restarted = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path)
      });
      const snapshot = await restarted.inject({
        method: "GET",
        url: "/api/sarathi/dashboard"
      });
      expect(snapshot.json().controls.manualPaused).toBe(true);
      await app.close();
      await restarted.close();
    });
  });

  test("creates a pending specialist and requires approval before activation", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path)
      });

      const createResponse = await app.inject({
        method: "POST",
        url: "/api/sarathi/specialists",
        payload: {
          name: "Review specialist",
          role: "reviewer",
          runtime: "unselected"
        }
      });
      expect(createResponse.statusCode).toBe(201);
      const specialist = createResponse.json().specialist;
      expect(specialist.status).toBe("pending_approval");

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/sarathi/specialists/${specialist.id}/approve`
      });
      expect(approveResponse.statusCode).toBe(200);
      expect(approveResponse.json().specialist.status).toBe("active");
      await app.close();
    });
  });
});
