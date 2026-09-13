import { spawn } from "node:child_process";
import type { HermesProcessOptions, ProcessRunner } from "./ProcessRunner.js";

/**
 * RealProcessRunner shells out to the actual `hermes` CLI binary via
 * child_process.spawn. This is the production implementation of
 * ProcessRunner; it is not exercised by unit tests (see FakeProcessRunner).
 */
export class RealProcessRunner implements ProcessRunner {
  async runOneShot(task: string, options: HermesProcessOptions = {}): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn("hermes", ["-z", task, "--profile", options.profile ?? "default", "--pass-session-id"], {
        shell: false,
        env: hermesEnv(options)
      });

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

  async checkVersion(options: HermesProcessOptions = {}): Promise<boolean> {
    return new Promise((resolve) => {
      try {
        const child = spawn("hermes", ["--version", "--profile", options.profile ?? "default"], { shell: false, env: hermesEnv(options) });

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

  tailLogs(onLine: (line: string) => void, options: HermesProcessOptions = {}): { stop(): void } {
    // Bare `hermes logs -f` dumps its default ~50-line backlog before
    // following (`--since 1s` avoids that); it also logs ~25 lines of plugin
    // registration chatter from the `cli` component on EVERY fresh `hermes`
    // process (confirmed live -- this isn't stale backlog, it's genuine
    // per-invocation startup noise from Hermes' own plugin loader). Scoping
    // Component-wide tails cannot attribute output to a task. The explicit
    // profile/home is the isolation boundary; native session attribution is
    // retained when the CLI exposes it.
    const child = spawn("hermes", ["logs", "-f", "--since", "1s"], { shell: false, env: hermesEnv(options) });

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

function hermesEnv(options: HermesProcessOptions): NodeJS.ProcessEnv {
  return options.homeDir ? { ...process.env, HERMES_HOME: options.homeDir } : process.env;
}
