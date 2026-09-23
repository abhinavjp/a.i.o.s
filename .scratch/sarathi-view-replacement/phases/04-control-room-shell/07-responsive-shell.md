# TSK-007 — Build the responsive Sarathi control-room shell

- **Outcome:** configured users see the reference-derived header, hero, asks region, pipeline region, activity and collapsible agent rail at all three responsive bands, backed by a typed real projection with loading/empty/error states.
- **References:** CON-001, CON-007, CON-008; REQ-001, REQ-002, REQ-003, REQ-004, REQ-005; INV-01, INV-04, INV-06; RSK-004, RSK-005.
- **Blocked by:** TSK-006.
- **Write scope:** new `app/client/src/mission-control/api.ts`, types/view-model files, shell components and styles; `app/client/src/App.tsx`; `app/client/src/App.css` only as needed to retire conflicting global rules; targeted client tests.
- **Read/reference context:** approved prototype and hash, `DEFAULT_DASHBOARD` failure posture, current App fetch/error behavior, frontend-design guidance, server projection.
- **Frozen decisions:** copy reference composition/tokens intentionally; embedded/local Inter only; Sarathi copy and real fixtures; region-level states; one memorable asks-first hero, restrained interaction motion, visible focus and reduced-motion support; legacy controls remain temporarily accessible from an advanced fallback until TSK-011.
- **Ordered changes:** write failing layout/state/keyboard tests; add typed API adapter and view model; create token layer and structural shell; implement responsive bands/rail/drawers foundation; wire root composition and failure isolation; pass/refactor; capture screenshots for critique.
- **Preserve:** setup branching, all existing action handlers until migrated, canonical server state, routing semantics.
- **Must not change:** `app/client/src/routing/RoutingPage.tsx`, prototype/sample data, server behavior, protected dirty files.
- **Narrow proof:** focused jsdom tests for hierarchy/state/focus/shortcuts; client typecheck/build; screenshots at representative >1000, 761–1000 and <=760 widths inspected against reference.
- **Manual/live proof:** screenshot comparison is manual `PASS`/`FAIL` until TSK-012 automates it; no live providers required.
- **Handoff evidence:** token map, three screenshots, keyboard/state test output, critique/remediation, commit and verified remote SHA.
