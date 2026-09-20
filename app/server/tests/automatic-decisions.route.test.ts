import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp } from "./testApp.js";

function manager() { const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent()); return new AgentManager(configurator, "fake"); }

describe("automatic decisions", () => {
  test("logs an undoable autopilot decision and restores its ask after undo", async () => {
    const undone: string[] = [];
    const app = createTestApp(manager(), { permissionTools: {
      definitions: [{ tool: "work", operations: ["artifact.approve", "track.change"] }],
      async execute(intent) { return { output: intent.operation }; },
      isUndoable(intent) { return intent.operation === "artifact.approve"; },
      async undo(intent) { undone.push(intent.operation); }
    } });
    await app.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "automatic", medium: "ask", high: "ask" } });
    const intent = { tool: "work", operation: "artifact.approve", target: "proposal", context: { workItemId: "work-1" } };
    expect((await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent })).statusCode).toBe(200);

    const listed = await app.inject({ method: "GET", url: "/api/sarathi/automatic-decisions" });
    expect(listed.json()).toMatchObject({ todayCount: 1, decisions: [{ intent, source: "autopilot", sourceDetail: "low", workItemId: "work-1", undone: false, undoable: true, createdAt: expect.any(String) }] });
    const id = listed.json().decisions[0].id;
    expect((await app.inject({ method: "POST", url: `/api/sarathi/automatic-decisions/${id}/undo` })).statusCode).toBe(200);
    expect(undone).toEqual(["artifact.approve"]);
    expect((await app.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0]).toMatchObject({ kind: "artifact.approve", intent });
    expect((await app.inject({ method: "GET", url: "/api/sarathi/automatic-decisions" })).json().decisions[0]).toMatchObject({ undone: true });
    expect((await app.inject({ method: "POST", url: `/api/sarathi/automatic-decisions/${id}/undo` })).statusCode).toBe(409);
  });

  test("keeps a non-undoable automatic decision as an ask", async () => {
    const app = createTestApp(manager(), { permissionTools: {
      definitions: [{ tool: "work", operations: ["artifact.approve"] }],
      async execute() { return { output: "done" }; },
      isUndoable() { return false; },
      async undo() { throw new Error("not undoable"); }
    } });
    await app.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "automatic", medium: "ask", high: "ask" } });
    expect((await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "artifact.approve", target: "proposal", context: {} } })).statusCode).toBe(409);
    expect((await app.inject({ method: "GET", url: "/api/sarathi/automatic-decisions" })).json()).toMatchObject({ todayCount: 0, decisions: [] });
  });

  test("keeps an action as an ask when its executor has no undo contract", async () => {
    const app = createTestApp(manager(), { permissionTools: { definitions: [{ tool: "work", operations: ["artifact.approve"] }], async execute() { return { output: "done" }; } } });
    await app.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "automatic", medium: "ask", high: "ask" } });
    expect((await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "artifact.approve", target: "proposal", context: {} } })).statusCode).toBe(409);
  });

  test("logs a standing rule decision", async () => {
    const app = createTestApp(manager(), { permissionTools: {
      definitions: [{ tool: "work", operations: ["track.change"] }],
      async execute() { return { output: "done" }; },
      isUndoable() { return true; }, async undo() {}
    } });
    expect((await app.inject({ method: "POST", url: "/api/sarathi/standing-rules", payload: { label: "Track changes", askKind: "track.change", scope: "all" } })).statusCode).toBe(201);
    expect((await app.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "track.change", target: "work-1", context: { workItemId: "work-1" } } })).statusCode).toBe(200);
    expect((await app.inject({ method: "GET", url: "/api/sarathi/automatic-decisions" })).json().decisions).toEqual([expect.objectContaining({ source: "standing rule", sourceDetail: "Track changes", workItemId: "work-1" })]);
  });
});
