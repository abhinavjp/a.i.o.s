import type { FastifyInstance } from "fastify";
import type { WorkItemStore } from "../WorkItemStore.js";
import type { StageKind, StageState } from "@aios/contracts";
import type { WorkSource } from "@aios/connectors";

interface CreateWorkItemBody { title?: unknown; repositories?: unknown; }
interface ApproveTrackBody { startingPoint?: unknown; }
interface SetStageStateBody { state?: unknown; }

const STARTING_POINTS: Record<string, StageKind[]> = {
  full: ["functional-analysis", "technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  standard: ["technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  fast: ["plan", "implementation", "merge"],
  "analysis-only": ["functional-analysis", "technical-analysis"]
};
const STAGE_STATES: StageState[] = ["not-started", "running", "waiting", "blocked", "done", "skipped"];

export function registerWorkItemRoutes(app: FastifyInstance, store: WorkItemStore, workSource?: WorkSource): void {
  app.get("/api/work-items", async () => ({ workItems: store.list() }));
  app.post("/api/work-items/import", async () => {
    const tickets = await workSource?.listAssignedTickets() ?? [];
    const imported = tickets.map((ticket) => store.import({ workSourceKey: ticket.key, title: ticket.title })).filter(Boolean);
    return { imported: imported.length, skipped: tickets.length - imported.length, workItems: store.list() };
  });
  app.post<{ Body: CreateWorkItemBody }>("/api/work-items", async (request, reply) => {
    const { title, repositories } = request.body ?? {};
    if (typeof title !== "string" || !title.trim()) { reply.code(400); return { error: "title is required" }; }
    if (!Array.isArray(repositories) || repositories.some((repository) => typeof repository !== "string" || !repository.trim())) {
      reply.code(400); return { error: "repositories must be a list of names" };
    }
    const workItem = store.create({ title, repositories: repositories.map((repository) => repository.trim()) });
    reply.code(201);
    return { workItem };
  });
  app.post<{ Params: { workItemId: string }; Body: ApproveTrackBody }>("/api/work-items/:workItemId/track", async (request, reply) => {
    const startingPoint = request.body?.startingPoint;
    if (typeof startingPoint !== "string" || !STARTING_POINTS[startingPoint]) {
      reply.code(400); return { error: "startingPoint must be full, standard, fast, or analysis-only" };
    }
    try {
      return { workItem: store.approveTrack(request.params.workItemId, STARTING_POINTS[startingPoint]) };
    } catch (error) {
      reply.code(400); return { error: error instanceof Error ? error.message : "track could not be approved" };
    }
  });
  app.put<{ Params: { workItemId: string; stageKind: StageKind }; Body: SetStageStateBody }>("/api/work-items/:workItemId/stages/:stageKind", async (request, reply) => {
    const state = request.body?.state;
    if (typeof state !== "string" || !STAGE_STATES.includes(state as StageState)) {
      reply.code(400); return { error: "state must be not-started, running, waiting, blocked, done, or skipped" };
    }
    try { return { workItem: store.setStageState(request.params.workItemId, request.params.stageKind, state as StageState) }; }
    catch (error) { reply.code(400); return { error: error instanceof Error ? error.message : "stage could not be updated" }; }
  });
}
