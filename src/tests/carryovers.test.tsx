import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { useConfigStore } from '@/lib/config/store';
import { MarginsDialog } from '@/components/dialogs/MarginsDialog';
import { DocumentFileSchema } from '@/lib/document/schema';
import { parseUnitToPt } from '@/lib/document/pageSetup';import { DEFAULT_MARGINS, MARGIN_PRESETS, PAGE_GAP } from '@/lib/document/pageSetup';
import { renderTensor } from './harness';
import { settleLayout } from './harness';

// jsdom lacks document.elementFromPoint — PM's own mousedown handler
// (which also hears these events) calls it via posAtCoords.
beforeAll(() => {
  document.elementFromPoint = () =>
    document.querySelector('.ProseMirror') ?? document.body;
});

vi.mock('@/lib/editor/clipboard', () => ({
  pasteFromSystemClipboard: vi.fn(async () => {}),
}));

import { pasteFromSystemClipboard } from '@/lib/editor/clipboard';

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
  });
  useDocumentPropertiesStore.setState({ marginsIsOpen: false });
  // The config store persists across tests — restore the layout mode
  // and the paste toggle each time (the page-background test flips to
  // Pageless; the paste tests set both polarities).
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      editor: { ...state.config.editor, defaultPageLayout: 'Pages', pasteOnMiddleClick: false },
    },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function settle() {
  await settleLayout();
}

// ─── Margins-0 (carryover): the parser clamped zero away ──────────────────

describe('margins-0', () => {
  it('RECEIPT: the old parser rejected v <= 0 — zero was unwritable', () => {
    // parseUnitToPt now takes allowZero; dimensions keep the old rule.
    expect(parseUnitToPt('0', 'inches')).toBeNull(); // the old blanket rule
    expect(parseUnitToPt('0', 'inches', { allowZero: true })).toBe(0);
    expect(parseUnitToPt('-1', 'inches', { allowZero: true })).toBeNull();
  });

  it('entering 0 through the margins dialog applies 0 (no CSS/paint clamp)', async () => {
    const utils = renderTensor('<p>hello world</p>');
    render(<MarginsDialog />);
    await settle();
    act(() => {
      useDocumentPropertiesStore.getState().openMargins();
    });
    for (const label of ['Top', 'Bottom', 'Left', 'Right']) {
      const input = document.querySelector(`input[aria-label="${label} margin"]`)!;
      act(() => {
        fireEvent.change(input, { target: { value: '0' } });
      });
    }
    act(() => {
      fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Apply')!);
    });
    await settle();
    expect(useDocumentStore.getState().pageSetup.margins).toEqual({
      top: 0, bottom: 0, left: 0, right: 0,
    });
    act(() => {
      useDocumentPropertiesStore.getState().closeMargins();
    });
    utils.unmount();
  });

  it('margins-0: the first LineBox sits at the sheet origin exactly', async () => {
    renderTensor('<p>hello world</p>');
    await settle();

    const { pageSetup, setPageSetup } = useDocumentStore.getState();
    act(() => {
      setPageSetup({ ...pageSetup, margins: MARGIN_PRESETS.Narrow.margins });
    });
    await settle();
    let caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret.style.top).toBe('48px'); // Narrow: 36pt → 48px content top

    act(() => {
      const { pageSetup: ps, setPageSetup: set } = useDocumentStore.getState();
      set({ ...ps, margins: { top: 0, bottom: 0, left: 0, right: 0 } });
    });
    await settle();

    // Content box meets the sheet edge: NO CSS/paint gap (PageSheet has
    // no padding — receipt), the caret (line top, box left) sits at
    // the origin exactly, and 0 round-trips through the schema.
    act(() => {
      useDocumentStore.getState().editor!.commands.setTextSelection(1);
    });
    await settle();
    caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret.style.top).toBe('0px');
    expect(caret.style.left).toBe('0px');

    const { pageSetup: zero } = useDocumentStore.getState();
    const rt = DocumentFileSchema.parse({ version: 1, docJSON: {}, metadata: { pageSetup: zero } });
    expect(rt.metadata.pageSetup!.margins).toEqual({ top: 0, bottom: 0, left: 0, right: 0 });
  });
});

