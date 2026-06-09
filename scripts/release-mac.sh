#!/usr/bin/env bash
set -euo pipefail

# Local macOS release: build -> sign (Developer ID) -> notarize -> staple -> publish.
# Credentials are read from .env and never leave this machine.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ ! -f .env ]]; then
  echo "ERROR: .env not found. Copy .env.example to .env and fill it in." >&2
  exit 1
fi
set -a; source .env; set +a

# Fail fast if required vars are missing.
: "${APPLE_API_KEY:?set APPLE_API_KEY in .env}"
: "${APPLE_API_KEY_ID:?set APPLE_API_KEY_ID in .env}"
: "${APPLE_API_ISSUER:?set APPLE_API_ISSUER in .env}"
: "${APPLE_TEAM_ID:?set APPLE_TEAM_ID in .env}"

if [[ ! -f "$APPLE_API_KEY" ]]; then
  echo "ERROR: APPLE_API_KEY file not found at $APPLE_API_KEY" >&2
  exit 1
fi

# Publishing uses the gh CLI (its own auth) — confirm it is installed & logged in.
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install it: https://cli.github.com" >&2
  exit 1
fi
if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not logged in. Run 'gh auth login' first." >&2
  exit 1
fi

export POLYTRAY_SIGN_RELEASE=1

echo "==> Building JS sources"
npm run build

echo "==> Rebuilding native deps for Electron"
npx electron-builder install-app-deps

echo "==> Packaging, signing, notarizing, and stapling (mac only, no publish)"
# Build locally only. We upload via `gh` below instead of electron-builder's
# GitHub publisher, which races with the tag-triggered release workflow.
npx electron-builder --mac --publish never

echo "==> Verifying signature & notarization on built .app"
APP=$(find dist/mac* -maxdepth 1 -name "*.app" | head -n1)
if [[ -z "${APP:-}" ]]; then
  echo "ERROR: no built .app found under dist/mac*." >&2
  exit 1
fi
codesign --verify --deep --strict --verbose=2 "$APP"
if ! spctl --assess --type execute --verbose=4 "$APP"; then
  echo "ERROR: Gatekeeper rejected the app — not notarized. Aborting before upload." >&2
  exit 1
fi
if ! stapler validate "$APP"; then
  echo "ERROR: notarization ticket is not stapled to the app. Aborting before upload." >&2
  exit 1
fi

VERSION="$(node -p "require('./package.json').version")"
TAG="v${VERSION}"

# Collect the mac artifacts for this version.
ARTIFACTS=(
  "dist/Polytray-${VERSION}-arm64.dmg"
  "dist/Polytray-${VERSION}-arm64.dmg.blockmap"
  "dist/Polytray-${VERSION}-arm64-mac.zip"
  "dist/Polytray-${VERSION}-arm64-mac.zip.blockmap"
  "dist/latest-mac.yml"
)
for f in "${ARTIFACTS[@]}"; do
  if [[ ! -f "$f" ]]; then
    echo "ERROR: expected artifact missing: $f" >&2
    exit 1
  fi
done

# Ensure the GitHub release exists, then upload (clobbering any stale assets).
if ! gh release view "$TAG" >/dev/null 2>&1; then
  echo "==> Release $TAG not found — creating it"
  gh release create "$TAG" --title "$TAG" --generate-notes
fi

echo "==> Uploading signed mac artifacts to release $TAG"
gh release upload "$TAG" --clobber "${ARTIFACTS[@]}"

echo "==> Done. Signed, notarized mac artifacts uploaded to release $TAG:"
gh release view "$TAG" --json assets -q '.assets[].name'
