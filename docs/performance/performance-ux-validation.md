# Performance and resource validation (G02)

**Status: REVIEW — incomplete evidence; one multipart CPU long-task overrun was not reproduced, and cold scope-index readiness is slow.** Current grouped warm-query targets pass. This report includes F02-shape parity, production grouped browse queries with statement-phase diagnostics, cold readiness and heartbeat measurements, and selected scan/preview/thumbnail/lifecycle E2E evidence. It does not claim all resource requirements are validated.

## Reference query capture

Captured 2026-09-29 on macOS 25.6.0, Apple M3 Ultra, arm64, 28 logical CPUs, 96 GiB RAM; host Node 25.9.0, Electron 34.5.8 / Electron Node 20.19.1. The harness printed host Node's SQLite version (3.51.3); it did not independently capture Electron's SQLite version. F02 recorded 3.49.2 for Electron. Hardware/OS/Node/Electron match the reference; SQLite parity is unverified. This is local reference timing, not CI calibration.

All current runs use a migrated 600/10k/50k database, 40 directories, mixed STL/OBJ/3MF, stable sort ties, a 500-row page, five warmups, and 20 measured samples. Reference hardware/runtime details appear above. The two query shapes below are reported separately because F02's flat legacy view omits archive summaries while the current browse API groups archive members.

### F02 flat-fixture parity

This fixture has no `archive_path` values. The timed call is renderer `performance.now()` around preload IPC to legacy `GET_FILES` folder branch, followed by the legacy renderer-side last-only collection path-membership predicate on the returned 500-row page. `GET_FILES` in this integrated revision uses the current indexed query implementation, so this reproduces the earlier F02 fixture and call shape, not its pre-D02 implementation.

| Rows | Original F02 folder median / p95 | Current flat `GET_FILES` median / p95 | Original F02 last-only collection median / p95 | Current renderer query + membership median / p95 |
| ---: | ---: | ---: | ---: | ---: |
| 600 | 6.10 / 6.50 ms | 3.9 / 4.5 ms | 6.3 / 6.9 ms | 3.6 / 4.0 ms |
| 10,000 | 64.90 / 71.70 ms | 5.4 / 5.9 ms | 66.30 / 68.40 ms | 5.4 / 5.7 ms |
| 50,000 | 322.60 / 336.80 ms | 20.0 / 20.7 ms | 317.30 / 322.70 ms | 19.7 / 21.6 ms |

Current flat 50k main heartbeat max gap was 75.13 ms over 39 samples while a held scan heartbeat ran. The current flat timings are not C10's primary grouped archive-summary path.

### Grouped production shape (C10)

The fixture places 20% of records in 12 ZIP summary groups. The primary timing is renderer `performance.now()` around `window.polytray.getLibraryPage`; it includes filtered model count, display-item count and archive grouping, representative samples, ordering/page selection, and IPC. The last-only collection query goes through the same production API with SQL membership.

| Rows | Display items | Folder median / p95 | C10 median / p95 | Last-only collection median / p95 |
| ---: | ---: | ---: | --- | ---: |
| 600 | 492 | 6.4 / 6.7 ms | Informational | 0.7 / 0.8 ms |
| 10,000 | 8,012 | 20.7 / 21.8 ms | Meets <=50 ms median | 1.6 / 1.7 ms |
| 50,000 | 40,012 | 100.4 / 105.8 ms | Meets <=150 / <=250 ms | 10.3 / 10.8 ms |

An independent current-primary capture reported by the coordinator measured the same grouped 50k renderer IPC path at 101.5/115.0 ms median/p95. Both captures meet the C10 warm query median and p95 targets; they remain separate runs rather than a combined statistic.

### Cold first-page and scope-index readiness

The baseline records one first `GET_LIBRARY_PAGE` call immediately after the renderer's search input becomes attached. It queues a test scan IPC first to start the existing 25 ms main heartbeat probe, then sends the cold page request from the same renderer task; the scan is held at its delayed-subtree barrier until warm samples finish. `elapsedMs` is request-to-response; `readyToRequestMs` was 4.5-15.1 ms, and `readyToResponseMs` differs by that small setup delay. The cold call is separate from five warmups and 20 warm measurements.

| Fixture shape | 600 cold call | 10k cold call | 50k cold call | 50k ready-to-response |
| --- | ---: | ---: | ---: | ---: |
| Flat F02 parity | 12.5 ms | 289.8 ms | 1,552.1 ms | 1,567.2 ms |
| Grouped production | 14.0 ms | 294.9 ms | 1,617.9 ms | 1,630.1 ms |

