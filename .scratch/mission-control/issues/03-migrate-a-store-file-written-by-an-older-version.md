# 03: Migrate a store file written by an older version

**What to build:**

When the app opens a state file written by an older version, it upgrades the contents to the
current shape automatically, then carries on. The user notices nothing.

Build a small runner that holds an ordered list of migration steps. Each step takes the document at
version N and returns it at version N+1. The runner applies every step needed to reach the current
version, then saves the result.

There are no real migrations to write yet. Ship the runner with an empty list and a test that proves
it works using a fake step.

**Blocked by:**

- 02 (Refuse a store file written by a newer version)

**Status:** ready-for-agent

## Acceptance criteria

- [x] A file at an older version is upgraded to the current version when opened.
- [x] Migration steps run in order, one version at a time, with none skipped.
- [x] The upgraded file is saved back with the new schema version.
- [x] If a migration step throws, the original file is left unchanged and the error is reported.
- [x] A file already at the current version is not modified.
