# PHS-02 — GitLab discussion observation

Outcome: linked merge requests expose real discussion state and each new unresolved human discussion creates exactly one durable remediation ask.

- Owns: CON-003, CON-004; REQ-014–REQ-015.
- Invariants: INV-01, INV-04, INV-05, INV-07.
- Risk: high due external identity, retry/restart dedupe and stale discussion state; independent review required.
- Starts blocked by: TSK-002.
- Tasks: TSK-003, then TSK-004.
- Integration point: the code-host abstraction adds read-only discussion observation consumed by a durable synchronizer and the Mission Control projection.
- Integrated gate: connector transport/fake tests, discussion migration/dedupe/recovery route tests, connectors/server typechecks, server suite, `git diff --check`.
- Review focus: pagination/error semantics, system-note filtering, stable IDs, restart dedupe, resolved-before-admission behavior, no writes.
- Handoff: durable discussion/ask state is ready for capability-aware admission in PHS-03.
