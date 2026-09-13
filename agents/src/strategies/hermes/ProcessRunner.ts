export interface HermesProcessOptions {
  profile?: string;
  homeDir?: string;
  sessionId?: string;
}

/**
 * ProcessRunner is the injectable seam between HermesAgent and the actual
 * `hermes` CLI child process. Production code uses RealProcessRunner (which
 * shells out via child_process.spawn); tests use FakeProcessRunner so they
 * never actually invoke the real binary.
 */
export interface ProcessRunner {
  /** Runs a one-shot task to completion, returns the final stdout text. */
  runOneShot(task: string, options?: HermesProcessOptions): Promise<string>;

  /** Checks CLI health cheaply; resolves true/false, never throws. */
  checkVersion(options?: HermesProcessOptions): Promise<boolean>;

  /** Tails logs starting now; calls onLine for each new line; returns a handle to stop tailing. */
  tailLogs(onLine: (line: string) => void, options?: HermesProcessOptions): { stop(): void };
}
