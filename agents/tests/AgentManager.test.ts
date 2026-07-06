import type {
  AgentAbstraction,
  AgentInfo,
  HealthStatus,
  OrchestratorCapability,
  TaskStream
} from "@aios/contracts";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentManager } from "../src/AgentManager.js";
import { AgentConfigurator } from "../src/AgentConfigurator.js";
import { CustomAgent } from "../src/strategies/CustomAgent.js";
import { FakeAgent } from "../src/strategies/FakeAgent.js";
import { NullAgent } from "../src/strategies/NullAgent.js";

/** Test-only double whose checkHealth() result is controlled by the test. */
class TestDoubleAgent implements AgentAbstraction {
  constructor(private readonly health: HealthStatus) {}

  getInfo(): AgentInfo {
    return { id: "broken", kind: "broken", displayName: "Broken Agent" };
  }

  checkHealth(): HealthStatus {
    return this.health;
  }

  runTask(task: string, sessionKey: string): TaskStream {
    return (async function* (): TaskStream {
      yield "unused";
    })();
  }

  asOrchestrator(): OrchestratorCapability | null {
    return null;
  }
}

describe("AgentManager", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

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

  test("falls back to the Configurator's fallback when the resolved agent is unhealthy, and warns", () => {
    const configurator = new AgentConfigurator();
    configurator.register("broken", new TestDoubleAgent({ ok: false, reason: "simulated down" }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const manager = new AgentManager(configurator, "broken");

    expect(manager.getActiveAgent()).toBeInstanceOf(NullAgent);
    expect(manager.getActiveAgent()).toBe(configurator.getFallback());
    expect(warnSpy).toHaveBeenCalled();
  });

  test("uses the resolved agent as-is when it is healthy, without warning", () => {
    const configurator = new AgentConfigurator();
    const healthy = new TestDoubleAgent({ ok: true });
    configurator.register("healthy", healthy);
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const manager = new AgentManager(configurator, "healthy");

    expect(manager.getActiveAgent()).toBe(healthy);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  // BYOA proof point: switching the config enum to a custom strategy works
  // through the exact same AgentManager constructor/API, with no special-casing
  // required to support a different concrete agent implementation.
  test("supports bring-your-own-agent by registering CustomAgent under a new kind", () => {
    const configurator = new AgentConfigurator();
    const custom = new CustomAgent();
    configurator.register("custom", custom);

    const manager = new AgentManager(configurator, "custom");

    expect(manager.getActiveAgent()).toBe(custom);
  });
});
