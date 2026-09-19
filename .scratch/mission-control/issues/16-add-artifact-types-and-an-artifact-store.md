# 16: Add artifact types and an artifact store

**What to build:**

Add the artifact model to contracts and a store for it. Types and storage only; nothing reads
content yet.

An artifact reference has: an id, the work item and stage it belongs to, a name, a version number,
an approval state (one of draft, awaiting, approved, rejected), and a kind that is either authored
or derived.

An authored artifact also carries the branch and file path where its content lives.
A derived artifact also carries which code host view produces it.

Content is never stored here. Only the reference, the version and the approval state.

**Blocked by:**

- 04 (Add work item, track and stage types to contracts)

**Status:** ready-for-agent

## Acceptance criteria

- [x] Contracts exports an artifact reference type with authored and derived variants.
- [x] Authored artifacts carry a branch and file path; derived ones do not.
- [x] No artifact content is written into the store.
- [x] Artifacts are saved per work item and stage and survive a restart.
- [x] Saving a new version of an artifact keeps the earlier versions.
