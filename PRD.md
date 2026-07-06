# PRD: AgentOS (v1)

## Problem Statement

Running AI agents today means juggling each one's own CLI, memory, and config, with no single browser control plane — and no clean way to swap the agent or bring your own. The naive "one OS over many agents" forks fast-moving upstreams or flattens what makes each agent good. AgentOS gives an operator one browser console to run and observe agents, powered by a **single swappable Agent** (Hermes, Claude Code, or your own — no tool privileged), with every dependency behind an Abstraction and every change to the OS gated and reversible.

## Solution

A local browser OS UI over a TypeScript BFF. The OS is powered by **one swappable `Agent`**: `HermesAgent` (default), `ClaudeCodeAgent` (stubbed in v1), or a `CustomAgent` you write. Adding an agent is a one-file job (the BYOA contract). Orchestration (multi-agent) is an optional capability an agent may support — Hermes does; simpler agents don't. **Claude Code builds the OS.** Every subsystem is a module exposing an **Abstraction**, with a **Manager** (facade) and a **Configurator** (strategy registry + selection by enum/global init + exactly one fallback). The agent can reshape the console via declarative views and propose changes to the OS itself; every change flows through a gated change-control pipeline with an out-of-process build and human review (the "suit" model — operate in-suit, step out to build). Memory is multi-layer (via the agent), tool-agnostic, RAG-ready, following "a map at every level." Logging (leveled, toggleable) is separate from the always-on audit ledger. Delivered as tracer-bullet vertical slices, organized package-by-module. OpenClaw is not used.

## User Stories

1. As an operator, I want to run a task and watch it stream, so I can use an agent without a terminal.
2. As an operator, I want to swap the agent (Hermes ↔ Claude Code ↔ my own) by changing one config, so I'm never locked to a tool.
3. As a developer, I want to add my own agent by implementing one Abstraction and registering it — nothing else (BYOA).
4. As an operator, I want to inspect the agent's memory layers and skills, so I can see what it knows.
5. As an operator, I want audit + cost per task, so I can trust and budget the system.
6. As an admin, I want login + role-based access, so only permitted users hit privileged routes.
7. As an operator, I want the agent to reshape the console into a task-specific view, without configuring it by hand.
8. As an operator, I want both the agent and me to propose OS changes, each grilled by a separate reviewer and documented.
9. As an operator, I want to confirm a change on a preview URL before it merges, so nothing reaches the live OS unseen.
10. As an operator, I want the agent unable to alter the change-control process or audit ledger, so it can improve the OS without removing its own constraints.

## Implementation Decisions

- **Single swappable Agent, no tool privileged (ADR-0001):** the app depends on one `AgentAbstraction` (`runTask(task, session_key) → stream` + optional capabilities). Strategies: `HermesAgent` (default), `ClaudeCodeAgent` (stubbed), `CustomAgent`. `HermesAgent` integrates over the Hermes Gateway HTTP (primary) + `hermes` CLI (fallback); never imports Hermes internals or reads its state.db.
- **Claude Code is builder + a co-equal agent strategy (ADR-0002):** `ClaudeCodeAgent` stubbed in v1; live post-v1 via headless `claude -p`. During out-of-suit BUILD, Claude Code does the implementing.
- **Orchestration is an optional Agent capability (ADR-0015):** Hermes implements it (Kanban/delegate); the OS runs single-agent when the active agent doesn't.
- **BYOA contract (ADR-0016):** implement `AgentAbstraction` + register in `AgentConfigurator` + select via enum/config; a `CustomAgent` template ships as the starting point.
- **Manager / Configurator / Abstraction per module (ADR-0012).**
- **Always one fallback (ADR-0013):** the agent fallback is a safe `NullAgent`.
- **Layering (ADR-0004):** Browser UI → BFF → Managers. UI holds no secrets, imports no agent SDK.
- **Single-writer memory (ADR-0003).**
- **Memory & retrieval, one Abstraction, tool-agnostic (ADR-0006):** default read-through; RAG stubbed; "a map at every level"; no hardcoded Obsidian/folder scheme.
- **Agent-modifiable UI (ADR-0007):** declarative UISpec from a fixed registry; trusted renderer never evals agent code.
- **Change-control pipeline (ADR-0008); OPERATE vs BUILD (ADR-0010); immutable core/workshop law (ADR-0009 + ADR-0011).**
- **Pipeline as role/stage model (ADR-0011):** stages bound to roles filled by Agent instances; Claude Code = developer role; role-agents staff stages at runtime; restructuring is workshop law.
- **Logging ≠ Audit (ADR-0014).**
- **Modules (package-by-module):** `agents/`, `memory/`, `views/`, `changecontrol/`, `logging/`, `audit/`, plus `contracts/` and `app/`.
- **Stack (ADR-0005):** React + TS + Vite client; Fastify + TS BFF; **SSE** for server→client streaming + HTTP POST for actions; tracer-bullet vertical slices.

## Testing Decisions

