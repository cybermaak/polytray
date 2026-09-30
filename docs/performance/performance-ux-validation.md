# Performance and resource validation (G02)

**Status: REVIEW — grouped warm-query targets pass; scope-index backfill still delays the paged reader, but legacy cards now appear while it runs.** Buffered discovery/metadata queues, Polytray utility processes, encoded in-memory thumbnail-cache bytes, application-owned preview bridge/timer state, and dense-model GPU timer-query samples have been measured. A combined cross-stage high-water, raw port create/close totals/full listener census, decoded image/GPU memory, and Windows/Linux/CI timing remain open. Per-stage bounds meet C10; the unmeasured aggregate is additional backlog/memory characterization, not a separate numeric C10 budget. One multipart CPU long-task overrun was not reproduced. This report does not claim all resource requirements are validated.

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

The grouped 50k warm query meets C10 at 100.4/105.8 ms in the worker capture. An independent capture on the integrated primary tree measured 101.5/115.0 ms; these are separate runs, not a combined statistic. The pre-follow-up worker run's first page took 1,617.9 ms from request to response because `startAfterRecovery` awaited the scope backfill before resolving startup readiness; the renderer's legacy startup read could not begin until afterward. The 25 ms heartbeat ran over an interval containing that cold request and the warm query series; its maximum gap was 121.74 ms over 134 samples, below 250 ms. This was a combined interval, not a separately windowed cold-call-only statistic.

### Scope-index startup follow-up (2026-09-29)

The main process now completes restore startup without waiting for scope-index backfill. The initial renderer `GET_FILES`, stats, and directory reads can finish first; when the first `GET_LIBRARY_PAGE` arrives, its existing readiness gate starts or joins the backfill and waits for completion. This preserves the paged reader's scope guarantee while allowing the legacy result snapshot to render during the backfill.

The focused readiness-only baseline used a synthetic grouped 50k database and measured one controlled page request in each scope state:

| Startup fixture | First DOM card after search input | Scope state at first card | Controlled `GET_LIBRARY_PAGE` after card | Legacy `GET_FILES` while page was pending |
| --- | ---: | --- | ---: | ---: |
| Incomplete 50k scope index | 103.9 ms | Incomplete, cursor 9,250/50,000; 92,500 scope rows | 1,364.3 ms | 7.1 ms; 50,000 total, 200 returned |
| Preseeded complete 50k scope index | 152.6 ms | Complete, cursor 50,000; 500,000 scope rows | 100.1 ms | Not separately sampled |

For the incomplete case, the legacy response arrived while the paged request was still pending. The startup E2E held the index after a partial 600-row batch and confirmed visible legacy cards. It then switched to a collection containing one path inside and one beyond the first 200 legacy rows: while the index remained held, the UI withheld both partial cards and displayed a loading result count; after release, both correct collection members appeared. It also walked every unfiltered display page and verified unique item keys across the reported total. The legacy snapshot is therefore exposed only while its exact unfiltered startup query key matches; row/annotation mutations invalidate it. Collection snapshots are withheld because filtering a globally paged `GET_FILES` slice would undercount membership.

The paged first request still waits about 1.36 seconds for the incomplete 50k scope index in this capture. The user-facing first card appears at 104 ms and remains available during that wait. The preseeded page request measured 100.1 ms; its separate startup card appeared at 152.6 ms. These are single diagnostics, not percentile samples. Warm grouped C10 remains evaluated from the 20-sample table above. This resolves the blank-startup concern without relaxing C10 or changing page-query semantics; D01/FileIndex and D02 retain the backfill-duration comparison as follow-up evidence.

The 50k query plan uses the covering `file_scopes` scope-path index and primary-key file lookup, then shows scans of the filtered/display CTE, a temporary B-tree for archive grouping, and a temporary B-tree for ordering. An Electron Node diagnostic invoked the unchanged `getLibraryPage` function five warmups plus 20 samples and wrapped that DB instance's statement `get/all` calls only. Clock: `performance.now()` in Electron Node 20.19.1, synchronously around each statement call; excludes IPC, prepare time, temporary-table setup, and JavaScript between statements. Timings are diagnostic phases, separate from the renderer IPC aggregate:

| 50k statement phase | Median / p95 |
| --- | ---: |
| Page counts, archive grouping, ordering and page selection statement | 53.57 / 56.19 ms |
| Archive representative samples statement | 48.47 / 50.17 ms |
| Whole `getLibraryPage` function in Electron Node | 102.54 / 105.78 ms |

