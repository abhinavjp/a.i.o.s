# 05: List and create work items end to end

**What to build:**

A user opens the console and sees a list of work items. The list is empty at first. Adding a work
item makes it appear in the list, and it is still there after a restart.

This is the first end-to-end slice: a store, two HTTP endpoints, and a screen.

Add a work item store that saves to a file in the application data directory, following exactly the
same pattern as the existing task store (including the option to pass a store in for tests).

Add two endpoints: one that returns all work items, one that creates a work item from a title and a
list of repository names. A newly created work item has a null work source key and no track.

Add a page to the browser console that lists work items and has a form to add one.

**Blocked by:**

- 01 (Resolve store paths from an application data directory)
- 04 (Add work item, track and stage types to contracts)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Asking the server for work items on a fresh install returns an empty list.
- [x] Creating a work item returns it with an id and a created timestamp.
- [x] Creating a work item then asking for the list returns it.
- [x] Created work items survive a server restart.
- [x] The console shows the list and adding one through the form makes it appear.
- [x] Creating a work item with an empty title is rejected with a clear error.
