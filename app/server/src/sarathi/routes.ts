import type { FastifyInstance } from "fastify";
import type { SarathiStore } from "./SarathiStore.js";

interface PauseBody {
  paused: boolean;
}

interface SpecialistBody {
  name: string;
  role: string;
  runtime?: string;
}

interface SpecialistParams {
  id: string;
}

export function registerSarathiRoutes(app: FastifyInstance, store: SarathiStore): void {
  app.get("/api/sarathi/dashboard", async () => store.snapshot());

  app.post<{ Body: PauseBody }>(
    "/api/sarathi/control/pause",
    async (request, reply) => {
      if (typeof request.body?.paused !== "boolean") {
        reply.code(400);
        return { error: "paused must be a boolean" };
      }
      return store.setPaused(request.body.paused);
    }
  );

  app.post("/api/sarathi/discovery/check", async () => store.checkDiscovery());

  app.post<{ Body: SpecialistBody }>(
    "/api/sarathi/specialists",
    async (request, reply) => {
      const { name, role, runtime = "unselected" } = request.body ?? {};
      if (!name?.trim() || !role?.trim()) {
        reply.code(400);
        return { error: "name and role are required" };
      }
      const specialist = store.createSpecialist({ name, role, runtime });
      reply.code(201);
      return { specialist };
    }
  );

  app.post<{ Params: SpecialistParams }>(
    "/api/sarathi/specialists/:id/approve",
    async (request, reply) => {
      const specialist = store.approveSpecialist(request.params.id);
      if (!specialist) {
        reply.code(404);
        return { error: "Specialist not found" };
      }
      return { specialist };
    }
  );
}
