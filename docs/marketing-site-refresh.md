# Polytray marketing-site refresh

The canonical end-to-end process is now [the Polytray release runbook](RELEASING.md).
This companion remains the stable product-SOP entrypoint referenced by the central
website's `AGENTS.md`; it avoids maintaining a second release/capture checklist.

## Use the relevant runbook sections

- [Choose the release source](RELEASING.md#1-select-the-release-candidate).
- [Generate or reuse screenshots, animated WebP and social media](RELEASING.md#3-refresh-screenshots-demo-and-social-image).
- [Review product copy and release claims](RELEASING.md#4-freeze-notes-media-and-public-claims).
- [Prepare, validate, publish and verify the central page](RELEASING.md#7-update-the-central-marketing-site).
- [Record source and deployment provenance](RELEASING.md#8-final-release-record).

The site is owned by the separate `cybermaak.github.io` repository at
`public/polytray/`. The website's publishing record says the central cutover
completed on September 24, 2026 and the former app Pages publishers were disabled.
That replaces this document's old description of a pending local migration.
Recheck actual deployment state when publishing; do not rerun the cutover or
reactivate Polytray's legacy `site/` publisher for ordinary content updates.

A media/site-only refresh does not require a new app binary release. Select an
already public version, or prepare clearly labelled unreleased candidate media
locally until publication is approved. Reuse accurate reviewed media when possible.
Keep app and website changes/permissions separate, and honor an instruction to
leave changes uncommitted. App release scripts must not be invoked just to update
marketing assets.

Canonical app outputs remain `docs/assets/screenshot.png` and
`docs/assets/polytray_demo.webp`; [social-card.html](marketing/social-card.html) is
an authoring template, not a public asset. Record copied public media in the
website's `docs/content-sources.md`. Never synthesize app UI or copy private data,
diagnostics or app repository internals into the website.
