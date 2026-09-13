# Sarathi — Product Intent

Status: active feasibility research and clarification; not yet specification-ready. This document records settled intent and explicitly pending decisions; recommendations in pending tables are not approvals.

On explicit `/to-spec` request, a [specification draft](docs/specs/sarathi-v1.md) was synthesized from this intent and the accepted conversation decisions. Draft creation does not close discovery or approve its unresolved choices; test-boundary confirmation and issue-tracker setup remain pending.

Supporting detail: [Agentic OS research and specification inputs](docs/research/2026-09-05-agentic-os-spec-inputs.md). This intent defines product requirements; that document records source evidence, design rationale, open decisions, and acceptance scenarios for the eventual specification.

## Purpose

Build a personalized, local engineering and delivery assistant for a Software Architect. Sarathi acts as chief of staff: coordinates specialist agents, maintains task continuity, and turns requests and external events into traceable work requiring human approval where configured.

Product name: **Sarathi**. Existing repository terminology includes Adhiṣṭhāna/Akasha; this document establishes the new intended name without claiming those files or implementation have been migrated.

Use hybrid reuse: retain useful TypeScript/React/Fastify shell and test seams; replace prototype execution/session contracts with durable workflows and enforced approvals. This intent supersedes the legacy build sequence and conflicting glossary/PRD/ADR assumptions for Sarathi. OS self-modification governance and model-generated dashboard layouts are deferred. Assess exact reusable components during specification; no implementation migration is authorized yet.

## Operator and experience

- Windows; Cursor, VS Code, and Antigravity; PowerShell or CMD.
- Local browser dashboard is the main interface. Support direct chat with Sarathi and individual specialists.
- Configure agents through both conversation and dashboard forms using the same underlying configuration.
- Start automatically at Windows user login; continue after browser closure and while the session is locked. Provide a tray icon and pause control. V1 does not require execution after sign-out. Interactive authentication may still require unlocking.
- Persist task progress across restarts. Resume safe reads; verify remote state before retrying interrupted writes.
- Sleep/off pauses execution. Resume checks on wake; do not claim background work occurred while unavailable.
- Dashboard inbox for approvals and blocked tasks; Windows notifications link to the relevant review.
- Dashboard exposes workflow progress, artifacts, context sources, approval state, failures, and measured usage. Execution continues independently of the dashboard; interface actions use the same workflow and control layer as scheduled execution.

## Agent organization

- Roles represent responsibilities; a role may contain multiple separately configured agents.
- Each agent has its own persona, responsibilities, skills, model preferences, approved fallbacks, permissions, and scoped memory.
- Persistent specialists execute separate task sessions. Do not create a new permanent agent for every task.
- Persistence means retained configuration and scoped memory, not an indefinitely growing conversation or an always-running model process. Resume or renew task sessions from durable state and relevant context.
- Initial responsibilities:
  - Sarathi: coordination, routing, task ownership, escalation, and follow-up scheduling.
  - Review Agent: GitLab discovery, Jira context, review, findings publication, and gated MR/Jira actions.
  - Teams Agent: identity mapping, Teams communication, and reminders.
  - Email Agent: Outlook tasks; part of the broader vision, not required for the first MR workflow.
- A Review Agent requests Teams work through coordination rather than acquiring Teams access itself.
- Sarathi routes by skills, suitability, and availability; the user may select an agent explicitly.
- Before creating an agent, explain overlaps/conflicts with existing agents and recommend narrower responsibilities or routing rules. Intentional overlap is allowed.
- Temporary subagents may be created automatically within limits; permanent agents require approval.
- Initial limit: 3 concurrent workers, delegation depth 2. Specification must define counting across simultaneous tasks so nested delegation cannot multiply the limit accidentally.
- Subagents receive only necessary permissions within their parent's authority; cannot bypass approval gates or broaden skill/provider access.
- Use separate Git worktrees for concurrent coding tasks and coordinate integration.

## Communication and control

### Pause scope

