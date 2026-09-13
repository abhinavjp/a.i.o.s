# Sarathi repository assessment

Date: 2026-09-05. Static, read-only implementation assessment; this report is the only authored artifact. Runtime behavior, current Hermes compatibility, tests, recovery, costs, and live integrations remain **UNMEASURED**. No external actions performed.

## Conclusion

Recommend **hybrid reuse**, subject to user decision: retain the TypeScript workspaces, React/Fastify shell, adapter boundary and injectable process/test seams; redesign the execution contracts, persistent workflow state, authorization and specialist configuration around Sarathi. Existing code is a small task-stream skeleton, not an implemented agent operating system. Continuing the old numbered slices unchanged would build a different product; discarding every file is unnecessary. This is an architectural recommendation, not authorization to implement or a measured estimate of reuse effort.

## Observed implementation

| Capability | Actual status and evidence | Implication |
| --- | --- | --- |
| Browser task interface | Agent health/list, prompt submission, EventSource output, done label: `app/client/src/App.tsx:8`, `:27`, `:61`. | Reusable UI shell; no approvals inbox, task history, specialist chat/configuration, artifacts, usage or pause UI. |
| Server and adapters | Fastify registers only agent/task routes: `app/server/src/app.ts:6`; Hermes selected in composition root: `app/server/src/index.ts:5`. | Useful plumbing; no production domain workflow yet. |
| Agent selection | One active instance cached at construction: `agents/src/AgentManager.ts:5`; registry keys by kind: `agents/src/AgentConfigurator.ts:5`. | Cannot presently model multiple separately configured specialists per role, ordered provider fallbacks, or routing. Audited runtime selection described in BUILD_PROMPT is absent. |
| Task execution | Contract takes two strings and returns string chunks: `contracts/src/index.ts:11`, `:17`. | No structured outcome, permission envelope, task/project identity, cancellation, approval interruption, evidence or usage contract. |
| Orchestration | Capability contains only a kind string: `contracts/src/index.ts:13`; Hermes explicitly calls its implementation a stub: `agents/src/strategies/HermesAgent.ts:122`. | No implemented scheduler, delegation, global worker limits, dependency graph or communication ledger. Returning a capability label is not orchestration. |
| Task records | Map of chunks/done/listener, explicitly no persistence: `app/server/src/TaskRunRegistry.ts:4`, `:17`, `:20`. Consumption starts before browser attaches. | Browser-independent consumption exists within a live process; restart recovery and authoritative workflow state do not. |
| Sessions | Hardcoded default operator/project: `app/server/src/routes/tasks.ts:20`; Hermes ignores supplied session key: `agents/src/strategies/HermesAgent.ts:68`. | Neither project isolation nor reliable conversation continuity is implemented. |
| Hermes process | One-shot CLI and component-wide log tail: `agents/src/strategies/hermes/RealProcessRunner.ts:12`, `:64`. | Actual installed CLI/auth/tool behavior requires a fresh capability probe; code comments and old spikes do not establish current support. |
| Memory/skills/audit | Current workspace packages are contracts, agents, app/server and app/client (`package.json:5`). No memory/skills/audit implementation appears in source inventory. | Approved Slice 2 is a design document, not completed code. Context assembly, provenance, correction, canonical skills and audit all require new implementation. |
| External workflow and Windows lifecycle | No GitLab/Jira/Teams adapters, polling, reminders, merge gates, VPN lifecycle, tray or start-at-login code in current source inventory. | First MR workflow is new work end to end. Existing connector access in the design host cannot be counted as application integration. |

## Existing limitations that affect approach

