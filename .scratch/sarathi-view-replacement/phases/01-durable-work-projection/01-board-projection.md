# TSK-001 — Durable source observations and board projection

- **Outcome:** existing and new work items open losslessly and a typed Mission Control read projection returns canonical work, tracks/stages, progress, artifacts, merge-request summaries and explicit availability state.
- **References:** CON-001, CON-002; REQ-005, REQ-009, REQ-012; INV-01, INV-04, INV-07; RSK-001.
- **Blocked by:** none after Implementation gate.
- **Write scope:** `contracts/src/index.ts`; `app/server/src/WorkItemStore.ts`; new `app/server/src/mission-control/**`; `app/server/src/app.ts`; relevant server/store tests; approved Forge artifact tree for first provenance commit.
- **Read/reference context:** current `WorkItem`, `FileWorkItemStore`, artifact/phase/task stores, code-host reads, dashboard snapshot and `buildApp` injection seams.
- **Frozen decisions:** add source-observation metadata through an additive schema migration; manual work remains source-neutral; read projection composes canonical stores and reports per-region unavailable/error state rather than caching invented success.
- **Ordered changes:** write failing migration/projection tests; extend shared observable types; add lossless store migration and idempotent source upsert/observation methods; add projection assembler/read route; compose injected stores; make tests pass; refactor only inside scope.
- **Preserve:** work IDs, approved tracks/stages, ticket-44 conflict behavior, artifacts/phases/tasks, existing endpoints and caller-injected stores.
- **Must not change:** permissions, routing, connector writes, protected dirty files, `RoutingPage.tsx`.
- **Narrow proof:** targeted work-item/store/projection route tests; `npx tsc -p contracts/tsconfig.json --noEmit`; `npx tsc -p app/server/tsconfig.json --noEmit`; migration fixture opens and round-trips with no field loss.
- **Manual/live proof:** none required; store contract is deterministic.
- **Handoff evidence:** changed paths, legacy/current fixtures, projection response assertions, checks, review findings, commit and verified remote SHA. Live providers remain out of scope.
