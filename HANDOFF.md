# Handoff — Adhiṣṭhāna, start of build

Planning/grill is done. Architecture is settled in the ADRs. Build **Slice 0 first**, TDD,
one slice at a time; stop and show the diff after each slice. Keep prompts/payloads minimal
(ADR-0005).

## Read first (in order)
1. `CONTEXT.md` — canonical vocabulary (name, roles, verdicts, scope).
2. `docs/adr/0001..0005` — the non-negotiable decisions. Do not redesign them.
3. Source-of-truth specs: `PRD.md` and `BUILD_PROMPT.md`
   (currently in `C:\Users\abhin\Downloads\files\` — copy them into the repo root).

## Decisions already made (don't re-litigate)
- Name **Adhiṣṭhāna**; repo dir `a.i.o.s`.
- Hermes integration = `hermes` CLI only, never `state.db` (ADR-0001).
- Single operator, auto-login, RBAC seam real, no SSO. Single project: `session_key = hash(operatorId,"default")`.
- Change-control: governance real, deploy modeled (ADR-0002).
- Audit: derived cost (ADR-0003). UISpec: registry-only, no eval (ADR-0004). Token efficiency enforced (ADR-0005).
- Tests use `FakeAgent`; `NullAgent` is the production fallback.

## Slice 0 — walking skeleton (do this first)
Monorepo (package-by-module): `contracts/` + `app/` + `agents/`, wired
UI → BFF → `AgentManager` → `FakeAgent` (selected by `AgentConfigurator`, `NullAgent` fallback).
UI renders an agent list + health.
- **Done when:** the UI shows an agent sourced from a `FakeAgent` through the full
  Manager/Configurator/Abstraction chain. Tests first, all green.

## Before Slice 1
Confirm on this box: `hermes -z "ping"` runs and returns clean stdout. If not, keep building
against `FakeAgent`/`CustomAgent` and wire `HermesAgent` once the CLI is confirmed.

## Deferred / flagged
- Real design pass (token system + signature element = the compounding loop made visible)
  before Slice 6 UI.
