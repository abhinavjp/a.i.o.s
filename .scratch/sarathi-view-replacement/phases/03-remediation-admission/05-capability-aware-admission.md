# TSK-005 — Admit discussion remediation through canonical authority

- **Outcome:** a pending discussion ask can admit exactly one ordinary remediation task after valid approval/standing-rule evaluation and eligible agent capability/slot selection; otherwise it remains blocked with reason.
- **References:** CON-005; REQ-016–REQ-017, REQ-019; INV-01–INV-03; RSK-002, RSK-003.
- **Blocked by:** TSK-004.
- **Write scope:** new remediation coordinator under `app/server/src/mission-control/**`; minimal `SarathiStore` ask metadata/status methods; `app/server/src/app.ts`; existing task/admission route/service seams only where composition requires; targeted server tests.
- **Read/reference context:** `PermissionEngine`, `DecisionFloor`, ask decision callback, standing rules/autopilot, `AgentSlots.suggest`, `TaskRunRegistry`, canonical task history.
- **Frozen decisions:** one existing permission decision path; no direct connector invocation from UI; stable discussion intent fingerprint prevents duplicates; stale resolved discussion cannot admit; no capability/full slots produces visible blocked state; agent receives bounded MR/thread/work-item context and required capability, not secret values.
- **Ordered changes:** write failing approval/rule/floor/capability/staleness/idempotency cases; define remediation intent/context; compose coordinator with existing selectors/executor; bind approved ask callback; persist admission link; pass/refactor.
- **Preserve:** all current ask decisions, automatic-decision audit/undo semantics, task routing/admission metadata, immutable floor.
- **Must not change:** floor definitions to permit new bypasses, GitLab/Jira writes, runtime selection semantics, protected dirty files.
- **Narrow proof:** targeted permission, automatic-decision and task route tests including unauthorized, duplicate, stale, no-capability and full-slot cases; server/contracts typechecks.
- **Manual/live proof:** actual MCP/skill execution is `UNMEASURED` without an authorized capable runtime.
- **Handoff evidence:** intent shape, capability selection proof, negative gate matrix, checks, independent security review, commit and verified remote SHA.
