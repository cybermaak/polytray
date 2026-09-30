# Astra integration acceptance review

## Decision

Reviewed application/test candidate: `2ee8523`. Review packet: `2f47336`.
The implementation is ready for a bounded readiness follow-up, not a claim
that all 33 tasks or supported-platform validation are complete. Keep G02
in REVIEW and G03 IN_PROGRESS. No push or release is approved.

This review checks the final evidence against C10/G02/G03, inspects the
resource-accounting and preview measurement code, and checks the latest
query optimization and integration handoffs. It is not an exhaustive new
audit of every implementation commit. Graph tools were unavailable;
targeted source reads were used instead.

## Findings requiring follow-up

1. **G03 documentation is unfinished.** `DEV_CONTEXT.md` still says S05 is
   next, describes 3MF parsing in the thumbnail window, and describes the
   former scan ownership. G03 explicitly owns architecture and user-workflow
   reconciliation. Existing user edits must be preserved, but they do not
   prevent producing a narrow, reviewable documentation patch. Complete this
   local work before final handback; do not stage unrelated user hunks or use
   the previously rejected index-blob workaround.

2. **Supported-platform readiness is unverified.** The recorded 480 unit and
   70 E2E passes are macOS evidence with two documented skips. Windows/Linux
   app-level Product runs and CI timing calibration remain outstanding.
   G03 step 5 expressly requires supported-platform evidence for readiness.
   Record the exact platform/runtime and candidate for any later runs. Do not
   push a branch or alter Actions just to obtain evidence without applicable
   authorization. This is an evidence limitation, not a demonstrated platform
   defect.

3. **The CPU outlier remains an open performance finding.** The 107 ms
   multipart observation cannot be erased by subsequent zero-long-task runs.
   C10 places the 100 ms numeric budget in its dense-preview row; V04 also
   requires both large single and multipart fixtures to remain interactive
   within the recorded target. Describe this nuance rather than asserting
   that C10 has a separate multipart numeric row. A bounded follow-up should
   attempt attribution using the unchanged fixture and retained raw evidence.
   If not reproduced, report that result and uncertainty without speculative
   production changes or indefinite test retries.

   `preview-preparation.e2e.ts` logs long-task durations but asserts first
   frame <3 seconds, not the 100 ms reference ceiling. Therefore a green
   Product run is not independently a pass of the CPU reference target.
   Keep reference measurements separate from calibrated shared-runner gates.

## Residual classifications accepted

- **Aggregate backlog:** C10 requires queue depths within documented bounds;
  it does not specify an aggregate queue-memory threshold. Measured 50/100
  per-stage occupancy plus source-derived bounds for staging and the
  sequential producer satisfy that narrow claim. A combined occupancy or
  heap estimate is optional characterization, not an additional invented gate.
- **Ports and listeners:** the 20-cycle test exercises real 3MF requests and
  samples the application-owned bridge, job, settlement and requester maps.
  Source cleanup clears timers, removes callbacks and closes reply ports.
  These checks support bounded ownership/settlement. They are not a raw
  native port-close census: `replyPorts` and `jobTimers` derive from `jobs.size`,
  and settlement timers derive from `settlements.size`. Keep those limitations
  explicit; do not expand scope to a complete Chromium listener census.
- **Cache memory:** 9,048 encoded data-URL bytes and four completed entries
  are valid cache-accounting observations against the encoded 16 MiB/128
  limits. They are not total process, decoded image or GPU memory.
- **GPU timing:** retain the dense driver-query interval with its exact scope.
  It is not physical transfer-completion time or a portable GPU budget.
  Multipart/other-vendor evidence remains unmeasured; no further numeric
  threshold should be invented.
- **Cold startup:** the early legacy first card and the still-pending paged
  request are different measurements. The fallback improves visible startup;
  it does not establish a 100 ms cold paged response or full index-build time.
- **Optional real model:** unavailable `base.3mf` is a disclosed optional
  workload, not a blocker by itself and not a passing result.

## Verification and next ownership

The application/test/config paths have no tracked changes between `2ee8523`
and packet commit `2f47336`; subsequent differences are documentation.
The fixture SHA256 was independently checked as
`6ca9f75c11d9330221860ade9fdb641cac6728a9f0a4cc1883989506a39fc109`.
`git diff --check 2ee8523..2f47336` passed. This review reuses the recorded
Build/Product results; it does not claim a new full-suite execution.

Luna owns the narrow G03 reconciliation and the bounded CPU-evidence
follow-up, sequentially. External platform evidence stays explicit. Return
the updated packet with exact changes after the last passing gate, without
rerunning unchanged application suites for prose-only edits. Astra reviews
the resulting delta and final readiness statement.