// ─── Page background: one setting, two surfaces (carryover) ──────────────

describe('page background — two surfaces', () => {
  it('paginated sheets AND the pageless editing surface paint pageColor', async () => {
    // Paginated (sheets) — the M5.13 behavior, pinned again here.
    const utils = renderTensor('<p>hello world</p>');
    await settle();
    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, pageColor: '#fef3c7' });
    });
    await settle();
    const sheet = document.querySelector('[data-page-index="0"]') as HTMLElement;
    expect(sheet.style.backgroundColor).toBe('rgb(254, 243, 199)');

    // Pageless (surface): same document setting, same color.
    act(() => {
      useConfigStore.setState((state) => ({
        config: {
          ...state.config,
          editor: { ...state.config.editor, defaultPageLayout: 'Pageless' },
        },
      }));
    });
    await settle();
    const surface = document.querySelector('[data-testid="pageless-surface"]') as HTMLElement;
    expect(surface).not.toBeNull();
    expect(surface.style.background).toBe('rgb(254, 243, 199)');
    utils.unmount();
  });
});

// ─── Middle-click paste: both polarities, both surfaces (carryover) ───────

describe('middle-click paste (§7.2 polarity receipt: write path == read path)', () => {
  it('RECEIPT: one config key, one polarity — write config.editor.pasteOnMiddleClick; both gates read the same key and gate on !value (off = preventDefault/return, on = paste at caret). No disease found — pinned by the tests below.', () => {
    expect(useConfigStore.getState().setPasteOnMiddleClick).toBeTypeOf('function');
  });

  it('paginated, OFF: middle-click does nothing — no selection move, no paste', async () => {
    const utils = renderTensor('<p>hello world</p>');
    await settle();
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, pasteOnMiddleClick: false } },
      }));
    });
    const stack = document.querySelector('[data-testid="paginated-stack"]')!;
    const before = useDocumentStore.getState().editor!.state.selection.head;
    act(() => {
      fireEvent.mouseDown(stack, { button: 1, clientX: 100, clientY: 100 });
    });
    expect(useDocumentStore.getState().editor!.state.selection.head).toBe(before);
    expect(pasteFromSystemClipboard).not.toHaveBeenCalled();
    utils.unmount();
  });

  it('paginated, ON: middle-click moves the caret to the click and pastes', async () => {
    const utils = renderTensor('<p>hello world</p>');
    await settle();
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, pasteOnMiddleClick: true } },
      }));
    });
    const stack = document.querySelector('[data-testid="paginated-stack"]')!;
    const before = useDocumentStore.getState().editor!.state.selection.head;
    act(() => {
      fireEvent.mouseDown(stack, { button: 1, clientX: 100, clientY: 100 });
    });
    const after = useDocumentStore.getState().editor!.state.selection.head;
    expect(after).not.toBe(before);
    expect(pasteFromSystemClipboard).toHaveBeenCalledTimes(1);
    utils.unmount();
  });

  it('fallback surface, OFF: the native X11 paste is prevented (Editor.tsx gate)', async () => {
    const utils = renderTensor('<p>hello world</p>');
    await settle();
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, pasteOnMiddleClick: false } },
      }));
    });
    const editor = useDocumentStore.getState().editor!;
    // cancelable — preventDefault on a non-cancelable event is a jsdom
    // no-op (the test-harness lesson this carryover surfaced).
    const event = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    utils.unmount();
  });

  it('fallback surface, ON: the native paste path stays open (not prevented)', async () => {
    const utils = renderTensor('<p>hello world</p>');
    await settle();
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, pasteOnMiddleClick: true } },
      }));
    });
    const editor = useDocumentStore.getState().editor!;
    const event = new MouseEvent('mousedown', { button: 1, bubbles: true, cancelable: true });
    editor.view.dom.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    utils.unmount();
  });
});
