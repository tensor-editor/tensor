import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent, render } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';
import { pasteFromSystemClipboard } from '@/lib/editor/clipboard';
import { GeneralPanel } from '@/components/settings/panels/GeneralPanel';
import {
  renderTensorInScrollContainer,
  GEOMETRY,
  mockRects,
  captureScroll,
  dataEvent,
  settleLayout,
} from './harness';

// Menu paste reads the system clipboard through the Tauri plugin — mock
// it (jsdom has no Tauri).
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: async () => ' menu-pasted',
}));

/**
 * M5 interactions, all through the REAL production Editor: the selection
 * overlay, mouse selection, the legacy dead-zone fixtures (ported from
 * docs/legacy/pagination-v1.md, preserved in git history), toolbar,
 * search paint, clipboard, and IME preview. jsdom geometry:
 * getBoundingClientRect is zero by default (stack-local == client
 * coords); tests needing real numbers pin it via mockRects.
 */

const CB = GEOMETRY.contentX; // 96
const CY = GEOMETRY.contentY; // 96
const CHARS = GEOMETRY.charsPerLine; // 62
const LINES = GEOMETRY.linesPerPage; // 54
const STRIDE = GEOMETRY.pageHeight + 32; // 1088

// Two exactly-page-filling paragraphs: A fills page 1, B starts page 2.
// A nodeSize = 3348+2 -> B's first text char sits at PM pos 3351.
const A_TEXT_END = CHARS * LINES; // 3348
const B_TEXT_START = A_TEXT_END + 3; // 3351
const twoPageDoc = `<p>${'a'.repeat(A_TEXT_END)}</p><p>${'b'.repeat(A_TEXT_END)}</p>`;

const wrapper = () => document.querySelector('[data-testid="paginated-zoom-wrapper"]') as HTMLElement;
const selRects = () => [...document.querySelectorAll('[data-testid="selection-rect"]')] as HTMLElement[];

function mouseDown(x: number, y: number, opts: { shiftKey?: boolean; button?: number } = {}) {
  fireEvent.mouseDown(wrapper(), { clientX: x, clientY: y, ...opts });
}

/** jsdom/testing-library has no auxClick sugar — dispatch it raw. */
function auxClick(x: number, y: number) {
  fireEvent(
    wrapper(),
    new MouseEvent('auxclick', { bubbles: true, cancelable: true, button: 1, clientX: x, clientY: y }),
  );
}

async function settle() {
  await settleLayout();
}

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
  });
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      editor: { ...state.config.editor, zoomLevel: 100, pasteOnMiddleClick: false },
    },
  }));
});

describe('M5 STEP 1: selection overlay (projection of PM selection)', () => {
  it('non-empty selection paints partial-line x exactly', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    const dom = editor.view.dom as HTMLElement;
    // jsdom has no native caret motion, so the selection a real browser's
    // Shift+Arrow produces is issued through PM directly; what this
    // asserts is that the OVERLAY projects it (the real gesture is
    // verified in the live app).
    dom.focus();
    act(() => {
      dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true, cancelable: true })
      );
      editor.commands.setTextSelection({ from: 1, to: 4 }); // 'Hel'
    });
    await settle();
    expect(selRects()).toHaveLength(1);
    const r = selRects()[0]!;
    expect(r.style.left).toBe(`${CB}px`);
    expect(r.style.top).toBe(`${CY}px`);
    expect(r.style.width).toBe('30px');
    expect(r.style.height).toBe('16px');
  });

  it('multi-line: partial first/last, full-width middles', async () => {
    const { editor } = renderTensorInScrollContainer(`<p>${'a'.repeat(CHARS * 2 + 10)}</p>`);
    await settle();
    act(() => {
      editor.commands.setTextSelection({ from: 1 + 5, to: 1 + CHARS * 2 + 10 });
    });
    await settle();
    expect(selRects()).toHaveLength(3);
    const [r0, r1, r2] = selRects();
    expect(r0.style.left).toBe(`${CB + 50}px`);
    expect(r0.style.width).toBe(`${620 - 50}px`);
    expect(r1.style.left).toBe(`${CB}px`);
    expect(r1.style.width).toBe(`${GEOMETRY.contentWidth}px`);
    expect(r1.style.top).toBe(`${CY + 16}px`);
    expect(r2.style.left).toBe(`${CB}px`);
    expect(r2.style.width).toBe('100px');
  });

  it('across the page boundary', async () => {
    const { editor } = renderTensorInScrollContainer(twoPageDoc);
    await settle();
    act(() => {
      // A's last line (line 53), 10 chars in -> B's line 0, 10 chars in.
      editor.commands.setTextSelection({ from: 1 + CHARS * 53 + 10, to: B_TEXT_START + 10 });
    });
    await settle();
    expect(selRects()).toHaveLength(2);
    const [r0, r1] = selRects();
    expect(r0.style.top).toBe(`${CY + 53 * 16}px`);
    expect(r0.style.left).toBe(`${CB + 100}px`);
    expect(r0.style.width).toBe('520px');
    expect(r1.style.top).toBe(`${STRIDE + CY}px`);
    expect(r1.style.left).toBe(`${CB}px`);
    expect(r1.style.width).toBe('100px');
  });
});