- Automatic waits for input or approval pause only the affected chat/task. Connectivity, authentication, invalidated approval, or uncertain-write blockers likewise stop dependent work, not all of Sarathi. Independent chats/tasks continue.
- Usage-limit exhaustion may trigger an automatic global pause; other routine task blockers must not. Specification must distinguish one provider's limit from exhaustion of all eligible approved runtime routes. Do not switch providers without approved fallback authority or incur API charges.
- Proposed manual controls: dashboard header and Windows tray menu. Automatic recovery must never override an explicit manual pause. Manual pause behavior for already-running analysis remains to be confirmed.
- A pause does not undo an already-issued external action. Reconcile its remote outcome before retrying; never report it cancelled solely because dispatch was paused.

Use centrally coordinated, durable, task-linked communication. Agents can consult each other through logged requests/results containing objectives, relevant context, expected outputs, evidence, and blockers. Avoid indiscriminate conversation broadcasting and unbounded agent discussion.

Sarathi owns coordination; specialists own bounded work. Persist task state and output artifacts, including waiting-for-input, blocked, failed, and completed outcomes. Parallelize independent work; sequence dependent actions.

Enforce permissions, approval validity, resource limits, and merge gates in the execution/control layer rather than relying only on personas or prompts.

Design repeatable workflows around explicit inputs, steps, output artifacts, dependencies, approval checkpoints, completion evidence, and failure/recovery behavior. Assign specialists to bounded steps; a distinct skill does not require a distinct agent. Use deterministic code for polling, validated grouping rules, timers, permissions, retries, and gates; use models for interpretation, review, drafting, and ambiguous decisions. Ambiguity must not silently become an executable gate decision.

Scale planning to task complexity. Simple tasks use lightweight execution; complex delivery uses persisted phases with verification and traceability to requirements. Existing approved workflows do not require fresh planning on every unchanged poll. No particular planning framework is selected.

For conflicting reviews, the lead reviewer reconciles evidence. Unresolved disagreement blocks merging and escalates to the user.

