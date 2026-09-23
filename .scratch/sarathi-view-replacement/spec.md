# Sarathi Mission Control view replacement — Behavioural Specification

Revision: `spec-r1`
Date: 2026-09-22
Status: draft pending artifact-specific approval

## 1. Intent and boundary

Replace Sarathi's current generic browser dashboard with the supplied Mission Control prototype's information architecture and interaction model while preserving Sarathi's real domain, authority and runtime behaviour.

In scope: the configured Mission Control view, first-run/setup view, asks and catch-up, work pipeline and detail drawers, activity, artifacts, agents, Jira queue sync, GitLab merge-request/discussion observation and remediation handoff, rules/autopilot, every existing control, and advanced settings.

Non-goals: copying prototype sample state or legacy branding; simulated external success; bypassing the existing task, permission or decision systems; weakening the immutable floor; changing the meaning of route versus track; pixel-exact reproduction; or silently removing an existing control.

Binding constraints:

- Product name is **Sarathi**; approved glossary terms prevail.
- One permission-based decision engine governs asks, standing rules and autopilot.
- The immutable floor remains authoritative for protected or irreversible actions.
- Credentials remain external references and secret values are never persisted or rendered.
- Routing remains an advanced setting and applies according to its existing admission semantics.
- Ticket-44 mid-flight track changes retain current/proposed-track validation and ask mediation.
- External outcomes are shown only from observed evidence; absence is never presented as success.

## 2. Source basis

- `context.md`, refreshed at checkout `b8b25b32abe74c7f0ea014e1240284d4b461e872`; file SHA-256 `895CB232678B389EB35094FB5509392876249AAEDE805B9B44081DB24357C250`.
- `decisions.md`, approved clarification decisions DEC-001 through DEC-004; file SHA-256 `88B0E57BA178346741A9DB943809285BC2BFF0AA85F13231259939FF48866056`.
- Visual reference `D:\AI\skills\Mission Control - a.i.o.s prototype.html`; SHA-256 `287FF513044861D12CA93DF32E02E1E6DAB86B775424F12E627322D050EE3B8E`.
- Approved constraints carried through those artifacts: Mission Control product model, one decision engine, immutable floor, external secret references, ticket-43 advanced routing, and ticket-44 track changes.

## 3. Behavioural landscape

The operator sees one asks-first control room. Unconfigured installations see setup. Configured installations see live Sarathi state: asks, queued/running work, tracks and stages, artifacts, phases/tasks, merge requests, activity and agent capacity. The operator can inspect detail, make permitted decisions, admit work, manage rules, and reach every existing control without returning to the replaced generic dashboard.

Jira is a read-only work source. GitLab is an observation source for linked merge requests, pipelines and discussions. New unresolved human-authored GitLab discussions become Sarathi asks; approval or an eligible standing rule may admit an agent remediation task. Agent execution and external mutations remain separately governed. States such as admitted, fix produced, commit pushed, pipeline result and thread resolution remain distinct.

## 4. Behavioural requirements

