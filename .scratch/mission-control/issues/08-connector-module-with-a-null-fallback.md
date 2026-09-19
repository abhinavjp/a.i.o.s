# 08: Connector module with a null fallback

**What to build:**

Create a new `connectors` package that follows exactly the same shape as the existing `agents`
package: an abstraction, a manager that callers use, a configurator that registers implementations
and selects one, and exactly one fallback that is always registered.

Two abstractions live here.

A work source can: list tickets assigned to the user, and read one ticket's detail.

A code host can: list merge requests for a branch, read a pipeline result, and read a file's content
at a branch.

Also write the null implementations. A null work source returns empty lists. A null code host
returns empty lists and reports file content as unavailable. Neither ever throws.

This ticket adds no real Jira or GitLab code.

**Blocked by:**

- 04 (Add work item, track and stage types to contracts)

**Status:** ready-for-agent

## Acceptance criteria

- [x] The connectors package exports a work source abstraction and a code host abstraction.
- [x] The configurator registers exactly one fallback for each abstraction.
- [x] Selecting an implementation that was never registered falls back to the null one and logs that it did.
- [x] The null work source returns empty lists rather than throwing.
- [x] The null code host reports file content as unavailable rather than throwing.
- [x] Module-level tests cover register, select and fall back, matching the existing agent configurator tests.
