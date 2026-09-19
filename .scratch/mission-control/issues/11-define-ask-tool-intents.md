# 11: Define ask tool intents

**What to build:**

Register the delivery-pipeline actions as named tool operations in the existing Sarathi tool
surface, so that every one of them flows through the existing permission engine. This is what makes
one decision engine possible.

Register these operations: approve an artifact, accept a phase, change a track, and transition a
work source ticket.

This ticket only registers them and makes the permission engine aware of them. Nothing calls them
yet.

Remember: the permission engine already refuses any operation that was never defined. Do not weaken
that.

**Blocked by:**

- 04 (Add work item, track and stage types to contracts)

**Status:** ready-for-agent

## Acceptance criteria

- [x] The four operations are registered in the tool surface.
- [x] Asking the permission engine about a registered operation returns a real decision, not a refusal for being undefined.
- [x] Asking about an operation that was not registered is still refused for being undefined.
- [x] No new decision system is added; everything goes through the existing permission engine.
- [x] All existing permission tests still pass.