The integrated query combines model count, display count with archive grouping, ordering and page selection into one statement with scalar subqueries; the statement wrapper cannot split those subqueries without duplicating or changing production SQL. Archive representative samples run in a separate statement. These diagnostic calls are in Electron Node and exclude IPC; the worker capture's 50k renderer IPC aggregate is 100.4/105.8 ms, while the independent integrated-primary capture is 101.5/115.0 ms.

The query harness held a separate isolated scan at a subtree barrier while production query samples ran. The worker capture's heartbeat maximum was 121.74 ms across the cold request and warm 50k grouped-query samples, below C10's <=250 ms bound. After D02 optimization commit `2000282`, the integrated-primary grouped 50k capture measured 101.5/115.0 ms, meeting C10. The earlier 161.6/165.0 ms capture is not a controlled before measurement because fixture/runtime details differ. The scope backfill duration comparison remains assigned to D01/FileIndex and D02; after the startup follow-up, the UI can show the legacy first card before that paged request finishes.

The earlier F02 capture used legacy `GET_FILES` and renderer-side collection path filtering, and explicitly omitted archive-summary grouping. Its 50k folder median/p95 of 322.6/336.8 ms and collection 317.3/322.7 ms are retained as historical evidence but are not equivalent to this production page measurement. The current flat run matches F02's fixture shape/call path, but invokes the integrated indexed GET_FILES implementation. D02's corrected source-shaped 50k grouped query was 79.71/81.35 ms with a 20% archive distribution; the later 100.4/105.8 ms worker and 101.5/115.0 ms integrated-primary captures are current C10 observations, not controlled before/after comparisons. Hardware matches; do not interpret fixtures as identical in archive group count or SQLite runtime.

## Query plan and bottleneck owner

The 50k `EXPLAIN QUERY PLAN` output includes `MATERIALIZE display_items`, a covering `file_scopes` scope-path lookup, primary-key file lookup, scans of the filtered/display CTEs, a temporary B-tree for GROUP BY, and a temporary B-tree for ORDER BY. Current warm grouped query meets the C10 target; no further D02 query optimization is required by this measurement. D01/FileIndex and D02 retain follow-up on cold backfill duration and compare it with the already-indexed page path.

The isolated dense parser diagnostic generated a 200,000-triangle, 10,000,084-byte STL. Electron Node `STLLoader` parsing took 6.19 ms in the latest run. This is parser-only timing; it is not renderer CPU assembly, GPU upload, or frame time.

## Renderer lifecycle and observable resource run

The new `tests/product/e2e/performance-regressions.e2e.ts` passed on the same macOS host. It ran 20 actual 3MF open, STL replacement, and close cycles. It observed zero explicit viewer-frame marks over a one-second settled interval, zero marks during a one-second minimized interval, and a restore catch-up frame. It recorded 20 WebGL contexts, all reported lost after cleanup; 3 stable BrowserWindow pages (main, thumbnail, and owned 3MF preview); and disk thumbnail-cache PNG bytes stable at 6,712 before and after the cycle loop. A read-only renderer cache snapshot, enabled only through a per-tab sessionStorage opt-in, reported 4 completed entries, 0 in-flight reads, and 9,048 encoded data-URL bytes before and after the cycles (caps: 128 entries/16,777,216 bytes). This byte count is ASCII data-URL serialization including its prefix; it is not decoded pixel storage, JS heap overhead, or GPU memory. The E2E instrumented 20 visible-renderer Workers and observed each terminate. The isolated utility-process registry recorded one `Polytray Metadata` process active after scan warmup, with the same PID through the cycles; it exited after app shutdown. That registry covers `utilityProcess.fork` children only.

After each 3MF parse and after each completed replacement/close cycle, the test polled 40 settled snapshots (two phases × 20 cycles). At both checkpoints, the hidden bridge explicitly reported 0 parses, 0 archive reads, 0 hidden ports, and 1 stable hidden parse listener. Main and hidden preload bridges had zero pending parses, archive reads, and hidden reply ports. Main preview service and window owners had zero jobs, reply ports, job timers, archive reads, tombstones/tombstone timers, settlements, and settlement timers. The preview window stayed at 1; the main renderer remained one tracked requester owner; and the hidden parse listener set stayed at 1. `trackPreviewRequesterLifecycle` installs three WebContents callbacks per requester owner: `destroyed`, `render-process-gone`, and `did-start-navigation`. These maps are precise counts of Polytray-owned pending work and listener owners, not enumeration of every MessagePort object or every active listener in Chromium/Electron. The visible renderer's own `MessageChannel` constructor count was zero; main `MessageChannelMain` resources are accounted for through the owned request/settlement maps.

