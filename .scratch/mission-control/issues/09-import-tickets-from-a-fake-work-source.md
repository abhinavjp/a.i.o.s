# 09: Import tickets from a fake work source

**What to build:**

The user clicks a button and tickets from the connected work source appear as work items that
need a track. This proves the whole import path without any credentials.

Write a fake work source that returns a small fixed set of tickets. Each ticket has a key, a title,
a type, a status and a description.

Add an endpoint that imports from the selected work source. Each imported ticket becomes a work item
whose work source key is the ticket key. Importing twice must not create duplicates: a ticket whose
key already exists as a work item is skipped.

**Blocked by:**

- 05 (List and create work items end to end)
- 08 (Connector module with a null fallback)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Importing with the fake work source creates one work item per ticket.
- [x] Each imported work item carries the ticket key as its work source key.
- [x] Importing a second time creates no duplicates and reports how many were skipped.
- [x] Imported work items have no track and show as unrouted.
- [x] Importing with the null work source creates nothing and does not error.
- [x] The console has a button that runs the import and refreshes the list.
