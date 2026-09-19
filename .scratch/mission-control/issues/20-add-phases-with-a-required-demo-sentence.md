# 20: Add phases with a required demo sentence

**What to build:**

Add the phase model. A phase only exists inside the implementation stage. Every phase must carry a
demo sentence saying what you would show someone at the end of it. A phase without one is not a
phase, and the app must refuse to create it.

A phase has: a number, a name, a state, a demo sentence, and a list of task ids (empty for now).

**Blocked by:**

- 04 (Add work item, track and stage types to contracts)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Contracts exports a phase type that requires a demo sentence.
- [x] Creating a phase with no demo sentence is rejected with a clear error.
- [x] Creating a phase with an empty or whitespace-only demo sentence is rejected.
- [x] Phases can only be added to the implementation stage; adding one elsewhere is rejected.
- [x] Phases are saved and survive a restart.
- [x] The console shows each phase's demo sentence next to its name.
