# 18: Approve an artifact through the ask queue

**What to build:**

An artifact that is awaiting approval creates an ask. The user approves or sends it back with a
note. Approving marks it approved; sending it back marks it rejected and records the note.

This must use the approve-an-artifact operation registered in ticket 11 and go through the permission
engine like everything else.

**Blocked by:**

- 13 (Approve or decline an ask)
- 17 (Read and preview an authored artifact)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Marking an artifact as awaiting creates exactly one ask.
- [x] Approving that ask sets the artifact's state to approved.
- [x] Sending it back sets the state to rejected and stores the note.
- [x] A rejected artifact can be re-submitted as a new version and creates a new ask.
- [x] Approving is refused if the artifact is not in the awaiting state.
