import type { EngineReadiness, HealthStatus } from "@aios/contracts";

export function readinessFromHealth(health: HealthStatus, checkedAt = new Date().toISOString()): EngineReadiness {
  if (!health.ok && /unmeasured/i.test(health.reason)) {
    return { state: "unmeasured", reason: health.reason, checkedAt };
  }
  return health.ok
    ? { state: "ready", reason: "engine health check passed", checkedAt }
    : { state: "unavailable", reason: health.reason, checkedAt };
}

export function unmeasuredReadiness(reason: string, checkedAt = new Date().toISOString()): EngineReadiness {
  return { state: "unmeasured", reason, checkedAt };
}
