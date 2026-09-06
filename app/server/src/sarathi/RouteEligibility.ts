import type { ResolvedExecutionPlan, ResolvedRoute } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";

export interface ExecutionPlanAdmissionValidator {
  validate(plan: ResolvedExecutionPlan): void;
}

export class IneligibleRouteError extends Error {}

/** Rejects known catalog entries that have not earned execution eligibility. */
export class ProviderCatalogEligibilityValidator implements ExecutionPlanAdmissionValidator {
  constructor(private readonly store: SarathiStore) {}

  validate(plan: ResolvedExecutionPlan): void {
    for (const route of [plan.route, ...plan.fallbackRoutes]) {
      this.validateRoute(route);
    }
  }

  private validateRoute(route: ResolvedRoute): void {
    if (route.billingMode === "unmeasured" || isExplicitFakeTestRoute(route)) {
      return;
    }
    const catalog = this.store.snapshot().providerCatalogs.find((candidate) => candidate.provider === route.provider);
    if (!catalog) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not in an observed provider catalog.`);
    }
    const model = catalog?.models.find((candidate) => candidate.model === route.model);
    if (!model) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not in the provider catalog.`);
    }
    if (model.eligible) {
      return;
    }
    if (!model.configured) {
      throw new IneligibleRouteError(`Route ${route.provider}:${route.model} is not configured.`);
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
