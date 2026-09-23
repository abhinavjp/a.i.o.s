# PHS-01 — Durable work projection and Jira sync

Outcome: canonical stores expose a board-ready projection and Jira synchronizes into it without duplication, deletion or false success.

- Owns: CON-001–CON-003; REQ-005, REQ-009, REQ-011–REQ-013; AC-04.
- Invariants: INV-01, INV-04, INV-05, INV-07.
- Risk: high due additive durable-state migration and scheduled external reads; independent review required.
- Starts blocked by: approved Implementation gate only.
- Tasks: TSK-001, then TSK-002.
- Integration point: `buildApp` composes the migrated `WorkItemStore`, projection and sync coordinator without changing existing action semantics.
- Integrated gate: work-item legacy/current migration tests, Jira sync route/service tests, server tests, contracts/connectors/server typechecks, `git diff --check`.
- Review focus: lossless migration, idempotency, single-flight polling, timer cleanup, no Jira writes, failure isolation.
- Handoff: board projection and Jira observation contract are stable inputs for PHS-02 and UI phases.
