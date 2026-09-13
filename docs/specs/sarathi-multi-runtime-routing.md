# Sarathi Multi-Runtime Routing Specification

Date: 2026-09-06  
Status: approved local implementation specification; tracker publication intentionally skipped by operator instruction.  
Source design: `docs/superpowers/specs/2026-09-06-sarathi-multi-runtime-routing-design.md`.

## Problem Statement

Sarathi cannot yet execute specialist work consistently across subscription CLIs, local models, on-premises models, and paid API providers. Runtime selection, model suitability, permissions, fallback, durable history, usage attribution, and failure recovery must remain understandable and enforceable regardless of the selected route. Without one routing contract, provider-specific behavior could leak into workflows, paid routes could activate unexpectedly, tool authority could become ambient, and retries could repeat uncertain external effects.

## Solution

Add a provider-neutral routing layer behind the existing Agent Abstraction. Each admitted task receives an immutable Resolved Execution Plan assembled from task, workflow, specialist, and global configuration. The runtime router executes that plan through Codex CLI, Claude CLI, or an AI SDK tool loop backed by Ollama, a custom OpenAI-compatible endpoint, OpenAI, Anthropic, or OpenRouter.

Sarathi remains authoritative for canonical history, durable attempts, tool authorization, approvals, retries, fallback, cancellation, and audit evidence. Provider and native-runtime state may accelerate resume but never replaces Sarathi state. Paid API routes remain disabled until explicitly enabled. Missing live credentials or fixtures produce `UNMEASURED`, not inferred success.

## User Stories

