import { describe, expect, test } from "vitest";
import { CustomAgent } from "../src/strategies/CustomAgent.js";

describe("CustomAgent", () => {
  test("reports itself as a custom agent that is healthy", () => {
    const agent = new CustomAgent();

    expect(agent.getInfo()).toEqual({
      id: "custom",
      kind: "custom",
      displayName: "Custom Agent"
    });
    expect(agent.checkHealth()).toEqual({ ok: true });
  });

  test("streams a deterministic task response then completes", async () => {
    const agent = new CustomAgent();

    const chunks: string[] = [];
    for await (const chunk of agent.runTask("do the thing", "session-1")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["Custom agent handled: do the thing"]);
  });

  test("does not orchestrate", () => {
    const agent = new CustomAgent();

    expect(agent.asOrchestrator()).toBeNull();
  });
});
