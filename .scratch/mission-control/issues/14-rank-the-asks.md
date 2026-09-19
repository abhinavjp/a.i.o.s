# 14: Rank the asks

**What to build:**

The asks list is ordered so the most important decision is always at the top, without the user
having to sort it.

Sort by kind first, in this exact order: recovery, code review, track change, approval, question.
For asks of the same kind, put the one that has waited longest first.

**Blocked by:**

- 13 (Approve or decline an ask)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Asks are returned in the specified kind order.
- [x] Within one kind, the ask that has waited longest comes first.
- [x] The order is the same on the server and in the console; the console does not re-sort.
- [x] A list with one ask and a list with no asks both work.
