# TSK-009 — Migrate asks, catch-up, rules and track decisions

- **Outcome:** ranked asks, keyboard catch-up, standing-rule suggestions, rules/autopilot audit/undo and ticket-44 current/proposed track decisions operate from Mission Control against canonical state.
- **References:** CON-007; REQ-006, REQ-007, REQ-008, REQ-010; AC-02, AC-03; INV-01–INV-04, INV-06; RSK-003, RSK-004.
- **Blocked by:** TSK-008.
- **Write scope:** `app/client/src/mission-control/**`; `App.tsx` action extraction/removal as migrated; relevant existing/new client tests.
- **Read/reference context:** current ask handlers, `trackChangeSummary`, automatic-decision tests, standing-rule/autopilot APIs, prototype catch-up keyboard flow.
- **Frozen decisions:** main asks and catch-up share one view of canonical asks; skip does not decide; shortcuts ignore editable focus; rules/autopilot show floor-protected outcomes truthfully; stale track changes surface failure and refresh state.
- **Ordered changes:** write failing ranked/detail/catch-up/rule/track tests; migrate decision API adapter and ask drawer; implement keyboard catch-up with focus/escape; migrate rules/suggestions/audit/undo; expose current/proposed tracks; remove migrated generic panels; pass/refactor.
- **Preserve:** ask ranking, decision audit, rule scopes, autopilot tiers, immutable floor, ticket-44 concurrency checks.
- **Must not change:** server permission logic, route/track vocabulary, `RoutingPage.tsx`, protected dirty files.
- **Narrow proof:** focused App/automatic-decision/track-change tests plus keyboard focus/escape and floor-denial scenarios; client typecheck/build.
- **Manual/live proof:** none; canonical action contracts use deterministic fakes.
- **Handoff evidence:** migrated-control list, decision network assertions, checks, independent-review result, commit and verified remote SHA.
