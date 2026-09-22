# Sarathi view replacement — Discovery context

Date: 2026-09-22
Request: completely replace the current browser view with the supplied Mission Control prototype view. Product name remains **Sarathi**.

## 1. Scope and consumed decisions

- The supplied visual/interaction reference is `D:\AI\skills\Mission Control - a.i.o.s prototype.html`; it is accessible and materially inspected.
- Current operator direction supersedes the earlier visual-design deferral in `docs/specs/mission-control.md`: replace the current view rather than incrementally decorate it. The existing product name remains Sarathi.
- Preserve the approved Mission Control model and vocabulary: work item, track, stage, phase, task, artifact, ask, standing rule, autopilot, floor, slot, capability tag. A track is never called a route.
- Preserve Sarathi's existing engine registry, routing, permission engine, task store, canonical history, safety floor, and no-secret-on-disk boundary. This is a view replacement, not authority to weaken or fake those behaviours.
- The request is discovery/planning only. No UI source was changed.

## 2. Evidence ledger and verified current behaviour

| Evidence | Freshness / provenance | Verified current behaviour |
| --- | --- | --- |
| User-supplied prototype, `D:\AI\skills\Mission Control - a.i.o.s prototype.html` | local source inspected 2026-09-22 | Full interactive reference: hero, ranked asks, catch-up, pipeline grid, activity, agent rail, artifacts, work/phase/task drawers, direct intake, holds/stalls, rules/autopilot, and Jira/GitLab/agent connection wizards. It is simulated client state, not a server contract. |
| `app/client/src/App.tsx` | repository at `6d6cd288aa66d99afaf16c151ef2e210f0c505a7` | One monolithic command-oriented page. It fetches dashboard/setup/version data and implements ask decisions, catch-up hotkeys, agent/task controls, advanced routing and a separate work-items view. It does not render the prototype information architecture. |
| `app/client/src/work-items/WorkItemsPage.tsx` | same revision | Plain form/list/select surface for work items, tracks, stages, progress, phases, merge requests and artifact preview. It is not a pipeline board or drawer flow. |
| `app/server/src/sarathi/routes.ts`, `app/server/src/routes/workItems.ts`, `app/server/src/app.ts` | same revision | Existing HTTP surfaces expose dashboard asks/activity/specialists, work items/tracks/stages, artifacts/content, phases/tasks/progress, merge-request reads, setup, agents/slots, routing, pause, update state, and decision actions. |
| `docs/specs/mission-control.md`, `docs/adr/0007-mission-control-pivot.md`, `docs/adr/0008-one-decision-engine.md`, `CONTEXT.md` | repository-approved requirements | Mission Control is the product surface; the wireframe information architecture and behaviour are binding; one permission-based decision engine and immutable floor are mandatory. |

## 3. Functional-impact coverage and affected surfaces

| Dimension | Affected result |
| --- | --- |
| Actors and roles | Operator moves from generic controls to an asks-first control room. Existing agent/specialist status, slots and capability tags become agent-rail content; no new user role is evidenced. |
| States and transitions | Work item / track / stage / phase / task states must be visually mapped without client-side invented transitions. Ask approval, decline, catch-up, hold, stall and resume must reflect server outcomes and retain the permission-engine boundary. |
| Paths and cohorts | Cold start retains the three-step setup path; configured users receive the board. Direct intake and Jira-backed work enter the same board. Advanced provider/runtime routing remains reachable as a secondary settings path, not the primary dashboard. |
| Permissions and policy | Artifact approval, track changes, Jira writes, protected-branch merge and updates must continue through asks/the floor. Prototype-looking controls must be disabled or visibly unavailable when the server cannot perform them; never show simulated success. |
| Integrations and contracts | Existing client calls can supply a first board. Connection wizards, full Jira/GitLab connection tests/configuration, live pipeline reruns, protected-branch merge, work-source writes, agent runtime testing, artifact versions/diffs, and hold/reminder persistence exceed verified current API support. |
| Regression and history | Ticket 43 intentionally demoted routing to advanced settings; retain it. Ticket 44 adds mid-flight track changes; render its current/proposed track data in asks. Preserve the already shipped 44 Mission Control tickets rather than replacing their domain behaviour. |

