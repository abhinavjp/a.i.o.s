# Sarathi Multi-Runtime Routing Design

## Status

Approved conversational design for implementation planning. This design revises the subscription-only constraint in `docs/specs/sarathi-v1.md`: paid API routes are now permitted as explicitly enabled fallbacks. It does not authorize external writes, purchases, automatic top-up, or live provider tests.

## Goal

Let Sarathi run specialists through Codex and Claude Code subscriptions, Ollama, a custom on-premises OpenAI-compatible model, direct OpenAI and Anthropic APIs, and OpenRouter while preserving durable sessions, explicit authority, attributable routing, and safe fallback behavior.

## Decisions

- Use native CLIs for Codex subscription and Claude subscription tasks.
- Use Vercel AI SDK `ToolLoopAgent` for API and local-model agentic execution.
- Keep `AgentAbstraction` as the application-facing facade.
- A global route policy is selected by the operator. Task, workflow, and specialist overrides take precedence in that order.
- A primary selection and its optional fallback chain are independently configurable.
- Paid routes are disabled until explicitly enabled. Numeric budgets and caps are deferred.
- Persist credential references only. API keys come from environment variables.
- Canonical task history belongs to Sarathi. Native runtime session IDs are resumable accelerators, not authoritative state.
- Model discovery is provider-backed where supported. Discovered models are not executable until configured and capability-qualified.
- Automatic routing chooses the lowest adequate configured model tier after capability filtering.
- Sarathi owns tool authorization and execution. Model runtimes never receive ambient authority.

## Architecture

The configuration resolver produces an immutable `ResolvedExecutionPlan` for each new task. The runtime router executes attempts through one of three runtime adapters: Codex CLI, Claude CLI, or AI SDK. The AI SDK runtime uses provider adapters for Ollama, a custom OpenAI-compatible endpoint, OpenAI, Anthropic, and OpenRouter.

Provider adapters own transport, authentication references, health checks, catalog discovery, request normalization, cancellation, and usage extraction. They do not own fallback, permissions, durable task state, or external-action authority. Those policies remain centralized.

The component flow is:

```text
task
  -> configuration resolver
  -> fixed/automatic model selector
  -> runtime router
       -> Codex CLI adapter
       -> Claude CLI adapter
       -> AI SDK ToolLoopAgent
            -> Ollama provider
            -> custom OpenAI-compatible provider
            -> OpenAI provider
            -> Anthropic provider
            -> OpenRouter provider
  -> permission engine
  -> Sarathi tool executor
  -> durable events, sessions, usage, and audit evidence
```

## Configuration resolution

Configuration precedence is:

```text
task override -> workflow override -> specialist override -> global default
```

Each layer may inherit or independently override:

- primary runtime/provider/model policy;
- optional ordered fallback routes;
- fixed versus Auto model selection;
- allowed model tiers and provider restrictions;
- tools and permission-rule scope.

Changing configuration affects new tasks only. A running task remains pinned to the configuration versions and resolved plan recorded at admission unless the operator explicitly stops and restarts it.

## Model catalog and qualification

Every provider adapter exposes normalized health, authentication mode, model entries, discovery provenance, and observation time. Model discovery uses:

- provider model APIs for OpenAI, Anthropic, and OpenRouter;
- Ollama model listing for local Ollama;
- `/v1/models` for the custom OpenAI-compatible endpoint where implemented;
- documented aliases/runtime catalogs plus live probes for native subscription CLIs where no stable exhaustive listing interface exists.

Catalogs refresh at startup and on operator request. A failed refresh preserves the last successful catalog as visibly stale. The UI never describes a partial runtime catalog as complete.

Qualification probes health, streaming, structured output, and tool calling. A route lacking tool calling may serve text-only tasks but is ineligible for agentic tasks requiring tools. Custom models begin `unclassified` until an operator assigns tiers or evaluation evidence supports a configured mapping.

## Automatic model routing

Models have operator-editable tiers:

- `economy` for extraction, formatting, and low-complexity transformations;
- `workhorse` for normal coding, analysis, and operational tasks;
- `frontier` for complex architecture, difficult debugging, security review, and advanced multi-step reasoning;
- `unclassified` when no routing claim is justified.

Auto routing first filters candidates by required tools, context window, modality, locality restrictions, route enablement, and current health. Deterministic task signals produce an initial complexity classification. A configured cheap classifier model may resolve ambiguous cases. If it is unavailable, deterministic classification remains usable.

The selector chooses the lowest adequate tier, respects route restrictions, records its inputs and reasons, and permits an explicit operator override. Provider names, model names, price, and recency alone do not establish capability. OpenRouter routes may use `openrouter/auto`, but the selected effective provider/model must still be recorded when observable.

## Tool permissions and approvals

All runtimes receive only Sarathi-defined tools. Tool calls execute through the Sarathi permission engine and executor. Native CLIs also run with restrictive native permissions as defense in depth.

Permission evaluation order is:

1. hard deny;
2. matching scoped ask rule;
3. matching scoped allow rule;
4. deterministic read-only/safe classification;
5. semantic intent classifier for unresolved low-risk actions;
6. operator approval.

