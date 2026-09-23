import { afterEach, describe, expect, test, vi } from "vitest";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { App } from "./App.js";
import { MissionControlShell } from "./mission-control/MissionControlShell.js";
import { readMissionControlBoard } from "./mission-control/api.js";
import type { MissionControlBoard, MissionControlBoardItem, StageKind } from "@aios/contracts";

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

  test("groups mixed work by track and stage and opens truthful work and stage details", () => {
    const board = makeBoard([
      makeWorkItem("checkout", "Checkout validation", ["plan", "implementation", "merge"], [
        { kind: "plan", state: "done", artifacts: [] },
        { kind: "implementation", state: "running", artifacts: [] },
        { kind: "merge", state: "not-started", artifacts: [] }
      ], { completed: 1, total: 3 }, null),
      makeWorkItem("jira-42", "Imported ticket 42", null, [
        { kind: "plan", state: "blocked", artifacts: [] }
      ], { completed: 0, total: 1 }, null)
    ]);
    render(<MissionControlShell board={{ status: "available", board }} dashboard={emptyDashboard()} dashboardStatus="available" onAdvanced={vi.fn()} onPause={vi.fn()} onDecideAsk={vi.fn()} />);

    const pipeline = screen.getByRole("region", { name: "Work pipeline" });
    expect(within(pipeline).getByRole("region", { name: "Track: plan → implementation → merge" })).toBeTruthy();
    expect(within(pipeline).getByRole("region", { name: "Track: no track assigned" })).toBeTruthy();
    fireEvent.click(within(pipeline).getByRole("button", { name: "Details for Checkout validation" }));

    const workDetails = screen.getByRole("dialog", { name: "Work item details" });
    expect(within(workDetails).getByText("1 / 3 stages complete")).toBeTruthy();
    expect(within(workDetails).getByText("Task progress unknown")).toBeTruthy();
    fireEvent.click(within(workDetails).getByRole("button", { name: "Implementation stage: running" }));
    const stageDetails = screen.getByRole("dialog", { name: "Stage details" });
    expect(within(stageDetails).getByText("running")).toBeTruthy();
  });

  test("opens phase and task details, shows unavailable artifact content, and preserves MR pipeline state", async () => {
    const item = makeWorkItem("checkout", "Checkout validation", ["implementation", "merge"], [
      { kind: "implementation", state: "running", artifacts: [] },
      { kind: "merge", state: "waiting", artifacts: [] }
    ], { completed: 0, total: 2 }, { completed: 0, total: 1 });
    item.phases = { status: "available", data: [{ stageKind: "implementation", phase: { number: 2, name: "Implementation", state: "running", demoSentence: "The checkout path is implemented.", taskIds: ["task-7"] }, tasks: [{ taskId: "task-7", name: "Add replay protection", status: "failed" }] }] };
    item.artifacts = { status: "available", data: [
      { id: "artifact-7", workItemId: "checkout", stageKind: "implementation", name: "Implementation plan", version: 2, approvalState: "approved", kind: "authored", branch: "adhisthana/checkout/implementation", filePath: "plan.md" },
      { id: "artifact-8", workItemId: "checkout", stageKind: "implementation", name: "Review notes", version: 1, approvalState: "awaiting", kind: "authored", branch: "adhisthana/checkout/implementation", filePath: "review.md" }
    ] };
    item.mergeRequests = { status: "available", data: [
      { repository: "group/payments", number: 19, title: "Guard checkout retries", branch: "adhisthana/checkout/implementation", state: "opened", pipelineResult: "failed", jobsCompleted: 2, jobsTotal: 3 },
      { repository: "group/payments", number: 20, title: "Check checkout logging", branch: "adhisthana/checkout/implementation", state: "opened", pipelineResult: "running", jobsCompleted: 1, jobsTotal: 3 }
    ] };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/progress")) return { ok: true, json: async () => ({ progress: { tasks: null, checks: null, diff: null, pipelineJobs: { completed: 2, total: 3 } } }) };
      if (url.includes("artifact-7")) return { ok: false, status: 502, json: async () => ({ available: false, error: "code host read failed" }) };
      return { ok: true, json: async () => ({ available: true, content: "Observed review notes" }) };
    }));
    render(<MissionControlShell board={{ status: "available", board: makeBoard([item]) }} dashboard={emptyDashboard()} dashboardStatus="available" onAdvanced={vi.fn()} onPause={vi.fn()} onDecideAsk={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Details for Checkout validation" }));
    const workDetails = screen.getByRole("dialog", { name: "Work item details" });
    expect(await within(workDetails).findByText("Pipeline jobs: 2 / 3")).toBeTruthy();
    fireEvent.click(within(workDetails).getByRole("button", { name: "Phase 2: Implementation" }));
    const phaseDetails = screen.getByRole("dialog", { name: "Phase details" });
    expect(within(phaseDetails).getByText("The checkout path is implemented.")).toBeTruthy();
    fireEvent.click(within(phaseDetails).getByRole("button", { name: "Task: Add replay protection" }));
    const taskDetails = screen.getByRole("dialog", { name: "Task details" });
    expect(within(taskDetails).getByText("failed")).toBeTruthy();
    fireEvent.click(within(taskDetails).getByRole("button", { name: "Back to phase" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Phase details" })).getByRole("button", { name: "Back to work item" }));

    const currentWorkDetails = screen.getByRole("dialog", { name: "Work item details" });
    fireEvent.click(within(currentWorkDetails).getByRole("button", { name: "Artifact: Implementation plan v2 · approved" }));
    const artifactDetails = screen.getByRole("dialog", { name: "Artifact details" });
    const unavailable = await within(artifactDetails).findByRole("status");
    expect(unavailable.textContent).toContain("Artifact content unavailable.");
    expect(unavailable.textContent).toContain("code host read failed");
    fireEvent.click(within(artifactDetails).getByRole("button", { name: "Back to work item" }));

    const reopenedWorkDetails = screen.getByRole("dialog", { name: "Work item details" });
    fireEvent.click(within(reopenedWorkDetails).getByRole("button", { name: "Artifact: Review notes v1 · awaiting" }));
    expect(await within(screen.getByRole("dialog", { name: "Artifact details" })).findByText("Observed review notes")).toBeTruthy();
    fireEvent.click(within(screen.getByRole("dialog", { name: "Artifact details" })).getByRole("button", { name: "Back to work item" }));

    const workDetailsAgain = screen.getByRole("dialog", { name: "Work item details" });
    fireEvent.click(within(workDetailsAgain).getByRole("button", { name: "Merge request: group/payments !19" }));
    const mrDetails = screen.getByRole("dialog", { name: "Merge request details" });
    expect(mrDetails.textContent).toContain("Pipeline: failed");
    expect(mrDetails.textContent).toContain("Jobs: 2 / 3");
    fireEvent.click(within(mrDetails).getByRole("button", { name: "Back to work item" }));
    fireEvent.click(within(screen.getByRole("dialog", { name: "Work item details" })).getByRole("button", { name: "Merge request: group/payments !20" }));
    expect(screen.getByRole("dialog", { name: "Merge request details" }).textContent).toContain("Pipeline: running");
  });

  test("agent details expose observed health, slot use, scope, and capabilities", () => {
    const dashboard = emptyDashboard();
    dashboard.specialists = [{ id: "reviewer-1", name: "Review analyst", role: "reviewer", runtime: "codex", status: "active", slotLimit: 2, scope: "Merge request review", capabilityTags: ["gitlab.discussion.review"] }];
    dashboard.recentTasks = [{ id: "task-1", title: "Review change", status: "running" }];
    render(<MissionControlShell board={{ status: "available", board: makeBoard([]) }} dashboard={dashboard} dashboardStatus="available"
      agentsStatus="available" agents={[{ id: "codex", kind: "codex", displayName: "Codex", health: { ok: false, reason: "Binary is missing" } }]}
      agentSlotsStatus="available" agentSlots={[{ id: "reviewer-1", slotLimit: 2, slotsInUse: 1, full: false }]}
      onAdvanced={vi.fn()} onPause={vi.fn()} onDecideAsk={vi.fn()} />);

    fireEvent.click(screen.getByRole("button", { name: "Agents" }));
    const agentButton = screen.getByRole("button", { name: "Details for Review analyst" });
    fireEvent.click(agentButton);
    const agentDetails = screen.getByRole("dialog", { name: "Agent details" });
    expect(agentDetails.textContent).toContain("Health: unavailable: Binary is missing");
    expect(agentDetails.textContent).toContain("Slots in use: 1 / 2");
    expect(agentDetails.textContent).toContain("Merge request review");
    expect(agentDetails.textContent).toContain("gitlab.discussion.review");
    expect(agentDetails.textContent).toContain("Review change · running");
    expect(agentDetails.textContent).toContain("specialist attribution unavailable");
    fireEvent.keyDown(window, { key: "Escape" });
    expect(document.activeElement).toBe(agentButton);
  });

  test("keeps decisions available when the agent slot read fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/sarathi/agents") throw new Error("slot read failed");
      const data = url === "/api/setup" ? { firstRun: false, steps: { workSource: true, codeHost: true, agent: true } }
        : url === "/api/mission-control/board" ? makeBoard([])
        : url === "/api/sarathi/dashboard" ? { runtime: { name: "Sarathi", state: "ready" }, controls: { manualPaused: false }, discovery: { status: "blocked", reason: "none", mergeRequests: [] }, tickets: [], asks: [{ id: "ask-1", kind: "review", workItemId: null, createdAt: "2026-09-23T10:00:00Z", intent: { tool: "review", context: {} } }] }
        : { agents: [] };
      return { ok: true, json: async () => data };
    }));
    render(<App />);
    expect(await screen.findByRole("heading", { name: "1 thing need you" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "Asks" }).textContent).toContain("review");
  });
});

