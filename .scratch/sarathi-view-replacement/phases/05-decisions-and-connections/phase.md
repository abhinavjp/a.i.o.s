# PHS-05 — Decisions, connectors and setup in the new shell

Outcome: operators decide canonical asks/catch-up and use truthful Jira/GitLab/setup/remediation surfaces entirely inside Mission Control.

- Owns: CON-005–CON-008; REQ-006–REQ-008, REQ-010–REQ-019, REQ-022; AC-02, AC-04–AC-06 UI flows.
- Invariants: INV-01–INV-07.
- Risk: high because decision/floor controls and external-state presentation meet the new UI; independent review required.
- Starts blocked by: TSK-008.
- Tasks: TSK-009, then TSK-010.
- Integration point: UI actions call existing canonical decision/task/connector endpoints and refresh the server projection; no drawer-local approval or connector state.
- Integrated gate: decision/catch-up/track-change/connector/setup/remediation client-server tests, permission negative cases, client/server typechecks/build, `git diff --check`.
- Review focus: one-engine proof, floor denial, keyboard catch-up, stale track/discussion handling, secret leakage, observed milestones and recovery.
- Handoff: all primary workflows run in the new shell; only secondary/advanced inventory remains.
