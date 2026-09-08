import { mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import type { ResolvedRoute, RuntimeRouter, ToolIntent } from "@aios/contracts";
import { buildApp, type BuildAppOptions } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { RouteResilience } from "../src/sarathi/RouteResilience.js";

const root = "/api/agents/active/tasks";
const primary: ResolvedRoute = { runtime: "fake", provider: "test", model: "primary", billingMode: "fake" };
const fallback: ResolvedRoute = { ...primary, model: "fallback" };
const readIntent: ToolIntent = { tool: "files", operation: "read", target: "notes.md", context: {} };
const resources: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); });

class ControlledClock {
  time = Date.parse("2026-09-07T00:00:00Z");
  delays: number[] = [];
  now = () => this.time;
  random = () => 0.5;
  sleep = async (ms: number, signal: AbortSignal) => {
    signal.throwIfAborted();
    this.delays.push(ms);
    this.time += ms;
  };
}

async function fixture(router: RuntimeRouter, extra: BuildAppOptions = {}) {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-lifecycle-"));
  resources.push(() => rm(directory, { recursive: true, force: true }));
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  const manager = new AgentManager(configurator, "fake");
  const clock = new ControlledClock();
  const taskPath = join(directory, "tasks.json");
  const sarathiPath = join(directory, "sarathi.json");
  const create = (runtimeRouter = router) => {
    const app = buildApp(manager, {
      taskStore: new FileTaskStore(taskPath, clock.now), sarathiStore: new FileSarathiStore(sarathiPath),
      runtimeRouter, runtimeClock: clock, ...extra
    });
    resources.push(() => app.close());
    return app;
  };
  const app = create();
  const submit = (fallbacks = [fallback]) => app.inject({ method: "POST", url: root,
    payload: { task: "canonical work", routePolicy: { primary, fallbacks } } });
  const get = async (id: string) => (await app.inject({ method: "GET", url: `${root}/${id}` })).json();
  const done = async (id: string) => {
    let result: any;
    await vi.waitFor(async () => { result = await get(id); expect(result.outcome).not.toBeNull(); });
    return result;
  };
  return { app, submit, get, done, create, clock, taskPath };
}

