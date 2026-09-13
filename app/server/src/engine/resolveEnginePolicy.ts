import type {
  EnginePolicy,
  EnginePolicyOverride,
  EnginePolicySource,
  EngineRoute,
  ResolvedEnginePlan
} from "@aios/contracts";

export interface EnginePolicyLayer {
  policy?: EnginePolicy | EnginePolicyOverride | null;
  version?: number | null;
}

export type EnginePolicyLayers = Partial<Record<EnginePolicySource, EnginePolicyLayer | EnginePolicy | null>>;

const SOURCES: EnginePolicySource[] = ["global", "agent", "workflow", "task"];
const EMPTY_ROUTE: EngineRoute = { engine: "hermes", configuration: "default", billingMode: "subscription" };

/** Resolve a task's immutable engine choice. Layers override fields, but fallback arrays are never concatenated. */
export function resolveEnginePolicy(layers: EnginePolicyLayers): ResolvedEnginePlan {
  const normalized = new Map<EnginePolicySource, EnginePolicyLayer>();
  for (const source of SOURCES) {
    const value = layers[source];
    normalized.set(source, normalizeLayer(value));
  }

  const primary = resolvePrimary(normalized);
  const fallbackLayer = firstDefined(normalized, "fallbacks");
  const enabledLayer = firstDefined(normalized, "fallbackEnabled");
  const fallbackEnabled = enabledLayer?.fallbackEnabled === true;
  const source = highestDefinedSource(normalized);

  return {
    primary,
    fallbacks: fallbackEnabled && fallbackLayer?.fallbacks ? fallbackLayer.fallbacks.map(cloneRoute) : [],
    source,
    configurationVersions: {
      task: normalized.get("task")?.version ?? null,
      workflow: normalized.get("workflow")?.version ?? null,
      agent: normalized.get("agent")?.version ?? null,
      global: normalized.get("global")?.version ?? null
    }
  };
}

function normalizeLayer(value: EnginePolicyLayers[EnginePolicySource]): EnginePolicyLayer {
  if (!value) return {};
  if ("policy" in value) return { policy: clonePolicy(value.policy ?? null), version: value.version ?? null };
  const policy = value as EnginePolicy & { version?: number };
  const { version = null, ...withoutVersion } = policy;
  return { policy: clonePolicy(withoutVersion), version };
}

function clonePolicy(value: EnginePolicy | EnginePolicyOverride | null): EnginePolicy | EnginePolicyOverride | null {
  if (!value) return null;
  return {
    ...value,
    primary: value.primary ? { ...value.primary } : undefined,
    fallbacks: value.fallbacks?.map(cloneRoute)
  };
}

function resolvePrimary(layers: Map<EnginePolicySource, EnginePolicyLayer>): EngineRoute {
  const route: EngineRoute = { ...EMPTY_ROUTE };
  for (const source of SOURCES) {
    const candidate = layers.get(source)?.policy?.primary;
    if (candidate) Object.assign(route, candidate);
  }
  return cloneRoute(route);
}

function firstDefined(
  layers: Map<EnginePolicySource, EnginePolicyLayer>,
  key: "fallbacks" | "fallbackEnabled"
): EnginePolicy | EnginePolicyOverride | undefined {
  for (const source of [...SOURCES].reverse()) {
    const policy = layers.get(source)?.policy;
    if (policy && policy[key] !== undefined) return policy;
  }
  return undefined;
}

function highestDefinedSource(layers: Map<EnginePolicySource, EnginePolicyLayer>): EnginePolicySource {
  for (const source of [...SOURCES].reverse()) {
    if (layers.get(source)?.policy) return source;
  }
  return "global";
}

function cloneRoute(route: EngineRoute): EngineRoute {
  return { ...route };
}
