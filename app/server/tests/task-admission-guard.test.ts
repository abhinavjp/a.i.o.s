import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { FakeAgent } from "@aios/agents";
import { FileTaskStore } from "../src/TaskStore.js";
import { TaskRunRegistry } from "../src/TaskRunRegistry.js";

describe("task admission freshness guard", () => {
  test("rechecks discussion freshness after asynchronous route selection", async () => {
    const directory = await mkdtemp(join(tmpdir(), "sarathi-task-admission-guard-"));
    const store = new FileTaskStore(join(directory, "tasks.json"));
    let discussionIsFresh = true;
    let routeSelectionStarted!: () => void;
    let finishRouteSelection!: () => void;
    const selectionStarted = new Promise<void>((resolve) => { routeSelectionStarted = resolve; });
    const routeSelection = new Promise<void>((resolve) => { finishRouteSelection = resolve; });
    const registry = new TaskRunRegistry(store, undefined, undefined, undefined, undefined, {
      async select(plan) {
        routeSelectionStarted();
        await routeSelection;
        return plan;
      }
    });

    try {
      const admission = registry.start(new FakeAgent(), "Remediate discussion", "session", {}, {
        taskId: "gitlab-remediation-stable",
        admissionGuard: () => discussionIsFresh ? { allowed: true } : { allowed: false, reason: "GitLab reports that this discussion is resolved" }
      });
      await selectionStarted;
      discussionIsFresh = false;
      finishRouteSelection();

      await expect(admission).rejects.toThrow("GitLab reports that this discussion is resolved");
      expect(store.list()).toHaveLength(0);
    } finally {
      await registry.close();
      await rm(directory, { recursive: true, force: true });
    }
  });
});
