# Sarathi view replacement — implementation evidence

## TSK-001

- Baseline: `aaf5e07d4f6a817709df75f63562b37ef9b94dc7`.
- TDD: migration, source upsert/missing, and board projection tests failed before implementation and passed afterward.
- Proof: 25 targeted tests, 258 repository tests, contracts/server typechecks, migration round-trip, and `git diff --check` passed.
- Delivered: `d1e034d3477abbc533c83b43d77a5927c8f5a004` on local `HEAD`, `origin/main`, and remote `refs/heads/main`.

## PHS-01 independent review and TSK-002 ruling

- Independent read-only review found that malformed Jira search envelopes were accepted as an empty result, a single search page could be mistaken for the complete query, and per-ticket persistence could leave a partial observation batch after a store write failure.
- Ruling: TSK-002 may make the smallest necessary changes to `connectors/src/index.ts`, connector tests, `app/server/src/WorkItemStore.ts`, and relevant store tests in addition to its declared paths. REQ-012/REQ-013 and CON-003 require complete or failed Jira reads and atomic observation batches; those outcomes cannot be implemented within the original TSK-002 file list. Cost if wrong: a broader packet diff and additional connector/store regression proof.
- Live Jira behavior remains `UNMEASURED` until an authorized live fixture is supplied.

## TSK-002

- TDD RED: startup sync read zero times; an incomplete ticket batch was partially accepted; malformed/missing Jira page fields and incomplete pagination returned misleading results; and a simulated store commit failure changed in-memory work before reporting failure.
- GREEN: startup, manual refresh and scheduled sync use one single-flight coordinator; complete Jira pages are accumulated before applying one atomic store batch; malformed, incomplete or over-limit reads fail closed; absent tickets remain durable with missing-observation status.
- Implementer proof: 32 focused tests, 272 repository tests, connector/contract/server typechecks and `git diff --check` passed.
- Independent scoped re-review: all three PHS-01 findings addressed; no new blocking breakage found. The reviewer did not run live Jira.
- Bounded pagination follows Atlassian's enhanced Jira issue-search API (`/rest/api/3/search/jql`, `nextPageToken`, `isLast`). A search exceeding the 100-page budget fails with an explicit error rather than treating a partial result as complete.
- Delivered: `5ce94ad3f011e608770163420bf9dd5c0dc8f5f5` on local `HEAD`, `origin/main`, and remote `refs/heads/main`.

## TSK-003

- TDD RED: malformed merge-request identity reached the public projection; the repository suite also exposed an extra fake-host response field outside the existing route contract. Both failures passed after scoped fixes.
- GREEN: normalized merge requests include stable project/IID and optional pipeline identity; pipeline and discussion reads normalize IDs, authorship, system and resolution flags. Null and fake hosts implement the new discussion read. GitLab MR and discussion pages use bounded pagination, reject malformed pages and 404s explicitly, and keep credentials in request headers.
- Fixture provenance: discussion/note examples in `connectors/tests/ConnectorConfigurator.test.ts` are local synthetic fixtures shaped from the GitLab v4 discussions API; the pagination headers follow GitLab REST API documentation. They are not live observations.
- Proof: 12 connector tests, 276 repository tests, connector/server/client/contracts typechecks, and `git diff --check` passed. Live self-managed GitLab remains `UNMEASURED`.
- Direct review: kept the public fake-host MR response compatible with the existing route assertion; no external GitLab write method was added. No blocking scoped finding remains.

## TSK-004

- TDD RED: six initial cases failed for absent startup asks, sync routes and durable state. Direct review added failing cases for resolution/absence retirement, non-resolvable human notes and first actionable transition after an initially resolved observation.
- GREEN: schema v8 migrates v7 documents additively; one startup/manual/interval coordinator collects complete linked MR/discussion reads, applies a durable observation batch, creates at most one ask per stable project/MR/discussion identity, and records stale failure/recovery state. Resolved or absent observations retire pending asks while preserving their identity/history; a previously resolved thread receives its first ask when it becomes actionable.
- Proof: 9 focused discussion tests; 285 repository tests across 47 files; server, contracts and client typechecks; `git diff --check`. Scoped agent run also passed 34 tests across discussion, board, work-item route and migration files.
- Direct review: fixed the three ask-lifecycle gaps above and updated the future-schema rejection fixture to v9 after the additive v8 migration. No blocking scoped finding remains. Live self-managed GitLab polling is `UNMEASURED`.

## TSK-005

