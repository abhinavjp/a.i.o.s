import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, EngineRegistry, FakeAgent, NullAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";
import { FileTaskStore } from "../src/TaskStore.js";

const policy = (engine: "hermes" | "codex" | "claude-code") => ({ primary: { engine, configuration: "default", billingMode: "subscription" as const } });

describe("engine task admission", () => {
  test("resolves all layers, returns the immutable plan, and persists it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-admission-"));
    const engineStore = new FileEngineConfigStore(join(directory, "routing.json"));
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    engineStore.setPolicy("global", undefined, policy("hermes"));
    engineStore.setPolicy("agent", "reviewer", policy("codex"));
    engineStore.setPolicy("workflow", "review", policy("claude-code"));
    const registry = new EngineRegistry();
    registry.registerAgent("hermes", new FakeAgent()); registry.registerAgent("codex", new FakeAgent()); registry.registerAgent("claude-code", new FakeAgent());
    const app = buildApp(new AgentManager(new AgentConfigurator(), "hermes", registry), { engineConfigStore: engineStore, taskStore });
    try {
      const response = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "review", workflowId: "review", agentId: "reviewer", engineOverride: policy("hermes") } });
      expect(response.statusCode).toBe(202);
      const body = response.json() as { taskId: string; resolvedEnginePlan: { primary: { engine: string }; source: string } };
      expect(body.resolvedEnginePlan.primary.engine).toBe("hermes");
      expect(body.resolvedEnginePlan.source).toBe("task");
      expect(taskStore.get(body.taskId)?.resolvedEnginePlan?.primary.engine).toBe("hermes");
      engineStore.setPolicy("global", undefined, policy("codex"));
      expect(taskStore.get(body.taskId)?.resolvedEnginePlan?.primary.engine).toBe("hermes");
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });

  test("blocks unavailable engines and Hermes-only Kanban incompatibility", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-admission-blocked-"));
    const engineStore = new FileEngineConfigStore(join(directory, "routing.json"));
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    const registry = new EngineRegistry(); registry.registerAgent("codex", new NullAgent()); registry.registerAgent("hermes", new FakeAgent()); registry.registerAgent("claude-code", new NullAgent());
    const app = buildApp(new AgentManager(new AgentConfigurator(), "hermes", registry), { engineConfigStore: engineStore, taskStore });
    try {
      await engineStore.setPolicy("global", undefined, policy("codex"));
      const unavailable = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "blocked" } });
      expect(unavailable.json().outcome.status).toBe("unavailable");
      expect(unavailable.json().executedEngineRoute).toBeUndefined();
      await engineStore.setPolicy("global", undefined, policy("codex"));
      const incompatible = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "kanban", orchestration: "hermes-kanban" } });
      expect(incompatible.json().outcome.status).toBe("blocked");
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });

  test("derives the initial safe boundary and returns fallback execution attribution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-admission-fallback-"));
    const engineStore = new FileEngineConfigStore(join(directory, "routing.json"));
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    engineStore.setConsent({ crossEngineFallback: true, paidFallback: false, acceptedAt: "now" });
    engineStore.setPolicy("global", undefined, {
      primary: { engine: "codex", configuration: "default", billingMode: "subscription" },
      fallbacks: [{ engine: "hermes", configuration: "fallback", billingMode: "subscription" }],
      fallbackEnabled: true
    });
    const registry = new EngineRegistry();
    registry.registerAgent("codex", new NullAgent());
    registry.registerAgent("hermes", new FakeAgent());
    const app = buildApp(new AgentManager(new AgentConfigurator(), "hermes", registry), { engineConfigStore: engineStore, taskStore });
    try {
      const response = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "fallback" } });
      expect(response.statusCode).toBe(202);
      const body = response.json();
      expect(body.executedEngineRoute).toMatchObject({ engine: "hermes", configuration: "fallback" });
      expect(body.attemptedEngineRoutes.map((route: { engine: string }) => route.engine)).toEqual(["codex", "hermes"]);
      expect(taskStore.get(body.taskId)?.executedEngineRoute).toEqual(body.executedEngineRoute);
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });

  test("runs an admitted native engine instead of stopping it as UNMEASURED", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-admission-native-"));
    const engineStore = new FileEngineConfigStore(join(directory, "routing.json"));
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    await engineStore.setPolicy("global", undefined, policy("claude-code"));
    const registry = new EngineRegistry();
    registry.registerAgent("claude-code", new StubNativeAgent());
    const app = buildApp(new AgentManager(new AgentConfigurator(), "hermes", registry), { engineConfigStore: engineStore, taskStore });
    try {
      const submitted = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "greet" } });
      const { taskId } = submitted.json() as { taskId: string };
      await waitFor(async () => {
        const record = (await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json();
        expect(record.status).toBe("completed");
        expect(record.chunks).toEqual(["native output"]);
        expect(record.resolvedExecutionPlan.route.runtime).not.toBe("unmeasured");
      });
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });
});

class StubNativeAgent {
  getInfo() { return { id: "claude-code", kind: "claude-code" as const, displayName: "Claude Code" }; }
  checkHealth() { return { ok: true }; }
  async checkReadiness() { return { state: "ready" as const, reason: "stub proof", checkedAt: "now" }; }
  async *runTask() { yield "native output"; }
  asOrchestrator() { return null; }
}

async function waitFor(assertion: () => Promise<void>): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { await assertion(); return; } catch (error) { lastError = error; await new Promise((resolve) => setTimeout(resolve, 25)); }
  }
  throw lastError;
}
