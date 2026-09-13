# Sarathi v1 — subscription-backed engineering and delivery assistant

Date: 2026-09-05. Status: specification draft synthesized from the current intent and conversation. No implementation or production actions authorized. Test-boundary confirmation and tracker configuration are pending. Open decisions and unverified integration prerequisites below prevent an unconditional ready-for-agent claim.

This synthesis was explicitly requested after discovery. It does not imply that previously unresolved choices have been accepted. Settled Sarathi intent supersedes conflicting legacy Adhiṣṭhāna/Akasha product, glossary, and build assumptions. In this document, operator means the human user; specialist means a persistent configured agent responsibility/instance; runtime means the execution product used by a specialist; provider means the inference/account route. They are separate concepts.

## Problem Statement

The operator is a Software Architect who repeatedly discovers assigned GitLab merge requests, reconstructs Jira context, reviews related changes across repositories, coordinates fixes, applies delivery policy, and follows up with developers. This work is fragmented across tools and conversations. Context is repeatedly reconstructed, work is difficult to resume, and review, merge, assignment, and reminder decisions are easy to apply inconsistently.

The operator wants a local assistant that coordinates specialists, remembers relevant work, produces inspectable evidence, and carries approved actions through to verified results. Existing Claude Code and ChatGPT Codex subscriptions must be used without API billing. Cursor and Hermes are additional runtime candidates, not proven substitutes or additional spending authority.

The current repository provides a small browser/server task-stream skeleton. It does not implement durable workflow state, approval enforcement, specialist routing, scoped memory, or the GitLab/Jira/Teams workflow. Its single-active-agent and conversation-stream assumptions cannot be carried forward as the product architecture.

## Solution

Build Sarathi as a Windows-local, browser-based chief of staff with configurable specialists, durable tasks, scoped context, explicit skills, and centrally enforced action authority. Reuse the useful TypeScript, React, Fastify, and testing foundations while replacing prototype execution contracts.

Start at user login, remain available after the browser closes and while Windows is locked, and expose work, artifacts, approvals, blockers, and available usage through the dashboard. Sleep/off pauses execution; sign-out operation is not required. Resume from durable evidence rather than assuming a previous model conversation survived.

Deliver one complete first workflow: discover relevant GitLab MRs every 15 minutes or on demand; establish Jira groups; review every changed file; prepare positioned findings; request approval; execute allowed Jira/GitLab/Teams actions with fresh gate checks; verify remote outcomes; and issue a bounded reminder sequence when review threads remain unresolved.

Automatic input, approval, access, or uncertain-result waits affect only dependent chats/tasks. Usage-limit exhaustion may cause a global automatic pause, with provider-specific versus system-wide exhaustion semantics still to be finalized. Independent work must not stop because another chat needs an answer.

## User Stories