The grouped 50k warm query meets C10 at 100.4/105.8 ms in the worker capture. An independent capture on the integrated primary tree measured 101.5/115.0 ms; these are separate runs, not a combined statistic. The first page took 1,617.9 ms from request to response in the worker capture. This points to an initial scope-index/readiness delay: the response waits after the app is ready while startup backfill catches up. The 25 ms heartbeat ran over an interval containing this cold call and the warm query series; its maximum gap was 121.74 ms over 134 samples, below 250 ms. This is a measured readiness delay, not evidence of an event-loop stall. The heartbeat maximum is for the combined interval rather than a separately windowed cold-call-only statistic. Bounded follow-up belongs to D01/FileIndex readiness and D02: determine whether the UI can continue on legacy browsing during backfill and measure the wait again with a preseeded 50k index.

The 50k query plan uses the covering `file_scopes` scope-path index and primary-key file lookup, then shows scans of the filtered/display CTE, a temporary B-tree for archive grouping, and a temporary B-tree for ordering. An Electron Node diagnostic invoked the unchanged `getLibraryPage` function five warmups plus 20 samples and wrapped that DB instance's statement `get/all` calls only. Clock: `performance.now()` in Electron Node 20.19.1, synchronously around each statement call; excludes IPC, prepare time, temporary-table setup, and JavaScript between statements. Timings are diagnostic phases, separate from the renderer IPC aggregate:

| 50k statement phase | Median / p95 |
| --- | ---: |
| Page counts, archive grouping, ordering and page selection statement | 53.57 / 56.19 ms |
| Archive representative samples statement | 48.47 / 50.17 ms |
| Whole `getLibraryPage` function in Electron Node | 102.54 / 105.78 ms |

The integrated query combines model count, display count with archive grouping, ordering and page selection into one statement with scalar subqueries; the statement wrapper cannot split those subqueries without duplicating or changing production SQL. Archive representative samples run in a separate statement. These diagnostic calls are in Electron Node and exclude IPC; the worker capture's 50k renderer IPC aggregate is 100.4/105.8 ms, while the independent integrated-primary capture is 101.5/115.0 ms.

The query harness held a separate isolated scan at a subtree barrier while production query samples ran. The worker capture's heartbeat maximum was 121.74 ms across the cold request and warm 50k grouped-query samples, below C10's <=250 ms bound. After D02 optimization commit `2000282`, the integrated-primary grouped 50k capture measured 101.5/115.0 ms, meeting C10. The earlier 161.6/165.0 ms capture is not a controlled before measurement because fixture/runtime details differ. The measured 1.62 s first-page readiness wait remains open for D01/FileIndex and D02 investigation.

The earlier F02 capture used legacy `GET_FILES` and renderer-side collection path filtering, and explicitly omitted archive-summary grouping. Its 50k folder median/p95 of 322.6/336.8 ms and collection 317.3/322.7 ms are retained as historical evidence but are not equivalent to this production page measurement. The current flat run matches F02's fixture shape/call path, but invokes the integrated indexed GET_FILES implementation. D02's corrected source-shaped 50k grouped query was 79.71/81.35 ms with a 20% archive distribution; the later 100.4/105.8 ms worker and 101.5/115.0 ms integrated-primary captures are current C10 observations, not controlled before/after comparisons. Hardware matches; do not interpret fixtures as identical in archive group count or SQLite runtime.

## Query plan and bottleneck owner

The 50k `EXPLAIN QUERY PLAN` output includes `MATERIALIZE display_items`, a covering `file_scopes` scope-path lookup, primary-key file lookup, scans of the filtered/display CTEs, a temporary B-tree for GROUP BY, and a temporary B-tree for ORDER BY. Current warm grouped query meets the C10 target; no further D02 query follow-up is required by this measurement. Cold readiness remains assigned to D01/D02.

The isolated dense parser diagnostic generated a 200,000-triangle, 10,000,084-byte STL. Electron Node `STLLoader` parsing took 6.19 ms in the latest run. This is parser-only timing; it is not renderer CPU assembly, GPU upload, or frame time.

## Renderer lifecycle and observable resource run

The new `tests/product/e2e/performance-regressions.e2e.ts` passed on the same macOS host. It ran 20 open, replace-with-other-model, and close cycles, alternating two STL models. The test observed zero explicit viewer-frame marks over a one-second settled interval, zero marks during a one-second minimized interval, and a restore catch-up frame. It recorded 20 WebGL contexts, all reported lost after cleanup; two stable BrowserWindow renderer pages (main + thumbnail); and thumbnail disk-cache PNG bytes stable at 5,034 before and after the cycle loop. It logged 40 visible-renderer Worker constructions and 40 `terminate()` calls, with that equality asserted. These are Worker object counters, not utility process counters. The broad EventTarget wrapper counted 300 add and 340 remove calls during the test; those are operation counts across activity after instrumentation began, not a listener census or proof of leak-free listeners. The visible renderer's `MessageChannel` constructor count was zero.

