import type {
  ProviderCatalogAdapter,
  ProviderCatalogDiscovery,
  ResolvedRoute,
  RoutedExecutionInput,
  RuntimeRouter
} from "@aios/contracts";
import type { RuntimeAdapterRegistration, ToolLoopProvider, ToolLoopProviderEvent, ToolLoopProviderInput } from "./RuntimeAdapters.js";
import type { ToolDefinition } from "@aios/contracts";
import { AiSdkToolLoopRuntimeAdapter } from "./RuntimeAdapters.js";

/** Transport boundary shared by local, on-premises, direct API, and aggregate providers. */
export interface ProviderTransport extends ToolLoopProvider {
  discover?(): Promise<ProviderCatalogDiscovery>;
}

export interface ProviderEndpointOptions {
  readonly endpoint?: string;
  readonly credentialEnvVar?: string;
  readonly allowlistedHosts?: ReadonlyArray<string>;
}

export interface ProviderRuntimeAdapterOptions extends ProviderEndpointOptions {
  readonly transport?: ProviderTransport;
  readonly tools?: ReadonlyArray<ToolDefinition>;
  readonly models?: ReadonlyArray<ProviderCatalogDiscovery["models"][number]>;
  readonly authenticationMode?: ProviderCatalogDiscovery["authenticationMode"];
  readonly provenance?: string;
}

export interface ProviderRuntimeRegistration extends RuntimeAdapterRegistration {
  readonly provider: string;
  readonly adapter: ProviderRuntimeAdapter;
}

/** Resolves only whether a named environment credential exists; secret values never leave the process. */
export class EnvironmentCredentialResolver {
  resolve(envVar: string | undefined): { configured: boolean; reference: string | null } {
    const reference = envVar?.trim() || null;
    return { configured: Boolean(reference && process.env[reference]), reference };
  }
}

/** Explicit endpoint security disclosure used by custom/on-premises discovery. */
export function endpointSecurityStatus(options: ProviderEndpointOptions): "measured" | "unmeasured" {
  if (!options.endpoint) return "unmeasured";
  let url: URL;
  try { url = new URL(options.endpoint); } catch { return "unmeasured"; }
  const host = url.hostname.toLowerCase();
  const loopback = host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  if (loopback) return "measured";
  const allowlisted = options.allowlistedHosts?.some((candidate) => candidate.toLowerCase() === host) ?? false;
  return url.protocol === "https:" && Boolean(options.credentialEnvVar) && allowlisted ? "measured" : "unmeasured";
}

/** Generic provider adapter: discovery/catalog and execution stay injectable and provider-neutral. */
export class ProviderRuntimeAdapter implements ProviderCatalogAdapter, RuntimeRouter {
  readonly runtime: string;
  readonly provider: string;
  private readonly loop: AiSdkToolLoopRuntimeAdapter;
  private readonly credentials = new EnvironmentCredentialResolver();

  constructor(provider: string, runtime: string, private readonly options: ProviderRuntimeAdapterOptions = {}) {
    this.provider = provider;
    this.runtime = runtime;
    this.loop = new AiSdkToolLoopRuntimeAdapter({ provider: options.transport ?? unavailableTransport(), tools: options.tools });
  }

  run(input: RoutedExecutionInput): AsyncIterable<import("@aios/contracts").NormalizedRuntimeEvent> {
    return this.loop.run(input);
  }

  async discover(): Promise<ProviderCatalogDiscovery> {
    const transportDiscovery = this.options.transport?.discover ? await this.options.transport.discover() : undefined;
    const credential = this.credentials.resolve(this.options.credentialEnvVar);
    const source = transportDiscovery ?? {
      authenticationMode: this.options.authenticationMode ?? (this.options.credentialEnvVar ? "environment-reference" : "unmeasured"),
      provenance: this.options.provenance ?? `${this.provider} discovery is not configured`,
      observedAt: new Date().toISOString(),
      completeness: "incomplete" as const,
      models: this.options.models ?? []
    };
    return {
      ...source,
      authenticationMode: source.authenticationMode,
      credentialReference: this.options.credentialEnvVar ?? source.credentialReference,
      securityStatus: this.options.endpoint ? endpointSecurityStatus(this.options) : source.securityStatus
        ?? (this.provider === "ollama" ? "measured" : "unmeasured"),
      models: source.models.map((model) => ({ ...model, tier: model.tier ?? "unclassified", configured: model.configured && (this.options.credentialEnvVar ? credential.configured : true) }))
    };
  }

  async probe(route: ResolvedRoute): Promise<boolean> {
    if (route.provider !== this.provider) return false;
    return this.options.transport?.available ? this.options.transport.available() : false;
  }
}

export class OllamaProviderAdapter extends ProviderRuntimeAdapter {
  constructor(options: ProviderRuntimeAdapterOptions = {}) { super("ollama", "ollama", { authenticationMode: "none", ...options }); }
}

export class CustomOpenAICompatibleProviderAdapter extends ProviderRuntimeAdapter {
  constructor(options: ProviderRuntimeAdapterOptions = {}) { super("custom-openai-compatible", "custom-openai-compatible", options); }
}

export class OpenAIProviderAdapter extends ProviderRuntimeAdapter {
  constructor(options: ProviderRuntimeAdapterOptions = {}) { super("openai", "openai", { authenticationMode: "environment-reference", ...options }); }
}

export class AnthropicProviderAdapter extends ProviderRuntimeAdapter {
  constructor(options: ProviderRuntimeAdapterOptions = {}) { super("anthropic", "anthropic", { authenticationMode: "environment-reference", ...options }); }
}

export class OpenRouterProviderAdapter extends ProviderRuntimeAdapter {
  constructor(options: ProviderRuntimeAdapterOptions = {}) { super("openrouter", "openrouter", { authenticationMode: "environment-reference", ...options }); }
}

function unavailableTransport(): ProviderTransport {
  return {
    available: async () => false,
    async *stream(_input: ToolLoopProviderInput): AsyncIterable<ToolLoopProviderEvent> { return; }
  };
}