1. **Failures lack durable outcome.** Task registry's detached async consumer has no catch/finally (`app/server/src/TaskRunRegistry.ts:27`). An iterator rejection has no recorded failed state or terminal event. NullAgent yields a notice and ends (`agents/src/strategies/NullAgent.ts:18`), which the registry/UI represent as done. Define succeeded, unavailable, failed, cancelled, waiting for approval and blocked separately; prose must never determine success.
2. **No run isolation in logs.** Hermes tail filters component, not run/session (`agents/src/strategies/hermes/RealProcessRunner.ts:64`). Concurrent Hermes invocations can become indistinguishable in observed streams. Require provider-issued identity and attributable events before parallel use; failure to correlate must disable that capability rather than guess.
3. **Streaming is not a durable event channel.** One listener replaces another; all chunks are replayed and retained (`app/server/src/TaskRunRegistry.ts:43`). No event cursor, eviction, reconnect deduplication or detach handling. SSE wraps an arbitrary string in one data field (`app/server/src/routes/tasks.ts:48`), so multiline final output needs proper framing. Use structured event identities and persisted outcomes; UI transport is only a view.
4. **Process control is incomplete.** Runner exposes no cancellation or deadlines (`agents/src/strategies/hermes/ProcessRunner.ts:7`). Long-running model/process failures need bounded timeout, process-tree cancellation, reconciliation and clear stopped/unknown state. Cancellation does not prove a remote action did not occur.
5. **Local browser authority is not defined.** Server reflects request origins with CORS (`app/server/src/index.ts:18`); task POST has no authentication/authorization/runtime body schema (`app/server/src/routes/tasks.ts:17`). Localhost alone is not the whole security model. Define allowed browser origins, operator/session verification and server-enforced action authority before connecting write-capable tools. This is a design requirement, not a demonstrated exploit claim.
6. **Capabilities cannot be optimistic claims.** Existing health is version-oriented; it does not prove login, permitted models, tool availability, VPN, or operation support. Maintain explicit readiness/capability results, with timestamps and reasons. Do not equate installed, connected, authorized and operational.

## Legacy document conflicts to resolve explicitly

| Existing statement | Conflict / required disposition |
| --- | --- |
| `CONTEXT.md:3` says glossary wins; `:13` defines agent as a single swappable engine. `BUILD_PROMPT.md:4` says architecture settled and not to redesign. | Current intent explicitly changes name and leaves architecture open. Mark old product/build/glossary documents historical or superseded for Sarathi; publish a precedence rule before anyone implements. Do not silently obey both. |
| `PRD.md:28`, `BUILD_PROMPT.md:24`: orchestration optional, absent with some active runtimes. | Sarathi requires durable central coordination regardless of the selected model/runtime. Distinguish specialist definition, runtime adapter and coordinator. Runtime-native delegation may be an optional execution capability but cannot replace mandatory host gates. |
| `CONTEXT.md:41` and `BUILD_PROMPT.md:68`: one persistent session per operator/project. | Sarathi requires separately scoped task sessions and retained specialist identity. Decide whether continuity keys include agent/project/task, how concurrent calls are serialized, and how sessions renew. |
| `PRD.md:26`, `BUILD_PROMPT.md:34`: Hermes Gateway primary. ADR-0001 selects CLI; approved Slice 2 corrects nonexistent memory commands. | Legacy docs already conflict with each other. Retain useful boundary principle, reverify current runtime surface, retire inaccurate commands; no provider selection follows from old prose. |
| ADR-0002 requires real OS self-change governance in v1; ADR-0004 requires agent-defined UISpec views. | Neither appears in Sarathi first-release scope. Ask whether to defer both. External-action approval is needed now; it is distinct from a self-modifying-OS pipeline. Do not accidentally import substantial old scope. |
| ADR-0003 promises tokens/model always real and uses `0/n/a` for local or unpriced cost. | Sarathi must display unknown when usage/pricing unavailable. Separate measured tokens, inferred provider/model and estimated currency cost; prices need version/date. A hard currency cap cannot be guaranteed with unobservable billing. |
| ADR-0005 assumes Hermes already loads required memory and session reuse always saves context. | Preserve efficiency as a goal, replace unverified loading assumptions with recorded context assembly. Required policies cannot be dropped to save tokens. |
| `BUILD_PROMPT.md:42`: owning agent is sole memory writer. Slice 2 proposes read failures as empty layers (`docs/superpowers/specs/2026-07-09-slice2-memory-design.md:154`). | User correction/deletion needs an explicit controlled mutation path. Required-context failure must block; optional empty memory is different from unreadable mandatory context. |
| PRD's inline ADR-0001..0015 and actual docs/adr/0001..0005 use overlapping numbers for different decisions (`PRD.md:87`). | Future specification must identify source by full path/title, then establish unique decision identifiers; bare ADR numbers are ambiguous. |

