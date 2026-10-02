# DB-WORKER-01: dedicated SQLite worker and ordered database commands

Status: **DEFERRED**. User-directed architecture backlog, October 1, 2026.
Owner/schedule: assign one owner in a separate bounded design/implementation iteration;
this brief authorizes no implementation during P03. Track disposition in the
[restart tracker](2026-09-30-execution-reset-tracker.md).

## Problem and outcome

Windows scan writes block Electron main: the controlled 5k baseline measured a
372.16ms maximum heartbeat gap and 17,468ms after held-subtree release, with exactly
5,000 rows. An index transaction spent 357.45ms outside its 3.35ms SQL body; these
are different metrics. WAL128 retained stalls and made scanning 2.23x slower.
The October 2 user decision provisionally accepts <=850ms Windows and <=300ms Linux
scan heartbeat, with macOS <=250ms and the long-term reference goal <=250ms. Historical 953/1,672ms outliers remain failures.

Move database operations into a dedicated **Node worker_thread that owns the SQLite
connection**, prepared statements, migrations and transactions. Include blocking
reads, grouped queries, index maintenance, writes, pruning, annotations and restore
operations where they currently block main. Promise wrappers around synchronous
SQLite calls still running on main do not satisfy this task. Main retains IPC payload
validation, authorization/path containment, job orchestration and renderer publication.
Keep default database durability/checkpoint policy until separately justified evidence
supports a change; no checkpoint micro-tuning is part of this backlog.

## Command transport and ordering

Evaluate built-in worker `MessagePort` request/reply with structured-clone payloads
as the default. No external broker, new service or infrastructure is requested.
The bounded design must specify:

- Typed transaction-level commands, such as index batch, revision-guarded metadata
  apply, scan snapshot/prune, grouped library-page read, annotation update and restore
  apply/marker transition. Keep transaction scope inside one command; never expose a
  caller-controlled sequence of BEGIN/individual statements/COMMIT across messages.
- Correlation/request IDs, result/error envelopes and worker generation. Resolve each
  live request once. Define idempotency for retried mutation/restore commands and how
  to reconcile an unknown commit outcome after worker loss before replying.
- Bounded admission by command count and payload bytes, explicit backpressure and
  bounded result/page sizes. Define limits from measurements in the design iteration.
  Scan must await capacity; reads must not starve behind an unbounded scan backlog.
- Deterministic serialization for scan/watch/annotation/restore writes. Preserve
  causal order for one identity and root, and document any read/write scheduling
  policy. FIFO arrival alone does not replace freshness checks after asynchronous
  metadata extraction. Return post-commit mutations/revisions; publish only after ACK.
- Error propagation that preserves validation, stale/missing, cancellation, SQLite
  rollback, recoverable worker loss and fatal database failure as distinct outcomes.
  Surface failures to callers/jobs and gate further automatic mutation when recovery
  cannot establish a safe state; do not silently report success or replay writes.

## Data safety, cancellation and recovery

Keep content revision/generation checks atomic with mutations, including deletion
and recreation (ABA), stale thumbnail/metadata publication and scan pruning snapshots.
Preserve scan/watch conflict fences, canonical scopes, annotations and unrelated rows.
Read count/page/grouping and revision from a consistent transaction/snapshot where
required; moving a read must not change query semantics or leak broad file access.

Queued cancellation removes/rejects work before it starts. Once an atomic SQLite
transaction is in flight, let it commit or roll back and report the actual result;
caller cancellation fences later publication and follow-up work rather than claiming
committed data was undone. Define this separately for scan pause/cancel and restore's
before-commit cancellation boundary. Do not execute SQLite concurrently on a shared
connection from main and worker.

Preserve restore's cross-store protocol: journal preparation, SQLite annotation and
pending-annotation changes plus `database-applied` marker in one transaction, renderer
localStorage roll-forward, then acknowledgement/completion. Startup recovery must
consult the durable SQLite marker, preserve pending annotations/conflicts, repeat
renderer writes idempotently and gate scan/watch until recovery settles. Worker crash
or lost reply cannot cause main to infer commit status from a file journal alone.

On shutdown, stop admission, settle/cancel queued requests, drain the current atomic
transaction, close/checkpoint SQLite in its owner and await worker exit. Specify bounded
shutdown and exact owned-worker fallback, preserving database/WAL/journal files for
recovery. On worker crash, reject pending callers with explicit unknown-outcome handling;
restart only after migrations/integrity and interrupted-restore recovery establish a
safe state. Test both pre-commit and committed-before-reply crash windows.

## Acceptance evidence for the later iteration

Start with the existing recorded fixtures/diagnostics. Compare baseline and worker
candidate on the same recorded hardware/runtime, fixture and host, with controlled
repeat counts and no concurrent native rebuild/testing. Record main heartbeat maximum
and distribution, query latency, queue high water, first visible batch, total scan time
and rows/sec. Preserve exact 5,000-row completion and early visibility before release;
seek <=250ms scan heartbeat on reference hardware without sacrificing total throughput.
Report hosted-platform results separately; Linux300ms/Windows850ms are provisional
allowances, not the optimization goal. Keep query p95, query heartbeat, cancellation and other C10 targets.

Focused data-safety regressions must cover scan/watch races, stale revision/ABA results,
annotation survival, missing/partial-root pruning fences, pending annotation retry,
restore crash/commit-marker recovery, bounded backpressure, queued/in-flight cancellation,
shutdown and worker loss/unknown outcomes. Use private profiles, SQLite and synthetic
libraries. Follow with the required affected integration/platform milestone once the
architecture is coherent. Do not build a new test-harness framework or resource census.

Design checkpoint: after 45 minutes or two uninformative focused attempts, record
ownership/transport/recovery decisions, remaining risks and the smallest next patch.
Implementation is a separately scheduled iteration with its own bounded milestones.

## Required follow-up: provisional scan test replacement/recalibration

The user chose to keep the specific scan tests enabled, provisionally at Linux300ms,
Windows850ms and macOS250ms. After worker connection ownership/messaging is implemented,
replace or recalibrate the provisional heartbeat assertions using controlled same-host,
same-fixture/runtime before/after samples; record distributions, total scan time/rows per
second, first visibility, bounded admission and durability. Restore justified stricter
platform budgets toward the <=250ms recorded-reference goal. Keep functional, exact-row,
pruning/annotation/recovery, early-visible1s and unrelated query/preview assertions intact.
Do not disable whole E2Es or use blanket allow-failure to hide genuine CI errors.
Historical failures retain their original criteria; the new policy is not a speedup.
This follow-up belongs to the separately bounded DB-WORKER-01 iteration, not P06.