1. As the operator, I want Sarathi to start at login, so that I can use it without repeatedly launching its backend.
2. As the operator, I want work to continue after browser closure and while Windows is locked, so that the dashboard is not the execution host.
3. As the operator, I want clear sleep/off and restart behavior, so that I know what actually ran while unavailable.
4. As the operator, I want a local browser dashboard, so that I can see work across specialists in one place.
5. As the operator, I want to chat with Sarathi or a selected specialist, so that I can choose coordination or direct consultation.
6. As the operator, I want conversational and form-based configuration to update the same settings, so that behavior does not depend on the interface used.
7. As the operator, I want persistent specialist identities and separate task sessions, so that continuity does not require one ever-growing conversation.
8. As the operator, I want multiple configured agents within a role, so that responsibility and runtime preference can vary independently.
9. As the operator, I want overlap warnings before permanent-agent creation, so that I understand routing conflicts.
10. As the operator, I want permanent agents to require approval, so that the organization does not expand without my decision.
11. As the operator, I want bounded temporary delegation, so that parallel work cannot multiply resources or authority.
12. As a specialist, I want only the context and permissions needed for my task, so that unrelated project information stays isolated.
13. As the operator, I want independent tasks to run in parallel and dependent steps in order, so that concurrency preserves correctness.
14. As the operator, I want task-linked requests and results between specialists, so that coordination remains inspectable.
15. As the operator, I want one chat's request for input to pause only its dependent work, so that other chats continue.
16. As the operator, I want manual pause respected during automatic recovery, so that my control cannot be silently reversed.
17. As the operator, I want completed and uncertain remote actions distinguished, so that pausing never implies a write was undone.
18. As the operator, I want existing subscription accounts used, so that Sarathi introduces no API charges.
19. As the operator, I want runtime unavailability and quota exhaustion reported, so that I can decide whether to wait or use an approved fallback.
20. As the operator, I want fallback restricted to authorized routes, so that failure cannot broaden data access or spending.
21. As the operator, I want native runtime login, so that Sarathi does not repurpose subscription credentials.
22. As the operator, I want measured usage or an explicit unknown value, so that estimates are not mistaken for actual billing.
23. As a specialist, I want required context assembled at task start and resume, so that instructions are not lost during renewal.
24. As the operator, I want context sources and effective versions recorded, so that a result can be explained later.
25. As a specialist, I want relevant optional context retrieved selectively, so that unrelated history does not crowd out the task.
26. As the operator, I want shared standards maintained once with explicit overrides, so that copied policies do not drift.
27. As the operator, I want authorized shared and agent-specific skills, so that specialists use appropriate methods.
28. As the operator, I want skills invoked by me or selected by an agent where allowed, so that workflows remain flexible.
29. As the operator, I want effective skill versions attributable to each run, so that changes can be evaluated and rolled back.
30. As the operator, I want task progress and evidence retained automatically, so that interrupted work can resume.
31. As the operator, I want approval before inferred lessons become lasting shared instructions, so that mistakes do not silently become policy.
32. As the operator, I want to inspect, correct, supersede, and delete remembered information, so that memory remains useful and accountable.
33. As the operator, I want predictable artifact locations and source links, so that outputs can be found outside a conversation.
34. As the operator, I want remote evidence to govern current workflow state, so that old memories cannot authorize a merge.
35. As the operator, I want a 15-minute MR check and a Check now action, so that discovery works both automatically and on demand.
36. As the operator, I want discovery across accessible projects where I am Assignee or Reviewer, so that no project allowlist hides my work.
37. As the operator, I want related MRs grouped by Jira, so that cross-repository changes are reviewed together.
38. As the operator, I want loose Jira-key formats recognized without false matches, so that inconsistent titles do not defeat grouping.
39. As the operator, I want ambiguous Jira links to permit available review before requesting my help, so that uncertainty does not waste useful analysis.
40. As the operator, I want inaccessible material explicitly reported, so that missing evidence is not called reviewed.
41. As the operator, I want new requests, commits, and remediation replies to trigger re-review, so that verdicts stay relevant.
42. As the operator, I want unchanged MRs skipped, so that repeated polls do not repeat work or notifications.
43. As the operator, I want every changed file accounted for, so that complete-review claims can be audited.
44. As the operator, I want skeptical, defect-focused review using merge-sentinel, so that findings challenge unsupported claims and real failure modes.
45. As a developer, I want findings and applicable questions attached as resolvable inline threads, so that I can act on precise code locations.
46. As the operator, I want Sarathi to correct its own inadequate comments, so that published review quality can improve without altering others' work.
47. As the operator, I want code rechecked after a developer resolves a thread, so that resolution is not mistaken for a fix.
48. As the operator, I want all new findings and unresolved threads to block merging, so that severity does not bypass the agreed gate.
49. As the operator, I want unresolved reviewer disagreement escalated, so that conflicting verdicts cannot silently produce a merge.
50. As the operator, I want merges restricted to MRs where I am Assignee, so that Reviewer-only access does not become merge authority.
51. As the operator, I want every MR in a Jira group safe before an eligible member merges, so that related work meets a common review gate.
52. As the operator, I want Jira status, draft status, and applicable CI enforced, so that review approval alone is insufficient.
53. As the operator, I want genuinely no-Jira MRs supported, so that unrelated Jira requirements do not prevent valid standalone work.
54. As the operator, I want exact proposed external actions reviewed in batches, so that approval is concrete and traceable.
55. As the operator, I want changed code to invalidate approval, so that previously reviewed changes cannot authorize new code.
56. As the operator, I want Jira assignments to follow my Tester/Reporter/Owner rules, so that work reaches the intended person.
57. As the operator, I want ordinary Severity assessed from impact, so that classification is corrected without changing Security Severity.
58. As the operator, I want Reviewed By to reflect actual review participation, so that attribution is truthful.
59. As the operator, I want Unit Tested only after all group MRs are remotely confirmed merged, so that Jira does not advance early.
60. As the operator, I want partial merges preserved and reported, so that a later failure never produces a fictional rollback.
61. As the operator, I want compact per-MR and cross-Jira reporting, so that reviewed, blocked, skipped, and merged outcomes are clear.
62. As a developer, I want an immediate blocked-review notification and at most two reminders, so that follow-up is useful rather than repetitive.
63. As the operator, I want reminders sent as me if practical, so that a separate bot is not introduced without a decision.
64. As the operator, I want first-contact identity confirmation, so that name/email guesses cannot send to the wrong person.
65. As a developer, I want reminders counted and sent in the team's working hours, so that nights and weekends do not become response time.
66. As the operator, I want Indian holiday candidates confirmed the previous day, so that a public holiday is not automatically treated as a company day off.
67. As the operator, I want one bounded reminder approval, so that I do not approve each unchanged scheduled message separately.
68. As a developer, I want resolved threads to stop reminders, so that completed work does not keep generating messages.
69. As the operator, I want downtime catch-up coalesced, so that overdue reminders are not sent back-to-back.
70. As the operator, I want VPN connection attempted once with bounded readiness checks, so that unavailable access produces a useful blocker instead of a launch loop.
71. As the operator, I want Windows notifications linked to the relevant task, so that decisions can be reached directly.
72. As the operator, I want complex delivery broken into persisted verified phases, so that future workflows scale without replanning routine polls.

