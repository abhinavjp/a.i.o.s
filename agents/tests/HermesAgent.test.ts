import { describe, expect, test } from "vitest";
import { HermesAgent } from "../src/strategies/HermesAgent.js";
import { FakeProcessRunner } from "./hermes/FakeProcessRunner.js";

describe("HermesAgent", () => {
  test("reports itself as the hermes agent", () => {
    const agent = new HermesAgent(new FakeProcessRunner());

    expect(agent.getInfo()).toEqual({
      id: "hermes",
      kind: "hermes",
      displayName: "Hermes"
    });
  });

  test("declares the hermes-kanban orchestrator capability", () => {
    const agent = new HermesAgent(new FakeProcessRunner());

    expect(agent.asOrchestrator()).toEqual({ kind: "hermes-kanban" });
  });

  describe("checkHealth", () => {
    test("defaults to ok optimistically before the first async check resolves", () => {
      const runner = new FakeProcessRunner({ versionResult: false });
      const agent = new HermesAgent(runner);

      expect(agent.checkHealth()).toEqual({ ok: true });
    });

    test("reflects the runner's checkVersion result on a later call once the background check resolves", async () => {
      const runner = new FakeProcessRunner({ versionResult: false });
      const agent = new HermesAgent(runner);

      agent.checkHealth();
      // allow the fire-and-forget background recheck to resolve
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(agent.checkHealth()).toEqual({
        ok: false,
        reason: "hermes --version check failed"
      });
    });

    test("reflects a healthy result once the background check resolves true", async () => {
      const runner = new FakeProcessRunner({ versionResult: true });
      const agent = new HermesAgent(runner);

      agent.checkHealth();
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(agent.checkHealth()).toEqual({ ok: true });
    });
  });

  describe("warmUpHealth", () => {
    test("awaits the real check and updates the cache before resolving, so a subsequent synchronous checkHealth() is accurate", async () => {
      const runner = new FakeProcessRunner({ versionResult: false });
      const agent = new HermesAgent(runner);

      const result = await agent.warmUpHealth();

      expect(result).toEqual({ ok: false, reason: "hermes --version check failed" });
      // no setTimeout(0) flush needed here -- warmUpHealth itself awaited the
      // real check, unlike checkHealth()'s fire-and-forget background probe.
      expect(agent.checkHealth()).toEqual({ ok: false, reason: "hermes --version check failed" });
    });

    test("resolves ok when the runner reports a healthy version check", async () => {
      const runner = new FakeProcessRunner({ versionResult: true });
      const agent = new HermesAgent(runner);

      const result = await agent.warmUpHealth();

      expect(result).toEqual({ ok: true });
    });
  });

  describe("runTask", () => {
    test("yields tailed log lines in order, then the final stdout text, then completes", async () => {
      const runner = new FakeProcessRunner({
        logLines: ["line one", "line two", "line three"],
        oneShotResult: { kind: "resolve", value: "final answer" }
      });
      const agent = new HermesAgent(runner);

      const chunks: string[] = [];
      for await (const chunk of agent.runTask("do the thing", "session-1")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["line one", "line two", "line three", "final answer"]);
      expect(runner.stopCallCount).toBe(1);
    });

    test("does not drop a log line that arrives asynchronously while runOneShot is still pending", async () => {
      // runOneShot resolves only after a macrotask delay (10ms), while the
      // late line is scheduled via its own setTimeout(0) inside tailLogs.
      // That means: tailLogs() returns synchronously with no lines yet,
      // runOneShot() is called and is in-flight, THEN the late line fires,
      // THEN (much later) runOneShot resolves. A generator that only drains
      // a pre-populated array (rather than genuinely waiting on the queue
      // via the pendingResolver/wake() mechanism) would race past the empty
      // queue and either hang forever or resolve with the line dropped.
      const runner = new FakeProcessRunner({
        lateLines: ["late line arrives mid-flight"],
        oneShotResult: { kind: "resolve", value: "final answer" },
        oneShotDelayMs: 10
      });
      const agent = new HermesAgent(runner);

      const chunks: string[] = [];
      for await (const chunk of agent.runTask("do the thing", "session-1")) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(["late line arrives mid-flight", "final answer"]);
      expect(runner.stopCallCount).toBe(1);
    });

    test("stops tailing logs once the one-shot task resolves", async () => {
      const runner = new FakeProcessRunner({
        logLines: ["a line"],
        oneShotResult: { kind: "resolve", value: "done" }
      });
      const agent = new HermesAgent(runner);

      for await (const _chunk of agent.runTask("task", "session-1")) {
        // drain
      }

      expect(runner.stopCallCount).toBe(1);
    });

    test("propagates an error when the hermes CLI is unavailable", async () => {
      const runner = new FakeProcessRunner({
        oneShotResult: { kind: "reject", error: new Error("hermes not found") }
      });
      const agent = new HermesAgent(runner);

      const drain = async () => {
        const chunks: string[] = [];
        for await (const chunk of agent.runTask("task", "session-1")) {
          chunks.push(chunk);
        }
        return chunks;
      };

      await expect(drain()).rejects.toThrow("hermes not found");
      expect(runner.stopCallCount).toBe(1);
    });
  });
});