The loop observed the viewer filename changing to the replacement identity, the viewer canvas disappearing, and `__POLYTRAY_CURRENT_MODEL` clearing after each close. Disk cache stability was measured after all three fixture thumbnails were explicitly generated and the cache settled. The test also exercised a thumbnail cache hit and regenerated a deleted cached PNG. The zero-frame windows were measured directly before later interactions; later render marks include normal open/restore frames.

## Focused product evidence

Command:

```sh
npx playwright test tests/product/e2e/performance-regressions.e2e.ts tests/product/e2e/scan-streaming.e2e.ts tests/product/e2e/preview-preparation.e2e.ts tests/product/e2e/preview-cancellation.e2e.ts tests/product/e2e/thumbnail-lifecycle.e2e.ts tests/product/e2e/thumbnail-invalidation.e2e.ts
```

Result: 6 passed, 0 failed in 32.6 seconds on macOS 25.6 / M3 Ultra.

- The 5k delayed-subtree scan made its first indexed-subtree queryable batch in 5.3 ms and the first file card became DOM-visible in 213.6 ms while the delayed subtree remained held. It captured 8 progress events: one first-batch boundary, one total-known terminal boundary, and at most 4 regular events in any rolling second. Main heartbeat max gap was 29.93 ms over 62 samples. This verifies a visible card before delayed discovery completes; compositor presentation time was not instrumented.
- A focused multipart preview run observed one 107 ms renderer long task, exceeding C10's <=100 ms CPU long-task target. Three subsequent isolated repeats and the integrated Product run recorded 0 ms max long tasks; the overrun remains an unexplained, non-reproduced outlier. The integrated run's dense/multipart first frames were 282.2/22.5 ms and render-submit was 19.2/6.2 ms. These are CPU observer results; they do not measure GPU upload. V04 owns investigation if the outlier recurs; no threshold is relaxed.
- Held preview replacement stopped its obsolete renderer in 21 ms; A/B were rejected and C resolved. The main and thumbnail renderer processes remained alive, and independent thumbnail work completed during the held parse.
- `metadata-worker.e2e.ts` passed in the integrated run: during one large OBJ scan, 289 production `GET_LIBRARY_PAGE` samples were taken while the scan job was running and `metadataCompleted` stayed zero before and after each call. Query latency median/p95 was 0.6/0.8 ms; the 25 ms main heartbeat max gap was 26.05 ms over 17 samples. A prior same-fixture run recorded 392 ms scan-plus-metadata total. This shows query latency while metadata work remained outstanding; it does not prove the worker was actively parsing during every sample.
- Thumbnail lifecycle, deletion/recovery, refresh, clear, revision, and cache invalidation E2Es passed. The dedicated 20-cycle test also passed its direct cache hit/regenerate-after-delete assertions.

The scan E2E measures progress rate and separates the observed first-batch and total-known boundaries. It does not expose queue high-water. With `scanning_batch_size` 50, source inspection shows discovery capacity 50 and metadata capacity 100; `BackgroundJob` and public progress expose no high-water values, so actual queue occupancy remains unmeasured without an isolated S-owned hook. Cold scope-index readiness is measured separately at 1.62 s for grouped 50k, as detailed above; the heartbeat was active over that interval and remained below 250 ms.

After adding these probes, the performance baseline completed all six flat/grouped size combinations and fixture unit tests passed 2/2 under Electron Node. On the exact integrated test tree, `npm run build` passed; `PYTHON=/usr/bin/python3 npm run test:product` passed through Node native rebuild, unit tests, Electron native rebuild, and Playwright E2E: 478 unit passes/1 Windows-only skip and 69 E2E passes/1 optional real-model skip. The generated fixture was restored to baseline SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.

## Remaining gaps and owners

