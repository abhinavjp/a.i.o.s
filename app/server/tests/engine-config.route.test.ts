import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, EngineRegistry, NullAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileEngineConfigStore } from "../src/engine/EngineConfigStore.js";

describe("engine routing API", () => {
  test("migrates, persists, versions, and rejects secrets/unknown routes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-routing-"));
    const path = join(directory, "engine-routing.json");
    try {
      const first = new FileEngineConfigStore(path);
      expect(first.snapshot().global.primary?.engine).toBe("hermes");
      expect(first.snapshot().consent.crossEngineFallback).toBe(false);
      expect(first.setPolicy("workflow", "review", { primary: { model: "gpt-5" } }).primary).toEqual({ model: "gpt-5" });
      expect(first.setPolicy("global", undefined, { primary: { engine: "codex", configuration: "work", billingMode: "subscription" } }).version).toBe(2);
      const restarted = new FileEngineConfigStore(path);
      expect(restarted.snapshot().global.primary?.engine).toBe("codex");
      expect(() => restarted.setPolicy("global", undefined, { primary: { engine: "nope" as never, configuration: "x", billingMode: "subscription" } })).toThrow("unknown engine");
      expect(() => restarted.setPolicy("global", undefined, { primary: { engine: "codex", configuration: "x", billingMode: "subscription", credentialEnv: "not-valid" } })).toThrow("environment-variable");
      expect(() => restarted.setPolicy("global", undefined, { apiKey: "should-not-arrive" } as never)).toThrow("secret field");
      const onDisk = await readFile(path, "utf8");
      expect(onDisk).not.toContain("should-not-arrive");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("exposes routing GET/PUT and requires consent before enabling fallback", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-routing-api-"));
    const store = new FileEngineConfigStore(join(directory, "routing.json"));
    const app = buildApp(new AgentManager(new AgentConfigurator(), "missing"), { engineConfigStore: store });
    try {
      const initial = await app.inject({ method: "GET", url: "/api/routing" });
      expect(initial.statusCode).toBe(200);
      const blocked = await app.inject({ method: "PUT", url: "/api/routing/global", payload: { fallbackEnabled: true } });
      expect(blocked.statusCode).toBe(400);
      const consent = await app.inject({ method: "PUT", url: "/api/routing/consent", payload: { crossEngineFallback: true, paidFallback: false, acceptedAt: new Date().toISOString() } });
      expect(consent.statusCode).toBe(200);
      const saved = await app.inject({ method: "PUT", url: "/api/routing/global", payload: { fallbackEnabled: true } });
      expect(saved.statusCode).toBe(200);
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });

  test("reports live per-engine readiness for the routing badges", async () => {
    const directory = await mkdtemp(join(tmpdir(), "aios-routing-readiness-"));
    const store = new FileEngineConfigStore(join(directory, "routing.json"));
    const registry = new EngineRegistry();
    registry.registerAgent("claude-code", new ReadyEngine());
    registry.registerAgent("codex", new NullAgent());
    const app = buildApp(new AgentManager(new AgentConfigurator(), "hermes", registry), { engineConfigStore: store });
    try {
      const response = await app.inject({ method: "GET", url: "/api/routing/readiness" });
      expect(response.statusCode).toBe(200);
      const body = response.json() as { engines: Record<string, { state: string; reason: string }> };
      expect(body.engines["claude-code"].state).toBe("ready");
      expect(body.engines["claude-code"].reason).toContain("authenticated");
      expect(body.engines.codex.state).not.toBe("ready");
      expect(body.engines.hermes.state).toBe("unavailable");
    } finally {
      await app.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});

class ReadyEngine {
  getInfo() { return { id: "claude-code", kind: "claude-code" as const, displayName: "Claude Code" }; }
  checkHealth() { return { ok: true }; }
  async checkReadiness() { return { state: "ready" as const, reason: "installed and authenticated", checkedAt: "now" }; }
  async *runTask() { yield "unused"; }
  asOrchestrator() { return null; }
}
