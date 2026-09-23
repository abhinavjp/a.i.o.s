import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vitest";
import { FetchJiraTransport } from "@aios/connectors";
import { JiraSyncCoordinator, type JiraSyncScheduler } from "../src/JiraSyncCoordinator.js";
import { FileWorkItemStore } from "../src/WorkItemStore.js";
import type { WorkSource, WorkSourceTicket } from "@aios/connectors";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

async function makeStore() {
  const directory = await mkdtemp(join(process.cwd(), ".scratch", "tsk002-jira-sync-test-"));
  directories.push(directory);
  return new FileWorkItemStore(join(directory, "work-items.json"));
}

class ControlledScheduler implements JiraSyncScheduler {
  callback: (() => void) | undefined;
  intervalMs = 0;
  handle = {};
  active = false;
  cleared: unknown[] = [];

  setInterval(callback: () => void, intervalMs: number): unknown {
    this.callback = callback;
    this.intervalMs = intervalMs;
    this.active = true;
    return this.handle;
  }

  clearInterval(handle: unknown): void {
    this.cleared.push(handle);
    this.active = false;
  }

  tick(): void { if (this.active) this.callback?.(); }
}

function ticket(key: string, title: string, status = "Open"): WorkSourceTicket {
  return { key, title, type: "Task", status, description: "" };
}

