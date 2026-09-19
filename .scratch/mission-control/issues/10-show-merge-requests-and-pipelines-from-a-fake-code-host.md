# 10: Show merge requests and pipelines from a fake code host

**What to build:**

Opening a work item shows the merge requests connected to it and whether each one's pipeline
passed, failed or is still running.

Write a fake code host returning a small fixed set of merge requests. Each has a repository name, a
number, a title, a branch, a state, a pipeline result and a job count as a completed-of-total pair.

Add an endpoint returning the merge requests for a work item, and show them when a work item is
opened.

**Blocked by:**

- 05 (List and create work items end to end)
- 08 (Connector module with a null fallback)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Opening a work item shows its merge requests with repository, number, state and pipeline result.
- [x] A work item with no merge requests shows an empty state, not an error.
- [x] Job counts display as completed-of-total, exactly as the code host reported them.
- [x] With the null code host selected, the section shows empty and does not error.
- [x] No number on this screen is calculated by the app; every one comes from the code host.
