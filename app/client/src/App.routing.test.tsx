import { afterEach, describe, expect, test, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { App } from "./App.js";

afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

class EventSourceStub {
  onmessage: ((event: { data: string }) => void) | null = null;
  close() {}
  addEventListener() {}
}

describe("App routing controls", () => {
  test("posts a task engine override and shows the admitted plan", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url === "/api/agents") return Promise.resolve({ ok: true, json: async () => ({ agents: [] }) });
      if (url === "/api/sarathi/dashboard") return Promise.resolve({ ok: true, json: async () => ({ runtime: { name: "Hermes", state: "unavailable", billingMode: "subscription-only", reason: "unavailable" }, controls: { manualPaused: false }, discovery: { status: "blocked", reason: "blocked", mergeRequests: [] }, tickets: [], specialists: [], recentTasks: [], groups: [], reviewRounds: [], actionBatches: [], report: { merged: 0, blocked: 0, skipped: 0 } }) });
      return Promise.resolve({ ok: true, json: async () => ({ taskId: "task-1", resolvedEnginePlan: { primary: { engine: "codex", configuration: "work", billingMode: "subscription" }, fallbacks: [], source: "task", configurationVersions: { task: null, workflow: null, agent: null, global: 1 } }, readiness: { state: "unavailable", reason: "unmeasured", checkedAt: "now" } }) });
    });
    vi.stubGlobal("fetch", fetchMock); vi.stubGlobal("EventSource", EventSourceStub);
    render(<App />);
    await screen.findByRole("textbox", { name: /task/i });
    fireEvent.change(screen.getByRole("combobox", { name: "Task engine" }), { target: { value: "codex" } });
    fireEvent.change(screen.getByLabelText("Configuration"), { target: { value: "work" } });
    fireEvent.change(screen.getByRole("textbox", { name: /task/i }), { target: { value: "inspect" } });
    fireEvent.click(screen.getByRole("button", { name: /run task/i }));
    await screen.findByText("codex");
    expect(fetchMock).toHaveBeenCalledWith("/api/agents/active/tasks", expect.objectContaining({ body: expect.stringContaining('"engine":"codex"') }));
  });
});
