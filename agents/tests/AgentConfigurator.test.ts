import { describe, expect, test } from "vitest";
import { AgentConfigurator } from "../src/AgentConfigurator.js";
import { FakeAgent } from "../src/strategies/FakeAgent.js";
import { NullAgent } from "../src/strategies/NullAgent.js";

describe("AgentConfigurator", () => {
  test("resolves a registered strategy by kind", () => {
    const configurator = new AgentConfigurator();
    const fake = new FakeAgent();
    configurator.register(fake.getInfo().kind, fake);

    expect(configurator.resolve("fake")).toBe(fake);
  });

  test("falls back to NullAgent when the requested kind is not registered", () => {
    const configurator = new AgentConfigurator();

    const resolved = configurator.resolve("unregistered-kind");

    expect(resolved).toBeInstanceOf(NullAgent);
  });

  test("getFallback exposes the same NullAgent instance resolve() falls back to", () => {
    const configurator = new AgentConfigurator();

    const fallback = configurator.getFallback();
    const resolved = configurator.resolve("some-unregistered-kind");

    expect(fallback).toBeInstanceOf(NullAgent);
    expect(fallback).toBe(resolved);
  });
});
