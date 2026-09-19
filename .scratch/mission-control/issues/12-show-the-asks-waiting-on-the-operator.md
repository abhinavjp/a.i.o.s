# 12: Show the asks waiting on the operator

**What to build:**

The console shows one list of everything waiting on the user. Each row says what kind of decision
it is, which work item it belongs to, and how long it has been waiting.

An ask is simply what it looks like when the permission engine says an action needs approval. Do not
build a second queue with its own rules.

Add a store for pending asks and an endpoint that returns them. When an action needs approval, a
pending ask is recorded with: an id, a kind, the work item it belongs to, the tool intent it is
waiting on, and the time it was created.

**Blocked by:**

- 05 (List and create work items end to end)
- 11 (Define ask tool intents)

**Status:** ready-for-agent

## Acceptance criteria

- [x] An action that needs approval creates exactly one pending ask.
- [x] The endpoint returns every pending ask with kind, work item, and time created.
- [x] The console shows the asks in a single list with a count.
- [x] An empty ask list shows a clear empty state, not an error.
- [x] Pending asks survive a server restart.
- [x] An action that is allowed outright creates no ask.
