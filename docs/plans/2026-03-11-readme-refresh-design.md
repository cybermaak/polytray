# README Refresh Design for Polytray v1.1.0

## Summary

Refresh the repository landing page so it presents Polytray as a polished desktop product first and technical project second. The README should reflect the released v1.1.0 UI and feature set, using fresh media captured from the live application.

## Goals

- Present Polytray clearly to first-time GitHub visitors.
- Surface the strongest product capabilities near the top.
- Reflect the current v1.1.0 UI, feature set, and release highlights.
- Keep contributor setup and packaging instructions available, but below the fold.
- Reuse stable asset paths so release links and embeds do not change.

## Non-Goals

- No new product claims beyond shipped functionality.
- No README-specific branding system beyond current app visuals.
- No separate docs site or wiki restructuring.

## Recommended Structure

1. Hero
   - app icon
   - concise value proposition
   - release/build/license badges
   - quick links to release, demo, development
2. Visuals
   - animated demo (`docs/assets/polytray_demo.webp`)
   - static screenshot (`docs/assets/screenshot.png`)
3. Why Polytray
   - local-first indexing
   - responsive large-model preview
   - background thumbnail generation
   - folder/search/filter workflow
   - native desktop integration
4. What's New in v1.1.0
   - stabilized preview pipeline
   - UI polish
   - separate accent/preview/thumbnail colors
   - release hardening and test coverage
5. Core Workflow
   - add folders
   - scan/index
   - browse/filter/search
   - preview and inspect
   - drag/open/reveal in OS tools
6. Development
   - stack overview
   - setup
   - dev/test/build commands
7. Status / Notes
   - supported formats
   - local storage / privacy note
   - release workflow note

## Media Plan

### Screenshot

Replace `docs/assets/screenshot.png` with a current v1.1.0 full-window capture showing:

- sidebar
- toolbar context strip
- populated grid
- open preview panel
- polished iconography

### Animated Demo

Replace `docs/assets/polytray_demo.webp` with a short loop captured from the live app showing:

1. browsing a populated library
2. search or filter interaction
3. file selection and preview open
4. viewer control interaction
5. settings modal with split color controls

## Verification

- README references the refreshed screenshot and demo assets.
- README includes the new product-oriented sections.
- Assets exist at the expected stable paths.
- Docs/mockups and plan files are committed with the README refresh.
