# Sarathi Mission Control view replacement — Detailed Plan

Revision: `plan-r1`
Date: 2026-09-23
Status: draft pending artifact-specific approval
Mode: detailed

## Outcome

Deliver the approved `spec-r1` as a truthful, prototype-derived Sarathi control room with real Jira queue synchronization, real GitLab discussion observation, ask-mediated agent remediation, complete control migration, and no weakening of existing authority or domain behaviour.

## Authority and baseline

- Intent: `intent.md`, repository baseline `b8b25b32abe74c7f0ea014e1240284d4b461e872`.
- Approved Specification: `.scratch/sarathi-view-replacement/spec.md`, revision `spec-r1`, canonical hash `2bee86f62c03cf6edca0598ace6bb01cb9e3c70454c06a522ce079cbf320e947`, approved by user with `intent: artifact` at workflow order 4.
- Approved decisions: DEC-001 through DEC-004 in `.scratch/sarathi-view-replacement/decisions.md`.
- Visual reference: `D:\AI\skills\Mission Control - a.i.o.s prototype.html`, SHA-256 `287FF513044861D12CA93DF32E02E1E6DAB86B775424F12E627322D050EE3B8E`.
- Planning gate: canonical `can_enter_stage(..., "planning")` returned `ALLOWED`.

## Scope and exclusions

Owns the approved requirements REQ-001 through REQ-025 and acceptance scenarios AC-01 through AC-07.

Excludes Jira writes; automatic GitLab comments/resolution/merge; direct browser-to-provider writes; invented progress; prototype sample state; legacy branding; new routing semantics; weakening the floor; and edits to unrelated dirty files.

## Frozen contracts and decisions

- **CON-001 — Server projection:** a typed Mission Control read projection composes canonical stores/connectors and carries explicit loading-independent availability/failure/source-observation state. Existing action boundaries remain canonical.
- **CON-002 — Work-source observation:** imported work keeps stable source identity, last observed source state/time, and observation status. Upsert is idempotent; a missing later result marks loss of observation and never deletes work.
- **CON-003 — Bounded synchronization:** Jira and GitLab observation use injected clock/scheduler seams, single-flight execution, startup/explicit/configured-interval triggers, durable deduplication, and clear failure/recovery state.
- **CON-004 — GitLab discussions:** connector records stable project/MR/discussion/note identities, human/system authorship, resolved state and observed timestamps. Only new unresolved non-system discussions can create remediation asks.
- **CON-005 — Remediation admission:** discussion asks use the existing permission engine. Approval or a valid standing rule admits an ordinary task through existing task execution only when an eligible capability is observed. Connector observation never invents or performs the fix.
- **CON-006 — Corroborated milestones:** admitted, fix-produced, pushed, pipeline and resolved are independent states. Only a later GitLab observation can mark the discussion resolved/fixed.
- **CON-007 — Client migration:** new UI modules live under `app/client/src/mission-control/`; `App.tsx` becomes composition, not a second state authority. Existing controls move before legacy presentation is retired.
- **CON-008 — Visual system:** preserve the reference's embedded Inter face, dark palette, compact density, structural borders, asks-first hierarchy and breakpoint bands. Motion is interaction-driven, reduced-motion aware, and secondary to legibility.
- **CON-009 — Browser proof:** add deterministic browser visual/accessibility coverage with local fixtures and representative viewports in all three responsive bands; live providers remain separately `UNMEASURED`.

## Invariants

All approved Specification invariants INV-01 through INV-07 apply to every packet. In particular: canonical authority, one decision engine, immutable floor, honest evidence, no secrets, route/track terminology, and no silent loss.

## Risks

- **RSK-001 — Durable-state loss (high):** schema changes could discard work/source/discussion history. Requires additive migrations, legacy fixtures and independent review.
- **RSK-002 — Duplicate or stale remediation (high):** polling/restarts could create duplicate asks/tasks or admit resolved work. Requires stable identities, durable dedupe and stale-state checks.
- **RSK-003 — Authority bypass (high):** UI or automation could bypass the decision engine/floor. Requires negative integration tests and independent review.
- **RSK-004 — Control loss (medium):** replacing the monolith could strand existing controls. Requires expand-migrate-contract and a complete navigation inventory.
- **RSK-005 — Visual drift/accessibility (medium):** functional UI may miss the reference or keyboard behavior. Requires reference-derived tokens, screenshots and accessibility checks.
- **RSK-006 — External readiness (medium):** live Jira/GitLab/agent behavior cannot be claimed from fakes. Record authorized live proof only; otherwise `UNMEASURED`.
- **RSK-007 — Dirty-tree collision (high):** user-owned edits may overlap. Capture baseline before every packet; never edit/stage listed external paths. `app/client/src/routing/RoutingPage.tsx` is reused without modification.

## Dirty baseline and protected external scope

