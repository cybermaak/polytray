import { app, BrowserWindow, webContents, type MessagePortMain } from 'electron';
import { readFileSync } from 'node:fs';
import { join } from 'path';
import { IPC, type PreviewParseDispatchData, type PreviewParseSettlementData } from '../shared/types';
import type { PreviewParseRequest } from '../shared/previewContracts';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

export interface PreviewWindowRuntime {
  ensureReady(): Promise<BrowserWindow>;
  parse(request: PreviewParseRequest, responsePort: MessagePortMain, sourceBuffer?: ArrayBuffer): Promise<void>;
  markReady(senderId: number): boolean;
  markParseSettled(senderId: number, settlement: PreviewParseSettlementData): boolean;
  markLost(senderId: number, error?: Error): boolean;
  getCurrentWindow(): BrowserWindow | null;
  getPendingCounts(): Readonly<{ settlements: number; settlementTimers: number; previewWindows: number }>;
  restart(): Promise<void>;
  close(): Promise<void>;
}

export function canForceCrashPreviewRenderer(
  previewPid: number,
  protectedPids: readonly number[],
  selfPid = process.pid,
): boolean {
  return Array.isArray(protectedPids) && Number.isSafeInteger(previewPid) && previewPid > 0 &&
    Number.isSafeInteger(selfPid) && selfPid > 0 && previewPid !== selfPid && previewPid !== process.pid &&
    !protectedPids.some((pid) => Number.isSafeInteger(pid) && pid > 0 && pid === previewPid);
}

export function shouldUseElectronCrashFallback(platform: NodeJS.Platform, mayCrash: boolean, signalSent: boolean): boolean {
  // Linux requires the verified one-time owned-process signal; a missing claim falls through to window cleanup.
  return platform !== 'linux' && mayCrash && !signalSent;
}

export function canAcceptPreviewRenderer(platform: NodeJS.Platform, liveExclusiveOwner: boolean, hasSignalClaim: boolean): boolean {
  return liveExclusiveOwner && (platform !== 'linux' || hasSignalClaim);
}

export interface OwnedPreviewProcessState {
  generation: number;
  senderId: number;
  pid: number;
  selfPid: number;
  protectedPids: readonly number[];
  windowAlive: boolean;
  owners: readonly { senderId: number; pid: number }[];
  metricType: string | null;
  startTicks: string | null;
  argv: readonly string[];
  commandLineFingerprint: string;
  executablePath: string;
  userDataDir: string;
}

export interface OwnedPreviewProcessClaim {
  generation: number;
  senderId: number;
  pid: number;
  startTicks: string;
  executablePath: string;
  userDataDir: string;
  commandLineFingerprint: string;
  consumed: boolean;
}

export function parseLinuxPreviewProcessIdentity(stat: string, commandLine: Buffer): {
  pid: number;
  startTicks: string;
  argv: string[];
  commandLineFingerprint: string;
} | null {
  const open = stat.indexOf('(');
  const close = stat.lastIndexOf(')');
  if (open < 0 || close <= open || !/^[1-9]\d*$/.test(stat.slice(0, open).trim())) return null;
  const pid = Number(stat.slice(0, open).trim());
  const fields = stat.slice(close + 1).trim().split(/\s+/);
  const startTicks = fields[19]; // /proc/<pid>/stat field 22; fields[0] is process state (field 3).
  if (!Number.isSafeInteger(pid) || !startTicks || !/^[1-9]\d*$/.test(startTicks)) return null;
  const text = commandLine.toString('utf8');
  if (!text.endsWith('\0')) return null;
  const entries = text.split('\0').slice(0, -1);
  // Electron/Chromium on Linux can rewrite /proc cmdline as one space-separated entry.
  // Split only at switch boundaries; ambiguous values then fail the exact token checks below.
  const argv = entries.length === 1 && entries[0].includes(' --')
    ? entries[0].split(' --').map((part, index) => index === 0 ? part : `--${part}`)
    : entries;
  if (argv.length === 0 || argv.some((token) => token.length === 0)) return null;
  return { pid, startTicks, argv, commandLineFingerprint: commandLine.toString('hex') };
}