Research informing this direction:
- [OpenAI agent orchestration](https://openai.github.io/openai-agents-python/multi_agent/)
- [Anthropic multi-agent research system](https://www.anthropic.com/engineering/multi-agent-research-system)
- [A2A task lifecycle](https://a2a-protocol.org/latest/topics/life-of-a-task/)

These are design references, not selections of a provider SDK or a requirement to implement A2A in v1.

## Skills, models, and memory

- Support shared and agent-specific skills with explicit access assignments.
- Skills may be user-invoked, model-invoked, or both.
- Discover authorized skill metadata first; load selected instructions and relevant supporting resources as needed. Keep shared skills canonical, with explicit versioned project overrides rather than unmanaged copies. Record the effective skill versions used by each run.
- Validate skills against representative tasks before relying on them in automation. Capture outcomes and user corrections; proposed skill changes require evaluation and user approval before activation, with a recoverable previous version. Feedback need not be requested after every run. Automatic workflow mining and improvement proposals are later extensions; v1 must retain evidence that can support them.
- Apply persistent global/project review instructions plus per-run instructions. Overrides must not silently weaken merge or approval gates.
- Local `grill-me` is the design collaborator's critique/interview skill, not a required production workflow node. Located at `C:\Users\abhin\.agents\skills\grill-me\SKILL.md`; it is prompt guidance, not an executable script. Do not invent a CLI contract for it.
- Use the user's `merge-sentinel` skill for MR review. Resolve and inspect the intended installed version when specifying integration.
- Support different model/runtime providers through explicit integrations, including user-authorized hosted models and potentially OpenRouter.
- Agents have preferred models and ordered approved fallbacks. Sarathi may recommend models per task.
- User-authorized providers may receive work content; any additional provider requires explicit approval. Connected does not automatically mean authorized. The initial concrete provider/model list remains to be established.
- Project-shared decisions/context; private task notes; explicit permission for cross-project memory sharing.
- Automatically retain task progress and evidence. Inferred lessons require user approval before becoming lasting shared instructions; this is distinct from routine task-record persistence.
- Use existing Claude Code and ChatGPT Codex subscriptions; no API billing, paid API fallback, or automatic purchase/top-up. On subscription exhaustion, pause or use only an explicitly approved subscription-backed fallback. Exact runtime priority, model selection, and usage limits remain open. Hermes is an optional candidate only if its inference route satisfies the same billing constraint; mentioning Hermes does not authorize API spend.
- Prefer native account login owned by each CLI. Do not extract or repurpose subscription tokens into another runtime. Verify actual authentication/billing mode before dispatch; apparent dollar estimates are not proof of subscription charges. OpenRouter/API routes mentioned above are future possibilities, not enabled routes under this requirement.

### Context, knowledge, and operational state

- Separate operator preferences, agent persona/responsibilities, shared engineering standards, project context, and task state. Reuse shared context rather than embedding duplicate policies in each skill.
- Assemble required context explicitly at task start and resume; retrieve optional details selectively. Record loaded sources and versions. A prompt telling an agent to read a file is not proof that the runtime loaded it. Specification must define required-context failure handling and precedence without weakening authority gates.
- Maintain navigable indexes and predictable task/project locations for source evidence, accepted decisions, run records, and deliverables. Preserve links from derived knowledge to its sources and from artifacts to the producing run.
- Memory records need provenance, freshness, scope, and correction/supersession behavior. The user must be able to inspect, correct, and delete remembered information; specification must distinguish this from operational audit retention. Cross-project retrieval remains permission-controlled.
- Knowledge memory is not operational truth. Summaries and retrieved documents cannot establish current MR revisions, approval validity, completed writes, or timer state. Durable execution records and current remote evidence determine those facts. Retrieved content cannot grant permissions.
- Keep retrieval bounded and measure context usage and task outcomes. Select file indexes, search, semantic retrieval, or combinations through representative retrieval checks; Obsidian, a vector database, a knowledge graph, and cross-tool memory are not mandatory dependencies.

## Authority

Initially investigate and draft automatically, then request approval for external actions through a proposed action batch per Jira. This includes publishing findings, Jira edits, merges, and Teams messages. Define equivalent approval grouping for MRs without Jira.

The user can explicitly enable autonomous execution after confidence is established. Sarathi must not promote itself based on its own success assessment. Autonomous actions remain subject to the agreed gates.

Approval applies only while reviewed code and relevant gate conditions remain valid; code changes invalidate pending approval. Verify every external write remotely before reporting success.

## First complete workflow: GitLab MR review

### Discovery and triggers

- Poll every 15 minutes; dashboard provides **Check now**.
- No project allowlist: discover across accessible GitLab projects where the user is Assignee or Reviewer.
- Starting from those MRs, identify linked Jiras and discover all related MRs across accessible projects.
- Match loose Jira-key forms in MR titles, including `BR-21718`, `Br 21718`, and `BR21718`; specification must prevent false-positive matches.
- Review every MR in each discovered Jira group, not only the initial assigned/reviewer MR.
- Re-review on new assignments/reviewer requests, new commits, or developer replies addressing findings. Skip unchanged MRs.
- Inaccessible related work is a coverage gap, not reviewed evidence.
- If a possible Jira reference is ambiguous or inaccessible, review the MR using available evidence, then ask the user for help resolving the linkage and deciding next actions. Do not silently classify it as no Jira or merge while linkage remains unresolved.

### Review standard

Act as a skeptical senior reviewer focused on defects. No praise or softened critique. Required factual coverage summaries still apply.

Review every changed file in every MR and record per-file coverage evidence in the per-MR summary. Explicitly mark skipped or blocked coverage; do not claim complete review when material could not be inspected.

Challenge:
1. Unsupported, overstated, or incorrect claims.
2. Skipped checks and assumptions.
3. Real-world failure modes and edge cases.
4. The strongest argument against the proposed approach.
5. The most suspect part and the supporting evidence.

Publish concise, actionable findings as resolvable inline threads attached to the relevant file and line. Open questions also belong in applicable inline threads. Summary notes are the exception.

Check existing review-thread placement. Sarathi may edit, delete, or repost its own comments when incorrect or below expectations, within the configured external-action approval mode. Ownership means comments attributable to Sarathi runs, not every comment posted under the operator account. Other reviewers' comments remain outside this authority; preserve their replies when correcting a discussion.

Any new finding blocks merging, regardless of severity. Any unresolved review thread also blocks merging. A developer resolving a thread is not proof of a fix: re-review the code. After verifying a fix, Sarathi may resolve its own thread if still open. Do not automatically resolve another reviewer's thread.

### Merge eligibility

- Only merge MRs where the user is **Assignee**.
- Reviewer-only assignment permits review/comments, not merging.
- All MRs in a Jira group must have Sarathi's `safe to merge` verdict before any eligible MR in that group merges.
- With a Jira, status must be `Merge Requested` or `Ready for Testing`.
- Without an identifiable Jira, review and merge are allowed; Jira-specific gates/actions are skipped. Other gates still apply.
- Draft/WIP blocks merging, but not review.
- If a CI pipeline exists, it must pass. No CI is expected in the current environment and adds no extra approval gate.
- Unresolved findings, questions, threads, or reviewer disagreement block merging.
- Initial approval mode applies until explicitly changed by the user.

### Jira updates

Retrieve Issue Type, Severity, Assignee, Reporter, Tester, Reviewed By, Status, and Owner. Capture original assignment before Sarathi changes it.

When **Abhinav is Owner**, preserve these assignment rules from the user's review policy:
1. Assign to Tester; if blank, use Reporter.
2. If Reporter is Nitesh, use Sagar Trivedi, never Sagar Makwana.
3. If Reporter is also the MR developer and Issue Type is not Task, use Sagar Trivedi.
4. If Reporter is also the MR developer and Issue Type is Task, include a short non-technical comment explaining the functional/security change or impact. No `Closed` transition; when Tester is empty, assign to that Reporter and add this comment. A populated Tester takes precedence; Reporter exceptions apply only when Tester is empty.

When **Abhinav is not Owner**, choose original Jira assignee/developer, then MR author. If none is identifiable or selection is ambiguous, ask the user. Do not prioritize the person who sent the MR over the original assignee/developer.

Regardless of Owner, Sarathi may update Assignee, Reviewed By, Severity, and Status within the approval/gate policy:
- Reviewed By reflects people who actually added MR review comments.
- Independently assess ordinary Severity (`customfield_11015`) from code and impact; update mismatches and report them. Leave the separate Security Severity field unchanged.
- Apply approved pre-merge field changes, then merge eligible MRs.
- Transition Jira to **Unit Tested only after every MR in the Jira group is confirmed merged**, including MRs Sarathi cannot itself merge.
- Never transition to Closed in this workflow.

If one merge fails after others succeed, stop remaining actions for that Jira, preserve completed merges, report partial completion, and keep Jira status unchanged. Recheck gates and remote state before retrying. Do not imply field changes already applied were rolled back.

### Reporting

After per-MR summaries and coverage evidence, provide a compact cross-Jira table:

`Jira | MR(s) | REVIEWED / SKIPPED / BLOCKED / MERGED | Blocking findings or unresolved threads | Jira changes applied | Merged MRs`

End with:

`Merged JIRAs: <keys or None>`

`Still blocked: <keys or None>`

Represent MRs without Jira explicitly; do not invent Jira keys. Partial groups must be clearly distinguishable from completely merged groups.

## Teams follow-up

- When a review round remains blocked, the Teams Agent contacts the MR author with links to findings, subject to approval mode. Prefer sending as the operator through delegated work-account authorization if tenant setup is practical; do not silently switch to a bot if unavailable.
- Reminder thresholds: **3 and 6 working hours**, while any review threads remain unresolved. Stop after the second reminder for that round; stop earlier when resolved.
- Unchanged 15-minute polls must not generate duplicate reminders.
- Team reminder calendar: Monday–Friday, 10:00–19:00 IST (`Asia/Kolkata`). Count time and send within this window.
- Operator calendar: Monday–Friday, 09:00–18:00 UAE (`Asia/Dubai`).
- GitLab uses internal email; Teams uses external email. Explore email patterns and name matches, suggest identities, obtain user confirmation before first contact, and persist the verified mapping.
- Do not guess recipients from names alone.
- Send an immediate blocked-review notification in addition to the 3/6-hour reminders, within the configured approval mode and team sending window.
- A round starts when findings are successfully published. New commits/replies trigger re-review within the same round; reset only after all blockers clear and a later review finds new blockers. After downtime, recheck current threads and send at most one catch-up at the highest elapsed threshold; a 6-hour catch-up consumes both overdue reminder thresholds.
- Approval of the initial notification also covers its exact recipient and bounded two-reminder sequence, provided blockers remain and approved content/context is still valid. Revalidate before dispatch.
- Use Indian holiday dates as candidates, not automatic days off. Ask the operator the previous day whether the team will actually be off. State/company calendar, confirmation time, and unanswered-confirmation behavior remain open.

## Existing integrations and connectivity

Observed during discovery, not a guarantee of future runtime availability:
- Jira: `https://brainpayrolljira.atlassian.net`; connected Atlassian MCP returned this site and Jira read/write scopes.
- GitLab: `http://gitlab.btl.com`; on-prem MCP configured, but lookup failed outside VPN.
- VPN shortcut: `C:\Users\abhin\OneDrive\Desktop\Connect Sophos VPN.lnk`.

Sarathi may invoke the shortcut automatically when connectivity requires VPN. Launch once, check GitLab readiness every 10 seconds for up to 2 minutes, then pause and notify the user if unavailable or authentication requires attention. Avoid repeated launch loops.

Specification must inspect the shortcut/script, available MCP operations, Teams connectivity, and runtime authentication. Existing tools visible in this design session do not prove that a standalone local service can reuse their sessions or perform all required operations. Keep credentials out of this document and repository.

## Broader roadmap

1. Jira delivery: grooming with existing skills and Jira questions → specification → human approval → implementation plan → development and release through configured gates.
2. Idea queue: turn ideas into tracked PoCs; explore applications/sites and build CLI/MCP or other integrations for workflow needs.
3. DSR: accept informal daily accomplishments, select the appropriate skill, and prepare/submit the report under granted authority.
4. PMO: track initiatives/Jiras, coordinate reminders and follow-ups using Teams and Outlook.

First release includes configurable agents, orchestration, skill access, approvals, persistent work, and the complete MR-review workflow with required Teams reminders. Full delivery, general PoC execution, DSR, and broader email/PMO workflows are later extensions.

Build order should first prove one complete MR workflow through actual adapter capabilities, context loading, review artifacts, approval/resume, and Teams delivery before expanding platform and dashboard features. This is sequencing, not a reduction of first-release scope. Evaluate reuse of existing runtimes before implementing equivalent agent execution capabilities; hybrid reuse is selected; exact component reuse remains to be assessed.

Remote access, off-laptop execution, voice, and team distribution are separate future decisions. Remote messaging does not make a sleeping Windows machine execute work. A server deployment would require a new assessment of VPN access, authentication, permissions, and data placement.

## Specification outcomes

### Discovery completion gate

Before creating the specification, settle the decision branches below with the user, record what is required, how it can be achieved, why that approach fits, and the evidence/limitations for each. Distinguish documented capability, locally verified behavior, and UNMEASURED behavior. Do not turn an unavailable live check into a claim of impossibility, or a documented API into proof of tenant authorization.

Research may inspect public documentation, repository code, and read-only integration metadata. This does not authorize test messages, reviews, Jira writes, merges, monitors, or implementation. User confirmation of shared understanding closes discovery; until then unresolved branches remain visible.

Detailed decision map and state research: [State and clarification](docs/research/2026-09-05-state-and-clarification.md).

### Feasibility evidence — 2026-09-05

| Area | What is established | Consequence / remaining proof |
| --- | --- | --- |
| Repository | Early TypeScript/React/Fastify execution skeleton; task records in memory; Hermes session key ignored; orchestration stub. | Hybrid reuse is selected by Q7. Durable workflow, approval, memory, and integrations require implementation. [Assessment](docs/research/2026-09-05-repository-assessment.md) |
| Runtimes | Codex noninteractive help and Claude executable version work locally. Hermes launcher fails in the research environment although its Python path exists. | No selected runtime is proven end to end; Hermes failure cause is unresolved. Compare actual isolation, authentication, structured evidence, cancellation, and usage. [Runtime research](docs/research/2026-09-05-runtime-feasibility.md) |
| GitLab | Current connector lacks MR read/discussion/merge operations; current project lookup fails DNS. Official REST APIs document needed MR/discussion operations and source-SHA guarded merge. | Need reachable instance/version and a capable standalone adapter. Source-SHA guard does not atomically freeze Jira, target branches, discussions, or a whole MR group. [Integration research](docs/research/2026-09-05-integration-feasibility.md) |
| Jira | Read-only tenant metadata succeeded. Owner, Tester, Developer, Reviewed By and two distinct severity fields identified. Sample Bug in Merge Requested exposes Unit Tested transition. | Ordinary Severity selected in Q9; per-issue edit/transition permissions must be refreshed. No write or global workflow guarantee established. [Integration research](docs/research/2026-09-05-integration-feasibility.md) |
| Teams | Delegated user sending and installed bot/app approaches documented; no usable Teams connector verified here. | Q10 determines sender and consent architecture. Actual tenant reachability/authorization, sending and read-back remain UNMEASURED. |
| Local state | SQLite plus readable artifacts is a feasible candidate for a single-host application; writes serialize and indexes are not authority. | Storage choice, backup/retention, permission boundaries and recovery remain to be settled. [State research](docs/research/2026-09-05-state-and-clarification.md) |

Technical feasibility does not establish implementation readiness. Proofs requiring externally visible writes need a separately approved test fixture; this discovery has made no such writes.

#### Confirmed operator decisions — round 1

Confirmed by the user on 2026-09-05; reflected in the requirements above.

| ID | Decision to settle | Accepted behavior |
| --- | --- | --- |
| Q1 | Immediate Teams notification versus only reminders | Immediate notification plus reminders at 3 and 6 working hours. |
| Q2 | Possible Jira reference cannot be confidently resolved or accessed | Review available MR evidence, then ask for linkage help and next actions; no silent no-Jira bypass. |
| Q3 | Incorrectly positioned review threads | May edit/delete/repost own incorrect or inadequate comments; preserve others and correction evidence. |
| Q4 | Tester precedence and Task/Reporter-developer assignment | Tester first; apply Reporter exceptions only if Tester empty; Task case uses Reporter plus required comment. |
| Q5 | Reminder round and catch-up | Start on successful findings publication; commits/replies remain within round; new round after all blockers clear and later new blockers; one highest-threshold catch-up. |
| Q6 | Automatic knowledge capture | Automatic task records; approve inferred lessons before lasting shared instructions. |

#### Operator decisions — round 2 (partially settled)

| ID | Decision | Current recommendation / alternatives |
| --- | --- | --- |
| Q7 — confirmed | Repository migration and legacy scope | Hybrid reuse; replace execution contracts; supersede old build sequence; defer OS self-modification and model-generated layouts. |
| Q8 — confirmed | Windows lifetime | Start at login; signed-in/locked operation; no signed-out execution requirement. |
| Q9 — confirmed | Severity field | Ordinary Severity (`customfield_11015`) only; leave Security Severity unchanged. |
| Q10 — preference confirmed | Teams sender | Appear as operator if reasonably simple; delegated tenant feasibility still needs proof. |
| Q11 — billing confirmed | Runtime/provider and cost authority | Claude Code and ChatGPT Codex subscriptions only; no API billing. Hermes optional subject to billing compatibility. Runtime priority/models remain open. |

#### Remaining decision branches

Further decisions: Q12 runtime priority/per-agent selection remains open; user has Claude Code, Codex, Cursor (used by the team), and Hermes. Cursor is another candidate requiring subscription/integration feasibility research, not an approved API route. Q13 bounded reminder-sequence approval is accepted. Q14 automatic pause scope is settled below; manual pause location and in-flight analysis behavior remain proposed. Q15 uses Indian holiday candidates with previous-day operator confirmation; calendar region and no-answer behavior remain open.

Subscription feasibility: Codex documents saved account authentication for noninteractive execution. Claude native `-p` is documented, but bare mode requires API credentials and custom SDK/product authentication has separate constraints. Evaluate native subscription CLI integration; do not assume SDK support or transplant tokens. See the updated [runtime research](docs/research/2026-09-05-runtime-feasibility.md). No subscription-backed model invocation has been verified for Sarathi yet.

| Area | Required clarity before specification |
| --- | --- |
| Runtime/providers | Initial authorized runtime, models, data exposure, credentials, fallback order, headless/tool capabilities, billing and resource limits. |
| Windows operation | Lock versus sign-out behavior, login startup, pause/cancel behavior, wake catch-up, VPN readiness/authentication. |
| Teams | Send as operator versus bot, tenant permissions, confirmed identities, per-message versus bounded reminder approval, holidays. |
| GitLab grouping and gates | Jira-key validation/multiple keys, group completeness, closed/unmerged related MRs, native merge policies, merge method/order, target-branch changes, changed group membership. |
| Jira | Exact fields/users/transitions, severity mapping, assignment conflicts across authors, Reviewed By membership, handling concurrent manual edits. |
| Approval | No-Jira grouping, payload/revision binding, expiry/invalidation, rejection/partial approval, retry after partial completion. |
| Review execution | Binary/generated/large-file coverage, test/code execution permissions, checkout isolation, missing checks, quality evaluation and acceptance. |
| Agent organization | Coordinator/child counting, waiting-parent capacity, routing ties, specialist direct requests, fallback and cancellation. |
| Context/memory/skills | Required context/precedence, retention/deletion/backups, retrieval isolation/freshness, skill update behavior, learning approval. |
| Product and migration | Reuse versus replacement, superseding legacy ADRs, v1 interface/configuration boundaries, installation/update/data migration, release acceptance. |

Discovery cannot promise defect-free AI reviews, atomic cross-service/multi-MR execution, exactly-once remote effects under every timeout, or permission enforcement through prompts alone. The specification must define evidence, enforcement boundaries, reconciliation, and explicit blocked outcomes for these limitations.

### Required specification deliverables

The next specification should:
- Compare this intent with the existing repository and justify extend/replace/hybrid.
- Define component boundaries, state transitions, agent/role/task contracts, durable communication, and approval enforcement.
- Produce a workspace tree and Windows initialization approach that discovers/registers authorized local skills without treating prompt files as executables.
- Define runtime/provider and MCP adapter capabilities, credential access, and missing integrations.
- Resolve the explicitly open details above without silently changing agreed policy.
- Incorporate the supporting research document's decision register and acceptance scenarios: context loading/resume and precedence; knowledge versus execution-state ownership; artifact provenance; skill versions and rollback; retrieval isolation/freshness; planning levels; headless execution; and measured quality/usage. Verify current provider authentication, headless capabilities, and billing independently of historical video claims.
- Establish acceptance scenarios: complete file coverage; Jira grouping; Assignee vs Reviewer authority; missing Jira/CI; changed-code approval invalidation; partial merge failure; remote-write verification; restart recovery; reminder deduplication; verified Teams identity; and delegation limits.

This intent authorizes document preparation, not starting monitors, publishing reviews, messaging colleagues, changing Jira, or merging MRs now.



