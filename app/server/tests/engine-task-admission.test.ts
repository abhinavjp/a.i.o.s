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
      await engineStore.setPolicy("global", undefined, policy("codex"));
      const incompatible = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "kanban", orchestration: "hermes-kanban" } });
      expect(incompatible.json().outcome.status).toBe("blocked");
    } finally { await app.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