- `scan-streaming.e2e.ts` passed for a synthetic 5k scan: queryable batch at 5.3 ms, first file card DOM-visible at 213.6 ms before barrier release, max regular progress 4/rolling second, and heartbeat max gap 29.93 ms. Source-defined capacities are 50 discovery events and 100 metadata items for batch size 50, but actual queue high-water is not observable; owner S needs an isolated depth probe if measured occupancy is required. `metadata-worker.e2e.ts` sampled page-query latency at 0.6/0.8 ms median/p95 while the scan was running and metadata remained outstanding; active parser overlap was not proven. A separate direct run recorded one metadata completion in 392 ms and a 36.04 ms main heartbeat max gap over 13 samples. The 50k grouped cold first page took 1,617.9 ms request-to-response, with 121.74 ms maximum heartbeat across the cold-plus-warm query interval. D01/FileIndex and D02 should check legacy-browse availability during backfill and compare first-run with already-indexed readiness.
- `preview-preparation.e2e.ts` passed; one earlier focused run observed a 107 ms multipart CPU long task, while three repeats and the integrated run recorded 0 ms. For multipart, the first viewer frame is present while part-image placeholders and in-flight image work remain, so first-frame-before-images passes. It also checks publication cleanup after replacement/close. GPU upload is not measured separately from render-submit; retain the outlier and investigate if it recurs. V04 should add GPU timer-query instrumentation where supported, otherwise keep upload unverified.
- `preview-cancellation.e2e.ts` passed: obsolete renderer stopped in 21 ms, below 500 ms. One independent thumbnail request observed queue depth one then zero and completed, but this is not queue stress evidence. The E2E's BrowserWindow count and page PIDs do not expose utility worker processes; owner V/S needs a test-only process registry or operating-system child-process capture for worker-process inventory.
- The test wraps visible renderer `MessageChannel` and `Worker` constructors, but transferred ports are created in preload/main/owned preview contexts. It observes no visible-renderer channels; it cannot claim all app ports are zero. Explicit EventTarget add/remove operation counts do not provide a complete active listener count because native/internal listeners and abort-signal removal are not observable through the wrapper. Owners V/U should add lifecycle counters at the resource-owning preview runtime boundary if exact port/listener counts are required.
- Thumbnail PNG bytes are measured on disk, not in-memory image-cache bytes. The renderer cache's encoded-byte counter is closure-private; owner T should expose an isolated byte/count diagnostic if memory accounting is required.
- Thumbnail lifecycle and invalidation E2Es passed, including refresh and missing-cache recovery. The new cycle test observed a cache hit and regenerated a deleted PNG; disk image-cache bytes were stable after warmup.
- CI timing calibration and Windows/Linux app runtime evidence remain open. Local app evidence here is macOS arm64 only.
- Optional real `base.3mf` supplementary run was not available or run; portable dense and multipart preview E2E fixtures were run.

## Outstanding evidence

The following C10/resource areas were not measured in this capture and must remain open:

- Scan queue high-water; compositor presentation time for the first batch; legacy browse availability during scope-index backfill (first grouped 50k request took 1.62 s); and first-run versus already-indexed readiness comparison.
- Multipart renderer CPU long tasks (one 107 ms overrun was not reproduced); GPU upload/driver timing.
- Exact transferred port and active-listener counts across preload/main/owned preview contexts; utility worker-process inventory; in-memory image-cache bytes. Visible-renderer Worker object counters and BrowserWindow counts do not substitute for these.
- CI timing calibration and Windows/Linux app runtime evidence. The local app evidence in this report is macOS arm64 only.
- Optional real `base.3mf` supplementary run. Its absence is not treated as a pass; portable dense and multipart renderer fixtures were run.

Related coverage not included in the focused six-file command includes [preview-state](../../tests/product/e2e/preview-state.e2e.ts); it is not cited as separate focused evidence here. Both metadata-worker and preview-preparation suites passed in the integrated Product run. The prior 107 ms long-task observation is reported above.

## Reproduction

Run after Build and Electron native dependency rebuild:

```sh
node --import tsx tests/dev/performance-baseline.ts
npx playwright test tests/product/e2e/metadata-worker.e2e.ts
node -e 'const {spawnSync}=require("node:child_process");const r=spawnSync(require("electron"),["--import","tsx","--test","tests/product/unit/main/performanceFixtures.test.ts"],{cwd:process.cwd(),stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});process.exit(r.status??1)'
```

The initial direct-host-Node fixture test failed because the reusable worktree's `better-sqlite3` binary was built for Electron ABI 132 while host Node requires ABI 141. The prescribed Electron Node fixture test then passed (2/2). The latest baseline command completed successfully and emitted the numeric samples above. The warm grouped 50k query target passes after D02; the cold 1.62 s scope-index readiness delay, non-reproduced 107 ms multipart CPU outlier, and unmeasured resource/platform requirements keep G02 in REVIEW. Build and full Product passed on the exact integrated test tree.