export function readLinuxPreviewProcessIdentity(
  pid: number,
  readFile: (target: string) => Buffer = (target) => readFileSync(target),
): ReturnType<typeof parseLinuxPreviewProcessIdentity> {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  try {
    const identity = parseLinuxPreviewProcessIdentity(
      readFile(`/proc/${pid}/stat`).toString('utf8'),
      readFile(`/proc/${pid}/cmdline`),
    );
    return identity?.pid === pid ? identity : null;
  } catch { return null; }
}

/** A signal claim is created only while one live webContents owns this renderer PID. */
export function captureOwnedPreviewProcess(state: OwnedPreviewProcessState): OwnedPreviewProcessClaim | null {
  if (!state || !Array.isArray(state.protectedPids) || !Array.isArray(state.owners) || !Array.isArray(state.argv) ||
      state.owners.some((owner) => !owner || !Number.isSafeInteger(owner.senderId) || !Number.isSafeInteger(owner.pid)) ||
      state.argv.some((token) => typeof token !== 'string') ||
      !state.commandLineFingerprint || !/^(?:[0-9a-f]{2})+$/.test(state.commandLineFingerprint) ||
      !Number.isSafeInteger(state.selfPid) || state.selfPid <= 0 ||
      !Number.isSafeInteger(state.generation) || state.generation <= 0 ||
      !Number.isSafeInteger(state.senderId) || state.senderId <= 0 ||
      !canForceCrashPreviewRenderer(state.pid, state.protectedPids, state.selfPid) ||
      !state.windowAlive || state.metricType !== 'Tab' ||
      !state.startTicks || !/^[1-9]\d*$/.test(state.startTicks) ||
      !state.executablePath || !state.userDataDir || state.argv[0] !== state.executablePath) return null;
  const matchingOwners = state.owners.filter((owner) => owner.pid === state.pid);
  if (matchingOwners.length !== 1 || matchingOwners[0].senderId !== state.senderId) return null;
  const typeTokens = state.argv.filter((token) => token.startsWith('--type='));
  const profileTokens = state.argv.filter((token) => token.startsWith('--user-data-dir='));
  if (typeTokens.length !== 1 || typeTokens[0] !== '--type=renderer' ||
      profileTokens.length !== 1 || profileTokens[0] !== `--user-data-dir=${state.userDataDir}`) return null;
  return {
    generation: state.generation, senderId: state.senderId, pid: state.pid,
    startTicks: state.startTicks, executablePath: state.executablePath,
    userDataDir: state.userDataDir, commandLineFingerprint: state.commandLineFingerprint, consumed: false,
  };
}

/** Re-read the live owner and /proc identity immediately before a one-time signal. */
export function signalOwnedPreviewProcess(
  claim: OwnedPreviewProcessClaim | null,
  readCurrent: () => OwnedPreviewProcessState | null,
  sendSignal: (pid: number) => void,
): boolean {
  if (!claim || claim.consumed) return false;
  claim.consumed = true;
  let current: OwnedPreviewProcessClaim | null;
  try {
    const state = readCurrent();
    current = state ? captureOwnedPreviewProcess(state) : null;
  }
  catch { return false; }
  if (!current || current.generation !== claim.generation || current.senderId !== claim.senderId ||
      current.pid !== claim.pid || current.startTicks !== claim.startTicks ||
      current.executablePath !== claim.executablePath || current.userDataDir !== claim.userDataDir ||
      current.commandLineFingerprint !== claim.commandLineFingerprint) return false;
  // Node lacks pidfd signalling. A process could exit and its PID be reused after this check;
  // keeping the live webContents bound and signalling synchronously narrows, but cannot erase, that race.
  try { sendSignal(claim.pid); return true; }
  catch { return false; }
}

