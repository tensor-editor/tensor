import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, type Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import type { LayoutEngine, LayoutResult, LineBox, TextMetrics } from '@tensor-editor/engine';
import { createLayoutEngine } from '@tensor-editor/engine';
import { pmDocToSemantic, type AdapterBlock } from '@/lib/paginated/adapter';
import { getRealMetrics } from '@/lib/paginated/metrics';
import { assertContiguity } from '@/lib/paginated/paint';
import { caretGeometry, caretStackRect, type CaretGeometry } from '@/lib/paginated/caret';
import { scrollCaretIntoView } from '@/lib/paginated/caretFollow';
import { setPaintedScrollHandler } from '@/lib/paginated/ScrollGuardExtension';
import { hitTestPoint } from '@/lib/paginated/hitTest';
import { toLayoutOptions } from '@/lib/document/pageSetup';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { PageSheet } from './paginated/PageSheet';
import { BlockCanvas } from './paginated/BlockCanvas';

/**
 * M4 PaginatedView — Tensor's default mode, first pixels.
 *
 * THE LAWS (encoded here; see also docs/legacy/pagination-v1.md for the
 * legacy disease each one cures):
 *  L1: the engine computes, never paints; the shell paints, never
 *      computes. Every coordinate below is an engine-issued positioned
 *      fact (LineBox/PageGeometry); this file only adds container
 *      offsets (zoom stack, page gap, content box).
 *  L2: ONE engine instance + ONE RealMetrics instance, React refs, for
 *      the lifetime of this view. M3's caches live INSIDE the engine
 *      instance — remounting either throws away warm walk/line caches
 *      mid-session, and pairing a differently-warm metrics instance
 *      with a cached engine silently violates parity.
 *  L3: the hidden PM view is INPUT ONLY — never measured, never
 *      positioned from. The legacy pipeline died of coordsAtPos/
 *      posAtCoords dead-zone ambiguity at page-break spacers; here PM
 *      geometry is never consulted at all — clicks hit-test the
 *      engine's LineBoxes instead (hitTest.ts).
 *  L4: pageSetup is read from the document store PER LAYOUT CALL,
 *      never captured at editor creation — the legacy frozen-options
 *      bug had spacer heights computed from stale margins forever
 *      after opening a file with different setup.
 *
 * NO DEBOUNCE, NO rAF BY DESIGN: PM update -> adapter ->
 * engine.layout -> setState -> paint, synchronously in one React
 * commit. The seam that makes that affordable is the engine's M3
 * incremental cache (blocksSpliced/linesRebroken) — a keystroke
 * re-walks only the edited block and its dependents. Debouncing would
 * reintroduce the stale-cache coordinate mismatches the legacy system
 * needed confirmation gates for.
 */

interface PaginatedViewProps {
  editor: Editor | null;
  /** TEST SEAM: inject deterministic metrics. Defaults to the app-wide
   * single RealMetrics (L2). The first injected instance wins for the
   * view's lifetime. */
  metrics?: TextMetrics;
}

interface LayoutState {
  blocks: AdapterBlock[];
  result: LayoutResult;
}

