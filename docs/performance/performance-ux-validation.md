# Performance and resource validation (G02)

**Status: REVIEW — incomplete evidence; 50k grouped-query median and multipart CPU long task remain over target.** This report includes F02-shape parity, production grouped browse queries with statement-phase diagnostics, a bounded query heartbeat probe, and selected scan/preview/thumbnail/lifecycle E2E evidence. It does not claim all resource requirements are validated.

## Reference query capture

Captured 2026-09-29 on macOS 25.6.0, Apple M3 Ultra, arm64, 28 logical CPUs, 96 GiB RAM; host Node 25.9.0, Electron 34.5.8 / Electron Node 20.19.1. The harness printed host Node's SQLite version (3.51.3); it did not independently capture Electron's SQLite version. F02 recorded 3.49.2 for Electron. Hardware/OS/Node/Electron match the reference; SQLite parity is unverified. This is local reference timing, not CI calibration.

All current runs use a migrated 600/10k/50k database, 40 directories, mixed STL/OBJ/3MF, stable sort ties, a 500-row page, five warmups, and 20 measured samples. Reference hardware/runtime details appear above. The two query shapes below are reported separately because F02's flat legacy view omits archive summaries while the current browse API groups archive members.

### F02 flat-fixture parity

This fixture has no `archive_path` values. The timed call is renderer `performance.now()` around preload IPC to legacy `GET_FILES` folder branch, followed by the legacy renderer-side last-only collection path-membership predicate on the returned 500-row page. `GET_FILES` in this integrated revision uses the current indexed query implementation, so this reproduces the earlier F02 fixture and call shape, not its pre-D02 implementation.

| Rows | Original F02 folder median / p95 | Current flat `GET_FILES` median / p95 | Original F02 last-only collection median / p95 | Current renderer query + membership median / p95 |
| ---: | ---: | ---: | ---: | ---: |
| 600 | 6.10 / 6.50 ms | 4.1 / 4.3 ms | 6.3 / 6.9 ms | 3.5 / 3.9 ms |
| 10,000 | 64.90 / 71.70 ms | 5.3 / 5.9 ms | 66.30 / 68.40 ms | 5.3 / 5.8 ms |
| 50,000 | 322.60 / 336.80 ms | 21.6 / 24.2 ms | 317.30 / 322.70 ms | 19.4 / 20.2 ms |

Current flat 50k main heartbeat max gap was 115.77 ms over 38 samples while a held scan heartbeat ran. The current flat timings are not C10's primary grouped archive-summary path.

### Grouped production shape (C10)

The fixture places 20% of records in 12 ZIP summary groups. The primary timing is renderer `performance.now()` around `window.polytray.getLibraryPage`; it includes filtered model count, display-item count and archive grouping, representative samples, ordering/page selection, and IPC. The last-only collection query goes through the same production API with SQL membership.

| Rows | Display items | Folder median / p95 | C10 median / p95 | Last-only collection median / p95 |
| ---: | ---: | ---: | --- | ---: |
| 600 | 492 | 6.6 / 7.7 ms | Informational | 0.8 / 0.9 ms |
| 10,000 | 8,012 | 27.3 / 28.4 ms | Meets <=50 ms median | 3.5 / 3.7 ms |
| 50,000 | 40,012 | 161.6 / 165.0 ms | **Median misses <=150 ms by 11.6 ms; p95 meets <=250 ms** | 28.2 / 29.2 ms |

The 50k query plan uses the covering `file_scopes` scope-path index and primary-key file lookup, then shows scans of the filtered/display CTE, a temporary B-tree for archive grouping, and a temporary B-tree for ordering. An Electron Node diagnostic invoked the unchanged `getLibraryPage` function five warmups plus 20 samples and wrapped that DB instance's statement `get/all` calls only. Clock: `performance.now()` in Electron Node 20.19.1, synchronously around each statement call; excludes IPC, prepare time, temporary-table setup, and JavaScript between statements. Timings are diagnostic phases, separate from the renderer IPC aggregate:

| 50k statement phase | Median / p95 |
| --- | ---: |
| Filtered model COUNT | 27.94 / 29.33 ms |
| Display item COUNT including archive GROUP BY | 41.72 / 44.08 ms |
| Ordered page SELECT and selection | 46.11 / 48.83 ms |
| Archive representative samples | 48.12 / 52.83 ms |
| Whole `getLibraryPage` function in Electron Node | 165.21 / 174.64 ms |

