# PHS-03 — Safe remediation admission and evidence

Outcome: discussion asks admit capable agents only through existing authority and report externally corroborated milestones without conflation.

- Owns: CON-005, CON-006; REQ-016–REQ-019; AC-02 and AC-05 server behavior.
- Invariants: INV-01–INV-05.
- Risk: high security/permission/external-side-effect boundary; independent review mandatory.
- Starts blocked by: TSK-004.
- Tasks: TSK-005, then TSK-006.
- Integration point: canonical ask decision callback invokes a bounded remediation coordinator backed by agent capability/slot selection and existing task execution.
- Integrated gate: permission/floor/standing-rule/autopilot/task admission tests, discussion lifecycle tests, server/contracts typechecks, server suite, `git diff --check`.
- Review focus: bypass attempts, stale approvals, absent capability, duplicate admission, output-versus-observation separation, cancellation/failure.
- Handoff: complete safe server contract for remediation UI.
