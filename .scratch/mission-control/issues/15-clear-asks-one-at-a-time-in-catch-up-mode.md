# 15: Clear asks one at a time in catch-up mode

**What to build:**

The user presses a key and enters a focused mode showing one ask at a time, with its details and
approve or decline buttons. Deciding moves to the next one. A progress counter shows how many are
left. When none are left, the mode closes.

The whole mode works from the keyboard: one key to approve, one to decline, one to skip to the next,
and escape to leave.

**Blocked by:**

- 14 (Rank the asks)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Entering catch-up shows the highest-ranked ask first.
- [x] Deciding an ask moves straight to the next one.
- [x] A counter shows how many asks remain.
- [x] Skipping moves to the next ask and leaves the skipped one pending.
- [x] Escape leaves the mode and any undecided asks remain pending.
- [x] Deciding the last ask closes the mode.
- [x] Approve, decline, skip and leave all work from the keyboard alone.
