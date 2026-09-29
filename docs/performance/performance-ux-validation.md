# Performance and resource validation (G02)

**Status: REVIEW — incomplete evidence; 50k query median and multipart CPU long task remain over target.** This report includes production browse queries, a bounded query heartbeat probe, and selected scan/preview/thumbnail/lifecycle E2E evidence. It does not claim all resource requirements are validated.

## Reference query capture

Captured 2026-09-29 on macOS 25.6.0, Apple M3 Ultra, arm64, 28 logical CPUs, 96 GiB RAM; host Node 25.9.0, Electron 34.5.8 / Electron Node 20.19.1. The harness printed host Node's SQLite version (3.51.3); it did not independently capture Electron's SQLite version. F02 recorded 3.49.2 for Electron. Hardware/OS/Node/Electron match the reference; SQLite parity is unverified. This is local reference timing, not CI calibration.

The portable database has 600, 10,000, or 50,000 rows, 40 directories, mixed STL/OBJ/3MF, 20% archive membership across 12 ZIP summary groups, stable sort ties, and a 500-item page. Five warmups precede 20 samples. The timer is renderer `performance.now()` around `window.polytray.getLibraryPage`, including filtered model count, display-item count, archive grouping and representative samples, sorting, page selection, and IPC. A one-member last-only collection is measured separately through the same production API and SQL membership table.

| Rows | Display items | Folder median / p95 | C10 median / p95 | Last-only collection median / p95 |
| ---: | ---: | ---: | --- | ---: |
| 600 | 492 | 6.6 / 8.2 ms | Informational | 0.7 / 0.9 ms |
| 10,000 | 8,012 | 27.4 / 29.4 ms | Meets <=50 ms median | 3.3 / 3.4 ms |
| 50,000 | 40,012 | 164.9 / 173.9 ms | **Median misses <=150 ms by 14.9 ms; p95 meets <=250 ms** | 31.9 / 34.5 ms |

The 50k query plan uses the covering `file_scopes` scope-path index and primary-key file lookup, then shows scans of the filtered/display CTE, a temporary B-tree for archive grouping, and a temporary B-tree for ordering. A separate one-call `getLibraryPage` measurement was 176.26 ms. This establishes the grouped display-page path as the area for follow-up; it does not attribute elapsed time among model count, display count, archive aggregation, representative sampling, and page selection. Per-statement timing would require temporary instrumentation in the production query service and is not part of this G02 harness.

The query harness held a separate isolated scan at a subtree barrier while production query samples ran. The 25 ms main-process heartbeat recorded a maximum gap of 186.88 ms over 64 samples during the 50k run, below C10's <=250 ms bound. The query median miss is owned by the D02 library-query owner; bounded follow-up: time the model-count and display-count/group/page statements independently, then optimize the expensive pass while retaining the C10 target and response shape.

The earlier F02 capture used legacy `GET_FILES` and renderer-side collection path filtering, and explicitly omitted archive-summary grouping. Its 50k folder median/p95 of 322.6/336.8 ms and collection 317.3/322.7 ms are retained as historical evidence but are not equivalent to this production page measurement. D02's corrected source-shaped 50k grouped query was 79.71/81.35 ms with a 20% archive distribution; the current 164.9/173.9 ms result is a regression against that handoff measurement under the current fixture/runtime. Do not interpret the fixtures as identical in archive group count or SQLite runtime.

## Query plan and bottleneck owner

The 50k `EXPLAIN QUERY PLAN` output includes: `SEARCH scopes USING COVERING INDEX sqlite_autoindex_file_scopes_1 (scope_path=?)`; `SEARCH f USING INTEGER PRIMARY KEY (rowid=?)`; `SCAN f`; `USE TEMP B-TREE FOR GROUP BY`; and `USE TEMP B-TREE FOR ORDER BY`. The likely bounded follow-up belongs to the D02 library-query owner: time the count and grouped summary statements independently, then optimize the measured expensive pass while preserving the C10 target and result contract. No production SQL or target was changed in G02.

The isolated dense parser diagnostic generated a 200,000-triangle, 10,000,084-byte STL. Electron Node `STLLoader` parsing took 6.31 ms in the latest run. This is parser-only timing; it is not renderer CPU assembly, GPU upload, or frame time.

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
- Thumbnail lifecycle, deletion/recovery, refresh, clear, revision, and cache invalidation E2Es passed. The dedicated 20-cycle test also passed its direct cache hit/regenerate-after-delete assertions.

