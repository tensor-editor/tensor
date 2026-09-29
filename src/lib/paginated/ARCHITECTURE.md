# Architecture

Tensor renders text the way a print engine does: content is measured, broken into lines, placed onto pages by a pure computation, and only then painted. Everything involved in that pipeline lives in two places — this guide covers the shell side completely, and the engine side exactly as far as the shell uses it (the engine repository documents its own internals).

| Repo | Path | Role |
|---|---|---|
| **The shell** (this repo) | `word-processor/` | The Tauri + React app: ProseMirror, the document model, all UI, every pixel painted. |
| **The engine** | `../tensor/engine` | A pure TypeScript layout library, consumed as `@tensor-editor/engine` (npm-linked via `"file:../tensor/engine"` in `package.json`). |

The engine is imported from its package root only. An ESLint rule (`eslint.config.js`, `no-restricted-imports`) rejects deep `@tensor-editor/engine/src/*` imports so the package contract cannot be bypassed.

---

## The four laws

These appear as comments atop `src/components/editor/PaginatedView.tsx`, and nearly every unusual decision in the layout code traces back to one of them.

> **L1 — The engine computes, never paints; the shell paints, never computes.**
> Every coordinate on screen originates as an engine-issued fact (`LineBox`, `PageGeometry`). The shell only adds container offsets — zoom, page gap, content box. In the other direction, the engine holds no DOM references and draws nothing.

> **L2 — ONE engine instance + ONE metrics instance, for the view's lifetime.**
> The engine's incremental caches live inside the engine *instance*. Remount it and you rebuild cold caches mid-session; pair a warm engine with a differently-warmed measurement object and you can silently produce layout the engine would never have produced cold.

> **L3 — The hidden ProseMirror view is INPUT ONLY.**
> The real contenteditable — which owns keyboard input, IME, and the selection model — is invisible and positioned off-layout. Its geometry is meaningless. Nothing measures it, and nothing is positioned *from* it. Clicks are answered by hit-testing the engine's line boxes instead.

> **L4 — Page setup is read PER LAYOUT CALL, never captured at creation.**
> Page size, margins, and orientation are read from the document store inside every relayout. (The legacy pipeline captured them once at editor creation, so opening a file with different setup kept stale spacer heights forever.)

---

## The pipeline at a glance

```
 keystroke
    │
    ▼
 ProseMirror (hidden <EditorContent>)          ← the ONLY input surface (L3)
    │  'update' event (doc changed)
    ▼
 pmDocToSemantic()                             src/lib/paginated/adapter.ts
    │  PM doc → SemanticDoc + AdapterBlock[] sidecar
    │  (identity-cached per PM node — unchanged blocks pass through BY REFERENCE)
    ▼
 engine.layout(doc, opts)                      @tensor-editor/engine
    │
    ▼
 LayoutResult {pages, lines, version}          (frozen; LineBoxes shared zero-copy)
    │
    ▼
 PaginatedView setState                        src/components/editor/PaginatedView.tsx
    │  (one React commit; React batches N keystrokes into one paint per frame)
    ▼
 ┌─ PageSheet per PageGeometry                 .../paginated/PageSheet.tsx
 │    └─ BlockCanvas per block-per-page        .../paginated/BlockCanvas.tsx
 │         └─ paintLines() → canvas 2D         src/lib/paginated/paint.ts
 ├─ SelectionHighlights / SearchHighlights     overlays, same coordinate space
 ├─ synthetic caret <div>, IME preview <div>
 └─ (outside the zoom transform) FloatingToolbar, LinkBubble
```

Read top to bottom, that's the order data flows on every edit. The rest of this document walks it piece by piece:

| File | What it is |
|---|---|
| `src/lib/paginated/adapter.ts` | PM doc → engine `SemanticDoc`, with reference-identity caching |
| `src/lib/paginated/positionMap.ts` | PM position ↔ (block, text offset) ↔ `LineBox` ↔ painted rects |
| `src/lib/paginated/hitTest.ts` | Click (x, y) → (block, offset), the nearest-line rule |
| `src/lib/paginated/caretFollow.ts` | Minimal-edge caret scroll spec |
| `src/lib/paginated/metrics.ts` | The app's single text-measurement authority |
| `src/lib/paginated/paint.ts` | `LineBox[]` → canvas 2D glyph raster |
| `src/lib/paginated/ScrollGuardExtension.ts` | Routes PM's scroll-to-selection intent to painted coords |
| `src/lib/paginated/bench.ts` | Differential performance harness (dev-only) |
| `src/components/editor/PaginatedView.tsx` | The orchestrator: owns the engine, schedules relayout, projects selection/caret/search, renders the page stack |
| `src/components/editor/paginated/*.tsx` | Paint surfaces and overlays |
| `src/lib/document/pageSetup.ts` | Page dimensions/margins (points) → engine `LayoutOptions` (px) |
| `src/lib/editor/BlockIdExtension.ts` | Mints stable `blockId` attrs on every top-level PM node |

---

## Core Engine

The engine repo is a pure computation library: semantic document plus page geometry in, positioned line boxes out. No DOM, no React, no canvas. Its own internals (the placement rule machine, the incremental caches) are documented there. What follows is the entire surface the shell touches.

