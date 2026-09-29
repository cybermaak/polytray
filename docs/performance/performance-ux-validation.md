# Performance and resource validation (G02)

**Status: REVIEW — incomplete evidence; 50k C10 median remains over target.** This report covers the corrected production browse query benchmark only. It does not claim the remaining scan, preview, GPU, or lifecycle resource requirements are validated.

## Reference query capture

Captured 2026-09-29 on macOS 25.6.0, Apple M3 Ultra, arm64, 28 logical CPUs, 96 GiB RAM; host Node 25.9.0, Electron 34.5.8 / Electron Node 20.19.1. The harness printed host Node's SQLite version (3.51.3); it did not independently capture Electron's SQLite version. F02 recorded 3.49.2 for Electron. Hardware/OS/Node/Electron match the reference; SQLite parity is unverified. This is local reference timing, not CI calibration.

The portable database has 600, 10,000, or 50,000 rows, 40 directories, mixed STL/OBJ/3MF, 20% archive membership across 12 ZIP summary groups, stable sort ties, and a 500-item page. Five warmups precede 20 samples. The timer is renderer `performance.now()` around `window.polytray.getLibraryPage`, including filtered model count, display-item count, archive grouping and representative samples, sorting, page selection, and IPC. A one-member last-only collection is measured separately through the same production API and SQL membership table.

| Rows | Display items | Folder median / p95 | C10 median / p95 | Last-only collection median / p95 |
| ---: | ---: | ---: | --- | ---: |
| 600 | 492 | 6.5 / 7.6 ms | Informational | 0.7 / 0.9 ms |
| 10,000 | 8,012 | 27.4 / 29.4 ms | Meets <=50 ms median | 3.3 / 3.4 ms |
| 50,000 | 40,012 | 161.5 / 171.3 ms | **Median misses <=150 ms by 11.5 ms; p95 meets <=250 ms** | 29.7 / 31.8 ms |

The 50k query plan uses the covering `file_scopes` scope-path index and primary-key file lookup, then shows scans of the filtered/display CTE, a temporary B-tree for archive grouping, and a temporary B-tree for ordering. A separate one-call `getLibraryPage` measurement was 156.47 ms. This establishes the grouped display-page path as the area for follow-up; it does not attribute elapsed time among model count, display count, archive aggregation, representative sampling, and page selection. Per-statement timing would require temporary instrumentation in the production query service and is not part of this G02 harness.

The earlier F02 capture used legacy `GET_FILES` and renderer-side collection path filtering, and explicitly omitted archive-summary grouping. Its 50k folder median/p95 of 322.6/336.8 ms and collection 317.3/322.7 ms are retained as historical evidence but are not equivalent to this production page measurement. D02's corrected source-shaped 50k grouped query was 79.71/81.35 ms with a 20% archive distribution; the current 161.5/171.3 ms result is a regression against that handoff measurement under the current fixture/runtime. Do not interpret the fixtures as identical in archive group count or SQLite runtime.

## Query plan and bottleneck owner

The 50k `EXPLAIN QUERY PLAN` output includes: `SEARCH scopes USING COVERING INDEX sqlite_autoindex_file_scopes_1 (scope_path=?)`; `SEARCH f USING INTEGER PRIMARY KEY (rowid=?)`; `SCAN f`; `USE TEMP B-TREE FOR GROUP BY`; and `USE TEMP B-TREE FOR ORDER BY`. The likely bounded follow-up belongs to the D02 library-query owner: time the count and grouped summary statements independently, then optimize the measured expensive pass while preserving the C10 target and result contract. No production SQL or target was changed in G02.

The isolated dense parser diagnostic generated a 200,000-triangle, 10,000,084-byte STL. Electron Node `STLLoader` parsing took 6.13 ms in the latest run. This is parser-only timing; it is not renderer CPU assembly, GPU upload, or frame time.

## Outstanding evidence

The following C10/resource areas were not measured in this capture and must remain open:

- Main heartbeat gaps while the query runs; scan heartbeat, first committed/visible batch before delayed second-subtree completion, queue depth, progress rate, and metadata responsiveness.
- Thumbnail hit, miss, and refresh behavior; startup stalls from temporary scope/membership indexes.
- Settled visible frames over a full one-second quiet interval, minimize/restore, dense renderer mesh assembly and CPU long tasks, plus GPU upload/driver timing.
- Rapid preview replacement/cancel under the <=500 ms target; multipart first-frame-before-part-images; at least 20 open/close/replace cycles measuring contexts, ports, listeners, worker processes, and image-cache bytes.
- CI timing calibration and Windows/Linux app runtime evidence. The local app evidence in this report is macOS arm64 only.
- Optional real `base.3mf` supplementary run. Its absence is not treated as a pass; portable dense and multipart parser fixtures exist but were not run as renderer workloads here.

Existing product tests cover some adjacent contracts (including [scan-streaming](../../tests/product/e2e/scan-streaming.e2e.ts), [metadata-worker](../../tests/product/e2e/metadata-worker.e2e.ts), [preview-state](../../tests/product/e2e/preview-state.e2e.ts), and [preview-preparation](../../tests/product/e2e/preview-preparation.e2e.ts)); G02 has not rerun those tests on this integrated revision, so they are not cited as passing evidence for this report.

## Reproduction

Run after Build and Electron native dependency rebuild:

```sh
node --import tsx tests/dev/performance-baseline.ts
node -e 'const {spawnSync}=require("node:child_process");const r=spawnSync(require("electron"),["--import","tsx","--test","tests/product/unit/main/performanceFixtures.test.ts"],{cwd:process.cwd(),stdio:"inherit",env:{...process.env,ELECTRON_RUN_AS_NODE:"1"}});process.exit(r.status??1)'
```

The initial direct-host-Node fixture test failed because the reusable worktree's `better-sqlite3` binary was built for Electron ABI 132 while host Node requires ABI 141. The prescribed Electron Node fixture test then passed (2/2). The latest baseline command completed successfully and emitted the numeric samples above. Final G02 status depends on coordinator integration, Build/full Product, the open measurements, and disposition of the 50k median miss.
