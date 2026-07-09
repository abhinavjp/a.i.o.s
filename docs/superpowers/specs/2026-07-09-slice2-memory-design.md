# Slice 2 Design — Agent memory + learning loop

Status: Approved (2026-07-09)
Supersedes: parts of ADR-0001 (see "ADR-0001 correction" below)

## Scope

Slice 2 per `BUILD_PROMPT.md`: with `HermesAgent` active, a full Hermes session runs (its
learning loop must fire). Add a `memory/` module (`MemoryManager`/`Configurator`/`Abstraction`,
`PassthroughMemory` default, `RagMemory` stubbed, plus a fallback). `session_key` = stable hash
of (operator + project); one persistent session per key.

**Done when:** two calls sharing a `session_key` show accumulated memory; a provider swap
(passthrough ↔ stub) needs zero caller changes.

**Out of scope for this slice:** any UI wiring for memory content (that's Slice 3 — this slice
only needs `PassthroughMemory` proven correct via tests + a manual CLI-level check).

## Background: two problems, previously conflated

1. **How does `HermesAgent` make two calls with the same `session_key` share one Hermes
   conversation?** ADR-0001 assumed `--resume <our-session_key>` would make Hermes adopt our
   string as its session id. Verified live (previous session's spike) that this is false —
   Hermes always assigns its own auto-generated id regardless of what's passed to `--resume`.
2. **How does `PassthroughMemory` read "the agent's layers"?** ADR-0001 named
   `hermes memory list|search|export` as the read paths. Verified live in this session that
   these subcommands don't exist — `hermes memory` only has `setup|status|off|reset`, which
   report provider *configuration*, not memory *content*.

Both are corrected below, based on live spikes against the installed Hermes (v0.17.0).

## Part 1 — session_key → Hermes session mapping

### Live-verified mechanism

- `hermes --resume <id-or-title>` accepts either a session id **or a session title**, and
  genuinely restores conversational memory (not just cosmetic id resolution).
- Spike: ran `hermes -z "reply with exactly: mapspike1" --pass-session-id` (fresh session, no
  `--resume`) → got session id `20260709_215111_73822b` from `hermes sessions list`. Renamed it
  (`hermes sessions rename 20260709_215111_73822b aios-test-mapping-001`). Then ran
  `hermes --resume "aios-test-mapping-001" -z "What word did I ask you to reply with earlier?"`
  → Hermes answered `mapspike1`, confirming real recall, not coincidence.
- A fresh `hermes -z` call never prints its assigned session id to stdout or stderr (spiked and
  confirmed empty stderr on a clean run) — the id must be discovered after the fact via
  `hermes sessions list`.

### Flow

`HermesAgent.runTask(task, sessionKey)`:

1. Ask `HermesSessionStore` for a Hermes session id mapped to `sessionKey`.
2. **Mapping exists** → `hermes --resume <id> -z <task> --pass-session-id`.
3. **No mapping (cold start)** — executed inside an in-process async mutex owned by
   `HermesSessionStore` so only one cold-start runs at a time process-wide (removes the race
   where two different `sessionKey`s cold-starting near-simultaneously could both list the
   same "newest session" and one would silently adopt the wrong id):
   1. `hermes -z <task> --pass-session-id` (no `--resume` — creates a new session).
   2. `hermes sessions list --source cli --limit 1` → take the newest session id.
   3. `hermes sessions rename <id> <sessionKey>` — best-effort. On failure, log a warning and
      continue; this is a human-legibility/recovery aid (so `hermes sessions list` and
      `hermes sessions browse` are inspectable, and the mapping is recoverable by title if the
      JSON file is ever lost), not load-bearing for correctness.
   4. Persist `{ [sessionKey]: id }` into the mapping file.
4. Streaming behavior (`tailLogs` against `hermes logs -f --component agent`) is unchanged.
5. Mappings persist across process restarts (chosen over in-memory-only) in a flat JSON file at
   `agents/.data/hermes-sessions.json` (gitignored — machine-local Hermes session ids, not
   something to version-control or share).

### Interface changes

`agents/src/strategies/hermes/ProcessRunner.ts` gains:

```ts
export interface ProcessRunner {
  runOneShot(task: string, resumeSessionId?: string): Promise<string>;
  checkVersion(): Promise<boolean>;
  tailLogs(onLine: (line: string) => void): { stop(): void };
  findNewestSessionId(source: string): Promise<string | null>;
  renameSession(sessionId: string, title: string): Promise<boolean>; // best-effort; false on failure, never throws
}
```

New collaborator `agents/src/strategies/hermes/HermesSessionStore.ts`:

```ts
export class HermesSessionStore {
  constructor(private readonly filePath: string, private readonly runner: ProcessRunner) {}

  /** Resolves the Hermes session id for sessionKey, creating+persisting one via the
   *  cold-start flow (mutex-guarded) if none exists yet. */
  async resolve(sessionKey: string, task: string): Promise<{ hermesSessionId: string; result: string }>;
}
```

(Exact method split between `HermesSessionStore` and `HermesAgent` is an implementation
decision for the plan — the contract above is the boundary that must hold: `HermesAgent` never
touches the JSON file or the mutex directly, `HermesSessionStore` never talks to `child_process`
directly.)

## Part 2 — `memory/` module

### ADR-0001 correction

ADR-0001 states the read paths for a memory/skills viewer are `hermes memory list|search|export`
and `hermes skills list|info`. Verified live:

- `hermes memory` subcommands are only `{setup, status, off, reset}` — no read/export of actual
  content, only provider configuration.
- `hermes skills list` **does** exist and work as described.
- Actual memory content lives on disk under `$HERMES_HOME/memories/` (env var; confirmed via
  `hermes doctor`, e.g. `D:\Projects\hermes-agent\home\memories\` on this machine) as a set of
  markdown files: `MEMORY.md`, `USER.md`, and other topic files the agent has written
  (`brain-codebase.md`, etc., seen live). No CLI command surfaces this content.

ADR-0001 will be amended (a "Correction" section appended, not rewritten) to reflect this before
Slice 2 is implemented, since `PassthroughMemory` depends on the corrected read path.

### Decision: read files directly, not CLI-only

Given no CLI path exists for memory content, `PassthroughMemory` reads
`$HERMES_HOME/memories/*.md` directly off disk (falling back to `~/.hermes` if the env var is
unset, mirroring Hermes's own default). This is a deliberate, scoped exception to "CLI surface
only" — that rule (ADR-0001) named `state.db`/`kanban.db` specifically (private SQLite
internals); these are plain markdown layers with no CLI export alternative.

### Structure

New workspace package `memory/`, added to `package.json` `workspaces`, mirroring `agents/`'s
shape.

`contracts/src/index.ts` additions:

```ts
export interface MemoryLayer {
  name: string;   // filename without extension, e.g. "MEMORY", "USER", "brain-codebase"
  path: string;   // absolute path read from
  content: string;
}

export interface MemoryAbstraction {
  getLayers(): Promise<MemoryLayer[]>;
}
```

- **`PassthroughMemory`** (default): resolves `process.env.HERMES_HOME || path.join(os.homedir(), ".hermes")`,
  reads every top-level `*.md` file in `<home>/memories/` (skips `*.lock` files and
  subdirectories like `memories/user/`), returns one `MemoryLayer` per file. No independent
  store — pure read-through, re-reads from disk on every call.
- **`RagMemory`** (stub): registered, satisfies `MemoryAbstraction`, returns `[]`. Not an error
  — just not implemented yet; selecting it must not crash the app.
- **`NullMemory`** (mandatory fallback): returns `[]`.
- **`MemoryManager`**/**`MemoryConfigurator`**: same registry/selection shape as
  `AgentManager`/`AgentConfigurator`. No health-gated construction-time fallback (unlike
  `AgentManager`) — file-read failures are handled per-call (empty layers on error), not at
  startup, since there's no meaningful "is memory healthy" check analogous to Hermes CLI health.

### Explicitly not in this slice

- No BFF endpoint, no UI rendering of layers (Slice 3).
- No caching/invalidation strategy for `PassthroughMemory` (re-reads disk each call — fine at
  this file count/size).

## Testing

- `HermesSessionStore`: unit tests against `FakeProcessRunner` — cold-start path (create →
  discover → rename → persist), resume path (mapping hit), concurrent cold-starts for two
  different `sessionKey`s never cross-assign (mutex proof), rename failure is non-fatal.
- `HermesAgent.runTask`: existing tests extended to cover both branches via the store.
- `PassthroughMemory`: unit tests against a temp directory standing in for `$HERMES_HOME`
  (missing dir → `[]`, mixed `.md`/`.lock`/subdirectory contents → correct filtering).
- `RagMemory`/`NullMemory`: trivial — assert `[]`.
- **Live verification** (final pass, not just unit tests, per established working pattern): two
  real `hermes` calls sharing a `sessionKey` through the full `AgentManager` → `HermesAgent`
  chain show accumulated memory; swapping the memory `Configurator`'s selected kind between
  `passthrough` and `rag` requires zero caller changes.

## Open items carried forward (not blocking this slice)

- ADR-0003's `hermes send --json` token-usage claim is still unresolved (separate, pre-existing
  issue — not touched by this design).
