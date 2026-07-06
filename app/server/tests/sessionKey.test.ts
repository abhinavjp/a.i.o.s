import { describe, expect, test } from "vitest";
import { computeSessionKey } from "../src/sessionKey.js";

describe("computeSessionKey", () => {
  test("is deterministic for the same inputs", () => {
    const a = computeSessionKey("default-operator", "default");
    const b = computeSessionKey("default-operator", "default");

    expect(a).toBe(b);
  });

  test("differs for different inputs", () => {
    const a = computeSessionKey("default-operator", "default");
    const b = computeSessionKey("other-operator", "default");
    const c = computeSessionKey("default-operator", "other-project");

    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});
