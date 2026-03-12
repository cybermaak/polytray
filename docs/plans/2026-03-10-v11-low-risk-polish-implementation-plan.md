# Polytray v1.1 Low-Risk Polish Implementation Plan

## Baseline

This plan implements Mock A from the v1.1 polish design set with the following accepted adjustments:

- preview metadata should not be duplicated between header and footer
- sidebar order should place format filter before library stats
- expanded preview mode must be accommodated explicitly

## Locked Decisions

### P-1 Preview Information Placement

The preview header remains a controls/framing zone only.

The preview footer/status bar is the single metadata location for:

- filename
- path
- file metrics

This same model applies to both docked preview and expanded preview.

### P-2 Sidebar Order

Final sidebar order:

1. Add Folder CTA
2. Folder tree
3. Format Filter
4. Library Stats
5. Utility controls

### P-3 Expanded Preview Support

Expanded preview must preserve:

- top-right control visibility
- footer/status metadata visibility
- no duplicated metadata in the header
- strong canvas dominance

## Workstreams

### W1 Toolbar Context Strip

Files:

- `src/renderer/components/Toolbar.tsx`
- `src/renderer/App.tsx`
- `src/renderer/styles.css`

Tasks:

- Add a compact context strip below the toolbar controls.
- Show active folder/filter/search as chips.
- Show visible result count.
- Keep the toolbar compact enough for typical desktop widths.

Acceptance:

- Current browse scope is visible near the grid.
- Controls remain readable without crowding.

### W2 File Card Polish

Files:

- `src/renderer/App.tsx`
- `src/renderer/styles.css`

Tasks:

- Increase filename prominence.
- Soften metadata contrast.
- Refine extension badge size and treatment.
- Strengthen hover and selected states.
- Improve thumbnail placeholder/loading styling.

Acceptance:

- Selected card is clearly identifiable in a dense grid.
- Card readability improves without changing browse semantics.

### W3 Sidebar Cleanup and Reorder

Files:

- `src/renderer/components/Sidebar.tsx`
- `src/renderer/styles.css`

Tasks:

- Reorder the `Format Filter` block above `Library Stats`.
- Improve section spacing and contrast.
- Reduce noise in inactive folder rows.
- Strengthen active folder and root styling.

Acceptance:

- Sidebar hierarchy feels cleaner.
- Filter controls appear before summary metrics.

### W4 Preview Panel Framing

Files:

- `src/renderer/components/PreviewPanel.tsx`
- `src/renderer/styles.css`

Tasks:

- Remove duplicate file identity content from the preview header.
- Keep the header focused on grouped viewer controls and expand/close affordances.
- Refine the footer/status bar as the only file identity zone.
- Ensure the same approach works in docked and expanded preview modes.
- Preserve the full-canvas feel in expanded preview.

Acceptance:

- Metadata appears only once.
- Expanded preview remains visually coherent and uncluttered.

### W5 Empty, Loading, and Progress States

Files:

- `src/renderer/App.tsx`
- `src/renderer/components/PreviewPanel.tsx`
- `src/renderer/styles.css`

Tasks:

- Improve empty state guidance.
- Refine scan and thumbnail progress treatment.
- Improve preview loading visuals.
- Avoid abrupt hide/show behavior where possible.

Acceptance:

- App feedback feels calmer and more intentional.

### W6 Settings Readability

Files:

- `src/renderer/components/SettingsModal.tsx`
- `src/renderer/styles.css`

Tasks:

- Improve group spacing.
- Make advanced controls easier to parse.
- Clarify expert-facing numeric settings visually.

Acceptance:

- Settings are easier to scan without changing meaning.

## Execution Order

1. Toolbar context strip
2. File card polish
3. Sidebar cleanup and reorder
4. Preview panel framing with expanded-preview support
5. Empty/loading/progress pass
6. Settings readability pass
7. Optional small motion pass

## Verification

### Visual

- Docked preview uses footer-only metadata.
- Expanded preview uses footer-only metadata.
- Sidebar order is `tree -> filter -> stats`.
- Top-right preview controls remain clean and readable in both modes.

### Functional

- Search, sorting, filtering, preview selection, and expand/collapse behaviors remain intact.
- Footer metadata updates with file selection changes.
- Expanded preview still resizes and renders correctly.

### Regression Focus

- Preserve current test selectors where practical.
- Update any selector-dependent tests only if markup changes are deliberate.

## Definition of Done

- Mock A direction is reflected in the app shell.
- Preview metadata exists only in the footer/status bar.
- Sidebar order reflects your requested change.
- Expanded preview is explicitly supported by the polish pass.
