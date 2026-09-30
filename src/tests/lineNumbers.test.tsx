import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import type { LineBox } from '@tensor-editor/engine';
import { countLineNumbers } from '@/lib/paginated/lineNumbers';
import { DocumentFileSchema, CURRENT_DOCUMENT_VERSION } from '@/lib/document/schema';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';
import { ShowGroup } from '@/components/layout/ribbon/view/groups/ShowGroup';
import { ArrangeGroup } from '@/components/layout/ribbon/layout/groups/ArrangeGroup';
import { getCommand } from '@/lib/commands/registry';
import { renderTensor, renderTensorInScrollContainer, GEOMETRY, settleLayout } from './harness';

// ─── Tauri surface mocks (file operations round-trip) ─────────────────────

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
  readTextFile: vi.fn(async () => '{}'),
  rename: vi.fn(async () => {}),
}));

const dialogMocks = vi.hoisted(() => ({ openPath: null as string | null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => dialogMocks.openPath),
  save: vi.fn(async () => null),
}));

import { writeTextFile, readTextFile } from '@tauri-apps/plugin-fs';
import { saveDocument, openDocument } from '@/lib/document/fileOperations';

const CB = GEOMETRY.contentX; // 96 — the left margin, where the gutter lives
const CY = GEOMETRY.contentY;
const CHARS = GEOMETRY.charsPerLine; // 62

beforeEach(() => {
  useDocumentStore.setState({
    lineNumbers: null,
    isDirty: false,
    filePath: null,
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
  });
  useConfigStore.setState((state) => ({
    config: { ...state.config, editor: { ...state.config.editor, zoomLevel: 100 } },
  }));
  vi.clearAllMocks();
});

// ─── 1. Pure counting: the full matrix ───────────────────────────────────

/** Minimal LineBox stand-in — the counter reads only the identity
 *  fields (blockId/pageIndex/lineIndex); rect/segments are inert. */
function box(n: number, blockId: string, pageIndex: number, lineIndex: number): LineBox {
  return {
    blockId,
    lineIndex,
    pageIndex,
    rect: { x: 0, y: n * 16, width: 624, height: 16 },
    baseline: n * 16 + 12,
    rangeStart: 0,
    rangeEnd: 1,
    segments: [],
  } as unknown as LineBox;
}

