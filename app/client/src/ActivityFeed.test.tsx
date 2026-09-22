import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

function dashboard(activity: unknown[]) {
  return { runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" }, controls: { manualPaused: false }, discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] }, tickets: [], activity };
}

describe("activity feed", () => {
  test("shows the newest activity with its time, agent, and work item", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } } : url === "/api/agents" ? { agents: [] } : dashboard([
      { id: "newest", occurredAt: "2026-09-21T12:03:00.000Z", agent: "reviewer", workItemId: "OPS-42", what: "Artifact review.md written" },
      { id: "older", occurredAt: "2026-09-21T12:02:00.000Z", agent: "Sarathi", workItemId: "OPS-42", what: "Stage final-review changed to done" }
    ]) })));
    render(<App />);
    expect(await screen.findByText("Artifact review.md written")).toBeTruthy();
    expect(screen.getByText("2026-09-21T12:03:00.000Z")).toBeTruthy();
    expect(screen.getByText(/reviewer.*OPS-42/)).toBeTruthy();
    expect(screen.getAllByText(/Artifact review.md written|Stage final-review changed to done/)[0].textContent).toBe("Artifact review.md written");
  });

  test("makes an empty activity feed clear", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } } : url === "/api/agents" ? { agents: [] } : dashboard([]) })));
    render(<App />);
    expect(await screen.findByText("No activity recorded yet.")).toBeTruthy();
  });
});
