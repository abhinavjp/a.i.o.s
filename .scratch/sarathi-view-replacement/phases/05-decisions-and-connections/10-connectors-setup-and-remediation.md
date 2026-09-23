# TSK-010 — Migrate Jira/GitLab setup, sync and remediation lifecycle

- **Outcome:** first-run and connection surfaces show observed Jira/GitLab/agent readiness; Jira refresh is available; GitLab discussions/asks/remediation milestones are actionable and truthful in Mission Control.
- **References:** CON-003–CON-007; REQ-011–REQ-019, REQ-022; AC-04–AC-06; INV-01–INV-05, INV-07; RSK-002, RSK-003, RSK-006.
- **Blocked by:** TSK-009.
- **Write scope:** `app/client/src/mission-control/**`; `App.tsx` migrated setup/connector/remediation handlers; focused client tests; server response shaping only if the approved projection lacks an already-planned field.
- **Read/reference context:** first-run tests, credential reference routes, connector status/sync routes, discussion ask/task/milestone projection, prototype connection/setup/remediation surfaces.
- **Frozen decisions:** setup completion comes only from observed evidence; secrets are write-only and never re-rendered; Jira is read-only; new discussion asks use canonical approval/standing rules; no capability stays blocked; fixed requires GitLab resolution; external writes unavailable unless a separate gated real action exists.
- **Ordered changes:** write failing cold/partial/error/secret/sync/remediation cases; migrate first-run and connections UI; add explicit Jira refresh/status; add discussion list/ask/task milestone surface; remove corresponding generic controls; exercise recovery and responsive states; pass/refactor.
- **Preserve:** credential-reference API behavior, task execution, floor, setup three concerns, current connection expiry reporting.
- **Must not change:** direct secret reads, Jira writes, fake GitLab resolution, `RoutingPage.tsx`, protected dirty files.
- **Narrow proof:** FirstRun plus connector/remediation UI tests; no-secret DOM/request persistence assertions; targeted client-server integration tests; client/server typechecks/build.
- **Manual/live proof:** actual Jira/GitLab/agent connections remain `UNMEASURED` without authorized fixtures.
- **Handoff evidence:** setup matrix, remediation state screenshots, secret-negative proof, checks, independent-review result, commit and verified remote SHA.
