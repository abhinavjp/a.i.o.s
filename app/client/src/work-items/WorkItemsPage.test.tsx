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
      .mockResolvedValueOnce({ ok: true, json: async () => ({ workItem: { ...unrouted, track: { stages: ["plan", "implementation", "merge"] }, stages: [{ kind: "plan", state: "not-started", artifacts: [] }, { kind: "implementation", state: "not-started", artifacts: [] }, { kind: "merge", state: "not-started", artifacts: [] }] } }) });
    vi.stubGlobal("fetch", fetchMock);

    render(<WorkItemsPage />);
    expect(await screen.findByText("Needs a track")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Approve track" }));

    expect(await screen.findByText("plan — not-started")).toBeTruthy();
    expect(fetchMock).toHaveBeenLastCalledWith("/api/work-items/work-1/track", expect.objectContaining({ method: "POST" }));
  });
});
