import type { ProviderCatalog, ProviderCatalogAdapter, ProviderCatalogDiscovery } from "@aios/contracts";
import type { SarathiStore } from "./SarathiStore.js";

export interface ProviderCatalogRefresh {
  readonly status: "succeeded" | "failed";
  readonly catalog: ProviderCatalog | null;
}

/** Coordinates provider discovery while Sarathi retains the last trustworthy result. */
export class ProviderCatalogManager {
  private readonly adapters = new Map<string, ProviderCatalogAdapter>();

  constructor(
    adapters: ReadonlyArray<ProviderCatalogAdapter>,
    private readonly store: SarathiStore
  ) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.provider, adapter);
    }
  }

  async refresh(provider: string): Promise<ProviderCatalogRefresh | undefined> {
    const adapter = this.adapters.get(provider);
    if (!adapter) {
      return undefined;
    }

    try {
      const discovery = await adapter.discover();
      const catalog = normalizeCatalog(provider, discovery);
      this.store.recordProviderCatalog(catalog);
      return { status: "succeeded", catalog };
    } catch (error) {
      return { status: "failed", catalog: this.store.markProviderCatalogStale(provider, errorMessage(error)) };
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "provider catalog refresh failed";
}

function normalizeCatalog(provider: string, discovery: ProviderCatalogDiscovery): ProviderCatalog {
  return {
    provider,
    authenticationMode: discovery.authenticationMode,
    provenance: discovery.provenance,
    observedAt: discovery.observedAt,
    completeness: discovery.completeness,
    stale: false,
    refreshError: null,
    models: discovery.models.map((model) => ({
      id: `${provider}:${model.model}`,
      model: model.model,
      configured: model.configured,
      qualification: { ...model.qualification },
      eligible: model.configured && Object.values(model.qualification).every((evidence) => evidence === "qualified")
    }))
  };
}
