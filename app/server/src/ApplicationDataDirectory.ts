import { homedir } from "node:os";
import { join } from "node:path";

export function applicationDataDirectory(): string {
  const configured = process.env.AIOS_DATA_DIR?.trim();
  if (configured) return configured;

  return process.platform === "win32"
    ? join(process.env.APPDATA ?? join(homedir(), "AppData", "Roaming"), "adhisthana")
    : join(homedir(), ".local", "share", "adhisthana");
}
