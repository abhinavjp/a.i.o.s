import { describe, expect, test } from "vitest";
import { FakeAgent } from "../src/strategies/FakeAgent.js";

describe("FakeAgent", () => {
  test("reports itself as a fake agent that is healthy", () => {
    const agent = new FakeAgent();

    expect(agent.getInfo()).toEqual({
      id: "fake",
      kind: "fake",
      displayName: "Fake Agent"
    });
    expect(agent.checkHealth()).toEqual({ ok: true });
  });
});
