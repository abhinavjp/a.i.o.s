import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("automatic decisions", () => {
  test("shows the automatic decision audit and sends undo through the public API", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => {
      if (url === "/api/setup") return { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } };
      if (url === "/api/agents") return { agents: [] };
      if (url === "/api/sarathi/dashboard") return {
        runtime: { name: "Fake", state: "ready", billingMode: "fake", reason: "ready" },
        discovery: { status: "ready", reason: "ready", lastCheckedAt: null, mergeRequests: [] }, tickets: [],
        automaticDecisions: [{ id: "automatic-1", intent: { operation: "artifact.approve", target: "plan" }, source: "autopilot", sourceDetail: "low", workItemId: "work-1", createdAt: new Date().toISOString(), undone: false, undoable: true }]
      };
      return {};
    } }));
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    expect(await screen.findByRole("region", { name: "Automatic decision audit" })).toBeTruthy();
    expect(screen.getByText(/autopilot: low · work-1/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Undo automatic-1" }));
    expect(fetchMock).toHaveBeenCalledWith("/api/sarathi/automatic-decisions/automatic-1/undo", { method: "POST" });
  });
});