At planning time, preserve all pre-existing changes except this work item's `.scratch/sarathi-view-replacement/**` artifacts. Protected paths include `.claude/**`, `CONTEXT.md`, `PRD.md`, `app/client/src/routing/RoutingPage.tsx`, `.scratch/mission-control/**`, `.scratch/sarathi-multi-runtime-routing/**`, `.ticket40-pack/**`, `.npm-cache-ticket40/**`, `.tmp-ticket*`, and untracked ADR/spec files under `docs/`. Recheck before each packet; newly dirty paths are also external unless created by the active packet.

## Phase graph and executable frontier

```text
PHS-01 durable work projection and Jira sync
  TSK-001 -> TSK-002
PHS-02 GitLab discussion observation
  TSK-002 -> TSK-003 -> TSK-004
PHS-03 safe remediation admission and evidence
  TSK-004 -> TSK-005 -> TSK-006
PHS-04 prototype-derived control-room shell
  TSK-006 -> TSK-007 -> TSK-008
PHS-05 decisions, connectors and setup in the new shell
  TSK-008 -> TSK-009 -> TSK-010
PHS-06 full control migration and acceptance
  TSK-010 -> TSK-011 -> TSK-012
```

Initial executable frontier after the Implementation gate: `TSK-001` only. Exactly one packet executes at a time.

## Phase index

| Phase | Outcome | Risk | Requirements |
| --- | --- | --- | --- |
| PHS-01 | Durable board projection and truthful Jira queue sync | high | REQ-005, REQ-009, REQ-011–REQ-013 |
| PHS-02 | Durable GitLab MR/discussion observation and one ask per new thread | high | REQ-014–REQ-015 |
| PHS-03 | Capability-aware, floor-safe remediation with corroborated milestones | high | REQ-016–REQ-019 |
| PHS-04 | Responsive prototype-derived shell and real work/detail surfaces | medium | REQ-001–REQ-005, REQ-009, REQ-020–REQ-021 |
| PHS-05 | Canonical asks/catch-up, connectors and setup inside the shell | high | REQ-006–REQ-008, REQ-010–REQ-019, REQ-022 |
| PHS-06 | Every remaining control migrated; visual/accessibility/full acceptance | medium | REQ-003–REQ-004, REQ-021–REQ-025 |

## Integration and compatibility

- Use expand-migrate-contract for durable schemas and UI replacement. Old stored documents must open before new fields are written.
- Existing action endpoints remain available while the new read projection and UI are introduced.
- The generic UI remains reachable only during intermediate packets; TSK-011 removes the legacy presentation after inventory proof.
- Existing `RoutingPage` behavior is embedded/reached from advanced settings without editing its dirty source file.
- Provider failures are isolated by region; the rest of Mission Control remains usable.

## Verification policy

Each task runs its stated narrow tests and relevant package typecheck. Each phase runs its integrated gate, a whole-phase semantic review, remediation of blocking findings, affected reruns, and one final phase review. High-risk/state/security phases require an independent reviewer. After TSK-012, run one repository-wide final semantic review against the approved Specification and Plan.

Repository-wide deterministic gate:

1. Set a unique writable `AIOS_DATA_DIR` under the workspace.
2. `npx vitest run`
3. `npx tsc -p contracts/tsconfig.json --noEmit`
4. `npx tsc -p agents/tsconfig.json --noEmit`
5. `npx tsc -p connectors/tsconfig.json --noEmit`
6. `npx tsc -p app/server/tsconfig.json --noEmit`
7. `npm run typecheck -w app/client`
8. `npm run build -w app/client`
9. Browser visual/accessibility suite from TSK-012.
10. `git diff --check` limited to intended files, plus staged-scope audit.

Live Jira, GitLab and real-agent execution require separate authorized fixtures. If unavailable, record `UNMEASURED`; fake transport/runtime results prove contracts only.

## Commit and delivery policy

```yaml
commit_granularity: task
commit_approval: preapproved
history_style: separate
push_remote: origin
push_refspec: HEAD:main
```

The user's original request preauthorizes one honest commit and push for each verified packet. A packet commits only when all required local proof is `PASS` and zero blocking findings remain. Stage only packet-owned files. Never use plain `git push` because the local upstream is mismatched; push explicitly to `origin HEAD:main`. After every push verify local HEAD, `refs/remotes/origin/main`, and the remote branch SHA all equal. A rejected/non-fast-forward push stops delivery; never force-push. Commit/push authority does not authorize PR creation, merge, deployment, release, Jira writes or GitLab writes.

The approved Forge artifact tree is staged with TSK-001 as provenance; later evidence goes in `.scratch/sarathi-view-replacement/evidence.md` without modifying approved Plan packets.

## Final acceptance

- AC-01 through AC-07 pass with deterministic evidence.
- All REQ-001 through REQ-025 and INV-01 through INV-07 trace to verified packets.
- No protected dirty path is edited, staged or delivered.
- Exactly one final semantic review is completed; all blocking findings are remediated and affected gates rerun.
- Required checks are `PASS`; any authorized live proof not run is explicitly `UNMEASURED`.
- Every verified packet has one separate commit and verified `origin/main` push.

This Plan is not implementation authority until this exact detailed tree and control-plane hash receive valid artifact approval.
