import type {
  AgentAbstraction,
  AgentInfo,
  HealthStatus,
  OrchestratorCapability,
  TaskStream
} from "@aios/contracts";
import type { ProcessRunner } from "./hermes/ProcessRunner.js";
import { RealProcessRunner } from "./hermes/RealProcessRunner.js";

/**
 * HermesAgent adapts the external `hermes` CLI to the AgentAbstraction
 * contract. It shells out via the injected ProcessRunner seam (see
 * ./hermes/ProcessRunner.ts) rather than calling child_process directly,
 * so it can be unit-tested deterministically with a FakeProcessRunner.
 */
export class HermesAgent implements AgentAbstraction {
  // checkHealth() must be synchronous per the shared AgentAbstraction contract,
  // but the only real health signal (`hermes --version`) is async and takes
  // ~9-10s. We default optimistically to { ok: true } (rather than a
  // pessimistic "not yet checked" failure) so the UI doesn't flash unhealthy
  // on a cold start before the first real check has had a chance to run --
  // this matches the optimistic default used by the other agent strategies
  // (FakeAgent, CustomAgent). A background recheck is kicked off on every
  // checkHealth() call and updates the cache for the *next* call.
  private cachedHealth: HealthStatus = { ok: true };

  constructor(private readonly runner: ProcessRunner = new RealProcessRunner()) {}

  getInfo(): AgentInfo {
    return { id: "hermes", kind: "hermes", displayName: "Hermes" };
  }

  checkHealth(): HealthStatus {
    // Fire-and-forget background recheck; intentionally not awaited. The
    // .catch is defensive insurance: checkVersion is documented to never
    // throw, but if a future ProcessRunner implementation violated that,
    // this would otherwise be an unhandled rejection.
    void this.runner
      .checkVersion()
      .then((ok) => {
        this.cachedHealth = HermesAgent.deriveHealth(ok);
      })
      .catch(() => {});

    return this.cachedHealth;
  }

  // Startup-only seam: checkHealth() can't do a real await (it's synchronous
  // per the shared contract), so on a cold process it always returns the
  // optimistic cached default even if hermes is genuinely absent -- a caller
  // that needs an accurate answer before wiring this agent in (e.g. the
  // composition root deciding whether to fall back at boot) should await
  // this once first; it updates the same cache checkHealth() reads.
  async warmUpHealth(): Promise<HealthStatus> {
    const ok = await this.runner.checkVersion().catch(() => false);
    this.cachedHealth = HermesAgent.deriveHealth(ok);
    return this.cachedHealth;
  }

  private static deriveHealth(ok: boolean): HealthStatus {
    return ok ? { ok: true } : { ok: false, reason: "hermes --version check failed" };
  }

  runTask(task: string, sessionKey: string): TaskStream {
    const runner = this.runner;

    // sessionKey is intentionally unused: Hermes ignores --resume <our-key>
    // and silently assigns its own session id, so wiring it into a CLI flag
    // here would be a no-op. Session-id mapping is deferred to a later slice.
    return (async function* (): TaskStream {
      const lineQueue: string[] = [];
      // Single-waiter invariant: at most one consumer ever awaits the queue
      // at a time (the generator loop itself, below), so a single slot is
      // enough here — this is not a general-purpose multi-waiter condition
      // variable.
      let pendingResolver: (() => void) | null = null;
      let tailDone = false;

      const wake = () => {
        if (pendingResolver) {
          const resolve = pendingResolver;
          pendingResolver = null;
          resolve();
        }
      };

      const tail = runner.tailLogs((line) => {
        lineQueue.push(line);
        wake();
      });

      const oneShotPromise = runner.runOneShot(task).finally(() => {
        tailDone = true;
        wake();
      });

      // Prevent an unhandled-rejection warning from the "background" copy of
      // the promise; the real rejection is still observed and rethrown below.
      oneShotPromise.catch(() => {});

      try {
        while (!tailDone || lineQueue.length > 0) {
          if (lineQueue.length > 0) {
            yield lineQueue.shift() as string;
            continue;
          }
          await new Promise<void>((resolve) => {
            pendingResolver = resolve;
          });
        }

        const finalText = await oneShotPromise;
        yield finalText;
      } finally {
        tail.stop();
      }
    })();
  }

  asOrchestrator(): OrchestratorCapability | null {
    // Stub only: declares the seam for Hermes's Kanban/delegate machinery.
    // Actual orchestration logic is out of scope for this slice.
    return { kind: "hermes-kanban" };
  }
}
