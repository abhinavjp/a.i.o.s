import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App.js";
import { MissionControlShell } from "./mission-control/MissionControlShell.js";
import { readMissionControlBoard } from "./mission-control/api.js";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("Mission Control shell", () => {
  test("rejects a malformed board before rendering its regions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ workItems: { status: "available", data: {} }, gitLabDiscussions: { observations: [] } }) })));
    expect(await readMissionControlBoard()).toEqual({ status: "unsupported" });
  });

  test("shows the asks-first control room for configured installations", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const data = url === "/api/setup"
        ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } }
        : url === "/api/agents" || url === "/api/sarathi/agents"
          ? { agents: [] }
          : url === "/api/mission-control/board"
            ? { workItems: { status: "available", data: [] }, gitLabDiscussions: { observations: [], sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } } }
            : url === "/api/sarathi/dashboard"
              ? { runtime: { name: "Hermes", state: "unavailable", billingMode: "subscription-only", reason: "Not configured" }, controls: { manualPaused: false, changedAt: null }, discovery: { status: "blocked", reason: "Not configured", mergeRequests: [] }, tickets: [] }
              : {};
      return { ok: true, json: async () => data };
    }));

    render(<App />);

    const main = await screen.findByRole("main", { name: "Sarathi Mission Control" });
    const asks = within(main).getByRole("region", { name: "Asks" });
    const pipeline = within(main).getByRole("region", { name: "Work pipeline" });
    const activity = within(main).getByRole("region", { name: "Activity" });
    const agents = within(main).getByRole("region", { name: "Agents" });

    expect(asks.compareDocumentPosition(pipeline) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(pipeline.compareDocumentPosition(activity) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(main.contains(agents)).toBe(true);
    fireEvent.click(within(main).getByRole("button", { name: "Advanced controls" }));
    expect(await screen.findByRole("textbox", { name: /task/i })).toBeTruthy();
  });

  test("shows each region's loading and error state without invented work", () => {
    const dashboard = { asks: [], activity: [], specialists: [], controls: { manualPaused: false }, runtime: { name: "Sarathi", state: "unavailable" as const } };
    const props = { dashboard, onAdvanced: vi.fn(), onPause: vi.fn(), onDecideAsk: vi.fn() };
    const view = render(<MissionControlShell {...props} board={{ status: "loading" }} dashboardStatus="loading" />);
    expect(screen.getByText("Loading decisions…")).toBeTruthy();
    expect(screen.getByText("Loading work pipeline…")).toBeTruthy();
    expect(screen.getByText("Loading activity…")).toBeTruthy();

    view.rerender(<MissionControlShell {...props} board={{ status: "error", message: "GitLab read failed" }} dashboardStatus="error" />);
    expect(screen.getByText("Decisions are unavailable. Try again from Advanced controls.")).toBeTruthy();
    expect(screen.getByText("GitLab read failed")).toBeTruthy();
    expect(screen.getByText("Activity is unavailable.")).toBeTruthy();
  });

  test("toggles the agent rail and returns focus after the catch-up shortcut", () => {
    const dashboard = {
      asks: [{ id: "ask-1", kind: "gitlab.discussion.remediate", workItemId: "work-1", createdAt: "2026-09-23T10:00:00Z", intent: { tool: "gitlab", context: { repository: "group/payroll", body: "Review this change" } } }],
      activity: [], specialists: [{ id: "agent-1", name: "Reviewer", role: "remediator", status: "active" as const, slotLimit: 1 }],
      controls: { manualPaused: false }, runtime: { name: "Sarathi", state: "ready" as const }
    };
    render(<MissionControlShell board={{ status: "available", board: { workItems: { status: "available", data: [] }, gitLabDiscussions: { observations: [], sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null } } } }} dashboard={dashboard} dashboardStatus="available" onAdvanced={vi.fn()} onPause={vi.fn()} onDecideAsk={vi.fn()} />);
    const railToggle = screen.getByRole("button", { name: "Agents" });
    expect(railToggle.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(railToggle);
    expect(railToggle.getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByText("Reviewer")).toBeTruthy();

    const catchUp = screen.getByRole("button", { name: "Catch up on 1" });
    fireEvent.keyDown(window, { key: "c" });
    expect(screen.getByRole("dialog", { name: "Catch up" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Catch up" })).toBeNull();
    expect(document.activeElement).toBe(catchUp);
  });
});
