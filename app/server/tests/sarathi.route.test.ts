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
  test("rejects an unconfigured discovered route before starting runtime work", async () => {
    await withStore(async (sarathiPath) => {
      let runtimeRuns = 0;
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(join(dirname(sarathiPath), "tasks.json")),
        runtimeRouter: {
          async *run() {
            runtimeRuns += 1;
            yield { type: "terminal" as const, outcome: { status: "completed" as const } };
          }
        },
        providerCatalogAdapters: [{
          provider: "fake-provider",
          async discover() {
            return {
              authenticationMode: "none" as const,
              provenance: "deterministic fake discovery",
              observedAt: "2026-09-06T10:10:00.000Z",
              completeness: "complete" as const,
              models: [{
                model: "unconfigured-model",
                configured: false,
                qualification: {
                  health: "qualified" as const,
                  streaming: "qualified" as const,
                  structuredOutput: "qualified" as const,
                  toolCalling: "qualified" as const
                }
              }]
            };
          }
        }]
      });
      await app.inject({ method: "POST", url: "/api/sarathi/providers/fake-provider/catalog/refresh" });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "must not run",
          routePolicy: {
            primary: { runtime: "fake", provider: "fake-provider", model: "unconfigured-model", billingMode: "fake" }
          }
        }
      });

      expect(submitted.statusCode).toBe(400);
      expect(submitted.json().error).toContain("not configured");
      expect(runtimeRuns).toBe(0);
      await app.close();
    });
  });

  test("rejects unknown qualification evidence before starting runtime work", async () => {
    await withStore(async (sarathiPath) => {
      let runtimeRuns = 0;
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(join(dirname(sarathiPath), "tasks.json")),
        runtimeRouter: {
          async *run() {
            runtimeRuns += 1;
            yield { type: "terminal" as const, outcome: { status: "completed" as const } };
          }
        },
        providerCatalogAdapters: [{
          provider: "fake-provider",
          async discover() {
            return {
              authenticationMode: "none" as const,
              provenance: "deterministic fake qualification",
              observedAt: "2026-09-06T10:11:00.000Z",
              completeness: "complete" as const,
              models: [{
                model: "unknown-model",
                configured: true,
                qualification: {
                  health: "qualified" as const,
                  streaming: "qualified" as const,
                  structuredOutput: "unknown" as const,
                  toolCalling: "qualified" as const
                }
              }]
            };
          }
        }]
      });
      await app.inject({ method: "POST", url: "/api/sarathi/providers/fake-provider/catalog/refresh" });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "must not run unknown evidence",
          routePolicy: {
            primary: { runtime: "fake", provider: "fake-provider", model: "unknown-model", billingMode: "fake" }
          }
        }
      });

      expect(submitted.statusCode).toBe(400);
      expect(submitted.json().error).toContain("structuredOutput is unknown");
      expect(runtimeRuns).toBe(0);
      await app.close();
    });
  });

  test("refreshes injected provider catalogs during Fastify startup", async () => {
    await withStore(async (path) => {
      let discoveries = 0;
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        providerCatalogAdapters: [{
          provider: "startup-provider",
          async discover() {
            discoveries += 1;
            return {
              authenticationMode: "none" as const,
              provenance: "startup fake discovery",
              observedAt: "2026-09-06T10:12:00.000Z",
              completeness: "complete" as const,
              models: []
            };
          }
        }]
      });

      const dashboard = await app.inject({ method: "GET", url: "/api/sarathi/dashboard" });

      expect(discoveries).toBe(1);
      expect(dashboard.json().providerCatalogs).toEqual([
        expect.objectContaining({ provider: "startup-provider", provenance: "startup fake discovery" })
      ]);
      await app.close();
    });
  });

  test("exposes normalized fake provider catalog evidence and does not treat unknown qualification as executable", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        providerCatalogAdapters: [
          {
            provider: "fake-provider",
            async discover() {
              return {
                authenticationMode: "environment-reference" as const,
                provenance: "fake provider model API",
                observedAt: "2026-09-06T10:00:00.000Z",
                completeness: "incomplete" as const,
                models: [
                  {
                    model: "alpha",
                    configured: false,
                    qualification: {
                      health: "qualified" as const,
                      streaming: "qualified" as const,
                      structuredOutput: "unknown" as const,
                      toolCalling: "unknown" as const
                    }
                  }
                ]
              };
            }
          }
        ]
      });

      const refresh = await app.inject({
        method: "POST",
        url: "/api/sarathi/providers/fake-provider/catalog/refresh"
      });

      expect(refresh.statusCode).toBe(200);
      expect(refresh.json()).toMatchObject({
        refresh: { status: "succeeded" },
        catalog: {
          provider: "fake-provider",
          authenticationMode: "environment-reference",
          provenance: "fake provider model API",
          observedAt: "2026-09-06T10:00:00.000Z",
          completeness: "incomplete",
          stale: false,
          models: [
            {
              id: "fake-provider:alpha",
              model: "alpha",
              configured: false,
              qualification: { structuredOutput: "unknown", toolCalling: "unknown" },
              eligible: false
            }
          ]
        }
      });

      const dashboard = await app.inject({ method: "GET", url: "/api/sarathi/dashboard" });
      expect(dashboard.json().providerCatalogs).toEqual([
        expect.objectContaining({ provider: "fake-provider", completeness: "incomplete", stale: false })
      ]);
      await app.close();
    });
  });

  test("requires configured and fully qualified evidence before a model is eligible", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        providerCatalogAdapters: [{
          provider: "fake-provider",
          async discover() {
            return {
              authenticationMode: "none" as const,
              provenance: "deterministic qualification probe",
              observedAt: "2026-09-06T10:01:00.000Z",
              completeness: "complete" as const,
              models: [
                {
                  model: "unknown-structured-output",
                  configured: true,
                  qualification: {
                    health: "qualified" as const,
                    streaming: "qualified" as const,
                    structuredOutput: "unknown" as const,
                    toolCalling: "qualified" as const
                  }
                },
                {
                  model: "qualified-model",
                  configured: true,
                  qualification: {
                    health: "qualified" as const,
                    streaming: "qualified" as const,
                    structuredOutput: "qualified" as const,
                    toolCalling: "qualified" as const
                  }
                }
              ]
            };
          }
        }]
      });

      const refresh = await app.inject({
        method: "POST",
        url: "/api/sarathi/providers/fake-provider/catalog/refresh"
      });

      expect(refresh.statusCode).toBe(200);
      expect(refresh.json().catalog.models).toEqual(expect.arrayContaining([
        expect.objectContaining({ model: "unknown-structured-output", configured: true, eligible: false }),
        expect.objectContaining({ model: "qualified-model", configured: true, eligible: true })
      ]));
      await app.close();
    });
  });

  test("keeps the last successful catalog visibly stale when a refresh fails", async () => {
    await withStore(async (path) => {
      let failRefresh = false;
      const adapter = {
        provider: "fake-provider",
        async discover() {
          if (failRefresh) {
            throw new Error("fake transport unavailable");
          }
          return {
            authenticationMode: "none" as const,
            provenance: "deterministic fake discovery",
            observedAt: "2026-09-06T10:02:00.000Z",
            completeness: "complete" as const,
            models: [{
              model: "last-known-model",
              configured: true,
              qualification: {
                health: "qualified" as const,
                streaming: "qualified" as const,
                structuredOutput: "qualified" as const,
                toolCalling: "qualified" as const
              }
            }]
          };
        }
      };
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        providerCatalogAdapters: [adapter]
      });

      await app.inject({ method: "POST", url: "/api/sarathi/providers/fake-provider/catalog/refresh" });
      failRefresh = true;
      const failed = await app.inject({
        method: "POST",
        url: "/api/sarathi/providers/fake-provider/catalog/refresh"
      });

      expect(failed.statusCode).toBe(200);
      expect(failed.json()).toMatchObject({
        refresh: { status: "failed" },
        catalog: {
          provider: "fake-provider",
          observedAt: "2026-09-06T10:02:00.000Z",
          stale: true,
          refreshError: "fake transport unavailable",
          models: [expect.objectContaining({ model: "last-known-model", eligible: true })]
        }
      });
      await app.close();
    });
  });

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