## Implementation Decisions

### 1. Product scope and migration

Hybrid reuse is settled. Keep the useful web/server/workspace foundations and injectable adapter seams. Replace single-active-runtime and string-stream-only domain contracts with specialist, workflow, run, step, artifact, approval, and action concepts. Mandatory central coordination cannot depend on a runtime advertising optional orchestration.

The first release includes configurable agents, direct chats, durable coordination, skills/context, approvals, complete MR review, and Teams reminders. Prove that workflow before expanding general-purpose platform features. Legacy self-modifying-OS governance and model-generated dashboard layouts are deferred. No code migration has occurred as part of this spec.

### 2. Responsibility and authority boundaries

Sarathi owns routing, task ownership, scheduling, escalation, and state. Review Agent owns bounded GitLab/Jira review work. Teams Agent owns identity mapping and communication. Review Agent requests Teams work through coordination rather than obtaining Teams authority. Email Agent belongs to later scope.

Use deterministic control logic for scheduling, validated grouping, resource accounting, approval validity, retries, and merge gates. Models propose analysis, findings, drafts, and interpretations. Proposed actions are not executable authority. A specialist cannot bypass the action executor through ambient tools or credentials.

Retain a runtime integration boundary for launch, attributable events/results, capability/readiness, cancellation, and identity. Retain integration boundaries for remote evidence and controlled actions. Prefer a small number of public application operations over testing internal managers individually.

### 3. Agent configuration and delegation

An agent definition includes stable identity, role, persona, responsibilities, skills, runtime/model preferences, approved fallbacks, permissions, and memory scope. Multiple agents may share a role. Persistent configuration is independent of process lifetime and model conversation lifetime.

Permanent creation requires approval after overlap explanation. Temporary workers are permitted within the initial three-worker/depth-two limits and parent authority. Aggregate counting, coordinator calls, native-runtime children, and waiting-parent slot semantics must be closed before delegation is considered ready. Concurrent coding uses separate worktrees and coordinated integration; this does not authorize executing arbitrary MR code during review.

### 4. Subscription-only runtime contract

Use native Claude Code and ChatGPT Codex subscription authentication through supported integrations. No API billing, paid fallback, automatic top-up, or token transplantation. Cursor and Hermes remain candidates requiring equivalent verification; installed products do not establish a runtime route, account entitlement, or model authorization.