- TDD RED: approval initially admitted no task; capability/full-slot/stale/rule cases had no admission state; an async route-selection test showed the need to recheck freshness before task-store creation. Direct review added a failing decline-without-capability case.
- GREEN: an approved discussion ask is admitted through the existing permission decision path only after its action-bound approval is recorded. A valid standing rule can also admit an ordinary task. Selection requires an active agent with `gitlab.discussion.remediate` and a free slot; the task uses bounded MR/thread/work-item context and a stable identity-derived task ID. Resolved or stale observations, absent capability, full slots and floor intents do not admit. Block reasons and admitted task IDs are durable and projected on the board.
- Proof: 9 focused admission/guard tests, 294 repository tests across 49 files, server/contracts/client typechecks, and `git diff --check` passed.
- Direct review: corrected permission audit precedence for explicit approval, added a task-store-boundary freshness guard, allowed decline without remediation preflight, and kept the existing general suggestion endpoint behavior while requiring active specialists for remediation. Actual MCP/skill execution remains `UNMEASURED` without an authorized capable runtime.

## TSK-006

- TDD RED: admission lacked milestone slots; repeated pipeline observations risked replacing a result timestamp; the direct review's fast-completion test showed a task could finish before its discussion link was recorded.
- Milestone sources: `admitted` comes from Sarathi task admission; `fixProduced` from a completed canonical task outcome; `pushed` from a new GitLab pipeline commit SHA after admission; `pipeline` from the GitLab MR/pipeline read; `resolved` from GitLab discussion resolution. Failed/cancelled tasks do not produce a fix. Older GitLab batches do not overwrite newer observations.
- GREEN: schema v9 migrates v8 admitted links without inventing a time; distinct timestamped milestone fields persist across restart and project on Mission Control. The GitLab sync reads matching pipeline detail; the coordinator reconciles terminal tasks that complete before the admission link is stored.
- Proof: 5 focused milestone tests, 299 repository tests across 50 files, server/contracts/client typechecks, and `git diff --check` passed. Live push, pipeline and thread resolution remain `UNMEASURED` without authorized GitLab/agent fixtures.
- Direct review: added the fast-completion reconciliation proof; no blocking scoped finding remains.

## TSK-007

- TDD RED: the configured root initially had no Mission Control landmark; the global `C` shortcut crashed on a window-targeted key event; and malformed available board data passed the adapter. Each failed before its scoped implementation fix.
- GREEN: the configured command view reads the typed board and renders a responsive header, asks-first hero, asks, pipeline, activity, and collapsible agent rail. Region loading, empty, and error states remain explicit. The existing command center remains reachable through Advanced controls, and setup branching and old action handlers remain intact.
- Reference source: the user supplied `D:\Downloads\Mission Control - a.i.o.s prototype.html`, SHA-256 `4AE72BA77D9173C5E9B8BE6EABEFEC9FC9E9BAC5663D81B272DCE4608876181F`. The approved plan lists SHA-256 `287FF513044861D12CA93DF32E02E1E6DAB86B775424F12E627322D050EE3B8E` at a missing former path. The supplied file was used for visual structure and tokens; the approved decision was not changed.
- Token map: reference `--bg/#0d0f13`, `--bg2/#111318`, `--card/#16181d`, `--line/#262a32`, `--ink/#e9ebf1`, `--amber/#e0a44a`, and `--blue/#7b8ff5` map to scoped `--mc-*` CSS tokens. Breakpoints follow reference `1000px` and `760px`; typography uses local Inter with system fallback.
- Browser proof: `screenshots/tsk007-desktop.png` at 1440px, `screenshots/tsk007-tablet.png` at 900px, and `screenshots/tsk007-mobile.png` at 390px, using a local API route fixture with real projection-shaped records. All were inspected against `screenshots/tsk007-reference-desktop.png`; each retained asks-first order and had no horizontal overflow. The reference has denser task controls and a stage matrix; those belong to later view packets, so this shell intentionally shows only actual stage/task counts.
- Proof: 41 client tests across 9 files, client typecheck, client production build, and `git diff --check` passed. A repository-wide run in the restricted sandbox failed on unrelated server tests trying to write `C:\Users\Abhinav\AppData\Roaming\adhisthana`; the targeted client proof passed.
- Direct review: corrected the window shortcut crash, removed a guessed active-work count, made hero failure/empty states truthful, and rejected malformed board regions before rendering. No blocking scoped finding remains.

## TSK-008 and PHS-04 review

