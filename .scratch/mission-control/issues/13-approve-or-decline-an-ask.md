# 13: Approve or decline an ask

**What to build:**

The user clicks approve or decline on an ask. Approving lets the waiting action go ahead.
Declining stops it. Either way the decision is written to the audit record and the ask leaves the
list.

Approving must create an approval bound to the exact action and context that was proposed, using the
existing action-bound approval type. Do not create a general permission.

**Blocked by:**

- 12 (Show the asks waiting on the operator)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Approving an ask allows exactly the action that was proposed, and no other.
- [x] Approving an ask with different context than the one proposed does not allow the action.
- [x] Declining an ask stops the action.
- [x] Both approving and declining write an audit entry naming the ask, the decision and the time.
- [x] A decided ask no longer appears in the pending list.
- [x] Deciding an ask that was already decided is rejected with a clear error.