function emptyDashboard() {
  return { asks: [], activity: [], specialists: [] as Array<{ id: string; name: string; role: string; runtime?: string; status: "pending_approval" | "active"; slotLimit: number; scope?: string; capabilityTags?: string[] }>, recentTasks: [] as Array<{ id: string; title: string; status: string }>, controls: { manualPaused: false }, runtime: { name: "Sarathi", state: "ready" as const } };
}

function makeBoard(workItems: MissionControlBoardItem[]): MissionControlBoard {
  return {
    workItems: { status: "available", data: workItems },
    gitLabDiscussions: { sync: { configured: false, state: "unconfigured", stale: false, lastAttemptAt: null, lastSuccessAt: null, lastFailureAt: null, lastError: null }, observations: [] }
  };
}

function makeWorkItem(id: string, title: string, trackStages: StageKind[] | null, stages: MissionControlBoardItem["workItem"]["stages"], count: { completed: number; total: number }, tasks: { completed: number; total: number } | null): MissionControlBoardItem {
  return {
    workItem: { id, title, workSourceKey: null, repositories: ["group/payments"], track: trackStages ? { stages: trackStages } : null, stages, createdAt: "2026-09-23T10:00:00Z" },
    stages: count,
    tasks,
    phases: { status: "available", data: [] },
    artifacts: { status: "available", data: [] },
    mergeRequests: { status: "available", data: [] }
  };
}
