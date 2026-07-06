import { describe, expect, test } from "vitest";
import { NullAgent } from "../src/strategies/NullAgent.js";

describe("NullAgent", () => {
  test("reports no agent available and is never healthy", () => {
    const agent = new NullAgent();

    expect(agent.getInfo()).toEqual({
      id: "null",
      kind: "null",
      displayName: "No Agent Available"
    });
    expect(agent.checkHealth()).toEqual({ ok: false, reason: "no agent available" });
  });

  test("degrades gracefully by streaming a single notice instead of throwing", async () => {
    const agent = new NullAgent();

    const chunks: string[] = [];
    for await (const chunk of agent.runTask("do the thing", "session-1")) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(["no agent available"]);
  });

  test("does not orchestrate", () => {
    const agent = new NullAgent();

    expect(agent.asOrchestrator()).toBeNull();
  });
});
