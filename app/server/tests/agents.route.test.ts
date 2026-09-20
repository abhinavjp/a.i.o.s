import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { createTestApp as buildApp } from "./testApp.js";

describe("GET /api/agents", () => {
  test("reports the running package version on a fresh app", async () => {
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const app = buildApp(new AgentManager(configurator, "fake"));
    expect((await app.inject({ method: "GET", url: "/api/version" })).json()).toEqual({ version: "0.0.0" });
  });
  test("returns the active agent sourced from the Manager/Configurator/Abstraction chain", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const response = await app.inject({ method: "GET", url: "/api/agents" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      agents: [
        {
          id: "fake",
          kind: "fake",
          displayName: "Fake Agent",
          health: { ok: true }
        }
      ]
    });
  });
});