Record effective runtime/version, model/account route where observable, and usage provenance for each attempt. Failure may use only an explicitly authorized fallback. If none is eligible, wait or report unavailable. Do not label unknown costs or usage zero, and do not mistake client-side dollar estimates for actual subscription billing.

Codex account-backed noninteractive use is documented. Claude's native noninteractive mode is documented, but its bare mode requires API credentials and cannot be adopted as the subscription-only isolation shortcut. An end-to-end subscription invocation, configuration isolation, tool restriction, and exhaustion behavior remain unverified. Runtime priority and specific models are not selected by this specification.

### 5. Durable workflow and action records

Workflow records must distinguish queued/running work, waiting for input, waiting for approval, blocked, failed, completed, and cancellation/uncertainty where applicable. Runtime output text cannot alone determine success. Persist enough information to reconstruct work without its previous runtime session.

Represent each proposed action with stable identity, task/group association, intended recipient/resource, exact payload, relevant reviewed revisions and gate evidence, approval reference, dispatch state, and remotely verified result. A timeout after dispatch is uncertain until reconciled. Group operations are sequential externally visible effects, not an atomic distributed transaction.

Store task-linked coordination objectives, context references, expected outputs, evidence, and blockers. Event delivery must support reconnect without turning repeated presentation into repeated execution. Artifacts need stable identity and producing-run/source relationships. Persistence technology, retention, backups, and exact schemas are unresolved; SQLite with readable artifacts is a researched candidate, not a frozen selection.

### 6. Context, memory, and skills

Assemble required operator, specialist, shared engineering, project, task, and skill context on start/resume. Record sources, effective versions, and load outcomes. Required-context failure blocks dependent work; optional absence is distinguishable. Context-loading evidence demonstrates availability, not model comprehension.

Keep source evidence, accepted decisions, observations, task records, and deliverables distinguishable and navigable. Knowledge cannot establish present remote revision, approval validity, successful writes, or reminder state. Cross-project relevance is not access permission.

Retain task progress/evidence automatically. Promote inferred lessons into lasting shared instructions only after user approval. Support inspection, correction, supersession, and deletion of knowledge, with audit-retention and derived-index behavior still to be specified. Prefer indexes/selective retrieval before requiring semantic infrastructure.

Discover authorized skill metadata before loading full instructions and relevant resources. Use canonical shared skills and explicit versioned overrides. Validate representative behavior before automation; evaluate and approve changes before activation, preserving rollback. Use the intended installed merge-sentinel version for reviews. The design interview skill is not an executable runtime node. Automatic workflow mining and improvement proposals are later extensions.

### 7. Discovery and Jira grouping

Poll every 15 minutes; Check now invokes the same workflow. Discover the union of MRs where the operator is Assignee or Reviewer across accessible GitLab projects, without a project allowlist. Deduplicate seeds and account for pagination and failed coverage.

From those MRs identify Jiras and related MRs across accessible projects, including MRs not directly assigned to the operator. Support BR-21718, Br 21718, and BR21718 forms through validated matching. Multiple-key rules, group historical/closed membership, release boundaries, and false-positive rejection need a precise policy before automatic grouping enables merges.

If a plausible Jira cannot be resolved or accessed, review available MR evidence, then ask for help on linkage and next actions. Do not silently treat it as no Jira. Inaccessible related evidence remains a coverage gap. New assignment/reviewer requests, commits, or remediation replies trigger reassessment; unchanged MRs do not trigger duplicate reviews.

### 8. Review evidence and publication

Account for every changed file in every group MR. Record inspected revisions, file coverage, findings, and unavailable checks. Coverage is not satisfied merely by counting files. Binary/generated/large-file policies and code-execution permissions remain open; unavailable material cannot support a complete-review claim.

Review is skeptical and defect-focused, with no praise. Challenge unsupported claims, skipped checks, assumptions, realistic failure modes, the strongest counterargument, and the most suspect area with evidence. Any finding blocks merge regardless of severity; unresolved threads/questions and reviewer disagreement also block.

