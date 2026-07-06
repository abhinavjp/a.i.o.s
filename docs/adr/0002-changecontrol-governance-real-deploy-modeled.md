# ADR-0002: Change-control governance is real in v1; out-of-suit deployment is modeled

Status: Accepted
Date: 2026-06-30

## Context

Slice 7 (change-control spine) describes a full loop: in-suit propose → adversarial grill by a
separate reviewer → ADR + git branch → finalize/approve → out-of-suit build in an isolated
workshop → ephemeral preview URL + tests → human confirms on the preview URL → atomic swap →
snapshot + audit → re-attach.

On a single local machine with no cloud, "atomic swap of the running OS" + "re-attach" means a
self-replacing deploy of the live process. That collides with the explicit rule "never
hot-patch the running OS" and is L4/Distribution work the PRD already defers to post-v1. Building
it in v1 is overbuild and risks the running instance.

## Decision

In v1, **the governance spine is implemented for real; the out-of-suit deployment is modeled**
as gated stage transitions behind the same role/stage pipeline (so it can be made live later
with no restructure).

Real in v1:
- `propose_os_change` opens a `ChangeRequest` on a **real git branch**.
- A **separate** reviewer session runs the structured adversarial grilling (proposer ≠ griller,
  enforced — a session may not grill its own CR).
- The spec + grill outcome are committed as an **ADR**; then finalize + approve-to-build.
- The **workshop-law guard** rejects, before grilling, any agent-originated CR that would
  restructure stages, touch the OPERATE/BUILD boundary, or touch the audit ledger.
- A real **git worktree** represents the isolated workshop (no write access to the live instance).
- Every stage transition writes an **audit** entry.

Modeled in v1 (stubbed strategies behind the stage model, with a fallback like every module):
- "ephemeral preview URL", "atomic swap", "re-attach" are **stage transitions gated by an
  explicit human-confirm step + audit entry** — NOT an implemented self-replacing deployer.

## Consequences

- Satisfies every Slice 7 "done when": a user CR and an agent CR each complete the loop on a
  fake change; propose+grill mutate nothing live; an agent can STAFF a stage with an
  instantiated role-agent, but a CR that RESTRUCTURES stages — or touches the pipeline /
  OPERATE-BUILD boundary / audit ledger — is rejected before grilling.
- The "never hot-patch" rule is honored: v1 never replaces its own running process.
- Going live later = swapping the modeled deploy strategy for a real one behind the same
  Abstraction; the governance spine, stage model, and audit are unchanged.
- Workshop law (the change-control process + audit ledger) is the immutable core; this ADR
  scopes *implementation depth*, not the law itself.
