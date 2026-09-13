# Hermes as a selectable Sarathi agent engine

Date: 2026-09-09. Sources are official Nous Research documentation/repository and this repository's local source. The installed Hermes executable was also probed; no authenticated model task was run and no configuration was changed.

## Decision summary

Hermes, Codex CLI, and Claude Code should be peer **agent engines** selectable by Sarathi. Hermes is not a mandatory orchestrator around the other two. Sarathi owns global, specialist, and task routing; the chosen engine may then use its own native orchestration features.

Precedence for each newly admitted task should be:

`task override > specialist override > global default`

Persist the global and specialist choices locally. Resolve and store an immutable engine choice when a task is admitted, so configuration changes do not alter running tasks. This is consistent with the repository's existing multi-runtime direction, but terminology should change from treating Hermes as the default special case to treating all three as peer engines.

## What Hermes is

Hermes Agent is Nous Research's open-source, self-hostable agent harness. It supplies its own model/tool loop, terminal and messaging surfaces, sessions, memory, skills, MCP support, scheduled work, and delegation. It can use multiple model providers or custom endpoints; selecting Hermes therefore selects the **Hermes harness**, not one fixed model or provider. [Official repository README](https://github.com/NousResearch/hermes-agent#hermes-agent-)

The core `AIAgent` loop is shared by its CLI, gateway, ACP, batch, API, and library entry points. That loop handles model calls, tools, retries/fallback, context compression, interrupts, and persistence. [Official architecture](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/developer-guide/architecture.md)

## Execution, configuration, and sessions

- Interactive use is `hermes`/`hermes chat`; the CLI also supports query mode, profiles, working directories/worktrees, continue/resume, checkpoints, dashboard, Kanban, and other management commands. [Official CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands)
- Non-secret settings live in `$HERMES_HOME/config.yaml` (normally `~/.hermes/config.yaml`); secrets live separately. `hermes config`, the setup flow, model picker, and dashboard manage configuration. Profiles are isolated Hermes homes with separate provider/model configuration, credentials, personality, memory, skills, sessions, cron jobs, and databases. [Official configuration](https://hermes-agent.nousresearch.com/docs/user-guide/configuration) [Official profiles](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/profiles.md)
- Every conversation is stored as a session. CLI sessions are persisted in `~/.hermes/state.db`, including message/tool history and lineage, and can be resumed by ID, title, or latest via `--resume`/`--continue`. [Official sessions](https://hermes-agent.nousresearch.com/docs/user-guide/sessions)

Hermes' internal provider/model configuration is below Sarathi's engine choice. Sarathi choosing `hermes` should point to an explicit Hermes profile or isolated home; it should not silently inherit whichever interactive Hermes profile happens to be active.

## Hermes orchestration capabilities

Hermes has three distinct concepts:

1. **Profiles** are persistent, isolated Hermes identities/configurations.
2. **`delegate_task`** is ephemeral fork/join delegation. Children get isolated conversations and terminals; only their final summaries return to the parent. Parallelism defaults to three. Nested delegation is opt-in and depth-limited by configuration. It is tied to the parent process/session, not a durable workflow record. [Official delegation](https://hermes-agent.nousresearch.com/docs/user-guide/features/delegation)
3. **Kanban** is durable multi-agent orchestration: a SQLite-backed task queue/state machine across named profiles and worker processes, with dependencies, comments/unblocking, restart recovery, and swarm-created DAGs. [Official Kanban](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/kanban.md)

These are capabilities of the Hermes engine. Sarathi must still own cross-engine task admission, routing precedence, durable task identity, permissions, approvals, audit, cancellation, and fallback. Otherwise selecting Codex or Claude would bypass governance or require Hermes to remain in the execution path.

## Difference from Codex CLI and Claude Code

| Concern | Hermes | Codex CLI | Claude Code |
|---|---|---|---|
| What Sarathi selects | Hermes agent harness | OpenAI coding-agent CLI | Anthropic coding-agent CLI |
| Model/provider scope | Multi-provider/custom endpoint | Codex/OpenAI route | Claude/Anthropic route |
| Native persistent specialist identity | Hermes profiles | Sarathi must supply scoped config/instructions | Custom agents at user/project scope |
| Native orchestration | Ephemeral delegation plus durable Kanban | Agent/subagent behavior is engine-native but not Sarathi's durable coordinator | Subagents; agent teams are separate-session coordination |
| Session continuity | SQLite sessions; resume by ID/title/latest | Resume must use the provider-issued Codex session/thread identity | Local sessions; resume must use Claude's session identity |
| Sarathi responsibility | Same for all engines: resolve route, persist identity, govern tools, normalize events/outcomes, audit, cancel, and fall back | Same | Same |

Codex officially provides a noninteractive execution surface suitable for adapters and saved-auth execution; Claude Code officially provides programmatic/headless execution and resumable local sessions. Their native subagent facilities remain internal engine behavior, just as Hermes delegation does. [OpenAI Codex noninteractive mode](https://learn.chatgpt.com/docs/non-interactive-mode) [Claude Code programmatic execution](https://code.claude.com/docs/en/headless) [Claude Code subagents](https://code.claude.com/docs/en/sub-agents)

## Current repository reality

The application does not yet implement this selection:

- `app/server/src/index.ts` registers only `HermesAgent` and constructs `AgentManager` with hard-coded default `"hermes"`.
- `AgentManager` resolves exactly one active agent at process startup.
- `HermesAgent.runTask()` shells `hermes -z <task> --pass-session-id`, but ignores Sarathi's `sessionKey`.
- Its log tail filters only by component, not an attributable run/session.
- `asOrchestrator()` returns only `{ kind: "hermes-kanban" }`; it does not implement delegation or Kanban.
- The UI offers only Fake and Hermes when creating a specialist; it has no global routing page or task override.

The installed command resolves to `D:\Projects\hermes-agent\runtime\venv\Scripts\hermes.exe`, but every probe (`--version`, `--help`, `sessions --help`, `config --help`) currently fails before Python starts. Therefore Hermes is **installed but unavailable/unmeasured**, not ready. Codex and Claude readiness also require fresh authenticated adapter probes; executable presence alone is insufficient.

## Required product behavior

- Add a dedicated **Routing** page with global default `Hermes | Codex | Claude Code`.
- Add an optional engine override to each specialist and each new task. `Inherit` displays the effective source and value.
- Resolve `task > specialist > global` once at admission and persist the resolved engine, profile/config reference, session identity, and routing provenance.
- Expose only routes whose executable, authentication, configuration isolation, session resume, event attribution, cancellation, and tool restrictions have been proven. Display others as `UNMEASURED`/unavailable with a reason.
- Keep engine-native orchestration optional. A plain task can run through any engine. If a workflow requests a Hermes-only feature such as Kanban, eligibility must require Hermes rather than silently changing the selected engine.
- Do not import Codex/Claude credentials into Hermes. Hermes' official `import-agent` command imports instructions, permission mappings, MCP configuration, and skills, but explicitly does not import API keys or credentials. [Official CLI reference](https://hermes-agent.nousresearch.com/docs/reference/cli-commands#hermes-import-agent)

## Verification limits

Official documentation establishes upstream capabilities, not operational readiness on this machine. Local static inspection establishes the current adapter/UI limitations. Authenticated execution, provider billing route, session isolation, cancellation, structured events, tool-policy enforcement, fallback, and live orchestration remain **UNMEASURED** for all three engines in Sarathi.
