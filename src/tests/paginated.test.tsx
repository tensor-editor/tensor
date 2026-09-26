import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { MarginsDialog } from '@/components/dialogs/MarginsDialog';
import { renderTensor, renderTensorInScrollContainer, GEOMETRY, settleLayout } from './harness';
import { DEFAULT_MARGINS, MARGIN_PRESETS, PAGE_GAP, toLayoutOptions, type Margins } from '@/lib/document/pageSetup';
import { DocumentFileSchema } from '@/lib/document/schema';

// A 40-line paragraph (62 chars/line under FakeMetrics): three of these
// tile into 54 + 54 + 12 lines -> exactly 3 pages.
const longParagraph = `<p>${'a'.repeat(GEOMETRY.charsPerLine * 40)}</p>`;
const threePageDoc = longParagraph.repeat(3);

// Base for toLayoutOptions calls that swap only the margins.
const PAGE_SETUP_BASE = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };

const pageSheets = () => Array.from(document.querySelectorAll('[data-page-index]'));

beforeEach(() => {
  // The document store persists between tests (module singleton) — reset
  // the parts the PaginatedView publishes, including the page setup that
  // later tests mutate (g sets A4; h/i/j assume Letter defaults).
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
  });
  useDocumentPropertiesStore.setState({ marginsIsOpen: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle() {
  // The view's initial layout is gated on document.fonts.ready (metrics
  // stability, see PaginatedView); jsdom resolves it on a microtask.
  await settleLayout();
}

describe('PaginatedView integration', () => {
  it('a. multi-page doc renders N sheets, contiguity passes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    renderTensor(threePageDoc);
    await settle();

    expect(pageSheets()).toHaveLength(3);
    // Dev-only contiguity assert (paint.ts) runs under vitest — it must
    // have found no seams.
    const contiguityErrors = consoleError.mock.calls.filter((c) =>
      String(c[0]).includes('contiguity')
    );
    expect(contiguityErrors).toEqual([]);
  });

  it('b. typing at a page-boundary line: no scroll jump', async () => {
    const { editor } = renderTensorInScrollContainer(threePageDoc);
    await settle();

    const container = document.querySelector('[data-testid="scroll-container"]') as HTMLElement;
    act(() => {
      container.scrollTop = 250;
    });

    // Type near the end of the middle paragraph — the edit reflows the
    // page boundary below the caret.
    const docEnd = editor.state.doc.content.size;
    act(() => {
      editor.commands.setTextSelection(docEnd - 5);
      editor.commands.insertContent('xyz');
    });
    await settle();

    expect(container.scrollTop).toBe(250);
  });

  it('c. caret tracks typing at line end and at a wrapped-line start', async () => {
    const { editor } = renderTensor();
    await settle();

    // REGRESSION PIN: the editor's initial content ("<p>Start typing…</p>")
    // is created WITHOUT a transaction — ensureBlockIds (onCreate) must
    // have minted its id, or the very first layout would throw and boot
    // into the pageless fallback.
    expect(pageSheets()).toHaveLength(1);
    expect(document.querySelector('[data-testid="paginated-fallback"]')).toBeNull();

    // 'Hello' — caret at end of the first (only) line: x = 5 chars * 10px.
    act(() => {
      editor.commands.setContent('<p>Hello</p>');
      editor.commands.setTextSelection(6); // from=0 -> text offset 5
    });
    await settle();
    let caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret).not.toBeNull();
    expect(caret.style.left).toBe(`${GEOMETRY.contentX + 5 * 10}px`);
    expect(caret.style.top).toBe(`${GEOMETRY.contentY}px`);
    expect(caret.style.height).toBe('16px');

    // 62 chars fill line 1 exactly; 'b' wraps to line 2. Caret at the
    // wrapped-line start: x = 0, y = 16.
    act(() => {
      editor.commands.setContent(`<p>${'a'.repeat(GEOMETRY.charsPerLine)}b</p>`);
      editor.commands.setTextSelection(1 + GEOMETRY.charsPerLine);
    });
    await settle();
    caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret.style.left).toBe(`${GEOMETRY.contentX}px`);
    expect(caret.style.top).toBe(`${GEOMETRY.contentY + 16}px`);
  });

  it('d. Ctrl+Enter -> PageBreakNode -> adapter -> following block starts a fresh page (FLAGSHIP)', async () => {
    const { editor } = renderTensor('<p>First</p><p>Second</p>');
    await settle();
    expect(pageSheets()).toHaveLength(1);

    // Cursor at end of 'First'; dispatch the real shortcut through the
    // real keydown pipeline (DynamicShortcutsExtension -> insertPageBreak).
    act(() => {
      editor.commands.setTextSelection(6);
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true })
      );
    });
    await settle();

    expect(pageSheets()).toHaveLength(2);
    // The block after the break starts the fresh page at the content-box
    // top (rect.y === 0 -> canvas top === contentY). No mid-block
    // FragmentBreak was involved (forced break spelling, not a split).
    const page2 = document.querySelector('[data-page-index="1"]') as HTMLElement;
    const firstBlockOnPage2 = page2.querySelector('canvas') as HTMLElement;
    expect(firstBlockOnPage2).not.toBeNull();
    expect(firstBlockOnPage2.style.top).toBe(`${GEOMETRY.contentY}px`);
    // The synthetic caret followed the selection into page 2. The
    // caret is a stack-level sibling of the sheets (shared caretStackRect
    // math) — page 2 line 0 sits at 1*(1056+32) + 96 = 1184px stack-local.
    const caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret).not.toBeNull();
    expect(caret.style.top).toBe('1184px');
  });

  it('e. list doc -> loud adapter throw -> pageless fallback renders, no crash', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { editor } = renderTensor();
    await settle();

    act(() => {
      editor.commands.setContent('<ul><li>item one</li><li>item two</li></ul>');
    });
    await settle();

    // LOUD: the strict-kinds adapter throw surfaced on the console.
    expect(
      consoleError.mock.calls.some((c) => c.map(String).join(' ').includes('unsupported block kind'))
    ).toBe(true);
    // No crash: the fallback rendered — visible pageless content, no sheets.
    expect(document.querySelector('[data-testid="paginated-fallback"]')).not.toBeNull();
    expect(pageSheets()).toHaveLength(0);
    expect(editor.view.dom.isConnected).toBe(true);
  });

  it('g. store-driven pageSetup change (A4 -> Letter) reflows without remount', async () => {
    renderTensor(threePageDoc);
    await settle();

    const stackBefore = document.querySelector('[data-testid="paginated-stack"]');
    const sheetBefore = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheetBefore.style.width).toBe(`${GEOMETRY.pageWidth}px`);

    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, pageSize: 'A4' });
    });
    await settle();

    // Reflowed geometry: A4 = 595pt wide → 595 * 96/72 = 793px.
    const sheetAfter = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheetAfter.style.width).toBe('793px');
    // No remount: same DOM nodes.
    expect(document.querySelector('[data-testid="paginated-stack"]')).toBe(stackBefore);
    expect(document.querySelector('[data-page-index="0"]')).toBe(sheetBefore);
  });

  it('h. orientation: landscape swaps page dimensions without remount', async () => {
    renderTensor('<p>hello world</p>');
    await settle();

    const sheetBefore = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheetBefore.style.width).toBe(`${GEOMETRY.pageWidth}px`);
    expect(sheetBefore.style.height).toBe(`${GEOMETRY.pageHeight}px`);

    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, orientation: 'landscape' });
    });
    await settle();

    const sheetAfter = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheetAfter.style.width).toBe(`${GEOMETRY.pageHeight}px`);
    expect(sheetAfter.style.height).toBe(`${GEOMETRY.pageWidth}px`);
    expect(sheetAfter).toBe(sheetBefore); // no remount
  });

  it('i. custom page size: dims flow through layout, landscape swaps them', async () => {
    renderTensor('<p>hello world</p>');
    await settle();

    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      // Store holds POINTS; the engine receives px (1pt = 96/72px).
      setPageSetup({ ...pageSetup, pageSize: 'custom', customWidth: 700, customHeight: 900 });
    });
    await settle();

    const sheet = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheet.style.width).toBe('933px');  // 700pt * 4/3 = 933px
    expect(sheet.style.height).toBe('1200px'); // 900pt * 4/3 = 1200px

    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, orientation: 'landscape' });
    });
    await settle();

    const landscape = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(landscape.style.width).toBe('1200px');
    expect(landscape.style.height).toBe('933px');
  });

  it('j. page background: pageColor paints sheets, absent = white class', async () => {
    renderTensor('<p>hello world</p>');
    await settle();

    let sheet = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheet.className).toContain('bg-white');

    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, pageColor: '#fef3c7' });
    });
    await settle();

    sheet = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheet.className).not.toContain('bg-white');
    expect(sheet.style.backgroundColor).toBe('rgb(254, 243, 199)');
  });
});

