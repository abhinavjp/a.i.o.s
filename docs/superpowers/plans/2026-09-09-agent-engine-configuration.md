# Agent Engine Configuration Implementation Plan

> **Execution:** Use `superpowers:executing-plans` inline. Do not dispatch subagents for implementation or review. A subagent is permitted only for an independent, evidence-heavy live-runtime investigation whose isolated context costs less than loading it here. No review between waves; run one semantic review after the full gate.

**Goal:** Select Hermes, Codex, or Claude Code globally, per workflow, per agent, and per task from the browser.

**Spec:** `docs/specs/sarathi-agent-engine-configuration.md`

**Evidence:** `docs/research/2026-09-09-hermes-agent-engine-selection.md`, `docs/adr/0006-peer-agent-engines-and-routing-ownership.md`, `CONTEXT.md`.

## Frozen decisions

- Engines: `hermes | codex | claude-code`; arbitrary executables excluded.
- Precedence: `task > workflow > agent > global`; resolve and persist once before execution.
- Running tasks retain their admitted plan; configuration edits affect new tasks only.
- Unverified engines may be configured but cannot execute.
- Cross-engine fallback is disabled by default. Explicit fallback requires destination, billing mode, data-boundary consent, readiness, and a safe durable boundary.
- Sarathi owns permissions and canonical history. Native restrictions only narrow authority.
- Persist environment-variable names, never secret values.
- Native configuration and sessions are isolated per agent and engine.
- Missing live proof is `UNMEASURED`; Fake/Null never reports production success.

## Fixed contracts

Create `contracts/src/engine.ts`; export it from `contracts/src/index.ts`:

```ts
export type AgentEngineKind = "hermes" | "codex" | "claude-code";
export type EnginePolicySource = "task" | "workflow" | "agent" | "global";
export interface EngineRoute { engine: AgentEngineKind; configuration: string; model?: string; credentialEnv?: string; billingMode: "subscription" | "api" | "local"; }
export interface EnginePolicy { primary: EngineRoute; fallbacks: EngineRoute[]; fallbackEnabled: boolean; }
export interface ResolvedEnginePlan { primary: EngineRoute; fallbacks: EngineRoute[]; source: EnginePolicySource; configurationVersions: Record<EnginePolicySource, number | null>; }
export interface EngineReadiness { state: "ready" | "unavailable" | "unmeasured"; reason: string; checkedAt: string; }
```

Task submission adds optional `workflowId`, `agentId`, `engineOverride`. Persist `resolvedEnginePlan`, readiness, routing source, native session IDs, and outcome in the task record.

## Wave 1 — Domain, persistence, resolver

**Create:** `contracts/src/engine.ts`, `app/server/src/engine/resolveEnginePolicy.ts`, `app/server/src/engine/EngineConfigStore.ts`, `app/server/src/engine/routes.ts`, `app/server/tests/engine-resolution.test.ts`, `app/server/tests/engine-config.route.test.ts`.

**Modify:** `contracts/src/index.ts`, `app/server/src/app.ts`.

- [ ] Add failing resolver tests covering all four precedence layers, field inheritance, fallback disabled, and configuration-version capture.
- [ ] Add failing API/store tests covering restart persistence, monotonic versions, default Hermes-unavailable migration, unknown engine/config rejection, fallback consent, and credential-value rejection.
- [ ] Run both focused test files; confirm RED for missing behavior.
- [ ] Implement pure `resolveEnginePolicy()`. First defined layer wins; do not merge fallback chains across layers. Copy the selected policy into a new immutable result with all observed layer versions.
- [ ] Implement `FileEngineConfigStore` schema `{version:1, global, workflows, agents, consent}`. Write a sibling temporary file, close, then rename over `.data/engine-routing.json`.
- [ ] Accept `credentialEnv` only when `^[A-Z][A-Z0-9_]*$`; reject request keys containing `apiKey`, `token`, `secret`, or `password`.
- [ ] Add `GET /api/routing`; PUT `/api/routing/global`, `/workflows/:id`, `/agents/:id`. Inject the store through `BuildAppOptions`.
- [ ] Run focused tests, contracts typecheck, server typecheck. All PASS.

**Wave gate:** Precedence, restart persistence, migration, validation, consent, and secret exclusion proven through Fastify injection. Do not commit yet.

## Wave 2 — Registry, adapters, task admission

**Create:** `agents/src/EngineRegistry.ts`, `agents/src/EngineReadiness.ts`, `agents/src/native/NativeProcessRunner.ts`, `agents/src/strategies/CodexAgent.ts`, `agents/src/strategies/ClaudeCodeAgent.ts`, matching unit tests and `agents/tests/native/FakeNativeProcessRunner.ts`.

**Modify:** `agents/src/AgentConfigurator.ts`, `AgentManager.ts`, `agents/src/index.ts`, Hermes strategy/runner files, `app/server/src/routes/tasks.ts`, `TaskRunRegistry.ts`, `TaskStore.ts`, `app.ts`, corresponding tests.