describe('countLineNumbers (pure)', () => {
  // Doc shape: A(page 0, 2 lines) + B fragments page 0 (2 lines) →
  // page 1 (2 lines, CONTINUATION) + empty line (no segments).
  const lines: LineBox[] = [
    box(0, 'A', 0, 0),
    box(1, 'A', 0, 1),
    box(2, 'B', 0, 0),
    box(3, 'B', 0, 1),
    box(4, 'B', 1, 2), // fragment continuation of B on page 1
    box(5, 'B', 1, 3),
    box(6, 'EMPTY', 1, 0), // empty line (no runs) — still counts
  ];

  it('continuous: one counter over all lines, no resets', () => {
    expect(countLineNumbers(lines, 'continuous')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('per-page: resets when pageIndex changes', () => {
    expect(countLineNumbers(lines, 'per-page')).toEqual([1, 2, 3, 4, 1, 2, 3]);
  });

  it('per-paragraph: resets on blockId change; fragments across pages CONTINUE', () => {
    // A: 1,2 — B starts at 1, and its page-1 fragment lines 3,4 (NOT
    // 1,2) — the block didn't change across the break, only the page.
    expect(countLineNumbers(lines, 'per-paragraph')).toEqual([1, 2, 1, 2, 3, 4, 1]);
  });

  it('per-paragraph fragment continuation equals the engine lineIndex contract', () => {
    // B's page-1 lines carry lineIndex 2,3 — numbering 3,4 matches.
    expect(countLineNumbers(lines, 'per-paragraph').slice(4, 6)).toEqual([3, 4]);
  });

  it('empty lines consume a counter tick in every mode', () => {
    for (const mode of ['continuous', 'per-page', 'per-paragraph'] as const) {
      const nums = countLineNumbers(lines, mode);
      expect(nums[nums.length - 1]).not.toBeNull(); // the EMPTY line got a number
    }
  });

  it('countBy N (the ruling): (n−1) % N === 0 shows, others are null — counting unchanged', () => {
    expect(countLineNumbers(lines, 'continuous', 3)).toEqual([
      1, null, null, 4, null, null, 7,
    ]);
  });

  it('countBy 1 (default, omitted): every line numbered', () => {
    expect(countLineNumbers(lines, 'continuous', 1)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(countLineNumbers(lines, 'continuous')).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

// ─── 2. Gutter render + positioning ──────────────────────────────────────

const gutter = () => document.querySelector('[data-testid="line-number-gutter"]') as HTMLElement | null;
const num = (n: number) => document.querySelector(`[data-testid="line-number-${n}"]`) as HTMLElement | null;

describe('gutter render (projection of LayoutResult + setting)', () => {
  it('renders nothing when the setting is absent (old docs / never enabled)', async () => {
    renderTensor('<p>hello</p>');
    await settleLayout();
    expect(gutter()).toBeNull();
  });

  it('continuous mode: numbers at their LineBox rect y, x inside the left margin', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    renderTensor(`<p>${'a'.repeat(CHARS * 3)}</p>`); // 3 lines
    await settleLayout();
    expect(gutter()).not.toBeNull();
    // Number k's top = contentBox.y + (k−1)·16 (FakeMetrics line height).
    expect(num(1)!.style.top).toBe(`${CY}px`);
    expect(num(2)!.style.top).toBe(`${CY + 16}px`);
    expect(num(3)!.style.top).toBe(`${CY + 32}px`);
    // The gutter spans exactly the left margin, right-aligned to the
    // content edge, inside the zoom transform (a PageSheet child).
    expect(gutter()!.style.width).toBe(`${CB}px`);
    expect(num(1)!.style.right).toBe('8px');
    // baseStyle font at ~0.75× (16px default → 12px).
    expect(num(1)!.style.fontSize).toBe('12px');
    // pointer-events NONE — clicks must fall through to the sheet.
    expect(gutter()!.className).toContain('pointer-events-none');
  });

  it('per-page mode: the counter resets at each sheet', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'per-page' });
    // One 60-line paragraph: 54 lines on page 1, the fragment on page 2.
    renderTensor(`<p>${'a'.repeat(CHARS * 60)}</p>`);
    await settleLayout();
    expect(num(1)).not.toBeNull(); // page 1
    expect(num(55)).toBeNull(); // page 2's fragment restarts —
    // page 2's first lines are numbered 1,2,… again: the SECOND
    // "1" lives on page 2's sheet (numbers repeat per sheet).
    const ones = [...document.querySelectorAll('[data-testid="line-number-1"]')];
    expect(ones.length).toBe(2); // one per page
  });

  it('per-paragraph mode: a fragment crossing the page boundary CONTINUES', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'per-paragraph' });
    renderTensor(`<p>${'a'.repeat(CHARS * 60)}</p>`);
    await settleLayout();
    // Same blockId across the break → numbers continue: 55 exists,
    // and there is exactly ONE "1" (no per-page restart).
    expect(num(55)).not.toBeNull();
    expect(document.querySelectorAll('[data-testid="line-number-1"]')).toHaveLength(1);
  });

  it('countBy: blanks are simply absent from the DOM; shown numbers follow (n−1)%N===0', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous', countBy: 3 });
    renderTensor(`<p>${'a'.repeat(CHARS * 5)}</p>`); // 5 lines
    await settleLayout();
    expect(num(1)).not.toBeNull();
    expect(num(4)).not.toBeNull();
    expect(num(2)).toBeNull();
    expect(num(3)).toBeNull();
  });

  it('zoom 150%: numbers stay in LOGICAL px inside the transform — no compensation', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    renderTensor('<p>hello</p>');
    await settleLayout();
    const topBefore = num(1)!.style.top;
    act(() => {
      useConfigStore.getState().setZoomLevel(150);
    });
    await settleLayout();
    // The stack scales; the number's own inline geometry is UNTOUCHED
    // — that IS the no-compensation law (asserted, not assumed).
    expect(
      (document.querySelector('[data-testid="paginated-stack"]') as HTMLElement).style.transform,
    ).toBe('scale(1.5)');
    expect(num(1)!.style.top).toBe(topBefore);
    expect(num(1)!.style.top).toBe(`${CY}px`);
  });
});

// ─── 3. Margin-click regression (the M5 nearest-line fixtures) ────────────

