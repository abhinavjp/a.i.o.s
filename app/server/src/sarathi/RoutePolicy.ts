import type { ResolvedRoute, RoutePolicyOverride } from "@aios/contracts";

export function isRoutePolicyOverride(value: unknown): value is RoutePolicyOverride {
  if (!isPlainObject(value) || !Object.keys(value).every((key) => key === "primary" || key === "fallbacks")) return false;
  const policy = value as RoutePolicyOverride;
  return (policy.primary === undefined || isResolvedRoute(policy.primary)) &&
    (policy.fallbacks === undefined || (Array.isArray(policy.fallbacks) && policy.fallbacks.every(isResolvedRoute)));
}

export function isResolvedRoute(value: unknown): value is ResolvedRoute {
  if (!isPlainObject(value) || !Object.keys(value).every((key) => ["runtime", "provider", "model", "billingMode"].includes(key))) return false;
  const route = value as unknown as ResolvedRoute;
  return [route.runtime, route.provider, route.model].every(
    (field) => typeof field === "string" && field.trim().length > 0
  ) && ["fake", "subscription", "api", "unmeasured"].includes(route.billingMode);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