| ID | Behaviour | Scope | Verification | Sources |
| --- | --- | --- | --- | --- |
| REQ-001 | The configured root view presents the prototype's asks-first hierarchy: Sarathi header/tools, standing-state hero, ranked asks, work pipeline, activity and agent rail, with detail surfaces opening from that hierarchy. | Configured operator; all data states. | Render populated fixtures and verify regions, order, relationships and navigation. | Context §§2–3; DEC-001. |
| REQ-002 | The replacement uses Sarathi branding and approved domain terms; it never presents prototype sample organizations, tickets, agents, outcomes or `a.i.o.s` branding as live state. | All visible copy and state. | Search rendered states and inspect populated fixtures. | Context §§1,4; DEC-001. |
| REQ-003 | Desktop, tablet and mobile compositions preserve the prototype's hierarchy and interactions across the reference's greater-than-1000 px, 761–1000 px and at-most-760 px responsive bands without requiring pixel-exact matching. | Supported browser widths. | Visual comparison at one representative viewport in each band plus interaction tests. | Context §2 visual evidence; DEC-001. |
| REQ-004 | Keyboard catch-up and documented primary shortcuts work when focus is not in an editable field; focus, escape/close behaviour and accessible names remain usable without a pointer. | Keyboard operator; drawers/modals/catch-up. | Keyboard and accessibility tests. | Prototype evidence; DEC-001. |
| REQ-005 | Loading, empty, unavailable, stale, blocked and failed states are visually distinct from successful live data, with the reason visible when known. | Every data-backed region. | Render each state and assert label/reason and absence of false success. | Context §§3,5; DEC-001. |
| REQ-006 | Asks are ranked using Sarathi's existing decision data and open into a detail surface that exposes decision context, consequences available from real data, and permitted outcomes. | Pending asks. | Fixture ordering and decision-detail tests. | Context capability boundary; one-engine constraint. |
| REQ-007 | Catch-up processes the same canonical asks as the main view; deciding, skipping or leaving catch-up cannot create a second approval system or divergent decision state. | Catch-up flow. | Decide/skip/exit scenarios against canonical ask state. | Context §4; one-engine constraint. |
| REQ-008 | Every decision, standing rule and autopilot outcome continues through the one permission-based decision engine; immutable-floor actions cannot be auto-approved or bypassed by UI state. | All decision-producing controls. | Permission/floor integration tests including attempted bypass. | Context §§1,3–4; binding constraints. |
| REQ-009 | The work pipeline renders real work items by track and stage and exposes real phase, task, counted progress, artifact and merge-request detail without estimating completion. | Queue and active work. | Mixed-state work-item fixtures and counted-progress assertions. | Context §§2–3; DEC-001. |
| REQ-010 | Mid-flight track-change asks show current and proposed tracks, and approval retains ticket-44 conflict checks so a stale proposal cannot mutate a changed track. | Existing tracked work item. | Concurrent-track-change acceptance scenario. | Context §§3–4; ticket-44 constraint. |
| REQ-011 | Jira synchronization reads the configured query on startup, explicit refresh and a configured interval, adding new matches to the queue and updating existing matches idempotently by source identity. | Connected Jira; repeated and overlapping results. | Controlled-clock connector tests with duplicate and changed tickets. | DEC-004; current Jira capability evidence. |
| REQ-012 | A Jira ticket absent from a later synchronization result is not silently deleted; its last observed source state and loss-of-observation status remain distinguishable. | Previously imported Jira work. | Sync present then absent and inspect queue/history. | DEC-004 truthful-state boundary. |
| REQ-013 | Jira synchronization remains read-only; failures create no work items from the failed response, preserve prior local work, and expose a clear unavailable/error state rather than stale success. | Connector error/auth/expiry/partial response. | Failure and recovery connector tests. | Context §§3,5; DEC-004. |
| REQ-014 | For each linked work item, GitLab supplies observed merge-request identity/state, pipeline status and unresolved/resolved human-authored discussion threads; system notes do not become remediation asks. | Connected GitLab and linked MRs. | Connector fixtures covering MR, pipeline, human discussion, system note and resolution. | DEC-004. |
| REQ-015 | Each newly observed unresolved non-system GitLab discussion creates at most one ranked Sarathi ask linked to its work item, merge request and stable discussion identity; polling and restart do not duplicate it. | New/repeated GitLab discussion observations. | Controlled polling/restart/deduplication tests. | DEC-002; DEC-004. |
| REQ-016 | A GitLab-discussion ask admits an ordinary remediation task only after operator approval or a valid standing-rule outcome, and only when an eligible agent capability is observed. | Pending discussion ask. | Approval, standing-rule, no-capability and floor scenarios. | DEC-002; one-engine constraint. |
| REQ-017 | When no eligible agent capability is observed, the discussion ask remains blocked with the reason visible and no remediation task is admitted. | Capability-absence state. | Agent registry fixture with no matching capability. | DEC-002. |
| REQ-018 | Remediation status distinguishes task admitted, fix produced, commit pushed, pipeline result and thread resolution; the UI labels a thread fixed only after GitLab reports it resolved. | Agent remediation lifecycle. | State-sequence test with out-of-order, failed and missing evidence. | DEC-002; DEC-004. |
| REQ-019 | Posting a GitLab comment, resolving a discussion, pushing, marking ready or merging is never inferred from agent output and remains subject to existing permission/floor enforcement. | External mutations. | Attempt each mutation without required authority and verify no success state. | DEC-002; immutable-floor constraint. |
| REQ-020 | Artifacts remain inspectable with real content and approval state; unavailable content is explicit, and approval continues through canonical asks rather than a drawer-local approval store. | Artifact list/detail/approval. | Available, unavailable, pending and approved artifact scenarios. | Context capability boundary; one-engine constraint. |
| REQ-021 | The agent rail/detail surfaces show observed health, slots, capability tags and task state; specialist creation/approval, task submit/cancel and opt-in proofs remain reachable and retain existing semantics. | Agents and specialist controls. | Control inventory and agent-state tests. | Context existing-control inventory; DEC-003. |
| REQ-022 | First run presents the three setup concerns—work source, code host and agent—and shows completion only from observed configuration/connection evidence. Credential entry persists references only and never redisplays a secret. | Unconfigured/partially configured operator. | Cold/partial/complete setup and no-secret-on-disk tests. | Context §§3,5; DEC-003/DEC-004. |
| REQ-023 | Every existing control in the approved migration inventory is reachable from the replacement shell, a drawer, or advanced settings; the generic dashboard and a separate legacy utility surface are not required for access. | Full operator control inventory. | Automated navigation inventory plus manual cross-check. | Context existing-control inventory; DEC-003. |
| REQ-024 | Provider catalogs, proof checks, routing policy/circuit/consent controls, runtime details, pause, release channel, update and rollback controls appear only in appropriate secondary or advanced surfaces and preserve their existing outcomes. | Advanced/operator administration. | Navigation and regression tests for every listed control. | Context existing-control inventory; DEC-003; ticket-43 constraint. |
| REQ-025 | Prototype-only simulation controls and any unsupported action are absent or explicitly unavailable; no click can produce a locally invented connection, import, fix, pipeline, merge, Jira write or agent result. | All prototype-derived controls. | Negative interaction audit over rendered controls. | Context §§3,5–6; DEC-001/DEC-004. |

