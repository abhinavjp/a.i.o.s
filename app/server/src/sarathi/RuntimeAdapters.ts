import type {
  NormalizedRuntimeEvent,
  ResolvedRoute,
  RoutedExecutionInput,
  RuntimeAttribution,
  RuntimeRouter,
  RuntimeUsage,
  RuntimeResumeMetadata,
  ToolDefinition,
  ToolExecutionResult,
  ToolIntent
} from "@aios/contracts";

/** Events emitted by a native CLI transport before Sarathi normalization. */
export type NativeCliEvent =
  | { type: "progress"; text: string }
  | { type: "resume"; metadata: RuntimeResumeMetadata }
  | { type: "tool-call"; intent: ToolIntent; providerToolCallId?: string }
  | { type: "usage"; usage: RuntimeUsage; attribution?: RuntimeAttribution }
  | { type: "terminal"; outcome: Extract<NormalizedRuntimeEvent, { type: "terminal" }>["outcome"] };

export interface NativeCliInvocation {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  readonly model: string;
  readonly nativePermissions: {
    readonly sandbox: "read-only";
    readonly permissionMode: "restricted";
    readonly allowedTools: ReadonlyArray<string>;
  };
}

/** Injectable child-process seam. A missing runner is intentionally UNMEASURED. */
export interface NativeCliRunner {
  run(input: RoutedExecutionInput, invocation: NativeCliInvocation): AsyncIterable<NativeCliEvent>;
  available?(): Promise<boolean>;
}

export interface NativeCliAdapterOptions {
  readonly command?: string;
  readonly runner?: NativeCliRunner;
  readonly allowedTools?: ReadonlyArray<string>;
}

/** Common normalization for account-backed Codex and Claude CLI routes. */
export class NativeCliRuntimeAdapter implements RuntimeRouter {
  constructor(
    readonly runtime: "codex" | "claude",
    private readonly options: NativeCliAdapterOptions = {}
  ) {}

  async *run(input: RoutedExecutionInput): AsyncIterable<NormalizedRuntimeEvent> {
    input.signal.throwIfAborted();
    if (!isNativeRoute(input.plan.route, this.runtime)) {
      yield terminal({ status: "unavailable", message: `UNMEASURED: ${this.runtime} adapter cannot serve ${input.plan.route.runtime}` });
      return;
    }
    const runner = this.options.runner;
    if (!runner || (runner.available && !(await runner.available()))) {
      yield terminal({ status: "unavailable", message: `UNMEASURED: ${this.runtime} CLI entitlement, executable, model, or fixture is not verified.`, usage: unknownUsage() });
      return;
    }

    let usage: RuntimeUsage = unknownUsage();
    let attribution: RuntimeAttribution | undefined;
    try {
      const invocation = this.invocation(input.plan.route);
      for await (const event of runner.run(input, invocation)) {
        input.signal.throwIfAborted();
        if (event.type === "progress") yield event;
        else if (event.type === "resume") yield event;
        else if (event.type === "usage") {
          usage = event.usage;
          attribution = { ...attribution, ...event.attribution };
          yield event;
        } else if (event.type === "tool-call") {
          yield { type: "tool-intent", intent: event.intent, providerToolCallId: event.providerToolCallId };
          const result = await input.executeTool(event.intent);
          yield { type: "tool-result", intent: event.intent, result, providerToolCallId: event.providerToolCallId };
        } else {
          yield terminal(withEvidence(event.outcome, usage, attribution));
          return;
        }
      }
      yield terminal(withEvidence({ status: "completed" }, usage, attribution));
    } catch (error) {
      if (input.signal.aborted) return;
      yield terminal({ status: "failed", message: errorMessage(error), usage, attribution });
    }
  }

  async probe(route: ResolvedRoute): Promise<boolean> {
    if (!isNativeRoute(route, this.runtime) || !this.options.runner) return false;
    return this.options.runner.available ? this.options.runner.available() : false;
  }

  private invocation(route: ResolvedRoute): NativeCliInvocation {
    const command = this.options.command ?? this.runtime;
    const nativePermissions = {
      sandbox: "read-only" as const,
      permissionMode: "restricted" as const,
      allowedTools: [...(this.options.allowedTools ?? [])]
    };
    const args = this.runtime === "codex"
      ? ["exec", "--json", "--sandbox", "read-only", "--model", route.model]
      : ["-p", "--output-format", "stream-json", "--permission-mode", "dontAsk", "--model", route.model];
    return { command, args, model: route.model, nativePermissions };
  }
}

export class CodexSubscriptionRuntimeAdapter extends NativeCliRuntimeAdapter {
  constructor(options: NativeCliAdapterOptions = {}) { super("codex", options); }
}

export class ClaudeSubscriptionRuntimeAdapter extends NativeCliRuntimeAdapter {
  constructor(options: NativeCliAdapterOptions = {}) { super("claude", options); }
}

// Short names make the adapter seam easy to discover for host integrations.
export const CodexRuntimeAdapter = CodexSubscriptionRuntimeAdapter;
export const ClaudeRuntimeAdapter = ClaudeSubscriptionRuntimeAdapter;

export type ToolLoopProviderEvent =
  | { type: "text"; text: string }
  | { type: "resume"; metadata: RuntimeResumeMetadata }
  | { type: "tool-call"; intent: ToolIntent; providerToolCallId?: string }
  | { type: "usage"; usage: RuntimeUsage; attribution?: RuntimeAttribution }
  | { type: "terminal"; outcome: Extract<NormalizedRuntimeEvent, { type: "terminal" }>["outcome"] };

