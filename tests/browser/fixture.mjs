import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const clientRoot = path.join(repoRoot, "app/client");
const fixtureTime = "2026-09-24T08:30:00.000Z";

export const fixture = {
  setup: { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } },
  dashboard: {
    runtime: { name: "Fixture runtime", state: "unverified", billingMode: "unmeasured", reason: "Fixture only; no provider called." },
    controls: { manualPaused: false, changedAt: null },
    discovery: { status: "blocked", reason: "No live code-host adapter was contacted.", lastCheckedAt: null, mergeRequests: [] },
    tickets: [],
    asks: [{ id: "ask-browser-1", kind: "route.change", risk: "medium", workItemId: "work-browser-1", createdAt: fixtureTime, intent: { tool: "route-policy", operation: "route.change", target: "global", context: { repository: "fixture/service", body: "Review a proposed route change." } } }],
    activity: [{ id: "activity-browser-1", occurredAt: fixtureTime, agent: "Fixture agent", workItemId: "work-browser-1", what: "Fixture observation only" }],
    specialists: [{ id: "agent-browser-1", name: "Local fixture agent", role: "reviewer", runtime: "unmeasured", status: "active", scope: "fixture", slotLimit: 1, capabilityTags: ["review"] }]
  },
  board: {
    workItems: { status: "available", data: [{
      workItem: { id: "work-browser-1", title: "Fixture queue item", workSourceKey: "FIX-101", repositories: ["fixture/service"], track: { stages: ["plan", "implementation", "final-review"] }, stages: [
        { kind: "plan", state: "done", artifacts: [] }, { kind: "implementation", state: "running", artifacts: [] }, { kind: "final-review", state: "not-started", artifacts: [] }
      ], createdAt: fixtureTime },
      stages: { completed: 1, total: 3 }, tasks: { completed: 1, total: 2 },
      phases: { status: "available", data: [] }, artifacts: { status: "available", data: [] }, mergeRequests: { status: "available", data: [] }
    }] },
    gitLabDiscussions: { sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null }, observations: [] }
  }
};

export async function startFixtureServer() {
  const server = await createServer({
    root: clientRoot,
    configFile: path.join(clientRoot, "vite.config.ts"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 4174, strictPort: true }
  });
  await server.listen();
  return server;
}

export async function jsonResponse(route, body, status = 200) {
  await route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });
}

export async function routeFixture(route, requests = [], overrides = {}) {
  const request = route.request();
  const url = new URL(request.url());
  requests.push({ method: request.method(), path: url.pathname, body: request.postData() });
  const override = overrides.actionResponses?.[`${request.method()} ${url.pathname}`];
  if (override) return jsonResponse(route, override.body ?? {}, override.status ?? 200);
  if (url.pathname === "/api/setup") {
    const read = (overrides.setupReadCount ?? 0) + 1;
    overrides.setupReadCount = read;
    const response = overrides.setupResponses?.[read] ?? { body: overrides.setup ?? fixture.setup };
    return jsonResponse(route, response.body ?? {}, response.status ?? 200);
  }
  if (url.pathname === "/api/version") return jsonResponse(route, { version: "fixture" });
  if (url.pathname === "/api/agents" || url.pathname === "/api/sarathi/agents") return jsonResponse(route, { agents: [] });
  if (url.pathname === "/api/sarathi/dashboard") return jsonResponse(route, overrides.dashboard ?? fixture.dashboard);
  if (url.pathname === "/api/mission-control/board") return jsonResponse(route, overrides.board ?? fixture.board);
  if (url.pathname === "/api/work-items/connection" || url.pathname === "/api/code-host/connection") return jsonResponse(route, { connection: null });
  if (url.pathname === "/api/work-items/sync") return jsonResponse(route, { sync: { configured: false, state: "unconfigured", lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } });
  if (url.pathname === "/api/code-host/discussions/sync") return jsonResponse(route, request.method() === "GET" ? { sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } } : {});
  if (url.pathname === "/api/work-items/import") return jsonResponse(route, { imported: 1, updated: 0, skipped: 0, missing: 0 });
  if (url.pathname === "/api/credentials/keychain") return jsonResponse(route, {});
  if (url.pathname === "/api/work-items/work-browser-1/progress") return jsonResponse(route, { progress: { tasks: { completed: 1, total: 2 }, checks: { completed: 1, total: 1 }, diff: { filesChanged: 2, linesAdded: 4, linesRemoved: 1 }, pipelineJobs: { completed: 1, total: 2 } } });
  if (url.pathname === "/api/routing") return jsonResponse(route, { schemaVersion: 1, version: 1, global: { version: 1, primary: { engine: "hermes", configuration: "default", billingMode: "subscription" }, fallbacks: [], fallbackEnabled: false }, workflows: {}, agents: {}, consent: { crossEngineFallback: false, paidFallback: false, acceptedAt: null } });
  if (url.pathname === "/api/routing/readiness") return jsonResponse(route, { engines: {} });
  return jsonResponse(route, {});
}
