import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensor, renderTensorInScrollContainer, GEOMETRY } from './harness';
import { settleLayout } from './harness';

// A 40-line paragraph (62 chars/line under FakeMetrics): three of these
// tile into 54 + 54 + 12 lines -> exactly 3 pages.
const longParagraph = `<p>${'a'.repeat(GEOMETRY.charsPerLine * 40)}</p>`;
const threePageDoc = longParagraph.repeat(3);

const pageSheets = () => Array.from(document.querySelectorAll('[data-page-index]'));

beforeEach(() => {
  // The document store persists between tests (module singleton) — reset
  // the parts the PaginatedView publishes.
  useDocumentStore.getState().setPageInfo(1, 1);
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle() {
  // The view's initial layout is gated on document.fonts.ready (metrics
  // stability, see PaginatedView); jsdom resolves it on a microtask.
  await settleLayout();
}

describe('M4 PaginatedView integration', () => {
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
    // The synthetic caret followed the selection into page 2. M4.2: the
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

    // Reflowed geometry: A4 width 794.
    const sheetAfter = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheetAfter.style.width).toBe('794px');
    // No remount: same DOM nodes.
    expect(document.querySelector('[data-testid="paginated-stack"]')).toBe(stackBefore);
    expect(document.querySelector('[data-page-index="0"]')).toBe(sheetBefore);
  });
});