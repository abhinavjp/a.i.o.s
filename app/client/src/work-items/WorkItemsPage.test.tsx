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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ mergeRequests: [{ repository: "payroll-api", number: 42, title: "Repair export batching", state: "opened", pipelineResult: "running", jobsCompleted: 3, jobsTotal: 5 }] }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<WorkItemsPage />);
    await screen.findByText("Repair payroll export");
    fireEvent.click(screen.getByRole("button", { name: "Open work item" }));
    expect(await screen.findByText("payroll-api !42 — opened — running — 3/5")).toBeTruthy();
  });
});
