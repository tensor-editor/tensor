import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, type Editor } from '@tiptap/react';
import type { Transaction } from '@tiptap/pm/state';
import type { LayoutEngine, LayoutResult, LineBox, TextMetrics } from '@tensor-editor/engine';
import { createLayoutEngine } from '@tensor-editor/engine';
import { pmDocToSemantic, type AdapterBlock } from '@/lib/paginated/adapter';
import { getRealMetrics } from '@/lib/paginated/metrics';
import { assertContiguity } from '@/lib/paginated/paint';
import {
  blockOffsetToPmPos,
  blockRangeAround,
  caretGeometry,
  caretStackRect,
  paintedBounds,
  textRangeLineRects,
  wordRangeAround,
  type CaretGeometry,
  type PaintedRect,
} from '@/lib/paginated/positionMap';
import { hitTest } from '@/lib/paginated/hitTest';
import { scrollCaretIntoView } from '@/lib/paginated/caretFollow';
import { setPaintedScrollHandler } from '@/lib/paginated/ScrollGuardExtension';
import { searchPluginKey } from '@/lib/editor/search/SearchExtension';
import { getScrollParent } from '@/lib/editor/domUtils';
import type { FloatingToolbarPosition } from '@/lib/editor/useFloatingToolbar';
import { toLayoutOptions } from '@/lib/document/pageSetup';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { PageSheet } from './paginated/PageSheet';
import { BlockCanvas } from './paginated/BlockCanvas';
import { SelectionHighlights } from './paginated/SelectionHighlights';
import { SearchHighlights } from './paginated/SearchHighlights';
import { FloatingToolbar } from './FloatingToolbar';
import { TooltipProvider } from '../ui/tooltip';

/**
 * M4 PaginatedView — Tensor's default mode, first pixels.
 *
 * THE LAWS (see also docs/legacy/pagination-v1.md for the legacy
 * disease each one cures):
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
 * re-walks only the edited block and its dependents.
 *
 * M5: the selection overlay, search highlights, caret, floating
 * toolbar, and IME preview are all PROJECTIONS of PM state (see
 * positionMap.ts — the principle). All selection changes go through
 * PM transactions.
 */

const TOOLBAR_HEIGHT_EST = 44;
const TOOLBAR_WIDTH_EST = 340;
const EDGE_PAD = 8;

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

interface SearchPaint {
  all: PaintedRect[];
  current: PaintedRect[];
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
  const [selRects, setSelRects] = useState<PaintedRect[]>([]);
  const [toolbarPos, setToolbarPos] = useState<FloatingToolbarPosition | null>(null);
  const [searchPaint, setSearchPaint] = useState<SearchPaint | null>(null);
  const [composing, setComposing] = useState<string | null>(null);
  const [adapterError, setAdapterError] = useState<Error | null>(null);
  // Handlers below run inside PM's dispatch (outside React's render
  // cycle) — they read the fallback flag through this ref, not state.
  const adapterErrorRef = useRef<Error | null>(null);