function getWindowRendererPid(previewWindow: BrowserWindow): number {
  try {
    if (previewWindow.isDestroyed() || previewWindow.webContents.isDestroyed()) return 0;
    return previewWindow.webContents.getOSProcessId();
  } catch {
    return 0;
  }
}

function isExclusiveLivePreviewRenderer(previewWindow: BrowserWindow, pid: number): boolean {
  if (previewWindow.isDestroyed() || previewWindow.webContents.isDestroyed()) return false;
  try {
    const owners = webContents.getAllWebContents().filter((contents) =>
      !contents.isDestroyed() && contents.getOSProcessId() === pid);
    return owners.length === 1 && owners[0].id === previewWindow.webContents.id;
  } catch { return false; }
}

function readLinuxOwnedPreviewProcessState(
  previewWindow: BrowserWindow,
  generation: number,
  protectedPids: readonly number[],
): OwnedPreviewProcessState | null {
  if (process.platform !== 'linux' || previewWindow.isDestroyed() || previewWindow.webContents.isDestroyed()) return null;
  try {
    const pid = previewWindow.webContents.getOSProcessId();
    const identity = readLinuxPreviewProcessIdentity(pid);
    if (!identity) return null;
    const owners = webContents.getAllWebContents().map((contents) => ({
      senderId: contents.id,
      pid: contents.isDestroyed() ? 0 : contents.getOSProcessId(),
    }));
    const metrics = app.getAppMetrics().filter((metric) => metric.pid === pid);
    return {
      generation, senderId: previewWindow.webContents.id, pid, selfPid: process.pid,
      protectedPids, windowAlive: true, owners,
      metricType: metrics.length === 1 ? metrics[0].type : null,
      startTicks: identity.startTicks, argv: identity.argv,
      commandLineFingerprint: identity.commandLineFingerprint,
      executablePath: process.execPath,
      userDataDir: process.env.ELECTRON_USER_DATA ?? app.getPath('userData'),
    };
  } catch { return null; }
}

