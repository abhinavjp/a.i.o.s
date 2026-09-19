# 19: Show a derived artifact

**What to build:**

A stage can show artifacts that nobody wrote: a code diff for a phase, and the outcome of a merge.
These are assembled from the code host when asked for, never stored.

Add code host support for reading a branch's diff summary (files changed, lines added, lines removed)
and display the two derived artifact kinds on the relevant stages.

**Blocked by:**

- 17 (Read and preview an authored artifact)

**Status:** ready-for-agent

## Acceptance criteria

- [x] A phase diff artifact shows files changed, lines added and lines removed, all from the code host.
- [x] A merge result artifact shows the per-repository merge outcome from the code host.
- [x] No derived artifact's content is written to the store.
- [x] With the null code host selected, derived artifacts show as unavailable and nothing errors.
- [x] The app calculates none of these numbers itself.