The loop observed the viewer filename changing to the replacement identity, the viewer canvas disappearing, and `__POLYTRAY_CURRENT_MODEL` clearing after each close; maximum 3MF open/replace/close time was 3.61 s. Disk and in-memory cache stability was measured after all four fixture thumbnails were generated and the cache settled. The test also exercised a thumbnail cache hit and regenerated a deleted cached PNG. The zero-frame windows were measured directly before later interactions; later render marks include normal open/restore frames.

## Focused product evidence

Command:

```sh
npx playwright test tests/product/e2e/performance-regressions.e2e.ts tests/product/e2e/scan-streaming.e2e.ts tests/product/e2e/preview-preparation.e2e.ts tests/product/e2e/preview-cancellation.e2e.ts tests/product/e2e/thumbnail-lifecycle.e2e.ts tests/product/e2e/thumbnail-invalidation.e2e.ts
```

Result: 6 passed, 0 failed in 32.6 seconds on macOS 25.6 / M3 Ultra.

- The final Product 5k delayed-subtree scan made its first indexed-subtree queryable batch in 6.3 ms and the first file card became DOM-visible in 216.1 ms while the delayed subtree remained held. It captured 8 progress events: one first-batch boundary, one total-known terminal boundary, and at most 4 regular events in any rolling second. Main heartbeat max gap was 30.36 ms over 62 samples. This verifies a visible card before delayed discovery completes; compositor presentation time was not instrumented.
- The same 5k scan measured queue occupancy through 19,702 size-change observations: discovery buffer high-water **50/50**; metadata queue high-water **100/100**, including its active extraction. Two focused runs and the final Product run measured the same maxima. These are the buffered discovery events and queued-plus-running metadata work. They exclude the consumer's pending indexing batch and an event held by the producer while it waits for queue space, so they do not measure total pipeline backlog.
- A focused multipart preview run observed one 107 ms renderer long task, exceeding C10's <=100 ms CPU long-task target. Three subsequent isolated repeats and the final Product run recorded 0 ms max long tasks; the overrun remains an unexplained, non-reproduced outlier. The final integrated run's dense/multipart first frames were 282.3/30.7 ms and render-submit was 19.3/9.4 ms. The focused dense GPU probe described below separately measured buffer upload driver elapsed time; CPU render-submit remains a distinct measure. V04 owns investigation if the CPU outlier recurs; no threshold is relaxed.
- Held preview replacement stopped its obsolete renderer in 21 ms; A/B were rejected and C resolved. The main and thumbnail renderer processes remained alive, and independent thumbnail work completed during the held parse.
- `metadata-worker.e2e.ts` passed in the final integrated Product run: during one large OBJ scan, 285 production `GET_LIBRARY_PAGE` samples were taken while the scan job was running and `metadataCompleted` stayed zero before and after each call. Query latency median/p95 was 0.6/0.8 ms; the 25 ms main heartbeat max gap was 25.86 ms over 17 samples. A prior same-fixture run recorded 392 ms scan-plus-metadata total. This shows query latency while metadata work remained outstanding; it does not prove the worker was actively parsing during every sample.
- Thumbnail lifecycle, deletion/recovery, refresh, clear, revision, and cache invalidation E2Es passed. The dedicated 20-cycle test also passed its direct cache hit/regenerate-after-delete assertions.

The scan E2E measures progress rate, first-batch and total-known boundaries, and buffered queue high-water. At `scanning_batch_size` 50, the measured discovery buffer reached 50/50 events; metadata depth reached 100/100 including the active extraction. The probe does not include the consumer's pending indexing batch or the producer event waiting outside a full queue. `BackgroundJob` and public progress still expose no queue depth. The scope-index follow-up measures an incomplete 50k backfill through first-card display and records the page-query wait separately; it also measures a preseeded-ready page request, as detailed above.

After adding these probes, the performance baseline completed all six flat/grouped size combinations and fixture unit tests passed 3/3 under Electron Node, including the ready-scope fixture. On the queue-instrumented integrated tree, `npm run build` passed; `PYTHON=/usr/bin/python3 npm run test:product` passed through Node native rebuild, unit tests, Electron native rebuild, and Playwright E2E: 479 unit passes/1 Windows-only skip and 70 E2E passes/1 optional real-model skip. The full gate repeated the 50/100 queue maxima and 19,702 depth observations. The generated fixture was restored to baseline SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.

