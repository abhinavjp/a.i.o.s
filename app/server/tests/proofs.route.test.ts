import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileTaskStore } from "../src/TaskStore.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";
import { OptInProofHarness } from "../src/sarathi/ProofHarness.js";

const resources: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of resources.splice(0).reverse()) await close(); });

function manager(): AgentManager { const configurator = new AgentConfigurator(); configurator.register("fake", new FakeAgent()); return new AgentManager(configurator, "fake"); }

async function fixture(harness = new OptInProofHarness()) {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-proofs-")); resources.push(() => rm(directory, { recursive: true, force: true }));
  const app = buildApp(manager(), { taskStore: new FileTaskStore(join(directory, "tasks.json")), sarathiStore: new FileSarathiStore(join(directory, "sarathi.json")), proofHarness: harness });
  resources.push(() => app.close()); await app.ready(); return app;
}

describe("opt-in live proof harness", () => {
  test("lists every route as UNMEASURED without an authorized probe", async () => {
    const app = await fixture();
    const proofs = (await app.inject({ method: "GET", url: "/api/sarathi/proofs" })).json();
    expect(proofs).toHaveLength(7); expect(proofs.every((proof: any) => proof.status === "UNMEASURED")).toBe(true);
    const response = await app.inject({ method: "POST", url: "/api/sarathi/proofs/openai", payload: { optIn: true } });
    expect(response.json().proof).toMatchObject({ route: "openai", status: "UNMEASURED" });
  });

  test("only an explicitly opted-in injected probe can pass and status persists", async () => {
    const app = await fixture(new OptInProofHarness({ ollama: async () => ({ ok: true }) }));
    const notOpted = await app.inject({ method: "POST", url: "/api/sarathi/proofs/ollama", payload: {} });
    expect(notOpted.json().proof).toMatchObject({ status: "UNMEASURED", checkedAt: null });
    const opted = await app.inject({ method: "POST", url: "/api/sarathi/proofs/ollama", payload: { optIn: true } });
    expect(opted.json().proof).toMatchObject({ route: "ollama", status: "passed" });
    const dashboard = (await app.inject({ method: "GET", url: "/api/sarathi/dashboard" })).json();
    expect(dashboard.proofs.find((proof: any) => proof.route === "ollama").status).toBe("passed");
  });
});

