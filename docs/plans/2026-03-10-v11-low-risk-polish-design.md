# Polytray v1.1 Low-Risk UI Polish Design

## Summary

This document defines a low-risk UI/UX polish pass for Polytray's current feature set. The goal is to improve aesthetic quality, hierarchy, readability, and status clarity without changing the core information architecture or destabilizing established workflows and E2E selectors.

The proposed direction keeps the existing three-pane shell:

- left sidebar for library navigation and utility controls
- center grid for model browsing
- right preview panel for selected file inspection

This is not a redesign. It is a refinement pass focused on density, contrast, states, and clarity.

## Goals

- Make the current UI feel more intentional and premium without changing the workflow model.
- Improve readability and hierarchy in the sidebar, toolbar, file cards, and preview panel.
- Make active state, filter state, and background task state easier to understand.
- Preserve layout structure and minimize implementation risk.

## Non-Goals

- No information architecture rewrite.
- No command palette, multi-select, or new advanced workflows.
- No major folder tree behavior changes.
- No broad redesign of the app's dark visual identity.

## Design Principles

- Preserve the existing shell, improve the hierarchy.
- Make state visible near the point of use.
- Reduce noise before adding new ornament.
- Use the accent color sparingly for emphasis, not ambient tint.
- Favor spacing and contrast improvements over structural changes.

## Scope

### Must Ship

- Toolbar context chips and clearer active-state summary.
- Stronger selected and hover states for file cards.
- Sidebar visual cleanup and calmer stat presentation.
- Preview panel framing improvements for file identity and controls.
- Improved empty/loading/progress presentation.

### Nice to Ship

- Subtle motion for thumbnail arrival and panel transitions.
- Settings modal spacing and readability pass.
- Softer, more polished thumbnail loading placeholders.

### Defer

- New navigation paradigms.
- Folder tree interaction redesign.
- Significant visual re-theme.
- Functional expansion unrelated to current browse/preview flow.

## Proposed Changes

### UX-1 Toolbar Context

The toolbar should communicate what the user is currently looking at, not only provide controls.

Changes:

- Slightly enlarge the search field and reduce visual weight of secondary buttons.
- Add a compact context strip showing:
  - active folder
  - active format filter
  - active search query
  - visible result count
- Render active state as chips near the grid, not only inside sidebar state.

Behavior:

- Default state: `All Models • N results`
- Folder active: `Folder: <short name>`
- Search active: `Search: "<query>"`
- Format active: `STL`, `OBJ`, or `3MF`

Acceptance criteria:

- Users can identify active browse scope without inspecting the sidebar.
- Toolbar remains visually lighter than the content area.

### UX-2 File Card Polish

The file grid is the main browsing surface, so selection and scanability need to improve.

Changes:

- Increase filename prominence.
- Reduce metadata contrast and tighten its spacing.
- Make extension badges smaller and more systematic.
- Strengthen hover state with subtle lift and brighter border.
- Strengthen selected state with accent outline/glow and brighter surface.
- Improve thumbnail loading placeholder so cards feel populated even before image arrival.

Acceptance criteria:

- The selected file is obvious in a dense grid.
- Filename remains the clearest textual element inside each card.

### UX-3 Sidebar Cleanup

The sidebar currently contains useful information, but too many areas compete at the same visual weight.

Changes:

- More explicit separation between:
  - folder tree
  - format filters
  - stats
  - utility buttons
- Reduce noise for inactive folder rows.
- Strengthen root and active folder styling.
- Make stats tiles more compact and less dominant.
- Keep `Add Folder` as the primary sidebar CTA.

Acceptance criteria:

- Sidebar reads as a structured navigation rail, not a stack of unrelated blocks.
- Active folder and library root are clearly distinguishable.

### UX-4 Preview Panel Framing

The preview panel should feel like a destination, not just a large empty canvas with controls.

Changes:

- Better grouping of viewer controls in the top-right area.
- Use a single file identity location to avoid redundancy:
  - keep the header focused on controls and framing
  - keep filename, path, and metrics in the footer/status bar only
- Improve spacing and contrast in the preview footer/status bar.
- Make expand/collapse control state more obvious.
- Ensure the same information model works in both standard and expanded preview modes.

Acceptance criteria:

- Users can immediately tell what file is selected and what panel they are in.
- Control placement feels anchored, not floating.
- Expanded preview mode preserves a clean full-canvas feel while keeping file identity in a persistent footer.

### UX-5 Empty, Loading, and Progress States

System feedback should feel designed and calm.

Changes:

- More useful empty state copy and CTA emphasis.
- Compact scan/thumbnails status treatment.
- Progress messages should avoid abrupt disappearance while related work continues.
- Preview loading ring and supporting text should feel more polished.

Acceptance criteria:

- Background tasks feel visible but not noisy.
- Empty state can guide a first-time user without extra explanation.

### UX-6 Settings Readability

Settings should remain functionally unchanged, but easier to scan.

Changes:

- Increase spacing consistency across setting groups.
- Make advanced controls feel intentionally expert-facing.
- Improve numeric setting help text.
- De-emphasize lower-frequency controls visually.

Acceptance criteria:

- Settings are easier to parse without changing the underlying options.

## Visual Direction

- Maintain the dark workshop/tool aesthetic.
- Increase distinction between background, card, panel, and overlay surfaces.
- Use the accent color for selected states, chips, and key CTA emphasis only.
- Standardize radii, border opacity, and vertical spacing rhythm.
- Use subtle animation only:
  - hover: 120-160ms
  - thumbnail fade-in: 140-180ms
  - panel/overlay transitions: 160-200ms

## Mockups

Static mockups for review are provided here:

- [index](/Users/maak/repos/polytray/docs/mockups/v11-polish/index.html)
- [mock-a](/Users/maak/repos/polytray/docs/mockups/v11-polish/mock-a.html)
- [mock-b](/Users/maak/repos/polytray/docs/mockups/v11-polish/mock-b.html)
- [mock-c](/Users/maak/repos/polytray/docs/mockups/v11-polish/mock-c.html)

### Mock A

Refined shell, stronger context chips, minimal behavioral change.

### Mock B

Cleaner card treatment and more visible content context.

### Mock C

Slightly more premium visual treatment while still staying inside low-risk boundaries.

## Implementation Mapping

- Toolbar and context strip:
  - `src/renderer/components/Toolbar.tsx`
  - `src/renderer/App.tsx`
- Sidebar cleanup:
  - `src/renderer/components/Sidebar.tsx`
- File card polish:
  - `src/renderer/App.tsx`
- Preview panel framing:
  - `src/renderer/components/PreviewPanel.tsx`
- Settings readability:
  - `src/renderer/components/SettingsModal.tsx`
- Shared surface, spacing, motion, and state styling:
  - `src/renderer/styles.css`

## Rollout Order

1. Toolbar context and file-card selected state.
2. Sidebar cleanup and stat simplification.
3. Preview panel framing pass.
4. Empty/loading/progress pass.
5. Settings readability.
6. Optional motion pass.

## Risks

- Over-polishing the sidebar could reduce density too much for large libraries.
- Adding too many chips/context labels could make the toolbar visually heavy.
- Preview framing should not crowd the viewer canvas or reduce available render space significantly.
- Expanded preview mode should not duplicate metadata in both header and footer.

## Verification

- Existing E2E selectors should remain stable wherever practical.
- Confirm selected state readability on dense grids.
- Confirm toolbar still fits on common laptop widths.
- Confirm preview panel still renders correctly in collapsed and expanded modes.
- Confirm sidebar remains usable with deep folder trees.
