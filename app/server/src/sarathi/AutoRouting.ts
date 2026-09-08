import type {
  AutoComplexity,
  AutoRouteRequirements,
  ModelTier,
  ProviderCatalog,
  ProviderCatalogModel,
  ResolvedExecutionPlan,
  ResolvedRoute,
  RouteSelection
} from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";
import type { RouteResilience } from "./RouteResilience.js";
import { IneligibleRouteError } from "./RouteEligibility.js";

export interface AutoRoutingOptions {
  readonly requirements?: AutoRouteRequirements;
  readonly override?: ResolvedRoute;
  readonly health?: (route: ResolvedRoute) => boolean;
  readonly classifier?: (task: string) => Promise<AutoComplexity>;
}

export interface AutoRouteDecision {
  readonly classification: AutoComplexity;
  readonly evidence: string;
  readonly candidates: ReadonlyArray<ResolvedRoute>;
  readonly selected: ResolvedRoute;
  readonly reason: string;
  readonly operatorOverride: boolean;
}

/** Deterministic, catalog-backed Auto selection. Unknown capability/tier is never promoted. */
export class AutoRouteSelector {
  constructor(
    private readonly store: SarathiStore,
    private readonly resilience?: RouteResilience,
    private readonly defaults: AutoRoutingOptions = {}
  ) {}

  async select(plan: ResolvedExecutionPlan, options: AutoRoutingOptions = {}): Promise<ResolvedExecutionPlan> {
    const effectiveOptions = { ...this.defaults, ...options, requirements: { ...this.defaults.requirements, ...options.requirements } };
    const requested = plan.route;
    if (!isAutoRoute(requested) && !effectiveOptions.override) return plan;
    if (effectiveOptions.override) {
      const selection = this.selection(requested, effectiveOptions.override, "operator override", "operator supplied an explicit route", [], true);
      return { ...plan, route: { ...effectiveOptions.override }, selection };
    }
    const classificationResult = await this.classify(plan.taskText ?? "", effectiveOptions.classifier);
    const classification = classificationResult.classification;
    const candidates = this.candidates(plan, effectiveOptions.requirements, effectiveOptions.health);
    const adequate = candidates.filter((candidate) => tierRank(candidate.tier) >= requiredTierRank(classification));
    if (!adequate.length) {
      throw new IneligibleRouteError(`Auto route has no eligible model at or above ${classification} complexity.`);
    }
    adequate.sort(compareCandidates);
    const selected = adequate[0]!;
    this.resilience?.assertAvailable(selected.route);
    const reason = `auto selected lowest adequate ${selected.tier} tier after filtering ${candidates.length} eligible candidate(s); ${selected.catalog.securityStatus === "unmeasured" ? "transport security UNMEASURED; " : ""}classification=${classification}.`;
    const selection = this.selection(requested, selected.route,
      reason, classificationResult.evidence, adequate.map((candidate) => candidate.route), false, classification);
    return { ...plan, route: { ...selected.route }, selection };
  }

  /** Optional classifier hook is deliberately separate; deterministic routing remains available if it fails. */
  async classify(task: string, classifier = this.defaults.classifier): Promise<{ classification: AutoComplexity; evidence: string }> {
    const deterministic = classifyTask(task);
    if (deterministic !== "ambiguous") {
      return { classification: deterministic, evidence: classificationEvidence(task, deterministic) };
    }
    if (classifier) {
      try { return { classification: await classifier(task), evidence: "optional classifier result" }; }
      catch { return { classification: deterministic, evidence: `${classificationEvidence(task, deterministic)}; optional classifier unavailable` }; }
    }
    return { classification: deterministic, evidence: classificationEvidence(task, deterministic) };
  }

