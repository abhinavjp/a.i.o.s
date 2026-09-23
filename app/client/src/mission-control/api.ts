import type { MissionControlBoard } from "@aios/contracts";

export type BoardLoad =
  | { status: "loading" }
  | { status: "available"; board: MissionControlBoard }
  | { status: "error"; message: string }
  | { status: "unsupported" };

export type ActionResult = { ok: true } | { ok: false; message: string };
export type DecisionTier = "ask" | "automatic";
export type AutopilotSettings = { low: DecisionTier; medium: DecisionTier; high: DecisionTier };

export function decideCanonicalAsk(askId: string, decision: "approved" | "declined"): Promise<ActionResult> {
  return sendAction(`/api/sarathi/asks/${encodeURIComponent(askId)}/decide`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision })
  });
}

export function undoCanonicalAutomaticDecision(decisionId: string): Promise<ActionResult> {
  return sendAction(`/api/sarathi/automatic-decisions/${encodeURIComponent(decisionId)}/undo`, { method: "POST" });
}

export function resolveCanonicalStandingRuleSuggestion(id: string, action: "accept" | "dismiss"): Promise<ActionResult> {
  return sendAction(`/api/sarathi/standing-rule-suggestions/${encodeURIComponent(id)}/${action}`, { method: "POST" });
}

export function setCanonicalStandingRule(id: string, enabled: boolean): Promise<ActionResult> {
  return sendAction(`/api/sarathi/standing-rules/${encodeURIComponent(id)}`, {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ enabled })
  });
}

export function saveCanonicalAutopilot(settings: AutopilotSettings): Promise<ActionResult> {
  return sendAction("/api/sarathi/autopilot", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings)
  });
}

async function sendAction(url: string, init: RequestInit): Promise<ActionResult> {
  try {
    const response = await fetch(url, init);
    let body: { error?: unknown; admission?: { reason?: unknown } } = {};
    try { body = await response.json() as typeof body; } catch { /* status remains the canonical failure evidence */ }
    if (response.ok) return { ok: true };
    const message = typeof body.error === "string" ? body.error : typeof body.admission?.reason === "string" ? body.admission.reason : `Sarathi rejected the action (${response.status})`;
    return { ok: false, message };
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : "Sarathi action is unavailable" };
  }
}

export async function readMissionControlBoard(): Promise<BoardLoad> {
  try {
    const response = await fetch("/api/mission-control/board");
    if (response.ok === false) return { status: "error", message: `Mission Control read failed (${response.status})` };
    const data: unknown = await response.json();
    if (!isBoard(data)) return { status: "unsupported" };
    return { status: "available", board: data };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : "Mission Control is unavailable" };
  }
}

function isBoard(value: unknown): value is MissionControlBoard {
  if (!value || typeof value !== "object") return false;
  const board = value as Partial<MissionControlBoard>;
  if (!board.workItems || typeof board.workItems !== "object" || !board.gitLabDiscussions || !Array.isArray(board.gitLabDiscussions.observations)) return false;
  const region = board.workItems;
  if (region.status === "available") return Array.isArray(region.data) && region.data.every((item) =>
    !!item && typeof item === "object" && !!item.workItem && typeof item.workItem.id === "string" && typeof item.workItem.title === "string" &&
    !!item.stages && typeof item.stages.completed === "number" && typeof item.stages.total === "number" &&
    (item.tasks === null || !!item.tasks && typeof item.tasks.completed === "number" && typeof item.tasks.total === "number"));
  return (region.status === "unavailable" || region.status === "error") && typeof region.reason === "string";
}
