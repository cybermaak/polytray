# Polytray release runbook

This is the end-to-end checklist for preparing a Polytray app release, refreshing
its real screenshots/demo, publishing platform packages, and updating the marketing
page. It consolidates the previous macOS-only release guide. Last reconciled:
October 2, 2026 against the repository's current scripts and the central website's
publishing record.

**Reading or editing this document does not authorize publication.** App main pushes,
release tags/assets, and website deployment each need the user's applicable
permission. Preserve unrelated working-tree changes. The commands below are a
procedure to execute deliberately, not a script to run wholesale.

## Ownership and sources of truth

| Concern | Owner / executable source |
| --- | --- |
| Product version, source and verification | This repository; `package.json`, `package-lock.json`, `AGENTS.md` |
| Windows/Linux release packages | [Release workflow](../.github/workflows/release.yml), triggered by `v*` tags |
| Signed/notarized macOS packages | [release-mac.sh](../scripts/release-mac.sh), run locally on the maintainer's Mac |
| Screenshot and animated demo | [capture-readme-media.ts](../scripts/capture-readme-media.ts) |
| Social preview template | [social-card.html](marketing/social-card.html), retained outside published assets |
| Public promotional page | `cybermaak.github.io/public/polytray/` in the separate website repository |
| Hosting, domain and rollback controls | Website [publishing.md](https://github.com/cybermaak/cybermaak.github.io/blob/main/docs/publishing.md) |

The website records its central cutover as completed on September 24, 2026, including
retirement of the app repositories' separate Pages publishers. Recheck relevant
workflow/settings state before publishing; the presence of legacy `site/` or
`.github/workflows/pages.yml` here does not make it the current deployment target.
Do not reactivate the legacy publisher, repeat the cutover, or change DNS/Cloudflare
as part of a routine release. The website's existing hosting exceptions remain
owned by its publishing document.

## 1. Select the release candidate

- [ ] Choose the version and whether this is a stable or prerelease delivery.
- [ ] Identify the last public release with `gh release view --repo cybermaak/polytray`.
- [ ] Inspect `git status --short --branch`; use a clean, isolated release checkout
      if the primary checkout contains user work. Do not silently stash, commit or
      discard unrelated changes.
- [ ] Record the exact source SHA and compare it with the last published tag.
- [ ] Review remaining product failures and known issues. A previous green run on
      another SHA is not a passing gate for this candidate.
- [ ] Update version metadata together, without creating a tag yet:

```sh
# Replace X.Y.Z with the approved version; this edits package.json and package-lock.json.
npm version X.Y.Z --no-git-tag-version
```

Do not infer the next version from this guide or the current package version.
Draft public release notes from the actual diff; do not announce already-released
features as new. Use `docs/release-notes/` for versioned notes; a local
`next-release-draft.md`, when present, is preparation material until reviewed.
Keep internal diagnostics and unresolved validation details out of the public copy
except for the final approved known-issues statement.

## 2. Prepare tools and run the candidate gate

Use the Node major in `.nvmrc` (currently 22), npm, GitHub CLI and project dependencies.
On a fresh checkout, `POLYTRAY_SKIP_INSTALL_APP_DEPS=1 npm ci` avoids a premature
Electron native rebuild. If dependencies are already current, do not reinstall them
just for documentation or media work.

Before an authorized main push, run the required Build and Product gates once for
the coherent candidate. On the documented macOS environment:

```sh
npm run build
POLYTRAY_E2E_SKIP_BUILD=1 PYTHON=/usr/bin/python3 npm run test:product
```

`POLYTRAY_E2E_SKIP_BUILD=1` is valid here because the preceding build just succeeded
on unchanged source. Without a verified fresh build, let global E2E setup build it.
Build already includes typecheck. Preserve the Product sequence:
**Node native rebuild -> stale marker cleanup -> unit tests -> Electron rebuild -> E2E.**
Never run unit/E2E/Product commands concurrently in one checkout.

- [ ] Record source/test/config identity, commands, outcomes and skipped coverage.
- [ ] Confirm the intended hosted platform gate, including packaging, on the candidate.
- [ ] Restore only known generated fixture changes; retain failure evidence in scratch.
- [ ] Keep timing exceptions explicit: Linux/Windows numeric scan-heartbeat comparisons
      are report-only under the current approved policy. Functional failures remain
      blocking; this is not evidence that database responsiveness is optimized.
- [ ] Use synthetic fixtures for smoke/UAT and inspect representative window sizes.
      Do not treat CI screenshots as human acceptance or unsigned packages as signed releases.

If only notes/media change after the gate, record that fact and compare relevant
source/test/config trees before reusing evidence. Do not repeat full Product solely
for prose. Actual source, dependency or verification changes invalidate affected evidence.

## 3. Refresh screenshots, demo and social image

Reuse reviewed media only when it still accurately depicts the chosen version;
record the source version/commit and reason for reuse. Otherwise capture from the
freshly built candidate with Electron-compatible native dependencies and `img2webp`
on PATH. If a Node-only test changed the native binary after Product, clear its stale
Electron marker and rebuild for Electron before capture. Do not do another native
rebuild when the just-completed Product gate already left Electron dependencies ready.

```sh
# Run only when current output/native prerequisites are verified.
npx tsx scripts/capture-readme-media.ts
```

The script uses a synthetic library, explicit private Chromium/userData and SQLite,
1440x960 capture viewport, and five app states: populated library, search, model
preview, wireframe and settings. It overwrites:

- `docs/assets/screenshot.png`
- `docs/assets/polytray_demo.webp` (looping five-frame animated WebP, not an MP4)

It owns and deletes `/tmp/polytray-readme-demo`, including existing contents there.
Confirm that directory has no unrelated files and do not run concurrent captures.
Do not remove the explicit `--user-data-dir` isolation; private HOME or database
environment variables alone are insufficient. Never capture the real user library.

- [ ] Open the screenshot and inspect the entire animation, including every frame.
- [ ] Confirm thumbnails have loaded, models/controls are visible, labels are legible,
      and the featured workflows exist in the chosen version.
- [ ] Run applicable docs/media checks and review `git diff --check`.
- [ ] Record capture SHA, runtime, output filenames and any reused assets in the
      release evidence; copy the public provenance to the website record later.

The existing five-frame demo does not automatically showcase backup/restore or every
new feature. Add extra feature captures only when useful and explicitly scoped.
There is no automated MP4/video-recording lane here. A requested video is a separate
real-app recording/export task with defined duration, dimensions and review; do not
claim it was generated by the WebP script or fabricate app UI.

For a changed social card, open `docs/marketing/social-card.html` in a browser and
render at **1280x640**, waiting for the real icon/screenshot assets and fonts. Inspect
legibility and crop, then export `social-preview.png` to the website asset destination.
Keep the HTML authoring template in the app repository, outside the public site tree.

## 4. Freeze notes, media and public claims

- [ ] Update README copy and versioned release notes from verified changes.
- [ ] Review the screenshot/WebP and staged marketing copy together.
- [ ] Include an accurate known-issues section; remove historical failures only after
      their fixes and current validation justify it.
- [ ] Commit only approved release preparation files, including both version files.
- [ ] Record the final commit intended for the tag. Source changes after signing or
      validation require new artifacts and affected revalidation.
- [ ] Stage website changes locally if desired, but do not announce availability or
      deploy links to unverified release assets before publication is authorized.

## 5. macOS signing/notarization prerequisites

Signing and notarization happen locally. Hosted Build's macOS package is useful
for tests but does not establish Developer ID signing or notarization.

- Xcode Command Line Tools: install if needed with `xcode-select --install`.
- Developer ID Application certificate and private key available in the maintainer's
  keychain. Inspect identities with:

```sh
security find-identity -v -p codesigning
```

- App Store Connect API key (`.p8`), key ID, issuer ID and Developer ID team ID.
  Keep the private key outside the repository.
- `gh auth status` succeeds for the intended repository with release-write access.
- A **gitignored** `.env`, based on [`.env.example`](../.env.example), contains
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER` and `APPLE_TEAM_ID`.
  Set optional `CSC_NAME` only to select the intended signing identity.
  Do not overwrite an existing `.env`, print its values, commit it or copy secrets
  into website files. GitHub publishing uses the existing `gh` login.
- Confirm these tooling commands are available: `codesign`, `spctl`, `xcrun notarytool`
  and `xcrun stapler`. The current helper also invokes `stapler` directly, so that
  command must resolve in its shell before using the helper.

No signing certificate, private key or notarized artifact was checked merely by
updating this guide. Distribution readiness requires inspecting the actual output.

### Build-only signed preparation

For explicit signed-artifact preparation without a GitHub upload, run these steps
from the selected clean candidate. This contacts Apple's notarization service;
use only under the applicable signing/preparation authorization.

```sh
set -a
source .env
set +a
export POLYTRAY_SIGN_RELEASE=1
npm run build
npx electron-builder install-app-deps
npx electron-builder --mac --publish never
```

`POLYTRAY_SIGN_RELEASE=1` makes the existing `afterPack` hook skip its ad-hoc fallback;
electron-builder handles the Developer ID/hardened-runtime/notarization path. Inspect
its logs and verify the actual app, selecting the current candidate's output explicitly
rather than an old bundle in `dist/`:

```sh
APP_PATH="dist/mac-arm64/Polytray.app"  # Verify this is the actual current output.
codesign --verify --deep --strict --verbose=2 "$APP_PATH"
spctl --assess --type execute --verbose=4 "$APP_PATH"
xcrun stapler validate "$APP_PATH"
```

All three must succeed. Do not ignore Gatekeeper/notarization errors or use ad-hoc
signing to claim a notarized release. The existing uploader's expected macOS assets
are **arm64**; an Intel/universal release requires separately verified output and
script support, not an assumption that `--mac` publishes all architectures.

## 6. Publish app binaries - explicit publication step

Do not run this section merely to test packaging. Tag pushes start the Release
workflow; `npm run release:mac` can create a public release and overwrites matching
macOS assets with `gh release upload --clobber`.

After release/tag/main-push authorization:

1. Push the approved release commit to main if needed and confirm its expected CI
   result. Record the remote commit; do not force-push main.
2. Ensure the approved version matches `package.json` and `package-lock.json` and
   that its tag/release does not already point to a different published candidate.
3. Create and push the tag on the exact reviewed commit. Replace the values below:

```sh
RELEASE_VERSION="X.Y.Z"
RELEASE_TAG="v${RELEASE_VERSION}"
RELEASE_SHA="APPROVED_COMMIT_SHA"
git tag -a "$RELEASE_TAG" "$RELEASE_SHA" -m "Polytray ${RELEASE_VERSION}"
git push origin "$RELEASE_TAG"
```

4. Follow `.github/workflows/release.yml` on that tag. It runs Product checks and
   packages/uploads Windows NSIS/portable EXE and Linux AppImage, including generated
   metadata/blockmaps where present. It intentionally excludes macOS publication.
5. Verify tag/source/version identity in the local macOS checkout and run:

```sh
npm run release:mac
```

The helper loads `.env`, rebuilds JS/native dependencies, signs/notarizes/staples,
verifies the `.app`, checks expected files, then uploads the arm64 DMG, ZIP, their
blockmaps, and `latest-mac.yml`. It is **not build-only** and rebuilds even if signed
preparation was performed earlier. Review the artifacts it actually uploaded.
Do not rely on its release-creation fallback to choose the correct Git tag: the
reviewed remote tag should already exist.

6. Replace generated release notes with the approved public notes if needed; for
   example, `gh release edit "$RELEASE_TAG" --notes-file docs/release-notes/VERSION.md`
   after substituting the reviewed file. Confirm stable/prerelease/latest state.
   The current tag workflow does not infer a safe prerelease policy from an `-rc`
   suffix alone; review that state explicitly before making assets public.
7. Download the uploaded packages and inspect the published asset list, checksums,
   sizes, version metadata and install/launch behavior using an isolated test profile.
   Verify the macOS app extracted from the downloaded package with the commands above.
   Record checksums with `shasum -a 256 <actual-artifact-path>`.

Do not announce complete availability while one platform failed to build or upload.
If publication partially fails, preserve successful assets, diagnose the failed
platform, and repair only the matching version/commit. Never move an existing public
release tag silently or substitute older signed assets for a newer version.

## 7. Update the central marketing site

Resolve the actual `cybermaak.github.io` checkout (normally a sibling of this repo).
Read its `AGENTS.md` and `docs/publishing.md`; product-specific preparation is linked
from [marketing-site-refresh.md](marketing-site-refresh.md).

1. Edit only the product content under `public/polytray/`. Align features, captions,
   platform/signing claims and download links with the now-verified public release.
2. Copy the selected app screenshot to `public/polytray/assets/screenshot.png`.
   Copy `polytray_demo.webp` only if the page references it, and copy the reviewed
   social image to `public/polytray/assets/social-preview.png`. Preserve stable icon paths.
3. Keep internal navigation root-relative and canonical/social metadata on
   `https://cybermaak.dev/polytray/`. Verify every changed external download link.
4. Record the app tag/source SHA, asset filenames/checksums, capture/reuse decision
   and review outcome in website `docs/content-sources.md`. Do not copy app source,
   user data, credentials, diagnostics, `node_modules` or authoring templates.
5. In the website checkout, run:

```sh
python3 scripts/site.py check
python3 scripts/site.py build
python3 scripts/site.py serve
```

Preview `http://127.0.0.1:4173` (or the printed selected port). Check desktop/narrow
layouts, the full animation, social image, homepage-to-product/back links and all
changed downloads. Run website unit tests only when its build/check tooling changes,
as its guide requires. Run `git diff --check` in each edited repository.

6. Obtain or confirm website-publication authorization separately from app release
   authorization. Preserve unrelated website work and follow its commit policy.
   An authorized main push deploys through its Website workflow when the existing
   `PAGES_DEPLOY_ENABLED` control is enabled. Only generated `dist/` is published.
7. Inspect the deployed `https://cybermaak.dev/polytray/`, images, navigation and
   release downloads. Record the website commit and deployment URL beside the app tag.
   Do not dispatch this app repo's legacy Pages workflow or change hosting controls
   just to refresh the product page.

For rollback, revert the affected website content while retaining its `public/` ->
`dist/` boundary; publish and verify the correction under applicable authorization.
Do not resurrect the old repository-root publisher or repeat the one-time migration.
For a defective binary release, use an explicit corrective release/asset decision;
no automatic tag rewrite, asset deletion or installation of an older schema is implied.

## 8. Final release record

Store a short release record containing:

- Version/tag, app commit, release URL and exact CI run(s).
- Platform package filenames/checksums and actual signing/notarization results.
- Tested OS/architecture/runtime, functional smoke results, known issues and skips.
- Screenshot/demo/social filenames, source commit and capture/reuse decision.
- Website source/deployment commit, live URL checks and publication timestamp.
- Any partial publication, approved exception or rollback action.

Stop after the authorized release/site scope is complete. Publishing does not
start deferred DB-WORKER, harness, performance or code-cleanup projects.

## Troubleshooting quick reference

| Symptom | First check / bounded action |
| --- | --- |
| E2E window never launches / native ABI error | Correct Node/Electron phase; clear stale `.forge-meta` via the existing Product script; no concurrent rebuilds |
| Capture shows blank/stale cards | Current `out/`, Electron native binary, synthetic scan/thumbnail completion and current selectors; do not fabricate a screenshot |
| Capture animation missing | `img2webp` availability and five generated frames; WebP is the supported output |
| Notarization rejected | Inspect the submission log with `xcrun notarytool log SUBMISSION_ID --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"` in the configured shell; do not publish |
| Wrong/ad-hoc identity | `POLYTRAY_SIGN_RELEASE=1`, intended certificate/private key and optional `CSC_NAME`; verify actual bundle |
| Signature/Gatekeeper/staple check fails | Fail publication; retain logs, fix the actual signed artifact; do not append `|| true` |
| Missing/wrong mac assets | Exact version, arm64 target, fresh `dist/`, expected filenames in release-mac.sh |
| Website changes do not deploy | Website workflow/ref and existing publishing control; do not switch to legacy app Pages |

Historical design notes under `docs/plans/` or `docs/superpowers/` explain previous
implementation decisions. When their commands conflict with current executable
scripts, this runbook and the inspected current scripts govern routine releases.
