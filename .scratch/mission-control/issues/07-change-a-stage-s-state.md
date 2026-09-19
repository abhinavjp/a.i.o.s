# 07: Change a stage's state

**What to build:**

The user can see and change what state each stage of a work item is in, so the pipeline reflects
what is actually happening.

Add an endpoint that sets a named stage of a work item to a given state. Show each stage and its
state in the console.

Allowed states are the ones defined in ticket 04. Any other value is rejected.

**Blocked by:**

- 06 (Approve a track for a work item)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Setting a stage's state changes it and the change survives a restart.
- [x] Setting a stage that is not in the work item's track is rejected with a clear error.
- [x] Setting a state that is not one of the allowed values is rejected with a clear error.
- [x] The console shows every stage of a work item with its current state.
- [x] Changing a state in the console updates the display without a page reload.
