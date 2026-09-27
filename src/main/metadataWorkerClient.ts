import { join } from "path";
import { utilityProcess, type UtilityProcess } from "electron";
import type { MetadataSummary } from "./metadata";

export interface MetadataWorkerRequest {
  requestId: string;
  fileId: number;
  contentRevision: number;
  filePath: string;
  extension: string;
}
export interface MetadataWorkerResult { requestId: string; summary: MetadataSummary; }
export interface MetadataWorkerClientOptions {
  timeoutMs?: number;
  maxQueuedRequests?: number;
  spawn?: () => UtilityProcess;
}
type Pending = { request: MetadataWorkerRequest; resolve: (value: MetadataSummary) => void; reject: (error: Error) => void; signal?: AbortSignal; retries: number; abort?: () => void; };

function isMetadataSummary(value: unknown): value is MetadataSummary {
  if (!value || typeof value !== "object") return false;
  const summary = value as Partial<MetadataSummary>;
  if (!Number.isSafeInteger(summary.vertexCount) || (summary.vertexCount as number) < 0
    || !Number.isSafeInteger(summary.faceCount) || (summary.faceCount as number) < 0) return false;
  if (summary.dimensions === null) return true;
  if (!summary.dimensions || typeof summary.dimensions !== "object") return false;
  const { x, y, z } = summary.dimensions;
  return [x, y, z].every((dimension) => typeof dimension === "number" && Number.isFinite(dimension) && dimension >= 0);
}

export class MetadataWorkerClient {
  private child: UtilityProcess | null = null;
  private childExitHandler: ((code: number) => void) | null = null;
  private starting: Promise<UtilityProcess> | null = null;
  private active: Pending | null = null;
  private readonly queue: Pending[] = [];
  private closed = false;
  private timer: NodeJS.Timeout | null = null;
  private readonly timeoutMs: number;
  private readonly maxQueued: number;
  constructor(private readonly options: MetadataWorkerClientOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? 30_000;
    this.maxQueued = options.maxQueuedRequests ?? 2;
  }

  async extract(request: MetadataWorkerRequest, options: { signal?: AbortSignal } = {}): Promise<MetadataSummary> {
    if (this.closed) throw new Error("Metadata worker client is shut down");
    if (options.signal?.aborted) throw new Error("Metadata extraction cancelled");
    while (!this.closed && this.queue.length + (this.active ? 1 : 0) >= this.maxQueued + 1) {
      await new Promise<void>((resolve, reject) => {
        const wake = () => { options.signal?.removeEventListener("abort", abort); resolve(); };
        const abort = () => {
          const index = this.spaceWaiters.indexOf(wake);
          if (index >= 0) this.spaceWaiters.splice(index, 1);
          reject(new Error("Metadata extraction cancelled"));
        };
        this.spaceWaiters.push(wake);
        options.signal?.addEventListener("abort", abort, { once: true });
      });
      if (this.closed) throw new Error("Metadata worker client is shut down");
      if (options.signal?.aborted) throw new Error("Metadata extraction cancelled");
    }
    return new Promise<MetadataSummary>((resolve, reject) => {
      const pending: Pending = { request, resolve, reject, signal: options.signal, retries: 0 };
      if (options.signal) {
        pending.abort = () => this.cancel(pending);
        options.signal.addEventListener("abort", pending.abort, { once: true });
      }
      this.queue.push(pending);
      this.pump();
    });
  }

