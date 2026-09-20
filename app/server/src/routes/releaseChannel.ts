import type { FastifyInstance } from "fastify";
import { type ReleaseChannelConfiguration, type ReleaseChannelManager } from "../ReleaseChannel.js";

export function registerReleaseChannelRoutes(app: FastifyInstance, manager: ReleaseChannelManager) {
  app.get("/api/release-channel", async () => manager.configuration());
  app.put("/api/release-channel", async (request, reply) => {
    try {
      return manager.configure(request.body as ReleaseChannelConfiguration);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "release channel configuration is invalid" });
    }
  });
  app.post("/api/release-channel/check", async () => manager.check());
}