### The one runtime import

```ts
// src/components/editor/PaginatedView.tsx
import { createLayoutEngine } from '@tensor-editor/engine';

const engineRef = useRef<LayoutEngine | null>(null);
const metricsRef = useRef<TextMetrics | null>(null);
if (!engineRef.current) {
  if (!metricsRef.current) metricsRef.current = injectedMetrics ?? getRealMetrics();
  engineRef.current = createLayoutEngine({ metrics: metricsRef.current });
}
```

`createLayoutEngine({ metrics })` returns a `LayoutEngine`: an object with one method, `layout(doc, opts)`, plus a `lastStats` debug surface the shell doesn't read (the [benchmark harness](#benchmark-seams) could). One call site, one instance, held in a ref for the life of the view (L2).

### What we feed it

Two arguments. First, a `SemanticDoc`. The engine never sees ProseMirror:

```ts
// ../tensor/engine/src/types.ts (excerpt)
interface SemanticDoc {
  blocks: Block[]       // paragraphs and headings, each with a stable id
  baseStyle: TextStyle  // document default font, supplied by the adapter
}
```

A **block** is the unit of flow (paragraph or heading). A **run** is a maximal stretch of text with a single `TextStyle`, the atomic unit of measurement. Blocks may carry a `flow` policy (widow/orphan control, keep-together, keep-with-next, forced breaks); the adapter uses exactly one field of it, `breakBefore: 'page'`, derived from the PM `pageBreak` node.

Second, `LayoutOptions`, the page size and margins in CSS pixels:

```ts
// ../tensor/engine/src/types.ts (excerpt)
interface LayoutOptions {
  page: { width: number; height: number }
  margins: { top: number; right: number; bottom: number; left: number }
  preventWidowsAndOrphans?: boolean
}
```

Options are passed fresh on every layout call (L4). Changing them between calls is expected and legal; the engine drops its internal caches wholesale when the geometry changes, which is exactly what a page-size flip should do.

### What we get back

```ts
// ../tensor/engine/src/types.ts (excerpt)
interface LayoutResult {
  pages: PageGeometry[]
  lines: LineBox[]         // document order
  breaks: FragmentBreak[]  // mid-block page splits — unused by the shell today
  version: number          // bumps only when work happened; cheap staleness signal
}
```

`PageGeometry` gives each page's full `size` and its `contentBox` (the margins-inset rectangle where lines may live). The shell reads `version` through a `data-layout-version` attribute on the page stack; it's how the test harness (`settleLayout`) decides a layout has settled.

The workhorse is `LineBox`, one placed line:

```ts
// ../tensor/engine/src/types.ts (excerpt)
interface LineBox {
  blockId: string     // stable across edits — the join key of the whole system
  lineIndex: number   // 0-based within the block, continuous across page fragments
  pageIndex: number
  rect: Rect          // RELATIVE TO THE PAGE CONTENT BOX
  baseline: number    // baseline within the line rect
  rangeStart: number  // ─ offsets into the block's CONCATENATED RUN TEXT
  rangeEnd: number    //   (runs joined in array order)
  segments: LineSegment[]  // run boundaries survive line breaking
}
```

Three facts about this shape govern everything downstream:

1. **`rect` is content-box-relative.** Every consumer adds the page's `contentBox.x/y` itself, plus the page's offset in the page stack, plus zoom if it's converting to viewport coords.
2. **`rangeStart`/`rangeEnd`/`segments` index the block's concatenated run text**, the exact string the adapter ships as `AdapterBlock.text`. They name source positions, so they survive edits before them by shifting, like plain character offsets.
3. **`blockId` is the join key.** It ties an engine `LineBox` back to a semantic `Block`, back to a PM node's `attrs.blockId` (minted by `BlockIdExtension`). It's how painted lines match PM nodes after any transaction.

### The contract that binds the shell

