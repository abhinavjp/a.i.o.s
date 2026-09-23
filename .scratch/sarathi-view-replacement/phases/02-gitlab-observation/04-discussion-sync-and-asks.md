# TSK-004 — Persist discussion observations and deduplicate asks

- **Outcome:** startup/manual/interval observation records linked GitLab discussions durably and produces at most one ranked ask per newly observed unresolved non-system discussion across polls and restarts.
- **References:** CON-003, CON-004; REQ-014–REQ-015; INV-01, INV-02, INV-04, INV-07; RSK-001, RSK-002.
- **Blocked by:** TSK-003.
- **Write scope:** additive `SarathiStore` schema/types/migration and methods; new GitLab observation coordinator under `app/server/src/mission-control/**`; `buildApp`/projection composition; server migration/route tests.
- **Read/reference context:** ask ranking/deduplication, automatic decision records, current schema migrations, work-item/MR linkage, Jira scheduler seam from TSK-002.
- **Frozen decisions:** durable stable identity is project + MR + discussion/note identity; system or already-resolved discussions never create asks; a later resolution updates the same observation/ask; restarts cannot duplicate; unresolved connector failures preserve last known state but mark it stale/unavailable.
- **Ordered changes:** write failing schema/restart/poll cases; add additive durable observation model; add single-flight sync using the shared scheduling pattern; create/update canonical asks through store methods; expose discussion state in projection; handle resolution and error recovery; pass/refactor.
- **Preserve:** ask ordering rules, existing ask kinds/audit, unrelated dashboard fields, old store documents.
- **Must not change:** task admission/execution, external GitLab writes, floor rules, protected dirty files.
- **Narrow proof:** migration tests plus repeated poll, restart, system note, resolved-before/after observation, failure/recovery and duplicate cases; server typecheck and relevant route tests.
- **Manual/live proof:** real polling remains `UNMEASURED` unless authorized.
- **Handoff evidence:** schema migration proof, dedupe keys, lifecycle assertions, checks, independent-review result, commit and verified remote SHA.