The display count statement runs the CTE with archive grouping; page and representative-sample phases also perform their own production query work, so these timings should not be added as mutually exclusive end-to-end components. The measured medians span four substantial synchronous statement phases (27.94-48.12 ms), while the query plan shows repeated scans and temp grouping/sorting; taken together they explain why the 50k grouped request exceeds the 150 ms median budget. This is phase evidence, not proof that any one statement alone causes the miss. The 50k renderer IPC aggregate remains the primary C10 comparison at 161.6/165.0 ms.

The query harness held a separate isolated scan at a subtree barrier while production query samples ran. The 25 ms main-process heartbeat recorded a maximum gap of 174.82 ms over 202 samples during the 50k grouped run, below C10's <=250 ms bound. The query median miss is owned by the D02 library-query owner; bounded follow-up: use the measured phase costs and query plan to optimize the grouped path while retaining the C10 target and response shape.

The earlier F02 capture used legacy `GET_FILES` and renderer-side collection path filtering, and explicitly omitted archive-summary grouping. Its 50k folder median/p95 of 322.6/336.8 ms and collection 317.3/322.7 ms are retained as historical evidence but are not equivalent to this production page measurement. The current flat run matches F02's fixture shape/call path, but invokes the integrated indexed GET_FILES implementation. D02's corrected source-shaped 50k grouped query was 79.71/81.35 ms with a 20% archive distribution; the current 161.6/165.0 ms result is a regression against that handoff measurement under the current fixture/runtime. Do not interpret fixtures as identical in archive group count or SQLite runtime.

## Query plan and bottleneck owner

The 50k `EXPLAIN QUERY PLAN` output includes: `SEARCH scopes USING COVERING INDEX sqlite_autoindex_file_scopes_1 (scope_path=?)`; `SEARCH f USING INTEGER PRIMARY KEY (rowid=?)`; `SCAN f`; `USE TEMP B-TREE FOR GROUP BY`; and `USE TEMP B-TREE FOR ORDER BY`. The bounded follow-up belongs to the D02 library-query owner: investigate the 42 ms display count/archive-grouping statement and 46-48 ms page/sample statements, then optimize the measured grouped path while preserving C10 and the result contract. No production SQL or target was changed in G02.

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

- The 5k delayed-subtree scan made its first indexed-subtree queryable batch in 5.7 ms while discovery remained held; main heartbeat max gap was 28.97 ms over 59 samples. This establishes first queryability, not that the first batch was painted visibly in the library UI.
- Dense preview first-frame duration was 283.1 ms; multipart first-frame duration was 28.4 ms. First-frame measurement is separate from render-submit (19.3 / 9.3 ms). The multipart run observed a 107 ms renderer long task, exceeding C10's <=100 ms CPU long-task target. Dense observed 0 ms max long task. These are CPU observer results; they do not measure GPU upload. Bounded follow-up owner is V04 preview assembly: identify the multipart task segment and split/yield CPU work if warranted, then rerun dense and multipart fixtures without relaxing 100 ms.
- Held preview replacement stopped its obsolete renderer in 21 ms; A/B were rejected and C resolved. The main and thumbnail renderer processes remained alive, and independent thumbnail work completed during the held parse.
- `metadata-worker.e2e.ts` passed separately (1/1 in 1.5 s): one large OBJ metadata item completed; scan-plus-metadata elapsed 392 ms; the 25 ms main heartbeat had 13 samples and max gap 36.04 ms. This is a responsive background-worker/heartbeat result, not a measured browse-query latency during metadata extraction.
- Thumbnail lifecycle, deletion/recovery, refresh, clear, revision, and cache invalidation E2Es passed. The dedicated 20-cycle test also passed its direct cache hit/regenerate-after-delete assertions.

The suite does not expose scan discovery queue depth or identify boundary progress events, and this run did not capture progress publication rate. Metadata extraction has a passing worker/heartbeat check, but no browse-query latency measurement during concurrent metadata extraction. Scope-index startup stall is also unmeasured. Queue/progress and startup requirements remain open for owner S; the <=4 Hz target remains unchanged.

## Remaining gaps and owners

