import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";
import { FileSarathiStore } from "../src/sarathi/SarathiStore.js";

async function withStore<T>(run: (path: string) => Promise<T>): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "sarathi-"));
  try {
    return await run(join(directory, "state.json"));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function makeManager() {
  const configurator = new AgentConfigurator();
  configurator.register("fake", new FakeAgent());
  return new AgentManager(configurator, "fake");
}

describe("Sarathi dashboard routes", () => {
  test("returns the local workflow snapshot with explicit launch gates", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path)
      });

      const response = await app.inject({
        method: "GET",
        url: "/api/sarathi/dashboard"
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        runtime: { billingMode: "subscription-only" },
        controls: { manualPaused: false },
        discovery: { status: "blocked" }
      });
      expect(response.json().tickets).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: "02", status: "complete" }),
          expect.objectContaining({ id: "09", status: "blocked" })
        ])
      );
      await app.close();
    });
  });

  test("persists manual pause and reports discovery as blocked without an adapter", async () => {
    await withStore(async (path) => {
      const store = new FileSarathiStore(path);
      const app = buildApp(makeManager(), { sarathiStore: store });

      const pauseResponse = await app.inject({
        method: "POST",
        url: "/api/sarathi/control/pause",
        payload: { paused: true }
      });
      expect(pauseResponse.statusCode).toBe(200);
      expect(pauseResponse.json().controls.manualPaused).toBe(true);

      const discoveryResponse = await app.inject({
        method: "POST",
        url: "/api/sarathi/discovery/check"
      });
      expect(discoveryResponse.statusCode).toBe(200);
      expect(discoveryResponse.json().discovery).toMatchObject({
        status: "blocked",
        reason: expect.stringContaining("GitLab")
      });

      const restarted = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path)
      });
      const snapshot = await restarted.inject({
        method: "GET",
        url: "/api/sarathi/dashboard"
      });
      expect(snapshot.json().controls.manualPaused).toBe(true);
      await app.close();
      await restarted.close();
    });
  });

  test("creates a pending specialist and requires approval before activation", async () => {
    await withStore(async (path) => {
      const app = buildApp(makeManager(), {
        sarathiStore: new FileSarathiStore(path)
      });

      const createResponse = await app.inject({
        method: "POST",
        url: "/api/sarathi/specialists",
        payload: {
          name: "Review specialist",
          role: "reviewer",
          runtime: "unselected"
        }
      });
      expect(createResponse.statusCode).toBe(201);
      const specialist = createResponse.json().specialist;
      expect(specialist.status).toBe("pending_approval");

      const approveResponse = await app.inject({
        method: "POST",
        url: `/api/sarathi/specialists/${specialist.id}/approve`
      });
      expect(approveResponse.statusCode).toBe(200);
      expect(approveResponse.json().specialist.status).toBe("active");
      await app.close();
    });
  });
});
