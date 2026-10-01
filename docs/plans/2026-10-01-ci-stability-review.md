# CI stability review (2026-10-01)

A review of why `ci/sandbox` Build runs kept failing on macOS and Windows while local runs passed: what was found, what was changed, and what is still open.

## Summary

The red builds were not mainly one bad test. They came from how the quality gate was structured:

- **The gate's odds.** About 75 full-app E2E tests run on 3 platforms with no retries, and all must pass. If each check passes 99.5% of the time, a full matrix run is green only about 33% of the time; at 99%, about 11%. A handful of slightly unstable tests is enough to keep CI red.
- **Speed benchmarks inside the pass/fail gate.** Fixed time limits (250 ms main-thread heartbeat, first card visible in under 1 s, old renderer stopped in 500 ms, startup under 10 s) run on shared hosted runners, which are slower and noisier than a developer Mac.
- **Large batches validated late.** `ci/sandbox` was 375 commits ahead of `main` (about 18.5k lines in `src/`, 17.7k in tests), and Build only ran on `main` pushes and manual dispatch. When a large batch goes red, a failure cannot be traced to a change.
- **Rotating failures.** Over the four runs before this work, Linux was green every time, and Windows and macOS failed a different set of tests each time. Two Windows failures repeated in every run and are app issues, not test noise (see Remaining).

After the CI and test changes below, hosted Build run 36801465403 went from 7 failures (2 macOS, 5 Windows) to 3. All 3 were app issues the tests correctly caught. The macOS one (scroll position lost during a streaming scan) is now fixed; the two Windows issues remain.

## Fixed

### Measuring flakiness

- **New `E2E Stability` workflow** (`.github/workflows/e2e-stability.yml`). Run it manually with a repeat count (1-20), an optional `--grep` filter and a platform choice. It never gates merges.
- **Pass-rate summary.** `scripts/summarize-e2e-stability.mjs` turns the Playwright JSON reports into a per-test pass-rate table for each OS (least stable first) and estimates the chance of a fully green matrix run. It is covered by `tests/repo/ci/e2eStabilitySummary.test.ts`.
- **Can only run from `main`.** GitHub allows manual dispatch only for workflows that exist on the default branch, so this can be used once it lands on `main`.

### E2E harness and test races

- **One build before all E2E files.** Previously only `app.e2e.ts` and `viewer-idle.e2e.ts` ran `npm run build` in `beforeAll`, so other files used whatever `out/` existed, and running a single file could launch a stale or missing build. `tests/support/playwright/globalSetup.ts` now builds once before any file. Set `POLYTRAY_E2E_SKIP_BUILD=1` to reuse a fresh build.
- **`watcher-races`.** `test_model_a.stl` and `test_model_b.stl` are byte-for-byte identical, so the "changed file" step only changed the modified time, which Windows can merge or miss. The test now writes a valid STL that is one triangle larger.
- **`thumbnail-invalidation`.** The wait for the refreshed thumbnail could finish on the old (blue) path. It now waits for a path different from the original.
- **`background-work`.** The exact-pixel check on one anchor card was replaced: at least half of the cards in view when the scan was cancelled must still be in view after the rescan. See the scroll-position fix below for why the single-card check could not be guaranteed.

### App fix: scroll position lost while a scan streams in files (macOS failure)

`refreshLibrary` in `App.tsx` records the first card in the top visible row before each library refresh. After the refresh it moves `scrollTop` by the number of rows that card shifted. During a streaming scan (the `background-work` rescan indexes 120 files one at a time, all sorting above the cards in view), refreshes arrive every ~150 ms. The anchor was chosen fresh each time:

- Once inserted files shared the top row with the cards the user was reading, the next refresh anchored to an inserted card.
- Later inserts landed after that card and pushed the original cards out of view.
- Whether this happened depended on how the scan's batches split, so it failed intermittently, and more often on the macOS runners.

It reproduced locally on Linux in 2 of 6 runs (the anchor card was unmounted and `scrollTop` stopped at 4,894 instead of 10,302).

The fix lives in `src/renderer/lib/libraryScrollAnchor.ts`, with unit tests in `tests/product/unit/renderer/libraryScrollAnchor.test.ts`:

- While the user has not scrolled since the last restore, the app reuses the card it restored last time instead of re-picking whatever card is now on top.
- It does not record a new anchor while a refresh or its restore frame is still pending, because the DOM then still shows the uncorrected position.

With the old app code the updated test failed 5 of 6 runs; with the fix it passed 10 of 10.

### The native-module rerun bug

`npm run test:product` rebuilds `better-sqlite3` for Node, runs unit tests, then rebuilds it for Electron. `npm rebuild better-sqlite3` can install a Node prebuilt binary while leaving the `.forge-meta` marker from an earlier Electron rebuild, and `electron-builder install-app-deps` then trusts the marker and skips the rebuild. On a second `test:product` in the same checkout, every E2E test timed out waiting for a window (`NODE_MODULE_VERSION` 127 vs 132). CI never saw this because each run starts from a fresh checkout. `build/scripts/clear-electron-rebuild-marker.js` now runs between the two steps.

