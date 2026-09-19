# 17: Read and preview an authored artifact

**What to build:**

The user clicks an artifact on a stage and reads its contents in a panel without leaving the
console.

The content is fetched through the code host using the artifact's branch and file path. It is never
stored by Adhisthana.

If the branch is gone or the file cannot be read, the panel says the artifact is unavailable. It
must never show old or cached content.

**Blocked by:**

- 10 (Show merge requests and pipelines from a fake code host)
- 16 (Add artifact types and an artifact store)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Clicking an authored artifact shows its content fetched from the code host.
- [x] The artifact's version and approval state are shown next to its name.
- [x] An artifact whose branch no longer exists shows as unavailable.
- [x] An unavailable artifact never displays previously fetched content.
- [x] With the null code host selected, artifacts show as unavailable and nothing errors.
