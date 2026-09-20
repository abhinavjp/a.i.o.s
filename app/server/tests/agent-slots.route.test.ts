import { describe, expect, test, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp } from "./testApp.js";
import { FileTaskStore } from "../src/TaskStore.js";

function manager() {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

describe("agent slots", () => {
  test("reports every agent's configured slot limit and defaults an omitted limit to one", async () => {
    const server = createTestApp(manager());
    const created = await server.inject({ method: "POST", url: "/api/sarathi/specialists", payload: { name: "Review", role: "reviewer", slotLimit: 2 } });
    expect(created.statusCode).toBe(201);

    const response = await server.inject({ method: "GET", url: "/api/sarathi/agents" });
    expect(response.statusCode).toBe(200);
    expect(response.json().agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sarathi", slotLimit: 1, slotsInUse: 0, full: false }),
      expect.objectContaining({ id: created.json().specialist.id, slotLimit: 2, slotsInUse: 0, full: false })
    ]));
  });

  test("does not start work on a full agent and frees its slot when the job finishes", async () => {
    let release: (() => void) | undefined;
    const server = createTestApp(manager(), {
      runtimeRouter: {
        async *run(input) {
          await new Promise<void>((resolve) => {
            release = resolve;
            input.signal.addEventListener("abort", resolve, { once: true });
          });
          yield { type: "terminal" as const, outcome: { status: "completed" as const } };
        }
      }
    });
    const created = await server.inject({ method: "POST", url: "/api/sarathi/specialists", payload: { name: "Build", role: "builder", slotLimit: 1 } });
    const agentId = created.json().specialist.id;
    const first = await server.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "first job", specialistId: agentId } });
    expect(first.statusCode).toBe(202);
    await vi.waitFor(async () => expect((await server.inject({ method: "GET", url: "/api/sarathi/agents" })).json().agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: agentId, slotLimit: 1, slotsInUse: 1, full: true })
    ])));

    const blocked = await server.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "second job", specialistId: agentId } });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error).toBe("agent has no free slot");

    release!();
    await vi.waitFor(async () => expect((await server.inject({ method: "GET", url: `/api/agents/active/tasks/${first.json().taskId}` })).json().status).toBe("completed"));
    expect((await server.inject({ method: "GET", url: "/api/sarathi/agents" })).json().agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: agentId, slotsInUse: 0, full: false })
    ]));
    expect((await server.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "third job", specialistId: agentId } })).statusCode).toBe(202);
  });

  test("counts an upgraded running job without an assigned agent against Sarathi's default slot", async () => {
    const directory = mkdtempSync(join(tmpdir(), "agent-slots-"));
    const taskStore = new FileTaskStore(join(directory, "tasks.json"));
    taskStore.create({ taskId: "legacy-task", task: "legacy running job", sessionKey: "legacy", chunks: [], status: "running", outcome: null, createdAt: "2026-09-20T00:00:00.000Z", updatedAt: "2026-09-20T00:00:00.000Z" });
    const server = createTestApp(manager(), { taskStore });
    expect((await server.inject({ method: "GET", url: "/api/sarathi/agents" })).json().agents).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "sarathi", slotLimit: 1, slotsInUse: 1, full: true })
    ]));
    await server.close();
    rmSync(directory, { recursive: true, force: true });
  });

});
