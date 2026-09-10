import { describe, expect, test } from "vitest";
import { EngineRegistry, FakeAgent } from "@aios/agents";

describe("EngineRegistry", () => {
  test("accepts exactly the three built-in engines and rejects arbitrary kinds", () => {
    const registry = new EngineRegistry();
    registry.registerAgent("hermes", new FakeAgent());
    registry.registerAgent("codex", new FakeAgent());
    registry.registerAgent("claude-code", new FakeAgent());
    expect(registry.kinds()).toEqual(["hermes", "codex", "claude-code"]);
    expect(() => registry.register("custom" as never, () => new FakeAgent())).toThrow("unknown engine");
  });
});