// ─── M5.13/M6: margins — presets, commit-gated Apply, persistence ────────

describe('margins (M5.13 presets, M6 Apply dialog)', () => {
  it('k. presets convert to Word’s physical sizes in engine px; Normal ≡ DEFAULT_MARGINS', () => {
    // Word’s set, at 96/72 px/pt: Narrow 0.5" = 48px all · Normal
    // 1" = 96px all · Moderate 1"/0.75" = 96/72px · Wide 1"/2" =
    // 96/192px. The store holds POINTS (36/72/54/144).
    const px = (m: Margins) => toLayoutOptions({ ...PAGE_SETUP_BASE, margins: m }).margins;
    expect(px(MARGIN_PRESETS.Narrow.margins)).toEqual({ top: 48, right: 48, bottom: 48, left: 48 });
    expect(px(MARGIN_PRESETS.Normal.margins)).toEqual({ top: 96, right: 96, bottom: 96, left: 96 });
    expect(px(MARGIN_PRESETS.Moderate.margins)).toEqual({ top: 96, right: 72, bottom: 96, left: 72 });
    expect(px(MARGIN_PRESETS.Wide.margins)).toEqual({ top: 96, right: 192, bottom: 96, left: 192 });

    // UNIT INVARIANT: the Normal preset is DEFAULT_MARGINS itself
    // (reference-identical by construction) — applying it to a fresh
    // doc reproduces the store default exactly.
    expect(MARGIN_PRESETS.Normal.margins).toBe(DEFAULT_MARGINS);
  });

  it('l. margins Apply reflows without remount; pageCount follows the content box', async () => {
    const utils = renderTensor(threePageDoc);
    // The dialog rides alongside the editor exactly as App mounts it.
    render(<MarginsDialog />);
    await settle();

    const stackBefore = document.querySelector('[data-testid="paginated-stack"]');
    const sheetBefore = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(pageSheets()).toHaveLength(3); // 864px content → 54 lines/page

    act(() => {
      useDocumentPropertiesStore.getState().openMargins();
    });
    const presetBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent!.startsWith('Narrow')
    )!;
    act(() => {
      fireEvent.click(presetBtn);
    });
    // DRAFT-ONLY divergence: picking a preset changes nothing until
    // Apply — the document and the store are untouched.
    expect(useDocumentStore.getState().pageSetup.margins).toEqual(DEFAULT_MARGINS);
    expect(pageSheets()).toHaveLength(3);

    act(() => {
      fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!);
    });
    await settle();

    // Narrow: content height 1056 − 48 − 48 = 960px → 60 lines/page
    // → the same 120 lines fit in 2 pages. Same DOM nodes, no remount.
    expect(useDocumentStore.getState().pageSetup.margins).toEqual(MARGIN_PRESETS.Narrow.margins);
    expect(pageSheets()).toHaveLength(2);
    expect(document.querySelector('[data-testid="paginated-stack"]')).toBe(stackBefore);
    expect(document.querySelector('[data-page-index="0"]')).toBe(sheetBefore);

    act(() => {
      useDocumentPropertiesStore.getState().closeMargins();
    });
    utils.unmount();
  });

  it('m. A4 (paper size) + Narrow (dialog Apply) — one reflow each, no remount; schema round-trip carries both', async () => {
    const utils = renderTensor(threePageDoc);
    render(<MarginsDialog />);
    await settle();

    const sheetBefore = document.querySelector('[data-page-index="0"]') as HTMLElement;

    // Paper size stays the live Layout-tab control path.
    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, pageSize: 'A4' });
    });
    await settle();

    // Margins go through the commit-gated dialog.
    act(() => {
      useDocumentPropertiesStore.getState().openMargins();
    });
    const presetBtn = [...document.querySelectorAll('button')].find((b) =>
      b.textContent!.startsWith('Narrow')
    )!;
    act(() => {
      fireEvent.click(presetBtn);
    });
    act(() => {
      fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!);
    });
    await settle();

    // A4 width 595pt → 793px; content 697px → 69 chars/line → 36
    // lines/paragraph, 108 lines; content height 1123 − 48 = 1075px
    // → 67 lines/page → 2 pages.
    const sheetAfter = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheetAfter.style.width).toBe('793px');
    expect(pageSheets()).toHaveLength(2);
    expect(sheetAfter).toBe(sheetBefore); // reflowed, never remounted

    // Round-trip: the persisted metadata carries BOTH facts.
    const { pageSetup } = useDocumentStore.getState();
    const roundTripped = DocumentFileSchema.parse({
      version: 1,
      docJSON: {},
      metadata: { pageSetup },
    });
    const rtSetup = roundTripped.metadata.pageSetup!;
    expect(rtSetup).toEqual(pageSetup);
    expect(rtSetup.pageSize).toBe('A4');
    expect(rtSetup.margins).toEqual(MARGIN_PRESETS.Narrow.margins);

    act(() => {
      useDocumentPropertiesStore.getState().closeMargins();
    });
    utils.unmount();
  });
});