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

  async refreshAll(): Promise<void> {
    for (const provider of this.adapters.keys()) {
      await this.refresh(provider);
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
      enabled: model.enabled ?? model.configured,
      configured: model.configured,
      qualification: { ...model.qualification },
      tier: model.tier ?? "unclassified",
      ...(model.contextWindow === undefined ? {} : { contextWindow: model.contextWindow }),
      ...(model.modalities === undefined ? {} : { modalities: [...model.modalities] }),
      ...(model.locality === undefined ? {} : { locality: model.locality }),
      eligible: (model.enabled ?? model.configured) && model.configured &&
        Object.values(model.qualification).every((evidence) => evidence === "qualified")
    })),
    ...(discovery.securityStatus ? { securityStatus: discovery.securityStatus } : {}),
    ...(discovery.credentialReference ? { credentialReference: discovery.credentialReference } : {})
  };
}