export function PaginatedView({ editor, metrics: injectedMetrics }: PaginatedViewProps) {
  // L2: one engine + one metrics for the view's lifetime.
  const engineRef = useRef<LayoutEngine | null>(null);
  const metricsRef = useRef<TextMetrics | null>(null);
  if (!engineRef.current) {
    if (!metricsRef.current) metricsRef.current = injectedMetrics ?? getRealMetrics();
    engineRef.current = createLayoutEngine({ metrics: metricsRef.current });
  }

  const [layout, setLayout] = useState<LayoutState | null>(null);
  const [caret, setCaret] = useState<CaretGeometry | null>(null);
  const [adapterError, setAdapterError] = useState<Error | null>(null);
  // The scroll handler below runs inside PM's dispatch (outside React's
  // render cycle) — it reads the fallback flag through this ref, not the
  // state value, so it never sees a stale closure.
  const adapterErrorRef = useRef<Error | null>(null);

  // Latest layout for selection-driven caret updates (no relayout on
  // selection change — moving the caret must not re-run the walk).
  const layoutRef = useRef<LayoutState | null>(null);
  const fontsReadyRef = useRef(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const relayoutRef = useRef<() => void>(() => {});
  // M4.2: a scroll-requesting PM transaction arrived; consumed by the
  // microtask follow (see the events effect).
  const pendingScrollRef = useRef(false);

  // Store subscriptions exist only to SCHEDULE relayout; the VALUES are
  // read fresh at call time (L4) — these selectors never feed options
  // directly.
  const pageSetup = useDocumentStore((s) => s.pageSetup);
  const defaultFontFamily = useConfigStore((s) => s.config.editor.defaultFontFamily);
  const defaultFontSize = useConfigStore((s) => s.config.editor.defaultFontSize);
  const zoomLevel = useConfigStore((s) => s.config.editor.zoomLevel);
  const setPageInfo = useDocumentStore((s) => s.setPageInfo);

  function updateCaretFromSelection() {
    const current = layoutRef.current;
    if (!editor || !current) return;
    const geometry = caretGeometry(
      current.blocks,
      current.result,
      editor.state.selection.head,
      metricsRef.current!
    );
    setCaret(geometry);
    setPageInfo(current.result.pages.length, geometry ? geometry.pageIndex + 1 : 1);
  }
  // Selection changes must re-derive the caret WITHOUT re-running the
  // walk (no relayout on caret moves); stable ref to dodge stale closures.
  const updateCaretOnlyRef = useRef(updateCaretFromSelection);
  updateCaretOnlyRef.current = updateCaretFromSelection;

  function relayout() {
    if (!editor || !fontsReadyRef.current) return;
    // L4: read per call, never captured.
    const pageSetupNow = useDocumentStore.getState().pageSetup;
    const { defaultFontFamily: family, defaultFontSize: size } =
      useConfigStore.getState().config.editor;
    try {
      const adapted = pmDocToSemantic(editor.state.doc, {
        fontFamily: family,
        fontSize: size,
      });
      const result = engineRef.current!.layout(adapted.doc, toLayoutOptions(pageSetupNow));
      assertContiguity(result);
      const next: LayoutState = { blocks: adapted.blocks, result };
      layoutRef.current = next;
      setLayout(next);
      setAdapterError(null);
      adapterErrorRef.current = null;
      updateCaretFromSelection();
    } catch (err) {
      // Loud: the adapter/engine throw is the contract violation report;
      // the fallback render is so a crash never eats the document.
      console.error('[PaginatedView] layout failed; falling back to pageless rendering:', err);
      const error = err instanceof Error ? err : new Error(String(err));
      adapterErrorRef.current = error;
      setAdapterError(error);
      setPageInfo(1, 1);
    }
  }
  relayoutRef.current = relayout;

  // PM-driven relayout (L3's only PM read: the MODEL, not the view's
  // geometry). Also the font gate: the first layout must wait on
  // document.fonts.ready — the engine's line cache never invalidates on
  // metrics identity, so pre-font-load measurement would cache
  // fallback-font widths for the whole session (see metrics.ts).
  //
  // M4.2: the caret-follow TRIGGER is PM's own intent flag —
  // `transaction.scrolledIntoView` is set only by tr.scrollIntoView(),
  // which PM's key/input handling sets on caret motion; layout churn
  // alone dispatches no flagged transaction, so churn never scrolls.
  // The FOLLOW runs synchronously with the dispatch, AFTER the layout
  // it must read is fresh: TipTap emits transaction -> selectionUpdate
  // -> update, so a doc-changing transaction follows at the end of
  // 'update' (relayout ran first), and a selection-only transaction at
  // the end of 'selectionUpdate' (layout unchanged). Never inside PM's
  // handleScrollToSelection — that fires mid-updateState, before this
  // view's synchronous relayout, and would read a stale layout.
  useEffect(() => {
    if (!editor) return;

    const followPendingScroll = () => {
      if (!pendingScrollRef.current) return;
      pendingScrollRef.current = false;
      if (adapterErrorRef.current) return; // fallback: PM native already scrolled the visible DOM
      const current = layoutRef.current;
      const stack = stackRef.current;
      if (!current || !stack) return; // nothing painted yet: nothing to reveal
      const caretGeom = caretGeometry(
        current.blocks,
        current.result,
        editor.state.selection.head,
        metricsRef.current!
      );
      if (!caretGeom) return; // selection outside text: nothing to reveal
      const page0 = current.result.pages[0];
      const { pageSetup: setupNow } = useDocumentStore.getState();
      const zoomNow = useConfigStore.getState().config.editor.zoomLevel / 100;
      scrollCaretIntoView(
        stack,
        caretStackRect(caretGeom, page0.contentBox.x, page0.contentBox.y, page0.size.height, setupNow.pageGap),
        zoomNow
      );
    };

    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      if (!transaction.scrolledIntoView) return; // no intent -> no scroll, ever
      pendingScrollRef.current = true;
    };
    const onDocUpdate = () => {
      relayoutRef.current();
      followPendingScroll(); // doc changed: follow reads the fresh layout
    };
    const onSelectionUpdate = ({ transaction }: { transaction: Transaction }) => {
      updateCaretOnlyRef.current();
      // Selection-only motion (no doc change): the layout is already
      // current — follow now. A doc-changing transaction is followed by
      // the 'update' handler above (after relayout), not here.
      if (!transaction.docChanged) followPendingScroll();
    };
    editor.on('transaction', onTransaction);
    editor.on('update', onDocUpdate);
    editor.on('selectionUpdate', onSelectionUpdate);

    const fonts =
      typeof document !== 'undefined' && document.fonts ? document.fonts.ready : Promise.resolve();
    let cancelled = false;
    void fonts.then(() => {
      if (cancelled) return;
      fontsReadyRef.current = true;
      relayoutRef.current();
    });

    return () => {
      cancelled = true;
      editor.off('transaction', onTransaction);
      editor.off('update', onDocUpdate);
      editor.off('selectionUpdate', onSelectionUpdate);
    };
  }, [editor]);

  // Store-driven reflow (A4 -> Letter, default font changes) relayouts
  // WITHOUT remounting the view (test g): the engine stays warm, its
  // opts-invalidation path handles the geometry change (cacheEpoch bump).
  useEffect(() => {
    relayoutRef.current();
  }, [pageSetup, defaultFontFamily, defaultFontSize]);

  // M4.2 caret-follow registration: PM asks "scroll to selection"; we
  // block its native default (L3: the hidden view's coordsAtPos geometry
  // must never drive scrolling) and answer against PAINTED coordinates.
  // Declines (false) only in the adapter fallback, where the visible
  // pageless DOM is the real content and PM's native scroll is correct.
  // THE SCROLL SPEC lives in caretFollow.ts; the follow itself runs in
  // the transaction listener below.
  useEffect(() => {
    if (!editor) return;
    setPaintedScrollHandler(() => !adapterErrorRef.current);
    return () => setPaintedScrollHandler(null);
  }, [editor]);

  function handleMouseDown(e: React.MouseEvent) {
    if (!editor || adapterError || !layout) return;
    e.preventDefault();
    const stackEl = stackRef.current;
    if (!stackEl) return;
    const z = zoomLevel / 100;
    const stackRect = stackEl.getBoundingClientRect();
    const localX = (e.clientX - stackRect.left) / z;
    const localY = (e.clientY - stackRect.top) / z;

    const { result } = layout;
    const geometry = result.pages[0];
    if (!geometry) return;
    const pageStride = geometry.size.height + pageSetup.pageGap;
    const pageIndex = Math.min(
      Math.max(Math.floor(localY / pageStride), 0),
      result.pages.length - 1
    );
    const pageLocalY = localY - pageIndex * pageStride;
    const cb = geometry.contentBox;
    const hit = hitTestPoint(
      result,
      layout.blocks,
      metricsRef.current!,
      pageIndex,
      localX - cb.x,
      pageLocalY - cb.y
    );
    // The hidden PM view receives keyboard focus with preventScroll: its
    // geometry is meaningless (L3), so letting the browser reveal its
    // native caret would scroll the App container to a nonsense spot.
    (editor.view.dom as HTMLElement).focus({ preventScroll: true });
    if (hit) {
      const block = layout.blocks.find((b) => b.id === hit.blockId);
      if (block) editor.commands.setTextSelection(block.from + 1 + hit.offset);
    }
  }

  if (!editor) return null;

  // Fallback (test e): the strict-adapter throw surfaces as a pageless
  // render of the SAME EditorContent — never a crash. The input-view
  // container flips from hidden-input to visible pageless in place; the
  // PM view is never remounted.
  if (adapterError) {
    return (
      <div className="relative" data-testid="paginated-fallback">
        <div className="mx-auto w-full max-w-3xl px-8 py-6">
          <div className="mb-4 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            This document contains content the paginated engine does not handle yet (lists,
            quotes, code blocks, rules). Rendering without pages — nothing is lost.
          </div>
          <EditorContent
            editor={editor}
            className="prose prose-neutral max-w-none focus:outline-none text-black"
          />
        </div>
      </div>
    );
  }

  if (!layout || layout.result.pages.length === 0) {
    // Fonts gate or a momentarily empty doc: the input view still mounts
    // (keyboard input must never wait on paint).
    return (
      <div className="relative">
        <HiddenInputView editor={editor} />
      </div>
    );
  }

  const { result, blocks } = layout;
  const geometry = result.pages[0];
  const { width: pageW, height: pageH } = geometry.size;
  const gap = pageSetup.pageGap;
  const z = zoomLevel / 100;
  const stackW = pageW;
  const stackH = result.pages.length * pageH + (result.pages.length - 1) * gap;

  // Group lines per page per block, document order.
  const groupsByPage = new Map<number, { blockId: string; lines: LineBox[] }[]>();
  for (const line of result.lines) {
    let pageGroups = groupsByPage.get(line.pageIndex);
    if (!pageGroups) {
      pageGroups = [];
      groupsByPage.set(line.pageIndex, pageGroups);
    }
    let group = pageGroups.find((g) => g.blockId === line.blockId);
    if (!group) {
      group = { blockId: line.blockId, lines: [] };
      pageGroups.push(group);
    }
    group.lines.push(line);
  }

  return (
    <div className="relative" data-testid="paginated-root">
      <HiddenInputView editor={editor} />
      {/* STEP 4: explicit outer size = natural stack dimensions x zoom, so
          scroll extents are correct BY CONSTRUCTION; the inner stack
          transform scales; every painted child lives inside the transform;
          NOTHING compensates per-element for zoom — the deleted disease
          was SelectionOverlay dividing by the container scale
          (docs/legacy/pagination-v1.md era).
          M4.1: origin must be TOP LEFT (not top center) — the wrapper is
          exactly stack*z wide, so a center origin would push the scaled
          stack outside the wrapper at any z != 1 (clipped left/right
          halves at 50%/150%); top-left makes the scaled stack fill the
          wrapper exactly. No overflow:hidden here — sheet shadows must
          bleed past the sheet edge, and box-shadows never create
          scrollable overflow, so extents stay exact. */}
      <div
        data-testid="paginated-zoom-wrapper"
        style={{
          width: `${stackW * z}px`,
          height: `${stackH * z}px`,
          margin: '0 auto',
          position: 'relative',
        }}
        onMouseDown={handleMouseDown}
      >
        <div
          ref={stackRef}
          data-testid="paginated-stack"
          style={{
            width: `${stackW}px`,
            height: `${stackH}px`,
            position: 'relative',
            transform: `scale(${z})`,
            transformOrigin: 'top left',
          }}
        >
          {result.pages.map((page) => {
            const pageGroups = groupsByPage.get(page.index) ?? [];
            return (
              <PageSheet key={page.index} geometry={page} top={page.index * (pageH + gap)}>
                {pageGroups.map((group) => {
                  const block = blocks.find((b) => b.id === group.blockId);
                  if (!block) return null;
                  const minY = group.lines[0].rect.y;
                  return (
                    <BlockCanvas
                      key={group.blockId}
                      lines={group.lines}
                      runs={block.runs}
                      text={block.text}
                      metrics={metricsRef.current!}
                      left={page.contentBox.x}
                      top={page.contentBox.y + minY}
                      width={page.contentBox.width}
                    />
                  );
                })}
              </PageSheet>
            );
          })}
          {/* Stack-level caret, positioned via caretStackRect — the SAME
              arithmetic the M4.2 caret-follow scroll consumes (one source
              of truth; never re-derived). Sibling AFTER the sheets, so it
              paints above them, inside the scale transform (no zoom
              compensation — M4 law). */}
          {caret &&
            (() => {
              const r = caretStackRect(
                caret,
                geometry.contentBox.x,
                geometry.contentBox.y,
                pageH,
                gap
              );
              return (
                <div
                  data-testid="synthetic-caret"
                  className="tensor-caret"
                  style={{ left: `${r.left}px`, top: `${r.top}px`, height: `${r.height}px` }}
                />
              );
            })()}
        </div>
      </div>
    </div>
  );
}

/**
 * L3's physical form — and M4.2 STEP 3's structural fix ("kill Suspect
 * B"): the hidden PM view is portaled to document.body and positioned
 * FIXED, a sibling of the App scroller rather than a descendant. Nothing
 * inside a scroll container can be scroll-triggered by it: PM's native
 * scrollIntoView (blocked in paginated mode anyway) would find no
 * scrollable ancestor, and focus() cannot scroll the desk. The
 * contenteditable itself is untouched — keyboard input, IME, and the
 * model selection all live here exactly as before; the input-only law
 * never had any business inside the scroller. Opacity 0, pointer events
 * off, caret/selection transparent (index.css .pm-input-only).
 */
function HiddenInputView({ editor }: { editor: Editor }) {
  return createPortal(
    <div
      className="pm-input-only"
      style={{ position: 'fixed', top: 0, left: 0, width: '600px', opacity: 0, pointerEvents: 'none' }}
      aria-hidden="true"
    >
      <EditorContent
        editor={editor}
        className="prose prose-neutral max-w-none focus:outline-none text-black"
      />
    </div>,
    document.body
  );
}