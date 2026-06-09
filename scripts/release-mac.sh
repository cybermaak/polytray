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

if [[ ! -f "$APPLE_API_KEY" ]]; then
  echo "ERROR: APPLE_API_KEY file not found at $APPLE_API_KEY" >&2
  exit 1
fi

# Derive the GitHub token from the existing gh CLI login (not stored in .env).
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI not found. Install it or log in: https://cli.github.com" >&2
  exit 1
fi
if ! GH_TOKEN="$(gh auth token)"; then
  echo "ERROR: 'gh auth token' failed. Run 'gh auth login' first." >&2
  exit 1
fi
if [[ -z "$GH_TOKEN" ]]; then
  echo "ERROR: 'gh auth token' returned empty. Run 'gh auth login' first." >&2
  exit 1
fi
export GH_TOKEN

export POLYTRAY_SIGN_RELEASE=1

echo "==> Building JS sources"
npm run build

echo "==> Rebuilding native deps for Electron"
npx electron-builder install-app-deps

echo "==> Packaging, signing, notarizing, and publishing (mac only)"
npx electron-builder --mac --publish always

echo "==> Verifying signature & notarization on built .app"
APP=$(find dist/mac* -maxdepth 1 -name "*.app" | head -n1)
if [[ -n "${APP:-}" ]]; then
  codesign --verify --deep --strict --verbose=2 "$APP"
  spctl --assess --type execute --verbose=4 "$APP" || true
  stapler validate "$APP" || true
fi

echo "==> Done. Signed, notarized artifacts are in dist/ and published to GitHub."
