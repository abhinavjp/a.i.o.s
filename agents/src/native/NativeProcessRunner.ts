import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";

export interface NativeProcessResult {
  output: string;
  nativeSessionId?: string;
}

export interface NativeExecution {
  readonly lines: AsyncIterable<string>;
  readonly result: Promise<NativeProcessResult>;
  cancel(): void;
}

export interface NativeProcessRunnerPort {
  spawn(executable: string, argv: string[], options?: SpawnOptions): NativeExecution;
  check(executable: string, argv: string[], options?: SpawnOptions): Promise<boolean>;
}

/** Safe native boundary: executable and argv are always passed separately. */
export class NativeProcessRunner implements NativeProcessRunnerPort {
  spawn(executable: string, argv: string[], options: SpawnOptions = {}): NativeExecution {
    const child = spawn(executable, argv, { ...options, shell: false });
    const queue: string[] = [];
    let done = false;
    let wake: (() => void) | null = null;
    let stdout = "";
    let nativeSessionId: string | undefined;

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const lines = stdout.split(/\r?\n/);
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        queue.push(line);
        try {
          const parsed = JSON.parse(line) as { session_id?: unknown; thread_id?: unknown };
          const id = parsed.session_id ?? parsed.thread_id;
          if (typeof id === "string") nativeSessionId = id;
        } catch {
          // Non-JSON output is surfaced to the adapter as a malformed event.
        }
        wake?.();
        wake = null;
      }
    });
    const result = new Promise<NativeProcessResult>((resolve, reject) => {
      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
      child.once("error", reject);
      child.once("close", (code) => {
        done = true;
        wake?.();
        wake = null;
        if (code === 0) resolve({ output: stdout.trim(), nativeSessionId });
        else reject(new Error(`${executable} exited with code ${code}: ${stderr.trim()}`));
      });
    });

    const lines = (async function* (): AsyncGenerator<string> {
      while (!done || queue.length) {
        if (queue.length) { yield queue.shift()!; continue; }
        await new Promise<void>((resolve) => { wake = resolve; });
      }
    })();
    return { lines, result, cancel: () => cancelProcessTree(child) };
  }

  async check(executable: string, argv: string[], options: SpawnOptions = {}): Promise<boolean> {
    try {
      const execution = this.spawn(executable, argv, options);
      await execution.result;
      return true;
    } catch {
      return false;
    }
  }
}

function cancelProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    const killer = spawn("taskkill", ["/PID", String(child.pid), "/T", "/F"], { shell: false, stdio: "ignore" });
    killer.unref();
  } else {
    child.kill("SIGTERM");
  }
}