The suite does not expose scan discovery queue depth or identify boundary progress events, and this run did not capture progress publication rate. It also did not test metadata extraction responsiveness concurrently with the 5k scan or scope-index startup stall. Those requirements remain open for owner S; the <=4 Hz target remains unchanged.

## Remaining gaps and owners

- `scan-streaming.e2e.ts` passed for a synthetic 5k scan: first indexed subtree queryable in 5.7 ms and main heartbeat max gap 28.97 ms. The query run also recorded 186.88 ms max heartbeat while querying 50k. Tests do not establish visible paint, discovery queue depth, <=4 Hz progress rate plus boundaries, or concurrent metadata responsiveness. `BackgroundJob` exposes discovered/indexed/metadata counts but no queue depth; the scan progress event also omits depth. Owner S should add an isolated probe for peak bounded queue depth, timestamp progress including boundaries, and query/metadata responsiveness; startup/index stalls remain open.
- `preview-preparation.e2e.ts` passed: dense/multipart first-frame 283.1/28.4 ms, render-submit 19.3/9.3 ms, with a 107 ms multipart CPU long task (misses <=100 ms). It verifies placeholders while multipart thumbnails are in flight and publication cleanup after replacement/close. GPU upload is not measured separately from render-submit; V04 owns the bounded CPU-slicing follow-up and should add GPU timer-query instrumentation where supported, otherwise keep upload unverified.
- `preview-cancellation.e2e.ts` passed: obsolete renderer stopped in 21 ms, below 500 ms. One independent thumbnail request observed queue depth one then zero and completed, but this is not queue stress evidence. The E2E's BrowserWindow count and page PIDs do not expose utility worker processes; owner V/S needs a test-only process registry or operating-system child-process capture for worker-process inventory.
- The test wraps visible renderer `MessageChannel` and `Worker` constructors, but transferred ports are created in preload/main/owned preview contexts. It observes no visible-renderer channels; it cannot claim all app ports are zero. Explicit EventTarget add/remove operation counts do not provide a complete active listener count because native/internal listeners and abort-signal removal are not observable through the wrapper. Owners V/U should add lifecycle counters at the resource-owning preview runtime boundary if exact port/listener counts are required.
- Thumbnail PNG bytes are measured on disk, not in-memory image cache bytes. Owner T should expose a bounded cache byte/count diagnostic for image-memory accounting.
- Thumbnail lifecycle and invalidation E2Es passed, including refresh and missing-cache recovery. The new cycle test observed a cache hit and regenerated a deleted PNG; disk image-cache bytes were stable after warmup.
- CI timing calibration and Windows/Linux app runtime evidence remain open. Local app evidence here is macOS arm64 only.
- Optional real `base.3mf` supplementary run was not available or run; portable dense and multipart preview E2E fixtures were run.

## Outstanding evidence

The following C10/resource areas were not measured in this capture and must remain open:

- First visibly painted batch; scan queue depth, progress rate, concurrent metadata responsiveness, and startup stalls from temporary scope/membership indexes.
- Dense renderer mesh assembly CPU long tasks (multipart observed a 107 ms miss); GPU upload/driver timing.
- Rapid preview replacement/cancel under the <=500 ms target; multipart first-frame-before-part-images; exact transferred port/listener and worker-process counts; in-memory image-cache bytes.
- CI timing calibration and Windows/Linux app runtime evidence. The local app evidence in this report is macOS arm64 only.
- Optional real `base.3mf` supplementary run. Its absence is not treated as a pass; portable dense and multipart renderer fixtures were run.

Related coverage not included in the focused command includes [metadata-worker](../../tests/product/e2e/metadata-worker.e2e.ts) and [preview-state](../../tests/product/e2e/preview-state.e2e.ts); those tests are not cited as passing evidence here. The preview-preparation suite was run and passed its product assertions, with the separate 107 ms long-task budget miss reported above.

## Reproduction

Run after Build and Electron native dependency rebuild:

```sh
node --import tsx tests/dev/performance-baseline.ts
node -e 'const {spawnSync}=require("node:child_process");const r=spawnSync(require("electron"),["--import","tsx","--test","tests/product/unit/main/performanceFixtures.test.ts"],{cwd:process.cwd(),stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});process.exit(r.status??1)'
```

The initial direct-host-Node fixture test failed because the reusable worktree's `better-sqlite3` binary was built for Electron ABI 132 while host Node requires ABI 141. The prescribed Electron Node fixture test then passed (2/2). The latest baseline command completed successfully and emitted the numeric samples above. Final G02 status depends on coordinator integration, Build/full Product, the open measurements, and disposition of the 50k median miss.
