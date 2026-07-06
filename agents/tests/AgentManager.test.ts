import { describe, expect, test } from "vitest";
import { AgentManager } from "../src/AgentManager.js";
import { AgentConfigurator } from "../src/AgentConfigurator.js";
import { FakeAgent } from "../src/strategies/FakeAgent.js";
import { NullAgent } from "../src/strategies/NullAgent.js";

describe("AgentManager", () => {
  test("exposes the agent resolved by the Configurator for the configured default kind", () => {
    const configurator = new AgentConfigurator();
    const fake = new FakeAgent();
    configurator.register("fake", fake);

    const manager = new AgentManager(configurator, "fake");

    expect(manager.getActiveAgent()).toBe(fake);
  });

  test("caches the resolved agent at construction rather than re-resolving on every call", () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");

    configurator.register("fake", new FakeAgent());

    expect(manager.getActiveAgent()).toBe(manager.getActiveAgent());
  });

  test("falls back to NullAgent when the default kind is not registered", () => {
    const configurator = new AgentConfigurator();

    const manager = new AgentManager(configurator, "unregistered-kind");

    expect(manager.getActiveAgent()).toBeInstanceOf(NullAgent);
  });
});
