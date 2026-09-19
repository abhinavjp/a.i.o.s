import type { FastifyInstance } from "fastify";
import type { WorkItemStore } from "../WorkItemStore.js";

interface CreateWorkItemBody { title?: unknown; repositories?: unknown; }

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
}
