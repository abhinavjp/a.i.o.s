import type { FastifyInstance } from "fastify";
import type { SarathiStore } from "../sarathi/SarathiStore.js";
import type { GitLabDiscussionSyncCoordinator } from "./GitLabDiscussionSyncCoordinator.js";

export function registerGitLabDiscussionSyncRoutes(app: FastifyInstance, sync: GitLabDiscussionSyncCoordinator, store: SarathiStore): void {
  app.get("/api/code-host/discussions/sync", async () => ({ sync: sync.status() }));
  app.post("/api/code-host/discussions/sync", async (_request, reply) => {
    const result = await sync.refresh();
    reply.code(result.state === "failed" ? 502 : 200);
    return { result, sync: store.snapshot().gitLabDiscussions.sync };
  });
}
