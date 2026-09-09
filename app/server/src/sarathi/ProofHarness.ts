import type { LiveProofRoute, RuntimeProof } from "@aios/contracts";

export interface LiveProofHarness {
  prove(route: LiveProofRoute, optIn: boolean): Promise<RuntimeProof>;
}

export type LiveProofProbe = () => Promise<{ ok: boolean; reason?: string }>;

/** Opt-in-only proof runner. It never guesses entitlement or executes an external effect by itself. */
export class OptInProofHarness implements LiveProofHarness {
  constructor(private readonly probes: Partial<Record<LiveProofRoute, LiveProofProbe>> = {}) {}

  async prove(route: LiveProofRoute, optIn: boolean): Promise<RuntimeProof> {
    const checkedAt = new Date().toISOString();
    if (!optIn) return { route, status: "UNMEASURED", reason: "Proof is opt-in; no provider call was made.", checkedAt: null };
    const probe = this.probes[route];
    if (!probe) return { route, status: "UNMEASURED", reason: "Missing credentials, account, endpoint, model, or authorized fixture.", checkedAt };
    try {
      const result = await probe();
      return result.ok ? { route, status: "passed", reason: "Authorized bounded contract probe passed.", checkedAt }
        : { route, status: "failed", reason: result.reason ?? "Authorized contract probe failed.", checkedAt };
    } catch (error) {
      return { route, status: "failed", reason: error instanceof Error ? error.message : "Authorized contract probe failed.", checkedAt };
    }
  }
}
