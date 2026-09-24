import { afterEach, describe, expect, test, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

type Listener = (event: { data: string }) => void;

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: Listener | null = null;
  close = vi.fn();
  private listeners: Record<string, Listener[]> = {};

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: Listener) {
    this.listeners[type] ??= [];
    this.listeners[type].push(listener);
  }

  emitMessage(data: string) {
    this.onmessage?.({ data });
  }

  emitDone(data = "") {
    for (const listener of this.listeners["done"] ?? []) {
      listener({ data });
    }
  }
}

function stubAgentsFetch() {
  return vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ agents: [] })
  });
}

function stubAppFetch(fetchMock: ReturnType<typeof vi.fn>) {
  vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input) === "/api/setup") return Promise.resolve({ ok: true, json: async () => ({ firstRun: false, steps: { workSource: true, codeHost: true, agent: true } }) });
    if (String(input) === "/api/routing") return Promise.resolve({ ok: true, json: async () => ({ schemaVersion: 1, version: 1, global: { version: 1, primary: { engine: "hermes", configuration: "default", billingMode: "subscription" }, fallbacks: [], fallbackEnabled: false }, workflows: {}, agents: {}, consent: { crossEngineFallback: false, paidFallback: false, acceptedAt: null } }) });
    if (String(input) === "/api/routing/readiness") return Promise.resolve({ ok: true, json: async () => ({ engines: {} }) });
    return fetchMock(input, init);
  }));
}

async function openAdvancedControls() {
  fireEvent.click(await screen.findByRole("button", { name: "Advanced controls" }));
  await screen.findByRole("heading", { name: "Advanced controls" });
}

