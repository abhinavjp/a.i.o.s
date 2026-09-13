# State, retrieval, and clarification research

Status: discovery in progress, 2026-09-05. Recommendations are not settled user decisions. No implementation or external writes authorized by this research.

## Local persistence feasibility

SQLite is designed for application-local storage. Multiple readers are supported but writes serialize; this fits a candidate single-host service with short transactions, not direct multi-machine database access. [SQLite guidance](https://www.sqlite.org/whentouse.html)

WAL permits readers alongside a writer and requires same-host shared-memory coordination. A live WAL database must not be treated as an ordinary standalone file for copying or network sharing. Backup/recovery must be designed with the database's supported mechanisms. [WAL documentation](https://www.sqlite.org/wal.html)

FTS5 provides full-text indexing and matching; it does not by itself establish semantic similarity, authorization, freshness, or truth. [FTS5 documentation](https://www.sqlite.org/fts5.html)

Recommendation for evaluation: application-owned SQLite for workflow state, action records, configuration, and a rebuildable full-text index; ordinary task/project artifact files for readable outputs. Keep the live store on local non-synced storage. Do not select a concrete library/version until its Windows support and necessary SQLite features are checked. This is a candidate design, not an approved architecture.

## Ownership and boundaries to settle

- Operational records: run/step state, leases, gate evidence, approved action payloads, remote result identifiers, retry/reminder state. Models cannot edit these through arbitrary filesystem access.
- Knowledge: sourced observations, accepted decisions, project instructions, and task summaries. Corrections and supersession preserve source traceability; user deletion behavior must include derived indexes.
- Artifacts: stable task/project identity, producing step, version/hash, evidence references, and a readable location. A file write and database update are not automatically one atomic transaction; specification needs reconciliation for missing/orphaned artifacts.
- Cross-project groups: a Jira may connect several repositories. Grant a task access to its explicit group evidence without implicitly granting access to all other project memory.
- Skills: snapshot or pin effective instructions for a run. A changed skill is not silently substituted midway. Permission and policy changes need separately defined invalidation behavior.
- Untrusted inputs: MR text, code, Jira comments, tool output, and retrieved documents may contain instructions. Treat those as evidence; they cannot broaden authority or retrieve credentials. MCP connection and token handling require an explicit trust boundary; protocol support alone is not an authorization strategy. [MCP security guidance](https://modelcontextprotocol.io/docs/2025-11-25/tutorials/security/security_best_practices)

## Guarantees to avoid

These are engineering limitations, not promises that a chosen runtime solves them:

1. An AI review cannot guarantee absence of defects. Require complete accounted-for coverage, evidence-based findings, explicit unavailable checks, and regression evaluation; choose concrete acceptance thresholds with the operator.
2. Cross-service and multi-MR changes are not one transaction. Preserve partial completion and reconcile remote state. A timed-out write may already have succeeded.
3. Exactly-once remote effects cannot be assumed. Use stable action identity, remote identifiers, bounded retries, and reconciliation; ambiguous outcomes need attention rather than blind retries.
4. Prompt instructions alone cannot enforce permissions, hard spending caps, or isolation when the runtime can independently invoke unrestricted shell/network tools.
5. Local execution cannot continue while powered off/asleep. Signed-out operation is a different Windows requirement from closing the browser or locking the screen.
6. A model may fail to obey loaded context; a context-load manifest proves availability, not comprehension. Behavioral checks and control-layer gates are still required.
7. A hard monetary cap requires a enforceable pre-call bound or reservation and reliable cost attribution; post-call token reporting alone cannot ensure no overshoot. Subscription usage may not expose per-run dollar cost.

## Clarification round 1: answered

User answered on 2026-09-05: Q1 yes; Q2 review the MR and then ask for help/next actions; Q3 may correct its own inadequate or incorrect comments freely; Q4–Q6 accepted. The original recommendations below are retained as the interview record; current settled requirements are in intent.md. Q2's answer explicitly preserves review before escalation. Q3 does not authorize changes to other reviewers' comments or override the established external-action approval mode.

| ID | Decision | Recommended answer |
| --- | --- | --- |
| Q1 | Immediate blocked-review notification in addition to reminders? | Immediate notification plus 3/6 working-hour reminders. |
| Q2 | Jira-looking reference is ambiguous or inaccessible | Block merging rather than silently treating it as no Jira; any exception requires explicit handling. |
| Q3 | Misplaced review-thread corrections | Correct only Sarathi-created comments, preserving other reviewers' content and a correction trail. |
| Q4 | Owner assignment precedence | Tester first; Reporter exceptions only when Tester empty. Task/Reporter-developer case retains Reporter and adds functional comment. |
| Q5 | Review-round/reset/catch-up semantics | Start at successful findings publication; commits/replies stay in round; clear all blockers before a later round; one highest-threshold catch-up after downtime. |
| Q6 | Automatic memory capture | Automatic task records; approve inferred lessons before lasting shared instructions. |

Q4 and Q5 contain several related decisions: confirm the full proposed behavior or record individual exceptions; do not infer partial answers settle every clause.

## Next decision branches

The discovery is not complete until these branches have explicit decisions or documented implementation choices with rationale:

- Runtime and credentials: initial authorized hosted providers/models; subscription versus API preference; permitted data; fallback order; enforceable resource bounds; interactive versus unattended login.
- Windows lifetime: browser closed, locked, signed out, startup/login launch, pause semantics, task cancellation, wake behavior, VPN authentication support.
- Teams identity: delegated user versus bot; tenant consent/app-install prerequisites; recipient confirmation; approval scope for recurring messages; holiday calendar.
- GitLab scope: supported version, project discovery/pagination, valid Jira prefixes, multiple keys per MR, closed/unmerged related MRs, draft groups, missing/inaccessible related evidence, native server policies, merge method/order/dependencies, changed target branches, changed group membership.
- Jira semantics: field IDs/types, exact user IDs, transitions per workflow, manual edits during approval, Reviewed By membership/bots, severity mapping and disagreements, per-MR authors differing in one group.
- Approval: grouping for no-Jira MRs, exact action payload/revision binding, expiration, policy/config changes, new remote comments, partial approval, rejection, and pre-approved future reminders.
- Review: what counts as coverage for binaries/generated/vendor/large files; untrusted code execution; local checkout/worktree use; unavailable tests; acceptable evaluation dataset and quality threshold; re-review evidence on target changes.
- Agents: worker counting includes coordinator model calls; paused parents and children; routing ties; direct-specialist requests; permissions for project context; role versus instance identity; fallback and cancellation.
- Context/memory/skills: required load manifest, precedence, retention/deletion/backups, retrieval scope, provider fallback, skill update invalidation, source freshness, learning promotion.
- Product scope and migration: hybrid versus replacement acceptance; legacy ADR precedence; required v1 UI/configuration; installation/update/uninstall; data migration; meaningful done criteria before specification starts.

Track answers centrally in intent.md. Supporting reports retain evidence and technical detail. Do not label the intent specification-ready while these decision branches remain unvisited.
