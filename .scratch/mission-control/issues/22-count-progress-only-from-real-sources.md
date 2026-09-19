# 22: Count progress only from real sources

**What to build:**

Every number the console shows about progress traces back to something real. If there is no
source for a number, the console shows it as unknown.

The only allowed sources are: task counts from the plan artifact, check counts from the eval-spec
artifact, files and line counts from the code host diff, and job counts from the pipeline.

The app must never show a percentage, never show zero to mean unknown, and never use anything an
agent said about how done it is.

**Blocked by:**

- 17 (Read and preview an authored artifact)
- 21 (Connect a phase to real agent tasks)

**Status:** ready-for-agent

## Acceptance criteria

- [x] A count with a real source is displayed as completed-of-total.
- [x] A count with no source is displayed as unknown.
- [x] No percentage appears anywhere in the console.
- [x] A missing count never displays as zero.
- [x] A work item with no plan, no eval-spec and no diff shows unknown for every count.
- [x] Nothing an agent reports about its own progress is used as a count.
