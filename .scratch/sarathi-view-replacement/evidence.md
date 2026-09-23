# Sarathi view replacement — implementation evidence

## TSK-001

- Baseline: `aaf5e07d4f6a817709df75f63562b37ef9b94dc7`.
- TDD: migration, source upsert/missing, and board projection tests failed before implementation and passed afterward.
- Proof: 25 targeted tests, 258 repository tests, contracts/server typechecks, migration round-trip, and `git diff --check` passed.
- Delivered: `d1e034d3477abbc533c83b43d77a5927c8f5a004` on local `HEAD`, `origin/main`, and remote `refs/heads/main`.

## PHS-01 independent review and TSK-002 ruling

- Independent read-only review found that malformed Jira search envelopes were accepted as an empty result, a single search page could be mistaken for the complete query, and per-ticket persistence could leave a partial observation batch after a store write failure.
- Ruling: TSK-002 may make the smallest necessary changes to `connectors/src/index.ts`, connector tests, `app/server/src/WorkItemStore.ts`, and relevant store tests in addition to its declared paths. REQ-012/REQ-013 and CON-003 require complete or failed Jira reads and atomic observation batches; those outcomes cannot be implemented within the original TSK-002 file list. Cost if wrong: a broader packet diff and additional connector/store regression proof.
- Live Jira behavior remains `UNMEASURED` until an authorized live fixture is supplied.

## TSK-002

- TDD RED: startup sync read zero times; an incomplete ticket batch was partially accepted; malformed/missing Jira page fields and incomplete pagination returned misleading results; and a simulated store commit failure changed in-memory work before reporting failure.
- GREEN: startup, manual refresh and scheduled sync use one single-flight coordinator; complete Jira pages are accumulated before applying one atomic store batch; malformed, incomplete or over-limit reads fail closed; absent tickets remain durable with missing-observation status.
- Implementer proof: 32 focused tests, 272 repository tests, connector/contract/server typechecks and `git diff --check` passed.
- Independent scoped re-review: all three PHS-01 findings addressed; no new blocking breakage found. The reviewer did not run live Jira.
- Bounded pagination follows Atlassian's enhanced Jira issue-search API (`/rest/api/3/search/jql`, `nextPageToken`, `isLast`). A search exceeding the 100-page budget fails with an explicit error rather than treating a partial result as complete.
- Delivered: `5ce94ad3f011e608770163420bf9dd5c0dc8f5f5` on local `HEAD`, `origin/main`, and remote `refs/heads/main`.

## TSK-003

- TDD RED: malformed merge-request identity reached the public projection; the repository suite also exposed an extra fake-host response field outside the existing route contract. Both failures passed after scoped fixes.
- GREEN: normalized merge requests include stable project/IID and optional pipeline identity; pipeline and discussion reads normalize IDs, authorship, system and resolution flags. Null and fake hosts implement the new discussion read. GitLab MR and discussion pages use bounded pagination, reject malformed pages and 404s explicitly, and keep credentials in request headers.
- Fixture provenance: discussion/note examples in `connectors/tests/ConnectorConfigurator.test.ts` are local synthetic fixtures shaped from the GitLab v4 discussions API; the pagination headers follow GitLab REST API documentation. They are not live observations.
- Proof: 12 connector tests, 276 repository tests, connector/server/client/contracts typechecks, and `git diff --check` passed. Live self-managed GitLab remains `UNMEASURED`.
- Direct review: kept the public fake-host MR response compatible with the existing route assertion; no external GitLab write method was added. No blocking scoped finding remains.

## TSK-004

- TDD RED: six initial cases failed for absent startup asks, sync routes and durable state. Direct review added failing cases for resolution/absence retirement, non-resolvable human notes and first actionable transition after an initially resolved observation.
- GREEN: schema v8 migrates v7 documents additively; one startup/manual/interval coordinator collects complete linked MR/discussion reads, applies a durable observation batch, creates at most one ask per stable project/MR/discussion identity, and records stale failure/recovery state. Resolved or absent observations retire pending asks while preserving their identity/history; a previously resolved thread receives its first ask when it becomes actionable.
- Proof: 9 focused discussion tests; 285 repository tests across 47 files; server, contracts and client typechecks; `git diff --check`. Scoped agent run also passed 34 tests across discussion, board, work-item route and migration files.
- Direct review: fixed the three ask-lifecycle gaps above and updated the future-schema rejection fixture to v9 after the additive v8 migration. No blocking scoped finding remains. Live self-managed GitLab polling is `UNMEASURED`.
