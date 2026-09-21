import { cpSync, mkdirSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
execFileSync("npm", ["run", "build", "-w", "app/client"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
execFileSync("npx", ["vite", "build", "--config", "vite.distribution.config.ts"], { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
const destination = resolve(root, "dist", "client");
rmSync(destination, { recursive: true, force: true });
mkdirSync(destination, { recursive: true });
cpSync(resolve(root, "app", "client", "dist"), destination, { recursive: true });
