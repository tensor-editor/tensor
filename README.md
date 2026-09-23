# Tensor (word-processor)

A paginated word processor built on Tauri + React + TipTap, with layout
computed by [`@tensor-editor/engine`](../tensor/engine) — Tensor's
paginated mode is the product default and identity.

## Status: M5 — usable as a primary editor

- **Selection**: the painted overlay is a PROJECTION of PM's selection
  (`lib/paginated/positionMap.ts` — all selection changes go through PM
  transactions; the shell never tracks its own). Mouse selection
  (drag/shift-click/double-word/triple-block) hit-tests engine
  `LineBox`es under the nearest-line rule: clicks resolve within the
  clicked sheet, x past a line's end resolves to that line's end,
  margin/gap clicks clamp to the nearest sheet's nearest line.
- **Clipboard**: native copy/cut/paste route through PM's own handlers
  on the hidden view; the Edit menu pastes via
  `@tauri-apps/plugin-clipboard-manager` (plain text; native Ctrl+V
  keeps the rich path). Paste re-mints block ids.
- **Search**: matches paint on the tracks (token colors), distinct from
  selection; current-match navigation scrolls via the M4.2 minimal-edge
  follow.
- **Floating toolbar** positions from the selection's engine-rect
  bounding box (flip/clamped); pageless implementation untouched.
- **IME**: composition preview paints at the caret from event text —
  the one sanctioned L3 exception (input state, not geometry).
- M4's engine-driven core stands: sheets from `PageGeometry`, glyphs
  from `LineBox` segments, synthetic caret, minimal-edge scroll, zoom
  without compensation, strict-adapter pageless fallback, Document
  Properties paper size.

### The laws (M4)

1. **L1 — Two-sided law**: the engine computes, never paints; the shell
   paints, never computes.
2. **L2 — One instance**: one engine instance + one `RealMetrics`
   instance per view, for the view's lifetime (the engine's caches live
   inside the instance; M3's parity law depends on it).
3. **L3 — Input-only view**: the hidden PM view is input only — never
   measured, never positioned from.
4. **L4 — Fresh pageSetup per layout call**: read from the document
   store at every layout, never captured at editor creation.

## Development

```sh
npm install
npm run dev        # vite dev server (predev regenerates the license manifest)
npm run tauri dev  # the desktop app
npm test           # vitest: M4 integration suite (jsdom, FakeMetrics seam)
npm run lint       # ESLint (flat config; engine deep-import ban lives here)
npm run build      # tsc + vite build
```

### Architecture pointers

| Area | Where |
|---|---|
| PM pos ↔ engine blocks/LineBoxes (selection projection, hit tests) | `src/lib/paginated/positionMap.ts` |
| Nearest-line click rule | `src/lib/paginated/hitTest.ts` |
| Page geometry types, `PAGE_SIZES`, `toLayoutOptions` | `src/lib/document/pageSetup.ts` |
| PM doc → engine `SemanticDoc` (strict kinds) | `src/lib/paginated/adapter.ts` |
| `RealMetrics` (the one measurement ruler) | `src/lib/paginated/metrics.ts` |
| Sheet painting + contiguity assert | `src/lib/paginated/paint.ts` |
| Minimal-edge caret-follow scroll spec | `src/lib/paginated/caretFollow.ts` |
| Stable block ids (engine edit-survival contract) | `src/lib/editor/BlockIdExtension.ts` |
| Menu paste bridge | `src/lib/editor/clipboard.ts` |