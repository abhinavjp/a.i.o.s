# ADR-0004: UISpec is pure data; the renderer instantiates registry components only, never evals

Status: Accepted
Date: 2026-06-30

## Context

The agent can reshape the console (Slice 6) by emitting a `UISpec`. The agent is untrusted with
respect to the browser: any path that lets agent output become executable code in the browser is
a permanent, catastrophic hole. "Any path that lets the agent execute code in the browser" is
explicitly out of scope forever.

## Decision

**UISpec is pure data** — a JSON tree of nodes:

```
{ "component": "<registry-key>", "props": { ... }, "children": [ <node>, ... ] }
```

- A **trusted renderer** maps `component` → a fixed React component from the **registry** and
  spreads only **schema-validated props**. It NEVER evaluates agent-authored strings, markup, or
  functions. No `dangerouslySetInnerHTML`, no `eval`/`new Function`, no dynamic `import`, no
  `javascript:`/`data:` URLs, no inline event-handler strings.
- **Validation before render:** every UISpec is validated against a JSON schema + the registry
  BEFORE it reaches React. An unknown `component` key, a prop failing its schema, or any prop
  value that looks like code/markup → the whole spec is **rejected and never rendered**, with a
  logged reason.
- **No inline behavior.** `ActionButton` carries an `actionId` referencing a server-side
  **allowlist**, never code. Layout auto-applies; action-wiring is approval-gated.

### v1 component registry

- Layout: `Stack`, `Grid`, `Panel`
- Display: `Heading`, `Text`, `Badge`, `MetricTile`
- Data: `Table`, `List`
- Agent: `StreamView`, `SkillList`, `MemoryTree`
- Action: `ActionButton` (refs allowlisted `actionId`)

### Performance constraints (part of this boundary)

- Validation is O(nodes); reject specs exceeding a **max node count / max depth** (guards against
  a hostile or runaway spec).
- `StreamView`/`Table`/`List` render **virtualized**; SSE updates are batched, not per-token
  re-renders.
- The renderer memoizes by node identity so a spec update re-renders only changed subtrees.

## Consequences

- Adding a component = adding it to the registry + its prop schema. The renderer never grows an
  eval path to be "more flexible."
- This is workshop-law-adjacent: an agent CR that tries to add an eval path, a raw-HTML
  component, or bypass validation is rejected by change control.
- Tests (Slice 6) MUST prove a UISpec containing a non-registry component OR any code/markup
  string is rejected and never rendered.