> [!WARNING]
> `LayoutResult` (and every `LineBox` in it) is **frozen and shared zero-copy across layout calls**: an unchanged line is literally the same object in the next result. Reference equality of a `LineBox` is the "nothing changed" bit that [`BlockCanvas`'s damage-only repaint](#damage-only-repaint) and `PaginatedView`'s grouping memo depend on. Mutating a result corrupts the engine's caches and the paint path simultaneously.

That single design decision is why typing is cheap. Unchanged blocks keep their identity through [the adapter](#the-adapter), the engine reuses their cached lines, and the painter keeps their pixels.

Two more binding rules, both consequences of the caches living inside the engine *instance* rather than in the result:

- Hold one engine per view, in a ref (L2). Remounting throws away warm caches.
- **New metrics requires a new engine.** The engine's line cache never invalidates on metrics identity, so a cached engine paired with a different `TextMetrics` silently breaks the warm-equals-cold guarantee. This is why [measurement](#measurement) is a singleton.

### The measurement port

The engine performs no measurement itself. It receives a `TextMetrics` port and calls it:

```ts
// ../tensor/engine/src/types.ts (excerpt)
interface TextMetrics {
  measure(text: string, style: TextStyle): number  // advance width in px
  ascent(style: TextStyle): number
  descent(style: TextStyle): number
}
```

The shell implements this interface twice: `RealMetrics` in production and `FakeMetrics` in tests (see [Testing](#testing)). Memoization is the implementation's job; the engine never caches a measurement.

---

## Units: points and pixels

`src/lib/document/pageSetup.ts` keeps a simple rule:

> [!NOTE]
> The document store holds **points** ($1\,\mathrm{pt} = \tfrac{1}{72}\,\text{inch}$, the typography standard; Letter is exactly $612 \times 792\,\mathrm{pt}$). The engine receives **CSS pixels**. The conversion $\text{px} = \text{pt} \times \tfrac{96}{72}$ happens in one function, called fresh on every layout.

```ts
// src/lib/document/pageSetup.ts
export const PX_PER_PT = 96 / 72;

export function toLayoutOptions(pageSetup: PageSetup): LayoutOptions {
  // preset or custom dims in pt; landscape swaps them
  return {
    page: { width: ptToPx(widthPt), height: ptToPx(heightPt) },
    margins: { top: ptToPx(pageSetup.margins.top), /* right, bottom, left */ },
  };
}
```

`PageSetup` also carries `orientation` (landscape swaps width/height), `pageColor` (painted by `PageSheet` as a plain background; absent means white), and the display-unit system for UI inputs: inches, centimeters, millimeters, points, picas. Units are display-only formatting; the store always round-trips points. Tests that assert px values derive from the conversion, e.g. $612 \times \tfrac{96}{72} = 816$ and A4's $595\,\mathrm{pt} \to 793\,\mathrm{px}$ (`src/tests/paginated.test.tsx`, "store-driven pageSetup change").

---

## The adapter

`src/lib/paginated/adapter.ts` is a pure conversion: no measurement, no DOM reads. It is the shell→engine handoff (L1).

### Two outputs, one call

```ts
// src/lib/paginated/adapter.ts
export function pmDocToSemantic(pm: PMNode, baseStyle: TextStyle): AdapterResult {
  ...
  return { doc: { blocks: semantic, baseStyle }, blocks };
}
```

`doc` is what the engine consumes. `blocks` is the shell's sidecar, the PM wiring the engine must never see:

```ts
// src/lib/paginated/adapter.ts
export interface AdapterBlock {
  id: string;
  runs: Run[];
  /** Concatenated run text — the engine's LineBox rangeStart/rangeEnd
   * offsets index into exactly this string. */
  text: string;
  /** PM positions: the block node spans [from, to); its text content
   * starts at from + 1. */
  from: number;
  to: number;
  align: TextAlign;        // block-level textAlign, from the PM attr
  runDecor: RunDecor[];   // paint-only mark props, parallel to runs
}
```

The `RunDecor` split is deliberate. Text color, highlight, underline, and strike never change layout math (they're paint concerns), so they ride the sidecar, indexed by the same `runIndex` the engine's `LineSegment` uses. `paintLines` reads them at raster time (see [Painting](#painting)); the engine never sees them.

`baseStyle` (the document default font family and size) arrives from the config store, read fresh at relayout time. Defaults live at the edges, never in the engine.

### Strict kinds, loud throws

Only `paragraph`, `heading`, and `pageBreak` are accepted at the top level:

```ts
// src/lib/paginated/adapter.ts
if (kind !== 'paragraph' && kind !== 'heading') {
  throw new Error(
    `[adapter] unsupported block kind '${kind}' at offset ${offset}: the engine ` +
      'handles paragraph/heading only (blockquote, codeBlock, bulletList, orderedList, ' +
      'horizontalRule are deliberate loud throws until the engine supports them)'
  );
}
```

`PaginatedView` catches this and flips to a pageless fallback render of the same document (see [The hidden view and the fallback](#the-hidden-view-and-the-fallback)). A crash is never acceptable; silent mis-layout would be worse. Attributes the semantic model doesn't represent (indent, spacing, `justify`, links) are collected and warned once per distinct signature in dev, never silent, never spammy, and, crucially, preserved in the PM document so they reappear in `.wpdoc` saves.

### The `blockId` contract

Every top-level PM node carries a `blockId` attribute minted by `BlockIdExtension` (`src/lib/editor/BlockIdExtension.ts`) on creation, load, and paste. Paste re-mints to guarantee uniqueness (`src/tests/blockId.test.tsx`). The adapter throws if it's missing:

> top-level `${kind}` has no blockId — BlockIdExtension must mint ids on creation/load/paste before any layout call

`blockId` is what makes the whole join work after an edit: painted lines → `AdapterBlock` → PM node, by identity rather than by position.

### The identity cache

PM nodes are immutable and structurally shared: a keystroke rebuilds only the edited paragraph's path, so **sibling top-level nodes are the same object references across doc versions**.[^structural-sharing] The adapter memoizes the whole per-node conversion on the PM node object:

```ts
// src/lib/paginated/adapter.ts
const nodeCache = new WeakMap<PMNode, CachedConversion>();
```

Unchanged blocks reuse their semantic `Block` and `AdapterBlock` **by reference**: zero re-conversion, and (because the engine keys its own caches on block identity) zero re-hashing downstream. A changed paragraph is a new object, misses the WeakMap, and reconverts. A `baseStyle` change bumps a generation tag and invalidates everything, since cached runs embed baseStyle-derived fields.

PM positions (`from`/`to`) are deliberately *not* cached. They depend on preceding siblings and are recomputed on every call, so a deleted block correctly shifts everything after it.

The contract is pinned in `src/tests/adapter.test.tsx`: reference-identical reuse on a no-op call, isolation to the edited block on a keystroke, wholesale invalidation on a baseStyle change, and fresh positions after a deletion.

### Page breaks

The PM `pageBreak` node is not part of the semantic IR. It becomes `flow: { breakBefore: 'page' }` on the **following** block, the forced-break spelling the engine consumes. Since that's a sibling fact rather than a node fact, the block is shallow-cloned per call (breaking identity for that one block; forced breaks are rare, so the re-hash cost is negligible). A trailing `pageBreak` with nothing after it is simply skipped. The end-to-end path (Ctrl+Enter in the editor → `PageBreakNode` → adapter → next block starts a fresh page) is the flagship integration test, `src/tests/paginated.test.tsx` (d).

---

## Measurement

`src/lib/paginated/metrics.ts`. There is exactly **one** production `TextMetrics` instance in the app:

```ts
// src/lib/paginated/metrics.ts
let singleton: TextMetrics | null = null;

/** The app-wide single measurement authority (see module comment). */
export function getRealMetrics(): TextMetrics {
  if (!singleton) singleton = createRealMetrics();
  return singleton;
}
```

It measures with an offscreen 2D canvas context and memoizes widths (a bounded map, cleared at 20k entries) and per-style ascent/descent (`'Hg'` spans cap height and descender). The engine (layout) and `paint.ts` (raster) both go through this same instance and the same font-string builder:

```ts
// src/lib/paginated/metrics.ts
export function fontString(style: TextStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.fontSize}px ${style.fontFamily}`;
}
```

The same string is set as `ctx.font` that measured the text, so **measured widths and painted advances can never diverge**. A second, differently-warm metrics instance paired with a cached engine would silently break the engine's warm-equals-cold guarantee; the singleton exists to make that impossible.

**The font gate.** Because the engine's line cache never invalidates on metrics identity, measuring with fallback-font widths before webfonts load would cache those widths for the whole session. So `PaginatedView` refuses to run the first layout until `document.fonts.ready` resolves (force-loading the base font first). `relayout()` begins:

```ts
// src/components/editor/PaginatedView.tsx
function relayout() {
  if (!editor || !fontsReadyRef.current) return;
  ...
```

---

## The coordinate bridge

`src/lib/paginated/positionMap.ts` translates between three coordinate spaces, and everything the user sees that isn't text is built on it. Its organizing principle:

> **All selection state changes go through PM transactions, the shell never tracks its own selection.** The painted selection, search highlights, caret, floating toolbar, and IME preview are projections of PM state, exactly as painted lines are projections of the document.

The three spaces:

1. **PM positions**, integer doc positions in the PM model.
2. **(block, text offset)**, which `AdapterBlock`, and an offset into its concatenated `text`.
3. **`LineBox` ranges**, `rangeStart`/`rangeEnd` in that same concatenated text.

The primary mappings (binary search over the blocks' `[from, to)` spans):

```ts
// src/lib/paginated/positionMap.ts
// PM pos -> (block, offset). pos at a block's start maps to offset 0;
// pos at/after a block's end clamps to its text end.
export function pmPosToBlockOffset(blocks, pos): BlockOffset | null

// (block, offset) -> PM pos: text content starts at from + 1
export function blockOffsetToPmPos(block, offset): number
```

From (block, offset), the bridge finds the containing `LineBox` (`lineForOffset`, where boundary offsets belong to the later line) and measures the x of an offset within its line by walking the line's segments and measuring run prefixes (`lineOffsetX`), with the same metrics instance that measured the layout.

### One alignment function

Centered and right-aligned lines are shifted within the content box by exactly one function in the entire codebase:

```ts
// src/lib/paginated/positionMap.ts
export function alignOffset(align: TextAlign, lineWidth: number, contentWidth: number): number {
  if (align === 'center') return (contentWidth - lineWidth) / 2;
  if (align === 'right') return contentWidth - lineWidth;
  return 0;
}
```

`paint.ts`, `caretGeometry`, `textRangeLineRects`, and `hitTest` all consume it. "The caret sits one pixel left of where the text paints" is a bug class that can't exist when there's one offset function, pinned by `src/tests/interaction.test.tsx` ("centered line: painted x, caret x, and margin-click all use the one offset").

### The projections

- **Selection rects**: `textRangeLineRects(blocks, result, from, to, metrics, pageGap)` produces partial x on the selection's first and last line and full content width on middle lines, returned as stack-local pre-zoom `PaintedRect`s. Consumed by `SelectionHighlights` and, as a bounding box, by the floating toolbar.
- **Caret**: `caretGeometry(blocks, result, head, metrics)` resolves the line box for the selection head; x is `lineOffsetX + alignOffset`. `caretStackRect()` then adds the page stride and content box, the same arithmetic the [scroll follow](#scroll) reuses, never re-derived.
- **Word / block ranges**: `wordRangeAround` / `blockRangeAround` for double- and triple-click. PM ships no word utilities, and since events land on the painted surface rather than PM's DOM, owning the derivation is required.

The boundary contracts are covered exhaustively by `src/tests/positionMap.test.ts`: position-mapping edges, line resolution, partial-x measurement, "partial first/last, full-width middles", ranges across blocks and the page boundary, and caret parity with the selection math.

---

## Hit testing

Clicks land on the painted surface, a div/canvas stack PM knows nothing about. `src/lib/paginated/hitTest.ts` answers them:

> Clicks resolve to the nearest line WITHIN the nearest sheet: a click in a page margin or the inter-sheet gap clamps to that sheet's nearest line, and x beyond a line's end resolves to that line's end position.

Mechanically: the page stride is $s = h_{\text{page}} + g$ (page height plus gap), so the click's page index is $p = \lfloor y / s \rfloor$; a click in the second half of an inter-sheet gap ($y - ps > h_{\text{page}} + \tfrac{g}{2}$) belongs to the next sheet. The containing line is found by y-contiguity, then a per-character walk using `metrics.measure` with the same `alignOffset` the painter used, choosing the offset whose glyph midpoint the click passed.

The legacy pipeline died on clicks in spacers and gaps; those exact dead zones are now regression tests (`src/tests/interaction.test.tsx`, "legacy dead-zone fixtures"): trailing spaces after short last lines, bottom-margin clicks, both halves of the inter-sheet gap, and "far-right click never lands on page 2".

---

## Scroll

Two files, one policy.

**`ScrollGuardExtension.ts`** (a PM plugin, registered in `tensorExtensions.ts`): PM's `view.scrollToSelection()` fires only for transactions carrying PM's own scrollIntoView intent flag, and consults `handleScrollToSelection` before its native default, which would scroll to `coordsAtPos` geometry on the hidden view (the L3 disease). In paginated mode the extension routes the request to a handler the mounted `PaginatedView` registers. The handler answers `true` (handled against painted coordinates), except in the adapter fallback, where the visible pageless DOM is the real content and PM's native scroll is correct.

**`caretFollow.ts`** serves that handler:

> Scroll moves ONLY when a caret motion would clip the caret, and then only by the minimal delta that reveals it. No snapping, no re-centering, never on layout churn without caret motion.

So: no intent signal (a page-size flip, a zoom change, any relayout without caret motion dispatches no flagged transaction) means the function is never called, means no scroll, ever. The delta math uses `caretStackRect`, the same function the caret painter uses, times zoom, plus the stack's live `getBoundingClientRect()`.

The whole policy is pinned byte-for-byte in `src/tests/scroll.test.tsx`: a regression pin that typing at a page boundary leaves `scrollTop` untouched, exact minimal deltas up and down, "layout churn WITHOUT caret motion → no scroll, ever", and the zoom-150% case.

---

## The orchestrator

`src/components/editor/PaginatedView.tsx` owns everything above. `Editor.tsx` routes on the configured mode: `Pages` renders `PaginatedView`, anything else renders `PagelessEditor` (a plain contenteditable whose scroll behavior is PM's own; `ScrollGuardExtension` checks the mode before intercepting).

### The relayout pipeline

One function is the heart of the system, called on every PM `update`, on page-setup and font changes, and once when the font gate opens (benchmark-seam lines trimmed, see [Benchmark seams](#benchmark-seams)):

```ts
// src/components/editor/PaginatedView.tsx
function relayout() {
  if (!editor || !fontsReadyRef.current) return;
  const pageSetupNow = useDocumentStore.getState().pageSetup;   // L4: fresh
  const { defaultFontFamily: family, defaultFontSize: size } =
    useConfigStore.getState().config.editor;
  try {
    const adapted = pmDocToSemantic(editor.state.doc, { fontFamily: family, fontSize: size });
    const result = engineRef.current!.layout(adapted.doc, toLayoutOptions(pageSetupNow));
    assertContiguity(result);
    const next: LayoutState = { blocks: adapted.blocks, result };
    layoutRef.current = next;
    setLayout(next);              // ONE setState; React batches per frame
    setAdapterError(null);
    adapterErrorRef.current = null;
    updateSelectionProjection();
    updateSearchProjection(true);
  } catch (err) {
    console.error('[PaginatedView] layout failed; falling back to pageless rendering:', err);
    const error = err instanceof Error ? err : new Error(String(err));
    adapterErrorRef.current = error;
    setAdapterError(error);
    setPageInfo(1, 1);
  }
}
```

Note what isn't there: no debounce, no rAF, no timeout. The model is **synchronous-first**: adapter, engine, and `setLayout` run inside the input event's own task, so a keystroke's text paints in that input's frame. A rAF coalescer survives purely as a pressure valve: once `SYNC_BUDGET_PER_FRAME` relayouts have run in a ~16ms window, further updates defer and collapse into a single relayout on the next frame. The budget is currently `Infinity`, meaning process all keys synchronously and let React batch the resulting `setLayout` calls into one render and one `useLayoutEffect` paint per frame. Both behaviors are pinned in `src/tests/coalescing.test.tsx` ("5 transactions in one frame → all sync, one paint batch"; "each keystroke gets a synchronous layout").

Store subscriptions (`pageSetup`, `defaultFontFamily/Size`) exist only to *schedule* `relayoutRef.current()`; the values are always re-read at call time (L4).

`assertContiguity` (`paint.ts`) is a dev-mode tripwire that line rects tile each page's content box with no seams, the invariant [hit testing](#hit-testing)'s line search and all y-math rely on. It also runs under vitest, where integration test (a) pins that a 3-page document produces no contiguity errors.

### The DOM shape and the zoom law

Simplified:

```tsx
// src/components/editor/PaginatedView.tsx (simplified)
<div data-testid="paginated-root">
  <HiddenInputView editor={editor} />
  <div data-testid="paginated-zoom-wrapper"       // sized stackW*z × stackH*z
       onMouseDown={handleMouseDown}>            // the painted event surface
    <div ref={stackRef} data-testid="paginated-stack"
         style={{ transform: `scale(${z})`, transformOrigin: 'top left', ... }}>
      {result.pages.map(page => (
        <PageSheet key={page.index} geometry={page} top={page.index * (pageH + gap)} ...>
          {visiblePages.has(page.index) && pageGroups.map(group => (
            <BlockCanvas key={group.blockId} lines={group.lines} ... />
          ))}
        </PageSheet>
      ))}
      <SearchHighlights ... />
      <SelectionHighlights ... />
      {/* synthetic caret <div> + IME preview, same coordinate space */}
    </div>
  </div>
  <FloatingToolbar ... />   {/* OUTSIDE the transform — UI chrome at 100% */}
  <LinkBubble ... />
</div>
```

**The zoom law**: the outer wrapper is *exactly* `stack × z` in size, so scroll extents are correct by construction; the inner stack carries one `scale(z)` transform; every painted child lives inside the transform. **Nothing compensates per-element for zoom**: overlays are painted in stack-local pre-zoom px and the transform scales them for free. The only zoom math anywhere is in conversions from stack coords to *viewport* coords (scroll follow, toolbar, link bubble), which multiply by z and add the stack's `getBoundingClientRect()`.

The `groupsByPage` memo groups lines per page per block in document order, keyed on the `LayoutResult` reference: a stable result yields stable group objects, so memoized `BlockCanvas`es skip re-rendering entirely on unrelated state changes; a new result rebuilds groups and only blocks with new `LineBox` references repaint.

### Mouse input

`handleMouseDown` never asks PM where the click landed. It converts viewport → stack-local pre-zoom coords (`(e.clientX - stackRect.left) / z`), runs `hitTest`, maps back to a PM position via `blockOffsetToPmPos`, and expresses the result *as a PM transaction*. Everything rides this path: click-to-place, double-click word, triple-click block, shift+click extend (from PM's own anchor, since the shell never tracks selection), rAF-throttled drag select, Ctrl+click open link, and the toggleable middle-click paste.[^x11-primary]

Focus is forwarded to the hidden view with `focus({ preventScroll: true })`: the browser must never scroll to reveal the hidden view's native caret.

### Projection updates

- **Selection** (`updateSelectionProjection`, on every PM `selectionUpdate`): recompute caret, selection rects, and toolbar position from the current layout. During a drag the toolbar is suppressed and re-surfaced at mouseup.
- **Caret**: a plain absolutely-positioned `<div>` at `caretStackRect` coords, solid on any input, blinking after 500ms idle, hidden during non-collapsed selections and window blur.
- **Search** (`updateSearchProjection`): reads match positions from the search plugin's PM state and maps them through the same `textRangeLineRects` as the selection; highlights and the current-match scroll are the same projection machinery.
- **IME preview**: the one sanctioned L3 exception. Composition text is *input state*: PM keeps it out of the doc model until `compositionend`, so the engine can't paint it. The preview div is positioned purely from engine rects at the caret.
- **Floating toolbar / link bubble**: rendered *outside* the transform at 100% scale, positioned from painted bounding boxes. UI chrome, not document content.

### Virtualization

One `IntersectionObserver` watches every sheet (via `PageSheet`'s `observeRef`). Visible ∪ ±1 pages mount their canvases; **sheets always mount**, since scroll extents are geometry-owned and a page's height can never depend on whether its text is painted. The sheet with the highest intersection ratio also drives the status bar's current-page number (viewport-based, not caret-based).

### The hidden view and the fallback

`HiddenInputView` portals the real `<EditorContent>` to `document.body` as a `position: fixed` sibling of the app scroller, structurally outside any scroll container.[^hidden-view] All keyboard input, IME, clipboard, and the selection model live here.

> [!NOTE]
> The `metrics` prop on `PaginatedView` (and `Editor`) is a **test seam**. Production never passes it; the view takes the app-wide `RealMetrics` singleton. Tests inject `FakeMetrics` through it to make geometry deterministic.

If the adapter throws (the document contains lists, quotes, code blocks, …), the view swaps to the fallback in place: the same `EditorContent` rendered visible and pageless with a notice banner. Never a crash, never data loss, pinned by integration test (e) ("list doc → loud adapter throw → pageless fallback renders").

---

## Painting

### PageSheet

One absolutely-positioned white div per `PageGeometry`. Every *dimension* comes from engine geometry; every visual (border, shadow, radius, the optional `pageColor` background) is styling only:

```tsx
// src/components/editor/paginated/PageSheet.tsx
style={{
  top: `${top}px`,
  width: `${geometry.size.width}px`,
  height: `${geometry.size.height}px`,
  ...(background ? { backgroundColor: background } : {}),
}}
```

### The raster

`paintLines(ctx, lines, runs, text, minY, metrics, extras)` walks each `LineBox`, computes its align offset with the shared `alignOffset`, and does one `fillText` per `LineSegment` (so bold/italic survive wrapping), plus highlight rects and underline/strike bars, all through the same `metrics`/`fontString` the engine measured with. The shell paints, never computes (L1): nothing is re-measured except glyph advances, which by construction match the measured widths.

### Damage-only repaint

One canvas per block-per-page fragment, DPR-scaled, painted in `useLayoutEffect` so pixels land before the browser paints the frame. The performance model rests on the zero-copy contract: **reference equality of frozen `LineBox` objects is the dirty bit.** Unchanged lines are the same objects, so `memo`'d canvases skip rendering entirely. When a block does change, and the text edit starts beyond the first line, only the region from the first changed line down is cleared and redrawn (a re-wrap moves everything below the edit; identical lines above keep their pixels):

```ts
// src/components/editor/paginated/BlockCanvas.tsx
let damageFrom = 0;
if (canvas.width === newW && canvas.height === newH &&
    prevBoxRef.current === boxKey && prevTextRef.current && prevTextRef.current !== text) {
  const oldText = prevTextRef.current;
  let firstDiff = 0;
  const common = Math.min(oldText.length, text.length);
  while (firstDiff < common && oldText[firstDiff] === text[firstDiff]) firstDiff++;
  damageFrom = lines.findIndex((l) => firstDiff < l.rangeEnd);
  if (damageFrom < 0) damageFrom = 0;
}
```

Full repaint remains for canvas resizes, first-line edits, and style changes; the fallback cost equals the old behavior.

---

## A keystroke, end to end

<details>
<summary>Trace of typing a character in the middle of page 2 of a 10-page document</summary>

1. The keypress lands on the hidden contenteditable (it holds focus). PM applies a transaction; its scrollIntoView flag is set because PM's key handling moved the caret.
2. `onDocUpdate` runs **synchronously inside the input event**: `trySyncOrDeferRelayout()` → under budget → `relayout()`.
3. `pmDocToSemantic`: the edited paragraph is a new PM node and reconverts; every other block is the same object, so the WeakMap returns their cached conversions by reference.
4. `engine.layout`: the engine re-breaks the edited block's lines and reuses its cached placements for the rest (measurably, a keystroke's relayout runs on the order of 1–3.5ms on typical documents).
5. `setLayout` and the projection updates run in the same task; React batches them; the commit runs before the browser paints the frame.
6. `BlockCanvas`'s `useLayoutEffect`: only canvases with new `LineBox` references repaint, and only from the first changed line down.
7. The pending scroll intent is served against *fresh* layout: the caret rect is recomputed and the minimal edge delta applied, if and only if the caret would clip.

The input→paint chain stays inside the input's own frame.[^gdocs-parity]

</details>

---

## Testing

The integration suite runs under vitest + jsdom, which lays out nothing, and that's fine: nothing in the paginated system reads DOM layout except the two places that are explicitly mocked.

- **`FakeMetrics`** (`src/tests/fakeMetrics.ts`) is deterministic measurement implementing [the measurement port](#the-measurement-port), chosen to tile cleanly on the default Letter page ($\lfloor 624/10 \rfloor = 62$ chars/line, $\lfloor 864/16 \rfloor = 54$ lines/page):

  ```ts
  // src/tests/fakeMetrics.ts
  export const FakeMetrics: TextMetrics = {
    measure: (text, style) => text.length * 10 * (style.fontSize / 16),
    ascent: (style) => 0.8 * style.fontSize,
    descent: (style) => 0.2 * style.fontSize,
  };
  ```

- **`GEOMETRY`** (`src/tests/harness.tsx`) is the constants those choices produce (`pageWidth: 816, contentX: 96, charsPerLine: 62, linesPerPage: 54, ...`), which every test computes click coordinates against. They hold because the points→px conversion of the default setup ($612 \times 792\,\mathrm{pt}$ Letter, $72\,\mathrm{pt}$ margins) lands exactly on 816×1056 px and 96 px.
- **`renderTensor` / `renderTensorInScrollContainer`** render the *real* production `<Editor>` with `FakeMetrics` injected through the seam. The scroll variant wraps it in the app-shaped scroll container, and `mockRects` pins the two `getBoundingClientRect` results the geometry math reads (jsdom returns zeros).
- **`settleLayout`** waits until the stack's `data-layout-version` stops advancing, which works identically under the synchronous-first and coalesced paths.

> [!TIP]
> Always `await settleLayout()` before asserting on painted output. The first layout is gated on `document.fonts.ready`, which jsdom resolves on a microtask.

One gotcha worth knowing: `useDocumentStore` is a module-level singleton, so tests that mutate `pageSetup` leak across files unless each suite's `beforeEach` resets it. Every layout-touching suite does exactly that.

<details>
<summary>Suite map (all in <code>src/tests/</code>)</summary>

| File | Covers |
|---|---|
| `paginated.test.tsx` | End-to-end: multi-page render + contiguity, page-boundary typing, caret tracking, forced page break (flagship), fallback, pageSetup reflow / orientation / custom size / page background |
| `adapter.test.tsx` | Identity-cache contract: reference reuse, keystroke isolation, baseStyle invalidation, fresh positions |
| `positionMap.test.ts` | The coordinate math and its boundary contracts |
| `paint.test.ts` | Paint fidelity: marks (underline/strike y, highlight), alignment via the one shared offset |
| `virtualization.test.tsx` | Canvas-mount visibility sets, viewport-based current page, dirty-block repaint |
| `interaction.test.tsx` | Mouse selection, dead-zone fixtures, alignment symmetry, toolbar, search paint, clipboard + middle-click paste, a11y attrs, IME preview |
| `scroll.test.tsx` | The minimal-edge scroll policy, byte-identical regression pins |
| `coalescing.test.tsx` | Sync-first budget behavior and caret phase |
| `links.test.tsx` | Painted links: click-to-caret, Ctrl+click open, painted-coords bubble |
| `blockId.test.tsx` | Id minting and paste re-minting |

</details>

For in-browser behavior (real keystrokes, real paint), the repo uses Playwright over CDP with real key events; synthetic `execCommand` bypasses `beforeinput` in Chromium and is not representative.

---

## Benchmark seams

Performance work here is measured, never guessed. Three permanent, zero-cost-in-prod instrumentation points exist:

- `__benchRelayouts.relayouts`: per-call relayout duration (pushed in `relayout()`).
- `__benchPaints.paints`: per-canvas paint events + px² rasterized (`BlockCanvas`).
- `__benchSync.sync` / `__benchSync.deferred`: sync-vs-deferred branch counters.

`src/lib/paginated/bench.ts` is the differential harness that drives them: scripted typing bursts into a real editor, reporting the input → relayout → paint → presented chain, per-dispatch PM view-update cost, drain time, and the sync/deferred split, across two document sizes. It activates via `#bench/?bench`, auto-builds, or the status bar's 5-click trigger, and is readable in any renderer. The damage-only raster and the paint-once-per-frame batching both came out of this harness.

---

## Known limits

Deliberate, all of them:

- **Block kinds**: paragraphs, headings, and forced page breaks only. Lists, quotes, code blocks, and rules throw in the adapter and render the pageless fallback, loudly, until the engine supports them.
- **Inline model**: no inline nodes (hard breaks included). Links ride marks and paint as decoration.
- **Justify**: engine work; still in the adapter's dropped-attr warning list.
- **Sections**: one page geometry per document.
- **Horizontal scroll-follow**: vertical edges only; the horizontal seam is left for RTL / extreme-zoom cases.

---

## Glossary

<details>
<summary>Terms used throughout the layout code</summary>

| Term | Meaning |
|---|---|
| **Shell / engine** | This React app / `@tensor-editor/engine`, the pure layout library |
| **PM** | ProseMirror (via TipTap), the document model and input surface |
| **The hidden view** | The real contenteditable, portaled off-layout, input-only (L3) |
| **Block** | Paragraph or heading; the unit of flow, carrying a stable `blockId` |
| **Run** | Maximal same-style text stretch; the unit of measurement |
| **LineBox** | One placed line: page, content-box-relative rect, baseline, text range, segments |
| **stride** | `pageHeight + pageGap`, the y distance between page tops in the stack |
| **stack-local px** | Coordinates inside the zoom transform, pre-zoom |
| **Projection** | An overlay derived from PM state through `positionMap` (selection, caret, search, toolbar) |
| **Identity cache** | The adapter's WeakMap on PM nodes, making unchanged blocks pass through by reference |
| **Zero-copy** | The engine shares frozen LineBoxes across results; reference equality means unchanged |
| **Dirty bit** | Informal name for that reference-equality check, as used in repaint and grouping |

</details>

[^structural-sharing]: ProseMirror's document tree is persistent: an edit creates new nodes along the edited path while untouched siblings are carried over as the same object references. The adapter's identity cache is built entirely on this guarantee.

[^x11-primary]: On Linux, webviews paste the X11 PRIMARY selection into the focused editable on middle-click by default. When the Behavior toggle is off, the middle press is `preventDefault`ed unconditionally (press, release, and auxclick) so that native paste can't leak through; when on, `pasteFromSystemClipboard` replays the system clipboard through PM's own paste handler at the click point.

[^hidden-view]: `opacity: 0` but **not** `aria-hidden`: screen readers should find the editable text there, while canvases are `role="presentation"`. The `position: fixed` portal is the structural half of L3: nothing inside a scroll container can be scroll-triggered by the hidden view.

[^gdocs-parity]: The measured human-parity bar against Google Docs is documented in the README; a DOM-element paint rewrite is the known path if that bar becomes mandatory.