1. As an operator, I want to select a global route policy, so that new tasks have a predictable default.
2. As an operator, I want task overrides to outrank workflow, specialist, and global settings, so that exceptional work can be routed explicitly.
3. As an operator, I want workflow overrides to outrank specialist and global settings, so that one flow can share routing constraints.
4. As an operator, I want specialist overrides to outrank the global default, so that persistent responsibilities use suitable routes.
5. As an operator, I want primary and fallback routes configured independently, so that recovery policy is explicit.
6. As an operator, I want running tasks pinned to their admitted plan, so that configuration edits cannot silently change execution.
7. As an auditor, I want every plan to retain its source configuration versions, so that route decisions are reproducible.
8. As an operator, I want Codex subscription work to use Codex CLI, so that account-backed execution remains distinct from API billing.
9. As an operator, I want Claude subscription work to use Claude CLI, so that subscription execution remains distinct from Anthropic API billing.
10. As an operator, I want API and local models to use one provider-neutral tool loop, so that policy does not fragment by provider.
11. As an operator, I want Ollama routes, so that eligible work can remain local.
12. As an operator, I want custom OpenAI-compatible routes, so that approved on-premises inference can participate.
13. As an operator, I want direct OpenAI routes, so that explicitly enabled API fallback is available.
14. As an operator, I want direct Anthropic routes, so that explicitly enabled API fallback is available.
15. As an operator, I want OpenRouter routes, so that explicitly enabled aggregated-provider fallback is available.
16. As an operator, I want paid routes disabled by default, so that Sarathi never spends implicitly.
17. As an operator, I want credentials referenced by environment-variable name, so that secrets are not persisted in dashboard state.
18. As an operator, I want provider-backed model discovery, so that configuration reflects observable availability.
19. As an operator, I want discovery provenance and observation time, so that catalog claims are attributable.
20. As an operator, I want the last successful catalog retained as visibly stale after refresh failure, so that failure does not masquerade as an empty catalog.
21. As an operator, I want partial native-runtime catalogs labeled incomplete, so that aliases are not presented as exhaustive discovery.
22. As an operator, I want models non-executable until configured and qualified, so that discovery alone grants no capability.
23. As an operator, I want health, streaming, structured-output, and tool-calling qualification, so that routes are selected by demonstrated requirements.
24. As an operator, I want text-only models eligible only for text-only tasks, so that agentic work never reaches an incapable route.
25. As an operator, I want custom models initially unclassified, so that model names do not imply capability.
26. As an operator, I want editable economy, workhorse, frontier, and unclassified tiers, so that routing reflects local evidence.
27. As an operator, I want Auto routing to filter by tools, context, modality, locality, enablement, and health, so that only eligible routes are ranked.
28. As an operator, I want Auto routing to choose the lowest adequate tier, so that capable economical routes are preferred.
29. As an operator, I want deterministic task classification to remain usable without a classifier model, so that routing has no circular dependency.
30. As an operator, I want an optional cheap classifier for ambiguous tasks, so that classification can improve without becoming mandatory.
31. As an auditor, I want Auto-routing inputs and reasons recorded, so that selection is explainable.
32. As an operator, I want to override an automatic choice explicitly, so that human judgment remains available.
33. As an auditor, I want OpenRouter's effective provider and model recorded when observable, so that aggregation does not erase attribution.
34. As an operator, I want all runtimes limited to Sarathi-defined tools, so that no model receives ambient authority.
35. As an operator, I want hard deny to outrank every other permission rule, so that prohibited actions remain prohibited.
36. As an operator, I want narrow ask and allow rules scoped by operation and target, so that approvals cannot expand accidentally.
37. As an operator, I want deterministic safe/read-only classification before semantic classification, so that obvious cases do not depend on a model.
38. As an operator, I want semantic classification limited to unresolved low-risk actions, so that consequential writes always require explicit authority.
39. As an operator, I want approvals bound to the exact proposed action and context, so that changed actions invalidate approval.
40. As an operator, I want once, session, project, and global approval lifetimes, so that durable permissions remain intentional.
41. As an operator, I want “always allow” saved as a structured narrow rule, so that raw command strings cannot weaken policy.
42. As an auditor, I want canonical messages, tool intents, permission decisions, results, attempts, and outcomes persisted, so that task history survives runtime loss.
43. As an operator, I want native session identifiers treated as resumable accelerators, so that their loss does not destroy canonical history.
44. As an operator, I want each attempt to record requested and effective routing identities, so that fallback remains visible.
45. As an operator, I want transient failures retried at one orchestration layer only, so that nested retries cannot multiply work.
46. As an operator, I want at most two transient retries after the initial call, so that retry behavior is bounded.
47. As an operator, I want invalid input, unsupported capability, authentication, and configuration failures to fail immediately, so that retries do not conceal permanent faults.
48. As an operator, I want repeated transient failures to open a circuit, so that unhealthy routes are temporarily avoided.
49. As an operator, I want authentication and configuration circuits blocked until repair or a successful probe, so that time alone cannot imply recovery.
50. As an operator, I want fallback only after same-route retry exhaustion and at a durable boundary, so that attempt history stays coherent.
51. As an operator, I want fallback to receive canonical history and completed tool results, so that recovery does not depend on provider-private state.
52. As an operator, I want idempotency keys propagated where supported, so that retryable effects can be deduplicated.
53. As an operator, I want uncertain non-idempotent effects blocked for reconciliation, so that Sarathi never repeats them automatically.
54. As an operator, I want cancellation to terminate native process trees or API streams and retain partial output, so that stopped work is truthful and inspectable.
55. As an operator, I want cancellation to remain terminal rather than trigger fallback, so that stop intent is respected.
56. As an auditor, I want observed token categories, costs, request IDs, retries, circuits, and fallback reasons recorded, so that execution is attributable.
57. As an auditor, I want unavailable usage and cost represented as unknown, so that missing evidence is never reported as zero.
58. As an operator, I want estimates labeled as estimates, so that they cannot be confused with provider billing.
59. As an operator, I want explicit `UNMEASURED` results for unavailable live proofs, so that fake tests do not imply entitlement or production readiness.
60. As an operator, I want configuration, route health, stale catalogs, qualification, attempts, and usage visible in the command center, so that routing can be understood and controlled.

## Implementation Decisions

