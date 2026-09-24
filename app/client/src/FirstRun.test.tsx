import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("first run", () => {
  test("shows the three concerns, recovers from agent settings, and continues only with observed readiness", async () => {
    const timestamp = "2026-09-23T10:00:00.000Z";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url === "/api/setup" ? { firstRun: true, steps: { workSource: false, codeHost: false, agent: false } }
        : url === "/api/agents" || url === "/api/sarathi/agents" ? { agents: [{ id: "agent-1", displayName: "Worker", health: { ok: true } }] }
          : url === "/api/sarathi/dashboard" ? { runtime: { name: "Sarathi", state: "ready", billingMode: "fake", reason: "configured" }, discovery: { status: "ready", reason: "observed", lastCheckedAt: timestamp, mergeRequests: [] }, tickets: [] }
            : url === "/api/mission-control/board" ? { workItems: { status: "available", data: [] }, gitLabDiscussions: { observations: [], sync: { configured: true, state: "available", stale: false, lastAttemptAt: timestamp, lastSuccessAt: timestamp, lastFailureAt: null, lastError: null } } }
              : url === "/api/work-items/connection" || url === "/api/code-host/connection" ? { connection: { siteUrl: "https://example.test", credentialReference: "LOCAL_TOKEN", daysUntilExpiry: null, expiresSoon: false } }
                : url === "/api/work-items/sync" ? { sync: { configured: true, state: "available", lastAttemptAt: timestamp, lastSuccessAt: timestamp, lastFailureAt: null } }
                  : url === "/api/code-host/discussions/sync" ? { sync: { configured: true, state: "available", stale: false, lastAttemptAt: timestamp, lastSuccessAt: timestamp, lastFailureAt: null, lastError: null } }
                    : {};
      return { ok: true, json: async () => data };
    }));
    render(<App />);
    expect(await screen.findByText("1. Work source")).toBeTruthy();
    expect(screen.getByText("2. Code host")).toBeTruthy();
    expect(screen.getByText("3. Agent")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect work source" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect code host" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Connect agent" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Continue to command center" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Connect agent" }));
    expect(await screen.findByRole("button", { name: "Back to setup" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Back to setup" }));
    expect(await screen.findByRole("heading", { name: "Connect Sarathi" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Continue to command center" }));
    expect(await screen.findByRole("main", { name: "Sarathi Mission Control" })).toBeTruthy();
  });

  test("does not offer setup exit before Jira read, code host read, and healthy agent are observed", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url === "/api/setup" ? { firstRun: true, steps: { workSource: false, codeHost: false, agent: false } }
        : url === "/api/agents" ? { agents: [{ id: "agent-1", displayName: "Worker", health: { ok: true } }] }
          : url === "/api/work-items/sync" ? { sync: { configured: true, state: "idle", lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null } }
            : url === "/api/code-host/connection" ? { connection: { siteUrl: "https://gitlab.test", credentialReference: "GITLAB_TOKEN", daysUntilExpiry: null, expiresSoon: false } }
              : {};
      return { ok: true, json: async () => data };
    }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Connect Sarathi" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Continue to command center" })).toBeNull();
  });

  test("keeps the normal console for an existing installation", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } } : url === "/api/agents" ? { agents: [] } : url === "/api/sarathi/dashboard" ? { runtime: { name: "Fake", state: "unavailable", billingMode: "fake", reason: "offline" }, discovery: { status: "blocked", reason: "offline", lastCheckedAt: null, mergeRequests: [] }, tickets: [] } : {} })));
    render(<App />);
    expect(await screen.findByRole("button", { name: "Advanced controls" })).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /task/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced controls" }));
    expect(await screen.findByRole("textbox", { name: /task/i })).toBeTruthy();
    expect(screen.queryByText("Connect Adhiṣṭhāna")).toBeNull();
  });
});