## 5. Rules and boundaries

### Invariants

- **INV-01 — Canonical authority:** the view projects canonical server state; it does not own parallel business state for asks, work, tracks, permissions or external outcomes.
- **INV-02 — One decision engine:** all approval-like outcomes use the existing permission decision boundary.
- **INV-03 — Immutable floor:** standing rules, autopilot, agent capability and UI shortcuts cannot cross the floor.
- **INV-04 — Honest evidence:** `UNMEASURED`, unavailable, stale, failed and blocked are not success.
- **INV-05 — No secrets on disk/UI:** secret values do not enter durable Sarathi state or response/rendered output.
- **INV-06 — Terminology:** a track is a delivery-stage sequence; a route is runtime/provider/model selection.
- **INV-07 — No silent loss:** migration does not remove an existing control, and connector refresh does not silently delete imported work.

### Changed behaviour

- The generic dashboard is replaced by the prototype-derived Mission Control hierarchy.
- Jira work enters the queue through automatic and explicit read-only synchronization.
- GitLab discussions become observable and can drive canonical remediation asks/tasks.
- Existing controls are reorganized into the shell, drawers and advanced settings.

### Unchanged behaviour

- Work-item, track, stage, phase, task, artifact, ask, rule, autopilot, slot and capability meanings.
- Existing task admission/execution, routing resolution, permission decisions, floor enforcement, credential-reference handling, update behaviour and canonical history.
- Jira remains read-only unless a separately approved future contract changes that boundary.
- Protected GitLab actions remain externally corroborated and authority-gated.

### Edge and failure outcomes