describe('margin clicks with the gutter visible (M5 regression)', () => {
  // The legacy dead-zone fixtures, re-run with line numbers ON — the
  // gutter is pointer-events:none paint, so hitTest.ts must behave
  // exactly as it does gutter-hidden.
  const breakDoc = '<p>Hi</p><div data-page-break="true"></div><p>Next</p>';

  function mouseDown(x: number, y: number) {
    fireEvent.mouseDown(document.querySelector('[data-testid="paginated-zoom-wrapper"]')!, {
      clientX: x,
      clientY: y,
    });
  }

  it('left-margin click (inside the gutter band) clamps to the first line start', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    const { editor } = renderTensorInScrollContainer('<p>Hi</p>');
    await settleLayout();
    expect(gutter()).not.toBeNull(); // precondition: gutter is in the way visually
    mouseDown(3, CY + 8); // deep inside the left margin / gutter band
    await settleLayout();
    expect(editor.state.selection.head).toBe(1); // 'H' — the line's START
  });

  it('right-margin click resolves to the line end — identical to gutter-hidden', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    const { editor } = renderTensorInScrollContainer('<p>Hi</p>');
    await settleLayout();
    mouseDown(CB + 400, CY + 8);
    await settleLayout();
    expect(editor.state.selection.head).toBe(3); // 'Hi' end — the fixture's number
  });

  it('bottom-margin click clamps to the sheet\u2019s last line — the fixture\u2019s number', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    const { editor } = renderTensorInScrollContainer('<p>Hi</p>');
    await settleLayout();
    mouseDown(CB + 100, 1000); // y=904 > content bottom 864
    await settleLayout();
    expect(editor.state.selection.head).toBe(3);
  });

  it('inter-sheet gap ownership is unchanged (upper half → page 1, lower half → page 2)', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'per-page' });
    const { editor } = renderTensorInScrollContainer(breakDoc);
    await settleLayout();
    mouseDown(CB + 100, GEOMETRY.pageHeight + 8);
    await settleLayout();
    expect(editor.state.selection.head).toBe(3); // 'Hi' end
    mouseDown(CB + 100, GEOMETRY.pageHeight + 24);
    await settleLayout();
    expect(editor.state.selection.head).toBe(6); // 'Next' text start
  });
});

// ─── 4. Live renumber — the sync path, no debounce ────────────────────────

describe('live renumber', () => {
  it('inserting a line mid-document shifts subsequent numbers in the SAME commit', async () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    const { editor } = renderTensor(`<p>first para</p><p>third para</p>`);
    await settleLayout();
    expect(num(1)!.style.top).toBe(`${CY}px`);
    expect(num(2)!.style.top).toBe(`${CY + 16}px`);

    // Insert a paragraph between the two — NO settle wait: the assert
    // must pass on the synchronous PM-update→layout→paint path.
    act(() => {
      editor.commands.setTextSelection(12); // cursor at end of 'first para'
      editor.commands.enter();
      editor.commands.insertContent('second para');
    });
    // 3 lines now; the third para's line moved down and renumbered.
    expect(num(3)).not.toBeNull();
    expect(num(3)!.style.top).toBe(`${CY + 32}px`);
    expect(num(4)).toBeNull(); // no stale numbers left behind

    await settleLayout(); // stability confirmed after the fact
    expect(num(3)!.style.top).toBe(`${CY + 32}px`);
  });
});

// ─── 5. Persistence round-trip ──────────────────────────────────────────