- Test behavior through Abstractions using fake strategies — not implementations.
- Swap test: switching the agent config enum to a fake/custom agent needs zero caller changes (proves BYOA + no tool privileged).
- Fallback test: with the selected strategy unavailable, the Manager routes to the fallback (`NullAgent` for agents) and logs it.
- Provider-swap test: default vs stub memory strategy with zero caller changes.
- Memory-persistence test: two calls sharing a `session_key` accumulate state.
- RBAC test: an unauthorized role is denied.
- UISpec test: a non-registry component or code string is rejected and never rendered.
- Change-control test: a user CR and an agent CR complete the loop; propose+grill mutate nothing live; an agent CR that restructures stages or touches the pipeline/boundary/audit is rejected.
- Logging/Audit separation test: toggling debug does not alter the audit ledger.
- One Playwright smoke path.

## Out of Scope (v1)

- A live `ClaudeCodeAgent` and additional agent strategies (Gemini, local models) — stubbed/contract only.
- RAG retrieval implementation (stubbed strategy only).
- The full SDLC team (analyst/QA/reviewer) — stubbed roles only.
- A full generative-UI engine (registry-composition only).
- Any path that lets the agent execute code in the browser (permanently out of scope).
- The Distribution (L4) product — post-v1; keep the repo distributable meanwhile.
- A Workflow Audit panel (mine sessions / interview to propose skills) — post-v1; maps to Hermes's Curator. Note: this "level 1" skill-building is where most real value lives; the platform is the container, not the contents.
- Multi-tenant scale-out.

## Open Questions

- Hermes integration is resolved: **Gateway HTTP (primary) + `hermes` CLI (fallback)**, no internal coupling. Remaining check: confirm the running Hermes exposes a Gateway endpoint at Slice 1 (else use the CLI path).
- authn provider (OIDC? simple session?) and deployment target (local vs single VPS).
- Distribution (L4) scope and timing.

## Further Notes

### Glossary
- **Agent:** the single swappable engine that powers the OS. One Abstraction, one swap point. Strategies: HermesAgent (default), ClaudeCodeAgent (stubbed), CustomAgent.
- **Orchestration:** an optional capability an Agent may implement (Hermes does); OS runs single-agent when absent.
- **BYOA:** implement AgentAbstraction + register + select. CustomAgent template provided.
- **Builder:** who builds the OS = Claude Code.
- **Abstraction / Manager / Configurator:** interface / facade / strategy-registry-and-selector. Manager implements the Abstraction; Configurator registers strategies + one fallback.
- **Strategy / Fallback:** a concrete impl behind an Abstraction / the one default every Configurator must register (agent fallback = NullAgent).
- **OPERATE (in-suit):** piloting + proposing/grilling — non-mutating to the live OS.
- **BUILD (out-of-suit):** building the next version in isolation; entered only when a change is finalized/approved.
- **Workshop law:** the immutable change-control process + audit ledger; no agent proposal can rewrite it.
- **Tracer bullet:** the thinnest end-to-end working slice through every layer.
- **session_key:** stable per-(user+project) key; one persistent session each.

### ADRs (accepted)
- **ADR-0001** Single swappable Agent abstraction; no tool privileged; Hermes is the default strategy; HermesAgent via Gateway/CLI with no internal coupling. Selection/default/fallback are resolved by the Configurator; the live agent changes only via an audited `selectAgent()` (no public setter / mutable global); "host" is the optional orchestration capability on the active agent (`asOrchestrator()`), not a separate slot.
- **ADR-0002** Claude Code is the builder + a co-equal agent strategy (`ClaudeCodeAgent` via headless `claude -p`, stubbed in v1).
- **ADR-0003** Single-writer memory (the owning agent writes its own memory).
- **ADR-0004** UI → BFF → Managers; UI holds no secrets and imports no agent SDK.
- **ADR-0005** Stack: React+TS+Vite client; Fastify+TS BFF; SSE + HTTP POST; package-by-module; tracer-bullet slices.
- **ADR-0006** Memory & retrieval as one Abstraction (default read-through; RAG stubbed; tool-agnostic; "a map at every level").
- **ADR-0007** Agent-modifiable UI via declarative UISpec + trusted registry-only renderer; never code-eval in the browser.
- **ADR-0008** Change-control pipeline governs all OS modifications; proposer ≠ griller; agents propose, never bypass.
- **ADR-0009** Immutable core = the change-control process + audit ledger (workshop law).
- **ADR-0010** Out-of-process build, re-entrant: boundary is *build*, not suggestion; propose+grill in-suit; never hot-patch.
- **ADR-0011** Pipeline is a role/stage model; role-agents staff stages at runtime (SDLC team later); restructuring stages is workshop law.
- **ADR-0012** Manager / Configurator / Abstraction per module.
- **ADR-0013** Every Configurator registers exactly one fallback strategy (agent fallback = NullAgent).
- **ADR-0014** Logging (leveled, toggleable) is a separate module from the always-on Audit ledger.
- **ADR-0015** Orchestration is an optional Agent capability (Hermes implements it; OS runs single-agent otherwise).
- **ADR-0016** BYOA contract: implement AgentAbstraction + register + select; CustomAgent template provided.

### Design Direction
Subject: an operator's command center for autonomous agents. Hero = the compounding loop made visible (live agent activity, skills forming) — not stat-cards. One signature element; everything else quiet. Avoid the three AI-default looks (cream+serif+terracotta; near-black + single acid accent; broadsheet hairlines). Copy from the operator's side: active voice, sentence case, no filler. Run a brainstorm → critique → build pass before shipping pixels.
