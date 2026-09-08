import { setTimeout } from "node:timers/promises";
import type { ResolvedRoute, RouteCircuit, RuntimeClock, RuntimeFailure, RuntimeRouter } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";
import { IneligibleRouteError } from "./RouteEligibility.js";

export const systemRuntimeClock: RuntimeClock = {
  now: Date.now, random: Math.random,
  sleep: async (ms, signal) => { await setTimeout(ms, undefined, { signal }); }
};

/** Circuit recovery is observable state, never an SDK retry side effect. */
export class RouteResilience {
  constructor(private readonly store: SarathiStore, readonly clock: RuntimeClock = systemRuntimeClock) {}

  assertAvailable(route: ResolvedRoute): void {
    const circuit = this.find(route);
    if (circuit?.state !== "open") return;
    if ((circuit.failureKind === "transient" || circuit.failureKind === "quota") && circuit.retryAt && Date.parse(circuit.retryAt) <= this.clock.now()) {
      this.success(route, true);
      return;
    }
    throw new IneligibleRouteError(`Route ${route.provider}:${route.model} circuit open (${circuit.failureKind}); ${circuit.retryAt ? `retry after ${circuit.retryAt}` : "configuration repair or successful probe required"}.`);
  }

  failure(route: ResolvedRoute, failure?: RuntimeFailure): void {
    const previous = this.find(route);
    if (!failure) { this.success(route); return; }
    // A later permanent failure upgrades an already-open transient/quota
    // circuit; late results cannot otherwise weaken open state.
    if (previous?.state === "open") {
      if (failure.kind === "authentication" || failure.kind === "configuration" ||
        (failure.kind === "quota" && previous.failureKind !== "authentication" && previous.failureKind !== "configuration")) {
        this.recordOpenFailure(route, failure);
      }
      return;
    }
    const consecutiveFailures = failure.kind === "transient" ? (previous?.failureKind === "transient" ? previous.consecutiveFailures : 0) + 1 : 0;
    const open = failure.kind === "transient" ? consecutiveFailures >= 3 : ["authentication", "configuration", "quota"].includes(failure.kind);
    const reportedReset = failure.resetAt && Number.isFinite(Date.parse(failure.resetAt)) ? failure.resetAt : null;
    this.store.recordCircuit({ route, state: open ? "open" : "closed", failureKind: failure.kind, consecutiveFailures,
      openedAt: open ? new Date(this.clock.now()).toISOString() : null,
      retryAt: open && failure.kind === "transient" ? new Date(this.clock.now() + 60_000).toISOString() : failure.kind === "quota" ? reportedReset : null });
  }

  private recordOpenFailure(route: ResolvedRoute, failure: RuntimeFailure): void {
    const retryAt = failure.kind === "quota" && failure.resetAt && Number.isFinite(Date.parse(failure.resetAt))
      ? failure.resetAt
      : null;
    this.store.recordCircuit({ route, state: "open", failureKind: failure.kind, consecutiveFailures: 0,
      openedAt: new Date(this.clock.now()).toISOString(), retryAt });
  }

  success(route: ResolvedRoute, recovered = false): void {
    const circuit = this.find(route);
    if (!circuit || (circuit.state === "open" && !recovered)) return;
    this.store.recordCircuit({ route, state: "closed", failureKind: null, consecutiveFailures: 0, openedAt: null, retryAt: null });
  }

  async probe(route: ResolvedRoute, router?: RuntimeRouter): Promise<boolean> {
    let recovered = false;
    try { recovered = (await router?.probe?.(route)) === true; } catch { /* Failure cannot authorize recovery. */ }
    if (recovered) this.success(route, true);
    return recovered;
  }

  private find(route: ResolvedRoute): RouteCircuit | undefined {
    return this.store.snapshot().routeCircuits.find((entry) => entry.route.runtime === route.runtime && entry.route.provider === route.provider && entry.route.model === route.model && entry.route.billingMode === route.billingMode);
  }
}
