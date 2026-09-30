# Polytray final integration review

## Review state

**Prepared for Astra review. G02 remains REVIEW and G03 remains IN_PROGRESS.** This packet freezes the integrated source/test candidate at `2ee8523`; later local commits update performance evidence, the G02 handoff, and this packet without changing application or test code. The current documentation checkpoint is `2327c92` before this packet is committed.

No push, release, publication, or real user-library test was performed. The generated ZIP fixture was restored to SHA256 `6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`. Existing user edits in `AGENTS.md`, `DEV_CONTEXT.md`, `scripts/capture-readme-media.ts`, and untracked marketing/superpowers paths are preserved and excluded from the candidate.

## Integrated verification

- `npm run build` — PASS on the integrated application-source candidate; the later GPU probe is test-only.
- `PYTHON=/usr/bin/python3 npm run test:product` — PASS on source/test candidate `2ee8523`: 480 unit tests passed, 1 Windows-only skip; 70 E2Es passed, 1 optional real-`base.3mf` skip.
- Host: macOS 25.6, Apple M3 Ultra, arm64, Electron 34.5.8. Windows/Linux app runs and CI timing calibration were not performed.
- Focused GPU observer: `npx playwright test tests/product/e2e/preview-preparation.e2e.ts` — PASS, 1/1. The final integrated Product run also executed this observer.
- Focused preview lifecycle: `npx playwright test tests/product/e2e/performance-regressions.e2e.ts` — PASS, 1/1; preview service unit tests passed 10/10 under Electron Node.
- `git diff --check` — PASS for the final documentation and status updates.
- `npm run test:repo` — not fully green in this checkout. The two failing assertions in `tests/repo/structure/testOrganization.test.ts` are due to ignored local `.agent-tmp/`, root `.DS_Store`, and `docs/.DS_Store` artifacts; the other repo checks passed. Those files were preserved rather than deleted to satisfy this test.
- Responsive-layout harness: 80px bounded wheel steps, max 40; focused E2E and Product passed.
- Preview-state harness: an archive-card miss after a draft-only search clear reproduced once in three focused repetitions. The test now uses the toolbar's synchronous clear control and waits for the archive card; the archive assertions are unchanged. The focused repair repeat passed 3/3, then Product passed.

## Task and evidence matrix

The tracker is the status authority. The completed stream handoffs contain per-task commands, review evidence, and scope. `DONE` is preserved only where the tracker already accepted the task; G02 and G03 are not presented as complete.

| ID | Status | Evidence |
| --- | --- | --- |
| F01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/F01.md) |
| F02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/F02.md) |
| D01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/D01.md) |
| D02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/D02.md) |
| D03 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/D03.md) |
| S01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/S01.md) |
| S02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/S02.md) |
| S03 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/S03.md) |
| S04 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/S04.md) |
| S05 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/S05.md) |
| S06 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/S06.md) |
| T01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/T01.md) |
| T02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/T02.md) |
| T03 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/T03.md) |
| T04 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/T04.md) |
| V01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/V01.md) |
| V02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/V02.md) |
| V03 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/V03.md) |
| V04 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/V04.md) |
| V05 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/V05.md) |
| U01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/U01.md) |
| U02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/U02.md) |
| U03 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/U03.md) |
| U04 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/U04.md) |
| U05 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/U05.md) |
| U06 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/U06.md) |
| P01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/P01.md) |
| P02 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/P02.md) |
| P03 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/P03.md) |
| P04 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/P04.md) |
| G01 | DONE | [Handoff](../plans/2026-09-26-performance-ux/handoffs/G01.md) |
| G02 | REVIEW | [Performance evidence](./performance-ux-validation.md); [handoff](../plans/2026-09-26-performance-ux/handoffs/G02.md) |
| G03 | IN_PROGRESS | This packet; architecture-document reconciliation and Astra review remain |

## G02 evidence and limits

### Query and startup

Grouped 50k `GET_LIBRARY_PAGE` medians/p95 were 100.4/105.8 ms in the worker capture and 101.5/115.0 ms in an independent integrated-primary capture, meeting C10's <=150 ms median / <=250 ms p95. At 10k the grouped query was 20.7/21.8 ms. On a synthetic grouped 50k startup, the first legacy card was visible at 103.9 ms while the scope index was incomplete at cursor 9,250/50,000; the first paged request then took 1,364.3 ms. With the index preseeded, the first card appeared at 152.6 ms and the request took 100.1 ms. The UI now serves the exact unfiltered legacy snapshot during backfill and withholds incomplete collection results. The full duration to build every scope row was not separately timed.

### Scanning bounds

