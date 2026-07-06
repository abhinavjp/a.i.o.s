import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";

describe("GET /api/agents", () => {
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