describe('M5 STEP 2: mouse selection', () => {
  it('mousedown resolves via hitTest and collapses the selection', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    mouseDown(CB + 12, CY + 8);
    await settle();
    expect(editor.state.selection.head).toBe(2); // offset 1
    expect(editor.state.selection.empty).toBe(true);
  });

  it('drag extends the selection; mouseup surfaces the toolbar', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    mouseDown(CB + 12, CY + 8); // offset 1
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: CB + 42, clientY: CY + 8 }));
    });
    await settle();
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(5);
    expect(document.querySelector('[data-floating-toolbar]')).toBeNull(); // suppressed mid-drag
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
    await settle();
    expect(editor.state.selection.from).toBe(2);
    expect(editor.state.selection.to).toBe(5);
    expect(document.querySelector('[data-floating-toolbar]')).not.toBeNull();
  });

  it('shift+click extends from PM\u2019s own anchor', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection({ from: 2, to: 4 });
    });
    mouseDown(CB + 52, CY + 8, { shiftKey: true }); // offset 5
    await settle();
    expect(editor.state.selection.anchor).toBe(2);
    expect(editor.state.selection.head).toBe(6);
  });

  it('double-click selects the word; triple-click the block', async () => {
    const { editor } = renderTensorInScrollContainer('<p>one two three</p>');
    await settle();
    mouseDown(CB + 3, CY + 8);
    mouseDown(CB + 3, CY + 8);
    await settle();
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(4); // 'one'
    mouseDown(CB + 3, CY + 8);
    await settle();
    expect(editor.state.selection.from).toBe(1);
    expect(editor.state.selection.to).toBe(14); // whole paragraph
  });
});

describe('M5 STEP 2b: legacy dead-zone fixtures (nearest-line rule)', () => {
  // 'Hi' (1 line), forced break, 'Next' on page 2.
  // PM layout: Hi [0,4), pageBreak [4,5), Next [5,10) text at 6.
  const breakDoc = '<p>Hi</p><div data-page-break="true"></div><p>Next</p>';

  it('trailing space after a short last line resolves to the line end', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hi</p>');
    await settle();
    mouseDown(CB + 400, CY + 8); // far right of "Hi"
    await settle();
    expect(editor.state.selection.head).toBe(3);
  });

  it('bottom-margin click clamps to the sheet\u2019s last line', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hi</p>');
    await settle();
    mouseDown(CB + 100, 1000); // page 0, y=904 > content bottom 864
    await settle();
    expect(editor.state.selection.head).toBe(3);
  });

  it('inter-sheet gap: upper half -> page 1 last line, lower half -> page 2 first line', async () => {
    const { editor } = renderTensorInScrollContainer(breakDoc);
    await settle();
    mouseDown(CB + 100, GEOMETRY.pageHeight + 8); // 8px into the gap
    await settle();
    expect(editor.state.selection.head).toBe(3); // 'Hi' end
    mouseDown(CB + 100, GEOMETRY.pageHeight + 24); // 8px before page 2
    await settle();
    expect(editor.state.selection.head).toBe(6); // 'Next' text start
  });

  it('page bottom vs page top boundary clicks resolve to their own sheets', async () => {
    const { editor } = renderTensorInScrollContainer(breakDoc);
    await settle();
    mouseDown(CB + 100, GEOMETRY.pageHeight - 8); // page 1's bottom margin
    await settle();
    expect(editor.state.selection.head).toBe(3);
    mouseDown(CB + 3, STRIDE + CY + 4); // page 2, first char of 'Next'
    await settle();
    expect(editor.state.selection.head).toBe(6);
  });

  it('short line followed by a page break: far-right click never lands on page 2', async () => {
    const { editor } = renderTensorInScrollContainer(breakDoc);
    await settle();
    mouseDown(CB + 500, CY + 8);
    await settle();
    expect(editor.state.selection.head).toBe(3);
    expect(editor.state.selection.$head.parent.textContent).toBe('Hi');
  });
});

