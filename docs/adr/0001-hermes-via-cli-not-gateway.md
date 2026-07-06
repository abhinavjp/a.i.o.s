# ADR-0001: HermesAgent integrates via the `hermes` CLI, not a Gateway HTTP endpoint

Status: Accepted
Date: 2026-06-30

## Context

The PRD/BUILD_PROMPT specify `HermesAgent` integrating over "Hermes Gateway (HTTP) as the
primary boundary, with the `hermes` CLI as fallback." That framing assumed a local HTTP
endpoint that drives the agent.

Research into the actual product (NousResearch Hermes Agent) and the operator's confirmation
of the install on this machine establish:

- Hermes's "Gateway" is **opt-in, per-tool routing of *tool calls* through Nous's hosted
  Portal** (credentialed egress). It is **not** a local REST API for running tasks.
- The real headless surface is the **`hermes` CLI**:
  - `hermes -z "<prompt>"` — clean one-shot (final answer only on stdout)
  - `hermes chat -q "..."` — one-shot including tool transcript
  - `hermes logs -f --session <id>` — live tail (our streaming source)
  - `--resume/-r`, `--continue/-c`, `--pass-session-id` — session persistence
  - `--json` on `send`, `kanban list`, etc.
  - **read paths** (for memory/skills viewers): `hermes memory list|search|export`,
    `hermes skills list|info`. Hermes layers = `MEMORY.md` (env/conventions), `USER.md`
    (operator profile), memory index; prompt tiers stable/context/volatile.
- This machine exposes the CLI, not a driving Gateway.

## Decision

For v1, the **`hermes` CLI is the primary integration boundary** for `HermesAgent`.
The Gateway/Portal HTTP path is optional and deferred to post-v1.

- `runTask(task, session_key)` shells `hermes -z`/`send` and streams output by tailing
  `hermes logs -f --session <id>`, surfaced to the client over SSE.
- `session_key` (stable hash of operator + project) maps to a Hermes session via `--resume`.
- The ADR-0001 (architecture) boundary law is **unchanged**: `HermesAgent` MUST NOT import
  Hermes Python internals or read `~/.hermes/state.db` / `kanban.db` directly. CLI surface only.

## Consequences

- Slice 1 ("confirm Hermes Gateway endpoint") resolves to: confirm the `hermes` CLI is on PATH
  and `hermes -z` runs; no HTTP endpoint expected.
- Streaming is line/log-tail based, not a native token stream — acceptable for v1; revisit if
  Hermes ships a local run server.
- If/when a real local Gateway exists, it becomes an *additional* strategy behind the same
  Agent Abstraction with no caller change (the whole point of the abstraction).
- This does not privilege Hermes: it remains the default strategy, swappable for a
  fake/custom agent with zero caller changes.
