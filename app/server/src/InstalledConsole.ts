import { existsSync, readFileSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import type { FastifyInstance } from "fastify";

const MIME_TYPES: Record<string, string> = { ".css": "text/css; charset=utf-8", ".html": "text/html; charset=utf-8", ".js": "application/javascript; charset=utf-8", ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml" };

/** Serves the client bundle shipped with an installed package; it never invokes a build tool. */
export function registerInstalledConsoleFiles(app: FastifyInstance, clientDirectory: string): void {
  const root = resolve(clientDirectory);
  app.get("/*", async (request, reply) => {
    const requestPath = new URL(request.raw.url ?? "/", "http://localhost").pathname;
    const candidate = resolve(root, `.${requestPath === "/" ? "/index.html" : requestPath}`);
    const safeFile = candidate === root || candidate.startsWith(`${root}${sep}`) ? candidate : joinIndex(root);
    const file = existsSync(safeFile) && extname(safeFile) ? safeFile : joinIndex(root);
    if (!existsSync(file)) { reply.code(404); return { error: "installed console files are missing" }; }
    return reply.type(MIME_TYPES[extname(file)] ?? "application/octet-stream").send(readFileSync(file));
  });
}

function joinIndex(root: string): string { return resolve(root, "index.html"); }
