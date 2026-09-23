# Sarathi view replacement — Clarification decisions

Date: 2026-09-22
Scope: replacement of the current Sarathi browser view using `D:\AI\skills\Mission Control - a.i.o.s prototype.html`.
Discovery input: `.scratch/sarathi-view-replacement/context.md`, refreshed against `b8b25b32abe74c7f0ea014e1240284d4b461e872`.

## DEC-001 — Faithful visual fidelity

- **Status:** approved and settled.
- **Decision:** Reproduce the prototype's information hierarchy, dark visual language, density, layout, drawers, rail, modals, catch-up flow, keyboard interactions, responsive bands, and loading/empty/error states. Use real Sarathi data, branding, terminology, safety behaviour and all migrated controls. Do not copy prototype sample data, legacy `a.i.o.s` branding, prototype-only simulation controls, fake external results, or rigid pixel values that harm accessibility or responsiveness. The prototype governs presentation; Sarathi's approved contracts govern wording, data, behaviour and safety. Acceptance compares desktop, tablet and mobile compositions; exact pixel matching is not required.
- **Approver:** operator/user.
- **Natural-language approval:** “Approved”, in response to the presented faithful-visual boundary and connector policy.
- **Provenance/freshness:** current conversation, 2026-09-22; prototype SHA-256 `287FF513044861D12CA93DF32E02E1E6DAB86B775424F12E627322D050EE3B8E`.

## DEC-002 — External remediation uses capable agents

- **Status:** approved and settled with DEC-004.
- **Decision:** Agents use their MCPs or skills for remediation. A new unresolved actionable GitLab discussion creates a ranked ask. Operator approval or an explicit standing rule admits an ordinary Sarathi task only to an eligible agent with the required capability. The UI reports observed milestones separately and never claims a fix until GitLab corroborates thread resolution. Posting, resolving, pushing and merging remain governed by the existing decision engine and immutable floor.
- **Approver:** operator/user.
- **Natural-language approval:** “Agents will have the MCPs or skills for it for now”.
- **Binding constraints:** the one permission-based decision engine and immutable floor still govern authorization; the UI may display only real observed execution and results, never simulated success.
- **Capability absence:** when no eligible capability is observed, the ask remains blocked with the reason visible and no task is admitted.
- **Provenance/freshness:** current conversation, 2026-09-22; consistent with refreshed discovery and current checkout.

## DEC-003 — Migrate all existing controls

- **Status:** approved and settled.
- **Decision:** Migrate every existing control into the replacement shell, its drawers, or advanced settings. No legacy utility page and no silent removal.
- **Approver:** operator/user.
- **Natural-language approval:** “migrate all into shell/drawers/advanced settings”.
- **Scope:** the complete existing-control migration inventory in the refreshed Discovery context, including ticket-43 advanced routing and ticket-44 track-change behaviour.
- **Provenance/freshness:** current conversation, 2026-09-22; current checkout `b8b25b32abe74c7f0ea014e1240284d4b461e872`.

## DEC-004 — Jira and GitLab are first-class observation connectors

- **Status:** approved and settled.
- **Decision:** Keep real Jira and GitLab connectors. Jira performs idempotent read-only sync on startup, explicit refresh and a configured interval; matching tickets enter or update Sarathi's queue, and absence from a later result never silently deletes work. GitLab reads linked merge requests, pipelines and discussion threads. New unresolved non-system discussions follow DEC-002.
- **Approver:** operator/user.
- **Natural-language approval:** “we will need JIRA and Gitlab connector. JIRA to read and get work items added in queue. Gitlab to see status of MR and if any threads are there and if new threads are posted then handoff to agent to fix it or something like that”.
- **Current evidence:** Jira assigned-ticket read/import and GitLab merge-request, pipeline, file and diff reads already exist at `b8b25b3`; GitLab discussion/thread reads, durable new-thread detection and remediation handoff do not.
- **Binding constraints:** read failures show no invented or stale success; credentials remain external references; external writes and agent work remain governed by the one decision engine and immutable floor.
- **Truthful result boundary:** display task admission, produced fix, pushed commit, pipeline result and GitLab thread resolution as distinct observed states. GitLab thread resolution is required before the UI labels the thread fixed.
- **Provenance/freshness:** current conversation and current source inspection, 2026-09-22.

## Open frontier

No unresolved human decisions.