  private candidates(plan: ResolvedExecutionPlan, requirements?: AutoRouteRequirements, health?: (route: ResolvedRoute) => boolean): Array<{ route: ResolvedRoute; tier: ModelTier; catalog: ProviderCatalog }> {
    const requested = plan.route;
    const catalogs = this.store.snapshot().providerCatalogs;
    const result: Array<{ route: ResolvedRoute; tier: ModelTier; catalog: ProviderCatalog }> = [];
    for (const catalog of catalogs) {
      if (requested.provider !== "auto" && requested.provider !== catalog.provider) continue;
      if (requirements?.allowedProviders && !requirements.allowedProviders.includes(catalog.provider)) continue;
      for (const model of catalog.models) {
        if (!model.enabled || !model.configured || !model.eligible || model.tier === "unclassified") continue;
        if (!meetsRequirements(model, requirements)) continue;
        const route: ResolvedRoute = { runtime: runtimeForProvider(catalog.provider), provider: catalog.provider,
          model: model.model, billingMode: billingForCatalog(catalog) };
        if (health && !health(route)) continue;
        try { this.resilience?.assertAvailable(route); } catch { continue; }
        result.push({ route, tier: model.tier, catalog });
      }
    }
    return result;
  }

  private selection(requested: ResolvedRoute, effective: ResolvedRoute, reason: string, evidence: string,
    candidates: ReadonlyArray<ResolvedRoute>, operatorOverride: boolean, classification?: AutoComplexity): RouteSelection {
    const catalog = this.store.snapshot().providerCatalogs.find((entry) => entry.provider === effective.provider);
    return { requestedRoute: { ...requested }, effectiveRoute: { ...effective },
      authenticationMode: catalog?.authenticationMode ?? "unmeasured", billingMode: effective.billingMode,
      reason, classification, classificationEvidence: evidence,
      candidates: candidates.map((candidate) => `${candidate.provider}:${candidate.model}`), operatorOverride };
  }
}

function isAutoRoute(route: ResolvedRoute): boolean {
  return route.runtime.toLowerCase() === "auto" || route.provider.toLowerCase() === "auto" || route.model.toLowerCase() === "auto";
}

function meetsRequirements(model: ProviderCatalogModel, requirements?: AutoRouteRequirements): boolean {
  if (!requirements) return true;
  if (requirements.allowedTiers && !requirements.allowedTiers.includes(model.tier)) return false;
  if (requirements.contextWindow !== undefined && (typeof model.contextWindow !== "number" || model.contextWindow < requirements.contextWindow)) return false;
  if (requirements.modality && !(model.modalities ?? ["text"]).includes(requirements.modality)) return false;
  if (requirements.locality && model.locality !== requirements.locality) return false;
  if (requirements.requiredTools?.length && model.qualification.toolCalling !== "qualified") return false;
  return true;
}

function classifyTask(task: string): AutoComplexity {
  const normalized = task.toLowerCase();
  if (!normalized.trim()) return "ambiguous";
  if (/(architecture|debug|security|threat|multi[- ]step|complex|design|refactor)/.test(normalized) || normalized.length > 900) return "frontier";
  if (/(extract|format|summari[sz]e|translate|classify|rewrite|list|convert)/.test(normalized) && normalized.length < 500) return "economy";
  if (normalized.trim().split(/\s+/).length <= 3) return "ambiguous";
  return "workhorse";
}

function classificationEvidence(task: string, classification: AutoComplexity): string {
  return `deterministic signals classified ${classification} (length=${task.length})`;
}

function requiredTierRank(classification: AutoComplexity): number {
  return classification === "economy" ? 0 : classification === "workhorse" ? 1 : classification === "frontier" ? 2 : 1;
}

function tierRank(tier: ModelTier): number {
  return tier === "economy" ? 0 : tier === "workhorse" ? 1 : tier === "frontier" ? 2 : -1;
}

function compareCandidates(left: { route: ResolvedRoute; tier: ModelTier }, right: { route: ResolvedRoute; tier: ModelTier }): number {
  return tierRank(left.tier) - tierRank(right.tier) || left.route.provider.localeCompare(right.route.provider) || left.route.model.localeCompare(right.route.model);
}

function runtimeForProvider(provider: string): string {
  return provider === "ollama" || provider === "openai" || provider === "anthropic" || provider === "openrouter" || provider === "custom-openai-compatible" ? provider : "ai-sdk";
}

function billingForCatalog(catalog: ProviderCatalog): ResolvedRoute["billingMode"] {
  if (catalog.authenticationMode === "subscription") return "subscription";
  if (["openai", "anthropic", "openrouter", "custom-openai-compatible"].includes(catalog.provider)) return "api";
  return "unmeasured";
}