describe('M5 STEP 5: floating toolbar at engine coords', () => {
  it('positions from the selection bounding box, not hidden-DOM coords', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    mockRects(100, { top: 0, bottom: 800 }); // stack top 100; viewport 0..800
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 }); // 'Hello'
    });
    await settle();
    const bar = document.querySelector('[data-floating-toolbar]') as HTMLElement;
    expect(bar).not.toBeNull();
    // bounds left 96, top 96, right 146, bottom 112; z=1, stack top 100
    // (the shared mock pins the stack's LEFT at 0).
    expect(bar.style.left).toBe('96px'); // 0 + 96
    expect(bar.style.top).toBe('188px'); // 100 + 96 - 8 (above)
  });
});

describe('M5 STEP 4: search paint + minimal-edge current-match scroll', () => {
  it('paints matches and scrolls the current match by the exact delta', async () => {
    // 'Tensor' opens page 1 and page 3.
    const a = `Tensor${'a'.repeat(CHARS * LINES - 6)}`;
    const b = 'b'.repeat(CHARS * LINES);
    const c = `Tensor${'c'.repeat(CHARS * LINES - 6)}`;
    const { editor } = renderTensorInScrollContainer(`<p>${a}</p><p>${b}</p><p>${c}</p>`);
    await settle();
    expect(document.querySelectorAll('[data-page-index]')).toHaveLength(3);

    const { desk } = mockRects(0, { top: 0, bottom: 400 });
    const scroll = captureScroll(desk);

    act(() => {
      editor.commands.setSearchQuery('Tensor', { caseSensitive: false, useRegex: false });
    });
    await settle();
    expect(document.querySelectorAll('[data-testid="search-rect"]')).toHaveLength(2);
    const first = document.querySelector('[data-testid="search-rect"]') as HTMLElement;
    expect(first.style.left).toBe(`${CB}px`);
    expect(first.style.width).toBe('60px');

    act(() => {
      editor.commands.searchNext();
    });
    await settle();
    // Match 2 on page 3: top 2*1088+96 = 2272, bottom 2288 -> delta 2288+16-400.
    expect(scroll.read()).toBe(1904);
    const current = document.querySelector('[data-testid="search-current-rect"]') as HTMLElement;
    expect(current.style.top).toBe(`${2 * STRIDE + CY}px`);
  });
});