## Approved Slice 2 is evidence, not the next implementation plan

The document records historical Hermes v0.17.0 spikes and explicitly proposes new files that are absent. Its cold-start mapping selects the newest CLI session while holding an in-process mutex (`docs/superpowers/specs/2026-07-09-slice2-memory-design.md:53`). That mutex protects only participating calls inside one process: another CLI application or a second application instance can create a newer session. Crash between creation and mapping is another ambiguity. Require unambiguous invocation-to-session correlation, isolated runtime storage, or a supported session creation mechanism; do not select the global newest session for safety-critical task attribution.

Reading all top-level global memory files is also not project access control. A future adapter must expose only authorized scope and distinguish source memory from Sarathi-owned operational records. Historical CLI spikes must be refreshed before treating features as feasible in the installed version.

## Decisions needed before specification

### User/product decisions

- Confirm hybrid reuse and disposition of old PRD/BUILD_PROMPT/glossary/ADRs; no code migration yet.
- Defer or include OS self-change governance and model-generated dashboard layouts? Recommendation: defer; retain safe fixed dashboard and required action approvals.
- Is one Windows user/logged-in desktop the deployment target? Must work survive sign-out, or only browser close/reboot-after-login? This affects tray/service/session credentials and VPN behavior.
- Select initial runtime/provider(s), authorized organizational data destinations, fallback order and budget policy. Separate runtime product from model provider.
- Define pause/cancel semantics: stop new work, stop current model runs, or stop external writes at next safe boundary? Completed writes cannot be cancelled retroactively.
- Decide memory acceptance and retention: automatic observations versus accepted durable knowledge; operational audit lifetime; artifact deletion; backup and restore authority.
- Define project scope for a Jira spanning repositories; which specialists can read each source, and what cross-project sharing is already authorized.

### Engineering decisions that can be proposed without repeated interviews

- Separate deterministic coordinator/control layer from model runtime adapters; structured proposed actions cannot execute directly.
- Durable run/step/action records with atomic local transitions, immutable approval references, idempotency keys where supported, remote receipts and an explicit unknown-result state.
- Persist exact proposal payload, reviewed revisions, membership and relevant gates for approval validity; recheck before writes. Group membership changes require a defined invalidation rule.
- Use action-by-action remote reconciliation across Jira/GitLab/Teams; there is no existing distributed transaction. Preserve partial completion; no fabricated rollback or exactly-once claim.
- Required context manifest and effective skill version per run; task state reconstructed from records rather than transcript recall.
- Global concurrency accounting across tasks/subagents, slot release during approval waits, separate rate/request limits, and single-instance/lease behavior for duplicate schedulers.
- Event replay cursors, bounded buffers/artifacts, task retention and observable failure states.
- Prefer a simple durable local store plus inspectable artifacts unless measured requirements justify additional infrastructure; persistence engine selection needs a dedicated decision, not inheritance from Hermes state.

## Verification coverage and next evidence

Read the current intent, research input, core implementation contracts/routes/UI, manager/configurator, Hermes process seam, relevant tests, legacy PRD/BUILD_PROMPT/glossary/handoff, five ADR files and Slice 2 design. Inspected repository source inventory and working-tree status. Existing tests exercise adapter fakes, construction fallback, basic POST/SSE and UI events (`agents/tests/HermesAgent.test.ts:5`, `app/server/tests/tasks.route.test.ts:11`, `app/client/src/App.test.tsx:47`); they do not establish live integration or production recovery. No tests run because this was a documentation/static assessment.

Before specification completion: prove selected runtime structured outputs, invocation identity, cancellation, scoped tools/context and authentication on Windows; establish actual adapter operation availability and permission limits; then specify durable execution and failure cases. Live tests that publish, message, edit issues or merge require their separate explicit authorization. Do not treat this report as permission to perform them.
