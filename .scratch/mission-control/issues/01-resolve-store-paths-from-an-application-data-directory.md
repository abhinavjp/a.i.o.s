# 01: Resolve store paths from an application data directory

**What to build:**

Adhisthana keeps its state in a per-user application data directory instead of the folder the
command was run from. A user who starts it from anywhere gets the same data back.

Today the stores default to `.data` inside the current working directory. That only works inside a
checkout, so an installed copy would lose its data the moment the user changed folders.

Add one helper that returns the data directory, in this order of preference:
1. the value of an environment variable named `AIOS_DATA_DIR`, if it is set and not empty;
2. otherwise the OS convention (`%APPDATA%\adhisthana` on Windows, `~/.local/share/adhisthana`
   elsewhere).

Use that helper wherever the stores currently build a default path. Do not change the option that
lets a caller pass a store in directly, because the tests rely on it.

**Blocked by:**

None (can start immediately)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Starting the server from two different folders reads and writes the same state.
- [x] Setting `AIOS_DATA_DIR` makes the server use that folder.
- [x] Tests that inject their own store still work with no changes to those tests.
- [x] The data directory is created if it does not exist.
- [x] No file is written into the current working directory any more.
