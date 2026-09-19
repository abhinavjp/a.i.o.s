# 21: Connect a phase to real agent tasks

**What to build:**

A phase holds the actual agent runs that make it up. Opening a phase shows each task, which agent
ran it, and whether it finished.

Do not create a new task type. Use the existing task from contracts, the one with a resolved
execution plan and attempts, exactly as the task store already holds it. A phase stores task ids and
looks them up.

**Blocked by:**

- 20 (Add phases with a required demo sentence)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Adding a task to a phase stores its id, not a copy of the task.
- [x] Opening a phase shows each task's name, agent and status, read from the existing task store.
- [x] A phase with no tasks shows an empty state.
- [x] Adding an id for a task that does not exist is rejected with a clear error.
- [x] No new task type is introduced anywhere.
