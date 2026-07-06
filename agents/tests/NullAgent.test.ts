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
});