describe("App", () => {
  test("shows a stale track decision failure and refreshes canonical ask state", async () => {
    let dashboardReads = 0;
    const stale = "the track changed after this ask was created";
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/sarathi/dashboard") {
        dashboardReads += 1;
        return Promise.resolve({ ok: true, json: async () => ({
          runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" }, controls: { manualPaused: false, changedAt: null }, discovery: { status: "blocked", reason: "blocked", mergeRequests: [] }, tickets: [],
          asks: dashboardReads === 1 ? [{ id: "track-change-1", kind: "track.change", risk: "medium", workItemId: "work-1", createdAt: "2026-09-22T00:00:00.000Z", intent: { tool: "delivery-pipeline", operation: "track.change", target: "work-1", context: {
            workItemId: "work-1", stageKind: "technical-analysis", index: "0", currentTrack: JSON.stringify(["plan", "implementation", "merge"]), proposedTrack: JSON.stringify(["technical-analysis", "plan", "implementation", "merge"])
          } } }] : []
        }) });
      }
      if (url === "/api/mission-control/board") return Promise.resolve({ ok: true, json: async () => ({ workItems: { status: "available", data: [] }, gitLabDiscussions: { observations: [], sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } } }) });
      if (url === "/api/setup") return Promise.resolve({ ok: true, json: async () => ({ firstRun: false, steps: { workSource: true, codeHost: true, agent: true } }) });
      if (url === "/api/agents" || url === "/api/sarathi/agents") return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) });
      if (url === "/api/version") return Promise.resolve({ ok: true, json: async () => ({ version: "1.0.0" }) });
      if (url === "/api/sarathi/asks/track-change-1/decide" && init?.method === "POST") return Promise.resolve({ ok: false, status: 409, json: async () => ({ error: stale }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    stubAppFetch(fetchMock);
    render(<App />);

    const ask = await screen.findByRole("button", { name: /Review track.change/ });
    fireEvent.click(ask);
    const detail = screen.getByRole("dialog", { name: "Decision details" });
    fireEvent.click(within(detail).getByRole("button", { name: "Approve" }));

    expect((await within(detail).findByRole("alert")).textContent).toContain(stale);
    expect(dashboardReads).toBeGreaterThan(1);
    expect(await screen.findByText("No asks are waiting.")).toBeTruthy();
    expect(detail.textContent).toContain("no longer pending");
    expect(within(detail).getByRole("button", { name: "Approve" }).hasAttribute("disabled")).toBe(true);
  });

  test("shows current and proposed tracks for a track change ask", async () => {
    stubAppFetch(vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => {
      if (url === "/api/agents") return { agents: [] };
      return {
        runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" }, controls: { manualPaused: false, changedAt: null }, discovery: { status: "blocked", reason: "blocked", mergeRequests: [] }, tickets: [],
        asks: [{ id: "track-change-1", kind: "track.change", workItemId: "work-1", createdAt: "2026-09-22T00:00:00.000Z", intent: { tool: "delivery-pipeline", context: {
          currentTrack: JSON.stringify(["plan", "implementation", "merge"]), proposedTrack: JSON.stringify(["technical-analysis", "plan", "implementation", "merge"])
          } } }]
      };
    } })));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Review track.change/ }));
    expect(await screen.findByText("Current track: plan → implementation → merge")).toBeTruthy();
    expect(screen.getByText("Proposed track: technical-analysis → plan → implementation → merge")).toBeTruthy();
  });

  test("shows version, channel, and notes for an update ask", async () => {
    stubAppFetch(vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => {
      if (url === "/api/agents") return { agents: [] };
      return {
        runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" }, controls: { manualPaused: false }, discovery: { status: "blocked", reason: "blocked", mergeRequests: [] }, tickets: [],
        asks: [{ id: "update-1", kind: "apply", workItemId: null, createdAt: "2026-09-20T00:00:00.000Z", intent: { tool: "system-update", context: { version: "0.1.0", channel: "public", notes: "Important fixes" } } }]
      };
    } })));
    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: /Review apply/ }));
    expect(await screen.findByText("Version: 0.1.0 · public")).toBeTruthy();
    expect(screen.getByText("Notes: Important fixes")).toBeTruthy();
  });

  test("displays the running version reported by the server", async () => {
    stubAppFetch(vi.fn().mockImplementation((url: string) => Promise.resolve({
      ok: true,
      json: async () => url === "/api/version" ? { version: "0.0.0" } : { agents: [] }
    })));

    render(<App />);
    await openAdvancedControls();

    expect(await screen.findByText("Sarathi 0.0.0")).toBeTruthy();
  });

  test("shows each agent's slot use in the specialist console", async () => {
    stubAppFetch(vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => {
      if (url === "/api/agents") return { agents: [] };
      if (url === "/api/sarathi/agents") return { agents: [{ id: "sarathi", slotLimit: 2, slotsInUse: 1, full: false }] };
      if (url.startsWith("/api/sarathi/agents/suggest")) return { agent: { id: "sarathi", name: "Sarathi" }, reason: null };
      return {
        runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" },
        controls: { manualPaused: false, changedAt: null }, routing: { policies: [] }, providerCatalogs: [],
        discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] }, tickets: [],
        specialists: [{ id: "sarathi", name: "Sarathi", role: "coordinator", runtime: "fake", status: "active", scope: "local project", slotLimit: 2, capabilityTags: ["Planning", "Backend"] }],
        recentTasks: [], groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
      };
    } })));
    render(<App />);
    await openAdvancedControls();
    expect(await screen.findByText("1 / 2 slots in use")).toBeTruthy();
    expect(screen.getByText("Planning · Backend")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Required capability tag"), { target: { value: "Backend" } });
    fireEvent.click(screen.getByRole("button", { name: "Suggest agent" }));
    expect(await screen.findByText("Suggested agent: Sarathi")).toBeTruthy();
    expect(screen.getByLabelText("Capability tags for next specialist")).toBeTruthy();
  });

  test("stops active work through the API and preserves partial output with cancelled status", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () =>
      url === "/api/agents" ? { agents: [] } : url.endsWith("/cancel")
        ? { taskId: "task-stop", status: "cancelled", outcome: { status: "cancelled" }, chunks: ["partial evidence"] }
        : { taskId: "task-stop" } }));
    stubAppFetch(fetchMock);
    render(<App />);
    await openAdvancedControls();
    fireEvent.change(await screen.findByRole("textbox", { name: /task/i }), { target: { value: "stop this work" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    act(() => FakeEventSource.instances[0]?.emitMessage("partial evidence"));
    fireEvent.click(await screen.findByRole("button", { name: "Stop task" }));
    expect(await screen.findByText("Run status: cancelled")).toBeTruthy();
    expect(screen.getByText("partial evidence")).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/active/tasks/task-stop/cancel", { method: "POST" });
    expect(FakeEventSource.instances[0]?.close).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });

  test("shows the active task when its stop threshold has passed", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    stubAppFetch(vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () =>
      url === "/api/agents/active/tasks" ? { taskId: "task-stalled" }
        : url === "/api/agents/active/tasks/task-stalled" ? { stall: { state: "stop", lastOutputAt: "2026-09-07T00:00:00.000Z" } }
          : { agents: [] } })));
    render(<App />);
    await openAdvancedControls();
    fireEvent.click(await screen.findByRole("button", { name: /run task/i }));
    expect(await screen.findByText("Task stalled: stop threshold passed.")).toBeTruthy();
  });

  test("shows circuit recovery, retry and fallback counts, and reconstructs tool history on demand", async () => {
    stubAppFetch(vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => {
      if (url === "/api/agents") return { agents: [] };
      if (url === "/api/agents/active/tasks/history-task") return { canonicalHistory: [
        { sequence: 1, type: "message", role: "user", text: "original task" },
        { sequence: 2, type: "tool-result", result: { output: "recovered tool evidence", decision: { outcome: "allowed" } } }
      ] };
      return { runtime: { name: "fake", state: "ready" }, tickets: [], discovery: { status: "blocked" },
        recentTasks: [{ id: "history-task", title: "recovered task", status: "completed", runtime: "fake", planId: "p", attemptId: "a", retryCount: 2, fallbackCount: 1 }],
        routeCircuits: [{ route: { provider: "test", model: "primary" }, state: "open", failureKind: "transient", retryAt: "2026-09-07T00:01:00.000Z" }] };
    } })));
    render(<App />);
    await openAdvancedControls();
    expect(await screen.findByText("Retries: 2 · Fallbacks: 1")).toBeTruthy();
    expect(screen.getByText(/test\/primary: open/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "View history" }));
    expect(await screen.findByText(/recovered tool evidence/)).toBeTruthy();
    expect(screen.getByText(/original task/)).toBeTruthy();
  });

  test("a late cancellation response cannot close or overwrite a newer task stream", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    let resolveCancellation: ((response: unknown) => void) | undefined;
    let submissions = 0;
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
      if (url.endsWith("/cancel")) return new Promise((resolve) => { resolveCancellation = resolve; });
      return Promise.resolve({ ok: true, json: async () => url === "/api/agents/active/tasks" ? { taskId: `task-${++submissions}` } : { agents: [] } });
    }));
    render(<App />);
    await openAdvancedControls();
    fireEvent.click(await screen.findByRole("button", { name: /run task/i }));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));
    fireEvent.click(screen.getByRole("button", { name: "Stop task" }));
    fireEvent.click(screen.getByRole("button", { name: /run task/i }));
    await vi.waitFor(() => expect(FakeEventSource.instances).toHaveLength(2));
    act(() => FakeEventSource.instances[1]?.emitMessage("new task evidence"));
    await act(async () => resolveCancellation!({ ok: true, json: async () => ({ outcome: { status: "cancelled" }, chunks: ["old task evidence"] }) }));
    expect(screen.getByText("Run status: running")).toBeTruthy();
    expect(screen.getByText("new task evidence")).toBeTruthy();
    expect(FakeEventSource.instances[1]?.close).not.toHaveBeenCalled();
  });

  test("renders the agent list with name and health from the BFF", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: async () => ({ agents: [{ id: "fake", kind: "fake", displayName: "Fake Agent", health: { ok: true } }] }) });
      if (url === "/api/sarathi/dashboard") return Promise.resolve({ ok: true, json: async () => ({ runtime: { name: "Hermes", state: "unavailable", billingMode: "subscription-only", reason: "unavailable" }, controls: { manualPaused: false }, discovery: { status: "blocked", reason: "blocked", mergeRequests: [] }, tickets: [], specialists: [], recentTasks: [] }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    stubAppFetch(fetchMock);

    render(<App />);
    fireEvent.click(await screen.findByRole("button", { name: "Agents" }));

    expect(await screen.findByRole("button", { name: /Fake Agent · healthy/ })).toBeTruthy();
  });

  test("opens runtime diagnostics and readiness gates in advanced controls", async () => {
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              agents: [
                { id: "fake", kind: "fake", displayName: "Fake Agent", health: { ok: true } }
              ]
            })
          });
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runtime: { name: "Hermes", state: "unavailable", billingMode: "subscription-only" },
            controls: { manualPaused: false },
            discovery: { status: "blocked", reason: "GitLab adapter not configured" },
            providerCatalogs: [{
              provider: "fake-provider",
              authenticationMode: "environment-reference",
              provenance: "deterministic fake discovery",
              observedAt: "2026-09-06T10:00:00.000Z",
              completeness: "incomplete",
              stale: true,
              refreshError: "fake transport unavailable",
              models: [{
                id: "fake-provider:alpha",
                model: "alpha",
                enabled: false,
                configured: false,
                eligible: false,
                qualification: { health: "qualified", streaming: "qualified", structuredOutput: "unknown", toolCalling: "unknown" }
              }]
            }],
            tickets: [
              { id: "02", title: "Resume a task after restart", status: "complete" },
              { id: "09", title: "Discover assigned MRs", status: "blocked" }
            ],
            specialists: [],
            recentTasks: [
              {
                id: "task-fake-1",
                title: "route this through the fake runtime",
                status: "completed",
                runtime: "fake",
                planId: "plan-fake-1",
                attemptId: "attempt-fake-1",
                evidence: "Fake router accepted the work."
              }
            ],
            groups: [],
            reviewRounds: [],
            actionBatches: [],
            report: { merged: 0, blocked: 0, skipped: 0 }
          })
        });
      })
    );

    render(<App />);

    await openAdvancedControls();
    expect(await screen.findByRole("heading", { name: "Advanced controls" })).toBeTruthy();
    expect(screen.getByText("Readiness gates")).toBeTruthy();
    expect(screen.getByText("Discover assigned MRs")).toBeTruthy();
    expect(screen.getByText("GitLab adapter not configured")).toBeTruthy();
    expect(screen.getByText("Fake router accepted the work.")).toBeTruthy();
    expect(screen.getByText("Provider catalogs")).toBeTruthy();
    expect(screen.getByText("fake-provider")).toBeTruthy();
    expect(screen.getByText("stale")).toBeTruthy();
    expect(screen.getByText("Refresh failed: fake transport unavailable")).toBeTruthy();
    expect(screen.getByText("not enabled · not configured · ineligible")).toBeTruthy();
  });

  test("refreshes a provider catalog from the command center", async () => {
    const catalog = {
      provider: "fake-provider",
      authenticationMode: "none",
      provenance: "deterministic fake discovery",
      observedAt: "2026-09-06T10:13:00.000Z",
      completeness: "complete",
      stale: true,
      refreshError: "previous refresh failed",
      models: []
    };
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) });
      if (url === "/api/sarathi/dashboard") return Promise.resolve({
        ok: true,
        json: async () => ({
          runtime: { name: "Fake runtime", state: "ready", billingMode: "fake", reason: "ready" },
          controls: { manualPaused: false, changedAt: null },
          routing: { policies: [] },
          providerCatalogs: [catalog],
          discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] },
          tickets: [], specialists: [], recentTasks: [], groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
        })
      });
      if (url === "/api/sarathi/providers/fake-provider/catalog/refresh" && options?.method === "POST") {
        return Promise.resolve({ ok: true, json: async () => ({ refresh: { status: "succeeded" }, catalog: { ...catalog, stale: false, refreshError: null } }) });
      }
      return Promise.resolve({ ok: false, json: async () => ({}) });
    });
    stubAppFetch(fetchMock);

    render(<App />);
    await openAdvancedControls();
    fireEvent.click(await screen.findByRole("button", { name: "Refresh fake-provider" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/sarathi/providers/fake-provider/catalog/refresh",
      { method: "POST" }
    ));
    expect(await screen.findByText("current")).toBeTruthy();
  });

  test("creates a pending specialist and activates it only after approval", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/agents") {
        return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) });
      }
      if (url === "/api/sarathi/dashboard") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runtime: {
              name: "Hermes",
              state: "unavailable",
              billingMode: "subscription-only",
              reason: "unavailable"
            },
            controls: { manualPaused: false, changedAt: null },
            discovery: {
              status: "blocked",
              reason: "GitLab adapter not configured",
              lastCheckedAt: null,
              mergeRequests: []
            },
            tickets: [],
            specialists: [
              {
                id: "sarathi",
                name: "Sarathi",
                role: "coordinator",
                runtime: "unselected",
                status: "active",
                scope: "local project"
              }
            ],
            recentTasks: [],
            groups: [],
            reviewRounds: [],
            actionBatches: [],
            report: { merged: 0, blocked: 0, skipped: 0 }
          })
        });
      }
      if (url === "/api/sarathi/specialists" && options?.method === "POST") {
        return Promise.resolve({
          ok: true,
          json: async () => ({
            specialist: {
              id: "reviewer",
              name: "Review specialist",
              role: "reviewer",
              runtime: "unselected",
              status: "pending_approval",
              scope: "project context required"
            }
          })
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          specialist: {
            id: "reviewer",
            name: "Review specialist",
            role: "reviewer",
            runtime: "unselected",
            status: "active",
            scope: "project context required"
          }
        })
      });
    });
    stubAppFetch(fetchMock);

    render(<App />);
    await openAdvancedControls();
    fireEvent.click(await screen.findByRole("button", { name: "Add specialist" }));
    fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Review specialist" } });
    fireEvent.change(screen.getByLabelText("Role"), { target: { value: "reviewer" } });
    fireEvent.click(screen.getByRole("button", { name: "Save pending specialist" }));

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    expect(approveButton).toBeTruthy();
    fireEvent.click(approveButton);

    expect((await screen.findByRole("status")).textContent).toContain("Review specialist is active.");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/sarathi/specialists/reviewer/approve",
      { method: "POST" }
    );
  });

  test("saves a global primary route from the command center", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string, options?: RequestInit) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) });
      if (url === "/api/sarathi/dashboard") return Promise.resolve({
        ok: true,
        json: async () => ({
          runtime: { name: "Fake runtime", state: "ready", billingMode: "fake", reason: "ready" },
          controls: { manualPaused: false, changedAt: null },
          discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] },
          routing: { policies: [] }, tickets: [], specialists: [], recentTasks: [], groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
        })
      });
      return Promise.resolve({ ok: true, json: async () => ({ policy: { version: "global-v2" } }) });
    });
    stubAppFetch(fetchMock);
    render(<App />);
    await openAdvancedControls();

    fireEvent.change(await screen.findByLabelText("Primary model"), { target: { value: "configured-fake" } });
    fireEvent.click(screen.getByRole("button", { name: "Save route policy" }));

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/sarathi/routing/policies/global",
      expect.objectContaining({ method: "PUT" })
    ));
  });

  test("submitting a task POSTs then opens an EventSource to the stream URL", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") {
        return stubAgentsFetch()();
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ taskId: "task-123" })
      });
    });
    stubAppFetch(fetchMock);

    render(<App />);
    await openAdvancedControls();
    await screen.findByRole("textbox", { name: /task/i });

    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "do the thing" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/agents/active/tasks",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ task: "do the thing" })
        })
      );
    });

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/agents/active/tasks/task-123/stream"
    );
  });

  test("submitting a task includes selected specialist, workflow, and task route overrides", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") return stubAgentsFetch()();
      return Promise.resolve({ ok: true, json: async () => ({ taskId: "task-routing" }) });
    });
    stubAppFetch(fetchMock);
    render(<App />);
    await openAdvancedControls();
    fireEvent.change(await screen.findByLabelText("Specialist ID"), { target: { value: "reviewer" } });
    fireEvent.change(screen.getByLabelText("Workflow ID"), { target: { value: "review-flow" } });
    fireEvent.click(screen.getByLabelText("Override task primary"));
    fireEvent.change(screen.getByLabelText("Primary override model"), { target: { value: "task-model" } });
    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), { target: { value: "routed task" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/agents/active/tasks",
      expect.objectContaining({
        body: JSON.stringify({
          task: "routed task",
          specialistId: "reviewer",
          workflowId: "review-flow",
          routePolicy: { primary: { runtime: "fake", provider: "test", model: "task-model", billingMode: "fake" } }
        })
      })
    ));
  });

  test("refreshes fixed-route selection evidence after admission and terminal completion", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    let dashboardRequests = 0;
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") return stubAgentsFetch()();
      if (url === "/api/sarathi/dashboard") {
        dashboardRequests += 1;
        const selectionReason = dashboardRequests === 1 ? null : dashboardRequests === 2
          ? "fixed route selected: enabled, healthy, configured, and capability-qualified."
          : "fixed route completed with the admitted selection.";
        return Promise.resolve({
          ok: true,
          json: async () => ({
            runtime: { name: "Fake runtime", state: "ready", billingMode: "fake", reason: "ready" },
            controls: { manualPaused: false }, routing: { policies: [] }, providerCatalogs: [],
            discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] },
            tickets: [], specialists: [],
            recentTasks: selectionReason ? [{
              id: "task-selection", title: "show selected route", status: "completed", runtime: "fake",
              planId: "plan-selection", attemptId: "attempt-selection", evidence: null, selectionReason
            }] : [],
            groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
          })
        });
      }
      return Promise.resolve({ ok: true, json: async () => ({ taskId: "task-selection" }) });
    }));

    render(<App />);
    await openAdvancedControls();
    fireEvent.change(await screen.findByRole("textbox", { name: /task/i }), { target: { value: "show selected route" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("fixed route selected: enabled, healthy, configured, and capability-qualified.")).toBeTruthy();
    act(() => FakeEventSource.instances[0]?.emitDone(JSON.stringify({ status: "completed" })));
    expect(await screen.findByText("fixed route completed with the admitted selection.")).toBeTruthy();
    expect(dashboardRequests).toBe(3);
  });

  test("keeps newer terminal selection evidence when an older admission refresh resolves late", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    const pendingDashboardResponses: Array<(value: unknown) => void> = [];
    let dashboardCalls = 0;
    const snapshot = (selectionReason: string, status: "running" | "completed") => ({
      runtime: { name: "Fake runtime", state: "ready", billingMode: "fake", reason: "ready" },
      controls: { manualPaused: false }, routing: { policies: [] }, providerCatalogs: [],
      discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] },
      tickets: [], specialists: [], recentTasks: [{
        id: "task-race", title: "race selection", status, runtime: "fake",
        planId: "plan-race", attemptId: "attempt-race", evidence: null, selectionReason
      }],
      groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
    });
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") return stubAgentsFetch()();
      if (url === "/api/sarathi/dashboard") {
        dashboardCalls += 1;
        if (dashboardCalls === 1) return Promise.resolve({ ok: true, json: async () => snapshot("initial snapshot", "running") });
        return new Promise((resolve) => pendingDashboardResponses.push(resolve));
      }
      return Promise.resolve({ ok: true, json: async () => ({ taskId: "task-race" }) });
    }));

    render(<App />);
    await openAdvancedControls();
    fireEvent.change(await screen.findByRole("textbox", { name: /task/i }), { target: { value: "race selection" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));
    await vi.waitFor(() => expect(pendingDashboardResponses).toHaveLength(1));
    act(() => FakeEventSource.instances[0]?.emitDone(JSON.stringify({ status: "completed" })));
    await vi.waitFor(() => expect(pendingDashboardResponses).toHaveLength(2));

    await act(async () => {
      pendingDashboardResponses[1]?.({ ok: true, json: async () => snapshot("terminal snapshot", "completed") });
      await Promise.resolve();
    });
    expect(await screen.findByText("terminal snapshot")).toBeTruthy();

    await act(async () => {
      pendingDashboardResponses[0]?.({ ok: true, json: async () => snapshot("late admission snapshot", "running") });
      await Promise.resolve();
    });
    expect(screen.getByText("terminal snapshot")).toBeTruthy();
    expect(screen.queryByText("late admission snapshot")).toBeNull();
  });

  test("explains a rejected route instead of opening a task stream", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") return stubAgentsFetch()();
      if (url === "/api/sarathi/dashboard") return Promise.resolve({
        ok: true,
        json: async () => ({
          runtime: { name: "Fake runtime", state: "ready", billingMode: "fake", reason: "ready" },
          controls: { manualPaused: false }, routing: { policies: [] }, providerCatalogs: [],
          discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] },
          tickets: [], specialists: [], recentTasks: [], groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
        })
      });
      return Promise.resolve({ ok: false, json: async () => ({ error: "Route disabled-provider:disabled-model is not enabled." }) });
    }));

    render(<App />);
    await openAdvancedControls();
    fireEvent.change(await screen.findByRole("textbox", { name: /task/i }), { target: { value: "route rejection" } });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    expect(await screen.findByText("Route disabled-provider:disabled-model is not enabled.")).toBeTruthy();
    expect(FakeEventSource.instances).toHaveLength(0);
  });

  test("renders message chunks in order as they arrive", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: "task-abc" })
        });
      })
    );

    render(<App />);
    await openAdvancedControls();
    await screen.findByRole("textbox", { name: /task/i });

    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "do the thing" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const source = FakeEventSource.instances[0]!;

    act(() => {
      source.emitMessage("chunk one");
    });
    act(() => {
      source.emitMessage("chunk two");
    });

    expect(await screen.findByText(/chunk one/)).toBeTruthy();
    const text = screen.getByText(/chunk one/).textContent ?? "";
    expect(text.indexOf("chunk one")).toBeLessThan(text.indexOf("chunk two"));
  });

  test("done event closes the EventSource and shows finished indication", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: "task-xyz" })
        });
      })
    );

    render(<App />);
    await openAdvancedControls();
    await screen.findByRole("textbox", { name: /task/i });

    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "do the thing" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const source = FakeEventSource.instances[0]!;

    act(() => {
      source.emitDone(JSON.stringify({ status: "completed" }));
    });

    expect(await screen.findByText(/completed/i)).toBeTruthy();
    expect(source.close).toHaveBeenCalled();
  });

  test("renders a blocked terminal outcome from the task stream", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: "task-blocked" })
        });
      })
    );

    render(<App />);
    await openAdvancedControls();
    await screen.findByRole("textbox", { name: /task/i });
    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), {
      target: { value: "needs approval" }
    });
    fireEvent.click(screen.getByRole("button", { name: /run/i }));

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    act(() => {
      FakeEventSource.instances[0]?.emitDone(
        JSON.stringify({ status: "blocked", message: "needs approval" })
      );
    });

    expect(await screen.findByText(/Run status: blocked/i)).toBeTruthy();
  });

  test("reconnects to the persisted task without submitting it again", async () => {
    FakeEventSource.instances = [];
    localStorage.setItem("lastTaskId", "task-resume");
    vi.stubGlobal("EventSource", FakeEventSource);
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ agents: [] })
    });
    stubAppFetch(fetchMock);

    render(<App />);
    await openAdvancedControls();

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    expect(FakeEventSource.instances[0]?.url).toBe(
      "/api/agents/active/tasks/task-resume/stream"
    );
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/agents/active/tasks",
      expect.anything()
    );
  });

  test("submitting a second task before the first stream's done closes the first EventSource and starts fresh output", async () => {
    FakeEventSource.instances = [];
    vi.stubGlobal("EventSource", FakeEventSource);

    let taskCounter = 0;
    stubAppFetch(vi.fn().mockImplementation((url: string) => {
        if (url === "/api/agents") {
          return stubAgentsFetch()();
        }
        taskCounter += 1;
        return Promise.resolve({
          ok: true,
          json: async () => ({ taskId: `task-${taskCounter}` })
        });
      })
    );

    render(<App />);
    await openAdvancedControls();
    await screen.findByRole("textbox", { name: /task/i });

    const input = screen.getByRole("textbox", { name: /task/i });
    const button = screen.getByRole("button", { name: /run/i });

    fireEvent.change(input, { target: { value: "first task" } });
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(1);
    });
    const firstSource = FakeEventSource.instances[0]!;

    act(() => {
      firstSource.emitMessage("first task chunk");
    });
    expect(await screen.findByText(/first task chunk/)).toBeTruthy();

    // Submit a second task before the first stream's "done" ever fires.
    fireEvent.change(input, { target: { value: "second task" } });
    fireEvent.click(button);

    await vi.waitFor(() => {
      expect(FakeEventSource.instances).toHaveLength(2);
    });
    const secondSource = FakeEventSource.instances[1]!;

    // The first (abandoned) EventSource must have been closed.
    expect(firstSource.close).toHaveBeenCalled();

    // Output should have been reset for the new task.
    expect(screen.queryByText(/first task chunk/)).toBeNull();

    act(() => {
      secondSource.emitMessage("second task chunk");
    });
    expect(await screen.findByText(/second task chunk/)).toBeTruthy();
    expect(screen.queryByText(/first task chunk/)).toBeNull();
  });

  test("opens the migrated control inventory from Mission Control without restoring the generic dashboard", async () => {
    stubAppFetch(vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      const payload = url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } }
        : url === "/api/mission-control/board" ? { workItems: { status: "available", data: [] }, gitLabDiscussions: { observations: [], sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } } }
          : url === "/api/sarathi/dashboard" ? { runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "fixture" }, controls: { manualPaused: false, changedAt: null }, discovery: { status: "blocked", reason: "fixture", mergeRequests: [] }, tickets: [], specialists: [], recentTasks: [], proofs: [], providerCatalogs: [], routeCircuits: [], asks: [], standingRules: [], standingRuleSuggestions: [], automaticDecisions: [], activity: [] }
            : url === "/api/agents" || url === "/api/sarathi/agents" ? { agents: [] }
              : url === "/api/version" ? { version: "1.0.0" }
                : {};
      return Promise.resolve({ ok: true, json: async () => payload });
    }));
    render(<App />);

    expect(screen.queryByRole("textbox", { name: /task/i })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: "Advanced controls" }));

    expect(await screen.findByRole("heading", { name: "Advanced controls" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Work item administration" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Work items" }).getAttribute("href")).toBe("#mc-advanced-work");
    expect(screen.getByRole("link", { name: "Agents and tasks" }).getAttribute("href")).toBe("#mc-advanced-agents");
    expect(screen.getByRole("link", { name: "Runtime and providers" }).getAttribute("href")).toBe("#mc-advanced-runtime");
    expect(screen.getByRole("link", { name: "Routing and consent" }).getAttribute("href")).toBe("#mc-advanced-routing");
    const skipLink = screen.getByRole("link", { name: "Skip to advanced controls" });
    const workLink = screen.getByRole("link", { name: "Work items" });
    const backButton = screen.getByRole("button", { name: "Back to Mission Control" });
    for (const control of [skipLink, workLink, backButton]) {
      expect(control.tabIndex).toBe(0);
      control.focus();
      expect(document.activeElement).toBe(control);
    }
    expect(screen.queryByText("Operator view")).toBeNull();
  });

  test("invokes discovery, rollback, live-proof and pause controls from Advanced controls", async () => {
    const dashboard = {
      runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "fixture" },
      controls: { manualPaused: false, changedAt: null },
      discovery: { status: "blocked", reason: "fixture", mergeRequests: [] },
      tickets: [], specialists: [], recentTasks: [], providerCatalogs: [], routeCircuits: [],
      proofs: [{ route: "codex", status: "UNMEASURED", reason: "not measured", checkedAt: null }]
    };
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/agents" || url === "/api/sarathi/agents") return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) });
      if (url === "/api/sarathi/dashboard") return Promise.resolve({ ok: true, json: async () => dashboard });
      if (url === "/api/sarathi/discovery/check" && init?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ discovery: { status: "ready", reason: "checked", mergeRequests: [] } }) });
      if (url === "/api/update/rollback" && init?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ version: "2.0.0" }) });
      if (url === "/api/sarathi/proofs/codex" && init?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ proof: { route: "codex", status: "passed", reason: "fixture passed", checkedAt: "now" } }) });
      if (url === "/api/sarathi/control/pause" && init?.method === "POST") return Promise.resolve({ ok: true, json: async () => ({ controls: { manualPaused: true, changedAt: "now" } }) });
      if (url === "/api/version") return Promise.resolve({ ok: true, json: async () => ({ version: "1.0.0" }) });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    stubAppFetch(fetchMock);
    render(<App />);
    await openAdvancedControls();

    fireEvent.click(screen.getByRole("button", { name: /Check now/ }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/sarathi/discovery/check", { method: "POST" }));
    fireEvent.click(screen.getByRole("button", { name: "Roll back update" }));
    expect(await screen.findByText("Running 2.0.0")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Check codex proof" }));
    expect(await screen.findByText("codex: passed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Pause dispatch" }));
    expect(await screen.findByRole("button", { name: "Resume dispatch" })).toBeTruthy();
    expect(fetchMock).toHaveBeenCalledWith("/api/sarathi/proofs/codex", expect.objectContaining({ method: "POST", body: JSON.stringify({ optIn: true }) }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sarathi/control/pause", expect.objectContaining({ method: "POST", body: JSON.stringify({ paused: true }) }));
  });

  test("reports a failed setup read and recovers after an explicit retry", async () => {
    let setupReads = 0;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/setup") {
        setupReads += 1;
        if (setupReads === 1) return Promise.reject(new Error("setup service unavailable"));
        if (setupReads === 2) return Promise.resolve({ ok: true, json: async () => ({ steps: { workSource: true, codeHost: true, agent: true } }) });
        return Promise.resolve({ ok: true, json: async () => ({ firstRun: false, steps: { workSource: true, codeHost: true, agent: true } }) });
      }
      const payload = url === "/api/mission-control/board" ? { workItems: { status: "available", data: [] }, gitLabDiscussions: { observations: [], sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } } }
        : url === "/api/sarathi/dashboard" ? { runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "fixture" }, controls: { manualPaused: false, changedAt: null }, discovery: { status: "blocked", reason: "fixture", mergeRequests: [] }, tickets: [], specialists: [], recentTasks: [], proofs: [], providerCatalogs: [], routeCircuits: [], asks: [], standingRules: [], standingRuleSuggestions: [], automaticDecisions: [], activity: [] }
          : url === "/api/agents" || url === "/api/sarathi/agents" ? { agents: [] }
            : url === "/api/version" ? { version: "1.0.0" }
              : {};
      return Promise.resolve({ ok: true, json: async () => payload });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);

    expect((await screen.findByRole("alert")).textContent).toContain("Could not read setup status");
    fireEvent.click(screen.getByRole("button", { name: "Retry setup read" }));
    expect((await screen.findByRole("alert")).textContent).toContain("Could not read setup status");
    expect(setupReads).toBe(2);
    fireEvent.click(screen.getByRole("button", { name: "Retry setup read" }));

    expect(await screen.findByRole("button", { name: "Advanced controls" })).toBeTruthy();
    expect(setupReads).toBe(3);
  });
});
