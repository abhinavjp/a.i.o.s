# 23: Add the floor of decisions that can never be automated

**What to build:**

Some decisions must always ask the user, no matter how the app is configured. These are the floor.
Nothing can remove them.

The floor is: pushing to a shared repository, transitioning or closing a work source ticket, applying
an update, and anything irreversible outside an Adhisthana branch.

Build the floor as permanent permission rules that no rule-writing path can overwrite or delete. Any
attempt to change them is rejected.

**Blocked by:**

- 11 (Define ask tool intents)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Every floor action requires approval, with the app in its default configuration.
- [x] Trying to add a rule that would allow a floor action is rejected with a clear error.
- [x] Trying to delete or edit a floor rule is rejected with a clear error.
- [x] Floor rules are present on a fresh install with no configuration.
- [x] A test proves each floor action still asks.
