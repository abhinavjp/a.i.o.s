# TSK-011 — Migrate remaining controls and retire the generic dashboard

- **Outcome:** every control in the approved inventory is reachable from shell/drawers/advanced settings with existing semantics; the old generic dashboard/work-items presentation is no longer a required route.
- **References:** CON-007; REQ-021, REQ-023, REQ-024, REQ-025; AC-07; INV-01, INV-04, INV-06, INV-07; RSK-004, RSK-007.
- **Blocked by:** TSK-010.
- **Write scope:** `app/client/src/mission-control/**`; `app/client/src/App.tsx`; `app/client/src/App.css`; `app/client/src/work-items/WorkItemsPage.tsx` and tests for retirement/migration; routing CSS/API/tests only if required without touching `RoutingPage.tsx`; existing client regression tests.
- **Read/reference context:** approved migration inventory; current App controls for specialists, tasks, pause, updates, catalogs/proofs, runtime, routing, history and release controls; current `RoutingPage` public component.
- **Frozen decisions:** advanced settings hosts secondary controls; routing stays secondary and is reused unchanged; direct intake, initial track approval, ask-mediated track change, stage state, phase-task attachment, specialist/task controls and administration retain canonical APIs/outcomes; remove duplicated generic presentation only after each inventory row has automated reachability proof; prototype-only simulation actions remain absent/unavailable.
- **Ordered changes:** create failing navigation-inventory test; migrate direct intake and remaining work-item mutations; migrate specialist/task/pause/update/catalog/proof/runtime/routing/history controls; embed/link unchanged routing component; remove migrated duplicate markup and obsolete work-items path; prune conflicting CSS only after screenshots/tests; pass/refactor.
- **Preserve:** ticket-43 routing placement/semantics, task submit/cancel, specialist approval, update/rollback, proofs, provider refresh, pause and canonical history.
- **Must not change:** dirty `RoutingPage.tsx`, external dirty files, server semantics, add prototype fake buttons.
- **Narrow proof:** automated inventory reaches and invokes every control; existing client regression suite; client typecheck/build; responsive keyboard navigation through advanced settings.
- **Manual/live proof:** opt-in/live proof actions remain operator-triggered and are not run automatically.
- **Handoff evidence:** old-to-new control matrix with no gaps, tests/screenshots, review result, commit and verified remote SHA.
