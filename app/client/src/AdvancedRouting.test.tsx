import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("advanced agent settings", () => {
  test("keeps routing out of primary navigation and opens it from a specialist", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({ ok: true, json: async () => url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } } : url === "/api/agents" ? { agents: [] } : url === "/api/sarathi/dashboard" ? {
      runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" }, controls: { manualPaused: false }, discovery: { status: "blocked", reason: "blocked", lastCheckedAt: null, mergeRequests: [] }, tickets: [], specialists: [{ id: "reviewer", name: "Review specialist", role: "reviewer", runtime: "fake", status: "active", scope: "project", slotLimit: 1 }], recentTasks: [], groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 }
    } : {} })));
    render(<App />);
    expect(await screen.findByRole("textbox", { name: /task/i })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /routing/i })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Advanced settings for Review specialist" }));
    expect(await screen.findByText("Choose the engine that moves work.")).toBeTruthy();
    expect(screen.getByText("Advanced settings · Review specialist")).toBeTruthy();
  });
});
