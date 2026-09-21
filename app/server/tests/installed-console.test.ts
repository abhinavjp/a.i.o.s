import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Fastify from "fastify";
import { afterEach, describe, expect, test } from "vitest";
import { registerInstalledConsoleFiles } from "../src/InstalledConsole.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe("installed console files", () => {
  test("serves the already-built browser console without building it", async () => {
    const directory = await mkdtemp(join(tmpdir(), "adhisthana-console-"));
    directories.push(directory);
    await writeFile(join(directory, "index.html"), "<main>installed console</main>", "utf8");
    await writeFile(join(directory, "app.js"), "console.log('installed')", "utf8");
    const app = Fastify();
    registerInstalledConsoleFiles(app, directory);
    try {
      expect((await app.inject({ method: "GET", url: "/" })).body).toContain("installed console");
      expect((await app.inject({ method: "GET", url: "/app.js" })).headers["content-type"]).toContain("application/javascript");
      expect((await app.inject({ method: "GET", url: "/work-items" })).body).toContain("installed console");
    } finally { await app.close(); }
  });
});
