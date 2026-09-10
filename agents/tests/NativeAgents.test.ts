import { describe, expect, test } from "vitest";
import { ClaudeCodeAgent, CodexAgent } from "@aios/agents";
import { FakeNativeProcessRunner } from "./native/FakeNativeProcessRunner.js";

const route = (engine: "codex" | "claude-code") => ({ engine, configuration: "named", billingMode: "subscription" as const });

describe("native engine adapters", () => {
  test("Codex emits JSON events, captures native ID, and uses safe argv", async () => {
    const runner = new FakeNativeProcessRunner(['{"thread_id":"thread-1","text":"hello"}']);
    const agent = new CodexAgent(route("codex"), { runner, workingRoot: "D:/safe-root" });
    expect((await agent.checkReadiness()).state).toBe("ready");
    const chunks: string[] = [];
    for await (const chunk of agent.runTask("inspect")) chunks.push(chunk);
    expect(chunks).toEqual(["hello", "final output"]);
    expect(runner.calls[0]).toEqual({ executable: "codex", argv: ["exec", "--json", "--profile", "named", "--sandbox", "workspace-write", "--cd", "D:/safe-root", "inspect"] });
    expect(agent.getNativeSessionId()).toBe("thread-1");
    expect(runner.calls[0]?.argv).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("Claude Code uses stream-json and permission mode without bypass flags", async () => {
    const runner = new FakeNativeProcessRunner(['{"session_id":"session-1","result":"hello"}']);
    const agent = new ClaudeCodeAgent(route("claude-code"), { runner, workingRoot: "D:/safe-root" });
    const chunks: string[] = [];
    for await (const chunk of agent.runTask("inspect")) chunks.push(chunk);
    expect(chunks).toEqual(["hello", "final output"]);
    expect(runner.calls[0]?.argv).toContain("stream-json");
    expect(runner.calls[0]?.argv).toContain("--permission-mode");
    expect(runner.calls[0]?.argv).not.toContain("--dangerously-skip-permissions");
    expect(agent.getNativeSessionId()).toBe("session-1");
  });

  test("malformed events fail closed and cancel the child", async () => {
    const runner = new FakeNativeProcessRunner(["not-json"]);
    const agent = new CodexAgent(route("codex"), { runner });
    await expect((async () => { for await (const _ of agent.runTask("inspect")) { /* drain */ } })()).rejects.toThrow("malformed");
    expect(runner.cancelled).toBe(1);
  });
});
