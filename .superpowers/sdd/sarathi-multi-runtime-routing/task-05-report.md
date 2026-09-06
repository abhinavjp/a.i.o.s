# Task 05 report — Tool permissions and action-bound approvals

## Scope delivered

- Added public permission contracts: named tool definitions, structured tool intents, narrow deny/ask/allow rules, approval lifetimes, action-bound approvals, semantic-classifier seam, and permissioned tool execution results.
- Added `PermissionEngine`, injected through `buildApp()`. Runtimes receive only `executeTool()` and have no direct executor capability. If Sarathi has no configured mediator, the callback deterministically denies the request.
- Enforced precedence: hard deny; scoped ask (with exact matching approval); scoped allow; deterministic safe/read-only; semantic low-risk only for unresolved non-consequential actions; otherwise operator approval.
- Consequential operations/messages never reach the semantic classifier. A classifier failure fails closed to operator approval.
- Added `/api/sarathi/permissions`, `/api/sarathi/permissions/rules`, `/api/sarathi/permissions/approvals`, and `/api/sarathi/tools/execute` at the Fastify boundary.
- Persisted rules and approvals in `FileSarathiStore`; approvals bind all normalized intent context and are invalidated by any context change. `once` approvals consume their single use. Session/project rules require their respective context binding.

## TDD evidence

- RED: hard-deny public-boundary route initially returned 404; implemented routes/engine and observed GREEN.
- RED: session/project rules without their binding context returned 201; validation added and observed GREEN.
- RED: semantic-classifier failure returned 500; fail-closed handling added and observed GREEN.
- RED: runtime had no `executeTool` mediator; contract/registry injection added and observed GREEN.

## Verification

- `npm test -- --reporter=dot app/server/tests/sarathi.route.test.ts` — 22 passing.
- `npm test -- --reporter=dot` — 11 files, 83 passing.
- `npx tsc -p contracts/tsconfig.json --noEmit` — passing.
- `npx tsc -p app/server/tsconfig.json --noEmit` — passing.
- `npm run -w app/client typecheck` — passing.
- `npm run -w app/client build` — passing.
- `git diff --check` — passing.

## Boundaries and unmeasured work

- Fakes prove policy and application mediation only. No runtime-native restrictions, provider entitlement, external write, or live tool proof was attempted; these remain UNMEASURED.