describe('persistence (.wpdoc metadata, styles precedent)', () => {
  it('schema: lineNumbers round-trips; old files parse without it', () => {
    const file = {
      version: CURRENT_DOCUMENT_VERSION,
      docJSON: {},
      metadata: {
        lineNumbers: { enabled: true, mode: 'per-paragraph', countBy: 3 },
      },
    };
    const parsed = DocumentFileSchema.parse(file);
    expect(parsed.metadata.lineNumbers).toEqual({
      enabled: true,
      mode: 'per-paragraph',
      countBy: 3,
    });
    // The pre-linenumbers file: absent → undefined (openDocument maps to null).
    const old = DocumentFileSchema.parse({
      version: CURRENT_DOCUMENT_VERSION,
      docJSON: {},
      metadata: {},
    });
    expect(old.metadata.lineNumbers).toBeUndefined();
  });

  it('saveDocument writes the setting; a null setting is omitted (old-doc shape)', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await saveDocument(editor, '/x/a.wpdoc', useDocumentStore.getState().pageSetup, {
      enabled: true,
      mode: 'per-page',
    });
    const written = JSON.parse((writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(written.metadata.lineNumbers).toEqual({ enabled: true, mode: 'per-page' });

    vi.clearAllMocks();
    await saveDocument(editor, '/x/a.wpdoc', useDocumentStore.getState().pageSetup, null);
    const clean = JSON.parse((writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0][1] as string);
    expect(clean.metadata.lineNumbers).toBeUndefined();
  });

  it('openDocument returns the setting (and null for old files)', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    dialogMocks.openPath = '/x/a.wpdoc';
    (readTextFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({
        version: CURRENT_DOCUMENT_VERSION,
        docJSON: { type: 'doc', content: [] },
        metadata: { lineNumbers: { enabled: true, mode: 'continuous' } },
      }),
    );
    const result = await openDocument(editor);
    expect(result!.lineNumbers).toEqual({ enabled: true, mode: 'continuous' });

    (readTextFile as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ version: CURRENT_DOCUMENT_VERSION, docJSON: {}, metadata: {} }),
    );
    const old = await openDocument(editor);
    expect(old!.lineNumbers).toBeNull();
  });
});

// ─── 6. Layout tab split button + palette commands ───────────────────────

describe('Layout tab (ArrangeGroup) + palette commands', () => {
  it('the View tab keeps NO line-numbers control (placeholder group restored)', () => {
    render(<ShowGroup />);
    expect(document.querySelector('button[aria-label="Show Line Numbers"]')).toBeNull();
    expect(document.querySelectorAll('button[disabled]').length).toBe(5); // all placeholders
  });

  it('the main icon button reflects and toggles the setting (default Per Page)', () => {
    render(<ArrangeGroup />);
    const main = [...document.querySelectorAll('button')].find((b) =>
      b.hasAttribute('aria-pressed'),
    )! as HTMLButtonElement;
    expect(main.getAttribute('aria-pressed')).toBe('false');
    act(() => {
      fireEvent.click(main);
    });
    expect(main.getAttribute('aria-pressed')).toBe('true');
    expect(useDocumentStore.getState().lineNumbers).toEqual({ enabled: true, mode: 'per-page' });
    expect(useDocumentStore.getState().isDirty).toBe(true); // metadata change = dirty
    act(() => {
      fireEvent.click(main);
    });
    expect(useDocumentStore.getState().lineNumbers!.enabled).toBe(false);
  });

  it('the right-side chevron menu writes the mode (and enables)', () => {
    useDocumentStore.getState().setLineNumbers({ enabled: true, mode: 'continuous' });
    render(<ArrangeGroup />);
    const chevron = document.querySelector(
      'button[aria-label="Line Numbering Mode"]',
    ) as HTMLButtonElement;
    act(() => {
      fireEvent.click(chevron);
    });
    const option = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Per Paragraph1/¶', // label + muted sample glyph
    )!;
    act(() => {
      fireEvent.click(option);
    });
    expect(useDocumentStore.getState().lineNumbers).toEqual({
      enabled: true,
      mode: 'per-paragraph',
    });
  });

  it('palette: "Toggle Line Numbers" is present, runs, and toggles', () => {
    const command = getCommand('toggleLineNumbers')!;
    expect(command).toBeDefined();
    expect(command.title).toBe('Toggle Line Numbers');
    void command.run();
    expect(useDocumentStore.getState().lineNumbers!.enabled).toBe(true);
    void command.run();
    expect(useDocumentStore.getState().lineNumbers!.enabled).toBe(false);
  });

  it('palette: the mode flavors enable with their mode, and toggle off when already active', () => {
    void getCommand('lineNumbers:continuous')!.run();
    expect(useDocumentStore.getState().lineNumbers).toEqual({ enabled: true, mode: 'continuous' });
    // Same command again → off (toggle semantics).
    void getCommand('lineNumbers:continuous')!.run();
    expect(useDocumentStore.getState().lineNumbers).toEqual({
      enabled: false,
      mode: 'continuous',
    });
    // A different flavor switches the mode and stays on.
    void getCommand('lineNumbers:per-paragraph')!.run();
    expect(useDocumentStore.getState().lineNumbers).toEqual({
      enabled: true,
      mode: 'per-paragraph',
    });
  });
});
