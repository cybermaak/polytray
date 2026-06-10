# Auto-Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add background auto-update to Polytray using `electron-updater`, surfaced as a calm, clickable badge in the sidebar footer.

**Architecture:** A self-contained main-process module (`src/main/updater.ts`) drives `electron-updater`: it auto-downloads new versions, checks on launch and every 4 hours, and forwards a single normalized status (`idle | downloading | ready | error`) to the renderer over IPC. A small preload bridge exposes `onUpdateStatus` / `installUpdate` on the existing `window.polytray` API. A new `UpdateBadge` React component in the sidebar footer renders nothing while idle, shows download progress, and becomes a "Restart to update" button when an update is ready (calls `quitAndInstall`). Updates already publish correctly (signed/notarized mac `.zip` + `latest*.yml` on GitHub Releases), so no build-config changes are needed.

**Tech Stack:** Electron 34, electron-updater, electron-log, React 19, electron-vite, TypeScript.

**Behavior (decided in brainstorming):**
- Auto-download in the background; apply on next quit (`autoInstallOnAppQuit`).
- Clickable badge lets the user install & restart immediately.
- Check on launch + every 4 hours.
- Active only in packaged builds (`app.isPackaged`); disabled in dev.
- On error/offline: log and stay hidden (never nag, never modal).

---

## File Structure

- **Create** `src/main/updater.ts` — all `electron-updater` wiring; exposes `initUpdater(getWindow)` and a pure `clampPercent` helper for testing.
- **Modify** `src/shared/types.ts` — add `UPDATE_STATUS` / `UPDATE_INSTALL` IPC channels and the `UpdateStatusData` type.
- **Modify** `src/main/index.ts` — call `initUpdater(getMainWindow)` once after the main window exists.
- **Modify** `src/preload/index.ts` — expose `onUpdateStatus` and `installUpdate`.
- **Modify** `src/renderer/globals.d.ts` — add the two methods to `PolytrayAPI`.
- **Create** `src/renderer/components/UpdateBadge.tsx` — the sidebar-footer badge.
- **Modify** `src/renderer/components/Sidebar.tsx` — mount `<UpdateBadge/>` in the footer.
- **Create** `tests/product/unit/updateStatus.test.ts` — unit test for the pure helper.

---

### Task 1: Add the electron-updater dependency

**Files:**
- Modify: `package.json` (dependencies)

- [ ] **Step 1: Install**

Run: `npm install electron-updater@^6`
Expected: `electron-updater` appears under `"dependencies"` in `package.json` and `package-lock.json` updates.

- [ ] **Step 2: Verify it resolves**

Run: `node -e "require('electron-updater'); console.log('electron-updater OK')"`
Expected: `electron-updater OK`

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "build: add electron-updater dependency"
```

---

### Task 2: Add IPC channels and the status type

**Files:**
- Modify: `src/shared/types.ts` (the `IPC` const, around lines 52–44, and the payload-types section below it)

- [ ] **Step 1: Add the two channels**

In the `IPC` object, under the `// send channels (main → renderer)` group add:

```ts
  UPDATE_STATUS: "update-status",
```

And in the invoke-channels group (near the other `invoke` channels at the top of the object) add:

```ts
  UPDATE_INSTALL: "update-install",
```

- [ ] **Step 2: Add the payload type**

In the "IPC Payload Types" section add:

```ts
/** UPDATE_STATUS event payload (main → renderer) */
export interface UpdateStatusData {
  state: "idle" | "downloading" | "ready" | "error";
  /** Version string of the available/ready update, when known. */
  version?: string;
  /** Download progress 0–100, present only while state === "downloading". */
  percent?: number;
}
```

- [ ] **Step 3: Verify types compile**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/shared/types.ts
git commit -m "feat(update): add update IPC channels and status type"
```

---

### Task 3: Create the updater module (with a unit-tested pure helper)

**Files:**
- Create: `src/main/updater.ts`
- Create: `tests/product/unit/updateStatus.test.ts`

- [ ] **Step 1: Write the failing test for the pure helper**

Create `tests/product/unit/updateStatus.test.ts`:

```ts
import { test } from "node:test";
import assert from "node:assert/strict";
import { clampPercent } from "../../../src/main/updater";

test("clampPercent rounds to an integer", () => {
  assert.equal(clampPercent(42.7), 43);
});

test("clampPercent floors below 0 to 0", () => {
  assert.equal(clampPercent(-5), 0);
});

test("clampPercent caps above 100 at 100", () => {
  assert.equal(clampPercent(140), 100);
});
```

- [ ] **Step 2: Run it to confirm it fails**

Run: `node scripts/run-node-tests.mjs tests/product/unit/updateStatus.test.ts`
Expected: FAIL — `Cannot find module .../src/main/updater` (module not created yet).

- [ ] **Step 3: Implement `src/main/updater.ts`**

```ts
import { app, BrowserWindow } from "electron";
import { autoUpdater } from "electron-updater";
import log from "electron-log/main";
import { IPC, UpdateStatusData } from "../shared/types";

