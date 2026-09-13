# Peer agent engines and routing ownership

Hermes, Codex, and Claude Code are peer agent engines; none is required to wrap another. Sarathi owns engine resolution in `task > workflow > agent > global` order, freezes the resolved choice when a task starts, and treats engine-native orchestration as an optional capability. This keeps governance consistent across engines while preserving Hermes profiles, delegation, and Kanban when Hermes is explicitly selected.

Configured but unverified engines cannot execute. Cross-engine fallback is disabled by default and must be explicitly ordered; paid routes require separate enablement. Sarathi remains authoritative for tool permissions, canonical history, and approvals. Credentials remain external secret references, native sessions stay isolated per engine and agent, and cross-engine context transfer requires route-level consent. Only registered Hermes, Codex, and Claude Code adapters ship initially; BYOA executable paths remain outside this change.

Configured but unverified engines cannot execute. Cross-engine fallback is disabled by default and must be explicitly ordered; paid routes require separate enablement. Sarathi remains authoritative for tool permissions, canonical history, and approval gates. Engine credentials remain external secret references, and native session identities stay isolated per engine.