Prepare resolvable inline findings/questions with applicable file/line and diff references. Summary notes are exceptional. Remotely verify placement and returned identity. Sarathi may edit/delete/repost its own incorrect or inadequate comments under the configured approval mode; ownership must be attributable to its runs, not simply every comment posted under the operator account. Preserve other reviewers' comments and replies.

Developer resolution alone is not proof of a fix. Re-review code and resolve Sarathi's own still-open thread only after verification. Do not resolve another reviewer's thread automatically. Lead reviewer reconciles conflicting evidence; unresolved disagreement escalates.

### 9. Approval and merge policy

Initially investigate/draft automatically and request approval for external actions in a proposed batch per Jira. Publishing findings, editing Jira, merging, and Teams sending all fall under this mode. A blocked-review publication/notification batch must not depend on merge eligibility, otherwise findings could never be published for remediation. Equivalent no-Jira grouping remains open.

Autonomy changes only by explicit operator instruction and never relaxes gates. Approval applies to the reviewed code and relevant valid conditions; changed code invalidates it. Recheck pertinent remote evidence before each external write and verify results afterwards. Exact expiry, policy/context-change invalidation, partial approvals, and target/group drift handling remain open.

Merge only when the operator is Assignee. Reviewer-only MRs may be reviewed/commented on, but Sarathi cannot merge them. Every MR in an established Jira group must have a safe-to-merge review verdict before any eligible member merges. Draft/WIP blocks merge, not review. Jira must be Merge Requested or Ready for Testing. Existing CI must pass; genuinely absent CI adds no extra gate. Native server requirements still apply. Genuinely no-Jira MRs skip Jira-only actions/gates.

Use source-revision guarding where supported; it does not freeze target branches, discussions, Jira, or other MRs atomically. Exact merge method, branch deletion, ordering, dependencies, and acceptable residual race handling must be settled rather than inherited from defaults silently.

### 10. Jira assignment, fields, and completion

Read Issue Type, ordinary Severity, Assignee, Reporter, Tester, Reviewed By, Status, and Owner, capturing original assignment before Sarathi changes it. Use stable account/field identity, not display-name guesses. Live metadata identified ordinary Severity as customfield_11015; leave Security Severity unchanged.

When Abhinav is Owner, a populated Tester takes precedence. If Tester is empty, use Reporter with these exceptions: Reporter Nitesh routes to Sagar Trivedi, never Sagar Makwana; Reporter also being the MR developer routes to Sagar Trivedi for non-Task issues; for Task issues use that Reporter and add the short non-technical functional/security impact comment. Overlapping exception precedence and ambiguous identities need an explicit resolution rather than a guessed user match.

When Abhinav is not Owner, prefer original Jira assignee/developer, then MR author. Ask if missing or ambiguous. Do not prioritize the person who forwarded the MR. Resolve differing assignee/developer identities and multiple group authors before ambiguous writes.

Reviewed By must reflect people who actually contributed MR review comments; preservation versus recomputation and AI-on-behalf-of-user attribution remain open. Independently assess ordinary Severity against code/impact and report mismatches; the severity rubric remains to be established.

Apply approved pre-merge field changes, then merge eligible MRs. Transition to Unit Tested only after every group MR is remotely confirmed merged, including those Sarathi cannot merge itself. Never transition to Closed. Fetch applicable transition metadata; one sampled transition ID is not global configuration.

On a partial merge failure, stop remaining actions for that Jira, preserve completed merges, report partial completion, and keep Jira status unchanged. Do not imply applied field changes rolled back. Recheck remote state and gates before retry. The exact treatment of any proposed pre-merge status change must be resolved to preserve this invariant. A failed post-merge Jira transition is distinct from a failed merge.

### 11. Teams identity, reminders, and holidays

Prefer operator-account delegated sending if practical; do not silently replace it with a bot. Standalone tenant consent, directory/chat access, sending, and verification are prerequisites not established by the current session's tool inventory.

Suggest recipient mappings from internal GitLab email, external Teams email, and names, then obtain first-contact confirmation and persist verified identity. Names alone are insufficient. A Review Agent asks Teams Agent through coordination.

Send an immediate blocked-review notification and reminders at three and six working hours while review threads remain unresolved. Team hours are Monday–Friday, 10:00–19:00 Asia/Kolkata; count time and send within that window. Operator hours are Monday–Friday, 09:00–18:00 Asia/Dubai. Immediate means as soon as approval and permitted sending window allow.

