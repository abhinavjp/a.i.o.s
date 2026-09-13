# Sarathi Agent Engine Configuration

## Status

Approved through operator grilling on 2026-09-09. This spec narrows the broader multi-runtime design to selectable Hermes, Codex, and Claude Code agent engines.

## Goal

Let the operator configure which agent engine executes work globally, per workflow, per agent, or per task without weakening Sarathi governance or silently changing data/billing boundaries.

## Domain

- Hermes, Codex, and Claude Code are peer **agent engines**.
- Resolution precedence is `task > workflow > agent > global`.
- Each layer may inherit or select an engine-specific named configuration and optional model.
- The resolved choice and provenance are immutable once a task is admitted.
- Engine-native orchestration is optional. Hermes-only Kanban work is incompatible with Codex or Claude Code and must block rather than reroute.

## Configuration

- Add a dedicated Routing page for global defaults, registered engine health, named configurations, fallback, and repair guidance.
- Agent creation/editing exposes an optional override. The task composer exposes `Inherit | Hermes | Codex | Claude Code` plus advanced named-configuration/model selection.
- `Inherit` always displays the effective engine and source layer.
- Persist non-secret configuration locally with atomic replacement. Persist environment-variable names only; never secret values.
- Existing installations migrate to Hermes configured but unavailable. They never silently switch engines.
- Only registered adapters are accepted. Arbitrary executable paths and BYOA registration are excluded.

## Readiness and execution

- A route can be saved while unverified, but cannot execute until executable, authentication, configuration isolation, resumable-session handling, event attribution, cancellation, and Sarathi-controlled permission behavior are proven.
- Codex uses noninteractive JSONL execution with a named Codex profile and Sarathi-selected sandbox policy.
- Claude Code uses print-mode streaming JSON with explicit settings/agent configuration and Sarathi-selected tools/permission mode.
- Hermes uses an explicit Hermes profile/home and its native session identity. Its current broken UV Python launcher must appear as unavailable with repair guidance.
- Sarathi owns tool permission decisions and approvals. Native restrictions add defense in depth and cannot broaden Sarathi authority.
- When no resolved engine is ready, the task terminates as unavailable. Fake/Null engines never appear as successful production execution.

## Sessions and isolation

- Sarathi history is canonical. Store native session identities separately per engine and agent.
- Native configuration, sessions, and mutable state are isolated per agent. Only explicitly scoped Sarathi context may be shared.
- Never pass one engine's private session identity to another engine.

## Fallback and boundaries

- Cross-engine fallback is disabled by default.
- An enabled fallback is an explicit ordered list with destination engine, configuration, provider/data boundary, and billing mode visible before consent.
- Paid routes require separate explicit enablement.
- Fallback occurs only at durable safe boundaries. Uncertain external effects block for reconciliation and are never replayed automatically.

## Required scenarios

1. With global Codex and no overrides, a new task records Codex selected from global configuration.
2. Workflow, agent, and task overrides win in that order; existing running tasks remain pinned after edits.
3. An unavailable selected engine returns an attributable unavailable outcome and repair reason without fallback.
4. Explicit fallback is considered only after its consent record and readiness checks pass.
5. A Hermes-Kanban task resolved to Codex blocks as incompatible.
6. API responses and persisted files contain environment-variable names but no secret values.
7. Codex, Claude, and Hermes sessions remain isolated while reconstruction uses canonical Sarathi history.
8. UI exposes Routing, agent override, task override, effective source, readiness, and first-run repair state.

## Exclusions

- Arbitrary executable paths or BYOA registration.
- Automatic cross-engine fallback or silent engine switching.
- Numeric spend budgets.
- Claims of live readiness without authenticated opt-in proof.
