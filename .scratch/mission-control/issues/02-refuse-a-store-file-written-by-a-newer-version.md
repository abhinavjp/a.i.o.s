# 02: Refuse a store file written by a newer version

**What to build:**

Every state file Adhisthana writes carries a schema version number. When the app opens a file
whose version is higher than the version it understands, it refuses to open it and says so clearly,
instead of guessing at the contents and corrupting them.

This protects a user who installs an older version after a newer one.

**Blocked by:**

- 01 (Resolve store paths from an application data directory)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Every state file written contains a numeric schema version field.
- [x] Opening a file with a schema version higher than the running app supports fails with a clear message naming both versions.
- [x] The refused file is left completely unchanged on disk.
- [x] Opening a file with the current schema version works exactly as before.
- [x] A file with no schema version field is treated as version 1.