describe("Jira synchronization", () => {
  test("joins overlapping startup, manual and scheduled reads, then clears its interval on close", async () => {
    const store = await makeStore();
    const scheduler = new ControlledScheduler();
    let reads = 0;
    let finishFirstRead!: (value: ReadonlyArray<WorkSourceTicket>) => void;
    const firstRead = new Promise<ReadonlyArray<WorkSourceTicket>>((resolve) => { finishFirstRead = resolve; });
    const source: WorkSource = {
      listAssignedTickets: async () => {
        reads += 1;
        return reads === 1 ? firstRead : [];
      },
      readTicket: async () => null
    };
    const coordinator = new JiraSyncCoordinator({ source, store, intervalMs: 17, scheduler });

    const startup = coordinator.start();
    const manualRefresh = coordinator.refresh();
    scheduler.tick();
    expect(reads).toBe(1);
    expect(scheduler.intervalMs).toBe(17);
    finishFirstRead([ticket("OPS-501", "One observation")]);
    await expect(startup).resolves.toMatchObject({ state: "available", imported: 1 });
    await expect(manualRefresh).resolves.toMatchObject({ state: "available", imported: 1 });

    scheduler.tick();
    await vi.waitFor(() => expect(reads).toBe(2));
    await vi.waitFor(() => expect(coordinator.status().state).toBe("available"));
    const readsBeforeClose = reads;
    await coordinator.close();
    scheduler.tick();

    expect(reads).toBe(readsBeforeClose);
    expect(scheduler.cleared).toEqual([scheduler.handle]);
  });

  test("keeps duplicate Jira observations stable, updates changed tickets and marks absent tickets missing", async () => {
    const store = await makeStore();
    const batches = [
      [ticket("OPS-502", "Before")],
      [ticket("OPS-502", "Before")],
      [ticket("OPS-502", "After", "In Progress")],
      []
    ];
    const source: WorkSource = { listAssignedTickets: async () => batches.shift()!, readTicket: async () => null };
    let now = Date.parse("2026-09-23T00:00:00Z");
    const coordinator = new JiraSyncCoordinator({ source, store, now: () => now += 1000 });

    await expect(coordinator.start()).resolves.toMatchObject({ imported: 1 });
    const original = store.list()[0];
    await expect(coordinator.refresh()).resolves.toMatchObject({ imported: 0, updated: 1 });
    expect(store.list()).toMatchObject([{ id: original.id, title: "Before", sourceObservation: { status: "observed", lastState: "Open" } }]);
    await expect(coordinator.refresh()).resolves.toMatchObject({ imported: 0, updated: 1 });
    expect(store.list()).toMatchObject([{ id: original.id, title: "After", sourceObservation: { status: "observed", lastState: "In Progress" } }]);
    const lastObservedAt = store.list()[0].sourceObservation?.lastObservedAt;

    await expect(coordinator.refresh()).resolves.toMatchObject({ missing: 1 });

    expect(store.list()).toHaveLength(1);
    expect(store.list()[0]).toMatchObject({
      id: original.id,
      title: "After",
      sourceObservation: { status: "missing", lastObservedAt, lastState: "In Progress" }
    });
    expect(coordinator.status()).toMatchObject({ state: "available", lastSuccessAt: expect.any(String), lastError: null });
    await coordinator.close();
  });

  test("rejects an incomplete batch before writing and reports recovery after a later complete read", async () => {
    const store = await makeStore();
    let read = 0;
    const source: WorkSource = {
      listAssignedTickets: async () => {
        read += 1;
        if (read === 1) return [ticket("OPS-503", "Stable")];
        if (read === 2) return [ticket("OPS-504", "Must not be partial"), { key: "OPS-505", title: "Incomplete", status: "Open" } as WorkSourceTicket];
        return [ticket("OPS-503", "Recovered", "In Progress")];
      },
      readTicket: async () => null
    };
    let now = Date.parse("2026-09-23T00:00:00Z");
    const coordinator = new JiraSyncCoordinator({ source, store, now: () => now += 1000 });

    await expect(coordinator.start()).resolves.toMatchObject({ state: "available", imported: 1 });
    const previousSuccess = coordinator.status().lastSuccessAt;
    await expect(coordinator.refresh()).resolves.toMatchObject({ state: "failed", imported: 0, updated: 0 });

    expect(store.list()).toMatchObject([{ workSourceKey: "OPS-503", title: "Stable", sourceObservation: { status: "observed" } }]);
    expect(store.list().some((item) => item.workSourceKey === "OPS-504" || item.workSourceKey === "OPS-505")).toBe(false);
    expect(coordinator.status()).toMatchObject({ state: "failed", lastSuccessAt: previousSuccess, lastError: expect.any(String) });

    await expect(coordinator.refresh()).resolves.toMatchObject({ state: "available", updated: 1 });
    expect(store.list()).toMatchObject([{ workSourceKey: "OPS-503", title: "Recovered", sourceObservation: { status: "observed", lastState: "In Progress" } }]);
    expect(coordinator.status()).toMatchObject({ state: "available", lastSuccessAt: expect.any(String), lastError: null });
    await coordinator.close();
  });

  test("does not expose partially changed work when committing a Jira batch fails", async () => {
    const store = await makeStore();
    const existing = store.upsertSourceObservation({ workSourceKey: "OPS-506", title: "Before", state: "Open", observedAt: "2026-09-22T00:00:00Z" });
    const before = store.list();
    const persistOwner = store as unknown as { persist: (...args: unknown[]) => void };
    const persist = vi.spyOn(persistOwner, "persist").mockImplementation(() => { throw new Error("simulated work-item commit failure"); });
    const source: WorkSource = {
      listAssignedTickets: async () => [ticket("OPS-506", "After", "In Progress"), ticket("OPS-507", "New")],
      readTicket: async () => null
    };
    const coordinator = new JiraSyncCoordinator({ source, store });

    await expect(coordinator.start()).resolves.toMatchObject({ state: "failed", error: "simulated work-item commit failure" });

    expect(persist).toHaveBeenCalledOnce();
    expect(store.list()).toEqual(before);
    expect(store.list().find((item) => item.id === existing.id)).toMatchObject({ title: "Before", sourceObservation: { status: "observed", lastState: "Open" } });
    expect(coordinator.status()).toMatchObject({ state: "failed", lastError: "simulated work-item commit failure" });
    await coordinator.close();
  });

  test("the Jira HTTP adapter exposes read methods only", () => {
    const transport = new FetchJiraTransport();
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(transport)).filter((name) => name !== "constructor").sort();

    expect(methods).toEqual(["read", "search"]);
  });
});
