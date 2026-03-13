# CI Workflow Cleanup Design

## Summary

Simplify Polytray CI so there are two clear workflows:

- `Build` for every push to `main`
- `Release` for version tags

Both workflows should reuse the same shared setup/test logic and the same shared package logic. Release artifacts should keep Electron auto-update compatibility.

## Goals

- Remove the misleading "daily build" concept.
- Ensure build runs on every push to `main`.
- Keep release packaging distinct from regular build verification.
- Reduce duplicated workflow steps.
- Preserve Electron auto-update artifacts for shipped releases.

## Artifact Policy

Keep:

- `dist/*.exe`
- `dist/*.dmg`
- `dist/*-mac.zip`
- `dist/*.AppImage`
- `dist/*.blockmap`
- `latest*.yml`

Drop:

- `dist/*.snap`

Rationale:

- macOS `zip` is kept for updater compatibility even though `dmg` is the main end-user installer.
- `.blockmap` and `latest*.yml` are required for updater metadata/delta support.
- `snap` is unnecessary because it is not a configured target.

## Workflow Structure

### Build

- Trigger on push to `main`
- Allow manual dispatch
- Matrix across Ubuntu, macOS, and Windows
- Reuse setup/test action
- Reuse package action
- Upload short-lived workflow artifacts

### Release

- Trigger on tag push (`v*`)
- Allow manual dispatch
- Matrix across Ubuntu, macOS, and Windows
- Reuse setup/test action
- Reuse package action
- Upload short-lived workflow artifacts for debugging
- Upload packaged files to GitHub Releases

## Shared Actions

- Keep `.github/actions/setup-and-test/action.yml`
- Add `.github/actions/package-app/action.yml` for:
  - `npm run build`
  - `npx electron-builder --publish never`

## Verification

- `build.yml` no longer has `schedule` or `check-commits`
- `build.yml` is named `Build`
- `build.yml` and `release.yml` both use the shared setup and package actions
- Both workflows keep updater-compatible artifact patterns
