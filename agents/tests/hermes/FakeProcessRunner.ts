import type { ProcessRunner } from "../../src/strategies/hermes/ProcessRunner.js";

/**
 * Deterministic, in-memory ProcessRunner for tests. Configure canned
 * behaviour via the constructor options, then hand this to HermesAgent
 * instead of RealProcessRunner so tests never shell out to the real
 * `hermes` binary.
 */
export class FakeProcessRunner implements ProcessRunner {
  public readonly tailStopped: boolean[] = [];
  private stopCalls = 0;

  constructor(
    private readonly options: {
      /** Lines to synchronously emit via onLine when tailLogs() is called. */
      logLines?: string[];
      /** Resolved value (or rejection) for runOneShot. */
      oneShotResult?: { kind: "resolve"; value: string } | { kind: "reject"; error: unknown };
      /** Resolved value for checkVersion. */
      versionResult?: boolean;
      /**
       * How long (ms, via setTimeout) runOneShot waits before settling.
       * Use together with lateLines to land an onLine call while runOneShot
       * is still pending, so tests can exercise genuine async interleaving
       * rather than draining an already-fully-populated queue.
       */
      oneShotDelayMs?: number;
      /**
       * Lines emitted asynchronously (each via its own setTimeout(0)) after
       * tailLogs() returns, independent of the synchronous logLines above.
       */
      lateLines?: string[];
    } = {}
  ) {}

  async runOneShot(task: string): Promise<string> {
    const result = this.options.oneShotResult ?? { kind: "resolve", value: `ran: ${task}` };

    if (this.options.oneShotDelayMs !== undefined) {
      await new Promise((resolve) => setTimeout(resolve, this.options.oneShotDelayMs));
    }

    if (result.kind === "reject") {
      throw result.error;
    }
    return result.value;
  }

  async checkVersion(): Promise<boolean> {
    return this.options.versionResult ?? true;
  }

  tailLogs(onLine: (line: string) => void): { stop(): void } {
    for (const line of this.options.logLines ?? []) {
      onLine(line);
    }

    for (const line of this.options.lateLines ?? []) {
      setTimeout(() => onLine(line), 0);
    }

    return {
      stop: () => {
        this.stopCalls += 1;
        this.tailStopped.push(true);
      }
    };
  }

  get stopCallCount(): number {
    return this.stopCalls;
  }
}
