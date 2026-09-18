# 04: Add work item, track and stage types to contracts

**What to build:**

Add the core delivery-pipeline types to the shared contracts package so the server and the
browser use one definition. This ticket adds types only. Nothing reads or writes them yet.

Use the exact vocabulary from CONTEXT.md. Do not invent new words.

A work item has: an id, a title, an optional work source key (null when the work was added
directly), a list of repository names, an optional track, and a created timestamp.

A stage kind is one of: functional-analysis, technical-analysis, spec-and-eval, plan,
implementation, final-review, merge.

A track is an ordered list of stage kinds. It is a plain list, not a fixed preset.

A stage has: a stage kind, a state (one of not-started, running, waiting, blocked, done, skipped),
and a list of artifact references (use an empty list for now).

**Blocked by:**

None (can start immediately)

**Status:** ready-for-agent

## Acceptance criteria

- [x] The contracts package exports a work item type, a track type, a stage kind type and a stage type.
- [x] A track is typed as an ordered list of stage kinds.
- [x] A work item's work source key can be null.
- [x] The whole project still type-checks and all existing tests still pass.
- [x] No server or browser code is changed by this ticket.