A review round starts at successful findings publication. Commits/replies trigger re-review within the same round. A new round requires all blockers clearing followed by a later review with new blockers. Stop after two reminders or earlier when resolved. Unchanged polls cannot repeat notifications. After downtime, reread current thread state and send at most one catch-up at the highest elapsed threshold; a six-hour catch-up consumes both overdue thresholds.

Initial notification approval covers the exact recipient and bounded two-reminder sequence while its approved content/context remains valid. Revalidate before sending. Message creation verification is not proof the human read it. Uncertain sends need reconciliation, not blind duplication.

Indian holiday dates provide candidates only. Ask the operator the previous day whether the team will actually be off. Region/company calendar, ask time, unanswered confirmation, and late confirmation effects on elapsed working time remain open.

### 12. Windows availability, pause, and connectivity

Use a logged-in background host with a browser view and tray control; do not require sign-out execution. Authentication may need an unlocked user session. Sleep/off does not execute work. Resume safe reads and reconcile interrupted writes from durable state.

Automatic input/approval/access/uncertain-result blocks stop only dependent tasks. Usage exhaustion may pause globally, but one-runtime versus all-approved-route exhaustion behavior is still open. Do not bypass this by paid fallback. Proposed manual controls are dashboard header and tray; in-flight analysis behavior remains unconfirmed. Automatic recovery must respect a manual pause. Already-issued writes are reconciled.

When GitLab requires VPN, invoke the known shortcut once, check readiness every ten seconds for up to two minutes, then stop dependent work and notify if unavailable or authentication needs attention. Avoid relaunch loops. The inspected shortcut invokes a credential/TOTP-aware helper; its locked-session behavior and lifecycle need verification without exposing secrets.

### 13. Reporting and interface contracts

Expose task/group state, artifacts, evidence references, approval payloads, blocked reasons, and measured usage. Conversational configuration and forms operate on the same definitions. Windows notifications link to the task requiring attention.

After per-MR summaries and coverage evidence, provide a compact table with Jira, MR(s), REVIEWED/SKIPPED/BLOCKED/MERGED, blockers, applied Jira changes, and merged MRs. Finish with Merged JIRAs and Still blocked lists. Represent no-Jira MRs explicitly and distinguish partial groups from fully merged groups.

The public application boundary must support starting/checking work, reading/replaying results, responding to input, approving/rejecting proposed actions, configuring specialists, and controlling pause. Exact HTTP routes, wire schemas, and persistence layout are deferred to the implementation-ready design; this spec freezes behavior, not guessed endpoint names.

## Testing Decisions

### Proposed primary seam — operator-facing application boundary

Use the existing server application-construction/injection seam as the primary integration-test boundary. Drive public workflow commands and queries, observe statuses, artifacts, approval records, and outbound integration effects. Replace runtimes, remote services, clock, and persistence location with controllable adapters; keep actual orchestration and gate logic under test. Reconstruct the application over the same temporary durable store for restart tests.

Existing route tests already inject an application and a FakeAgent, assert accepted tasks, and inspect streamed results. Extend that pattern rather than testing every internal helper or module interaction. Existing injectable process runners provide prior art for adapter substitution. This seam is proposed and awaits the skill-required user confirmation.

Good tests assert externally observable outcomes, authority boundaries, and meaningful failure behavior. They do not mirror private branching, assert prompt wording, count internal method calls, or claim live provider correctness from fake-agent success. Use a controllable clock instead of real waits for polls, calendars, and reminders.

### Required behavior scenarios

