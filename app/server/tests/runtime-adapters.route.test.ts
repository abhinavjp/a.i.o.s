import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import type { NativeCliEvent, NativeCliInvocation, NativeCliRunner, ToolLoopProvider, ToolLoopProviderEvent, ToolLoopProviderInput } from "../src/sarathi/RuntimeAdapters.js";
import { ClaudeSubscriptionRuntimeAdapter, CodexSubscriptionRuntimeAdapter, AiSdkToolLoopRuntimeAdapter } from "../src/sarathi/RuntimeAdapters.js";
import type { ResolvedRoute, RoutedExecutionInput, RuntimeUsage, ToolIntent } from "@aios/contracts";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";

const tools = { definitions: [{ tool: "files", operations: ["read"] as const, idempotent: true }], execute: async () => ({ output: "contents" }) };
const usage: RuntimeUsage = { inputTokens: 11, cachedInputTokens: 2, reasoningTokens: 3, outputTokens: 7, cost: "unknown", costKind: "unknown" };
const intent: ToolIntent = { tool: "files", operation: "read", target: "notes.md", context: {} };
const resources: Array<() => Promise<void>> = [];

afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); });

function manager(): AgentManager {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

async function appWith(route: ResolvedRoute, adapter: object, provider: string) {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-runtime-adapter-"));
  resources.push(() => rm(directory, { recursive: true, force: true }));
  const app = buildApp(manager(), {
    taskStore: new FileTaskStore(join(directory, "tasks.json")),
    sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")),
    permissionTools: tools,
    runtimeAdapters: [{ runtime: route.runtime, adapter: adapter as any }],
    providerCatalogAdapters: [{ provider, discover: async () => ({ authenticationMode: route.billingMode === "subscription" ? "subscription" as const : "environment-reference" as const,
      provenance: "test fixture", observedAt: new Date().toISOString(), completeness: "complete" as const,
      models: [{ model: route.model, enabled: true, configured: true, qualification: { health: "qualified" as const, streaming: "qualified" as const, structuredOutput: "qualified" as const, toolCalling: "qualified" as const } }] }) }]
  });
  resources.push(() => app.close());
  await app.ready();
  return app;
}

describe("provider runtime adapters through the public app boundary", () => {
  test("Codex normalizes progress, mediated tools, usage, resume and attribution with restrictive native permissions", async () => {
    let invocation: NativeCliInvocation | undefined;
    const runner: NativeCliRunner = {
      run: async function* (_input, next) {
        invocation = next;
        yield { type: "resume", metadata: { nativeSessionId: "codex-session" } };
        yield { type: "progress", text: "codex output" };
        yield { type: "tool-call", intent, providerToolCallId: "call-1" };
        yield { type: "usage", usage, attribution: { providerRequestId: "req-1", clientRequestId: "client-1" } };
        yield { type: "terminal", outcome: { status: "completed" } };
      }
    };
    const route: ResolvedRoute = { runtime: "codex", provider: "codex", model: "codex-model", billingMode: "subscription" };
    const app = await appWith(route, new CodexSubscriptionRuntimeAdapter({ runner }), route.provider);
    const created = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "codex task", routePolicy: { primary: route } } });
    expect(created.statusCode).toBe(202);
    const taskId = created.json().taskId;
    let result: any;
    for (let i = 0; i < 30; i++) {
      result = (await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json();
      if (result.outcome) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(result).toMatchObject({ status: "completed", chunks: ["codex output"], outcome: { usage, attribution: { providerRequestId: "req-1" } } });
    expect(result.attempts[0]).toMatchObject({ resumeMetadata: { nativeSessionId: "codex-session" }, usage, attribution: { clientRequestId: "client-1" } });
    expect(result.attempts[0].events.map((event: any) => event.type)).toEqual(["resume", "progress", "tool-intent", "tool-result", "usage", "terminal"]);
    expect(result.canonicalHistory.filter((event: any) => event.type === "tool-result")).toHaveLength(1);
    expect(invocation).toMatchObject({ command: "codex", model: "codex-model", nativePermissions: { sandbox: "read-only", permissionMode: "restricted", allowedTools: [] } });
    expect(invocation?.args).toEqual(["exec", "--json", "--sandbox", "read-only", "--model", "codex-model"]);
  });

  test("Claude missing executable or entitlement is explicitly UNMEASURED", async () => {
    const route: ResolvedRoute = { runtime: "claude-cli", provider: "claude", model: "claude-model", billingMode: "subscription" };
    const app = await appWith(route, new ClaudeSubscriptionRuntimeAdapter(), route.provider);
    const created = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "claude task", routePolicy: { primary: route } } });
    expect(created.statusCode).toBe(202);
    const taskId = created.json().taskId;
    let result: any;
    for (let i = 0; i < 30; i++) {
      result = (await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json();
      if (result.outcome) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(result.outcome).toMatchObject({ status: "unavailable", message: expect.stringContaining("UNMEASURED") });
  });

  test("provider-neutral AI SDK loop exposes tool request/result, never enables provider retries, and preserves identifiers", async () => {
    const seen: ToolLoopProviderInput[] = [];
    const provider: ToolLoopProvider = {
      stream: async function* (input: ToolLoopProviderInput): AsyncIterable<ToolLoopProviderEvent> {
        seen.push(input);
        yield { type: "text", text: "model text" };
        yield { type: "tool-call", intent, providerToolCallId: "sdk-call" };
        yield { type: "usage", usage, attribution: { providerRequestId: "sdk-request" } };
        yield { type: "terminal", outcome: { status: "completed" } };
      }
    };
    const route: ResolvedRoute = { runtime: "ai-sdk", provider: "fake-sdk", model: "sdk-model", billingMode: "api" };
    const app = await appWith(route, new AiSdkToolLoopRuntimeAdapter({ provider, tools: tools.definitions }), route.provider);
    const created = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "sdk task", routePolicy: { primary: route } } });
    expect(created.statusCode).toBe(202);
    const taskId = created.json().taskId;
    let result: any;
    for (let i = 0; i < 30; i++) {
      result = (await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json();
      if (result.outcome) break;
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    expect(result).toMatchObject({ status: "completed", outcome: { usage, attribution: { providerRequestId: "sdk-request" } } });
    expect(result.chunks).toEqual(["model text"]);
    expect(result.attempts[0].events.map((event: any) => event.type)).toEqual(["progress", "tool-intent", "tool-result", "usage", "terminal"]);
    expect(seen[0]).toMatchObject({ model: "sdk-model", retryPolicy: { maxRetries: 0 }, tools: tools.definitions });
  });
});