describe("durable runtime lifecycle through Fastify", () => {
  test("reconstructs canonical conversation and tool authority after losing runtime-private state", async () => {
    const f = await fixture({ async *run(input) {
      yield { type: "resume", metadata: { nativeSessionId: "optional-session" } };
      yield { type: "progress", text: "partial answer" };
      await input.executeTool(readIntent);
      yield { type: "terminal", outcome: { status: "completed" } };
    } }, { permissionTools: { definitions: [{ tool: "files", operations: ["read"] }],
      execute: async () => ({ output: "durable file contents" }) } });
    const id = (await f.submit()).json().taskId;
    const before = await f.done(id);
    expect(before.canonicalHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "message", role: "user", text: "canonical work" }),
      expect.objectContaining({ type: "message", role: "assistant", text: "partial answer" }),
      expect.objectContaining({ type: "tool-intent", intent: readIntent }),
      expect.objectContaining({ type: "permission-decision", decision: { outcome: "allowed", reason: "deterministic safe/read-only" } }),
      expect.objectContaining({ type: "tool-result", result: expect.objectContaining({ output: "durable file contents" }) }),
      expect.objectContaining({ type: "attempt-started" }), expect.objectContaining({ type: "attempt-finished" }),
      expect.objectContaining({ type: "outcome", outcome: { status: "completed" } })
    ]));
    expect(before.attempts[0].resumeMetadata).toEqual({ nativeSessionId: "optional-session" });
    await f.app.close();
    const restarted = f.create({ async *run() { throw new Error("private state absent"); } });
    const recovered = (await restarted.inject({ method: "GET", url: `${root}/${id}` })).json();
    expect(recovered.canonicalHistory).toEqual(before.canonicalHistory);
    expect(recovered.chunks).toEqual(["partial answer"]);
  });

  test("exhausts exactly two Sarathi retries, then falls back with persisted boundaries and completed tools", async () => {
    let calls = 0;
    let effects = 0;
    const seenKeys: string[] = [];
    const f = await fixture({ async *run(input) {
      calls++;
      expect(input.retryPolicy).toEqual({ maxRetries: 0 });
      if (input.plan.route.model === "primary") {
        await input.executeTool(readIntent);
        yield { type: "terminal", outcome: { status: "failed", failure: { kind: "transient" } } };
      } else {
        // Input history is the durable continuation, independent of a provider session.
        const durable = JSON.parse(readFileSync(f.taskPath, "utf8")).find((task: any) => task.taskId === input.taskId);
        expect(durable.attempts).toHaveLength(4);
        expect(input.canonicalHistory.filter((event) => event.type === "attempt-finished")).toHaveLength(3);
        expect(input.canonicalHistory).toContainEqual(expect.objectContaining({ type: "tool-result", result: expect.objectContaining({ output: "already read" }) }));
        await input.executeTool(readIntent);
        yield { type: "progress", text: "continued on fallback" };
        yield { type: "terminal", outcome: { status: "completed" } };
      }
    } }, { permissionTools: { definitions: [{ tool: "files", operations: ["read"], idempotent: true }],
      execute: async (_intent, options) => { effects++; seenKeys.push(options!.idempotencyKey); return { output: "already read" }; } } });
    const id = (await f.submit()).json().taskId;
    const result = await f.done(id);
    expect(result.status).toBe("completed");
    expect(calls).toBe(4);
    expect(effects).toBe(1);
    expect(seenKeys[0]).toMatch(/^sarathi:/);
    expect(f.clock.delays).toEqual([125, 250]);
    expect(result.resolvedExecutionPlan.route.model).toBe("primary");
    expect(result.attempts.map((a: any) => a.route.model)).toEqual(["primary", "primary", "primary", "fallback"]);
    const dashboard = (await f.app.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json();
    expect(dashboard.recentTasks[0]).toMatchObject({ retryCount: 2, fallbackCount: 1, runtime: "fake" });
    expect(dashboard.routeCircuits[0]).toMatchObject({ state: "open", failureKind: "transient", consecutiveFailures: 3 });
  });

  test.each(["authentication", "configuration", "capability", "input", "quota"] as const)("fails %s immediately without fallback", async (kind) => {
    let calls = 0;
    const f = await fixture({ async *run() { calls++; yield { type: "terminal", outcome: { status: "failed", failure: { kind } } }; } });
    const result = await f.done((await f.submit()).json().taskId);
    expect(result.status).toBe("failed");
    expect(calls).toBe(1);
    expect(f.clock.delays).toEqual([]);
  });

  test("opens a durable transient circuit for 60 seconds and rechecks it at route selection", async () => {
    const f = await fixture({ async *run() { yield { type: "terminal", outcome: { status: "failed", failure: { kind: "transient" } } }; } });
    await f.done((await f.submit([])).json().taskId);
    expect((await f.submit([])).statusCode).toBe(400);
    await f.app.close();
    const restarted = f.create();
    const request = () => restarted.inject({ method: "POST", url: root, payload: { task: "after restart", routePolicy: { primary, fallbacks: [] } } });
    expect((await request()).statusCode).toBe(400);
    f.clock.time += 59_999;
    expect((await request()).statusCode).toBe(400);
    f.clock.time += 1;
    expect((await request()).statusCode).toBe(202);
  });

  test("authentication circuit requires configuration repair or an actual successful probe", async () => {
    let healthy = false;
    const f = await fixture({ probe: async () => healthy, async *run() {
      yield { type: "terminal", outcome: { status: "failed", failure: { kind: "authentication" } } };
    } });
    await f.done((await f.submit([])).json().taskId);
    f.clock.time += 10_000_000;
    expect((await f.submit([])).statusCode).toBe(400);
    const probe = () => f.app.inject({ method: "POST", url: "/api/sarathi/routing/circuits/probe", payload: { route: primary } });
    expect((await probe()).json().recovered).toBe(false);
    expect((await f.submit([])).statusCode).toBe(400);
    healthy = true;
    expect((await probe()).json().recovered).toBe(true);
    await f.done((await f.submit([])).json().taskId);
    await f.app.inject({ method: "PUT", url: "/api/sarathi/routing/policies/global", payload: { primary } });
    expect((await f.submit([])).statusCode).toBe(202);
  });

  test("quota circuit waits for a provider-reported reset", async () => {
    const f = await fixture({ async *run() {
      yield { type: "terminal", outcome: { status: "failed", failure: { kind: "quota", resetAt: "2026-09-07T00:02:00.000Z" } } };
    } });
    await f.done((await f.submit([])).json().taskId);
    f.clock.time += 119_999;
    expect((await f.submit([])).statusCode).toBe(400);
    f.clock.time += 1;
    expect((await f.submit([])).statusCode).toBe(202);
  });

  test.each(["send", "read_and_send"])("blocks uncertain %s effects before any retry or fallback", async (operation) => {
    let effects = 0;
    let calls = 0;
    const intent = { tool: "messages", operation, target: "approved-destination", context: {} };
    const f = await fixture({ async *run(input) {
      calls++;
      await input.executeTool(intent);
      yield { type: "terminal", outcome: { status: "failed", failure: { kind: "transient" } } };
    } }, { permissionTools: { definitions: [{ tool: "messages", operations: [operation] }],
      execute: async () => { effects++; throw new Error("connection lost after send"); } } });
    await f.app.inject({ method: "POST", url: "/api/sarathi/permissions/approvals", payload: { intent, lifetime: "once" } });
    const id = (await f.submit()).json().taskId;
    const result = await f.done(id);
    expect(result.status).toBe("blocked");
    expect(result.outcome.message).toMatch(/reconciliation/i);
    expect(effects).toBe(1);
    expect(calls).toBe(1);
    const recovered = new FileTaskStore(f.taskPath).get(id)!;
    expect(recovered.canonicalHistory).toContainEqual(expect.objectContaining({ type: "tool-result", result: expect.objectContaining({ effect: "uncertain" }) }));
  });

  test("cancels the active stream, waits for cleanup, preserves partial output, and never falls back", async () => {
    let cleaned = false;
    let calls = 0;
    const f = await fixture({ async *run(input) {
      calls++;
      try {
        yield { type: "progress", text: "partial output" };
        await new Promise<void>((resolve) => input.signal.addEventListener("abort", () => resolve(), { once: true }));
        // An adapter attempting success after cancellation cannot override stop intent.
        yield { type: "terminal", outcome: { status: "completed" } };
      } finally { cleaned = true; }
    } });
    const id = (await f.submit()).json().taskId;
    await vi.waitFor(async () => expect((await f.get(id)).chunks).toEqual(["partial output"]));
    const cancelled = await f.app.inject({ method: "POST", url: `${root}/${id}/cancel` });
    expect(cancelled.statusCode).toBe(200);
    expect(cleaned).toBe(true);
    const result = await f.done(id);
    expect(result.status).toBe("cancelled");
    expect(result.attempts).toHaveLength(1);
    expect(result.chunks).toEqual(["partial output"]);
    expect(calls).toBe(1);
    expect((await f.app.inject({ method: "POST", url: `${root}/${id}/cancel` })).statusCode).toBe(200);
    expect((await f.app.inject({ method: "POST", url: `${root}/absent/cancel` })).statusCode).toBe(404);
    await f.app.close();
    expect((await f.create().inject({ method: "GET", url: `${root}/${id}` })).json().status).toBe("cancelled");
  });

  test("cancellation during retry backoff prevents the next attempt", async () => {
    const clock = new ControlledClock();
    let waiting = false;
    clock.sleep = (_ms, signal) => new Promise<void>((_resolve, reject) => {
      waiting = true;
      signal.addEventListener("abort", () => reject(new Error("sleep interrupted")), { once: true });
    });
    let calls = 0;
    const f = await fixture({ async *run() {
      calls++;
      yield { type: "progress", text: "first attempt evidence" };
      yield { type: "terminal", outcome: { status: "failed", failure: { kind: "transient" } } };
    } }, { runtimeClock: clock });
    const id = (await f.submit()).json().taskId;
    await vi.waitFor(() => expect(waiting).toBe(true));
    await f.app.inject({ method: "POST", url: `${root}/${id}/cancel` });
    const result = await f.done(id);
    expect(result).toMatchObject({ status: "cancelled", chunks: ["first attempt evidence"] });
    expect(result.attempts).toHaveLength(1);
    expect(calls).toBe(1);
    expect(result.canonicalHistory.filter((event: any) => event.type === "fallback")).toEqual([]);
  });

  test("retries uncertain idempotent effects with the same executor key", async () => {
    const keys: string[] = [];
    const f = await fixture({ async *run(input) {
      const result = await input.executeTool(readIntent);
      yield { type: "terminal", outcome: result.effect === "uncertain"
        ? { status: "failed", failure: { kind: "transient" } } : { status: "completed" } };
    } }, { permissionTools: { definitions: [{ tool: "files", operations: ["read"], idempotent: true }],
      execute: async (_intent, options) => {
        keys.push(options!.idempotencyKey);
        if (keys.length === 1) throw new Error("temporary response loss");
        return { output: "confirmed read" };
      } } });
    const result = await f.done((await f.submit()).json().taskId);
    expect(result.status).toBe("completed");
    expect(result.attempts).toHaveLength(2);
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
  });

  test("does not deduplicate two legitimate same-intent calls in one attempt", async () => {
    let effects = 0;
    const f = await fixture({ async *run(input) {
      await input.executeTool(readIntent);
      await input.executeTool(readIntent);
      yield { type: "terminal", outcome: { status: "completed" } };
    } }, { permissionTools: { definitions: [{ tool: "files", operations: ["read"], idempotent: true }],
      execute: async () => { effects++; return { output: `read-${effects}` }; } } });
    const result = await f.done((await f.submit()).json().taskId);
    expect(result.status).toBe("completed");
    expect(effects).toBe(2);
    expect(result.canonicalHistory.filter((event: any) => event.type === "tool-result")).toHaveLength(2);
  });

  test("upgrades an open transient circuit when a later permanent failure is observed", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-circuit-"));
    resources.push(() => rm(directory, { recursive: true, force: true }));
    const store = new FileSarathiStore(join(directory, "sarathi.json"));
    const clock = new ControlledClock();
    const resilience = new RouteResilience(store, clock);
    resilience.failure(primary, { kind: "transient" });
    resilience.failure(primary, { kind: "transient" });
    resilience.failure(primary, { kind: "transient" });
    resilience.failure(primary, { kind: "authentication" });
    clock.time += 60_000;
    expect(() => resilience.assertAvailable(primary)).toThrow(/authentication/);
    expect(store.snapshot().routeCircuits[0]).toMatchObject({ state: "open", failureKind: "authentication", retryAt: null });
  });

  test("unreported quota reset remains blocked after policy edits and time passage", async () => {
    const f = await fixture({ async *run() { yield { type: "terminal", outcome: { status: "failed", failure: { kind: "quota" } } }; } });
    await f.done((await f.submit([])).json().taskId);
    f.clock.time += 86_400_000;
    await f.app.inject({ method: "PUT", url: "/api/sarathi/routing/policies/global", payload: { primary } });
    expect((await f.submit([])).statusCode).toBe(400);
  });

  test.each(["completed", "failed"] as const)("a previously admitted task ending %s cannot clear an authentication circuit", async (status) => {
    const releases: Array<(outcome: any) => void> = [];
    const f = await fixture({ async *run(input) {
      const outcome = await new Promise<any>((resolve) => {
        releases.push(resolve);
        input.signal.addEventListener("abort", () => resolve({ status: "cancelled" }), { once: true });
      });
      yield { type: "terminal", outcome };
    } });
    const first = (await f.submit([])).json().taskId;
    const second = (await f.submit([])).json().taskId;
    releases[0]!({ status: "failed", failure: { kind: "authentication" } });
    await f.done(first);
    releases[1]!({ status });
    await f.done(second);
    expect((await f.submit([])).statusCode).toBe(400);
  });

  test("snapshots a tool intent before asynchronous permission evaluation", async () => {
    let resolvePermission: ((decision: "low-risk") => void) | undefined;
    const seen: string[] = [];
    const mutableIntent = { tool: "files", operation: "analyze", target: "approved-target", context: {} };
    const f = await fixture({ async *run(input) {
      const execution = input.executeTool(mutableIntent);
      mutableIntent.target = "mutated-target";
      resolvePermission!("low-risk");
      await execution;
      yield { type: "terminal", outcome: { status: "completed" } };
    } }, { permissionSemanticClassifier: { classify: () => new Promise((resolve) => { resolvePermission = resolve; }) },
      permissionTools: { definitions: [{ tool: "files", operations: ["analyze"] }], execute: async (intent) => {
        seen.push(intent.target); return { output: intent.target };
      } } });
    const result = await f.done((await f.submit()).json().taskId);
    expect(result.status).toBe("completed");
    expect(seen).toEqual(["approved-target"]);
    expect(result.canonicalHistory).toContainEqual(expect.objectContaining({ type: "tool-result", result: expect.objectContaining({ output: "approved-target" }) }));
  });

  test("restart reconciles an interrupted effect and repairs stale dashboard state", async () => {
    const f = await fixture({ async *run() { yield { type: "terminal", outcome: { status: "completed" } }; } });
    const id = (await f.submit()).json().taskId;
    const record = await f.done(id);
    await f.app.close();
    // Seed an explicit crash checkpoint: permission granted and effect started; no result reached disk.
    const crashPath = join(f.taskPath, "..", "crash.json");
    const store = new FileTaskStore(crashPath, f.clock.now);
    const canonicalHistory = record.canonicalHistory.filter((entry: any) => !["attempt-finished", "outcome"].includes(entry.type));
    canonicalHistory.push({ type: "tool-started", idempotencyKey: "interrupted-send", idempotent: false,
      sequence: canonicalHistory.length + 1, attemptId: record.attempts[0].attemptId, observedAt: "2026-09-07T00:00:00.000Z" });
    store.create({ ...record, sessionKey: "session", status: "running", outcome: null, canonicalHistory,
      attempts: [{ ...record.attempts[0], status: "running", outcome: null, completedAt: null, events: [] }] });
    const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
    const restarted = buildApp(new AgentManager(configurator, "fake"), {
      taskStore: new FileTaskStore(crashPath, f.clock.now), sarathiStore: new FileSarathiStore(join(crashPath, "..", "projection.json"))
    });
    resources.push(() => restarted.close());
    expect((await restarted.inject({ method: "GET", url: `${root}/${id}` })).json()).toMatchObject({ status: "blocked", outcome: { message: expect.stringMatching(/reconciliation/i) } });
    const dashboard = (await restarted.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json();
    expect(dashboard.recentTasks[0]).toMatchObject({ id, status: "blocked" });
  });
});