1. Scheduled and manual discovery produce equivalent groups; duplicated seeds/polls do not duplicate runs or effects.
2. Mixed Assignee/Reviewer roles allow reviews for both but merges only for Assignee.
3. Loose Jira-key formats resolve correctly; unresolved keys still allow review and then request help without enabling no-Jira merge bypass.
4. Missing pages, truncated diffs, inaccessible MRs, and unreviewable files produce explicit coverage gaps and prevent complete/safe claims where material.
5. Findings reference actual inspected revisions/files/lines and become remotely verified resolvable threads only after approval.
6. Any finding, unresolved question/thread, or irreconcilable reviewer disagreement blocks merge.
7. Developer-resolved threads require code verification; another reviewer's thread is never resolved by Sarathi.
8. Comment correction acts only on Sarathi-attributed comments, preserving others' content.
9. Draft, disallowed Jira status, and nonpassing applicable CI block merging; genuinely absent Jira/CI takes the agreed exception path.
10. Every group member needs a safe verdict; Reviewer-only members cannot be merged by Sarathi but their remote merge status still affects Jira completion.
11. Changed reviewed code invalidates approval; stale approval cannot dispatch writes.
12. Required pre-merge field failure does not falsely report a successful batch; later merge failure preserves earlier effects and stops that group's remaining actions.
13. Unit Tested occurs only after all group MRs are confirmed merged; Closed never occurs.
14. Tester and confirmed Reporter exception cases select intended identities; ambiguity asks the user rather than guessing.
15. Ordinary Severity is the field updated; Security Severity remains untouched.
16. API timeout after successful remote write reconciles to one known effect; unresolved uncertainty remains visible without a blind retry.
17. A waiting chat/task does not suspend unrelated work; manual pause survives automatic recovery.
18. Runtime failures never select an unauthorized or API-billed fallback; unknown usage is not reported as zero.
19. Required context failure blocks dependent work; runtime session loss still permits reconstruction from durable checkpoints.
20. Unauthorized cross-project memory and instruction-bearing external evidence cannot grant permissions or action authority.
21. Skill/context versions remain attributable; rejected improvement proposals do not alter active instructions; rollback restores an accepted version.
22. First Teams contact requires verified recipient; notifications use only the approved sender/recipient/content scope.
23. Three/six-hour reminders honor team timezone and weekend boundaries, stop on resolution, and remain deduplicated across polls and restarts.
24. New commits/replies do not reset an existing round; cleared blockers followed by new blockers create a later round.
25. Six-hour downtime catch-up emits one notice and consumes overdue thresholds; stale resolved threads emit none.
26. Holiday candidate dates prompt confirmation rather than automatically marking days off. Remaining holiday policy gets scenarios when settled.
27. Browser reconnect replays observable state without rerunning actions; backend restart preserves task progress and reconciliation needs.
28. Global worker and depth limits hold across simultaneous tasks and native children once counting policy is frozen.
29. VPN unavailable/auth-needed behavior launches once and stops dependent work after bounded readiness checks.
30. Final reports accurately distinguish reviewed, skipped, blocked, partially merged, fully merged, and Jira-update-failed outcomes.

### Supplementary proofs at real boundaries

Keep only necessary supplementary checks: a few browser journeys for configuration/approval/pause rendering; runtime contract checks for subscription authentication, structured output, isolation, cancellation and identity; integration contract checks for actual GitLab/Jira/Teams semantics; Windows login/lock/sleep/tray/VPN trials. These supplement the main seam because fake integrations cannot establish real entitlement, process behavior, or remote-write verification.

Use non-sensitive local fixtures first. Any externally visible message, comment, issue change, or merge requires an explicitly authorized test fixture. No such test runs are authorized merely by creating this specification. Existing tests were inspected, not rerun; live runtime/integration behavior, review-quality thresholds, and usage savings remain UNMEASURED.

## Out of Scope

- Implementing, deploying, starting monitors, or exercising production writes in this document task.
- API billing, paid automatic fallback, purchasing credits, or repurposing subscription tokens.
- Automatic promotion to autonomous authority or changes to merge gates by agents.
- OS self-modification governance and model-generated dashboard layouts from the legacy design.
- Full Jira delivery/development/release, general PoC execution, DSR submission, broad PMO, and Outlook workflows in v1.
- Voice, team distribution, off-laptop hosting, and execution after Windows sign-out.
- Mandatory Obsidian, vector database, knowledge graph, GSD, or a universal skill line-count rule.
- Automatic workflow mining and self-activating skill improvement.
- Claims of defect-free AI review, atomic cross-service/group operations, guaranteed exactly-once remote effects, or context comprehension proven by loading alone.

