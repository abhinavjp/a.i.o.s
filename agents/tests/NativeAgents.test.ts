import { describe, expect, test } from "vitest";
import { ClaudeCodeAgent, CodexAgent } from "@aios/agents";
import { FakeNativeProcessRunner } from "./native/FakeNativeProcessRunner.js";

const route = (engine: "codex" | "claude-code") => ({ engine, configuration: "named", billingMode: "subscription" as const });

describe("native engine adapters", () => {
  test("Codex emits JSON events, captures native ID, and uses safe argv", async () => {
    const runner = new FakeNativeProcessRunner(['{"type":"thread.started","thread_id":"thread-1"}', '{"type":"item.completed","item":{"type":"agent_message","text":"hello"}}']);
    const agent = new CodexAgent(route("codex"), { runner, workingRoot: "D:/safe-root", readinessProbe: readyProbe });
    expect((await agent.checkReadiness()).state).toBe("ready");
    const chunks: string[] = [];
    for await (const chunk of agent.runTask("inspect")) chunks.push(chunk);
    expect(chunks).toEqual(["hello", "final output"]);
    expect(runner.calls[0]).toMatchObject({ executable: "codex", argv: ["exec", "--json", "--profile", "named", "--sandbox", "workspace-write", "--cd", "D:/safe-root", "inspect"] });
    expect(agent.getNativeSessionId()).toBe("thread-1");
    expect(runner.calls[0]?.argv).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  test("Codex passes the resolved model for new and resumed sessions", async () => {
    const runner = new FakeNativeProcessRunner(['{"thread_id":"thread-1"}']);
    const agent = new CodexAgent({ ...route("codex"), model: "gpt-5" }, { runner, workingRoot: "D:/safe-root", readinessProbe: readyProbe });
    for await (const _ of agent.runTask("first")) { /* drain */ }
    for await (const _ of agent.runTask("second")) { /* drain */ }
    expect(runner.calls[0]?.argv).toContain("-m");
    expect(runner.calls[0]?.argv).toContain("gpt-5");
    expect(runner.calls[1]?.argv).toContain("-m");
    expect(runner.calls[1]?.argv).toContain("gpt-5");
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

  test("keeps executable-only native readiness unmeasured until a qualified proof passes", async () => {
    const runner = new FakeNativeProcessRunner();
    const codex = new CodexAgent(route("codex"), { runner });
    expect((await codex.checkReadiness()).state).toBe("unmeasured");
    expect((await new CodexAgent(route("codex"), { runner, readinessProbe: readyProbe }).checkReadiness()).state).toBe("ready");
  });

  test("Claude Code readiness is proven by an authenticated `claude auth status`", async () => {
    const loggedIn = new FakeNativeProcessRunner();
    expect((await new ClaudeCodeAgent(route("claude-code"), { runner: loggedIn }).checkReadiness()).state).toBe("ready");
    expect(loggedIn.checks.map((c) => c.argv)).toContainEqual(["auth", "status"]);

    const loggedOut = new FakeNativeProcessRunner([], "s", (argv) => argv[0] !== "auth");
    const readiness = await new ClaudeCodeAgent(route("claude-code"), { runner: loggedOut }).checkReadiness();
    expect(readiness.state).toBe("unavailable");
    expect(readiness.reason).toContain("claude auth login");
  });

  test("Claude Code only passes --settings for a real settings file and keeps the user's login", async () => {
    const plain = new FakeNativeProcessRunner();
    for await (const _ of new ClaudeCodeAgent({ engine: "claude-code", configuration: "default", billingMode: "subscription" }, { runner: plain }).runTask("x")) { /* drain */ }
    expect(plain.calls[0]?.argv).not.toContain("--settings");
    expect(plain.calls[0]?.options?.env?.CLAUDE_CONFIG_DIR).toBe(process.env.CLAUDE_CONFIG_DIR);
    expect(plain.calls[0]?.options?.stdio).toEqual(["ignore", "pipe", "pipe"]);

    const file = new FakeNativeProcessRunner();
    for await (const _ of new ClaudeCodeAgent({ engine: "claude-code", configuration: "D:/cfg/reviewer.json", billingMode: "subscription" }, { runner: file }).runTask("x")) { /* drain */ }
    expect(file.calls[0]?.argv).toContain("D:/cfg/reviewer.json");
  });

  test("Claude Code error results fail the task instead of streaming as output", async () => {
    const runner = new FakeNativeProcessRunner(['{"type":"result","is_error":true,"result":"Failed to authenticate","session_id":"s"}']);
    const agent = new ClaudeCodeAgent(route("claude-code"), { runner });
    await expect((async () => { for await (const _ of agent.runTask("x")) { /* drain */ } })()).rejects.toThrow("Failed to authenticate");
  });

  test("isolates native roots by agent identity and passes Claude model with a unique session", async () => {
    const firstRunner = new FakeNativeProcessRunner();
    const secondRunner = new FakeNativeProcessRunner();
    const first = new ClaudeCodeAgent({ ...route("claude-code"), model: "claude-sonnet" }, { runner: firstRunner, agentId: "reviewer/a" });
    const second = new ClaudeCodeAgent({ ...route("claude-code"), model: "claude-sonnet" }, { runner: secondRunner, agentId: "reviewer?a" });
    for await (const _ of first.runTask("first")) { /* drain */ }
    for await (const _ of second.runTask("second")) { /* drain */ }
    expect(firstRunner.calls[0]?.argv).toContain("--model");
    expect(firstRunner.calls[0]?.argv).toContain("claude-sonnet");
    const firstSession = firstRunner.calls[0]?.argv[firstRunner.calls[0]!.argv.indexOf("--session-id") + 1];
    const secondSession = secondRunner.calls[0]?.argv[secondRunner.calls[0]!.argv.indexOf("--session-id") + 1];
    expect(firstSession).not.toBe("sarathi-session");
    expect(firstSession).not.toBe(secondSession);
    const isolated = new FakeNativeProcessRunner();
    for await (const _ of new ClaudeCodeAgent(route("claude-code"), { runner: isolated, configRoot: "D:/iso" }).runTask("x")) { /* drain */ }
    expect(isolated.calls[0]?.options?.env?.CLAUDE_CONFIG_DIR).toBe("D:/iso");
  });

  test("malformed events fail closed and cancel the child", async () => {
    const runner = new FakeNativeProcessRunner(["not-json"]);
    const agent = new CodexAgent(route("codex"), { runner });
    await expect((async () => { for await (const _ of agent.runTask("inspect")) { /* drain */ } })()).rejects.toThrow("malformed");
    expect(runner.cancelled).toBe(1);
  });
});

const readyProbe = async () => ({ state: "ready", reason: "qualified test proof", checkedAt: "now" } as const);