- TDD RED: a mixed-track fixture lacked track groups, work/stage detail and unknown-count output; phase/task/artifact/MR detail and observed agent detail were likewise absent. Direct review added failing checks for agent-drawer focus return, slot-read isolation, and truthful system task status.
- GREEN: the board projection supplies work identity, track/stage cells, phase/task records, artifact references and approval state, and observed MR/pipeline counts. The canonical progress and artifact-content routes supply detail on open. Each unavailable/error region stays explicit. The agent rail combines dashboard specialists, `/api/agents` health, `/api/sarathi/agents` slots, capability tags and system recent task status; it explicitly declines to attribute a task to a specialist without a link in the projection.
- Control/data mapping: work and stage cells open read-only drawers; phase/task, artifact/content and MR/pipeline buttons open nested details; artifact approval remains a canonical ask and is not mutated locally; agent buttons open health/slot/capability detail. Legacy work-item mutation controls remain reachable from Advanced controls until TSK-011.
- Visual proof: `screenshots/tsk008-desktop.png` (1440px), `screenshots/tsk008-tablet.png` (900px), `screenshots/tsk008-mobile.png` (390px), and `screenshots/tsk008-work-drawer.png` were inspected against the supplied reference. The desktop/tablet stage matrix preserves a compact grid; mobile stacks all stages so none is concealed. All page widths matched their viewport widths. Local route fixtures are projection-shaped, not live provider observations.
- Proof: 45 client tests across 9 files, client typecheck, production build, and `git diff --check` passed. External artifact contents and provider state were deterministic local browser/test fixtures; live reads remain `UNMEASURED`.
- Direct PHS-04 review: fixed nested drawer focus, independent dashboard/slot failures, truthful system task attribution, and mobile stage visibility. No blocking finding remains for the shell/work-detail phase. Later packets still own ask/rule, setup/connection, control migration and final acceptance behavior.

## TSK-009

- TDD RED: ranked asks had no decision detail, catch-up had no canonical per-ask skip/keyboard action flow, rules/autopilot/audit were absent, and stale track approval had no surfaced error or refresh proof. Direct review added failing cases for accepted suggestion filtering, policy-read error posture, and disabled stale ask actions.
- GREEN: the shell keeps server ask order, opens decision context including current/proposed track, and uses one canonical ask array in the queue and catch-up. `C`, `S`, `A`, `D` and Escape work outside editable fields; skip never calls the decision endpoint. Ask, suggestion, rule, autopilot and undo operations call existing Sarathi routes and refresh the dashboard. Rejected actions retain an error message; a stale ask removed by refresh cannot be decided again from its open drawer.
- Migrated controls: ask detail/approve/decline, catch-up navigation, standing-rule suggestions, rule enable/disable, autopilot tiers and automatic-decision audit/undo are reachable in Mission Control. The immutable floor remains server-owned; non-undoable automatic outcomes disable Undo. The old generic panels remain temporarily reachable through Advanced controls until TSK-011.
- Proof: 51 client tests across 9 files, including the automatic-decision and stale-track cases; client typecheck, production build and `git diff --check` passed. A floor-denied autopilot response is displayed and does not create a local success state. Canonical API contracts use deterministic fakes; no external mutation was run.
- Direct review: filtered historical accepted/dismissed suggestions to offered-only actions, hid policy controls on dashboard loading/error, and disabled stale track ask buttons after a failed decision refresh. No blocking scoped finding remains.

## TSK-010 and PHS-05 review

- TDD RED: setup lacked observed connector readiness and a recoverable agent-settings path; the connector UI, explicit refresh actions, and discussion region were absent. Later focused regressions caught late credential-reference hydration, failed-versus-empty GitLab reads, and an initially open setup view with no ready-state exit.
- GREEN: setup shows the three concerns from Jira successful-read status, a live code-host connection read, and agent health. Continue becomes available only after all three are observed. The Connections dialog reports each connector and sync independently; Jira refresh calls the read-only import coordinator, and GitLab refresh calls the discussion read coordinator. Remediation displays canonical ask access, capability blocks, and separate admitted/fix/push/pipeline/resolution milestones. Only observed GitLab resolution says the thread is resolved.
- Setup matrix: loading and unconfigured show no completion; partial or failed Jira/connection/agent states retain their distinct reason; a successful Jira read plus verified code-host read plus healthy agent enables local continuation. The server `/api/setup` state is not changed by the client.
- Secret-negative proof: the focused test sends the value once via `POST /api/credentials/keychain`, confirms no GET body contains it, discards unexpected secret-shaped status fields, leaves it out of rendered text and local storage, and clears the password input after submission. Live keychain/provider behavior remains `UNMEASURED` without authorized fixtures.
- Browser evidence: `screenshots/tsk010-setup.png` and `screenshots/tsk010-remediation.png` were captured with local projection-shaped API fixtures and inspected. The latter shows task admission, fix production, push and passing pipeline while thread resolution remains unobserved. These images are fixture evidence, not live GitLab/Jira evidence.
- Proof: 23 focused client tests; 59 client tests across 10 files; 32 targeted server integration tests across Jira, GitLab, credentials and board; client/server typechecks; client production build; and `git diff --check` passed. Live Jira, GitLab, agent and external-write behavior remain `UNMEASURED`.
- Direct PHS-05 review: corrected setup completion exit, agent-settings recovery, stale/error empty discussion wording, and test global cleanup. No blocking scoped finding remains.
