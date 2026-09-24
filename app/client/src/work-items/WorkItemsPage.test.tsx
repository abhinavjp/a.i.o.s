import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WorkItemsPage } from "./WorkItemsPage.js";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe("WorkItemsPage", () => {
  test("lists work items and adds one through the form", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItems: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItem: { id: "work-1", title: "Repair payroll export", repositories: ["payroll-api"], workSourceKey: null, track: null, createdAt: "2026-09-19T00:00:00.000Z" } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkItemsPage />);
    expect(await screen.findByText("No work items yet.")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Repair payroll export" } });
    fireEvent.change(screen.getByLabelText("Repositories"), { target: { value: "payroll-api" } });
    fireEvent.click(screen.getByRole("button", { name: "Add work item" }));

    expect(await screen.findByText("Repair payroll export")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/work-items", expect.objectContaining({ method: "POST" }));
  });

  test("approves a starting point and shows its stages", async () => {
    const unrouted = { id: "work-1", title: "Repair payroll export", repositories: [], workSourceKey: null, track: null, stages: [], createdAt: "2026-09-19T00:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItems: [unrouted] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItem: { ...unrouted, track: { stages: ["plan", "implementation", "merge"] }, stages: [{ kind: "plan", state: "not-started", artifacts: [] }, { kind: "implementation", state: "not-started", artifacts: [] }, { kind: "merge", state: "not-started", artifacts: [] }] } }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItem: { ...unrouted, track: { stages: ["plan", "implementation", "merge"] }, stages: [{ kind: "plan", state: "running", artifacts: [] }, { kind: "implementation", state: "not-started", artifacts: [] }, { kind: "merge", state: "not-started", artifacts: [] }] } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkItemsPage />);
    expect(await screen.findByText("Needs a track")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve track" }));

    expect(await screen.findByLabelText("State for plan")).toHaveProperty("value", "not-started");
    expect(fetchMock).toHaveBeenLastCalledWith("/api/work-items/work-1/track", expect.objectContaining({ method: "POST" }));
    fireEvent.change(screen.getByLabelText("State for plan"), { target: { value: "running" } });
    expect(await screen.findByDisplayValue("running")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/work-items/work-1/stages/plan", expect.objectContaining({ method: "PUT" }));
  });

  test("imports assigned tickets and refreshes the list", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItems: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ imported: 1, skipped: 0, workItems: [{ id: "work-2", title: "Repair payroll export", repositories: [], workSourceKey: "OPS-101", track: null, stages: [], createdAt: "2026-09-19T00:00:00.000Z" }] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkItemsPage />);
    await screen.findByText("No work items yet.");
    fireEvent.click(screen.getByRole("button", { name: "Import assigned tickets" }));
    expect(await screen.findByText("Repair payroll export")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/work-items/import", { method: "POST" });
  });

  test("opens a work item and shows code-host merge request fields", async () => {
    const workItem = { id: "work-3", title: "Repair payroll export", repositories: [], workSourceKey: null, track: null, stages: [], createdAt: "2026-09-19T00:00:00.000Z" };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItems: [workItem] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mergeRequests: [{ repository: "payroll-api", number: 42, title: "Repair export batching", state: "opened", pipelineResult: "running", jobsCompleted: 3, jobsTotal: 5 }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ artifacts: [] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ phases: [{ phase: { number: 1, name: "Build", demoSentence: "Show export batching." }, tasks: [{ taskId: "task-1", name: "Implement batching", agent: "codex", status: "completed" }] }, { phase: { number: 2, name: "Verify", demoSentence: "Show checks." }, tasks: [] }] }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ progress: { tasks: { completed: 1, total: 2 }, checks: null, diff: null, pipelineJobs: { completed: 3, total: 5 } } }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkItemsPage />);
    await screen.findByText("Repair payroll export");
    fireEvent.click(screen.getByRole("button", { name: "Open work item" }));
    expect(await screen.findByText("payroll-api !42 — opened — running — 3/5")).toBeTruthy();
    expect(await screen.findByText("Implement batching — codex — completed")).toBeTruthy();
    expect(screen.getByText("No tasks in this phase.")).toBeTruthy();
    expect(screen.getByText("Tasks: 1/2")).toBeTruthy();
    expect(screen.getByText("Checks: unknown")).toBeTruthy();
    expect(screen.queryByText(/%/)).toBeNull();
  });

  test("attaches an existing canonical task to a phase through the work-item API", async () => {
    const workItem = { id: "work-4", title: "Verify deployment", repositories: [], workSourceKey: null, track: { stages: ["plan"] }, stages: [{ kind: "plan", state: "running", artifacts: [] }], createdAt: "2026-09-19T00:00:00.000Z" };
    let attached = false;
    const phaseData = () => ({ phases: [{ phase: { number: 2, name: "Verification", demoSentence: "Run the checks." }, tasks: attached ? [{ taskId: "task-existing", name: "Run release checks", agent: "codex", status: "completed" }] : [] }] });
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/work-items") return Promise.resolve({ ok: true, json: async () => ({ workItems: [workItem] }) });
      if (url.endsWith("/merge-requests")) return Promise.resolve({ ok: true, json: async () => ({ mergeRequests: [] }) });
      if (url.endsWith("/artifacts")) return Promise.resolve({ ok: true, json: async () => ({ artifacts: [] }) });
      if (url.endsWith("/phases")) return Promise.resolve({ ok: true, json: async () => phaseData() });
      if (url.endsWith("/progress")) return Promise.resolve({ ok: true, json: async () => ({ progress: null }) });
      if (url.endsWith("/phases/2/tasks") && init?.method === "POST") { attached = true; return Promise.resolve({ ok: true, json: async () => ({ phases: [] }) }); }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkItemsPage availableTasks={[{ id: "task-existing", title: "Run release checks" }]} />);
    await screen.findByText("Verify deployment");
    fireEvent.click(screen.getByRole("button", { name: "Open work item" }));
    await screen.findByText("No tasks in this phase.");
    fireEvent.change(screen.getByLabelText("Task ID for Verification"), { target: { value: "task-existing" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach task" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/work-items/work-4/phases/2/tasks", expect.objectContaining({ method: "POST", body: JSON.stringify({ taskId: "task-existing" }) }));
    expect(await screen.findByText("Run release checks — codex — completed")).toBeTruthy();
  });

  test("accepts a canonical task id even when it is older than the recent-task suggestions", async () => {
    const workItem = { id: "work-5", title: "Verify deployment", repositories: [], workSourceKey: null, track: { stages: ["plan"] }, stages: [{ kind: "plan", state: "running", artifacts: [] }], createdAt: "2026-09-19T00:00:00.000Z" };
    let attached = false;
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/work-items") return Promise.resolve({ ok: true, json: async () => ({ workItems: [workItem] }) });
      if (url.endsWith("/merge-requests")) return Promise.resolve({ ok: true, json: async () => ({ mergeRequests: [] }) });
      if (url.endsWith("/artifacts")) return Promise.resolve({ ok: true, json: async () => ({ artifacts: [] }) });
      if (url.endsWith("/phases")) return Promise.resolve({ ok: true, json: async () => ({ phases: [{ phase: { number: 1, name: "Verification", demoSentence: "Run the checks." }, tasks: attached ? [{ taskId: "historical-task", name: "Old completed task", agent: "codex", status: "completed" }] : [] }] }) });
      if (url.endsWith("/progress")) return Promise.resolve({ ok: true, json: async () => ({ progress: null }) });
      if (url.endsWith("/phases/1/tasks") && init?.method === "POST") { attached = true; return Promise.resolve({ ok: true, json: async () => ({ phases: [] }) }); }
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkItemsPage availableTasks={[]} />);
    await screen.findByText("Verify deployment");
    fireEvent.click(screen.getByRole("button", { name: "Open work item" }));
    await screen.findByText("No tasks in this phase.");
    fireEvent.change(screen.getByLabelText("Task ID for Verification"), { target: { value: "historical-task" } });
    fireEvent.click(screen.getByRole("button", { name: "Attach task" }));

    expect(fetchMock).toHaveBeenCalledWith("/api/work-items/work-5/phases/1/tasks", expect.objectContaining({ method: "POST", body: JSON.stringify({ taskId: "historical-task" }) }));
    expect(await screen.findByText("Old completed task — codex — completed")).toBeTruthy();
  });
});
