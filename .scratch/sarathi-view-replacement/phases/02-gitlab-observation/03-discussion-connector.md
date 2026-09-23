# TSK-003 — Read GitLab merge-request discussions

- **Outcome:** the GitLab code-host abstraction returns normalized merge requests, pipelines and discussions with stable identity, authorship, system/human classification and resolved state.
- **References:** CON-004; REQ-014; INV-04, INV-05; RSK-006.
- **Blocked by:** TSK-002.
- **Write scope:** `connectors/src/index.ts`; `connectors/tests/ConnectorConfigurator.test.ts`; shared contract types only when required by the public abstraction.
- **Read/reference context:** `CodeHost`, `GitLabTransport`, `GitLabCodeHost`, `FetchGitLabTransport`, null/fake hosts, GitLab v4 discussion response shape already represented by authorized local fixtures.
- **Frozen decisions:** add read methods only; normalize project/MR/discussion/note IDs and resolved/system flags; connector errors are explicit; every implementation including null/fake remains contract-complete; do not add comment/resolve/merge methods.
- **Ordered changes:** write failing fake transport/normalization/error cases; add types and abstraction method; implement fetch pagination and normalization; update null/fake hosts; make tests pass and refactor.
- **Preserve:** current MR/pipeline/file/diff behavior, internal plain-HTTP support, lazy credential resolution, branch write shields.
- **Must not change:** credential storage, protected-branch refusals, any external write behavior, protected dirty files.
- **Narrow proof:** connector tests for multiple pages, human/system notes, resolved/unresolved discussions, 404/error and no-secret transport inputs; connectors typecheck.
- **Manual/live proof:** live self-managed GitLab discussion shape is `UNMEASURED` without authorized access; fixture provenance must be recorded.
- **Handoff evidence:** normalized examples, pagination/error proof, checks, review findings, commit and verified remote SHA.
