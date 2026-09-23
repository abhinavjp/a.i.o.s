import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FileWorkItemStore } from "../src/WorkItemStore.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStore() {
  const directory = await mkdtemp(join(process.cwd(), ".scratch", "tsk002-work-item-atomic-"));
  directories.push(directory);
  const path = join(directory, "work-items.json");
  return { store: new FileWorkItemStore(path), path };
}

describe("atomic work-source observation batches", () => {
  test("updates observed work, marks absent Jira work and preserves unrelated work fields", async () => {
    const { store, path } = await makeStore();
    const manual = store.create({ title: "Manual work", repositories: ["api"] });
    const existing = store.upsertSourceObservation({ workSourceKey: "OPS-601", title: "Old title", state: "Open", observedAt: "2026-09-22T00:00:00Z" });
    store.approveTrack(existing.id, ["plan"]);
    const absent = store.upsertSourceObservation({ workSourceKey: "OPS-602", title: "Absent", state: "Open", observedAt: "2026-09-22T00:00:00Z" });

    const result = store.applySourceObservationBatch([
      { workSourceKey: "OPS-601", title: "Changed title", state: "In Progress", observedAt: "2026-09-23T00:00:00Z" },
      { workSourceKey: "OPS-603", title: "New work", state: "Open", observedAt: "2026-09-23T00:00:00Z" }
    ], "2026-09-23T00:00:00Z");

    expect(result).toEqual({ imported: 1, updated: 1, missing: 1 });
    expect(store.list()).toMatchObject([
      { id: manual.id, title: "Manual work", repositories: ["api"], workSourceKey: null, sourceObservation: null },
      { id: existing.id, title: "Changed title", track: { stages: ["plan"] }, sourceObservation: { status: "observed", lastState: "In Progress" } },
      { id: absent.id, title: "Absent", sourceObservation: { status: "missing", lastState: "Open", lastObservedAt: "2026-09-22T00:00:00Z", lastCheckedAt: "2026-09-23T00:00:00Z" } },
      { workSourceKey: "OPS-603", title: "New work", sourceObservation: { status: "observed", lastState: "Open" } }
    ]);
    await expect(readFile(path, "utf8")).resolves.toContain("OPS-603");
    expect(new FileWorkItemStore(path).list()).toEqual(store.list());
  });

  test("leaves in-memory and persisted work unchanged when the batch commit fails", async () => {
    const { path } = await makeStore();
    const observedAt = "2026-09-22T00:00:00Z";
    await writeFile(path, JSON.stringify({ schemaVersion: 4, stageActivity: [], workItems: [
      { id: "manual", title: "Manual work", repositories: ["api"], workSourceKey: null, track: null, stages: [], createdAt: observedAt, sourceObservation: null },
      { id: "existing", title: "Existing", repositories: [], workSourceKey: "OPS-604", track: null, stages: [], createdAt: observedAt, sourceObservation: { source: "jira", status: "observed", lastObservedAt: observedAt, lastCheckedAt: observedAt, lastState: "Open" } },
      { id: "absent", title: "Will be absent", repositories: [], workSourceKey: "OPS-606", track: null, stages: [], createdAt: observedAt, sourceObservation: { source: "jira", status: "observed", lastObservedAt: observedAt, lastCheckedAt: observedAt, lastState: "Open" } }
    ] }, null, 2));
    const store = new FileWorkItemStore(path);
    const before = store.list();
    const persistOwner = store as unknown as { persist: (...args: unknown[]) => void };
    const persist = vi.spyOn(persistOwner, "persist").mockImplementation(() => { throw new Error("simulated work-item commit failure"); });

    expect(() => store.applySourceObservationBatch([
      { workSourceKey: "OPS-604", title: "Must roll back", state: "In Progress", observedAt: "2026-09-23T00:00:00Z" },
      { workSourceKey: "OPS-605", title: "Must not persist", state: "Open", observedAt: "2026-09-23T00:00:00Z" }
    ], "2026-09-23T00:00:00Z")).toThrow("simulated work-item commit failure");

    expect(persist).toHaveBeenCalledOnce();
    expect(store.list()).toEqual(before);
    expect(new FileWorkItemStore(path).list()).toEqual(before);
  });
});