### Prototype-to-current capability boundary

**Can render from current verified data:** asks/catch-up, activity, work items, tracks/stages, artifacts (including unavailable state), phases/tasks/counts, merge-request summaries, specialists/slots/capability tags, setup state, pause state, update version, standing-rule suggestions and automatic-decision audit.

**Needs new or expanded server contracts before it can be real:** board-ready aggregate work-item projection, artifact version/diff metadata and review actions, persisted hold/reminder/resume flow, richer task/subagent/worktree/session projection, Jira/GitLab/agent connection wizard state and real test results, connector settings/expiry visibility, pipeline rerun/merge proposals, direct-intake proposal enrichment, and visual decision details such as unblocks/cost/ranking explanation.

## 4. Material relationships and requirement-changing history

- `docs/adr/0007-mission-control-pivot.md` replaces the old PRD product surface while retaining the existing runtime/permission/task foundations.
- `docs/adr/0008-one-decision-engine.md` rejects a separate UI approval system. All replacement interactions that decide work must call the existing ask/permission boundary.
- `docs/specs/mission-control.md` says the wireframe's information architecture and behaviour are binding but its visual layer was deferred. The current explicit request to completely replace the view is newer direction for the visual layer; it does not revoke the domain and safety decisions.
- The prototype uses legacy labels and sample data (including `a.i.o.s` wording and simulated external outcomes). Sarathi naming and existing glossary win; sample data must not be copied as product state.

## 5. Unavailable evidence, freshness and visual status

- **PASS:** prototype source is readable and sufficient to inventory intended views and client-side flows.
- **PASS:** current repository source and Mission Control requirement documents are readable.
- **UNMEASURED:** no live Jira, GitLab, or real agent connection was invoked. Their production behaviour, credentials and runtime readiness are not inferred from the prototype.
- **UNMEASURED:** browser visual comparison against a fully populated live server dataset. The local shell was previously running, but this discovery did not create representative production data or assert pixels.
- **UNMEASURED:** no server contract exists yet for the unsupported prototype flows listed above.

## 6. Material conflicts and Clarify frontier

1. **Exact replacement boundary.** The prototype simulates external writes and agent execution that Sarathi does not currently expose. Specification must decide, per prototype flow, whether the first replacement release delivers a real contract, an honest unavailable/read-only state, or excludes the flow. It may not fake a completed connection, pipeline rerun, merge, or Jira write.
2. **Visual fidelity target.** The request establishes the prototype as the new view reference, but not whether exact pixel matching is required versus faithful hierarchy, interaction and responsive behaviour under Sarathi branding. Route this to `forge-clarify` only if Specification cannot define acceptance from the reference.
3. **Migration boundary.** Existing command/task controls must either be relocated into drawers/advanced settings or explicitly retained. Deleting them without a mapped replacement risks loss of already-shipped behaviours.

## 7. Verification result

- **PASS:** current source, prototype source, Mission Control spec, glossary and pivotal ADRs inspected.
- **PASS:** current UI/API gap identified with a prototype-to-contract boundary.
- **PASS:** no source/UI mutation made during Discovery.
- **UNMEASURED:** visual and live-integration acceptance; requires a later approved Specification, Plan and implementation gates.

## Planning readiness

Discovery is sufficient for Specification. Forge must now create and approve a Specification, then create and approve a Plan before any implementation. The likely delivery sequence is: board projection and typed client model; shell/layout; asks and catch-up; work pipeline/drawers; agent rail/activity; setup and connection surfaces; advanced settings migration; visual/integration tests. This sequence is a dependency observation only, not an approved implementation plan.
