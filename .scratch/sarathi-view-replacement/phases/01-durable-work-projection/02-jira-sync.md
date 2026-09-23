# TSK-002 — Idempotent Jira queue synchronization

- **Outcome:** configured Jira work synchronizes on startup, explicit refresh and configured interval; repeated/changed/absent results update the queue truthfully without deletion or overlap.
- **References:** CON-002, CON-003; REQ-011–REQ-013; AC-04; INV-04, INV-05, INV-07; RSK-001, RSK-006.
- **Blocked by:** TSK-001.
- **Write scope:** connector work-source types only if observation metadata is required; new server Jira sync coordinator; `app/server/src/routes/workItems.ts`; `app/server/src/app.ts`; Jira sync/route tests.
- **Read/reference context:** `JiraWorkSource`, `WorkItemStore` source upsert methods, existing `/api/work-items/import`, Fastify lifecycle, injected clock/scheduler patterns.
- **Frozen decisions:** preserve one import path; coordinator is single-flight and lifecycle-clean; explicit refresh and schedule invoke the same operation; failed/partial reads write no new observation batch; absent tickets are marked not currently observed, never removed; Jira stays read-only.
- **Ordered changes:** write failing controlled-clock cases; introduce injected coordinator/scheduler seam; route startup/manual/interval triggers to one sync; make observation batch atomic from the caller's perspective; expose last success/failure without stale-success wording; close timers on app shutdown; pass/refactor.
- **Preserve:** credential resolution at use time, no-secret-on-disk, manual import compatibility, existing ticket identity.
- **Must not change:** Jira transition/create capability, permission rules, unrelated release/update work, protected dirty files.
- **Narrow proof:** targeted connector and work-item route tests covering duplicate/change/absence/error/recovery/non-overlap; connectors/server typechecks; assert transport exposes no write method.
- **Manual/live proof:** real Jira remains `UNMEASURED` unless an authorized fixture is supplied; never use production credentials for the gate.
- **Handoff evidence:** trigger matrix, controlled-clock results, persisted observation proof, checks, independent-review result, commit and verified remote SHA.
