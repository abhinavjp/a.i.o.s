import { describe, expect, test } from "vitest";
import { AgentConfigurator, AgentManager, FakeAgent } from "@aios/agents";
import { buildApp } from "../src/app.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("POST /api/agents/active/tasks", () => {
  test("returns 202 with a taskId immediately", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const response = await app.inject({
      method: "POST",
      url: "/api/agents/active/tasks",
      payload: { task: "do the thing" }
    });

    expect(response.statusCode).toBe(202);
    const body = response.json();
    expect(body.taskId).toMatch(UUID_RE);
  });
});

describe("GET /api/agents/active/tasks/:taskId/stream", () => {
  test("streams buffered chunks then done for a task that already finished", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const postResponse = await app.inject({
      method: "POST",
      url: "/api/agents/active/tasks",
      payload: { task: "do the thing" }
    });
    const { taskId } = postResponse.json();

    // Give the background task a tick to finish (FakeAgent is deterministic, no real delay).
    await wait(10);

    const streamResponse = await app.inject({
      method: "GET",
      url: `/api/agents/active/tasks/${taskId}/stream`
    });

    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toBe("text/event-stream");
    expect(streamResponse.headers["cache-control"]).toBe("no-cache");
    expect(streamResponse.headers["connection"]).toBe("keep-alive");
    expect(streamResponse.body).toBe(
      "data: Fake task received: do the thing\n\n" +
        "data: Fake task complete.\n\n" +
        "event: done\ndata: \n\n"
    );
  });

  test("returns 404 for an unknown taskId", async () => {
    const configurator = new AgentConfigurator();
    configurator.register("fake", new FakeAgent());
    const manager = new AgentManager(configurator, "fake");
    const app = buildApp(manager);

    const response = await app.inject({
      method: "GET",
      url: "/api/agents/active/tasks/does-not-exist/stream"
    });

    expect(response.statusCode).toBe(404);
  });
});