- Preserve the Agent Abstraction as the application-facing facade.
- Introduce explicit contracts for route configuration, provider catalogs, qualification evidence, resolved plans, attempts, normalized runtime events, permissions, approvals, usage, and terminal outcomes.
- Resolve configuration in this order: task, workflow, specialist, global. Each layer may inherit or replace primary route, fallback routes, selection mode, tier/provider restrictions, tools, and permission scope.
- Persist an immutable Resolved Execution Plan at task admission. Configuration changes affect new tasks only unless the operator stops and restarts a task.
- Implement three runtime adapters: Codex CLI, Claude CLI, and provider-neutral AI SDK ToolLoopAgent.
- Implement AI SDK provider adapters for Ollama, custom OpenAI-compatible endpoints, OpenAI, Anthropic, and OpenRouter.
- Keep transport, authentication references, discovery, health, normalization, cancellation, and usage extraction inside provider adapters. Keep fallback, permissions, durable state, and authority centralized.
- Represent authentication and billing mode separately from runtime/provider/model identity.
- Store credential references only; resolve secret values from environment variables at execution time.
- Normalize catalog entries with capability evidence, provenance, observation time, health, and staleness. Preserve the last successful catalog after refresh failure.
- Require explicit configuration and qualification before a discovered model becomes executable.
- Model tiers are operator-editable and never inferred solely from names, price, popularity, or recency.
- Auto routing filters eligibility first, then chooses the lowest adequate configured tier. Record classification evidence and selection reasons.
- Sarathi owns all tool definitions, permission evaluation, approvals, and execution. Native runtime restrictions provide defense in depth only.
- Permission precedence is hard deny, scoped ask, scoped allow, deterministic safe/read-only classification, semantic low-risk classification, then operator approval.
- Consequential writes, messages, merges, deployments, destructive actions, and credential changes always retain action-bound approval.
- Persist canonical history independently of runtime-private session state. Runtime identifiers are optional resume metadata.
- Retry only at the Sarathi orchestration layer: initial request plus at most two transient retries with exponential backoff and jitter.
- Open transient circuits after three consecutive failures for 60 seconds. Authentication/configuration circuits require configuration change or successful manual probe; quota circuits require a reported reset or successful probe.
- Begin fallback only at a persisted boundary after retry exhaustion. Never automatically replay an uncertain non-idempotent effect.
- Cancellation produces a non-success terminal outcome, retains partial output, and never invokes fallback.
- Record requested/effective routing, billing mode, observable usage/cost, provider identifiers, retries, circuits, fallback, and discovery provenance per attempt.
- Expose unknown values explicitly. Estimates remain distinguishable from provider-reported data.
- Deliver in dependency order: contracts and fakes; Codex; Claude; AI SDK; local/on-premises providers; paid API providers; Auto routing; permissions/approvals; UI, resilience, and opt-in proofs.

## Testing Decisions

- Test external behavior at the existing Fastify application-construction and injection boundary. This is the primary seam.
- Inject fake runtime runners, provider transports, clocks, classifiers, tools, durable stores, and policy adapters while exercising real application routing and policy logic.
- Cover configuration precedence, inheritance, configuration-version capture, and running-task pinning.
- Cover catalog refresh, stale preservation, incomplete discovery, health, and capability qualification.
- Cover fixed routing, Auto eligibility filtering, deterministic classification, optional classifier failure, tier selection, and operator override.
- Cover permission precedence, narrow saved scopes, deny behavior, approval binding/invalidation, and mandatory approval for consequential actions.
- Cover runtime event normalization for native CLIs and AI SDK providers.
- Cover retry limits, fail-fast errors, circuit transitions, fallback boundaries, and prevention of nested retries.
- Cover durable restart replay, canonical reconstruction without native session state, and complete attempt attribution.
- Cover cancellation, child-process cleanup, partial output, idempotency propagation, and uncertain-effect reconciliation.
- Cover subscription/API billing distinction, paid-route enablement, explicit unknown usage, and estimate labeling.
- Keep live provider contract proofs separate and opt-in. Missing credentials, accounts, endpoints, models, or authorized fixtures must produce `UNMEASURED`.
- For each delivery slice: start with a failing public-boundary test, implement narrowly, run focused tests, full tests, server/client typechecks, client build, diff checks, and semantic review.

## Out of Scope

- Numeric API budgets, spend caps, and automatic top-up.
- Persisted secret storage such as Credential Manager.
- Production TLS, authentication enforcement, and host allowlisting for non-loopback on-premises endpoints.
- Autonomous capability-tier assignment without configured or evaluated evidence.
- Production-readiness claims for routes lacking explicit live contract proof.
- External provider purchases, external writes, or live tests without separate authorization.
- Publishing this specification to an issue tracker or applying tracker labels.

## Further Notes

- This specification supersedes the earlier subscription-only constraint only for explicitly enabled paid API fallback routes. It does not authorize hidden spending.
- The canonical glossary is `CONTEXT.md`, especially “Sarathi runtime routing.”
- The approved design remains the detailed rationale source; this file is the implementation-facing synthesis.
- LAN/on-premises transport security remains `UNMEASURED` under the current deferred decision.
- Fake tests prove application behavior, not provider entitlement, current model availability, billing route, native tool compatibility, or external effects.
