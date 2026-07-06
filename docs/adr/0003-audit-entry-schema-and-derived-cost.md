# ADR-0003: Audit entry schema; cost is a derived estimate, not a Hermes output

Status: Accepted
Date: 2026-06-30

## Context

Slice 4 requires every agent invocation to record cost, model, duration, and outcome. But the
active agent (Hermes) runs as a local CLI against whatever provider/model the operator
configured (`--model`/`--provider`) — possibly a local/free model that emits no dollar figure.
"Cost" therefore cannot be assumed to exist as a Hermes output.

## Decision

The append-only audit ledger records, per agent invocation:

- `session_key`, `task`, `model`, `provider`
- `tokens_in`, `tokens_out` (from `hermes send --json` usage when available)
- `duration_ms`, `outcome` (ok | error | fallback)
- `skills_touched` (from `hermes skills`/run metadata)
- `cost_estimate` — **derived** = tokens × a static price table keyed by `model`;
  `0`/`n/a` when the model is local or unpriced. Marked `estimated: true`.

What is always real and shown in the UI: model, tokens, duration, outcome. Dollar cost is a
**derived column**, shown when derivable.

## Consequences

- The audit ledger stays always-on and complete without depending on Hermes emitting dollars.
- Switching to a priced provider later makes `cost_estimate` meaningful with no schema change.
- The price table is config, not code — updating prices is not a code change.
- The audit module remains entirely separate from logging (ADR per BUILD_PROMPT); this schema
  lives only in `audit/`.