The isolated thumbnail-cache stats and preview-port lifecycle additions were made after that full Product run. The renderer-cache unit file passed 13/13, `npm run build` passed, and the 20-cycle 3MF resource E2E passed 1/1 with stable cache and per-cycle bridge/service counts. A full Product rerun on this exact preview-counter test tree remains coordinator-pending.

## Remaining gaps and owners

- `scan-streaming.e2e.ts` passed for a synthetic 5k scan: queryable batch at 6.3 ms, first file card DOM-visible at 216.1 ms before barrier release, 8 progress events with one first-batch and one total-known boundary, max regular progress 4/rolling second, and heartbeat max gap 30.36 ms over 62 samples. The isolated metrics hook observed 50/50 buffered discovery events and 100/100 metadata depth (including the active extraction) across 19,702 size-change observations in two focused runs and the final Product run. Pending indexing work and the producer blocked outside the discovery buffer are not included. `metadata-worker.e2e.ts` sampled page-query latency at 0.6/0.8 ms median/p95 while the scan was running and metadata remained outstanding; active parser overlap was not proven. The final Product run took 285 samples and recorded a 25.86 ms main heartbeat maximum over 17 samples; a separate direct run recorded one metadata completion in 392 ms and a 36.04 ms heartbeat maximum over 13 samples. The scope-index follow-up measured 1,364.3 ms for the controlled 50k page request after the first card was visible; the legacy card appeared at 103.9 ms while 9,250/50,000 file IDs were indexed. With a preseeded-complete index, the first card appeared at 152.6 ms and the controlled page request took 100.1 ms. D01/FileIndex and D02 own further backfill-duration comparison; the UI now exposes the valid unfiltered legacy snapshot during that wait.
- `preview-preparation.e2e.ts` passed; one earlier focused run observed a 107 ms multipart CPU long task, while three repeats and the final Product run recorded 0 ms. The final Product dense/multipart first frames were 282.2/28.5 ms; CPU render-submit was 18.8/9.2 ms. For multipart, the first viewer frame is present while part-image placeholders and in-flight image work remain, so first-frame-before-images passes. It also checks publication cleanup after replacement/close. Two focused and one integrated dense-model GPU samples on macOS 25.6 / Apple M3 Ultra / Electron 34.5.8 reported WebGL2 with `EXT_disjoint_timer_query_webgl2` supported. All counted 19,503,936 bufferData/bufferSubData API payload/allocation bytes (repeated submissions may be counted), ended the timer query immediately before the first draw, and produced valid, non-disjoint results. Ordered samples: CPU upload-call span 4.6/5.1/5.0 ms; driver timer-query elapsed 24,000/22,249/23,958 ns; CPU render-submit 19.3/19.2/18.8 ms. The GPU query measures driver elapsed time for the pre-first-draw buffer-update command interval, not guaranteed physical transfer-completion time; these samples do not establish a cross-hardware budget. Multipart extension support was detected but multipart was not GPU-timed. Retain the 107 ms CPU outlier and investigate if it recurs.
- `preview-cancellation.e2e.ts` passed: obsolete renderer stopped in 21 ms, below 500 ms. One independent thumbnail request observed queue depth one then zero and completed, but this is not queue stress evidence. Utility process inventory is measured separately by the 20-cycle resource E2E, scoped to `utilityProcess.fork` children.
- The 3MF-cycle probe reads isolated pending counts from the main and hidden preload bridges, preview service maps, and preview-window settlement map. It verifies that those Polytray-owned counts return to zero after parse and replacement/close, with requester-owner and hidden-listener counts stable. The visible renderer's `MessageChannel` constructor count remains zero; raw main `MessageChannelMain` creation/close totals and a complete active-listener census across Chromium/Electron remain unmeasured.
- The renderer's read-only cache diagnostic reports encoded data-URL entries/bytes under a per-tab sessionStorage opt-in. Decoded image/GPU memory and JS heap string/object overhead remain unmeasured and should not be inferred from those encoded-byte counts.
- Thumbnail lifecycle and invalidation E2Es passed, including refresh and missing-cache recovery. The new cycle test observed a cache hit and regenerated a deleted PNG; disk image-cache bytes were stable after warmup.
- CI timing calibration and Windows/Linux app runtime evidence remain open. Local app evidence here is macOS arm64 only.
- Optional real `base.3mf` supplementary run was not available or run; portable dense and multipart preview E2E fixtures were run.