- [ ] Add failing registry tests: exactly three engines; unknown engines rejected; unready routes block; no implicit NullAgent success.
- [ ] Add failing adapter tests: argv arrays, health, JSON event normalization, native ID capture/resume, malformed-event failure, cancellation of verified child tree, isolated config roots, forbidden bypass flags absent.
- [ ] Add failing admission tests: all precedence layers, post-admission edits cannot alter plan, unavailable outcome, Hermes-Kanban incompatibility, fallback disabled, consent required, unsafe-boundary fallback blocked.
- [ ] Run focused agent/task suites; confirm RED.
- [ ] Refactor `AgentManager` to resolve a registered factory per plan and return `{ok:true, agent, readiness}` or `{ok:false, outcome}`. NullAgent represents unavailable only.
- [ ] Codex argv: `codex exec --json --profile NAME --sandbox MODE --cd ROOT`; resume through `codex exec resume ID`. Never emit dangerous bypass flags.
- [ ] Claude argv: `claude --print --output-format stream-json --verbose --settings FILE --permission-mode MODE`; use `--session-id` or `--resume`. Never emit `--dangerously-skip-permissions`.
- [ ] Pass executable and argv separately to `spawn`; never compose a shell command. Apply Sarathi-selected tools, working root, and permission mode. Isolate config/session roots per agent.
- [ ] Hermes: require explicit home/profile, capture native session identity, remove component-wide log tailing, and expose current missing-UV-Python repair guidance. If attributable streaming cannot be proven, readiness stays unavailable.
- [ ] At submission, read all policy layers, resolve once, persist plan before readiness/execution, then resolve adapter. Persist native identity separately per engine.
- [ ] Evaluate fallback only when enabled, consented, ready, and safe. Otherwise produce attributable unavailable/blocked outcome.
- [ ] Run all agent/server tests and their typechecks. All PASS.

**Wave gate:** Three registered adapters, readiness gates, immutable admission, isolation, cancellation, and fail-closed fallback proven. Commit once: `feat(routing): add selectable agent engines`.

## Wave 3 — Routing UI and task override

**Create:** `app/client/src/routing/RoutingPage.tsx`, `RoutingPage.css`, `api.ts`, `RoutingPage.test.tsx`, `docs/testing/agent-engine-live-proofs.md`.

**Modify:** `app/client/src/App.tsx`, `App.css`, `App.test.tsx`.

- [ ] Add failing UI tests for Routing navigation; three engine cards; global and agent policy editing; `Inherit` effective value/source; unavailable repair; fallback disabled; consent details; no secret rendering.
- [ ] Add failing task tests selecting an engine, posting `engineOverride`, and showing admitted engine/configuration/source/readiness/fallback/outcome.
- [ ] Run focused client tests; confirm RED.
- [ ] Implement Routing as a dedicated view using existing React state. Save ordinary changes directly; confirmation is required only when enabling cross-engine or paid fallback.
- [ ] Keep unavailable configurations saveable but visibly blocked. First run shows Hermes configured/unavailable and directs operator to Routing; never auto-select Codex/Claude.
- [ ] Add task selector `Inherit | Hermes | Codex | Claude Code` beside Run task; advanced fields expose named configuration and optional model.
- [ ] Keep native profile/model forms engine-specific; do not force one provider schema across engines.
- [ ] Document opt-in live proofs for executable version, auth/billing, isolation, resume, event attribution, cancellation, and permission enforcement. Mark absent evidence `UNMEASURED`.
- [ ] Run client tests, client typecheck, and production build. All PASS.

**Wave gate:** Global, agent, and task configuration works from the browser; effective source and blocking reasons remain visible. Commit once: `feat(ui): configure agent engine routing`.

## Final gate and one review

- [ ] Run `npm test -- --reporter=dot`.
- [ ] Run `npx tsc -p contracts/tsconfig.json --noEmit`.
- [ ] Run `npx tsc -p agents/tsconfig.json --noEmit`.
- [ ] Run `npx tsc -p app/server/tsconfig.json --noEmit`.
- [ ] Run `npm run typecheck -w app/client`.
- [ ] Run `npm run build -w app/client`.
- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Perform one semantic review against every scenario in the spec. Confirm: no secret serialization, bypass flag, silent fallback, arbitrary engine, cross-engine session reuse, or admitted-task mutation.
- [ ] Fix findings inline, rerun affected focused checks, then rerun the full gate once.
- [ ] Stage only this feature. Preserve unrelated `.claude/`, `.scratch/`, `intent.md`, and pre-existing user docs.
- [ ] Commit final corrections only if needed: `fix(routing): close agent engine verification gaps`.

## Failure handling

- Failed focused test: remain in the current wave; diagnose before widening scope.
- CLI help differs from recorded argv: treat local `--help` as current truth, update adapter test and research note together, never guess flags.
- Missing executable/auth/profile: persist `unavailable` or `unmeasured` with exact repair text; continue fake contract coverage.
- Unattributable stream, uncertain external effect, or unsafe fallback boundary: block the task; do not retry through another engine.
- Dirty worktree overlap: preserve user changes and stop only if the same lines cannot be safely reconciled.
