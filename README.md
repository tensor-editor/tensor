# Tensor (word-processor)

A paginated word processor built on Tauri + React + TipTap, with layout
computed by [`@tensor-editor/engine`](../tensor/engine) — Tensor's
paginated mode is the product default and identity.

## Status: M4 — first pixels (engine-driven PaginatedView)

- **PaginatedView** (`src/components/editor/PaginatedView.tsx`) renders
  pages from the engine's `LayoutResult`: one absolutely-positioned
  sheet per `PageGeometry`, per-block-per-page canvases painting
  `LineBox[]` (`fillText` per segment), a synthetic caret measured with
  the same metrics instance the engine used. Zoom is an explicit-size
  wrapper + one scaled stack — no per-element compensation anywhere.
- The PM (TipTap) view stays mounted but hidden and **input-only**: it
  receives keyboard input and owns the model selection; nothing about
  its DOM is ever measured or positioned from. Clicks hit-test the
  engine's LineBoxes instead.
- **Pageless mode** (any other `defaultPageLayout`) renders the interim
  `PagelessEditor` — no pagination, honest scaffolding.
- Review > **Document Properties** is live: Paper Size (Letter/Legal/A4)
  reflows the document and persists via `.wpdoc` metadata.
- `pageBreak` (Ctrl+Enter) renders its marker and forces the following
  block to start a fresh page (`flow.breakBefore: 'page'`).
- **Strict adapter**: content the M4 engine can't lay out yet (lists,
  blockquotes, code blocks, rules) throws loudly and drops the view to
  the pageless fallback — never a crash, never silent mis-layout.

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
| Page geometry types, `PAGE_SIZES`, `toLayoutOptions` | `src/lib/document/pageSetup.ts` |
| PM doc → engine `SemanticDoc` (strict kinds) | `src/lib/paginated/adapter.ts` |
| `RealMetrics` (the one measurement ruler) | `src/lib/paginated/metrics.ts` |
| Sheet painting + contiguity assert | `src/lib/paginated/paint.ts` |
| Synthetic caret, click hit-testing | `src/lib/paginated/caret.ts`, `hitTest.ts` |
| Stable block ids (engine edit-survival contract) | `src/lib/editor/BlockIdExtension.ts` |
| Legacy pipeline spec (the M5 hit-test fixture) | `docs/legacy/pagination-v1.md` |