export function createElectronPreviewWindowManager(getProtectedProcessIds: () => readonly number[] = () => []): PreviewWindowRuntime {
  const settlements = new Map<string, { senderId: number; timer: ReturnType<typeof setTimeout>; deferred: Deferred<void> }>();
  const senderIds = new WeakMap<BrowserWindow, number>();
  const generations = new WeakMap<BrowserWindow, number>();
  const knownRendererPids = new WeakMap<BrowserWindow, number>();
  const ownedProcessClaims = new WeakMap<BrowserWindow, OwnedPreviewProcessClaim>();
  let nextGeneration = 0;
  const noteLifecycle = (stage: string, previewWindow: BrowserWindow, details: Record<string, unknown> = {}) => {
    if (process.env.POLYTRAY_ISOLATED_TEST !== '1') return;
    console.info('[PreviewWindowLifecycle]', {
      stage, generation: generations.get(previewWindow), senderId: senderIds.get(previewWindow),
      rendererPid: knownRendererPids.get(previewWindow), at: Date.now(), ...details,
    });
  };
  let manager: ReturnType<typeof createPreviewWindowManager<BrowserWindow>>;
  manager = createPreviewWindowManager<BrowserWindow>({
    create: () => {
      const previewWindow = new BrowserWindow({
        show: false,
        width: 1,
        height: 1,
        webPreferences: {
          preload: join(__dirname, '../preload/index.js'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          backgroundThrottling: false,
        },
      });
      const senderId = previewWindow.webContents.id;
      senderIds.set(previewWindow, senderId);
      generations.set(previewWindow, ++nextGeneration);
      previewWindow.webContents.on('render-process-gone', (_event, details) => {
        noteLifecycle('render-process-gone', previewWindow, { reason: details.reason });
        manager.markLost(senderId, new Error(`Preview renderer exited: ${details.reason}`));
      });
      previewWindow.on('closed', () => {
        noteLifecycle('window-closed', previewWindow);
        manager.markLost(senderId, new Error('Preview window closed'));
      });
      return previewWindow;
    },
    load: (previewWindow) => {
      const testHoldMs = process.env.POLYTRAY_ISOLATED_TEST === '1'
        ? Number.parseInt(process.env.POLYTRAY_PREVIEW_TEST_HOLD_MS ?? '0', 10)
        : 0;
      const testHoldRequestId = process.env.POLYTRAY_ISOLATED_TEST === '1'
        ? (process.env.POLYTRAY_PREVIEW_TEST_HOLD_REQUEST_ID ?? 'preview-A')
        : '';
      const testQuery = Number.isSafeInteger(testHoldMs) && testHoldMs > 0
        ? `?testHoldFirstParseMs=${testHoldMs}&testHoldRequestId=${encodeURIComponent(testHoldRequestId)}`
        : '';
      if (process.env.ELECTRON_RENDERER_URL) {
        return previewWindow.loadURL(`${process.env.ELECTRON_RENDERER_URL}/src/renderer/preview.html${testQuery}`);
      }
      return previewWindow.loadFile(join(__dirname, '../renderer/preview.html'), {
        query: testQuery ? {
          testHoldFirstParseMs: String(testHoldMs),
          testHoldRequestId,
        } : undefined,
      });
    },
    destroy: async (previewWindow) => {
      const senderId = senderIds.get(previewWindow);
      for (const [requestId, settlement] of settlements) {
        if (senderId === undefined || settlement.senderId !== senderId) continue;
        clearTimeout(settlement.timer);
        settlements.delete(requestId);
        settlement.deferred.reject(new Error('Preview renderer was stopped before settling the request'));
      }
      if (previewWindow.isDestroyed()) return;
      const closed = new Promise<void>((resolve) => previewWindow.once('closed', () => resolve()));
      const previewPid = getWindowRendererPid(previewWindow);
      if (previewPid > 0) knownRendererPids.set(previewWindow, previewPid);
      const protectedPids = getProtectedProcessIds();
      const mayCrash = canForceCrashPreviewRenderer(previewPid, protectedPids) &&
        (process.platform !== 'linux' || isExclusiveLivePreviewRenderer(previewWindow, previewPid));
      const claim = ownedProcessClaims.get(previewWindow) ?? null;
      ownedProcessClaims.delete(previewWindow);
      const generation = generations.get(previewWindow);
      const signaled = process.platform === 'linux' && mayCrash && generation !== undefined
        ? signalOwnedPreviewProcess(
          claim,
          () => readLinuxOwnedPreviewProcessState(previewWindow, generation, getProtectedProcessIds()),
          (pid) => process.kill(pid, 'SIGKILL'),
        )
        : false;
      noteLifecycle('destroy-start', previewWindow, { mayCrash, protectedPids, ownedSignalSent: signaled });
      if (shouldUseElectronCrashFallback(process.platform, mayCrash, signaled)) {
        try {
          previewWindow.webContents.forcefullyCrashRenderer();
          noteLifecycle('force-crash-requested', previewWindow);
        } catch (error) {
          noteLifecycle('force-crash-threw', previewWindow, { error: String(error) });
          // The owned renderer may already have exited.
        }
      }
      if (!previewWindow.isDestroyed()) previewWindow.destroy();
      let timeout: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([closed, new Promise<void>((resolve) => { timeout = setTimeout(resolve, 500); })]);
      if (timeout) clearTimeout(timeout);
      noteLifecycle('destroy-settled', previewWindow, { windowDestroyed: previewWindow.isDestroyed() });
    },
    senderId: (previewWindow) => previewWindow.webContents.id,
    isDestroyed: (previewWindow) => previewWindow.isDestroyed() || previewWindow.webContents.isDestroyed(),
    canForceCrash: (previewWindow) => {
      const pid = getWindowRendererPid(previewWindow);
      if (pid > 0) knownRendererPids.set(previewWindow, pid);
      const protectedPids = getProtectedProcessIds();
      const liveExclusiveOwner = canForceCrashPreviewRenderer(pid, protectedPids) &&
        (process.platform !== 'linux' || isExclusiveLivePreviewRenderer(previewWindow, pid));
      if (process.platform === 'linux') ownedProcessClaims.delete(previewWindow);
      if (liveExclusiveOwner && process.platform === 'linux') {
        const generation = generations.get(previewWindow);
        if (generation !== undefined) {
          const state = readLinuxOwnedPreviewProcessState(previewWindow, generation, protectedPids);
          const claim = state ? captureOwnedPreviewProcess(state) : null;
          if (claim) ownedProcessClaims.set(previewWindow, claim);
        }
      }
      const allowed = canAcceptPreviewRenderer(process.platform, liveExclusiveOwner, ownedProcessClaims.has(previewWindow));
      noteLifecycle('renderer-ready-check', previewWindow, { allowed, ownedSignalClaimed: ownedProcessClaims.has(previewWindow) });
      return allowed;
    },
    dispatch: (previewWindow, request, sourceBuffer, responsePort) => dispatchPreviewParse(
      previewWindow, request, responsePort, sourceBuffer, settlements,
    ),
  });
  return {
    ...manager,
    getPendingCounts() {
      const previewWindow = manager.getCurrentWindow();
      return Object.freeze({
        settlements: settlements.size,
        settlementTimers: settlements.size,
        previewWindows: previewWindow && !previewWindow.isDestroyed() ? 1 : 0,
      });
    },
    parse(request, responsePort, sourceBuffer) {
      return manager.parse(request, responsePort, sourceBuffer);
    },
    markParseSettled(senderId, settlement) {
      const currentWindow = manager.getCurrentWindow();
      if (!currentWindow || currentWindow.isDestroyed() || currentWindow.webContents.isDestroyed() ||
        currentWindow.webContents.id !== senderId) {
        return false;
      }
      const pending = settlements.get(settlement.requestId);
      if (!pending || pending.senderId !== senderId) return false;
      settlements.delete(settlement.requestId);
      clearTimeout(pending.timer);
      if (settlement.error) pending.deferred.reject(new Error(settlement.error));
      else pending.deferred.resolve();
      return true;
    },
  };
}

function dispatchPreviewParse(
  previewWindow: BrowserWindow,
  request: PreviewParseRequest,
  responsePort: MessagePortMain,
  sourceBuffer: ArrayBuffer | undefined,
  settlements: Map<string, { senderId: number; timer: ReturnType<typeof setTimeout>; deferred: Deferred<void> }>,
): Promise<void> {
  const completed = deferred<void>();
  const timer = setTimeout(() => {
    const pending = settlements.get(request.requestId);
    if (pending?.deferred === completed) {
      settlements.delete(request.requestId);
      completed.reject(new Error('Preview renderer did not acknowledge its response'));
    }
  }, 120_000);
  settlements.set(request.requestId, { senderId: previewWindow.webContents.id, timer, deferred: completed });
  const dispatch: PreviewParseDispatchData = { request, ...(sourceBuffer ? { sourceBuffer } : {}) };
  try {
    previewWindow.webContents.postMessage(IPC.GENERATE_PREVIEW_PARSE_REQUEST, dispatch, [responsePort]);
  } catch (error) {
    clearTimeout(timer);
    settlements.delete(request.requestId);
    responsePort.close();
    completed.reject(error instanceof Error ? error : new Error(String(error)));
  }
  return completed.promise;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

export interface PreviewWindowPlatform<WindowHandle> {
  create(): WindowHandle;
  load(window: WindowHandle, attempt: number): Promise<void>;
  destroy(window: WindowHandle): Promise<void>;
  senderId(window: WindowHandle): number;
  isDestroyed(window: WindowHandle): boolean;
  canForceCrash?(window: WindowHandle): boolean;
  dispatch(window: WindowHandle, request: PreviewParseRequest, sourceBuffer: ArrayBuffer | undefined, responsePort: MessagePortMain): Promise<void>;
}

export function createPreviewWindowManager<WindowHandle>(
  platform: PreviewWindowPlatform<WindowHandle>,
  readinessTimeoutMs = 10_000,
) {
  let currentWindow: WindowHandle | null = null;
  let currentSenderId: number | null = null;
  let ready = false;
  let readiness: Deferred<WindowHandle> | null = null;
  let readinessTimer: ReturnType<typeof setTimeout> | null = null;
  let createAttempt = 0;
  let disposed = false;
  let destroying: Promise<void> | null = null;

  function clearReadinessTimer() {
    if (!readinessTimer) return;
    clearTimeout(readinessTimer);
    readinessTimer = null;
  }

  function destroyWindow(window: WindowHandle) {
    const operation = (destroying ?? Promise.resolve()).then(() => platform.destroy(window)).catch((error) => {
      console.warn('[PreviewWindow] Failed to destroy the owned parser window:', error);
    });
    destroying = operation;
    void operation.finally(() => {
      if (destroying === operation) destroying = null;
    });
    return operation;
  }

  function failCurrent(window: WindowHandle, error: unknown) {
    if (currentWindow !== window) return;
    currentWindow = null;
    currentSenderId = null;
    ready = false;
    clearReadinessTimer();
    readiness?.reject(error);
    readiness = null;
    void destroyWindow(window);
  }

  function ensureReady(): Promise<WindowHandle> {
    if (disposed) return Promise.reject(new Error('Preview parser is shutting down'));
    if (destroying) return destroying.then(() => ensureReady());
    if (currentWindow && ready && !platform.isDestroyed(currentWindow)) {
      return Promise.resolve(currentWindow);
    }
    if (currentWindow && readiness) return readiness.promise;

    let window: WindowHandle;
    try {
      window = platform.create();
    } catch (error) {
      return Promise.reject(error);
    }
    currentWindow = window;
    currentSenderId = platform.senderId(window);
    ready = false;
    createAttempt += 1;
    const currentReadiness = deferred<WindowHandle>();
    readiness = currentReadiness;
    readinessTimer = setTimeout(() => {
      failCurrent(window, new Error('Preview parser readiness timed out'));
    }, readinessTimeoutMs);

    void platform.load(window, createAttempt).catch((error) => failCurrent(window, error));
    return currentReadiness.promise;
  }

  async function restart() {
    const oldWindow = currentWindow;
    currentWindow = null;
    currentSenderId = null;
    ready = false;
    clearReadinessTimer();
    readiness?.reject(new Error('Preview parser runtime was replaced'));
    readiness = null;
    if (oldWindow) await destroyWindow(oldWindow);
    else if (destroying) await destroying;
  }

  return {
    ensureReady,
    async parse(request: PreviewParseRequest, responsePort: MessagePortMain, sourceBuffer?: ArrayBuffer) {
      const owner = await ensureReady();
      if (currentWindow !== owner || !ready || platform.isDestroyed(owner)) {
        throw new Error('Preview parser runtime is no longer current');
      }
      return platform.dispatch(owner, request, sourceBuffer, responsePort);
    },
    markReady(senderId: number) {
      const window = currentWindow;
      if (!window || platform.isDestroyed(window) || currentSenderId !== senderId || !readiness) {
        return false;
      }
      if (platform.canForceCrash && !platform.canForceCrash(window)) {
        failCurrent(window, new Error('Preview parser renderer does not have an isolated, valid OS process'));
        return false;
      }
      ready = true;
      clearReadinessTimer();
      readiness.resolve(window);
      return true;
    },
    markLost(senderId: number, error = new Error('Preview parser renderer exited')) {
      const window = currentWindow;
      if (!window || currentSenderId !== senderId) return false;
      failCurrent(window, error);
      return true;
    },
    getCurrentWindow() {
      return currentWindow;
    },
    async restart() {
      await restart();
    },
    async close() {
      disposed = true;
      await restart();
    },
  };
}