  const layoutRef = useRef<LayoutState | null>(null);
  const fontsReadyRef = useRef(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const relayoutRef = useRef<() => void>(() => {});
  const selectionProjectionRef = useRef<() => void>(() => {});
  const searchProjectionRef = useRef<() => void>(() => {});
  const pendingScrollRef = useRef(false);
  const prevSearchIndexRef = useRef(-1);
  const prevSearchStateRef = useRef<unknown>(null);
  const draggingRef = useRef(false);
  const lastClickRef = useRef<{ t: number; x: number; y: number; c: number } | null>(null);

  // Store subscriptions exist only to SCHEDULE relayout; the VALUES are
  // read fresh at call time (L4) — these selectors never feed options
  // directly.
  const pageSetup = useDocumentStore((s) => s.pageSetup);
  const defaultFontFamily = useConfigStore((s) => s.config.editor.defaultFontFamily);
  const defaultFontSize = useConfigStore((s) => s.config.editor.defaultFontSize);
  const zoomLevel = useConfigStore((s) => s.config.editor.zoomLevel);
  const showFloatingToolbar = useConfigStore((s) => s.config.useFloatingToolbar);
  const setPageInfo = useDocumentStore((s) => s.setPageInfo);

  function computeToolbar(rects: readonly PaintedRect[]): FloatingToolbarPosition | null {
    const stack = stackRef.current;
    const bounds = paintedBounds(rects);
    if (!stack || !bounds) return null;
    const z = useConfigStore.getState().config.editor.zoomLevel / 100;
    const sr = stack.getBoundingClientRect();
    const view = (getScrollParent(stack) ?? stack).getBoundingClientRect();
    const aboveTop = sr.top + bounds.top * z - EDGE_PAD;
    const belowTop = sr.top + bounds.bottom * z + EDGE_PAD;
    const placement =
      aboveTop - TOOLBAR_HEIGHT_EST >= view.top ? 'above' : 'below';
    const left = Math.min(
      Math.max(sr.left + bounds.left * z, view.left + EDGE_PAD),
      Math.max(view.left + EDGE_PAD, view.right - EDGE_PAD - TOOLBAR_WIDTH_EST)
    );
    return { left, top: aboveTop, bottom: belowTop, placement };
  }

  function updateSelectionProjection() {
    const current = layoutRef.current;
    if (!editor || !current) return;
    const { selection } = editor.state;
    const geom = caretGeometry(
      current.blocks,
      current.result,
      selection.head,
      metricsRef.current!
    );
    setCaret(geom);
    setPageInfo(current.result.pages.length, geom ? geom.pageIndex + 1 : 1);
    const rects = selection.empty
      ? []
      : textRangeLineRects(
          current.blocks,
          current.result,
          selection.from,
          selection.to,
          metricsRef.current!,
          useDocumentStore.getState().pageSetup.pageGap
        );
    setSelRects(rects);
    setToolbarPos(
      !draggingRef.current && !selection.empty && useConfigStore.getState().config.useFloatingToolbar
        ? computeToolbar(rects)
        : null
    );
  }

  function updateSearchProjection(force = false) {
    if (!editor) return;
    const st = searchPluginKey.getState(editor.state);
    const current = layoutRef.current;
    if (!st || !current) return;
    // Selection-only transactions leave the plugin state object identical
    // — skip re-projection (and the re-render) for those.
    if (!force && st === prevSearchStateRef.current) return;
    prevSearchStateRef.current = st;
    const stack = stackRef.current;
    const gap = useDocumentStore.getState().pageSetup.pageGap;
    const m = metricsRef.current!;
    const all: PaintedRect[] = [];
    for (const match of st.matches) {
      all.push(
        ...textRangeLineRects(current.blocks, current.result, match.from, match.to, m, gap)
      );
    }
    const cur = st.currentIndex >= 0 ? st.matches[st.currentIndex] : undefined;
    const currentRects = cur
      ? textRangeLineRects(current.blocks, current.result, cur.from, cur.to, m, gap)
      : [];
    setSearchPaint({ all, current: currentRects });
    if (st.currentIndex !== prevSearchIndexRef.current) {
      prevSearchIndexRef.current = st.currentIndex;
      // Current-match navigation scrolls via the M4.2 minimal-edge follow.
      if (currentRects.length && stack) {
        const r = currentRects[0];
        scrollCaretIntoView(
          stack,
          { left: r.left, top: r.top, height: r.height },
          useConfigStore.getState().config.editor.zoomLevel / 100
        );
      }
    }
  }

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
      updateSelectionProjection();
      updateSearchProjection(true);
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
  selectionProjectionRef.current = updateSelectionProjection;
  searchProjectionRef.current = updateSearchProjection;

  function pmPosAt(e: { clientX: number; clientY: number }): number | null {
    const current = layoutRef.current;
    const stack = stackRef.current;
    if (!current || !stack) return null;
    const z = useConfigStore.getState().config.editor.zoomLevel / 100;
    const r = stack.getBoundingClientRect();
    const hit = hitTest(
      current.result,
      current.blocks,
      metricsRef.current!,
      useDocumentStore.getState().pageSetup.pageGap,
      (e.clientX - r.left) / z,
      (e.clientY - r.top) / z
    );
    if (!hit) return null;
    const block = current.blocks.find((b) => b.id === hit.blockId);
    return block ? blockOffsetToPmPos(block, hit.offset) : null;
  }

  function startDrag(anchor: number) {
    draggingRef.current = true;
    setToolbarPos(null);
    const schedule =
      typeof requestAnimationFrame === 'function'
        ? requestAnimationFrame
        : (f: FrameRequestCallback) => {
            f(0);
            return 0;
          };
    let scheduled = false;
    let pending: { clientX: number; clientY: number } | null = null;

    const extend = () => {
      scheduled = false;
      if (!pending) return;
      const point = pending;
      pending = null;
      const pos = pmPosAt(point);
      if (pos != null) editor?.commands.setTextSelection({ from: anchor, to: pos });
    };
    const onMove = (ev: MouseEvent) => {
      pending = { clientX: ev.clientX, clientY: ev.clientY };
      if (!scheduled) {
        scheduled = true;
        schedule(extend);
      }
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      draggingRef.current = false;
      // The drag is final — surface the toolbar at the settled selection.
      selectionProjectionRef.current();
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp, { once: true });
  }

  function handleMouseDown(e: React.MouseEvent) {
    if (!editor || adapterError || !layout) return;
    e.preventDefault();
    // The hidden PM view receives keyboard focus with preventScroll: its
    // geometry is meaningless (L3), so letting the browser reveal its
    // native caret would scroll the App container to a nonsense spot.
    (editor.view.dom as HTMLElement).focus({ preventScroll: true });
    const pos = pmPosAt(e);
    if (pos == null) return;

    const now = Date.now();
    const prev = lastClickRef.current;
    const dx = prev ? e.clientX - prev.x : 999;
    const dy = prev ? e.clientY - prev.y : 999;
    const count =
      prev && now - prev.t < 500 && dx * dx + dy * dy < 100
        ? Math.min(prev.c + 1, 3)
        : 1;
    lastClickRef.current = { t: now, x: e.clientX, y: e.clientY, c: count };

    if (count === 2) {
      editor.commands.setTextSelection(wordRangeAround(editor.state.doc, pos));
      return;
    }
    if (count === 3) {
      editor.commands.setTextSelection(blockRangeAround(editor.state.doc, pos) ?? pos);
      return;
    }

    if (e.shiftKey) {
      // Extend from PM's own anchor — the shell never tracks selection.
      editor.commands.setTextSelection({ from: editor.state.selection.anchor, to: pos });
    } else {
      editor.commands.setTextSelection(pos);
      startDrag(pos);
    }
  }

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
  // it must read is fresh: a doc-changing transaction follows at the
  // end of 'update' (relayout ran first), a selection-only one at the
  // end of 'selectionUpdate'.
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
        caretStackRect(
          caretGeom,
          page0.contentBox.x,
          page0.contentBox.y,
          page0.size.height,
          setupNow.pageGap
        ),
        zoomNow
      );
    };

    const onTransaction = ({ transaction }: { transaction: Transaction }) => {
      // Search meta (query/index) arrives without doc changes; doc
      // changes are covered by the relayout in 'update' below.
      if (!transaction.docChanged) searchProjectionRef.current();
      if (transaction.scrolledIntoView) pendingScrollRef.current = true;
    };
    const onDocUpdate = () => {
      relayoutRef.current();
      followPendingScroll(); // doc changed: follow reads the fresh layout
    };
    const onSelectionUpdate = ({ transaction }: { transaction: Transaction }) => {
      selectionProjectionRef.current();
      // Selection-only motion (no doc change): the layout is already
      // current — follow now. Doc-changing transactions are followed by
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
  // WITHOUT remounting the view: the engine stays warm, its
  // opts-invalidation path handles the geometry change.
  useEffect(() => {
    relayoutRef.current();
  }, [pageSetup, defaultFontFamily, defaultFontSize]);

  // M4.2 caret-follow registration: block PM's native
  // scroll-to-selection (L3) and decline only in the adapter fallback,
  // where the visible pageless DOM is the real content.
  useEffect(() => {
    if (!editor) return;
    setPaintedScrollHandler(() => !adapterErrorRef.current);
    return () => setPaintedScrollHandler(null);
  }, [editor]);

  // IME composition preview (M5 STEP 7). The one sanctioned L3
  // exception: composition text is INPUT STATE read from events on the
  // hidden view, never geometry — PM keeps the in-progress string out
  // of the doc model until compositionend, so the engine can't paint
  // it. The preview is positioned purely from engine rects.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom as HTMLElement;
    const onStart = () => setComposing('');
    const onUpdate = (e: CompositionEvent) => setComposing(e.data);
    const onEnd = () => setComposing(null);
    dom.addEventListener('compositionstart', onStart);
    dom.addEventListener('compositionupdate', onUpdate);
    dom.addEventListener('compositionend', onEnd);
    return () => {
      dom.removeEventListener('compositionstart', onStart);
      dom.removeEventListener('compositionupdate', onUpdate);
      dom.removeEventListener('compositionend', onEnd);
    };
  }, [editor]);

  if (!editor) return null;

  // Fallback: the strict-adapter throw surfaces as a pageless render of
  // the SAME EditorContent — never a crash. The input-view container
  // flips from hidden-input to visible pageless in place.
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
  const rootRect = rootRef.current?.getBoundingClientRect();

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
    <div className="relative" data-testid="paginated-root" ref={rootRef}>
      <HiddenInputView editor={editor} />
      {/* Explicit outer size = natural stack dimensions x zoom, so scroll
          extents are correct BY CONSTRUCTION; the inner stack transform
          scales; every painted child lives inside the transform; NOTHING
          compensates per-element for zoom. Top-left origin: the wrapper
          is exactly stack*z wide, so the scaled stack fills it exactly.
          No overflow:hidden — sheet shadows bleed, and box-shadows
          never create scrollable overflow. */}
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
          {searchPaint && (
            <SearchHighlights matches={searchPaint.all} current={searchPaint.current} />
          )}
          <SelectionHighlights rects={selRects} />
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
                  aria-hidden="true"
                  className="tensor-caret"
                  style={{ left: `${r.left}px`, top: `${r.top}px`, height: `${r.height}px` }}
                />
              );
            })()}
          {composing != null && caret &&
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
                  data-testid="composing-preview"
                  aria-hidden="true"
                  className="pointer-events-none absolute whitespace-pre text-primary underline"
                  style={{
                    left: `${r.left}px`,
                    top: `${r.top}px`,
                    fontFamily: defaultFontFamily,
                    fontSize: `${defaultFontSize}px`,
                    lineHeight: `${r.height}px`,
                  }}
                >
                  {composing}
                </div>
              );
            })()}
        </div>
      </div>
      {/* The floating toolbar is UI chrome, not document content — it
          renders OUTSIDE the zoom transform at 100% scale, positioned
          from the selection's painted bounding box. */}
      {toolbarPos && showFloatingToolbar && rootRect && (
        <TooltipProvider>
          <FloatingToolbar
            editor={editor}
            position={toolbarPos}
            containerTop={rootRect.top}
            containerLeft={rootRect.left}
          />
        </TooltipProvider>
      )}
    </div>
  );
}

/**
 * L3's physical form — and M4.2's structural fix ("kill Suspect B"):
 * the hidden PM view is portaled to document.body and positioned FIXED,
 * a sibling of the App scroller rather than a descendant. Nothing
 * inside a scroll container can be scroll-triggered by it. The
 * contenteditable itself is untouched — keyboard input, IME, and the
 * model selection all live here. NOT aria-hidden (M5 a11y): opacity 0
 * keeps it in the accessibility tree, which is exactly where screen
 * readers should find the editable text.
 */
function HiddenInputView({ editor }: { editor: Editor }) {
  return createPortal(
    <div
      className="pm-input-only"
      style={{ position: 'fixed', top: 0, left: 0, width: '600px', opacity: 0, pointerEvents: 'none' }}
    >
      <EditorContent
        editor={editor}
        className="prose prose-neutral max-w-none focus:outline-none text-black"
      />
    </div>,
    document.body
  );
}
