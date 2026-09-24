# PHS-06 Progress

Baseline: `d0e1283b8df9809c71d20a498f4f1f5be2ad1c1e` on `main`; worktree clean before TSK-011.

- [x] TSK-011 Migrate remaining controls and retire the generic dashboard
  - changed: `.scratch/sarathi-view-replacement/evidence.md`, `.scratch/sarathi-view-replacement/screenshots/tsk011-advanced-desktop.png`, `.scratch/sarathi-view-replacement/screenshots/tsk011-advanced-mobile.png`, `app/client/src/AdvancedRouting.test.tsx`, `app/client/src/App.css`, `app/client/src/App.routing.test.tsx`, `app/client/src/App.test.tsx`, `app/client/src/App.tsx`, `app/client/src/FirstRun.test.tsx`, `app/client/src/MissionControlShell.test.tsx`, `app/client/src/automatic-decisions.test.tsx`, `app/client/src/mission-control/AdvancedControls.tsx`, `app/client/src/work-items/WorkItemsPage.tsx`, `app/client/src/work-items/WorkItemsPage.test.tsx`
  - deviation: none
  - proofs: focused migration suite 4 files / 35 tests passed; full client suite 10 files / 64 tests passed; `npx tsc -p app/client/tsconfig.json --noEmit` passed; `npm run build -w app/client` passed; `git diff --check` passed; `app/client/src/routing/RoutingPage.tsx` unchanged
  - browser: 1440px and 390px fixture screenshots PASS; no horizontal overflow; four section links and keyboard skip focus
  - review: direct control-inventory and protected-scope review PASS; live providers UNMEASURED
  - commit: committed
