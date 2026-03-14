# Polytray Agent Guide

This file captures the repo-specific rules of engagement for AI/code agents working in Polytray.

## Start Here

- Read [DEV_CONTEXT.md](./DEV_CONTEXT.md) at the start of a session.
- Skim [README.md](./README.md) if you need current product positioning, user workflows, or command references.
- Check `git status` before editing. The worktree may contain user changes.
- Prefer narrow fixes. Avoid bundling unrelated cleanup into product work.

## Project Shape

- Electron desktop app with React renderer and Vite build.
- TypeScript everywhere, strict mode enabled.
- Three.js powers parsing/rendering for `stl`, `obj`, and `3mf`.
- SQLite access uses `better-sqlite3`.
- User settings and library folder state are renderer-owned in `localStorage`.
- Preview parsing is unified at the UI level, but the heavy background strategy varies by format.

## Important Architecture Constraints

- `3MF` previewing has two code paths internally:
  - fast lightweight preview parser for supported/simple files
  - fallback to `ThreeMFLoader` for unsupported/richer files
- Preview and thumbnail behavior should stay aligned. If you change transforms, mesh serialization, or preview materials, verify orientation parity and thumbnail parity.
- `polytray://local/` is allowlisted. Do not broaden file access casually.
- Folder filtering must use canonical containment, not string-prefix matching.
- Watcher lifecycle is restart-safe and centralized. Avoid reintroducing ad-hoc worker/process ownership.

## Editing Guidelines

- Default to ASCII unless the file already uses Unicode or there is a clear reason.
- Prefer focused changes with minimal surface area.
- Use existing helpers and shared modules before adding new ones.
- Keep preview-specific optimizations behind the unified strategy/serialization layer rather than branching UI behavior.
- Do not reintroduce external `sqlite3` CLI dependencies in tests; use in-process `better-sqlite3` fixtures/helpers.

## Test Layout

- `tests/product/`
  - user-facing behavior that should gate CI
  - unit tests in `unit/{main,renderer,shared}`
  - Playwright E2E in `e2e/`
- `tests/repo/`
  - repo/CI/docs contract checks
  - useful for workflow and maintenance changes, but not part of the product gate by default
- `tests/support/`
  - shared helpers and fixture generators
- `tests/dev/`
  - one-off verification utilities

## Verification Rules

Choose the smallest verification set that proves the change, but include all affected layers.

## Pre-Push Requirement

- Before pushing changes to `main`, always run both:
  - `npm run build`
  - `npm run test:product`
- Treat these as the minimum pre-push gate even if a smaller targeted check was enough during development.

### Always consider

- `npm run typecheck`

### Run `npm run test:product:unit` when changing

- main-process logic
- shared settings/state helpers
- renderer utilities
- parsing/serialization/orientation helpers
- DB/query/conflict logic
- path containment or protocol allowlisting

### Run `npm run test:product` when changing

- Electron app startup/launch behavior
- Playwright flows
- preview panel behavior
- scanning/watcher flows that surface in the UI
- native-module / `better-sqlite3` / Electron rebuild behavior
- CI setup changes that affect app launch or product tests

Notes:
- `npm run test:product` intentionally runs unit tests first, then rebuilds native deps for Electron, then runs E2E.
- This sequence matters. Do not collapse it back to a plain unit+E2E chain.

### Run `npm run test:repo` when changing

- GitHub Actions workflows
- composite actions under `.github/actions/`
- docs/media verification helpers
- repo structure conventions

### Run `npm run build` when changing

- packaging behavior
- build config
- Electron/Vite integration
- preload/main/renderer imports that could break bundling
- release workflow/package-app action

## CI / Native Module Gotchas

- `better-sqlite3` has separate Node vs Electron rebuild needs.
- For CI test setup, dependencies should install without running `postinstall` Electron rebuilds first.
- Product tests should rebuild native deps for Electron only after the Node-based unit phase and before E2E launch.
- Packaging should still rebuild native deps for Electron before `electron-builder --publish never`.

## E2E Gotchas

- `ELECTRON_RUN_AS_NODE` in the environment will break Electron launch if it leaks into the app process.
- Use the shared helper in `tests/support/helpers/electronLaunch.ts` rather than open-coding Electron env handling.
- The `base.3mf` perf test is optional/gated by `POLYTRAY_REAL_BASE_3MF_PATH`.

## Documentation Hygiene

- Update [DEV_CONTEXT.md](./DEV_CONTEXT.md) when architecture, workflow, or milestone status changes.
- If you change public workflows, release behavior, or verification rules, update this file too.
- Keep docs aligned with actual scripts and CI behavior.

## Practical Defaults

- For product bugs: identify root cause first, then add/adjust a failing test, then fix.
- For workflow/CI bugs: add or update a repo contract test under `tests/repo/ci/` before changing YAML/actions.
- For 3MF regressions: prefer tightening lightweight-parser eligibility and falling back cleanly before expanding parser complexity.
