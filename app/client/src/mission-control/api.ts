import type { MissionControlBoard } from "@aios/contracts";

export type BoardLoad =
  | { status: "loading" }
  | { status: "available"; board: MissionControlBoard }
  | { status: "error"; message: string }
  | { status: "unsupported" };

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