## Further Notes

### Unresolved decisions and release prerequisites

| ID | Unresolved item | Consequence / resolution criterion |
| --- | --- | --- |
| U1 | Primary runtime, per-agent routing, model choices and approved fallbacks; Cursor/Hermes subscription feasibility | Do not launch through unspecified or API-billed routes; demonstrate selected native subscription integration. |
| U2 | Provider exhaustion versus global quota pause, usage/time/retry bounds | Define admission and reset behavior without silently stopping independent available routes or spending more. |
| U3 | Teams delegated tenant setup and remote verification | Prove sender/recipient/chat permissions and practical authentication; ask before replacing sender with a bot. |
| U4 | Holiday region/source, ask time and unanswered/late confirmation | Do not invent calendar policy; define exact working-time behavior before unattended holiday handling. |
| U5 | Jira key/group membership, multiple keys, closed/historical MRs and release boundaries | Establish deterministic group membership and drift policy; ambiguous groups cannot enable merges. |
| U6 | Merge strategy/order/dependencies, target drift, CI edge states and native server rules | Preserve gates without assuming a source SHA protects every condition atomically. |
| U7 | No-Jira approval grouping, expiry, partial approval and non-code invalidation | Bind approved actions precisely; do not infer broader authority. |
| U8 | Jira exception overlap, original assignee versus developer, multi-author groups and reviewer attribution | Resolve conflicting assignment/attribution inputs before writes; ordinary Severity field itself is settled. |
| U9 | Severity rubric and pre-merge status behavior | Preserve unchanged-status partial-failure policy; avoid arbitrary classification thresholds. |
| U10 | Binary/generated/large-file coverage, test execution authority and review-quality threshold | Full file inventory is mandatory; unavailable evidence cannot be waived silently. |
| U11 | Worker/coordinator/native-child counting and waiting-parent slots | Enforce global three-worker/depth-two bounds under concurrency. |
| U12 | Manual pause placement and in-flight analysis semantics | Dashboard/tray controls are proposed; automatic task-local waits are settled. |
| U13 | Persistence, retention/deletion, backup/restore, indexes and artifact reconciliation | Choose durable design with explicit ownership; do not inherit runtime-private state as authority. |
| U14 | Context precedence, required-set definitions, skill-update invalidation and scope sharing | Keep permissions/gates invariant and versions attributable. |
| U15 | Exact standalone adapter operations/authentication, GitLab version/VPN and Windows lifecycle | Session connectors and public docs are insufficient; record actual capability proofs. |
| U16 | Installation/update/migration and complete first-release acceptance | Hybrid direction is settled; exact rollout and release checks remain to be designed. |

Some rows are engineering design work rather than another user interview. Where a row affects user authority, spending, recipients, or agreed policy, do not silently choose a default. Until closed, the affected capability is not implementation-ready. This is a synthesis of current decisions, not evidence that discovery is complete.

### Evidence and source hierarchy

The project intent and accepted conversation decisions govern product behavior. Supporting research establishes static repository gaps and documented capabilities: Agentic OS specification inputs; repository assessment; runtime/Windows feasibility; integration feasibility; state/clarification research. Their earlier pending recommendations are superseded where this document records later accepted answers.

Primary external references: [GitLab MR API](https://docs.gitlab.com/api/merge_requests/), [GitLab discussions](https://docs.gitlab.com/api/discussions/), [Jira issues](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/), [Microsoft Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [Codex noninteractive execution](https://learn.chatgpt.com/docs/non-interactive-mode), [Claude programmatic execution](https://code.claude.com/docs/en/headless), [Claude authentication policy](https://code.claude.com/docs/en/legal-and-compliance), and [Windows interactive services](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services). These references do not prove the user's tenant/account integration works.

### Publication state

The requested to-spec workflow calls for publication to the configured issue tracker with the ready-for-agent label, after test-seam confirmation. No project tracker/triage configuration was found during this run. A GitHub remote exists, but that alone does not select GitHub Issues over another tracker. Run `/setup-matt-pocock-skills` to establish the target and triage vocabulary. No issue has been published, and no ready-for-agent label has been applied. This local draft is the reviewable publication artifact.