export interface ToolLoopProviderInput {
  readonly task: string;
  readonly model: string;
  readonly messages: ReadonlyArray<{ readonly role: "user" | "assistant" | "tool"; readonly text: string }>;
  readonly tools: ReadonlyArray<ToolDefinition>;
  readonly signal: AbortSignal;
  readonly retryPolicy: { readonly maxRetries: 0 };
  readonly toolResults: ReadonlyArray<{ readonly intent: ToolIntent; readonly result: ToolExecutionResult }>;
}

/** Provider-neutral stream seam; concrete SDKs never receive ambient tool authority. */
export interface ToolLoopProvider {
  stream(input: ToolLoopProviderInput): AsyncIterable<ToolLoopProviderEvent>;
  available?(): Promise<boolean>;
}

export interface AiSdkRuntimeAdapterOptions {
  readonly provider: ToolLoopProvider;
  readonly tools?: ReadonlyArray<ToolDefinition>;
}

/** Normalizes an AI SDK-style tool loop while Sarathi owns retries and tool effects. */
export class AiSdkToolLoopRuntimeAdapter implements RuntimeRouter {
  constructor(private readonly options: AiSdkRuntimeAdapterOptions) {}

  async *run(input: RoutedExecutionInput): AsyncIterable<NormalizedRuntimeEvent> {
    input.signal.throwIfAborted();
    const provider = this.options.provider;
    if (provider.available && !(await provider.available())) {
      yield terminal({ status: "unavailable", message: `UNMEASURED: provider ${input.plan.route.provider} endpoint, model, or fixture is not verified.`, usage: unknownUsage() });
      return;
    }
    const messages = input.canonicalHistory
      .filter((event) => event.type === "message")
      .map((event) => ({ role: event.role, text: event.text }));
    const toolResults: Array<{ intent: ToolIntent; result: ToolExecutionResult }> = [];
    let usage: RuntimeUsage = unknownUsage();
    let attribution: RuntimeAttribution | undefined;
    try {
      for await (const event of provider.stream({ task: input.task, model: input.plan.route.model,
        messages, tools: [...(this.options.tools ?? [])], signal: input.signal,
        retryPolicy: { maxRetries: 0 }, toolResults })) {
        input.signal.throwIfAborted();
        if (event.type === "text") yield { type: "progress", text: event.text };
        else if (event.type === "resume") yield event;
        else if (event.type === "usage") {
          usage = event.usage;
          attribution = { ...attribution, ...event.attribution };
          yield event;
        } else if (event.type === "tool-call") {
          yield { type: "tool-intent", intent: event.intent, providerToolCallId: event.providerToolCallId };
          const result = await input.executeTool(event.intent);
          toolResults.push({ intent: event.intent, result });
          yield { type: "tool-result", intent: event.intent, result, providerToolCallId: event.providerToolCallId };
        } else {
          yield terminal(withEvidence(event.outcome, usage, attribution));
          return;
        }
      }
      yield terminal(withEvidence({ status: "completed" }, usage, attribution));
    } catch (error) {
      if (input.signal.aborted) return;
      yield terminal({ status: "failed", message: errorMessage(error), usage, attribution });
    }
  }
}

export const ProviderNeutralAiSdkRuntimeAdapter = AiSdkToolLoopRuntimeAdapter;

/** Dispatches a route to an explicitly registered adapter, retaining the fake fallback. */
export interface RuntimeAdapterRegistration {
  readonly runtime: string;
  readonly adapter: RuntimeRouter;
}

export class RuntimeRouterRegistry implements RuntimeRouter {
  private readonly adapters = new Map<string, RuntimeRouter>();

  constructor(registrations: ReadonlyArray<RuntimeAdapterRegistration>, private readonly fallback?: RuntimeRouter) {
    for (const registration of registrations) this.adapters.set(registration.runtime.toLowerCase(), registration.adapter);
  }

  run(input: RoutedExecutionInput): AsyncIterable<NormalizedRuntimeEvent> {
    const adapter = this.adapters.get(input.plan.route.runtime.toLowerCase()) ?? this.adapters.get(input.plan.route.provider.toLowerCase()) ?? this.fallback;
    if (!adapter) return (async function* () { yield terminal({ status: "unavailable", message: `UNMEASURED: no runtime adapter registered for ${input.plan.route.runtime}.` }); })();
    return adapter.run(input);
  }

  async probe(route: ResolvedRoute): Promise<boolean> {
    const adapter = this.adapters.get(route.runtime.toLowerCase()) ?? this.adapters.get(route.provider.toLowerCase()) ?? this.fallback;
    return adapter?.probe ? adapter.probe(route) : false;
  }
}

function isNativeRoute(route: ResolvedRoute, runtime: "codex" | "claude"): boolean {
  const value = route.runtime.toLowerCase();
  return value === runtime || value === `${runtime}-cli` || route.provider.toLowerCase() === runtime;
}

function terminal(outcome: Extract<NormalizedRuntimeEvent, { type: "terminal" }>["outcome"]): NormalizedRuntimeEvent {
  return { type: "terminal", outcome };
}

function withEvidence(
  outcome: Extract<NormalizedRuntimeEvent, { type: "terminal" }>["outcome"],
  usage?: RuntimeUsage,
  attribution?: RuntimeAttribution
) {
  return { ...outcome, ...(usage ? { usage } : {}), ...(attribution ? { attribution } : {}) };
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : "runtime adapter failed"; }

export function unknownUsage(): RuntimeUsage {
  return { inputTokens: "unknown", cachedInputTokens: "unknown", reasoningTokens: "unknown", outputTokens: "unknown", cost: "unknown", costKind: "unknown" };
}
