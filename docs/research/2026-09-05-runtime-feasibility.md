# Sarathi runtime and Windows feasibility

Date: 2026-09-05. Discovery evidence, not an approved runtime selection. No models, VPN connection, or external actions were launched. Documentation research and local source/help inspection only.

## Conclusion

### Subsequent operator constraint and research

The user selected existing Claude Code/ChatGPT Codex subscription usage and rejected API billing. Dedicated API-backed SDK deployment is therefore outside the chosen scope. Hermes remains optional, not a separate inference entitlement. No API fallback or credit purchase is authorized. Start-at-login, signed-in operation is selected; sender preference is the user's Teams account if practical.

Codex officially documents that noninteractive execution reuses saved CLI authentication and supports ChatGPT-managed account usage. This establishes a documented subscription-account route, not a measured end-to-end Sarathi integration. [Noninteractive authentication](https://learn.chatgpt.com/docs/non-interactive-mode)

Claude documents native `-p` execution, but `--bare` explicitly skips subscription OAuth and requires API/provider credentials. Consequently the proposed subscription-only adapter cannot simply adopt bare mode for isolation. [Programmatic execution](https://code.claude.com/docs/en/headless) Its authentication policy distinguishes native subscription use from products intermediating subscriber credentials. Do not transplant Claude subscription credentials into Hermes or a custom SDK host; a personal native-CLI wrapper must be evaluated separately, not declared universally supported or forbidden from these pages alone. [Credential policy](https://code.claude.com/docs/en/legal-and-compliance)

Recommended next proof: native CLI login mode, controlled non-API environment, explicit configuration isolation without unsupported auth shortcuts, and a non-sensitive bounded invocation. Verify usage route and behavior on exhaustion. This research has not run that model invocation or changed account configuration. Earlier API-authentication recommendations below are alternatives now excluded by the user's requirement.

The intended local assistant is technically feasible, but no inspected runtime supplies the complete business workflow. Retain a Sarathi-owned durable control layer and adapt a supported agent runtime for bounded analysis. The existing Hermes integration is a prototype seam, not proof of restart continuity, isolated workers, permissions, or safe external actions.

Recommended first comparison: Codex noninteractive execution versus Claude Agent SDK using approved authentication; retain Hermes as a candidate after its actual launch and isolation contracts pass checks. Do not select a provider on subscription assumptions from videos. Local execution and local inference are separate: a local executable can send all context to hosted models.

## Evidence levels

- **LOCALLY VERIFIED:** source inspected or read-only command result observed here.
- **DOCUMENTED:** capability described by fetched official documentation; not exercised end to end.
- **UNMEASURED:** live authentication, provider access, model quality, cost, cancellation/recovery, VPN and protected integration behavior.

## Existing adapter: concrete limitations

LOCALLY VERIFIED in `agents/src/strategies/HermesAgent.ts`, `agents/src/strategies/hermes/RealProcessRunner.ts`, and `app/server/src/TaskRunRegistry.ts`:

1. `runTask` ignores `sessionKey`; mapping to a real runtime session is deferred. Prior ADR-0001's intended mapping is not current implemented continuity.
2. Runner invokes `hermes -z <task> --pass-session-id`; results are unstructured text. No typed review evidence contract or schema validation appears at this boundary.
3. Log tail uses `logs -f --since 1s --component agent`, without a session filter. Concurrent workers can receive unrelated agent logs. Per-task attribution must be proven before concurrent use.
4. The runner inherits the process environment/current directory; it provides no explicit per-agent tool grants, context versions, provider restrictions, credential separation, timeout, or worker cancellation contract.
5. Stopping the log tail does not establish cancellation of the analysis process or its descendants.
6. Health checks test `--version`, which cannot establish provider authentication, tool access, or review readiness. Health initially defaults optimistically until warmed.
7. `asOrchestrator` explicitly declares a stub capability. It does not implement orchestration.
8. Task records exist only in a process-local Map. Registry consumption lacks a caught failure transition, stores unbounded output, and supports one active listener. Durable business checkpoints and recovery are absent here.

These findings justify extending/replacing the adapter contract. They do not establish that Hermes itself lacks the missing features.

## Local executable availability

| Runtime | Observation | Interpretation |
| --- | --- | --- |
| Codex | `codex-cli 0.153.4`; `codex exec --help` succeeds | Installed invocation surface verified; authenticated model execution UNMEASURED |
| Claude Code | `2.1.233 (Claude Code)` from `claude --version` | Executable verified; SDK installation and authenticated execution UNMEASURED |
| Hermes | PATH resolves to `D:\Projects\hermes-agent\runtime\venv\Scripts\hermes.exe`; `--help` fails to create its Python process | Cannot claim operational readiness; failure cause unresolved |

Hermes launcher refers to `C:\Users\abhin\AppData\Roaming\uv\python\cpython-3.11.14-windows-x86_64-none\python.exe`. That path exists. Therefore the observed failure is **not proof of a missing interpreter or broken installation**; sandbox/access/runtime diagnosis remains necessary. No repairs made.

## Documented runtime options

### Codex

Official noninteractive documentation supports `codex exec`, JSONL events, a final JSON Schema response, saved-auth reuse, and session resume. Local help corroborates JSON/schema/resume and sandbox flags. Documentation recommends API keys as the automation default and describes account-managed automation separately. Token usage events are not a promise of exact monetary cost. [Official noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)

App Server supports richer client integration, including authentication, history, approvals, and streamed events. Its fetched documentation labels WebSocket transport experimental/unsupported and warns about default unauthenticated non-loopback exposure. Prefer evaluating a local subprocess boundary; do not make a network listener a prerequisite for v1. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server)

Sarathi requirements beyond these capabilities: validate evidence semantics, own approval fingerprints, prevent uncontrolled tools, record durable workflow states, reconcile external writes, and version required context. Runtime resume is optional optimization; recovery must work from Sarathi's checkpoint when that session is unavailable.

### Claude

The Agent SDK supplies a programmable Python/TypeScript agent loop, tools, permissions, sessions, MCP, hooks, skills, and subagents. A direct Client SDK instead requires implementing the loop. Managed Agents are hosted execution, a distinct product. Official guidance says third-party developers cannot offer claude.ai login/rate limits without prior approval and directs SDK users to API authentication. Do not assume a personal subscription is an approved Sarathi SDK backend. [Official Agent SDK overview](https://code.claude.com/docs/en/agent-sdk/overview)

Using its permissions/hooks remains an integration task: Sarathi action authorization must survive reconnect and runtime restarts. SDK/subagent defaults must not independently exceed Sarathi's global worker limits.

### OpenRouter and model portability

OpenRouter routes across upstream providers by default. Its controls include `only`, `order`, `allow_fallbacks`, `require_parameters`, and data-policy filters. Approving OpenRouter alone does not define approved upstream recipients. Set an explicit upstream allowlist and fallback policy; require support for necessary parameters. [Official provider routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection)

A model endpoint does not automatically supply filesystem access, tool execution, sessions, approval handling, or durable scheduling. Keep runtime adapter and model-provider configuration separate. Treat fallback as a new attributable attempt with the same authority and required evidence; never broaden access after an error. Compatibility, actual account entitlements, and provider-specific schema/tool quality remain UNMEASURED.

## Windows lifecycle and VPN

Closing a browser can leave a separately hosted local backend running; current in-memory task execution already starts independently of stream attachment. Surviving browser closure is much weaker than surviving backend crash, logout, reboot, or sleep.

Windows services cannot directly interact with the user desktop. Microsoft recommends a separate user-session GUI communicating through controlled IPC when a service needs UI. Thus a tray icon and interactive VPN/authentication cannot simply be placed inside a system service. [Microsoft interactive services](https://learn.microsoft.com/en-us/windows/win32/services/interactive-services)

Recommendation: start v1 as a logged-in user background process with tray controls and startup registration, unless the user requires operation after sign-out. A service plus user-session companion is possible but increases credential/session/recovery complexity. Lock, sign-out, shutdown, pause, and sleep must have distinct intended behavior. Sleep/off execution remains unavailable under current intent; do not enable wake timers or prevent sleep implicitly. Windows Task Scheduler is available for launch/scheduling, but is not Sarathi's source of workflow truth. [Microsoft Task Scheduler](https://learn.microsoft.com/en-us/windows/win32/taskschd/task-scheduler-start-page)

LOCALLY VERIFIED: VPN shortcut targets Windows PowerShell. Its script path is `C:\Users\abhin\.openclaw\workspace\skills\public\sophos-vpn-cli\scripts\connect_sophos_connect_keeper_totp.ps1`. Read-only inspection identifies TOTP/credential handling and a referenced `connect_sophos_connect.ps1` helper. Script command names were inspected without printing secret-bearing content. No authentication material copied, no helper invoked. Full helper dependency/security audit, successful connection, prompt behavior, timeout, concurrent launch behavior, and operation while locked remain UNMEASURED. The existing two-minute wait policy cannot guarantee the helper itself terminates unless its process lifecycle is controlled.

## Required design controls and why

These are engineering recommendations, not claims supplied by a runtime vendor:

- Analysis workers receive snapshots/read capabilities; mutation credentials remain behind Sarathi's action executor. An approval prompt is insufficient if the worker can independently run a network client with write credentials.
- Validate schemas **and** semantics: every finding references an inspected revision/file/line; every coverage item corresponds to inventory; malformed, refused, incomplete, or contradicted output blocks downstream actions.
- Isolate runtime configuration per Sarathi agent/run. Ambient user plugins, hooks, global skills, MCP servers, and inherited secrets must not silently expand scope.
- Bind each attempt to runtime/version, model/upstream, context/skill versions, permission grants, task/session identity, and artifact manifest. Do not record secrets.
- Use bounded process output, deadlines, retry limits, descendant-process cancellation, and error classification. Cancellation of a write becomes reconciliation-required, not automatically failed/not-applied.
- Reserve shared concurrency centrally, including runtime-native children. Either disable uncontrolled native delegation or integrate it with the same broker.
- Store opaque credential references outside repository/context; document refresh/revocation and which Windows identity owns access. Tools in the current Codex session are not evidence of standalone entitlement.
- Budget includes retries, child workers, context rebuilding, and approved fallbacks. Unknown usage is unknown; a local limit cannot guarantee exact spend when providers report late. Choose token/output/request caps plus conservative admission policy.

## Questions that require operator decisions

1. Which initial runtime/account/provider routes are authorized for company code and Jira data? Does authorization include all upstream OpenRouter hosts or an explicit subset?
2. Must v1 operate only while signed in, also while locked, or after sign-out? Recommendation: signed-in including locked, pending VPN/auth validation.
3. Is Codex saved-account auth preferred where supported, or are dedicated API credentials acceptable? What daily/monthly/run spend ceiling and exhaustion behavior are acceptable?
4. Should unavailable preferred runtime pause or try only named approved fallbacks? Recommendation: pause when no approved route remains; never auto-purchase capacity.
5. Does pause stop new scheduling only, cancel read-only work too, or stop all future action dispatch? Recommendation: stop new dispatch immediately; reconcile already-issued writes.
6. May authentication assistance launch while locked, or should it wait for an unlocked session? VPN helper behavior needs validation before choosing.

## Proof required before specification claims readiness

Use a representative non-sensitive fixture first: isolated headless task; required-context omission; valid/invalid structured result; two concurrent tasks with no output mixing; child-worker limit; cancellation with descendants; restart/resume without runtime session; forbidden write attempt; expiring authentication; rate-limit/fallback; usage missing; lock/unlock; sleep/wake; VPN unavailable/auth-needed; browser closed. Then separately authorize real integration reads and externally visible write validation. None of these live runtime acceptance checks were performed in this documentation-only assessment.
