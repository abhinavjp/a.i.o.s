# Sarathi view replacement — Discovery context

Date: 2026-09-22 (refreshed against current checkout `b8b25b32abe74c7f0ea014e1240284d4b461e872`)
Request: completely replace the current browser view with the supplied Mission Control prototype view. Product name remains **Sarathi**.

## 1. Scope and consumed decisions

- The supplied visual/interaction reference is `D:\AI\skills\Mission Control - a.i.o.s prototype.html`; it is accessible, materially inspected, and unchanged at SHA-256 `287FF513044861D12CA93DF32E02E1E6DAB86B775424F12E627322D050EE3B8E`.
- Current operator direction supersedes the earlier visual-design deferral in `docs/specs/mission-control.md`: replace the current view rather than incrementally decorate it. The existing product name remains Sarathi.
- Preserve the approved Mission Control model and vocabulary: work item, track, stage, phase, task, artifact, ask, standing rule, autopilot, floor, slot, capability tag. A track is never called a route.
- Preserve Sarathi's existing engine registry, routing, permission engine, task store, canonical history, safety floor, and no-secret-on-disk boundary. This is a view replacement, not authority to weaken or fake those behaviours.
- The request authorizes the full gated Forge workflow, including packet-by-packet commit and push only after exact Specification and Plan approvals. Discovery changed no UI source.

## 2. Evidence ledger and verified current behaviour

| Evidence | Freshness / provenance | Verified current behaviour |
| --- | --- | --- |
| User-supplied prototype, `D:\AI\skills\Mission Control - a.i.o.s prototype.html` | local source inspected 2026-09-22; SHA-256 `287FF513044861D12CA93DF32E02E1E6DAB86B775424F12E627322D050EE3B8E` | Full interactive reference: compact dark shell, hero, ranked asks, keyboard catch-up, aligned pipeline grid, activity, collapsible agent rail, artifact/work/phase/task drawers, direct intake, holds/stalls, rules/autopilot, and Jira/GitLab/agent connection wizards. Breakpoints collapse the grid/rail at 1000 px and simplify content at 760 px. It is simulated client state, not a server contract. |
| `app/client/src/App.tsx` | repository at `b8b25b32abe74c7f0ea014e1240284d4b461e872` | One monolithic command-oriented page. It fetches dashboard/setup/version data and implements ask decisions, catch-up hotkeys, pause/update controls, specialist creation/approval, task submit/cancel, standing rules/autopilot, proof/catalog controls, advanced routing and a separate work-items view. It does not render the prototype information architecture. |
| `app/client/src/work-items/WorkItemsPage.tsx` | same revision | Plain form/list/select surface for work items, tracks, stages, progress, phases, merge requests and artifact preview. It is not a pipeline board or drawer flow. |
| `app/server/src/sarathi/routes.ts`, `app/server/src/routes/workItems.ts`, `app/server/src/routes/credentials.ts`, `app/server/src/app.ts` | same revision | Existing HTTP surfaces expose dashboard asks/activity/specialists, work items/tracks/stages including ask-mediated mid-flight changes, artifacts/content, phases/tasks/progress, merge-request reads, setup, agents/slots, routing, pause, update state, decision actions, reference-only credential setup, and Jira/GitLab connection-status reads. |
| `docs/specs/mission-control.md`, `docs/adr/0007-mission-control-pivot.md`, `docs/adr/0008-one-decision-engine.md`, `CONTEXT.md` | repository-approved requirements | Mission Control is the product surface; the wireframe information architecture and behaviour are binding; one permission-based decision engine and immutable floor are mandatory. |

## 3. Functional-impact coverage and affected surfaces

