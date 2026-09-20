import { describe, expect, test } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp } from "./testApp.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { FakeCodeHost } from "@aios/connectors";

function manager() { const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent()); return new AgentManager(configurator, "fake"); }
function app() { return createTestApp(manager(), { permissionTools: { definitions: [{ tool: "work", operations: ["artifact.approve", "track.change", "question", "recovery"] }, { tool: "code-host", operations: ["push", "merge", "delete"] }, { tool: "work-source", operations: ["close"] }, { tool: "system-update", operations: ["apply"] }, { tool: "repository", operations: ["irreversible"] }], async execute() { return { output: "done" }; }, isUndoable() { return true; }, async undo() {} } }); }

describe("autopilot", () => {
  test("keeps code-host floor actions refused with every autopilot tier automatic", async () => {
    const host = new FakeCodeHost();
    const allAutomatic = app();
    await allAutomatic.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "automatic", medium: "automatic", high: "automatic" } });
    expect((await allAutomatic.inject({ method: "POST", url: "/api/sarathi/standing-rules", payload: { label: "Questions", askKind: "question", scope: "all" } })).statusCode).toBe(201);
    for (const kind of ["merge", "delete"]) expect((await allAutomatic.inject({ method: "POST", url: "/api/sarathi/standing-rules", payload: { label: kind, askKind: kind, scope: "all" } })).statusCode).toBe(400);
    expect((await allAutomatic.inject({ method: "POST", url: "/api/sarathi/standing-rules", payload: { label: "Drafts", askKind: "mark-ready", scope: "all" } })).statusCode).toBe(201);
    for (const intent of [{ tool: "code-host", operation: "merge", target: "shared/main", context: {} }, { tool: "code-host", operation: "delete", target: "operator/branch", context: {} }]) {
      expect((await allAutomatic.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent })).statusCode).toBe(409);
    }
    await expect(host.merge()).rejects.toThrow(/permanently refuses/);
    await expect(host.markMergeRequestReady()).rejects.toThrow(/permanently refuses/);
    await expect(host.deleteBranch("operator/branch")).rejects.toThrow(/Adhisthana branch/);
  });
  test("defaults every tier to ask and adds risk to pending asks", async () => {
    const server = app();
    expect((await server.inject({ method: "GET", url: "/api/sarathi/autopilot" })).json()).toEqual({ low: "ask", medium: "ask", high: "ask" });
    await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "artifact.approve", target: "artifact", context: {} } });
    expect((await server.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks[0]).toMatchObject({ kind: "artifact.approve", risk: "low" });
  });

  test("adds risk to asks loaded from an older store", () => {
    const directory = mkdtempSync(join(tmpdir(), "sarathi-autopilot-"));
    const path = join(directory, "sarathi.json");
    try {
      const first = new FileSarathiStore(path);
      first.addPendingAsk({ kind: "track.change", workItemId: null, intent: { tool: "work", operation: "track.change", target: "track", context: {} } });
      const document = JSON.parse(readFileSync(path, "utf8"));
      delete document.dashboard.asks[0].risk;
      writeFileSync(path, JSON.stringify(document));
      expect(new FileSarathiStore(path).snapshot().asks[0]).toMatchObject({ kind: "track.change", risk: "medium" });
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  test("applies tier changes only to the next ask and keeps floor actions asking", async () => {
    const server = app();
    const low = { tool: "work", operation: "artifact.approve", target: "artifact", context: {} };
    expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: low })).statusCode).toBe(409);
    expect((await server.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "automatic", medium: "automatic", high: "automatic" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "GET", url: "/api/sarathi/asks" })).json().asks).toHaveLength(1);
    expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { ...low, target: "next" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "track.change", target: "track", context: {} } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "recovery", target: "state", context: {} } })).statusCode).toBe(200);
    expect((await server.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "ask", medium: "ask", high: "ask" } })).statusCode).toBe(200);
    expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: { tool: "work", operation: "artifact.approve", target: "asked", context: {} } })).statusCode).toBe(409);
    for (const intent of [{ tool: "code-host", operation: "push", target: "shared", context: {} }, { tool: "delivery-pipeline", operation: "worksource.transition", target: "OPS-1", context: {} }, { tool: "work-source", operation: "close", target: "OPS-1", context: {} }, { tool: "system-update", operation: "apply", target: "installation", context: {} }, { tool: "repository", operation: "irreversible", target: "shared", context: {} }]) {
      expect((await server.inject({ method: "POST", url: "/api/sarathi/tools/execute", payload: intent })).statusCode).toBe(409);
    }
    expect((await server.inject({ method: "PUT", url: "/api/sarathi/autopilot", payload: { low: "wrong", medium: "ask", high: "ask" } })).statusCode).toBe(400);
  });
});
