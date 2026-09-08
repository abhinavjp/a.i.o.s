import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import type { ProviderTransport } from "../src/sarathi/ProviderAdapters.js";
import { AnthropicProviderAdapter, CustomOpenAICompatibleProviderAdapter, OllamaProviderAdapter, OpenAIProviderAdapter } from "../src/sarathi/ProviderAdapters.js";
import type { ResolvedRoute, RuntimeUsage } from "@aios/contracts";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";

const usage: RuntimeUsage = { inputTokens: "unknown", cachedInputTokens: "unknown", reasoningTokens: "unknown", outputTokens: "unknown", cost: "unknown", costKind: "unknown" };
const resources: Array<() => Promise<void>> = [];
afterEach(async () => { delete process.env.OPENAI_TEST_KEY; for (const close of resources.splice(0).reverse()) await close(); });

function manager(): AgentManager {
  const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

function transport(model: string, tier: "economy" | "workhorse" | "frontier" | "unclassified" = "workhorse"): ProviderTransport {
  return {
    available: async () => true,
    discover: async () => ({ authenticationMode: "environment-reference" as const, provenance: "provider test transport", observedAt: new Date().toISOString(), completeness: "complete" as const,
      models: [{ model, enabled: true, configured: true, tier, qualification: { health: "qualified" as const, streaming: "qualified" as const, structuredOutput: "qualified" as const, toolCalling: "qualified" as const } }] }),
    stream: async function* () { yield { type: "text" as const, text: "provider output" }; yield { type: "usage" as const, usage, attribution: { providerRequestId: "provider-request" } }; yield { type: "terminal" as const, outcome: { status: "completed" as const } }; }
  };
}

async function eventually(app: ReturnType<typeof buildApp>, taskId: string): Promise<any> {
  let result: any;
  for (let i = 0; i < 50; i++) {
    result = (await app.inject({ method: "GET", url: `/api/agents/active/tasks/${taskId}` })).json();
    if (result.outcome) return result;
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  return result;
}

describe("local, paid, aggregate, and Auto provider routes", () => {
  test("a paid model disabled in its observed catalog is rejected before execution", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-provider-disabled-")); resources.push(() => rm(directory, { recursive: true, force: true }));
    const route: ResolvedRoute = { runtime: "openai", provider: "openai", model: "gpt-test", billingMode: "api" };
    const adapter = new OpenAIProviderAdapter({ transport: { ...transport(route.model), discover: async () => ({ ...(await transport(route.model).discover!()), models: [{ ...(await transport(route.model).discover!()).models[0]!, enabled: false }] }) }, credentialEnvVar: "OPENAI_TEST_KEY" });
    process.env.OPENAI_TEST_KEY = "secret-value";
    const app = buildApp(manager(), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), providerAdapters: [adapter] });
    resources.push(() => app.close()); await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "paid", routePolicy: { primary: route } } });
    expect(response.statusCode).toBe(400); expect(response.json().error).toMatch(/not enabled/);
    const dashboard = JSON.stringify((await app.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json());
    expect(dashboard).not.toContain("secret-value"); expect(dashboard).toContain("OPENAI_TEST_KEY");
  });

  test("direct API routes without a named environment credential stay unconfigured", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-provider-credential-")); resources.push(() => rm(directory, { recursive: true, force: true }));
    const route: ResolvedRoute = { runtime: "openai", provider: "openai", model: "gpt-test", billingMode: "api" };
    const adapter = new OpenAIProviderAdapter({ transport: transport(route.model), credentialEnvVar: "MISSING_OPENAI_TEST_KEY" });
    const app = buildApp(manager(), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), providerAdapters: [adapter] });
    resources.push(() => app.close()); await app.ready();
    const response = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "paid", routePolicy: { primary: route } } });
    expect(response.statusCode).toBe(400); expect(response.json().error).toMatch(/not configured/);
  });

  test("custom non-loopback endpoints disclose UNMEASURED transport security", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-provider-security-")); resources.push(() => rm(directory, { recursive: true, force: true }));
    const adapter = new CustomOpenAICompatibleProviderAdapter({ endpoint: "http://lan-host:8080/v1", models: [{ model: "custom-model", enabled: true, configured: true, tier: "unclassified", qualification: { health: "qualified", streaming: "qualified", structuredOutput: "qualified", toolCalling: "qualified" } }] });
    const app = buildApp(manager(), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), providerAdapters: [adapter] });
    resources.push(() => app.close()); await app.ready();
    const catalog = (await app.inject({ method: "GET", url: "/api/sarathi/providers/catalogs" })).json()[0];
    expect(catalog.securityStatus).toBe("unmeasured"); expect(catalog.models[0].tier).toBe("unclassified");
  });

  test("Auto filters unclassified models and chooses the lowest adequate configured tier", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-provider-auto-")); resources.push(() => rm(directory, { recursive: true, force: true }));
    const ollama = new OllamaProviderAdapter({ transport: transport("local-economy", "economy") });
    const anthropic = new AnthropicProviderAdapter({ transport: transport("frontier-model", "frontier"), credentialEnvVar: "ANTHROPIC_TEST_KEY" });
    process.env.ANTHROPIC_TEST_KEY = "secret";
    const app = buildApp(manager(), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), providerAdapters: [ollama, anthropic], autoRouting: {} });
    resources.push(() => app.close()); await app.ready();
    const route: ResolvedRoute = { runtime: "auto", provider: "auto", model: "auto", billingMode: "unmeasured" };
    const response = await app.inject({ method: "POST", url: "/api/agents/active/tasks", payload: { task: "extract a short list", routePolicy: { primary: route } } });
    expect(response.statusCode).toBe(202);
    const result = await eventually(app, response.json().taskId);
    expect(result).toMatchObject({ status: "completed", resolvedExecutionPlan: { route: { provider: "ollama", model: "local-economy" }, selection: { classification: "economy", operatorOverride: false } } });
    expect(result.resolvedExecutionPlan.selection.reason).toMatch(/lowest adequate economy/);
    expect(JSON.stringify((await app.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json())).not.toContain("secret");
  });
});