The 5k delayed-subtree run first exposed a queryable batch in 5.7 ms and the first card in 213.6 ms before the held subtree was released. Main heartbeat max gap was 30.48 ms; regular progress stayed at four events per rolling second plus first/terminal boundaries. Across 19,702 observations, discovery occupancy reached 50/50 and metadata occupancy reached 100/100, including active extraction. The consumer staging batch is capped at `batchSize`; the sequential producer awaits one yielded event at a time. C10 requires documented per-queue bounds, and both measured queues stayed within them. No aggregate cross-stage high-water or payload-memory sample was recorded; this remains optional memory/backlog characterization rather than a separate numeric C10 threshold.

### Preview and resource lifecycle

The 20-cycle E2E performed 20 actual 3MF open, STL replacement, and close cycles. It observed zero settled/minimized viewer frames, 20 WebGL contexts disposed after cleanup, 20 Workers terminated, three stable BrowserWindow pages, one stable Polytray Metadata utility process (PID gone after app close), and stable disk thumbnail-cache bytes at 6,712.

The renderer image-cache snapshot remained at 4 entries, 0 in-flight reads, and 9,048 encoded ASCII data-URL bytes (limits 128 entries / 16 MiB). This counts serialized URLs including the prefix; it does not estimate decoded pixel memory, GPU storage, or JS heap overhead.

After each 3MF parse and after each completed replacement/close cycle, the test collected 40 settled snapshots. Main and hidden preload bridges reported zero pending parses, archive reads, and hidden reply ports. Main preview-service job/reply-port/timer/archive/tombstone counts and preview-window settlement/timer counts were zero. The main renderer retained one requester owner with three WebContents callbacks; the hidden renderer retained one parse listener; the owned preview window count stayed at one. These are Polytray-owned maps, not raw `MessageChannelMain` create/close totals or a full Chromium/Electron listener census. The existing 3MF cancellation E2E also kept the main and thumbnail renderers alive while stopping obsolete preview work.

### GPU measurement

On the M3 Ultra, `EXT_disjoint_timer_query_webgl2` was supported on dense and multipart preview contexts. Dense buffer updates produced three valid, non-disjoint samples. Each reported 19,503,936 bufferData/bufferSubData API payload/allocation bytes; repeated submissions may be counted:

| Run | CPU buffer-update call span | GPU timer-query elapsed | CPU render-submit |
| --- | ---: | ---: | ---: |
| Focused sample 1 | 4.6 ms | 24,000 ns | 19.3 ms |
| Focused safety repeat | 5.1 ms | 22,249 ns | 19.2 ms |
| Integrated Product | 5.0 ms | 23,958 ns | 18.8 ms |

The GPU query starts at the first bufferData/bufferSubData call and ends immediately before the first draw. It records driver elapsed time for that command interval, not guaranteed physical transfer completion. Values remain per-run observations; no portable GPU budget is inferred. Multipart extension support was detected but the multipart upload was not timer-queried.

The 107 ms multipart CPU long task exceeded C10's <=100 ms reference target once. Three isolated repeats and the integrated Product run recorded 0 ms; the outlier remains unexplained and open with V04. Dense GPU upload is measured locally, but multipart and other GPU/vendor/platform behavior remain unverified.

## Remaining blockers and residuals

1. Windows/Linux app-level Product coverage and CI timing calibration remain outstanding. Only macOS 25.6 arm64 on an Apple M3 Ultra was exercised; supported-platform readiness is not established.
2. One multipart CPU long task measured 107 ms against C10's <=100 ms target. Three later isolated runs and Product measured 0 ms, but the original overrun is unexplained and remains open with V04.
3. The 20-cycle owner counters verify app-owned port/request/timer settlement. Raw MessageChannelMain creation/close totals and a full active EventTarget listener census remain outside their scope. Decoded image/GPU memory and multipart/other-vendor GPU timing also remain unmeasured.
4. Total cross-stage backlog was not directly sampled. C10 bounds the documented queues separately; the measured queues stayed within 50/100 capacities, and the consumer staging batch and sequential producer hold have source-derived bounds. Keep aggregate occupancy as optional memory characterization, not a missing numeric C10 threshold.
5. The incomplete-index first page took 1,364.3 ms after the user-facing first card appeared; the preseeded page took 100.1 ms. Full index-build duration was not recorded. Optional real `base.3mf` was not run; its absence is not a pass. Portable dense and multipart fixtures did run.
6. G03 documentation reconciliation remains in progress. `DEV_CONTEXT.md` and other user-edited local files were preserved, so this packet does not claim those changes were reconciled. G02/G03 remain incomplete pending Astra review and the platform/CPU residuals above.

No source push, release, publication, or real user-library test is authorized or performed. Review this packet against the [tracker](../plans/2026-09-26-performance-ux/tracker.md) before deciding whether G02/G03 status or follow-up work should change.
