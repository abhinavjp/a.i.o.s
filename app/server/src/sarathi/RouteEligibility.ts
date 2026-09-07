import type { ResolvedExecutionPlan, ResolvedRoute, RouteSelection } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";
import type { RouteResilience } from "./RouteResilience.js";

export interface ExecutionPlanAdmissionValidator {
  validate(plan: ResolvedExecutionPlan): void;
}

export interface FixedRouteSelector {
  select(plan: ResolvedExecutionPlan): ResolvedExecutionPlan;
}

export class IneligibleRouteError extends Error {}

/** Rejects known catalog entries that have not earned execution eligibility. */
export class ProviderCatalogEligibilityValidator implements ExecutionPlanAdmissionValidator, FixedRouteSelector {
  constructor(private readonly store: SarathiStore, private readonly resilience?: RouteResilience) {}

  validate(plan: ResolvedExecutionPlan): void {
    for (const route of [plan.route, ...plan.fallbackRoutes]) {
      this.validateRoute(route);
    }
  }

  select(plan: ResolvedExecutionPlan): ResolvedExecutionPlan {
    this.resilience?.assertAvailable(plan.route);
    const authenticationMode = this.validateRoute(plan.route);
    const selection: RouteSelection = {
      requestedRoute: { ...plan.route },
      effectiveRoute: { ...plan.route },
      authenticationMode,
      billingMode: plan.route.billingMode,
      reason: isExplicitFakeTestRoute(plan.route)
        ? "fixed route selected through the explicit deterministic fake test seam."
        : "fixed route selected: enabled, healthy, configured, and capability-qualified."
    };
    return { ...plan, selection };
  }

  private validateRoute(route: ResolvedRoute): RouteSelection["authenticationMode"] {
    if ((route.runtime === "unmeasured" && route.billingMode === "unmeasured") || isExplicitFakeTestRoute(route)) {
      return route.runtime === "fake" ? "fake" : "unmeasured";
    }
    const catalog = this.store.snapshot().providerCatalogs.find((candidate) => candidate.provider === route.provider);
    if (!catalog) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not in an observed provider catalog.`);
    }
    const model = catalog?.models.find((candidate) => candidate.model === route.model);
    if (!model) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not in the provider catalog.`);
    }
    if (!model.configured) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not configured.`);
    }
    if (!model.enabled) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not enabled.`);
    }
    if (model.eligible) {
      return catalog.authenticationMode;
    }
    const qualification = Object.entries(model.qualification).find(([, evidence]) => evidence !== "qualified");
    const [capability, evidence] = qualification ?? ["capability", "unknown"];
    throw new IneligibleRouteError(
      `Route ${route.provider}:${route.model} qualification evidence for ${capability} is ${evidence}.`
    );
  }
}

/** Temporary, explicit compatibility for the local deterministic fake seam. */
function isExplicitFakeTestRoute(route: ResolvedRoute): boolean {
  return route.runtime === "fake" && route.billingMode === "fake" && (route.provider === "fake" || route.provider === "test");
}
