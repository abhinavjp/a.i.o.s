# TSK-006 — Project truthful remediation milestones

- **Outcome:** Mission Control exposes distinct admitted, fix-produced, pushed, pipeline and GitLab-resolution observations and never labels a thread fixed before GitLab corroborates resolution.
- **References:** CON-006; REQ-018–REQ-019; AC-05; INV-01, INV-04; RSK-002, RSK-003.
- **Blocked by:** TSK-005.
- **Write scope:** additive remediation observation state/migration in `SarathiStore` or dedicated canonical store selected by TSK-005; task observer integration; GitLab sync update path; Mission Control projection; targeted server tests.
- **Read/reference context:** canonical task outcomes/history, activity dedupe, GitLab discussion/pipeline observations, admitted remediation link.
- **Frozen decisions:** agent output may mark only local task/fix-produced state; pushed/pipeline/resolved require matching external observation; out-of-order events remain separate; failures/cancellation/capability loss never advance milestones; resolution closes the linked ask without creating another.
- **Ordered changes:** write state-sequence tests; add lossless durable milestone record; connect task observer and GitLab sync as separate writers; project ordered status with provenance/time; cover failure/out-of-order/restart/recovery; pass/refactor.
- **Preserve:** canonical task history and existing activity semantics; external truth wins over summaries.
- **Must not change:** connector write shields, permission decisions, agent output parsing, protected dirty files.
- **Narrow proof:** controlled state-sequence and restart tests; server typecheck; relevant task, activity, store migration and work-item route tests.
- **Manual/live proof:** real push/pipeline/thread resolution remains `UNMEASURED` without authorized GitLab/agent fixtures.
- **Handoff evidence:** milestone transition table, provenance assertions, checks, independent-review result, commit and verified remote SHA.
