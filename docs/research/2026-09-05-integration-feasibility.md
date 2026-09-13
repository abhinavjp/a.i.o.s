# Sarathi integration feasibility

Date: 2026-09-05. Discovery evidence; not implementation approval. External activity was read-only. No comments, messages, issue edits, transitions, merges, app registrations, or VPN launches were performed.

## Conclusions

- GitLab/Jira workflow is technically plausible, but existing GitLab MCP tools cannot implement the complete workflow. A capable adapter and reachable on-prem instance are prerequisites.
- Jira metadata and the intended post-merge transition were verified on a representative issue. The meaning of Severity remains genuinely ambiguous in the tenant.
- Teams requires a sender/authentication decision before architecture freezes. Sending as Abhinav, as an installed bot, and through chat-specific application consent are different products and deployment requirements.
- Cross-service actions are not one transaction. Source-SHA guarding does not freeze Jira, discussions, target branches, or group membership. Absolute atomic group approval validity cannot be promised by local orchestration alone.
- Session connector access does not establish standalone credential availability. Runtime authentication and actual write behavior remain UNMEASURED.

## Evidence categories and current environment

| Area | Current evidence | Limit |
| --- | --- | --- |
| Atlassian connector | Resource discovery returned brainpayrolljira.atlassian.net with read:jira-work and write:jira-work; JQL, issue metadata, and transition reads succeeded. | Scopes do not prove every issue/field writable; no write attempted. |
| GitLab connector | Tool inventory includes project search, file reads, repository/branch/MR creation and file writes. No MR listing/read, discussion, pipeline, or merge operations exposed in this session. | A different/local adapter might have them; not established here. |
| GitLab connectivity | Project search failed with ENOTFOUND gitlab.btl.com at http://gitlab.btl.com/api/v4/projects. | DNS/connectivity failure, not evidence of invalid credentials or missing server features. VPN not launched by this research subtask. |
| Teams | No Teams sending/identity tool exposed in current tool inventory. | Tenant consent, app installation policy, recipient directory, delegated session, and sending all UNMEASURED. |

## GitLab documented capabilities

