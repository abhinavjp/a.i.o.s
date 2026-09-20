import type { FastifyInstance } from "fastify";
import { type ReleaseChannelConfiguration, type ReleaseChannelManager } from "../ReleaseChannel.js";
import type { PermissionEngine } from "../sarathi/PermissionEngine.js";

export function registerReleaseChannelRoutes(app: FastifyInstance, manager: ReleaseChannelManager, permissionEngine?: PermissionEngine) {
  app.get("/api/release-channel", async () => manager.configuration());
  app.put("/api/release-channel", async (request, reply) => {
    try {
      return manager.configure(request.body as ReleaseChannelConfiguration);
    } catch (error) {
      return reply.code(400).send({ error: error instanceof Error ? error.message : "release channel configuration is invalid" });
    }
  });
  app.post("/api/release-channel/check", async () => {
    const configuration = manager.configuration();
    const result = await manager.check(configuration);
    if (result.status !== "available" || !permissionEngine) return result;
    const { release } = result;
    const decision = await permissionEngine.execute({ tool: "system-update", operation: "apply", target: "installation", context: {
      version: release.version, channel: configuration.channel, notes: release.notes, download: release.download, checksum: release.checksum
    } });
    return { ...result, decision: decision.decision };
  });
}
