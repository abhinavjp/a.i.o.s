import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import type { AgentAbstraction, AgentInfo, HealthStatus, TaskStream } from "@aios/contracts";
import { createTestApp as buildApp } from "./testApp.js";
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

class HealthChangingFakeAgent implements AgentAbstraction {
  unhealthy = false;

  getInfo(): AgentInfo {
    return { id: "health-changing-fake", kind: "fake", displayName: "Health changing fake" };
  }

  checkHealth(): HealthStatus {
    return this.unhealthy ? { ok: false, reason: "selected runtime is unhealthy" } : { ok: true };
  }

  runTask(): TaskStream {
    return (async function* () { yield "unused"; })();
  }

  asOrchestrator() {
    return null;
  }
}

describe("Sarathi dashboard routes", () => {
  test("hard denies an injected Sarathi tool before any executor receives it", async () => {
    await withStore(async (path) => {
      const executed: string[] = [];
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: {
          definitions: [{ tool: "repository", operations: ["read_file", "delete_file"] }],
          async execute(intent) {
            executed.push(`${intent.tool}:${intent.operation}:${intent.target}`);
            return { output: "fake tool result" };
          }
        }
      });

      const rule = await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/rules",
        payload: { decision: "deny", tool: "repository", operation: "read_file", target: "secrets.txt", lifetime: "global" }
      });
      expect(rule.statusCode).toBe(201);

      const response = await app.inject({
        method: "POST",
        url: "/api/sarathi/tools/execute",
        payload: {
          tool: "repository",
          operation: "read_file",
          target: "secrets.txt",
          context: { projectId: "project-a", sessionKey: "session-a" }
        }
      });

      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ decision: { outcome: "denied", reason: "hard deny" } });
      expect(executed).toEqual([]);
      await app.close();
    });
  });

  test("requires exact approval for a consequential scoped allow while preserving read allow", async () => {
    await withStore(async (path) => {
      const executed: string[] = [];
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: {
          definitions: [{ tool: "repository", operations: ["read_file", "write_file"] }],
          async execute(intent) { executed.push(intent.operation); return { output: intent.operation }; }
        }
      });
      const context = { projectId: "project-a", sessionKey: "session-a", revision: "abc123" };
      const writeIntent = { tool: "repository", operation: "write_file", target: "reports/review.md", context };
      await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/rules",
        payload: { decision: "allow", tool: "repository", operation: "write_file", target: "reports/review.md", lifetime: "project", context: { projectId: "project-a" } }
      });
      await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/rules",
        payload: { decision: "allow", tool: "repository", operation: "read_file", target: "reports/review.md", lifetime: "project", context: { projectId: "project-a" } }
      });

      const pendingWrite = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: writeIntent });
      const read = await app.inject({
        method: "POST",
        url: "/api/sarathi/tools/execute",
        payload: { ...writeIntent, operation: "read_file" }
      });
      expect(pendingWrite.statusCode).toBe(409);
      expect(pendingWrite.json().decision).toEqual({ outcome: "requires_approval", reason: "operator approval required" });
      expect(read.json().decision).toEqual({ outcome: "allowed", reason: "scoped allow" });

      await app.inject({ method: "POST", url: "/api/sarathi/permissions/approvals", payload: { intent: writeIntent, lifetime: "project" } });
      const approvedWrite = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: writeIntent });
      expect(approvedWrite.json().decision).toEqual({ outcome: "allowed", reason: "action-bound approval" });
      expect(executed).toEqual(["read_file", "write_file"]);
      await app.close();
    });
  });

  test("rejects session and project approvals without their context binding", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: { definitions: [], async execute() { return { output: "unused" }; } }
      });
      const intent = { tool: "repository", operation: "write_file", target: "reports/review.md", context: {} };

      const session = await app.inject({ method: "POST", url: "/api/sarathi/permissions/approvals", payload: { intent, lifetime: "session" } });
      const project = await app.inject({ method: "POST", url: "/api/sarathi/permissions/approvals", payload: { intent, lifetime: "project" } });

      expect(session.statusCode).toBe(400);
      expect(project.statusCode).toBe(400);
      await app.close();
    });
  });

  test("requires an exact context-bound approval for a scoped ask and invalidates changed context", async () => {
    await withStore(async (path) => {
      const executed: string[] = [];
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: {
          definitions: [{ tool: "repository", operations: ["write_file"] }],
          async execute(intent) {
            executed.push(intent.target);
            return { output: "fake write" };
          }
        }
      });
      const intent = {
        tool: "repository",
        operation: "write_file",
        target: "reports/review.md",
        context: { projectId: "project-a", sessionKey: "session-a", revision: "abc123" }
      };
      await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/rules",
        payload: { decision: "ask", tool: "repository", operation: "write_file", target: "reports/review.md", lifetime: "project", context: { projectId: "project-a" } }
      });

      const pending = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent });
      expect(pending.statusCode).toBe(409);
      expect(pending.json().decision).toEqual({ outcome: "requires_approval", reason: "scoped ask" });

      const approval = await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/approvals",
        payload: { intent, lifetime: "project" }
      });
      expect(approval.statusCode).toBe(201);

      const approved = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent });
      expect(approved.statusCode).toBe(200);
      expect(approved.json()).toMatchObject({ decision: { outcome: "allowed", reason: "action-bound approval" }, output: "fake write" });

      const changed = await app.inject({
        method: "POST",
        url: "/api/sarathi/tools/execute",
        payload: { ...intent, context: { ...intent.context, revision: "def456" } }
      });
      expect(changed.statusCode).toBe(409);
      expect(changed.json().decision).toEqual({ outcome: "requires_approval", reason: "scoped ask" });
      expect(executed).toEqual(["reports/review.md"]);
      await app.close();
    });
  });

  test("rejects a session or project permission rule without its binding context", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: { definitions: [], async execute() { return { output: "unused" }; } }
      });

      const missingSession = await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/rules",
        payload: { decision: "allow", tool: "repository", operation: "write_file", target: "report.md", lifetime: "session" }
      });
      const missingProject = await app.inject({
        method: "POST",
        url: "/api/sarathi/permissions/rules",
        payload: { decision: "allow", tool: "repository", operation: "write_file", target: "report.md", lifetime: "project", context: { sessionKey: "session-a" } }
      });

      expect(missingSession.statusCode).toBe(400);
      expect(missingProject.statusCode).toBe(400);
      await app.close();
    });
  });

  test("fails closed to operator approval when the semantic classifier is unavailable", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: {
          definitions: [{ tool: "workspace", operations: ["format_file"] }],
          async execute() { return { output: "must not execute" }; }
        },
        permissionSemanticClassifier: {
          async classify() { throw new Error("deterministic fake classifier offline"); }
        }
      });

      const response = await app.inject({
        method: "POST",
        url: "/api/sarathi/tools/execute",
        payload: {
          tool: "workspace",
          operation: "format_file",
          target: "notes.md",
          context: { projectId: "project-a", sessionKey: "session-a" }
        }
      });

      expect(response.statusCode).toBe(409);
      expect(response.json().decision).toEqual({ outcome: "requires_approval", reason: "operator approval required" });
      await app.close();
    });
  });

  test("allows only unresolved low-risk semantic intents and never consequential messages", async () => {
    await withStore(async (path) => {
      const executed: string[] = [];
      const classifierCalls: string[] = [];
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path),
        permissionTools: {
          definitions: [
            { tool: "workspace", operations: ["read_file", "format_file"] },
            { tool: "notifier", operations: ["send_message"] }
          ],
          async execute(intent) { executed.push(intent.operation); return { output: intent.operation }; }
        },
        permissionSemanticClassifier: {
          async classify(intent) { classifierCalls.push(intent.operation); return "low-risk"; }
        }
      });
      const context = { projectId: "project-a", sessionKey: "session-a" };

      const read = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "workspace", operation: "read_file", target: "notes.md", context } });
      const semantic = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "workspace", operation: "format_file", target: "notes.md", context } });
      const message = await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "notifier", operation: "send_message", target: "operator@example.test", context } });

      expect(read.json().decision).toEqual({ outcome: "allowed", reason: "deterministic safe/read-only" });
      expect(semantic.json().decision).toEqual({ outcome: "allowed", reason: "semantic low-risk" });
      expect(message.statusCode).toBe(409);
      expect(message.json().decision).toEqual({ outcome: "requires_approval", reason: "operator approval required" });
      expect(classifierCalls).toEqual(["format_file"]);
      expect(executed).toEqual(["read_file", "format_file"]);
      await app.close();
    });
  });

  test("mediates a runtime tool request through Sarathi instead of ambient tool authority", async () => {
    await withStore(async (sarathiPath) => {
      let runtimeToolResult: unknown;
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(join(dirname(sarathiPath), "tasks.json")),
        permissionTools: {
          definitions: [{ tool: "workspace", operations: ["read_file"] }],
          async execute() { return { output: "Sarathi-controlled result" }; }
        },
        runtimeRouter: {
          async *run(input) {
            runtimeToolResult = await input.executeTool({
              tool: "workspace",
              operation: "read_file",
              target: "notes.md",
              context: { projectId: "project-a", sessionKey: input.sessionKey }
            });
            yield { type: "terminal" as const, outcome: { status: "completed" as const } };
          }
        }
      });

      const submitted = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "read local notes" } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(submitted.statusCode).toBe(202);
      expect(runtimeToolResult).toMatchObject({ decision: { outcome: "allowed", reason: "deterministic safe/read-only" }, output: "Sarathi-controlled result" });
      await app.close();
    });
  });

  test("rejects a catalog-qualified route when the selected agent becomes unhealthy before persistence", async () => {
    await withStore(async (sarathiPath) => {
      const agent = new HealthChangingFakeAgent();
      const configurator = new AgentConfigurator();
      configurator.register("fake", agent);
      const manager = new AgentManager(configurator, "fake");
      agent.unhealthy = true;
      let runtimeRuns = 0;
      const taskPath = join(dirname(sarathiPath), "tasks.json");
      const app = buildApp(manager, {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(taskPath),
        runtimeRouter: {
          async *run() {
            runtimeRuns += 1;
            yield { type: "terminal" as const, outcome: { status: "completed" as const } };
          }
        },
        providerCatalogAdapters: [{
          provider: "health-provider",
          async discover() {
            return {
              authenticationMode: "none" as const,
              provenance: "deterministic health catalog",
              observedAt: "2026-09-06T13:00:00.000Z",
              completeness: "complete" as const,
              models: [{
                model: "health-model",
                enabled: true,
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
        }]
      });
      await app.inject({ method: "POST", url: "/api/sarathi/providers/health-provider/catalog/refresh" });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "must not persist unhealthy fixed selection",
          routePolicy: {
            primary: { runtime: "fake", provider: "health-provider", model: "health-model", billingMode: "fake" }
          }
        }
      });

      expect(submitted.statusCode).toBe(400);
      expect(submitted.json().error).toBe("selected runtime is unhealthy");
      expect(existsSync(taskPath)).toBe(false);
      expect(runtimeRuns).toBe(0);
      await app.close();
    });
  });

  test("runs an enabled qualified fixed route and records its requested and effective identities", async () => {
    await withStore(async (sarathiPath) => {
      let receivedPlan: unknown;
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(sarathiPath),
        taskStore: new FileTaskStore(join(dirname(sarathiPath), "tasks.json")),
        runtimeRouter: {
          async *run(input) {
            receivedPlan = input.plan;
            yield { type: "terminal" as const, outcome: { status: "completed" as const } };
          }
        },
        providerCatalogAdapters: [{
          provider: "fixed-provider",
          async discover() {
            return {
              authenticationMode: "environment-reference" as const,
              provenance: "deterministic fixed-route catalog",
              observedAt: "2026-09-06T12:00:00.000Z",
              completeness: "complete" as const,
              models: [{
                model: "fixed-model",
                enabled: true,
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
        }]
      });
      await app.inject({ method: "POST", url: "/api/sarathi/providers/fixed-provider/catalog/refresh" });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "run the fixed route",
          routePolicy: {
            primary: { runtime: "fake", provider: "fixed-provider", model: "fixed-model", billingMode: "fake" }
          }
        }
      });

      expect(submitted.statusCode).toBe(202);
      const task = await app.inject({ method: "GET", url: `/api/agents/active/tasks/${submitted.json().taskId}` });
      expect(task.json()).toMatchObject({
        resolvedExecutionPlan: {
          selection: {
            requestedRoute: { runtime: "fake", provider: "fixed-provider", model: "fixed-model", billingMode: "fake" },
            effectiveRoute: { runtime: "fake", provider: "fixed-provider", model: "fixed-model", billingMode: "fake" },
            authenticationMode: "environment-reference",
            billingMode: "fake",
            reason: expect.stringContaining("fixed route")
          }
        },
        attempts: [expect.objectContaining({
          selection: expect.objectContaining({ authenticationMode: "environment-reference" })
        })]
      });
      expect(receivedPlan).toMatchObject({ selection: { effectiveRoute: { provider: "fixed-provider", model: "fixed-model" } } });
      const dashboard = await app.inject({ method: "GET", url: "/api/sarathi/dashboard" });
      expect(dashboard.json().recentTasks[0]).toMatchObject({
        selectionReason: expect.stringContaining("fixed route")
      });
      await app.close();
    });
  });

  test("rejects a disabled fixed route before starting runtime work", async () => {
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
          provider: "disabled-provider",
          async discover() {
            return {
              authenticationMode: "none" as const,
              provenance: "deterministic disabled-route catalog",
              observedAt: "2026-09-06T12:01:00.000Z",
              completeness: "complete" as const,
              models: [{
                model: "disabled-model",
                enabled: false,
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
        }]
      });
      await app.inject({ method: "POST", url: "/api/sarathi/providers/disabled-provider/catalog/refresh" });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "must not run disabled route",
          routePolicy: {
            primary: { runtime: "fake", provider: "disabled-provider", model: "disabled-model", billingMode: "fake" }
          }
        }
      });

      expect(submitted.statusCode).toBe(400);
      expect(submitted.json().error).toContain("not enabled");
      expect(runtimeRuns).toBe(0);
      await app.close();
    });
  });

  test("rejects an executable runtime with unmeasured billing before starting runtime work", async () => {
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
        }
      });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "must not run forged unmeasured route",
          routePolicy: {
            primary: { runtime: "fake", provider: "unknown-provider", model: "unknown-model", billingMode: "unmeasured" }
          }
        }
      });

      expect(submitted.statusCode).toBe(400);
      expect(submitted.json().error).toContain("not in an observed provider catalog");
      expect(runtimeRuns).toBe(0);
      await app.close();
    });
  });

  test("rejects an unknown provider and model before starting runtime work", async () => {
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
        }
      });

      const submitted = await app.inject({
        method: "POST",
        url: "/api/agents/active/tasks",
        payload: {
          task: "must not run unknown provider",
          routePolicy: {
            primary: { runtime: "fake", provider: "unknown-provider", model: "unknown-model", billingMode: "fake" }
          }
        }
      });

      expect(submitted.statusCode).toBe(400);
      expect(submitted.json().error).toContain("not in an observed provider catalog");
      expect(runtimeRuns).toBe(0);
      await app.close();
    });
  });

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