describe('M5 STEP 3: clipboard (PM\u2019s own handlers)', () => {
  it('copy captures the selection; paste inserts plain text', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    const dom = editor.view.dom as HTMLElement;

    act(() => {
      editor.commands.setTextSelection({ from: 2, to: 8 }); // 'ello w'
    });
    const dt = new DataTransfer();
    act(() => {
      dom.dispatchEvent(dataEvent('copy', { clipboardData: dt }));
    });
    expect(dt.getData('text/plain')).toBe('ello w');

    const dt2 = new DataTransfer();
    dt2.setData('text/plain', ' pasted');
    act(() => {
      dom.dispatchEvent(dataEvent('paste', { clipboardData: dt2 }));
    });
    await settle();
    expect(editor.state.doc.textContent).toContain('pasted');
  });

  it('pasting paragraphs mints fresh unique block ids (no duplicates)', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Base</p><p></p>');
    await settle();
    const dom = editor.view.dom as HTMLElement;
    act(() => {
      // Target the EMPTY paragraph: pasting into a non-empty one merges
      // the pasted slice into it (PM's standard open-slice behavior).
      editor.commands.setTextSelection(7);
    });
    const dt = new DataTransfer();
    dt.setData('text/html', '<p>First</p><p>Second</p>');
    act(() => {
      dom.dispatchEvent(dataEvent('paste', { clipboardData: dt }));
    });
    await settle();
    const ids: string[] = [];
    editor.state.doc.forEach((node) => {
      if (node.attrs.blockId) ids.push(node.attrs.blockId as string);
    });
    expect(ids).toHaveLength(3); // Base, First, Second — all minted fresh
    expect(new Set(ids).size).toBe(ids.length);
    expect(editor.state.doc.textContent).toContain('Second');
  });

  it('menu paste routes through PM\u2019s paste handler', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    await act(async () => {
      await pasteFromSystemClipboard(editor);
    });
    expect(editor.state.doc.textContent).toContain('menu-pasted');
  });

  it('middle-click pastes at the click point when enabled, is a no-op when disabled', async () => {
    // Disabled (default): the caret/selection and the document are untouched.
    // The press AND release defaults must die — Linux webviews paste the
    // X11 primary selection into the focused editable natively (press),
    // and Firefox pastes on release/auxclick.
    const disabled = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    act(() => {
      disabled.editor.commands.setTextSelection(2);
    });
    mouseDown(CB + 12, CY + 8, { button: 1 });
    fireEvent.mouseUp(wrapper(), { clientX: CB + 12, clientY: CY + 8, button: 1 });
    auxClick(CB + 12, CY + 8);
    await settle();
    expect(disabled.editor.state.selection.from).toBe(2);
    expect(disabled.editor.state.doc.textContent).toBe('Hello world');
    disabled.unmount();

    // Enabled: caret moves to the hit-test position, then the mocked
    // system clipboard (' menu-pasted') replays through PM's handler.
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, pasteOnMiddleClick: true } },
      }));
    });
    const enabled = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    mouseDown(CB + 12, CY + 8, { button: 1 }); // 'H|ello world' — offset 1
    await settle();
    expect(enabled.editor.state.doc.textContent).toBe('H menu-pastedello world');
    // The release-side swallow must not double-paste.
    auxClick(CB + 12, CY + 8);
    await settle();
    expect(enabled.editor.state.doc.textContent).toBe('H menu-pastedello world');
  });
});