Deny always wins. The semantic classifier cannot authorize destructive operations, external messages, merges, deployments, credential changes, or other externally consequential writes. These retain action-bound approval.

Approval scopes are `once`, `session`, `project`, and `global`. “Always allow” creates a narrow structured rule containing the tool, operation, target scope, and optional expiry. It does not append an unchecked raw command string or relax immutable gates.

## Sessions and execution

Sarathi persists canonical conversation messages, tool intents, permission decisions, tool results, attempt boundaries, and terminal outcomes. Native session identifiers and provider conversation identifiers are recorded when available, but loss of runtime-private state must not prevent reconstruction from Sarathi checkpoints.

Each task execution:

1. persists the task and effective configuration versions;
2. resolves and persists the execution plan;
3. verifies current route eligibility;
4. selects a fixed or automatic model;
5. starts a durable attempt and streams normalized events;
6. mediates every requested tool call;
7. persists observed usage and provider identifiers;
8. finishes with an attributable outcome and complete attempt history.

## Retry, circuit, fallback, and cancellation

Retry exists at one orchestration layer only. A route receives an initial generation call plus at most two transient retries with exponential backoff and jitter. Invalid input, unsupported capability, authentication, and configuration failures fail immediately.

Three consecutive transient failures open a 60-second circuit. Authentication/configuration circuits remain blocked until configuration changes or a manual probe succeeds. Quota circuits remain open until a provider-reported reset or a successful manual probe.

Fallback begins only after same-route retry exhaustion and only at a durable boundary. The next route receives canonical history and completed tool results. Idempotency keys propagate where supported. An interrupted or uncertain non-idempotent effect is never replayed automatically; the task blocks for reconciliation.

Cancellation terminates the native child-process tree or API stream, persists partial output, and records a non-success terminal state. Cancellation never becomes completion through fallback.

## Billing and observability

Subscription and API authentication are distinct routes. Paid API routes require explicit enablement per effective route policy, but v1 has no numeric budget enforcement.

Each attempt records, where observable:

- requested and effective runtime/provider/model;
- authentication and billing mode;
- input, cached-input, reasoning, and output usage fields;
- provider-reported cost;
- provider and client request identifiers;
- retries, circuits, fallback reason, and discovery provenance.

Unavailable usage or cost is `unknown`, never zero. Client estimates remain labeled estimates and cannot be presented as provider billing.

## Security boundary

Secrets are referenced through named environment variables and are not stored in dashboard persistence. Sarathi tools enforce path, destination, identity, and external-write policy independently of model instructions.

TLS, authentication enforcement, and host allowlisting for non-loopback on-premises endpoints are deferred by operator decision. Consequently, LAN/on-premises transport security is UNMEASURED and cannot satisfy a production-security readiness claim.

## Testing

The primary seam is the existing Fastify application-construction/injection boundary. Tests inject fake runtime runners, provider transports, clocks, model classifiers, permission classifiers, tools, and durable stores while exercising real routing and policy logic.

Required contract and application scenarios cover:

- configuration precedence and running-task pinning;
- catalog refresh, stale fallback, incomplete discovery, and capability qualification;
- fixed selection and Auto complexity/tier routing;
- permission precedence, narrow saved scopes, denial, approval, and invalidation;
- native CLI and AI SDK event normalization;
- transient retry, fail-fast errors, circuits, fallback, and retry-layer isolation;
- durable restart replay and canonical-session reconstruction;
- cancellation and child-process cleanup;
- idempotent effects and uncertain non-idempotent reconciliation;
- subscription/API billing attribution and explicit unknown usage;
- paid-route enablement and absence of hidden automatic spending.

Live contract proofs are separate, opt-in checks for Codex subscription, Claude subscription, Ollama, custom on-premises, OpenAI API, Anthropic API, and OpenRouter. Missing accounts, credentials, endpoints, or authorized fixtures are reported as UNMEASURED. Fake success cannot prove entitlement, billing route, model availability, tool compatibility, or external effects.

## Delivery sequence

Implementation is decomposed into independently testable slices:

1. routing, catalog, policy, and durable-attempt contracts with fakes;
2. Codex subscription runtime adapter;
3. Claude subscription runtime adapter;
4. provider-neutral AI SDK agent runtime;
5. Ollama and custom OpenAI-compatible routes;
6. direct OpenAI, Anthropic, and OpenRouter routes;
7. automatic model router and tier management;
8. permission rules, semantic low-risk classifier, and approval flow;
9. configuration UI, resilience completion, and opt-in live proof harnesses.

Each slice begins at the public application boundary with a failing test, adds the narrow implementation, runs focused and full regression/type/build checks, and receives semantic review before the next slice.

## Deferred work

- Numeric API budgets, spend caps, and automatic top-up.
- Credential Manager or another persisted secret store.
- On-premises TLS/authentication/host allowlisting enforcement.
- Autonomous tier assignment from unverified price, popularity, or naming heuristics.
- Production-readiness claims for any live route without its explicit contract proof.
