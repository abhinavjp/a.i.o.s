# Sarathi v1 — proposed ticket breakdown

Status: draft for approval; not published tickets and not ready-for-agent. Source: [Sarathi specification](sarathi-v1.md). Tracker/triage configuration and test-seam confirmation remain unresolved. Run `/setup-matt-pocock-skills` before publication.

## Slicing and readiness

Ticket 01 is a discovery prerequisite. Each implementation slice delivers behavior through persistence, application API, dashboard or notification surface, and tests. Keep necessary prefactoring within the first durable-task slice and affected features, preserving existing behavior during transition. No wide mechanical refactor is justified by the small current codebase.

Blockers below are direct prerequisites; transitive edges are omitted. Dependencies do not authorize production writes. Use separately authorized fixtures for real message/comment/Jira/merge validation. Each stateful slice includes failure and restart behavior; the release slice checks their composition.

## 01. Close launch decisions

**Blocked by:** None — discovery can start; operator decisions may be needed.

**Delivers:** Resolve the spec's open decisions into an implementation-ready baseline, with supported subscription/runtime and tenant evidence.

**Acceptance outline:**

- Close U1–U16 through evidence or explicit operator decisions; never invent spending, recipient, calendar, or merge policy.
- Confirm the application API test seam and selected subscription routes; document unverified live behavior and authorized validation fixtures.
- Freeze only required v1 choices; no implementation or external writes in this prerequisite.

## 02. Resume a task after restart

**Blocked by:** 01.

**Delivers:** Submit a fake-backed task in the dashboard, see its durable result, restart the backend, and recover the same task.

**Acceptance outline:**

- Introduce structured outcomes through the existing application boundary, preserving current behavior while replacing the in-memory-only path.
- Dashboard distinguishes completed, failed, blocked, and unavailable; reconnect does not rerun work.
- Application-boundary tests reconstruct against the same temporary store; no external runtime required.

## 03. Configure and chat with specialists

**Blocked by:** 02.

**Delivers:** Create approved persistent specialist definitions through chat or forms, then route a task to a selected specialist.

**Acceptance outline:**

- Forms and conversation use identical configuration and stable agent identities; support multiple instances per role.
- Explain overlaps before permanent creation; direct specialist chats and coordinator routing retain distinct task scopes.
- Fake-backed routing/configuration survives restart and returns an inspectable outcome.

## 04. Run through one subscription-backed runtime

**Blocked by:** 03.

**Delivers:** Execute a bounded task from the dashboard using the selected first native subscription runtime.

**Acceptance outline:**

- Prove supported login and billing route; forbid API fallback, token repurposing, or accidental paid environment configuration.
- Display attributable events, session identity, structured terminal result, usage or unknown, and bounded failure/cancellation.
- Test real adapter on an authorized non-sensitive fixture; fake success is not sufficient.

## 05. Load scoped context and recover knowledge

**Blocked by:** 03.

**Delivers:** Start and resume a task with visible required-context sources and retrieve only authorized project knowledge.

**Acceptance outline:**

- Required context manifests and effective versions are inspectable; missing mandatory context blocks just dependent work.
- Keep operational records distinct from knowledge; user correction/deletion follows the resolved retention policy.
- Demonstrate cross-project exclusion, stale-source handling, predictable artifacts and restart recovery through the API/UI.

## 06. Use and safely update skills

**Blocked by:** 05.

**Delivers:** Assign a versioned skill to a specialist, run it, then review and activate an evaluated update or roll back.

**Acceptance outline:**

- Metadata-first loading, canonical definitions and explicit project overrides remain attributable per run.
- Task evidence is automatic; inferred shared instructions and skill activation need approval.
- Rejected/regressing updates never silently replace active versions; required merge-sentinel integration is validated.

## 07. Coordinate bounded delegated work

**Blocked by:** 04, 06.

**Delivers:** Let Sarathi delegate an analysis task while another chat waits for input, with visible progress and enforced resource limits.

**Acceptance outline:**

- Global worker/depth accounting covers simultaneous tasks and runtime-native children under the resolved policy.
- Only approved runtimes/fallbacks may execute; no API spending; provider/global quota rules are visible.
- One waiting task does not stop unrelated work; scoped context, permission and output attribution hold across children.

## 08. Start at login and control pause

**Blocked by:** 02.

**Delivers:** Run the local host at login with tray/dashboard pause and recover correctly across lock, browser closure and sleep.

**Acceptance outline:**

- Honor resolved manual pause/in-flight policy and retain manual pause across automatic recovery.
- Show scoped automatic blockers; no new dispatch while manually paused; reconcile already-issued writes.
- Verify Windows login/lock/sleep behavior separately from fake integration tests; sign-out operation remains out of scope.

## 09. Discover assigned MRs

**Blocked by:** 02.

**Delivers:** Use Check now or a 15-minute poll to list Assignee/Reviewer MRs with reachability and coverage status.

**Acceptance outline:**

- Use a capable adapter with pagination, deduplication, stable identities and confirmed operator identity; no allowlist.
- VPN launch/readiness obeys the one-attempt/two-minute policy; failure blocks dependent work only.
- Dashboard retains discovery results; unchanged polls do not duplicate tasks; read-only live capability proof required.

## 10. Group MRs and untangle Jira links

**Blocked by:** 09.

**Delivers:** Turn discovered MRs into Jira groups, showing ambiguous linkage and allowing the operator to resolve it.

**Acceptance outline:**

- Apply resolved multi-key/history/group rules and loose-key normalization; include related unassigned MRs.
- Retain unresolved groups for available review; unknown Jira never becomes an automatic no-Jira merge exception.
- Group evidence and changes are visible, persisted, and testable across pagination/access failures.

