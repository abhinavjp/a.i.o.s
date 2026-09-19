import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { WorkItemsPage } from "./WorkItemsPage.js";

afterEach(() => vi.unstubAllGlobals());

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
});