describe('M5.5: alignment symmetry + selection color + cursor', () => {
  const paintOps = () => (globalThis as { __paintOps?: Array<{ op: string; args: unknown[] }> }).__paintOps ?? [];

  it('centered line: painted x, caret x, and margin-click all use the one offset', async () => {
    // 'Hi there' = 8 chars = 80px; center offset = (624-80)/2 = 272.
    const { editor } = renderTensorInScrollContainer(
      '<p style="text-align: center">Hi there</p>'
    );
    await settle();
    expect(document.querySelectorAll('[data-page-index]')).toHaveLength(1);

    // 1. Painted x (canvas-local, from the recording stub).
    const ops = paintOps();
    const ft = [...ops].reverse().find((o) => o.op === 'fillText' && o.args[0] === 'Hi there');
    expect(ft).toBeDefined();
    expect(ft!.args[1]).toBe(272);

    // 2. Caret at line end: left = contentX + offset + 80 = 448.
    act(() => {
      editor.commands.setTextSelection(9); // end of 'Hi there'
    });
    await settle();
    const caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret.style.left).toBe('448px');

    // 3. Click in the right margin -> the line's END position (nearest-line).
    mouseDown(CB + 272 + 600, CY + 8);
    await settle();
    expect(editor.state.selection.head).toBe(9);
    // And the left margin clamps to the line's START.
    mouseDown(CB + 50, CY + 8);
    await settle();
    expect(editor.state.selection.head).toBe(1);
  });

  it('painted desk surface carries the text cursor', async () => {
    renderTensorInScrollContainer('<p>Hello</p>');
    await settle();
    expect(wrapper().className).toContain('cursor-text');
  });

  it('selection background follows the configured color at SELECTION alpha; empty = theme default', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello world</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
    });
    await settle();
    let r = selRects()[0]!;
    expect(r.className).toContain('bg-primary/25');
    expect(r.style.backgroundColor).toBe('');

    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, selectionColor: '#3b82f6' } },
      }));
    });
    await settle();
    r = selRects()[0]!;
    // The picked color paints with the automatic alpha so the text under
    // the selection stays readable (STEP 7).
    expect(r.style.backgroundColor).toBe('rgba(59, 130, 246, 0.35)');
    expect(r.className).not.toContain('bg-primary/25');

    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, selectionColor: '' } },
      }));
    });
    await settle();
    expect(selRects()[0]!.className).toContain('bg-primary/25');
  });

  it('GeneralPanel exposes the selection color via a solid swatch + palette (no reset)', () => {
    const { getByText, getByRole } = render(<GeneralPanel />);
    expect(getByText('Selection Color')).toBeTruthy();
    // Split: solid-swatch main button + options popover trigger.
    expect(getByRole('button', { name: 'Selection Color' })).toBeTruthy();
    expect(getByRole('button', { name: 'Selection Color options' })).toBeTruthy();

    // Open the options popover — no reset button (hideReset).
    act(() => {
      getByRole('button', { name: 'Selection Color options' }).click();
    });
    const reset = document.querySelector('[data-slot="popover-content"] button');
    // The only button in the popover content should be palette swatches,
    // not a reset/none — the first popover child buttons are swatches with
    // aria-labels like "#ffffff".
    const firstBtn = reset as HTMLElement;
    expect(firstBtn.getAttribute('aria-label')).not.toBe('Theme');
    expect(firstBtn.getAttribute('aria-label')).not.toBe('None');

    // Click a preset swatch — the store must follow.
    act(() => {
      const preset = document.querySelector('[aria-label="#3b82f6"]');
      (preset as HTMLElement).click();
    });
    expect(useConfigStore.getState().config.editor.selectionColor).toBe('#3b82f6');
  });

  it('GeneralPanel > Behavior: paste-on-middle-click toggle flips the config', () => {
    const { getByText } = render(<GeneralPanel />);
    expect(getByText('Paste on Middle Click')).toBeTruthy();

    // Three switches live in this panel (Dark Mode, Floating Toolbar,
    // this one) — scope to the Behavior row before querying.
    const row = getByText('Paste on Middle Click').closest('.py-3') as HTMLElement;
    const toggle = row.querySelector('[role="switch"]') as HTMLElement;
    expect(useConfigStore.getState().config.editor.pasteOnMiddleClick).toBe(false);
    act(() => {
      toggle.click();
    });
    expect(useConfigStore.getState().config.editor.pasteOnMiddleClick).toBe(true);
    act(() => {
      toggle.click();
    });
    expect(useConfigStore.getState().config.editor.pasteOnMiddleClick).toBe(false);
  });
});

describe('M5 STEP 6/7: a11y attrs + IME composition preview', () => {
  it('hidden view is NOT aria-hidden; canvases are presentation', async () => {
    renderTensorInScrollContainer('<p>Hello</p>');
    await settle();
    expect(document.querySelector('.pm-input-only')?.getAttribute('aria-hidden')).toBeNull();
    expect(document.querySelector('canvas')?.getAttribute('role')).toBe('presentation');
  });

  it('composition preview paints at the caret and clears on end', async () => {
    const { editor } = renderTensorInScrollContainer('<p>Hello</p>');
    await settle();
    const dom = editor.view.dom as HTMLElement;
    act(() => {
      // Pin the caret at the block start so the preview position is
      // deterministic (setContent leaves it at the text end).
      editor.commands.setTextSelection(1);
    });
    await settle();
    act(() => {
      dom.dispatchEvent(dataEvent('compositionstart', {}));
      dom.dispatchEvent(dataEvent('compositionupdate', { data: 'てんそ' }));
    });
    await settle();
    const preview = document.querySelector('[data-testid="composing-preview"]') as HTMLElement;
    expect(preview?.textContent).toBe('てんそ');
    expect(preview.style.left).toBe(`${CB}px`); // caret x at doc start
    expect(preview.style.top).toBe(`${CY}px`);
    act(() => {
      dom.dispatchEvent(dataEvent('compositionend', {}));
    });
    await settle();
    expect(document.querySelector('[data-testid="composing-preview"]')).toBeNull();
  });
});
