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
