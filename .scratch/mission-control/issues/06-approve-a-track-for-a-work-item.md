# 06: Approve a track for a work item

**What to build:**

A work item with no track shows as needing a track. The user picks one of four named starting
points and approves it. The work item then carries that track and stops showing as unrouted.

The four starting points are fixed lists of stage kinds:
- full: functional-analysis, technical-analysis, spec-and-eval, plan, implementation, final-review, merge
- standard: technical-analysis, spec-and-eval, plan, implementation, final-review, merge
- fast: plan, implementation, merge
- analysis-only: functional-analysis, technical-analysis

Important: these are only starting points. Once approved, the track is stored as a plain ordered
list of stage kinds on the work item. Do not store the preset name as the track.

When a track is approved, create the stages for it, all in the not-started state.

**Blocked by:**

- 05 (List and create work items end to end)

**Status:** ready-for-agent

## Acceptance criteria

- [x] A work item with no track is reported as unrouted.
- [x] Approving a track stores it as a plain ordered list of stage kinds, not a preset name.
- [x] Approving a track creates one stage per stage kind, all not-started.
- [x] An approved work item no longer appears as unrouted.
- [x] Approving a track on a work item that already has one is rejected with a clear error.
- [x] The console lets the user pick a starting point and approve it, and the stages then appear.
