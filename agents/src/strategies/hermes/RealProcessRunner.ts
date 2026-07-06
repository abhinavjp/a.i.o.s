import { spawn } from "node:child_process";
import type { ProcessRunner } from "./ProcessRunner.js";

/**
 * RealProcessRunner shells out to the actual `hermes` CLI binary via
 * child_process.spawn. This is the production implementation of
 * ProcessRunner; it is not exercised by unit tests (see FakeProcessRunner).
 */
export class RealProcessRunner implements ProcessRunner {
  async runOneShot(task: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("hermes", ["-z", task, "--pass-session-id"]);

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      child.on("error", (error) => {
        reject(error);
      });

      child.on("close", (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`hermes exited with code ${code}: ${stderr.trim()}`));
        }
      });
    });
  }

  async checkVersion(): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = spawn("hermes", ["--version"]);

        child.on("error", () => {
          resolve(false);
        });

        child.on("close", (code) => {
          resolve(code === 0);
        });
      } catch {
        resolve(false);
      }
    });
  }

  tailLogs(onLine: (line: string) => void): { stop(): void } {
    // Bare `hermes logs -f` dumps its default ~50-line backlog before
    // following (`--since 1s` avoids that); it also logs ~25 lines of plugin
    // registration chatter from the `cli` component on EVERY fresh `hermes`
    // process (confirmed live -- this isn't stale backlog, it's genuine
    // per-invocation startup noise from Hermes' own plugin loader). Scoping
    // to `--component agent` keeps the tail to the agent's own activity,
    // which is what a per-task stream should actually show.
    const child = spawn("hermes", ["logs", "-f", "--since", "1s", "--component", "agent"]);

    let buffer = "";
    child.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        // Skip the "--- <path> (Ctrl+C to stop) ---" banner hermes prints
        // when a log file is opened -- it's CLI chrome, not task signal.
        if (line.trim().length > 0 && !line.startsWith("---")) {
          onLine(line);
        }
      }
    });

    return {
      stop: () => {
        child.kill();
      }
    };
  }
}
