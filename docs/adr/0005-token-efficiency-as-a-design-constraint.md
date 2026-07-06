# ADR-0005: Token efficiency is a first-class, enforced design constraint

Status: Accepted
Date: 2026-06-30

## Context

Adhiṣṭhāna drives a real agent (Hermes) on every task, plus a second agent session for the
reviewer grill, plus memory reads. Sloppy prompts, duplicated context, and chatty payloads
multiply cost and latency across every slice. The operator has made minimal, efficient token
usage a hard requirement.

## Decision

Every prompt and payload in the system is minimal by default. Concretely:

- **Agent invocation:** use `hermes -z` (no banner/spinner, clean stdout) for one-shots. The
  task wrapper prompt is terse — no boilerplate preamble, no restating what Hermes already knows.
- **Do not duplicate memory into prompts.** `PassthroughMemory` *reads* Hermes's layers
  (`MEMORY.md`, `USER.md`, index) for display; it does not re-inject them into task prompts —
  Hermes already loads them via its stable/context/volatile tiering. Respect that tiering; never
  re-send stable content as volatile.
- **Reviewer grill** uses a fixed, compact structured template (checklist-style), not an essay.
- **Streaming:** SSE sends deltas, not full re-sends. The audit stores refs/ids and token counts,
  not large text blobs.
- **UISpec** stays small (node/depth caps from ADR-0004); the agent emits the minimal spec.
- **Sessions:** reuse the persistent session per `session_key` (`--resume`) rather than
  re-establishing context each call.

### Measurement

`tokens_in`/`tokens_out` are already recorded per invocation (ADR-0003). These are the budget
signal; watch them. A change that materially increases per-task tokens without cause is a
regression.

## Consequences

- Prompt brevity is reviewed like any other quality bar; verbose prompts are a defect.
- Clarity is not sacrificed to the point of ambiguity — minimal means "no waste," not "cryptic."
- This constraint applies to Adhiṣṭhāna's own prompts. It does not restrict what the operator
  asks the agent to do.