/** Check for updates every 4 hours while the app is running. */
const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

/** Round a raw progress value to an integer percentage in [0, 100]. */
export function clampPercent(raw: number): number {
  return Math.min(100, Math.max(0, Math.round(raw)));
}

/**
 * Wire up electron-updater. No-op in dev (unsigned / unpackaged builds cannot
 * auto-update). Forwards a normalized status to the renderer and installs on
 * quit by default; the renderer can request an immediate install.
 */
export function initUpdater(getWindow: () => BrowserWindow | null): void {
  if (!app.isPackaged) {
    log.info("[updater] skipped — not a packaged build");
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (data: UpdateStatusData) => {
    getWindow()?.webContents.send(IPC.UPDATE_STATUS, data);
  };

  autoUpdater.on("download-progress", (p) => {
    send({ state: "downloading", percent: clampPercent(p.percent) });
  });
  autoUpdater.on("update-downloaded", (info) => {
    send({ state: "ready", version: info.version });
  });
  autoUpdater.on("error", (err) => {
    log.error("[updater] error", err);
    send({ state: "idle" }); // stay hidden — never nag
  });

  const check = () => {
    autoUpdater.checkForUpdates().catch((err) => {
      log.error("[updater] checkForUpdates failed", err);
    });
  };

  check();
  setInterval(check, CHECK_INTERVAL_MS);
}

/** Quit and install a downloaded update immediately. */
export function installUpdate(): void {
  autoUpdater.quitAndInstall();
}
```

- [ ] **Step 4: Run the test to confirm it passes**

Run: `node scripts/run-node-tests.mjs tests/product/unit/updateStatus.test.ts`
Expected: PASS (3/3).

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add src/main/updater.ts tests/product/unit/updateStatus.test.ts
git commit -m "feat(update): add electron-updater module with status forwarding"
```

---

### Task 4: Register the IPC install handler and start the updater

**Files:**
- Modify: `src/main/index.ts`

- [ ] **Step 1: Import the module**

Add near the other main-process imports at the top of `src/main/index.ts`:

```ts
import { ipcMain } from "electron";
import { IPC } from "./../shared/types";
import { initUpdater, installUpdate } from "./updater";
```

(If `ipcMain` or `IPC` is already imported in this file, do not duplicate — reuse the existing import.)

- [ ] **Step 2: Register the install handler once, at startup**

In the same place the app registers its other one-time startup wiring (after `app.whenReady()` resolves and the main window is created — i.e. right after the `createWindow()`/`mainWindow = new BrowserWindow(...)` flow), add:

```ts
  ipcMain.handle(IPC.UPDATE_INSTALL, () => {
    installUpdate();
  });
  initUpdater(getMainWindow);
```

`getMainWindow` already exists in this file (defined near line 96).

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/main/index.ts
git commit -m "feat(update): start updater and register install handler"
```

---

### Task 5: Expose the update API in preload and types

**Files:**
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/globals.d.ts`

- [ ] **Step 1: Add the import**

In `src/preload/index.ts`, add `UpdateStatusData` to the existing import from `"../shared/types"`.

- [ ] **Step 2: Expose the two methods**

Inside the `contextBridge.exposeInMainWorld("polytray", { ... })` object (it starts at line 151), add a new group:

```ts
  // Auto-update
  onUpdateStatus: (callback: (data: UpdateStatusData) => void) =>
    onChannel<UpdateStatusData>(IPC.UPDATE_STATUS, callback),
  installUpdate: () => ipcRenderer.invoke(IPC.UPDATE_INSTALL),
```

(`onChannel` is the existing helper defined near the top of the file; `IPC` and `ipcRenderer` are already imported.)

- [ ] **Step 3: Declare them on the API type**

In `src/renderer/globals.d.ts`, inside the `PolytrayAPI` interface (the one referenced by `interface Window { polytray: PolytrayAPI }` near line 86), add:

```ts
  onUpdateStatus: (
    callback: (data: UpdateStatusData) => void,
  ) => () => void;
  installUpdate: () => Promise<void>;
```

Ensure `UpdateStatusData` is imported at the top of `globals.d.ts` from `"../shared/types"` (add it to the existing import list).

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/preload/index.ts src/renderer/globals.d.ts
git commit -m "feat(update): expose onUpdateStatus and installUpdate to renderer"
```

---

### Task 6: Sidebar-footer update badge

**Files:**
- Create: `src/renderer/components/UpdateBadge.tsx`
- Modify: `src/renderer/components/Sidebar.tsx`

- [ ] **Step 1: Create the component**

Create `src/renderer/components/UpdateBadge.tsx`:

```tsx
import { useEffect, useState } from "react";
import type { UpdateStatusData } from "../../shared/types";

/**
 * Sidebar-footer auto-update indicator.
 * - idle/error: renders nothing
 * - downloading: shows a calm progress line
 * - ready: a clickable "Restart to update" button (installs immediately)
 */
export function UpdateBadge() {
  const [status, setStatus] = useState<UpdateStatusData>({ state: "idle" });

  useEffect(() => {
    return window.polytray.onUpdateStatus(setStatus);
  }, []);

  if (status.state === "idle" || status.state === "error") {
    return null;
  }

  if (status.state === "downloading") {
    return (
      <div className="update-badge update-badge--downloading">
        Downloading update… {status.percent ?? 0}%
      </div>
    );
  }

  // state === "ready"
  return (
    <button
      type="button"
      className="update-badge update-badge--ready"
      onClick={() => window.polytray.installUpdate()}
      title={
        status.version
          ? `Restart to install ${status.version}`
          : "Restart to install update"
      }
    >
      ⬆ Restart to update
    </button>
  );
}
```

- [ ] **Step 2: Add styles**

Locate the stylesheet the sidebar already uses (check `Sidebar.tsx` for its CSS import — e.g. a co-located `.css` or the global renderer stylesheet). Append:

```css
.update-badge {
  margin: 8px;
  padding: 6px 10px;
  border-radius: 8px;
  font-size: 12px;
  text-align: center;
  width: calc(100% - 16px);
  box-sizing: border-box;
}
.update-badge--downloading {
  color: #aab;
  background: #1d2430;
}
.update-badge--ready {
  color: #dffbe6;
  background: #2f6f4f;
  border: none;
  cursor: pointer;
}
.update-badge--ready:hover {
  background: #357d59;
}
```

(Match the surrounding stylesheet's conventions; if the sidebar uses CSS modules, adapt the class names accordingly and import them in the component.)

- [ ] **Step 3: Mount it in the sidebar footer**

In `src/renderer/components/Sidebar.tsx`, import the component:

```tsx
import { UpdateBadge } from "./UpdateBadge";
```

Render `<UpdateBadge />` at the very bottom of the sidebar's root container, after the existing footer/nav content, so it sits at the bottom of the sidebar column.

- [ ] **Step 4: Typecheck and build the renderer**

Run: `npm run typecheck`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/UpdateBadge.tsx src/renderer/components/Sidebar.tsx
git commit -m "feat(update): add sidebar-footer update badge"
```

---

### Task 7: Manual end-to-end verification (cannot run in CI/dev)

Auto-update only works in a packaged, signed build downloading a *newer* published release, so this is a documented manual checklist — not an automated test.

**Files:**
- Create: `docs/auto-update-testing.md`

- [ ] **Step 1: Write the checklist**

Create `docs/auto-update-testing.md`:

```markdown
# Verifying auto-update end-to-end

Auto-update requires a packaged build and a newer published release; it does not
run in `dev` or CI. Test with two consecutive real (or rc) releases.

1. Build & publish version **A** (e.g. `vX.Y.Z-rc.1`): bump `version`, tag, push,
   then `npm run release:mac` (see docs/RELEASING.md). Install that build locally.
2. Build & publish version **B** (`vX.Y.Z-rc.2`) the same way.
3. Launch the installed **A**. Within a few seconds the updater checks GitHub,
   downloads B in the background, and the sidebar badge shows
   "Downloading update… N%", then "⬆ Restart to update".
4. Click the badge → the app quits and relaunches as **B**. Confirm the version
   (in About / logs at `~/.polytray/logs/app.log`).
5. Also confirm the passive path: with B downloaded, instead of clicking, just
   quit and reopen — it should come back as B.
6. Clean up the rc releases: `gh release delete vX.Y.Z-rc.1 --cleanup-tag --yes`
   (and rc.2).

Tip: set `POLYTRAY_LOGGING=1` to see `[updater]` lines in the log during testing.
```

- [ ] **Step 2: Commit**

```bash
git add docs/auto-update-testing.md
git commit -m "docs: add auto-update end-to-end testing checklist"
```

---

## Self-Review Notes

- **Behavior coverage:** auto-download + install-on-quit (Task 3: `autoDownload`/`autoInstallOnAppQuit`), clickable immediate install (Task 4 handler + Task 6 button → `quitAndInstall`), launch + 4h checks (Task 3 `check()` + interval), dev-disabled (Task 3 `app.isPackaged` guard), no-nag on error (Task 3 error → `idle`). ✓
- **Type/name consistency:** `UpdateStatusData` and the `IPC.UPDATE_STATUS` / `IPC.UPDATE_INSTALL` channels are defined once in Task 2 and referenced unchanged in Tasks 3–6; the renderer reads `window.polytray.onUpdateStatus` / `installUpdate`, matching the preload exposure and the `PolytrayAPI` declaration. ✓
- **No build-config changes needed** — publishing already emits signed mac `.zip` + `latest*.yml`; the updater consumes the existing GitHub release feed.
- **Open implementation detail to confirm during execution:** the exact stylesheet/CSS convention the sidebar uses (plain CSS vs. CSS modules) — Task 6 Step 2 instructs the implementer to match it.
