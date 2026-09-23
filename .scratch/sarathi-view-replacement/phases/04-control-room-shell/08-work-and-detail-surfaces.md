# TSK-008 — Render the real pipeline, drawers, artifacts and agent rail

- **Outcome:** real work items appear by track/stage; work, stage, phase/task, artifact, merge-request and agent details open in prototype-derived surfaces with counted/unknown progress kept truthful.
- **References:** CON-001, CON-007; REQ-009, REQ-020–REQ-021; AC-03; INV-01, INV-04, INV-07; RSK-004.
- **Blocked by:** TSK-007.
- **Write scope:** `app/client/src/mission-control/**`; focused client tests; `App.tsx` only for composition cleanup; do not yet remove legacy work-items component.
- **Read/reference context:** `WorkItemsPage` behaviors/tests, artifact/content endpoints, phase/task/progress/MR contracts, agent slots/capabilities, prototype drawers.
- **Frozen decisions:** progress is counted or unknown, never estimated; drawers read real details and expose explicit unavailable state; no mutation moves into client-local state; all current work-item/agent inspection capability is represented before legacy retirement.
- **Ordered changes:** write failing mixed-state/detail tests; build pipeline grid and work/stage drawers; add artifact preview and unavailable state; add phase/task/progress/MR sections; build agent rail/detail from observed health/slots/capabilities; pass/refactor and responsive critique.
- **Preserve:** track/stage meanings, artifact approval source, task status and agent health semantics.
- **Must not change:** action authority, `RoutingPage.tsx`, legacy component removal, protected dirty files.
- **Narrow proof:** client tests for mixed tracks/stages, unknown counts, unavailable artifacts, MR/pipeline states, agents/slots/capabilities; client typecheck/build; responsive screenshots.
- **Manual/live proof:** external contents use fakes for deterministic UI; live content remains `UNMEASURED`.
- **Handoff evidence:** control/data mapping, screenshots, tests, phase review result, commit and verified remote SHA.