Related rule now in `AGENTS.md`: never run two unit/E2E/Product commands at the same time in one checkout. They share one `better_sqlite3.node` and replace it under each other.

### CI configuration

- Build also runs on `pull_request`. A newer push to the same PR cancels the older run; `main` and manual runs always finish.
- Build and Release jobs time out after 60 minutes instead of the 6-hour default.
- Node is pinned to 22 in `.nvmrc` (CI was on Node 20, which reached end of life), with npm caching.
- Playwright browser downloads were removed (E2E uses the Electron binary from npm). Linux now installs only Chromium's system libraries plus Xvfb and Openbox.
- `setup-and-test` takes a `test-command` input (default `npm run test:product`), passed through an environment variable rather than inserted into the script.

### Unit and E2E suite cleanup

- **Harness self-tests.** Four test files (9 tests) that check test-support code rather than the app (`databaseFixtures`, `performanceFixtures`, `performanceModelFixtures`, `performanceProbe`) moved to `tests/support/__tests__/`. They still run in the Node phase of `test:product:unit`, because three of them need the Node build of `better-sqlite3`, which `test:repo` does not set up.
- **Rules tested at several levels.**
  - `scan-safety.e2e.ts` was removed. It launched the full app only to make IPC calls, checking that an unavailable root keeps its rows and an empty root prunes them. `scanService.test.ts` already covered both against real SQLite; its unavailable-root test now also asserts that tags and notes survive, which was the only extra check in the E2E test.
  - The `failed metadata retry leaves healthy files untouched` E2E test in `scan-controls.e2e.ts` was removed. The same broken-zip → partial → retry → completed flow is covered through the real UI by `background-work.e2e.ts`, and at service level by two `scanService` unit tests.
- **Timer-dependent tests.** The six `refreshDebouncer` tests slept 45-70 ms against 20-50 ms debounce delays, which a slow runner can fail. They now use Node's mock timers and also check that nothing fires before the delay. The other real sleeps were left: they poll for a marker file with a deadline, retry a Windows file-lock cleanup, or don't depend on timing to pass.

### Process docs

`AGENTS.md` now has a "CI Feedback Loop for Feature Work" section:

- Open a draft PR early so every push runs the 3-platform gate.
- Prefer small PRs that each pass CI.
- Use `npm run test:e2e:changed` for a fast local loop.
- One local or hosted pass doesn't prove a test is stable.

## Remaining

### Open failures

| Platform | Test | Observation |
|---|---|---|
| Linux | `integrated-library`: click the tail card of a 600-item grid | Intermittent: failed on Linux in PR run 36807353965 and once on macOS (run 36782669694); the card did not become clickable within 2 s. Untouched by these changes; a candidate for the `E2E Stability` workflow. |
| Windows | `preview-cancellation`: cleanup only | Intermittent: in PR run 36833204555 the test body passed, then deleting the isolated app's temp folder failed with `ENOTEMPTY` after 20 retries. This is the Windows file-handle cleanup class seen earlier as `EBUSY`; the cleanup helper in `tests/support/helpers/isolatedApp.ts` needs a longer handle-release wait or a best-effort delete. |
| Windows | `responsive-layout` | A tiny STL preview stays on "Processing 3D data…" for 30 s after a page reload. Failed in every Windows run reviewed. |
| Windows | `scan-streaming` | The main-process heartbeat gap exceeds 250 ms during a 5,000-file scan (329 ms, 351 ms, and 1,672 ms seen). Likely synchronous SQLite work on the main thread. Failed in every Windows run reviewed. |

### Structural recommendations not yet done

1. **Move speed limits out of the merge gate.** Run the heartbeat, first-visible, renderer-stop, first-frame and startup limits in a non-blocking performance job with per-OS budgets and trend tracking. Keep the correctness gate for correctness.
2. **Test hooks in production code.** About 27 environment-variable hooks under `src/main` (scan, watcher, thumbnail and preview hold/release gates) ship with the app. A test-only entry point or dependency injection would keep them out of the product.
3. **Large E2E tests.** `background-work.e2e.ts` covers about 8 scenarios in one test, and `responsive-layout.e2e.ts` runs 18 reload-and-preview cycles. Splitting them would make one failure stop hiding the rest.
4. **Shared app state in `app.e2e.ts`.** 33 tests share one app instance from `beforeAll`, so they depend on running in order.
5. **Complexity driven by a test limit.** In `previewWindow.test.ts`, 6 of 10 tests cover the Linux process-ID verification that exists to stop the old preview renderer within the 500 ms E2E limit. If that limit moves to a performance job, the machinery and its tests could be reconsidered. The 28 tests in `thumbnailCacheLifecycle` likewise reflect the complexity of the cache epoch, quarantine and tombstone design rather than redundancy.
6. **Lint is not in CI.** `npm run lint` exists but no workflow runs it.

### Suite size for context

`main` has 53 unit tests and 30 E2E tests (one file). This branch has 495 unit-phase tests (including the 9 harness self-tests) and 73 E2E tests across 27 files. The unit suite runs in about 13 seconds and did not fail in any reviewed CI run. E2E is the slow, flaky layer, so cutting repeated checks should start there.