The Discussions API supports positioned MR discussions using base/head/start SHAs and old/new paths. Added lines use new_line; deleted lines use old_line; context lines use both. Fetch the latest MR diff version and use its references. Responses expose resolvability, position, authorship, and resolution data; discussion/note updates support resolution. This provides a real inline-thread path, unlike a plain overview note. [Discussions API](https://docs.gitlab.com/api/discussions/)

MR APIs support assignee/reviewer filters, diff retrieval, versions, pipelines, merge status, and per-MR merging. A merge request carrying sha rejects a mismatched source HEAD with 409. Some metadata populates asynchronously; merge-status recheck is not a synchronous guarantee. Diffs can be limited/collapsed; API availability varies by GitLab version. [Merge requests API](https://docs.gitlab.com/api/merge_requests/)

GitLab documents OAuth and access-token authentication; deploy tokens cannot authenticate the general public REST API. Choose a supported credential whose project reach and operations match the actual adapter. [REST authentication](https://docs.gitlab.com/api/rest/authentication/)

### Sarathi design implications and unresolved decisions

These are recommendations/inferences from the API boundaries, not guarantees supplied by GitLab:

1. Discover seeds using the union of assignee and reviewer queries, deduplicated by instance/project ID/MR IID. Explicitly query all applicable scope, paginate completely, and record failures. Broad access does not mean every page was retrieved.
2. Build a searchable title index of accessible MRs so BR-21718, Br 21718, and BR21718 are found regardless of server tokenization. Validate candidate keys against Jira. Unknown/inaccessible key is distinct from no Jira: otherwise access failure could accidentally bypass Jira gates.
3. Define group membership: open MRs only, merged historical MRs, target branch/release boundaries, multiple Jira keys, abandoned/closed MRs, and incidental references. Do not recursively join an entire Epic simply because an integration comment mentions it. A sampled Jira Epic had an MR reference concerning another Jira, demonstrating that mentions are not necessarily membership.
4. Record source/target/base revisions, exact file inventory, diff availability, and review evidence. A paginated API response is not proof of full review. Use an authorized local Git checkout or blob retrieval when a diff is incomplete; otherwise block material coverage. Binary/LFS/submodule/generated files need explicit coverage policy.
5. Validate the created inline thread remotely: exact paths/side/line/revision, resolvable flag, author, body, and returned IDs. If placement is impossible, ask/report a placement exception rather than silently claiming an inline finding.
6. Treat deletion/reposting as a separate authority. Prefer a corrected link/replacement preserving discussion history; never infer authority to delete someone else's comments from broad token permissions. Decide whether Sarathi may delete only its own empty/misplaced threads and how to handle replies.
7. Gate execution in deterministic code. Persist group membership and reviewed revisions with the approved action set. Before each write re-read pertinent state; merge with the reviewed source SHA. Any discovered drift requires reassessment under explicit policy.
8. Source-SHA guarding protects only the source HEAD at the merge call. It cannot atomically guard another MR, Jira status, a new discussion, or the target HEAD. Rechecking narrows race windows; does not eliminate them. If zero race tolerance is required, server-enforced gates/coordination or a narrower guarantee is necessary.
9. Process group merges sequentially, reconcile each remotely, stop on failure/uncertainty, retain completed effects. A per-MR API cannot supply a Jira-group rollback transaction. Target movement caused by an earlier merge may require revalidation of later MRs, particularly same-target dependencies.
10. Define merge strategy, squash, source-branch deletion, conflict/rebase handling, merge order, protected-branch approval requirements, skipped/manual/cancelled/stale CI, and whether dependency MRs may be reviewer-only. Do not translate all nonfailed pipeline states into pass.

## Jira documented capabilities

Issue edit metadata identifies editable fields, permitted operations, and allowed values in the current issue/user/workflow context. Workflow transitions use transition IDs and can expose required transition fields; status is not an ordinary editable field. Project permissions, issue security, workflow rules, and field screens remain effective even with OAuth write scopes. [Issues API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/)

System/custom field discovery returns IDs and schemas, subject to visibility rules. Display names are therefore insufficient configuration keys. [Fields API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-fields/) Assignment candidates can be checked through issue-specific assignable-user search; use account IDs instead of ambiguous display names. [User search API](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-user-search/)

OAuth 2.0 3LO requires the app's own consent flow; offline_access requests refresh-token support. A service must implement token lifecycle rather than assume permanent sign-in. [Atlassian OAuth](https://developer.atlassian.com/cloud/jira/platform/oauth-2-3lo-apps/)

### Live read-only observations

Read BR-830 (Epic/Analysis) and BR-21610 (Bug/Merge Requested) through Atlassian MCP with names/schema/editmeta expansion. No updateHistory requested. Fields below appeared editable in these sampled metadata responses; this is not a global permission guarantee.

| Meaning | Actual field | Schema / operations observed |
| --- | --- | --- |
| Owner | customfield_10355 | Single user; set |
| Developer | customfield_10184 | Single user; set |
| Tester | customfield_10069 | Single user; set |
| Reviewed By | customfield_10187 | Multiple users; add/set/remove |
| Severity (name includes trailing space) | customfield_11015 | Select: Critical 13455, High 13456, Medium 13457, Low 13458 |
| Security Severity | customfield_10056 | Select: Critical 10124, High 10125, Medium 10126, Low 10127, Informational 10128 |

For [BR-21610](https://brainpayrolljira.atlassian.net/browse/BR-21610), current status was Merge Requested (10158). Available transition 7, named Merge request reviewed, targeted Unit Tested (10011); transition metadata listed no required fields. This establishes a plausible path in this exact sampled context, not that a future transition will succeed. BR-830 did not expose that transition in its Analysis state. Query transitions afresh; never hardcode ID 7 globally.

### Decisions needed

- Which Severity field does the existing policy mean? If security defects affect both, specify distinct rubrics; severity of the Jira's underlying issue is not automatically severity of a newly found code defect.
- Does Reviewed By preserve existing people and add verified human reviewers, or recompute? What counts as a review comment versus an author reply/system message? If Sarathi publishes under Abhinav's identity, does that count as Abhinav's personal review? If a bot publishes, what Jira account represents it? Avoid false attribution.
- Resolve Task/reporter/developer assignment precedence, multiple MR authors, inactive/unassignable Tester, and meaning of original assignee/developer (first discovery snapshot versus pre-write snapshot). Owner matches must use a confirmed account ID.
- Define which status changes are permitted before merge. Current intent also says status remains unchanged after partial failure; this conflicts with any approved pre-merge status change unless baseline is defined. Recommended: no pre-merge status transition in the merge-success path; only post-group Unit Tested.
- If required field update fails, recommend stop before merging; no silent omission. If Unit Tested transition fails after all merges, report merged + Jira update blocked, never imply merge failure or rollback.
- Recheck original field values before writing; if another person changed them, recompute/reapprove rather than overwrite. No cross-service atomic compare-and-set guarantee was established.

## Teams sender and delivery options

| Option | Feasibility and deployment consequence |
| --- | --- |
| Delegated Graph, send as operator | ChatMessage.Send is documented as delegated send on behalf of a signed-in work/school user. Requires Sarathi's authorized client/session, appropriate chat access, recipient mapping, and tenant policy allowance. It is not a personal consumer-Microsoft-account solution. |
| Installed bot/agent, send as Sarathi | Proactive messaging supports recipient conversations after installation/context prerequisites. Store tenant and conversation identifiers; the recipient must be reachable in that installation context. Separate visible sender from Abhinav. |
| Application with chat-specific RSC | Current permission reference includes ChatMessage.Send.Chat for application sending in that specific chat. Requires the corresponding installed/consented Teams app context; not unrestricted app-only impersonation. Verify exact target-chat support before selecting. |
| Migration permission | Do not use Teamwork.Migrate.All for ordinary reminders. The standard message endpoint documentation describes it as migration-only. |

Sources: [Graph permissions](https://learn.microsoft.com/en-us/graph/permissions-reference), [send-message endpoint](https://learn.microsoft.com/en-us/graph/api/chatmessage-post?view=graph-rest-1.0), [proactive messaging](https://learn.microsoft.com/en-us/microsoftteams/platform/bots/how-to/conversations/send-proactive-messages), [RSC](https://learn.microsoft.com/en-us/microsoftteams/platform/graph-api/rsc/resource-specific-consent).

Documentation discrepancy: the current send-message endpoint page's chat permission table showed ChannelMessage.Send, whereas the permission reference explicitly defines ChatMessage.Send for delegated chats and ChatMessage.Send.Chat for RSC. Do not hide this discrepancy or conclude app-only ordinary sends are universally impossible. Resolve through a consented target-tenant proof before writing a concrete integration contract.

Creating a chat is a separate Graph operation with its own permissions and membership requirements. A known email does not establish an existing chat or permission to create one. [Create chat](https://learn.microsoft.com/en-us/graph/api/chat-post?view=graph-rest-1.0) Refresh tokens can be revoked; unattended operation must support reauthentication-needed states. [Microsoft refresh tokens](https://learn.microsoft.com/en-us/entra/identity-platform/refresh-tokens)

### Reminder contract to settle

Recommendations below concern Sarathi's behavior; Teams does not supply this workflow automatically:

- Confirm sender identity first; then determine if tenant app registration/admin consent/installations are available. Identify whether external emails mean same-tenant accounts, guests, or federated external users; do not assume arbitrary external reach.
- Persist GitLab user ID, Jira account ID where needed, Teams tenant/object ID, confirmed address, verifier/time, and chat ID. First-contact confirmation should show actual resolved recipient and sender. Names/email patterns only propose candidates.
- Decide immediate notice versus only 3/6-working-hour reminders; recommended timer anchor is successful initial findings publication/notification, not a draft that the developer cannot see.
- Decide whether replies/new commits reset a round. Recommendation: a reply triggers re-review but does not automatically erase the existing unresolved-obligation timer; a materially new reviewed finding set may start an explicit new round.
- Decide whether initial approval authorizes the exact two future reminder templates/recipient or each reminder needs approval. Freshness checks still apply before sending. Approval delays cannot be portrayed as developer response delays.
- After sleep/off, recommend re-read threads and coalesce overdue reminders into at most one current notice; don't send both overdue notices back-to-back. Define whether this consumes both thresholds and what follows.
- Define holidays, absent developers, changed author/recipient, reopened threads, and whether blocking non-thread conditions should produce reminders. Current reminder requirement refers to unresolved threads, not every merge blocker.
- Persist a unique round/recipient/threshold action identity and returned remote message ID. On timeout after send, reconcile before retry. Without reliable remote lookup or endpoint idempotency, report uncertain delivery and pause rather than promise exactly-once delivery. Permission to send alone does not prove permission to read back for verification.
- Verify API creation separately from human receipt/read. A remotely existing message does not establish that the recipient read it.

## Standalone adapter acceptance gate

Before committing the production specification to an integration choice, produce a capability matrix for the actual Windows runtime identity: authentication and refresh; read access; pagination; exact field/diff support; write authority; remote verification; timeout reconciliation; rate-limit handling; audit IDs; and credential storage. Credentials stay outside repository/documents.

Use session MCP only where a supported standalone client/authentication contract is proven. Otherwise select direct REST/Graph or another verified MCP implementation. Separate model proposal tools from deterministic write executors so a prompt cannot call raw external-write tools outside the gate.

Suggested proof sequence: reachable GitLab version/read fixture; complete diff/discussion coverage; Jira metadata for Task/Bug and both eligible statuses; Teams tenant/sender consent feasibility; standalone reauthentication and restart; then a separately authorized sandbox write fixture for inline-thread placement, changed-SHA rejection, field edits/transition, and message verification. The current documentation authorization does not authorize those writes.

Production-write verification, exact-once behavior, native GitLab capabilities/version, Teams tenant feasibility, rate/scale behavior, and standalone authentication are UNMEASURED. These require evidence, not confident prose in intent.md.