- `scan-streaming.e2e.ts` passed for a synthetic 5k scan: first indexed subtree queryable in 5.7 ms and main heartbeat max gap 28.97 ms. The latest query run recorded 174.82 ms max heartbeat while querying 50k grouped pages. `metadata-worker.e2e.ts` passed for one large OBJ with 392 ms scan-plus-metadata completion and 36.04 ms max main heartbeat. Tests do not establish visible paint, discovery queue depth, <=4 Hz progress rate plus boundaries, browse latency during metadata work, or scope-index startup stall. `BackgroundJob` exposes discovered/indexed/metadata counts but no queue depth; scan progress omits depth. Owner S should add an isolated probe for peak bounded queue depth, timestamp progress including boundaries, and query latency during metadata work; startup/index stalls remain open.
- `preview-preparation.e2e.ts` passed: dense/multipart first-frame 283.1/28.4 ms, render-submit 19.3/9.3 ms, with a 107 ms multipart CPU long task (misses <=100 ms). For multipart, the first viewer frame is present while part-image placeholders and in-flight image work remain, so first-frame-before-images passes. It also checks publication cleanup after replacement/close. GPU upload is not measured separately from render-submit; V04 owns the bounded CPU-slicing follow-up and should add GPU timer-query instrumentation where supported, otherwise keep upload unverified.
- `preview-cancellation.e2e.ts` passed: obsolete renderer stopped in 21 ms, below 500 ms. One independent thumbnail request observed queue depth one then zero and completed, but this is not queue stress evidence. The E2E's BrowserWindow count and page PIDs do not expose utility worker processes; owner V/S needs a test-only process registry or operating-system child-process capture for worker-process inventory.
- The test wraps visible renderer `MessageChannel` and `Worker` constructors, but transferred ports are created in preload/main/owned preview contexts. It observes no visible-renderer channels; it cannot claim all app ports are zero. Explicit EventTarget add/remove operation counts do not provide a complete active listener count because native/internal listeners and abort-signal removal are not observable through the wrapper. Owners V/U should add lifecycle counters at the resource-owning preview runtime boundary if exact port/listener counts are required.
- Thumbnail PNG bytes are measured on disk, not in-memory image cache bytes. Owner T should expose a bounded cache byte/count diagnostic for image-memory accounting.
- Thumbnail lifecycle and invalidation E2Es passed, including refresh and missing-cache recovery. The new cycle test observed a cache hit and regenerated a deleted PNG; disk image-cache bytes were stable after warmup.
- CI timing calibration and Windows/Linux app runtime evidence remain open. Local app evidence here is macOS arm64 only.
- Optional real `base.3mf` supplementary run was not available or run; portable dense and multipart preview E2E fixtures were run.

## Outstanding evidence

The following C10/resource areas were not measured in this capture and must remain open:

- First visibly painted batch; scan queue depth, progress rate, browse-query latency during metadata extraction, and startup stalls from temporary scope/membership indexes.
- Dense renderer mesh assembly CPU long tasks (multipart observed a 107 ms miss); GPU upload/driver timing.
- Exact transferred port and active-listener counts across preload/main/owned preview contexts; utility worker-process inventory; in-memory image-cache bytes. Visible-renderer Worker object counters and BrowserWindow counts do not substitute for these.
- CI timing calibration and Windows/Linux app runtime evidence. The local app evidence in this report is macOS arm64 only.
- Optional real `base.3mf` supplementary run. Its absence is not treated as a pass; portable dense and multipart renderer fixtures were run.

Related coverage not included in the six-file command includes [preview-state](../../tests/product/e2e/preview-state.e2e.ts); it is not cited as passing evidence here. The metadata-worker suite passed separately and is reported above. The preview-preparation suite passed its product assertions, with the separate 107 ms long-task budget miss reported above.

## Reproduction

Run after Build and Electron native dependency rebuild:

```sh
node --import tsx tests/dev/performance-baseline.ts
npx playwright test tests/product/e2e/metadata-worker.e2e.ts
node -e 'const {spawnSync}=require("node:child_process");const r=spawnSync(require("electron"),["--import","tsx","--test","tests/product/unit/main/performanceFixtures.test.ts"],{cwd:process.cwd(),stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});process.exit(r.status??1)'
```

The initial direct-host-Node fixture test failed because the reusable worktree's `better-sqlite3` binary was built for Electron ABI 132 while host Node requires ABI 141. The prescribed Electron Node fixture test then passed (2/2). The latest baseline command completed successfully and emitted the numeric samples above. Final G02 status depends on coordinator integration, Build/full Product, the open measurements, and disposition of the 50k median miss.