- Duplicate connector observations are idempotent.
- Connector authentication, expiry, transport and malformed-response failures are visible and cannot overwrite prior valid state with invented emptiness or success.
- A removed/resolved GitLab discussion closes or updates its linked ask from observed identity; it does not create a replacement duplicate.
- A discussion that becomes resolved before task admission cannot admit stale remediation work without a new valid decision.
- Agent failure, cancellation or capability loss is visible and never advances external milestones.
- Stale track-change approval fails without mutating the track.

### Non-functional requirements

- Primary asks, queue and navigation remain operable by keyboard and expose accessible roles/names/focus.
- Responsive behavior preserves access to all controls in every supported band.
- Connector polling is bounded/configured, does not overlap itself, and remains deterministic under controlled time.
- Rendering a connector or agent failure must not make the rest of the control room unusable.

## 6. Acceptance and success

### AC-01 — Faithful populated control room

Given representative real Sarathi state, when the view renders in each responsive band, then the prototype-derived hierarchy, dark density, asks, pipeline, activity, rail and detail interactions are present with Sarathi branding and no sample state. Proves REQ-001–REQ-005.

### AC-02 — Decision integrity

Given pending ordinary and floor-protected asks, when the operator uses the main view, catch-up, a standing rule or autopilot, then every outcome is recorded by the canonical decision engine and the floor-protected action remains blocked without eligible approval. Proves REQ-006–REQ-008.

### AC-03 — Work and track truth

Given work in mixed track/stage/task/artifact states and a concurrent track edit, when the pipeline and change ask are used, then counted state is shown, current/proposed tracks are visible, and stale approval cannot mutate the newer track. Proves REQ-009–REQ-010 and REQ-020.

### AC-04 — Jira queue synchronization

Given configured Jira results containing new, changed, duplicate and later-absent tickets, when startup, explicit and scheduled syncs occur, then queue entries are idempotently added/updated, absence is retained as loss of observation, and no Jira write occurs. A failed sync adds nothing and displays failure. Proves REQ-011–REQ-013.

### AC-05 — GitLab discussion remediation

Given a linked MR with a new human unresolved discussion, repeated polls, no eligible agent, later capability, approval, agent output, push, pipeline and resolution observations, then exactly one ask is created, it blocks without capability, admits once authorized, reports each milestone separately, and says fixed only after GitLab reports resolution. Proves REQ-014–REQ-019.

### AC-06 — Setup and honest unavailability

Given cold, partial, disconnected and failed integration states, when setup and connection surfaces render, then only observed completion is shown, secrets are not persisted/rendered, and unsupported actions cannot simulate success. Proves REQ-022 and REQ-025.

### AC-07 — Complete control migration

Given the approved existing-control inventory, when each control is exercised from the replacement, then every control is reachable through the shell, drawers or advanced settings and retains its observable result; routing remains secondary and ticket-44 behavior remains intact. Proves REQ-021, REQ-023 and REQ-024.

Success requires all seven acceptance scenarios to pass, deterministic client/server/connector regression checks to pass, and visual/accessibility inspection to report `PASS`. Live Jira, GitLab or agent behavior not exercised against an authorized environment remains `UNMEASURED`, never promoted to `PASS` by fakes.

## 7. Traceability

| Source | Requirements |
| --- | --- |
| Discovery scope, evidence and visual reference | REQ-001–REQ-010, REQ-020–REQ-025 |
| Discovery capability boundary and existing-control inventory | REQ-005–REQ-010, REQ-020–REQ-025 |
| DEC-001 faithful fidelity | REQ-001–REQ-005, REQ-025 |
| DEC-002 agent remediation | REQ-015–REQ-019 |
| DEC-003 migrate all controls | REQ-021–REQ-024 |
| DEC-004 first-class Jira/GitLab observation | REQ-011–REQ-019, REQ-022, REQ-025 |
| One decision engine and immutable floor | REQ-006–REQ-008, REQ-010, REQ-015–REQ-020 |
| Ticket-43 advanced routing | REQ-023–REQ-024 |
| Ticket-44 mid-flight track changes | REQ-010, REQ-023 |

No material behavioural decision remains open. Planning may choose implementation structure only after this exact Specification revision receives valid artifact approval.
