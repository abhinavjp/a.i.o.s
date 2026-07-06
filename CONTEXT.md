# Adhiṣṭhāna — Context Glossary

> Canonical language for the project. Glossary only — no implementation details.
> When a term here conflicts with how the code or a plan uses it, the glossary wins until deliberately revised.

## Core

- **Adhiṣṭhāna** (अधिष्ठान; "Adhishthana") — the OS itself: a local, browser-based agent operating system. Root *adhi* ("over") + √*sthā* ("to stand"): the **unchanging substrate** every agent runs on, and the **seat of governing authority** (the immutable change-control law). Both meanings are deliberate. Formerly working-titled "AgentOS"/"Akasha"; repo dir `a.i.o.s`.
- **Operator** — the human piloting Akasha through the browser console. Single operator in v1 (auto-login); the model is designed for multiple named operators later.
- **Builder** — who builds Akasha = Claude Code. Distinct from any agent that *runs inside* Akasha.

## Agent

- **Agent** — the single swappable engine that powers Akasha. One Abstraction, one swap point. No tool is privileged.
- **Orchestration** — an optional capability an Agent may implement (Hermes does); Akasha runs single-agent when the active agent lacks it. "host" is not a slot — it is `activeAgent.asOrchestrator()`.
- **BYOA** — bring your own agent: implement the Agent Abstraction + register + select. CustomAgent template is the starting point.

## Patterns (per module)

- **Abstraction** — the interface/port a module exposes. Callers depend only on it.
- **Manager** — the facade the app/BFF calls; implements the Abstraction; owns fallback + error handling.
- **Configurator** — per-module registry + composition root; registers strategies, selects the active one, always registers exactly one fallback.
- **Strategy** — a concrete implementation behind an Abstraction.
- **Fallback** — the one default every Configurator must register (agent fallback = NullAgent).

## Change control

- **OPERATE (in-suit)** — piloting + proposing/grilling; non-mutating to the live OS.
- **BUILD (out-of-suit)** — building the next version in isolation; entered only when a change is finalized/approved.
- **Workshop law** — the immutable change-control process + audit ledger; no agent proposal can rewrite it.
- **Change Request (CR)** — a proposed OS modification on a git branch, moving through the pipeline stages.
- **Proposer / Reviewer** — the two v1 pipeline roles, each filled by an Agent instance (a distinct session). The proposing session may never grill its own CR (proposer ≠ griller) — workshop law.
- **Grill verdict** — the terminal outcome of the reviewer's adversarial grilling: **approve** (unlocks finalize → approve-to-build), **revise** (blocks finalize; notes return to the proposer), or **reject** (closes the CR with an audit entry). No CR advances on an unresolved grill.

## Other

- **session_key** — stable per-(operator + project) key; one persistent session each.
- **Tracer bullet** — the thinnest end-to-end working slice through every layer.