## 11. Review a group into evidence-backed drafts

**Blocked by:** 07, 10.

**Delivers:** Review group MRs using merge-sentinel and display per-file coverage with draft positioned findings.

**Acceptance outline:**

- Every changed file is accounted for under the resolved special-file policy; material gaps block complete/safe claims.
- New commits/requests/replies trigger relevant re-review; unchanged evidence is reused only under agreed validity rules.
- No external write occurs; findings, questions, disagreement, inspected revisions and artifacts are visible and validated.

## 12. Approve revision-bound action batches

**Blocked by:** 02.

**Delivers:** Review an exact proposed action set, approve or reject it, and see validated execution through fake integration effects.

**Acceptance outline:**

- Bind payload/resource/revision/group/gate identity to approval; apply resolved no-Jira, expiry and partial-approval rules.
- Changed code invalidates approval; agents cannot dispatch around the executor or gain credentials.
- Reject, restart, stale approval and uncertain dispatch have observable durable outcomes; blocked-review publication does not require merge eligibility.

## 13. Publish and maintain inline findings

**Blocked by:** 11, 12.

**Delivers:** Publish approved resolvable findings, verify placement, and correct Sarathi-owned comments from the review task.

**Acceptance outline:**

- Use correct diff references/path/side/line and verify remote identity, body, placement and resolvability.
- Preserve others' comments/replies; developer resolution triggers code verification before resolving own threads.
- Duplicate/timeout/restart cases reconcile; real writes only on an explicitly authorized fixture.

## 14. Apply Jira assignment and severity policy

**Blocked by:** 10, 12.

**Delivers:** Preview and execute approved Jira field changes from a group task, with exact assignments and change evidence.

**Acceptance outline:**

- Tester-first and confirmed Reporter exceptions use verified account IDs; ambiguous assignments request input.
- Update ordinary Severity only; Reviewed By and original-value conflicts follow resolved rules.
- Remotely verify changes, preserve prior values/results, and block dependent merge actions when required edits fail.

## 15. Merge eligible groups and complete Jira

**Blocked by:** 11, 13, 14.

**Delivers:** Execute an approved eligible merge sequence and transition Jira only after every group MR is confirmed merged.

**Acceptance outline:**

- Enforce Assignee-only, group safe verdicts, threads, Jira status, draft, applicable CI and native server gates.
- Use reviewed source revision guard plus resolved target/group drift/order policy; no-Jira MRs skip Jira-only steps.
- Partial failure stops that group, preserves completed effects and unchanged Jira status; post-merge transition failures remain distinct and recoverable.

## 16. Confirm Teams identity and send a notification

**Blocked by:** 12, 13.

**Delivers:** Resolve and confirm the developer's Teams identity, then send and verify the approved immediate blocked-review notice.

**Acceptance outline:**

- Use selected delegated operator sending if proven practical; never silently replace with bot identity.
- Persist verified tenant/user/chat mappings; names alone cannot authorize first contact.
- Observe team sending hours, sender/recipient/content approval scope and uncertain-send reconciliation on an authorized fixture.

## 17. Confirm team holidays

**Blocked by:** 02.

**Delivers:** Show Indian holiday candidates and ask the previous day whether the team will actually be off.

**Acceptance outline:**

- Use resolved region/source, confirmation time and unanswered/late-answer behavior.
- Persist operator decisions and expose resulting working calendar; public holidays are never assumed company days off.
- Test timezone, weekend, notification deduplication and restart behavior through controlled clock and UI.

## 18. Send bounded working-hour reminders

**Blocked by:** 16, 17.

**Delivers:** Automatically send the approved three/six-working-hour reminders and stop when the review round clears.

**Acceptance outline:**

- Start rounds at findings publication; replies/commits do not reset; later new blockers after clearance create a new round.
- Honor working hours/confirmed holidays and bounded sequence approval; recheck current threads before sending.
- At most two reminders; highest-threshold catch-up sends once and consumes overdue thresholds; restart/timeouts do not duplicate effects.

## 19. Present consolidated delivery reports

**Blocked by:** 15, 18.

**Delivers:** Show per-MR evidence and a cross-Jira report covering blocked, skipped, partial and complete outcomes.

**Acceptance outline:**

- Render required reporting columns and Merged JIRAs/Still blocked lists without invented no-Jira keys.
- Expose artifacts, gate reasons, applied field changes and merge receipts; distinguish merged plus Jira-update-blocked.
- Windows notification links open the correct persisted task; usage remains measured or explicitly unknown.

## 20. Verify and package the first release

**Blocked by:** 08, 19.

**Delivers:** Install/update the local application and demonstrate the complete workflow with recovery and rollback-ready data handling.

**Acceptance outline:**

- Apply resolved packaging/migration/backup/retention policy; start-at-login and user configuration survive supported updates.
- Run full application-boundary acceptance plus real subscription/Windows/authorized integration checks; report every UNMEASURED axis.
- Verify failure/timeout/restart scenarios at each external boundary; do not accept happy-path-only readiness or API billing.

## Coverage

Spec U1–U16 must be closed or explicitly gated by ticket 01; dependent production behavior cannot implement guessed policy. User stories map by capability: experience/configuration 02–08; runtime/context/skills 04–07; discovery/review/authority 09–15; Teams/calendar 16–18; reporting/release 19–20. The selected first runtime is the first end-to-end proof; additional runtime support is not implied without a proven adapter and an explicit required-runtime decision in 01.

## Approval and publication

Review granularity, blocking edges, and merge/split opportunities. After approval and tracker setup, publish one file or issue per ticket in dependency order. Local files use the configured `.scratch/sarathi-v1/issues/NN-slug.md` convention. This combined planning document is not the published ticket set. Do not modify or close a parent issue.