| Dimension | Affected result |
| --- | --- |
| Actors and roles | Operator moves from generic controls to an asks-first control room. Existing agent/specialist status, slots and capability tags become agent-rail content; no new user role is evidenced. |
| States and transitions | Work item / track / stage / phase / task states must be visually mapped without client-side invented transitions. Ask approval, decline, catch-up and ticket-44 track changes can use verified server outcomes. Prototype hold, reminder and resume transitions have no durable contract and cannot appear to succeed. |
| Paths and cohorts | Cold start retains the three-step setup path; configured users receive the board. Direct intake and imported Jira work enter the same board without implying a Jira write. Advanced provider/runtime routing remains reachable as a secondary settings path, not the primary dashboard. |
| Permissions and policy | Artifact approval, track changes, Jira writes, protected-branch merge and updates must continue through asks/the floor. Prototype-looking controls must be disabled or visibly unavailable when the server cannot perform them; never show simulated success. |
| Integrations and contracts | Existing client calls can supply a first board. Credential references can now be configured without storing secrets, and connector status can be read, but full Jira/GitLab configuration and live connection tests, live pipeline reruns, protected-branch merge, work-source writes, agent configuration/runtime testing, artifact versions/diffs, and hold/reminder persistence exceed verified current API support. |
| Regression and history | Tickets 39–44 are committed at the current checkout. Ticket 43 demoted routing to advanced settings; retain it. Ticket 44 ask-mediates mid-flight track changes and validates current/proposed track state; preserve that behaviour and expose both tracks in the replacement. Preserve all shipped Mission Control behaviour rather than replacing its domain model with prototype state. |

### Prototype-to-current capability boundary

**Can render or invoke from current verified contracts:** asks/catch-up, activity, work items, approved and proposed tracks/stages, artifacts/content including unavailable state, phases/tasks/counts, merge-request summaries, specialists/slots/capability tags, task submit/cancel, setup state, pause state, update/version controls, standing rules/suggestions, autopilot, automatic-decision audit/undo, provider proofs/catalogs, advanced routing, reference-only credentials, and Jira/GitLab connection-status reads.

**Needs new or expanded server contracts before it can be real:** board-ready aggregate work-item projection, artifact version/diff metadata, persisted hold/reminder/resume flow, richer task/subagent/worktree/session projection, complete Jira/GitLab/agent connection wizard state and real test results, pipeline rerun/protected-merge proposals, Jira writes or ticket creation from direct intake, direct-intake proposal enrichment, and visual decision details such as unblocks/cost/ranking explanation. Connector expiry exists in the connector domain but is not a complete persisted wizard/settings contract.

### Existing-control migration inventory

- **Board shell/drawers:** ask decisions, activity, work items, tracks/stages, phases/tasks/progress, artifacts/content, merge-request summaries, specialists, slots and capability tags.
- **Catch-up/rules surfaces:** ranked asks, standing rules and suggestions, autopilot tiers, automatic-decision audit and undo.
- **Setup/connections surface:** first-run state, credential-reference creation, connector status, and honest unavailable states for unsupported configuration/tests.
- **Agent/detail surface:** specialist creation/approval, task submit/cancel, agent health and opt-in proof execution.
- **Advanced settings:** provider catalogs/refresh, routing policies/circuits/consent, runtime details, pause, release-channel/update/rollback controls. Ticket 43 prohibits restoring routing to primary navigation.
- No listed control may disappear unless Clarify explicitly authorizes exclusion or an observably equivalent replacement is specified.

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
- **UNMEASURED:** no complete server contract exists yet for the unsupported prototype flows listed above; credential-reference and ticket-44 track-change contracts are now measured in source but no live external connector was invoked.

## 6. Material conflicts and Clarify frontier

1. **Exact replacement boundary.** Decide whether unsupported prototype flows are (a) implemented with new real contracts in this effort, (b) shown as honest read-only/unavailable surfaces, or (c) excluded. This applies to complete connector setup/tests, pipeline rerun/protected merge, Jira writes/ticket creation, persistent holds/reminders, rich artifact versions/diffs, and agent configuration/testing. No simulated completion is allowed.
2. **Visual fidelity target.** Decide whether acceptance requires pixel-close reproduction at agreed desktop/mobile viewports or faithful reproduction of hierarchy, density, dark visual language, interactions and responsive behaviour under Sarathi branding.
3. **Migration boundary.** Decide whether every existing control in the inventory moves into the prototype shell/drawers/advanced settings, or whether any named controls may remain on a separate legacy utility surface or be removed. Silent deletion is not permitted.

## 7. Verification result

- **PASS:** current source at `b8b25b3`, unchanged prototype source/hash, Mission Control spec, glossary and pivotal ADRs inspected.
- **PASS:** current UI/API gap identified with a prototype-to-contract boundary.
- **PASS:** no source/UI mutation made during Discovery.
- **UNMEASURED:** visual and live-integration acceptance; requires a later approved Specification, Plan and implementation gates.

## Planning readiness

Discovery is bounded, but its three human decisions are material and must go through Clarify before Specification. Forge must then create and obtain exact approval for a Specification, create and obtain exact approval for a Plan, and only then implement approved packets. No source mutation is authorized by the full-workflow request alone.
