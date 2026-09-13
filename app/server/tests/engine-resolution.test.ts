import { describe, expect, test } from "vitest";
import { resolveEnginePolicy } from "../src/engine/resolveEnginePolicy.js";

const route = (engine: "hermes" | "codex" | "claude-code", configuration = "default") => ({
  engine, configuration, billingMode: "subscription" as const
});

describe("resolveEnginePolicy", () => {
  test("resolves task > workflow > agent > global and captures every version", () => {
    const result = resolveEnginePolicy({
      global: { policy: { primary: route("hermes", "g") }, version: 1 },
      agent: { policy: { primary: { configuration: "a" } }, version: 2 },
      workflow: { policy: { primary: { engine: "codex" } }, version: 3 },
      task: { policy: { primary: { model: "o4-mini" } }, version: null }
    });
    expect(result.primary).toEqual({ engine: "codex", configuration: "a", model: "o4-mini", billingMode: "subscription" });
    expect(result.source).toBe("task");
    expect(result.configurationVersions).toEqual({ task: null, workflow: 3, agent: 2, global: 1 });
  });

  test("does not concatenate fallback chains and keeps fallback disabled by default", () => {
    const result = resolveEnginePolicy({
      global: { policy: { primary: route("hermes"), fallbacks: [route("codex")], fallbackEnabled: true }, version: 1 },
      workflow: { policy: { fallbacks: [route("claude-code")], fallbackEnabled: false }, version: 2 }
    });
    expect(result.fallbacks).toEqual([]);
  });
});
