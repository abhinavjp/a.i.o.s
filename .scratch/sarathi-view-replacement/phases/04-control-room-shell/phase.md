# PHS-04 — Prototype-derived control-room shell

Outcome: the root UI becomes a responsive Sarathi Mission Control shell with real board/detail data while legacy controls remain safely reachable during migration.

- Owns: CON-007–CON-008; REQ-001–REQ-005, REQ-009, REQ-020–REQ-021; AC-01 and AC-03 presentation.
- Invariants: INV-01, INV-04, INV-06, INV-07.
- Risk: medium due large UI replacement and compatibility; same-agent phase review plus screenshot critique.
- Starts blocked by: TSK-006.
- Tasks: TSK-007, then TSK-008.
- Integration point: `App.tsx` mounts a modular `mission-control` page backed by CON-001 while existing actions remain routed to canonical APIs.
- Integrated gate: targeted client tests, client typecheck/build, populated/empty/error responsive renders, keyboard smoke, visual critique, `git diff --check`.
- Review focus: reference hierarchy/density, canonical data, regional failures, responsive bands, focus/escape, no sample state, no control loss.
- Handoff: shell and work/detail surfaces are ready for decision/setup/control migration.
