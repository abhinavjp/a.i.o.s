# PHS-06 — Full control migration and acceptance

Outcome: every approved existing control is reachable through Mission Control/advanced settings, the generic presentation is retired, and deterministic visual/accessibility/full acceptance is proven.

- Owns: CON-007–CON-009; REQ-003–REQ-004, REQ-021–REQ-025; AC-01, AC-06, AC-07 and final cross-spec proof.
- Invariants: INV-01–INV-07.
- Risk: medium with high control-loss sensitivity; independent review for the final permission/control inventory.
- Starts blocked by: TSK-010.
- Tasks: TSK-011, then TSK-012.
- Integration point: advanced settings reuses existing action components/APIs, including unchanged dirty `RoutingPage.tsx`; browser proof runs against a deterministic local fixture server.
- Integrated gate: complete control inventory, all client/server/connector tests and typechecks, client build, browser screenshots/accessibility/keyboard suite, full repository deterministic gate, final semantic review, `git diff --check` and staged-scope audit.
- Review focus: no stranded control, no fake action, reference fidelity, accessibility, responsive reachability, unrelated-diff exclusion.
- Handoff: releasable verified branch state; live provider behavior separately `UNMEASURED` if not authorized.