  private readonly spaceWaiters: Array<() => void> = [];
  private wakeSpace() { this.spaceWaiters.splice(0).forEach((resolve) => resolve()); }
  private async start(): Promise<UtilityProcess> {
    if (this.child) return this.child;
    if (this.starting) return this.starting;
    this.starting = new Promise<UtilityProcess>((resolve, reject) => {
      const child = (this.options.spawn ?? (() => utilityProcess.fork(join(__dirname, "metadataWorker.js"), [], { serviceName: "Polytray Metadata" })))();
      const timeout = setTimeout(() => { cleanup(); child.kill(); reject(new Error("Metadata worker readiness timed out")); }, this.timeoutMs);
      const onStartupExit = (code: number) => { if (!this.child) { cleanup(); reject(new Error(`Metadata worker exited during startup (${code})`)); } };
      const onSpawn = () => {
        clearTimeout(timeout); child.off("spawn", onSpawn); child.off("exit", onStartupExit);
        const onExit = (code: number) => this.handleExit(child, onExit, code);
        child.on("message", this.onMessage); child.on("exit", onExit);
        this.child = child; this.childExitHandler = onExit; resolve(child);
      };
      const cleanup = () => { clearTimeout(timeout); child.off("spawn", onSpawn); child.off("exit", onStartupExit); };
      child.once("spawn", onSpawn);
      child.once("exit", onStartupExit);
    }).finally(() => { this.starting = null; });
    return this.starting;
  }
  private readonly onMessage = (input: unknown) => {
    const pending = this.active;
    if (!pending) return;
    if (!input || typeof input !== "object") {
      this.clearActive(pending);
      pending.reject(new Error("Metadata worker returned an invalid response"));
      this.pump();
      return;
    }
    const message = input as { requestId?: unknown; summary?: unknown; error?: unknown };
    if (message.requestId !== pending.request.requestId) {
      if (typeof message.requestId === "string") return;
      this.clearActive(pending);
      pending.reject(new Error("Metadata worker returned an invalid response"));
      this.pump();
      return;
    }
    this.clearActive(pending);
    if (typeof message.error === "string" && message.error.length) pending.reject(new Error(message.error));
    else if (isMetadataSummary(message.summary)) pending.resolve(message.summary);
    else pending.reject(new Error("Metadata worker returned an invalid response"));
    this.pump();
  };
  private handleExit(child: UtilityProcess, handler: (code: number) => void, code: number) {
    if (this.child !== child) return;
    child.off("message", this.onMessage);
    child.off("exit", handler);
    this.child = null;
    this.childExitHandler = null;
    const pending = this.active;
    if (pending) {
      const retry = pending.retries++ < 1 && !pending.signal?.aborted && !this.closed;
      this.clearActive(pending, retry);
      if (retry) this.queue.unshift(pending);
      else pending.reject(new Error(`Metadata worker exited (${code})`));
    }
    this.pump();
  }
  private terminateChild() {
    const child = this.child;
    if (!child) return;
    child.off("message", this.onMessage);
    if (this.childExitHandler) child.off("exit", this.childExitHandler);
    this.child = null;
    this.childExitHandler = null;
    child.kill();
  }
  private clearActive(pending: Pending, preserveAbort = false) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (!preserveAbort) this.clearAbort(pending);
    this.active = null;
    this.wakeSpace();
  }
  private clearAbort(pending: Pending) {
    if (pending.signal && pending.abort) pending.signal.removeEventListener("abort", pending.abort);
    pending.abort = undefined;
  }
  private cancel(pending: Pending) {
    if (this.active === pending) {
      this.clearActive(pending);
      pending.reject(new Error("Metadata extraction cancelled"));
      this.terminateChild();
    } else {
      const index = this.queue.indexOf(pending);
      if (index >= 0) { this.queue.splice(index, 1); this.clearAbort(pending); pending.reject(new Error("Metadata extraction cancelled")); this.wakeSpace(); }
    }
    this.pump();
  }
  private pumping = false;
  private async pump() {
    if (this.pumping || this.closed || this.active || !this.queue.length) return;
    this.pumping = true;
    const pending = this.queue.shift()!;
    this.wakeSpace();
    if (pending.signal?.aborted) { pending.reject(new Error("Metadata extraction cancelled")); this.pumping = false; void this.pump(); return; }
    this.active = pending;
    try {
      const child = await this.start();
      if (this.active !== pending || this.closed || pending.signal?.aborted) {
        this.terminateChild();
        this.clearAbort(pending);
        pending.reject(new Error("Metadata extraction cancelled"));
        return;
      }
      this.timer = setTimeout(() => {
        if (this.active !== pending) return;
        this.clearActive(pending); this.terminateChild();
        pending.reject(new Error("Metadata extraction timed out")); this.pump();
      }, this.timeoutMs);
      child.postMessage(pending.request);
    } catch (error) {
      if (this.active === pending) this.clearActive(pending);
      else this.clearAbort(pending);
      pending.reject(error instanceof Error ? error : new Error(String(error)));
    }
    finally { this.pumping = false; if (!this.active) void this.pump(); }
  }
  async shutdown() {
    if (this.closed) return;
    this.closed = true;
    const error = new Error("Metadata worker client is shut down");
    for (const pending of this.queue.splice(0)) { this.clearAbort(pending); pending.reject(error); }
    if (this.active) { const pending = this.active; this.clearActive(pending); pending.reject(error); }
    this.wakeSpace();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.terminateChild();
    await this.starting?.catch(() => undefined);
  }
}
