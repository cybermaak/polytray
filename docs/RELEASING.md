# Releasing Polytray for macOS (signed & notarized)

Signing and notarization run **locally** on the maintainer's Mac. CI continues to
produce unsigned artifacts for Linux/Windows and for quick mac smoke builds.

## One-time setup
1. Install Xcode Command Line Tools: `xcode-select --install`.
2. Confirm the Developer ID cert is in the login keychain:
   `security find-identity -v -p codesigning | grep "Developer ID Application"`.
3. Create an App Store Connect API key (role: Developer) and download the
   `AuthKey_XXXXXXXXXX.p8` to `~/.appstoreconnect/private_keys/`.
4. Make sure `gh` is logged in with write access: `gh auth status`.
5. `cp .env.example .env` and fill in `APPLE_API_KEY`, `APPLE_API_KEY_ID`,
   `APPLE_API_ISSUER` (GitHub publishing reuses your `gh` login — no token in `.env`).

## Cutting a release
1. Bump `version` in `package.json` and commit.
2. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`
   (this triggers CI for Linux/Windows artifacts).
3. Run the signed mac release locally: `npm run release:mac`.
   This builds, signs with Developer ID, notarizes via Apple, staples the
   ticket, and uploads the `.dmg`/`.zip` to the GitHub Release for the matching
   version.
4. Verify on the published `.dmg`: download it, then
   `spctl --assess --type open --context context:primary-signature -v <App>.app`
   should report `accepted source=Notarized Developer ID`.

## Troubleshooting
- **Notarization rejected**: read the log — `xcrun notarytool log <submission-id>
  --key "$APPLE_API_KEY" --key-id "$APPLE_API_KEY_ID" --issuer "$APPLE_API_ISSUER"`.
- **"app is damaged"**: ensure the adhoc afterPack was skipped — the release log
  should print "Real Developer ID signing active — skipping adhoc fallback".
- **Multiple identities**: set `CSC_NAME` in `.env` to pin the exact identity.
