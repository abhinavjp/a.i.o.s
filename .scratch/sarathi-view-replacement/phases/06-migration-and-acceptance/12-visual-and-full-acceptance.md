# TSK-012 — Prove visual, accessibility and full-system acceptance

- **Outcome:** deterministic browser and repository gates prove all approved acceptance scenarios; remaining defects found by the single final semantic review are bounded, remediated and rerun without broadening scope.
- **References:** CON-008, CON-009; REQ-001–REQ-025; AC-01–AC-07; INV-01–INV-07; RSK-003–RSK-007.
- **Blocked by:** TSK-011.
- **Write scope:** root/client test tooling and lockfile needed for deterministic browser tests; browser fixture/spec/snapshot files; bounded `app/client/src/mission-control/**`, `App.tsx` or `App.css` corrections found by acceptance; `.scratch/sarathi-view-replacement/evidence.md`.
- **Read/reference context:** approved prototype/hash, entire approved Plan tree, deterministic server fixtures, current full test/typecheck/build commands.
- **Frozen decisions:** representative viewports cover >1000, 761–1000 and <=760 bands; visual assertions target hierarchy/tokens/density and stable regions, not exact arbitrary pixels; accessibility covers names/roles/focus/contrast/reduced motion; negative audit exercises every rendered prototype-like action; live provider checks remain separate.
- **Ordered changes:** add pinned browser-test dependency/config and deterministic fixture launch; write visual/keyboard/accessibility/control-negative specs; capture approved-reference comparisons; run AC-01–AC-07; run repository-wide gate; perform exactly one final semantic review; create bounded remediation list, fix only those findings, rerun affected/integration checks; write compact evidence.
- **Preserve:** all approved behaviors and external dirty baseline; no snapshot update may conceal unexplained regression.
- **Must not change:** requirements/Plan meaning, live external state, protected dirty files, unrelated flaky tests.
- **Narrow proof:** browser suite itself plus client typecheck/build; then the complete repository-wide deterministic gate from `plan.md` and staged-scope audit.
- **Manual/live proof:** annotated reference comparison and authorized UAT; real Jira/GitLab/agent results are `UNMEASURED` unless separately exercised and evidenced.
- **Handoff evidence:** AC/REQ matrix, commands/results, screenshots, accessibility report, semantic-review count/findings/remediation, dirty-scope audit, final commit and verified remote SHA.
