import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FilePhaseStore } from "../src/PhaseStore.js";

describe("FilePhaseStore", () => test("requires a demo sentence and implementation stage", async () => { const dir = await mkdtemp(join(tmpdir(), "aios-phases-")); try { const path = join(dir, "phases.json"); const store = new FilePhaseStore(path); expect(() => store.create({ workItemId: "work", stageKind: "plan", phase: { number: 1, name: "Plan", state: "not-started", demoSentence: "show", taskIds: [] } })).toThrow("implementation"); expect(() => store.create({ workItemId: "work", stageKind: "implementation", phase: { number: 1, name: "Build", state: "not-started", demoSentence: " ", taskIds: [] } })).toThrow("demo sentence"); store.create({ workItemId: "work", stageKind: "implementation", phase: { number: 1, name: "Build", state: "not-started", demoSentence: "Show the completed build.", taskIds: [] } }); expect(new FilePhaseStore(path).list("work")[0].phase.demoSentence).toBe("Show the completed build."); } finally { await rm(dir, { recursive: true, force: true }); } }));
