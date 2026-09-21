import type { FastifyInstance } from "fastify";
import { SECRET_COMMAND_REFERENCE, type CredentialManager } from "@aios/connectors";

/** HTTP boundary for reference-only credential configuration. Values never leave this request. */
export function registerCredentialRoutes(app: FastifyInstance, credentials: CredentialManager): void {
  app.post("/api/credentials/keychain", async (request, reply) => {
    const body = request.body as { reference?: unknown; value?: unknown; keychainEntry?: unknown };
    if (typeof body?.reference !== "string" || !body.reference.trim() || typeof body.value !== "string" || !body.value) {
      reply.code(400); return { error: "credential reference and value are required" };
    }
    if (body.keychainEntry !== undefined && (typeof body.keychainEntry !== "string" || !body.keychainEntry.trim())) {
      reply.code(400); return { error: "keychain entry must be a non-empty string" };
    }
    try {
      await credentials.saveToKeychain(body.reference, body.value, body.keychainEntry);
      return { credential: { reference: body.reference, source: "keychain", keychainEntry: body.keychainEntry ?? body.reference } };
    } catch (error) { reply.code(502); return { error: error instanceof Error ? error.message : "credential keychain save failed" }; }
  });
  app.post("/api/credentials/command", async (request, reply) => {
    const body = request.body as { reference?: unknown; commandReference?: unknown };
    if (typeof body?.reference !== "string" || !body.reference.trim() || typeof body.commandReference !== "string" || !SECRET_COMMAND_REFERENCE.test(body.commandReference)) {
      reply.code(400); return { error: "credential reference and environment-variable command reference are required" };
    }
    credentials.saveSecretCommand(body.reference, body.commandReference);
    return { credential: { reference: body.reference, source: "command", commandReference: body.commandReference } };
  });
}
