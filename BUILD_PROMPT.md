# BUILD PROMPT — AgentOS (v1)

> Paste this whole file into Claude Code (the builder).
> The architecture is settled. Build **exactly v1 scope** below — no more. Do not redesign the ADRs.
> Build slice by slice, test-first. Stop and show the diff after each slice.

---

## Mission

Build **v1 of AgentOS**: a local, browser-based agent operating system. The OS is powered by a **single, swappable Agent** — no tool is privileged. **Hermes is the default agent**; **Claude Code** and **your own custom agent** are co-equal strategies behind the same Abstraction. **Claude Code is the builder** of this OS. It is a TypeScript monorepo, organized **package-by-module**, delivered as **tracer-bullet vertical slices**.

OpenClaw is not used anywhere.

---

## Vocabulary — use these names literally (the patterns)

- **Abstraction** — the interface/port for a module. Callers depend ONLY on it.
- **Manager** — the facade the app/BFF calls. Implements the Abstraction. Delegates to the strategy the Configurator selected. Owns fallback + error handling.
- **Configurator** — the per-module registry + composition root. Registers all strategy implementations, selects the active one by enum/global init, and **always registers exactly one fallback**.
- **Strategy** — a concrete implementation behind an Abstraction.
- **Agent** — the single swappable engine that powers the OS. The app depends on one `AgentAbstraction`. Strategies: `HermesAgent` (default), `ClaudeCodeAgent` (stubbed in v1), `CustomAgent` (your own — see BYOA). No tool is privileged.
- **Orchestration** — an OPTIONAL capability an Agent may implement (Hermes does, via its Kanban/delegate machinery; Claude Code and simple custom agents don't). The OS uses orchestration when the active agent offers it, and runs single-agent when it doesn't.
- **BYOA (bring your own agent)** — implement `AgentAbstraction` + register the strategy in the `AgentConfigurator` + select it via enum/config. Nothing else. A `CustomAgent` template ships as the copy-and-go starting point.
- **OPERATE vs BUILD** — in-suit (piloting + proposing/grilling, non-mutating) vs out-of-suit (building the next version of the OS).
- **Tracer bullet** — a thin end-to-end working slice through every layer; flesh out later.

---

## Non-negotiable architecture (accepted ADRs — do not redesign)

- **Single swappable Agent, no tool privileged (ADR-0001).** The app/BFF depends on one `AgentAbstraction` with a small contract: `runTask(task, session_key) → stream`, plus optional capabilities (orchestration, memory introspection). Strategies are co-equal: `HermesAgent` (default), `ClaudeCodeAgent`, `CustomAgent`. Selected by enum/global config via the `AgentConfigurator`.
  - `HermesAgent` integrates over the **Hermes Gateway (HTTP) as the primary boundary, with the `hermes` CLI as fallback**. It **MUST NOT import Hermes Python internals or read Hermes's `state.db` directly** (that coupling is what breaks the reference WebUI on version skew). It implements the optional Orchestration capability (Kanban/delegate).
- **Agent selection, default, and swapping (ADR-0001 detail).** The `AgentConfigurator` is the single source of truth: it resolves the active agent by enum/config, applying the default (`HermesAgent`) then the fallback (`NullAgent`). The `AgentManager` caches the resolved agent and exposes `getActiveAgent()`. The ONLY way to change the live agent is one **audited** method — `selectAgent(kind)` re-resolves via the Configurator and writes an audit entry. **No public setter, no mutable global for the active agent.** And "host" is NOT a separate slot or a `getHostAgent()` — it's `activeAgent.asOrchestrator()`, which returns null when the active agent can't orchestrate. A `_activeAgent` field cached at startup is fine, but the source of truth is `configurator.resolve()` and the only mutation is `selectAgent()`.
- **Claude Code is the builder + a co-equal agent strategy (ADR-0002).** `ClaudeCodeAgent` is **registered but stubbed** in v1; when live it is invoked as **headless `claude -p` (print mode)**. Caveat to verify before going live: whether `claude -p` draws from the Max plan vs API credits. During out-of-suit BUILD, Claude Code does the implementing.
- **Orchestration is an optional Agent capability (ADR-0015).** An Agent may declare it supports orchestration. The OS calls it when present; otherwise it coordinates single-agent. Never assume an agent orchestrates.
- **BYOA contract (ADR-0016).** Adding a new agent = implement `AgentAbstraction`, register in the `AgentConfigurator`, point the config enum at it. Ship a documented `CustomAgent` template strategy so "create my own agent" is a one-file job. No core change required.
- **Manager / Configurator / Abstraction per module (ADR-0012).** Every module exposes an Abstraction, a Manager (facade implementing the Abstraction), and a Configurator (registers strategies, selects by enum/global init). The app talks to Managers, never to strategies directly.
- **Always one fallback (ADR-0013).** Every Configurator registers exactly one fallback strategy, used when the selected strategy is unconfigured or fails. The Manager routes to it and logs at WARNING. The agent fallback is a safe `NullAgent` that returns a clear "no agent available" rather than silently acting.
- **One direction, three layers (ADR-0004):** `Browser UI → BFF → Managers`. The UI never imports agent SDKs and holds no secrets.
- **Single-writer memory (ADR-0003):** the owning agent writes its own memory. The BFF never becomes a second writer.
- **Memory & retrieval: one Abstraction, tool-agnostic (ADR-0006):** default strategy = read-through to the active agent's existing layers. RAG = a **stubbed** strategy behind the same Abstraction, off by default. Strategies follow "a map at every level" (a hierarchical structure with an index/table-of-contents at each level so the agent navigates cheaply). No named tool, no hardcoded Obsidian/folder scheme.
- **Agent-modifiable UI (ADR-0007):** the agent reshapes the console by emitting a **declarative `UISpec`** composed ONLY from a fixed **component registry**. A **trusted renderer** instantiates registry components and **NEVER** evaluates agent-authored code, strings, or markup.
- **Change-control pipeline (ADR-0008):** every OS modification — user- or agent-proposed — flows: *(in-suit, non-mutating)* propose → **adversarial grilling by a SEPARATE reviewer** (proposer ≠ griller) → documented spec (ADR + git branch) → finalize + approve-to-build → *(out-of-suit)* build → ephemeral **preview deploy** + tests → **human confirms on the preview URL** → atomic swap → snapshot + audit → re-attach. No agent bypasses a step.
- **OPERATE vs BUILD, split at build (ADR-0010):** propose + grill happen in-suit (non-mutating — they produce a spec). Only a finalized/approved change exits to an out-of-process workshop to build. Never hot-patch the running OS; atomic swap + re-attach.
- **Immutable core / workshop law (ADR-0009 + ADR-0011):** the untouchable thing is the **change-control process itself + the audit ledger**. The system rejects any agent-originated Change Request that would alter the pipeline, the OPERATE/BUILD boundary, the stage structure, or the audit ledger.
- **Pipeline is a role/stage model (ADR-0011):** the pipeline is an ordered list of **stages**, each bound to a **role**, each role filled by an **Agent instance** (via the AgentAbstraction). v1 roles: proposer, reviewer. Claude Code is the **developer** role (post-v1 SDLC team: analyst → developer → QA → reviewer). Role-agents may be **instantiated at runtime to STAFF stages**; **restructuring** stages is workshop law and is never agent-bypassable.
- **Logging ≠ Audit (ADR-0014):** a `logging/` module with levels **Debug / Info / Warning / Error**; Debug everywhere, toggleable by config/env. A SEPARATE `audit/` module: append-only, always-on, tamper-evident. They never share a path.

## Stack (ADR-0005)

- **Client:** React + TypeScript + Vite. Server state via React Query. No heavy global store. Stream agent output over **SSE** (server→client, auto-reconnect — proven tunnel-resilient); send/cancel/approve via plain HTTP POST. Styling via Tailwind + Radix primitives — deliberate "command center" identity, not a component-library default (see Design direction).
- **BFF:** Fastify + TypeScript.
- **Structure — package-by-module:** top-level modules `agents/`, `memory/`, `views/`, `changecontrol/`, `logging/`, `audit/`, plus `contracts/` (shared types) and `app/` (BFF wiring + UI shell). **Each module keeps its own Abstraction + Manager + Configurator + `strategies/` + `tests/` together.** No layer-based folders.
- **Tests:** vitest with fake strategies for deterministic tests; one Playwright smoke path.

---

## Workflow — tracer-bullet vertical slices (TDD: red → green → refactor; ship each before the next)

**Slice 0 — Tracer bullet (walking skeleton).** Monorepo: `contracts/` + `app/` + the `agents/` module wired UI → BFF → `AgentManager` → a fake agent strategy (selected by the `AgentConfigurator`, with a `NullAgent` fallback). UI renders an agent list + health.
- *Done when:* the UI shows an agent sourced from a fake strategy through the full Manager/Configurator/Abstraction chain.

**Slice 1 — Agent = Hermes (default) + prove the swap.** Implement `HermesAgent` (Hermes Gateway HTTP primary, `hermes` CLI fallback, no internal coupling) declaring the optional Orchestration capability. Register it + the `NullAgent` fallback in the `AgentConfigurator`. Run a task, stream output over SSE. **Prove BYOA**: a fake `CustomAgent` strategy swaps in via config with zero caller changes, and a non-orchestrating agent still runs single-agent.
- *Done when:* a task through `HermesAgent` streams over SSE; switching the config enum to a fake `CustomAgent` works with no caller change; with Hermes down the Manager falls back to `NullAgent` and logs at WARNING — all tested.

**Slice 2 — Agent memory + learning loop.** With `HermesAgent` active, a full Hermes session runs (its learning loop MUST fire). `memory/`: `MemoryManager`/`Configurator`/`Abstraction` with `PassthroughMemory` (read-through to the agent's layers) default, `RagMemory` stubbed, plus a fallback. `session_key` = stable hash of (user/peer + project); one persistent session per key.
- *Done when:* two calls sharing a `session_key` show accumulated memory; a provider swap (passthrough ↔ stub) needs zero caller changes.

**Slice 3 — See what the agent knows.** Memory/skills viewer in the UI, through the `MemoryManager`.
- *Done when:* the UI shows the agent's layered memory + skill list (read-only).

**Slice 4 — Trust (audit + cost).** `audit/`: append-only ledger; every agent invocation records session_key, task, model, cost, duration, outcome, skills touched. Virtualized audit view with per-task cost/duration.
- *Done when:* running a task writes a complete audit entry shown in the UI with cost and duration.

**Slice 5 — Logging + access.** `logging/`: `LoggingManager`/`Configurator`/`Abstraction`, levels Debug/Info/Warning/Error, Debug toggleable by config/env, strategies (console, structured-file) + fallback — kept entirely separate from `audit/`. Plus login + an RBAC seam on the BFF.
- *Done when:* debug logging toggles on/off without touching the audit ledger; an unauthorized role is denied a privileged route — both tested.

**Slice 6 — Agent reshapes the console (views).** `views/`: `UISpec` schema + a fixed component registry + a trusted renderer that instantiates registry components only. BFF endpoint for the agent to propose/save a named view (validated against schema + registry). Layout auto-applies; action-wiring is approval-gated.
- *Done when:* an agent-saved view renders, AND a test proves a UISpec containing a non-registry component or any code/markup string is rejected and never rendered.

**Slice 7 — Change the OS through the gate (change-control spine, build out-of-process).** `changecontrol/`: a `ChangeRequest` on a git branch, flowing through a pipeline **modeled as ordered stages, each bound to a role, each role filled by an Agent instance** (v1 roles: proposer, reviewer). *In-suit, non-mutating:* `propose_os_change` opens a CR; a SEPARATE reviewer session runs a structured adversarial grilling that must resolve; the spec + outcome are committed as an ADR; finalize + approve-to-build. *Out-of-suit:* implement in an isolated workshop (no write access to the live instance) → ephemeral preview URL + test suite → human confirms → atomic swap → snapshot + audit → re-attach. Enforce the workshop law.
- *Done when:* a user-proposed and an agent-proposed CR each complete the loop on a fake change; a test proves propose+grill mutate nothing live; a test proves an agent can STAFF a stage with an instantiated role-agent but an agent CR that RESTRUCTURES stages — or touches the pipeline / OPERATE-BUILD boundary / audit ledger — is rejected before grilling.

---

## Definition of done (every slice)

1. Tests written first, then code; all green.
2. The module exposes Abstraction + Manager + Configurator with exactly one fallback; callers depend on the Abstraction only.
3. No tool is privileged — Hermes is just the default strategy; swapping to a fake/custom agent needs no caller change.
4. No layer reaches around its Manager; the UI imports no agent SDK and holds no secrets.
5. Every agent invocation writes an audit entry; debug logging is separate and toggleable.
6. A fake-strategy test proves the Configurator is swappable AND the fallback fires.
7. Stop and show me the diff before the next slice.

## What NOT to do

- **Don't use OpenClaw. Don't privilege any tool where an Abstraction belongs.** Hermes is the default, not a dependency.
- **Never expose a public setter or mutable global to swap the live agent, and never reintroduce a separate "host agent" slot or `getHostAgent()`. Selection/default/fallback live in the Configurator; the only swap path is the audited `selectAgent()`; "host" is a capability queried on the active agent (`asOrchestrator()`).**
- Never import Hermes internals or read its state.db directly — Gateway/CLI only.
- Don't build RAG, a live Claude Code agent, or extra agents — stub those strategies (each behind the Abstraction with a fallback).
- **Never let a Configurator omit its fallback.**
- Never let the agent's UISpec carry code/markup, and never eval it — registry components only.
- Never let an agent bypass a change-control step, restructure the pipeline, or modify the pipeline / OPERATE-BUILD boundary / audit ledger. Agents may STAFF stages; they never restructure.
- Never let the proposing session grill its own Change Request — the griller is always separate.
- Never hot-patch the running OS. Build out-of-suit; swap in only after human review.
- **Never merge Logging into Audit or Audit into Logging.**
- Don't redesign the ADRs. If one looks wrong, flag it and wait.

## Design direction (run a real design pass — don't ship defaults)

Subject: an operator's **command center for autonomous agents**. Before writing UI code, do a brainstorm → critique → build pass. Pin a compact token system (4–6 named colors, a characterful display face used with restraint + a clean body/data face, a layout concept). Make the **signature element** the compounding loop made visible — live agent activity and skills forming in real time — not a grid of stat-cards. Spend boldness in one place; keep the rest quiet. Avoid the three AI-default looks: cream + serif + terracotta; near-black + a single acid/vermilion accent (the "ops dashboard" cliché); broadsheet hairline columns. Write copy from the operator's side of the screen: active voice, sentence case, no filler. Quality floor without announcing it: responsive to mobile, visible keyboard focus, reduced-motion respected.

## Post-v1 roadmap (design for it, don't build it)

- Wire `ClaudeCodeAgent` **live** (headless `claude -p`); add more agent strategies (Gemini, local models) — each a new strategy behind the AgentAbstraction.
- Add the SDLC team (analyst → QA → reviewer) by registering roles and instantiating role-agents to STAFF pipeline stages at runtime — no rewrite (Slice 7 already models the pipeline this way).
- RAG memory strategy. Memory strategies follow "a map at every level" — hierarchical with an index/table-of-contents per level, tool-agnostic (never hardcode Obsidian).
- **Workflow Audit panel:** mine recent agent sessions for repeated tasks, or interview the operator (stream-of-consciousness + blind-spot probing), and propose new skills. Maps onto Hermes's Curator. This is "level 1" value — the actual skills — where most of the real payoff lives, not in the platform.
- **Distribution (L4):** package AgentOS as a clean public GitHub repo (README, install, skills) so others can run it. Keep the repo distributable from day one; the "distribution as a product" work is post-v1.

## Reference

Build against the accompanying `PRD.md` (and its ADRs). Ask **one** clarifying question only if a decision is genuinely missing; otherwise proceed slice by slice. At the start of Slice 1, confirm the running Hermes exposes a Gateway HTTP endpoint (primary path); if not, use the `hermes` CLI path. Prior art for the clean adapter boundary: the Hermes WebUI's `docs/rfcs/agent-source-boundary.md`.
