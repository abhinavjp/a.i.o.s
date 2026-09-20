import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp } from "./testApp.js";

function manager() { const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent()); return new AgentManager(configurator, "fake"); }
function app() { return createTestApp(manager(), { permissionTools: { definitions: [{ tool: "work", operations: ["track.change"] }, { tool: "code-host", operations: ["push"] }], async execute() { return { output: "done" }; }, isUndoable() { return true; }, async undo() {} } }); }

async function approve(server: ReturnType<typeof app>, intent: object) {
  expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent })).statusCode).toBe(409);
  const askId = (await server.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0].id;
  await server.inject({ method: "POST", url: `/api/sarathi/asks/${askId}/decide`, payload: { decision: "approved" } });
  expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent })).statusCode).toBe(200);
}

describe("standing rule suggestions", () => {
  test("offers after three identical approvals, accepts, and dismisses permanently", async () => {
    const server = app();
    const web = { tool: "work", operation: "track.change", target: "work-1", context: { repository: "web" } };
    await approve(server, web); await approve(server, web);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json()).toEqual({ suggestions: [] });
    await approve(server, web);
    const offered = (await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json().suggestions[0];
    expect(offered).toMatchObject({ askKind: "track.change", scope: "web" });
    expect((await server.inject({ method: "POST", url: `/api/sarathi/standing-rule-suggestions/${offered.id}/accept` })).statusCode).toBe(201);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rules" })).json().rules[0]).toMatchObject({ askKind: "track.change", scope: "web", enabled: true });

    const api = { ...web, target: "work-2", context: { repository: "api" } };
    await approve(server, api); await approve(server, api); await approve(server, api);
    const dismissed = (await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json().suggestions[0];
    expect((await server.inject({ method: "POST", url: `/api/sarathi/standing-rule-suggestions/${dismissed.id}/dismiss` })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json()).toEqual({ suggestions: [] });
    await approve(server, api); await approve(server, api); await approve(server, api);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json()).toEqual({ suggestions: [] });
  });

  test("resets on a different kind or scope and never offers a floor action", async () => {
    const server = app();
    const web = { tool: "work", operation: "track.change", target: "work-1", context: { repository: "web" } };
    const api = { ...web, target: "work-2", context: { repository: "api" } };
    await approve(server, web); await approve(server, web); await approve(server, api); await approve(server, web);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json()).toEqual({ suggestions: [] });
    const floor = { tool: "code-host", operation: "push", target: "shared/main", context: {} };
    await approve(server, floor); await approve(server, floor); await approve(server, floor);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json()).toEqual({ suggestions: [] });
  });

  test("resets a non-floor approval streak when a floor ask is approved", async () => {
    const server = app();
    const web = { tool: "work", operation: "track.change", target: "work-1", context: { repository: "web" } };
    const floor = { tool: "code-host", operation: "push", target: "shared/main", context: {} };
    await approve(server, web); await approve(server, web); await approve(server, floor); await approve(server, web);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/standing-rule-suggestions" })).json()).toEqual({ suggestions: [] });
  });
});