## Outstanding evidence

The following C10/resource areas remain open or outside this capture:

- One aggregate cross-stage backlog high-water and compositor presentation time for the first batch. C10 requires each documented queue depth to stay bounded; discovery (capacity 50) and metadata (capacity 100 including active extraction) were sampled through the 5k scan and did not exceed those bounds. Source tracing shows the consumer staging batch is capped at `batchSize` and the sequential producer can hold at most one yielded event while awaiting queue space. No combined occupancy/payload-memory sample was recorded; retain that as optional aggregate memory characterization, not a separate numeric C10 threshold. The incomplete-index first page took 1,364.3 ms after its controlled request began versus 100.1 ms on a preseeded-complete index; the legacy first card appeared at 103.9 ms while backfill was incomplete. A full 50k index-build duration was not separately timed.
- Multipart renderer CPU long tasks (one 107 ms overrun was not reproduced); GPU timer-query coverage for multipart and other GPU/vendor/platform combinations. Three dense-model samples on this host are reported above; they do not establish a cross-hardware target.
- Raw transferred-port creation/close totals and a complete active-listener census across preload/main/owned preview contexts; decoded image/GPU memory and JS heap overhead; and any utility processes outside the measured `utilityProcess.fork` lifecycle. Settled bridge/service ownership-map counts do not enumerate Electron/Chromium internals.
- CI timing calibration and Windows/Linux app runtime evidence. The local app evidence in this report is macOS arm64 only.
- Optional real `base.3mf` supplementary run. Its absence is not treated as a pass; portable dense and multipart renderer fixtures were run.

Related coverage not included in the focused six-file command includes [preview-state](../../tests/product/e2e/preview-state.e2e.ts); it is not cited as separate focused evidence here. Both metadata-worker and preview-preparation suites passed in the integrated Product run. The prior 107 ms long-task observation is reported above.

## Reproduction

Run after Build and Electron native dependency rebuild:

```sh
node --import tsx tests/dev/performance-baseline.ts --scope-index-readiness-only
node --import tsx tests/dev/performance-baseline.ts
npx playwright test tests/product/e2e/metadata-worker.e2e.ts
npx playwright test tests/product/e2e/scope-backfill-browsing.e2e.ts
node -e 'const {spawnSync}=require("node:child_process");const r=spawnSync(require("electron"),["--import","tsx","--test","tests/product/unit/main/performanceFixtures.test.ts"],{cwd:process.cwd(),stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});process.exit(r.status??1)'
```

The initial direct-host-Node fixture test failed because the reusable worktree's `better-sqlite3` binary was built for Electron ABI 132 while host Node requires ABI 141. The prescribed Electron Node fixture test then passed (3/3 after adding ready-index coverage). The latest baseline command completed successfully and emitted the scope-readiness samples above. `npm run build` and full `PYTHON=/usr/bin/python3 npm run test:product` passed on integrated candidate `2ee8523`: 480 unit passes/1 Windows-only skip and 70 E2E passes/1 optional real-model skip. The final 20-cycle E2E measured 4 in-memory cache entries, 0 in-flight reads, and 9,048 encoded data-URL bytes both before and after cycles; disk PNG bytes stayed at 6,712. The test uses the synchronous toolbar search-clear action and awaited archive-card readiness after an intermittent failure reproduced in one of three focused repeats; its focused post-fix repeat passed 3/3.

The same Product gate exercised 20 actual 3MF→STL replacement→close cycles. At 40 checkpoints (after each 3MF parse and each completed replacement/close cycle), hidden bridge counts were explicitly 0 parses, 0 archive reads, 0 ports, and 1 listener. Main bridge request/read/port counts, preview-service jobs/reply ports/job timers/archive reads/tombstones/tombstone timers, and preview-window settlements/timers were zero. One requester owner remained active with its three lifecycle callbacks, the hidden parse-listener set remained at one, and the owned preview BrowserWindow stayed open and stable. The longest cycle in the Product log was 3,638 ms. These diagnostics read Polytray-owned maps; raw `MessageChannelMain` create/close totals and a complete Chromium/Electron listener census remain unmeasured. The utility-process inventory still recorded one Polytray metadata process through the cycles and its exit on app shutdown. The fixture was restored to baseline SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`. G02 remains REVIEW for raw port/listener totals, decoded image/GPU memory, multipart/other-hardware GPU coverage, and Windows/Linux/CI validation.
