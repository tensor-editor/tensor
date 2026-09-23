import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { EditorContent, type Editor } from '@tiptap/react';
import type { LayoutEngine, LayoutResult, LineBox, TextMetrics } from '@tensor-editor/engine';
import { createLayoutEngine } from '@tensor-editor/engine';
import { pmDocToSemantic, type AdapterBlock } from '@/lib/paginated/adapter';
import { getRealMetrics } from '@/lib/paginated/metrics';
import { assertContiguity } from '@/lib/paginated/paint';
import { caretGeometry, type CaretGeometry } from '@/lib/paginated/caret';
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

  // Latest layout for selection-driven caret updates (no relayout on
  // selection change — moving the caret must not re-run the walk).
  const layoutRef = useRef<LayoutState | null>(null);
  const fontsReadyRef = useRef(false);
  const stackRef = useRef<HTMLDivElement>(null);
  const relayoutRef = useRef<() => void>(() => {});

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
      updateCaretFromSelection();
    } catch (err) {
      // Loud: the adapter/engine throw is the contract violation report;
      // the fallback render is so a crash never eats the document.
      console.error('[PaginatedView] layout failed; falling back to pageless rendering:', err);
      setAdapterError(err instanceof Error ? err : new Error(String(err)));
      setPageInfo(1, 1);
    }
  }
  relayoutRef.current = relayout;

  // PM-driven relayout (L3's only PM read: the MODEL, not the view's
  // geometry). Also the font gate: the first layout must wait for
  // document.fonts.ready — the engine's line cache never invalidates on
  // metrics identity, so pre-font-load measurement would cache
  // fallback-font widths for the whole session (see metrics.ts).
  useEffect(() => {
    if (!editor) return;
    const onDocUpdate = () => relayoutRef.current();
    const onSelectionUpdate = () => updateCaretOnlyRef.current();
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
        <InputOnlyView editor={editor} hidden />
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
      <InputOnlyView editor={editor} hidden />
      {/* STEP 4: explicit outer size = natural stack dimensions x zoom, so
          scroll extents are correct BY CONSTRUCTION; the inner stack
          transform scales; every painted child lives inside the transform;
          NOTHING compensates per-element for zoom — the deleted disease
          was SelectionOverlay dividing by the container scale
          (docs/legacy/pagination-v1.md era). */}
      <div
        data-testid="paginated-zoom-wrapper"
        style={{
          width: `${stackW * z}px`,
          height: `${stackH * z}px`,
          margin: '0 auto',
          position: 'relative',
          overflow: 'hidden',
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
            transformOrigin: 'top center',
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
                {caret && caret.pageIndex === page.index && (
                  <div
                    data-testid="synthetic-caret"
                    className="tensor-caret"
                    style={{
                      left: `${page.contentBox.x + caret.x}px`,
                      top: `${page.contentBox.y + caret.y}px`,
                      height: `${caret.height}px`,
                    }}
                  />
                )}
              </PageSheet>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/**
 * L3's physical form: the PM view stays mounted, opacity 0, pointer
 * events off, caret and selection transparent — keyboard input and the
 * model selection live here, and NOTHING here is ever measured or
 * positioned from. In fallback mode it flips to the visible pageless
 * renderer in place (same EditorContent node — no remount).
 */
function InputOnlyView({ editor, hidden }: { editor: Editor; hidden: boolean }) {
  const style: CSSProperties | undefined = hidden
    ? {
        position: 'absolute',
        inset: 0,
        overflow: 'hidden',
        opacity: 0,
        pointerEvents: 'none',
        zIndex: 0,
      }
    : undefined;
  return (
    <div className={hidden ? 'pm-input-only' : undefined} style={style}>
      <EditorContent
        editor={editor}
        className="prose prose-neutral max-w-none focus:outline-none text-black"
      />
    </div>
  );
}