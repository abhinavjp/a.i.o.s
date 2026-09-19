import type { FastifyInstance } from "fastify";
import type { WorkItemStore } from "../WorkItemStore.js";
import type { StageKind } from "@aios/contracts";

interface CreateWorkItemBody { title?: unknown; repositories?: unknown; }
interface ApproveTrackBody { startingPoint?: unknown; }

const STARTING_POINTS: Record<string, StageKind[]> = {
  full: ["functional-analysis", "technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  standard: ["technical-analysis", "spec-and-eval", "plan", "implementation", "final-review", "merge"],
  fast: ["plan", "implementation", "merge"],
  "analysis-only": ["functional-analysis", "technical-analysis"]
};

export function registerWorkItemRoutes(app: FastifyInstance, store: WorkItemStore): void {
  app.get("/api/work-items", async () => ({ workItems: store.list() }));
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
}
