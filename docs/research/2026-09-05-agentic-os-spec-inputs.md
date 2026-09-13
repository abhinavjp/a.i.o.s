# Agentic OS research and specification inputs

Date: 2026-09-05. Status: captured discovery, not a specification or implementation plan.

Read with [Sarathi product intent](../../intent.md). The user authorized capturing the reviewed refinements and updating intent. Existing MR, Jira, Teams, approval, concurrency, and Windows policies remain authoritative. Recommendations below elaborate those requirements; unresolved choices must be settled in specification, not silently inferred.

## Evidence and limits

Both complete caption transcripts were retrieved through [FreeTranscriptAPI](https://freetranscriptapi.com/docs) and read in full. These are caption text, not verified audiovisual observation; captions contain transcription errors, particularly product names. Earlier third-party summaries were provisional and are not the evidence basis for this document.

| Video | Retrieved coverage | Primary link |
| --- | --- | --- |
| Simon Scrapes: Creating Your Own Agentic OS is Easy (Insanely Powerful) | 763 timestamped segments, 00:00 to 24:35.88 | [Video](https://www.youtube.com/watch?v=w0S-khYCaB4) |
| Chase AI: The Agentic OS Setup That Will 10x Claude Code | 916 timestamped segments, 00:00.08 to 31:18.48 | [Video](https://www.youtube.com/watch?v=HRw-vP0j8OM) |

Retrieved JSON was saved in the session's Windows TEMP directory as `w0S-khYCaB4-transcript.json` and `HRw-vP0j8OM-transcript.json`. TEMP is not durable project evidence. This document preserves timestamped paraphrases and conclusions; no future specification step should depend on those temporary files remaining available. Full copyrighted transcripts are not reproduced here.

## Source-to-requirement map

| Source segment | Speaker's point, paraphrased | Application to Sarathi |
| --- | --- | --- |
| [Simon 03:36–06:55](https://www.youtube.com/watch?v=w0S-khYCaB4&t=216s) | Separate user/agent identity from shared business context; initialize through interviews and reuse common context. | Operator preferences, specialist responsibilities, and engineering/project standards need explicit ownership. Clarify missing preferences conversationally; avoid repetitive onboarding for facts already known. |
| [Simon 06:57–10:35](https://www.youtube.com/watch?v=w0S-khYCaB4&t=417s) | Layer stable instructions, deliberate session-start loading, and retrieval of prior work. More elaborate memory is optional. | Define runtime context assembly at start/resume, plus scoped retrieval. Do not assume files or hooks have identical semantics across providers. |
| [Simon 11:25–13:18](https://www.youtube.com/watch?v=w0S-khYCaB4&t=685s) | Iterate skills from real use, load details progressively, reference shared context, and incorporate feedback. | Validate installed skills; capture versioned corrections. Approval and evaluation govern activation of improvements. |
| [Simon 13:30–16:11](https://www.youtube.com/watch?v=w0S-khYCaB4&t=810s) | Reusable skills compose into workflows with human checkpoints. | Specify workflow contracts and artifact handoffs before deciding how many agents are necessary. |
| [Simon 16:11–18:15](https://www.youtube.com/watch?v=w0S-khYCaB4&t=971s) | Different task sizes need different planning depth and phased verification. | Lightweight execution for bounded tasks; persisted phases for complex delivery. Planning frameworks remain replaceable. |
| [Simon 18:44–22:19](https://www.youtube.com/watch?v=w0S-khYCaB4&t=1124s) | Separate client context while sharing methods; keep outputs predictably organized. | Project isolation, explicit inheritance, canonical skill versions, and artifacts linked to task/project. Avoid unmanaged copies. |
| [Simon 22:20–23:33](https://www.youtube.com/watch?v=w0S-khYCaB4&t=1340s) | Off-laptop hosting and remote messaging are separate concerns; his described installation still runs locally. | Preserve Windows availability assumptions. Remote control is not background execution while off. |
| [Chase 04:26–10:54](https://www.youtube.com/watch?v=HRw-vP0j8OM&t=266s) | Discover repeated work through actual sessions or interviews and validate the process before codifying it. | Start with the already-defined MR workflow. Later skill discovery should use authorized evidence and demonstrated repetition. |
| [Chase 10:57–13:28](https://www.youtube.com/watch?v=HRw-vP0j8OM&t=657s) | Skills can become scheduled workflows; improvement loops need prior-run evidence. | Record outcomes now; defer automatic mining and improvement proposals until the first workflow works reliably. |
| [Chase 13:32–23:22](https://www.youtube.com/watch?v=HRw-vP0j8OM&t=812s) | A coherent knowledge map matters more than a specific app or folder naming scheme. Indexes connect sources, organized knowledge, and outputs. | Define navigation and provenance requirements before choosing storage/search technology. |
| [Chase 23:24–28:23](https://www.youtube.com/watch?v=HRw-vP0j8OM&t=1404s) | Dashboard controls invoke underlying workflows through a headless runtime; visible metrics are customizable. | Keep workflow execution independent of UI. Verify actual adapter/authentication/cost behavior; his billing account is historical. |
| [Chase 28:25–31:18](https://www.youtube.com/watch?v=HRw-vP0j8OM&t=1705s) | Distribution is another layer beyond the personal system. | Team distribution and voice do not expand v1 scope. |

## Architectural synthesis

The following are engineering conclusions for Sarathi, not capabilities proven by the videos.

1. **Workflow definition precedes agent topology.** Preserve named specialists and their permission boundaries, but do not introduce one agent per skill. A workflow step may use a deterministic operation, a model, a skill, or a specialist task. Specify the reason for delegation.
2. **Reuse runtime capabilities where verified.** Compare existing repository code and supported runtime adapters against the first workflow. A headless invocation may reuse useful execution machinery; it does not by itself supply durable scheduling, transactional approval enforcement, or safe write recovery.
3. **Keep knowledge and execution records distinct.** A recalled review is useful context, not proof of current code or remote state. Approval identity, reviewed revision, issued actions, remote results, and reminder progress require durable authoritative records. Storage may share infrastructure; ownership and authority must remain explicit.
4. **Persist agent identity, not unlimited conversation.** Specialists retain configuration and scoped memory. Task sessions may be renewed or compacted with references to durable evidence; no requirement for permanent model processes.
5. **Make predictable work deterministic.** Polling, validated Jira-key matching, scheduling, deduplication, limits, and gates belong in code. Models handle analysis and ambiguity. Uncertain Jira grouping/identity must not silently enable external writes.
6. **Build through one complete workflow.** Prove adapter access, context, review output, approval, restart recovery, and Teams delivery before generalizing the platform. Keep the dashboard as the primary user interface and retain the agreed first-release scope.

## Detailed specification checklist

### Workflow and execution contracts

Define a stable workflow/run/step identity; trigger and deduplication rules; inputs and references; executor and granted authority; output artifacts; dependency/approval checkpoints; completion evidence; retry bounds; cancellation; and failure states. Explain which states survive restarts and how interrupted writes are reconciled remotely.

For the MR workflow, map discovery → Jira grouping → context/evidence collection → per-MR review → group gate evaluation → proposed action batch → approved pre-merge updates → eligible merges → post-merge Jira transition → follow-up/reporting. This is a requirements decomposition, not a newly fixed implementation graph: unrelated Jira groups may proceed independently, and blocked reviews follow the existing Teams policy. Specify reassessment when group membership or reviewed revisions change.

Separate a model's proposed result from a control-layer authorization decision. Define how structured outputs are validated and how missing/contradictory evidence blocks dependent actions. Define counting of retries and nested workers against the global concurrency/depth limits already in intent.

### Context assembly and precedence

Identify required versus optional context for each step: operator preferences, agent responsibilities, shared standards, project rules, relevant decisions, effective skill instructions, and current task checkpoint. Record source identity/version, scope, and load outcome. Define startup, resume, compaction, and provider-fallback behavior; missing mandatory context must block dependent work rather than silently omit instructions.

Specify precedence for project overrides and per-run instructions while preserving authority gates. Model persona and retrieved text cannot override execution permissions. Context should carry evidence references instead of indiscriminately forwarding full conversations to specialists.

### Knowledge, retrieval, and artifacts

Distinguish source material, accepted decisions, unverified observations, task notes, and deliverables. Specify stable task/project associations, navigable indexes, source links, freshness checks, conflict handling, correction/supersession, deletion, retention, and index rebuilding. Resolve concurrent updates and behavior when an index points to missing or outdated content.

Define authorized cross-project access independently of relevance search. Establish what is shared for a cross-repository Jira group and what remains private. Evaluate exact identifiers and paraphrased questions against representative project material before deciding whether indexes/keyword search suffice or semantic retrieval adds value.

Keep operational audit retention separate from user-editable memory; define what deletion means for derived summaries and indexes without silently erasing action history. Specify predictable artifact placement and links to originating run, step, evidence, and effective skill version.

### Skills and improvement

Inventory intended installed versions, access assignments, host requirements, supporting scripts, and dependencies. Define progressive loading, canonical shared ownership, explicit project overrides, and effective-version recording. Preserve prompt-versus-executable distinctions.

Use representative successful and failure cases to evaluate skills. Record corrections and proposed changes with supporting runs, expected benefit, and regression evidence. Require user approval before activation, retain rollback, and decide how an update affects in-flight runs and approvals. Improvements cannot modify their own authority or merge gates. Avoid unsolicited feedback prompts after every routine run.

### Runtime, interface, and measurement

Verify adapters on Windows for headless start, task/session identity, structured results, errors, cancellation, timeout, resume, required context loading, tool access, and current authentication/billing behavior. Verify standalone credentials and VPN reachability rather than assuming access from this design session transfers to the service.

Dashboard and scheduled triggers must use the same execution/approval logic. Show meaningful progress, artifacts, blocked reasons, and available usage data. Define per-run/provider spending limits separately from concurrency and timeout limits. Report unavailable usage/cost as unknown, not zero; establish baselines before claiming savings.

## Open decision register

| Decision | Recommended direction / evidence required |
| --- | --- |
| Extend, replace, or hybrid | Assess actual repository and adapters against intent; videos do not select an architecture. |
| Initial runtime/provider/models | Prove necessary headless/tool/context/recovery capabilities and confirm current authentication and billing. |
| Persistence technology and workspace tree | Choose against concurrent durable state, readable artifacts, retrieval, backup, and recovery requirements; do not mandate Obsidian. |
| Required context and precedence | Specify per workflow step and runtime; test omission/conflict behavior. |
| Memory capture authority and retention | Define automatic task records versus accepted long-term knowledge, user correction/deletion, and operational audit retention. |
| Retrieval mechanism | Compare exact and semantic queries on real examples; measure correctness, isolation, latency, and context usage. |
| Skill override/update handling | Canonical shared definitions with explicit versions; resolve update behavior for in-flight runs and pending approvals. |
| Planning thresholds | Distinguish bounded tasks, approved recurring workflows, and complex phased delivery; leave framework selection open. |
| Spending and retry budgets | Set concrete per-provider/run limits and exhaustion behavior; concurrency alone does not cap spending. |
| Future remote operation | Separate phone access from always-on hosting; reassess VPN, authentication, permissions, and data location if requested. |

Carry forward all unresolved intent details: Jira-key false positives; no-Jira approval grouping; authorship/deletion authority for misplaced threads; Task assignment precedence; immediate Teams notification versus reminders; review-round start/reset; overdue reminder coalescing; holidays; standalone integrations and credentials; and aggregate delegation counting. Research has not resolved these.

## Acceptance scenarios to carry into specification

These supplement, not replace, the MR/Jira/Teams acceptance cases in intent.

| Scenario | Required observable outcome |
| --- | --- |
| New or resumed task | Required context and effective versions recorded; missing required context blocks dependent work. |
| Renewed session or provider fallback | Task objectives/checkpoints and permissions preserved without depending on an entire prior conversation. |
| Conflicting retrieved instructions | Retrieved text cannot grant tools, change approvals, or relax merge gates. |
| Wrong-project retrieval | Unauthorized project content excluded even when semantically relevant. |
| Stale memory says an MR is approved/merged | Current remote evidence and durable execution records govern action, not remembered prose. |
| Corrected or deleted knowledge | Future retrieval respects correction/deletion; derived indexes/summaries follow the specified policy. |
| Missing artifact or stale index | Report incomplete evidence and rebuild/retrieve safely; never claim unseen outputs exist. |
| Concurrent skill or context update | Each run's effective version remains attributable; update/invalidation behavior follows a defined policy. |
| Proposed skill regression | Evaluation prevents activation; previous accepted version remains recoverable. |
| Browser closed during work | Workflow continues while host is available; approval and result state remain visible on reopening. |
| Unchanged scheduled poll | No unnecessary replanning, repeated review, duplicate writes, or repeated reminders. |
| Interrupted external write | Reconcile remote state before retry; preserve partial completion and existing Jira-group failure policy. |
| Usage unavailable or budget exhausted | Unknown usage disclosed; configured exhaustion behavior enforced without permission escalation. |

Measure review correctness/coverage, operator corrections, duplicate-action rate, recovery behavior, retrieval correctness, context usage, and elapsed execution time on representative cases. Concrete thresholds and evaluation fixtures belong in the specification. Runtime behavior, cost savings, and implementation fitness remain UNMEASURED in this documentation-only work.

## Claims and dependencies not adopted

- Numerical quality/productivity claims in the videos are not established benchmarks for Sarathi.
- A universal 200-line skill limit is not a correctness guarantee; evaluate instruction quality and actual loading behavior.
- Folder inheritance and copied skills are not portable permission enforcement or an update strategy.
- No mandatory Obsidian, vector database, knowledge graph, GSD, voice interface, or team distribution.
- Historical claims about subscription-backed headless execution must be checked against the selected provider at specification time.
- Remote messaging cannot execute jobs while the local host is asleep/off; no hosting migration is authorized here.

Additional primary design references already reviewed during discovery: [context engineering](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents) and [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills). They support selective context loading and evaluated modular skills, not a provider selection or proof that Sarathi's operational gates are implemented.
