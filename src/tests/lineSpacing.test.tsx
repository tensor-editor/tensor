import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { createLayoutEngine } from '@tensor-editor/engine';
import type { AdapterBlock } from '@/lib/paginated/adapter';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensor } from './harness';
import { settleLayout } from './harness';
import { FakeMetrics } from './fakeMetrics';
import {
  caretGeometry,
  textRangeLineRects,
} from '@/lib/paginated/positionMap';
import { hitTest } from '@/lib/paginated/hitTest';
import {
  DEFAULT_MARGINS,
  PAGE_GAP,
  toLayoutOptions,
} from '@/lib/document/pageSetup';

// METRICS CONSTANTS (auditable geometry): FakeMetrics at fontSize 16
// gives ascent 0.8×16 = 12.8, descent 0.2×16 = 3.2, so the glyph box
// is exactly 16px. BOTTOM-ONLY LEADING (M6 ruling — spec of record):
// a 2.0 line box is exactly 32px tall with the baseline at ascent =
// 12.8 from the box top — ALL 16px of leading lives BELOW the glyphs
// (a line box's top-left is always text; above-line space belongs to
// block-tier spaceBefore/spaceAfter, never to the line).

const BASE = { fontFamily: 'fake', fontSize: 16 };
const A = 0.8 * 16; // 12.8
const D = 0.2 * 16; // 3.2
const CONTENT = A + D; // 16
const PAGE_SETUP = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };
// Letter engine geometry: page 816×1056, contentBox x/y 96, 624×864.
const CB = { x: 96, y: 96, width: 624, height: 864 };

function layoutDoc(blocks: Parameters<ReturnType<typeof createLayoutEngine>['layout']>[0]['blocks']) {
  const engine = createLayoutEngine({ metrics: FakeMetrics });
  return engine.layout(
    { baseStyle: BASE, blocks },
    toLayoutOptions(PAGE_SETUP)
  );
}

function adapterBlock(id: string, text: string, lineHeight?: number): AdapterBlock {
  const style = { ...BASE, ...(lineHeight != null ? { lineHeight } : {}) };
  return {
    id,
    runs: [{ text, style }],
    text,
    from: 0,
    to: text.length + 2,
    align: 'left',
    runDecor: [],
  };
}

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({ pageSetup: PAGE_SETUP });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle() {
  await settleLayout();
}

// ─── Attr path: LineSpacingButton's command → PM attr → adapter ─────────

describe('line spacing attr path', () => {
  it('setLineHeight("2") (the UI command) reaches the engine as multiplier 2', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();

    // The exact spelling LineSpacingButton.apply uses.
    act(() => {
      editor.chain().focus().setLineHeight('2').run();
    });
    await settle();

    const adapted = pmDocToSemantic(editor.state.doc, BASE);
    expect((adapted.doc.blocks[0] as { runs: { style: { lineHeight: number } }[] }).runs[0]!.style.lineHeight).toBe(2);
  });

  it('every observed UI value maps to its multiplier (parser table)', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();

    const cases: Array<[string | number | null, number | undefined]> = [
      // Presets the button writes:
      ['1', 1],
      ['1.15', 1.15],
      ['1.5', 1.5],
      ['2', 2],
      // Custom input range (0.5–4, advisory only — arbitrary strings land):
      ['0.5', 0.5],
      ['4', 4],
      ['2.85', 2.85],
      // Out of the sane range: degrade to single, never a wreck.
      ['0.1', undefined],
      ['10', undefined],
      // Pasted-HTML formats (parseHTML can feed these to the attr):
      ['200%', 2],
      ['50%', 0.5],
      ['25px', 25 / 16], // absolute ÷ own font size (16)
      ['18pt', (18 * (96 / 72)) / 16], // = 1.5
      ['1.5em', 1.5],
      ['normal', undefined],
      ['', undefined],
      ['garbage', undefined],
      // Attr cleared:
      [null, undefined],
      // Defensive: a numeric attr (schema stores strings).
      [2, 2],
    ];

    for (const [raw, expected] of cases) {
      act(() => {
        editor.commands.setTextSelection(2); // inside the paragraph
        editor.commands.updateAttributes('paragraph', { lineHeight: raw });
      });
      const adapted = pmDocToSemantic(editor.state.doc, BASE);
      expect(
        (adapted.doc.blocks[0] as { runs: { style: { lineHeight: number } }[] }).runs[0]!.style
          .lineHeight,
        `attr ${JSON.stringify(raw)}`,
      ).toBe(expected);
    }
  });

  it('absolute px line-height is relative to each run’s own font size', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 }); // 'hello'
      editor.commands.updateAttributes('paragraph', { lineHeight: '25px' });
      editor.commands.setFontSize('32px'); // marks the selected run
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE);
    const runs = (adapted.doc.blocks[0] as { runs: { style: { fontSize: number; lineHeight: number } }[] }).runs;
    expect(runs[0].style.fontSize).toBe(32);
    expect(runs[0].style.lineHeight).toBe(25 / 32); // 25px at a 32px run
  });
});

// ─── Geometry: engine LineBox per the E1 half-leading spec ───────────────

describe('line spacing geometry (E1 half-leading)', () => {
  it('2.0 block: height (ascent+descent)×2, baseline at ascent — all leading below (M6 ruling)', () => {
    const result = layoutDoc([
      { id: 'a', kind: 'paragraph', runs: [{ text: 'hello', style: { ...BASE, lineHeight: 2 } }] },
    ]);
    const line = result.lines[0];
    expect(line.rect.height).toBe(CONTENT * 2); // 32
    // baseline = ascent from the box top (bottom-only leading): the
    // whole 16px of leading lives below the glyphs — the box top is
    // always text, never padding.
    expect(line.baseline).toBe(A); // 12.8
    expect(line.rect.height).toBe(32);
    expect(line.baseline).toBe(12.8);
  });

  it('adjacent lines tile with no overlap and no gap (same and mixed spacing)', () => {
    const result = layoutDoc([
      {
        id: 'a',
        kind: 'paragraph',
        runs: [{ text: 'a'.repeat(124), style: { ...BASE, lineHeight: 2 } }], // 2 lines @ 32
      },
      { id: 'b', kind: 'paragraph', runs: [{ text: 'b'.repeat(62), style: BASE }] }, // 1 line @ 16
    ]);
    const rects = result.lines.map((l) => l.rect);
    // 2.0 block lines tile: y 0, 32.
    expect(rects[0].y).toBe(0);
    expect(rects[0].height).toBe(32);
    expect(rects[1].y).toBe(32);
    expect(rects[1].height).toBe(32);
    // The 1.0 block starts exactly where the 2.0 block ended: y 64.
    expect(rects[2].y).toBe(64);
    // No overlap, no gap anywhere.
    for (let i = 1; i < rects.length; i++) {
      expect(rects[i - 1].y + rects[i - 1].height).toBe(rects[i].y);
    }
  });

  it('scales with font size: 32px run at 2.0 is 64px tall, baseline at its ascent', () => {
    const big = { fontFamily: 'fake', fontSize: 32 };
    const engine = createLayoutEngine({ metrics: FakeMetrics });
    const result = engine.layout(
      { baseStyle: big, blocks: [{ id: 'a', kind: 'paragraph', runs: [{ text: 'x', style: { ...big, lineHeight: 2 } }] }] },
      toLayoutOptions(PAGE_SETUP)
    );
    expect(result.lines[0].rect.height).toBe(64); // (25.6+6.4)×2
    expect(result.lines[0].baseline).toBe(25.6); // ascent — leading below
  });
});

// ─── Overlays: caret, selection, hitTest — the full leading box ───────────

describe('leading-box overlays', () => {
  // One 2-line 2.0 block: lines at content y 0 and 32.
  const text = 'a'.repeat(124);
  const block = adapterBlock('a', text, 2);
  const result = layoutDoc([
    { id: 'a', kind: 'paragraph', runs: [{ text, style: { ...BASE, lineHeight: 2 } }] },
  ]);

  it('caret is the text band, not the leading: top at box top, bottom at text descent', () => {
    // 2.0 lines: box 32px, baseline 12.8, descent 3.2 → text band
    // 16px starting at the box top (M6: the box top is always text).
    // The caret never stretches across the leading below.
    const caret0 = caretGeometry([block], result, block.from + 1, FakeMetrics);
    expect(caret0).not.toBeNull();
    expect(caret0!.y).toBe(0);
    expect(caret0!.height).toBe(16); // 12.8 + 3.2

    // Second line of the block: same text band at its box top.
    const caret1 = caretGeometry([block], result, block.from + 1 + 62, FakeMetrics);
    expect(caret1!.y).toBe(32);
    expect(caret1!.height).toBe(16);

    // At lineHeight 1.0 the band is bit-identical to the box height.
    const plain = adapterBlock('p', 'hello');
    const plainResult = layoutDoc([
      { id: 'p', kind: 'paragraph', runs: [{ text: 'hello', style: BASE }] },
    ]);
    const caretPlain = caretGeometry([plain], plainResult, 1, FakeMetrics);
    expect(caretPlain!.height).toBe(plainResult.lines[0].rect.height); // 16
  });

  it('selection rects cover the full line height and tile across lines', () => {
    // Whole block selected: one rect per line, both 32px, zero gap.
    const rects = textRangeLineRects(
      [block],
      result,
      block.from + 1,
      block.from + 1 + text.length,
      FakeMetrics,
      PAGE_GAP
    );
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(r.height).toBe(32);
    expect(rects[0].top).toBe(CB.y); // content y 0 → stack y 96
    expect(rects[1].top).toBe(CB.y + 32);
    expect(rects[0].top + rects[0].height).toBe(rects[1].top); // tiles, zero gap
  });

  it('hitTest: clicks anywhere in the box — glyph band at top, leading below — resolve to that line', () => {
    // M6 ruling geometry: baseline 12.8 → ink from y 0 (12.8−12.8)
    // to y 16 (12.8+3.2); the whole 16px leading is BELOW, y 16..32.
    const top = hitTest(result, [block], FakeMetrics, PAGE_GAP, CB.x + 2, CB.y + 4);
    const belowLeading = hitTest(result, [block], FakeMetrics, PAGE_GAP, CB.x + 2, CB.y + 28);
    expect(top).toEqual({ blockId: 'a', offset: 0 });
    expect(belowLeading).toEqual({ blockId: 'a', offset: 0 });
    // The box boundary belongs to the next line (nearest-line rule).
    const nextLine = hitTest(result, [block], FakeMetrics, PAGE_GAP, CB.x + 2, CB.y + 32);
    expect(nextLine).toEqual({ blockId: 'a', offset: 62 });
  });
});

// ─── Shell DOM: the painted overlays on a real 2.0 block ─────────────────

describe('line spacing shell integration', () => {
  it('caret and selection on a 2.0 block paint the full 32px leading box', async () => {
    const { editor } = renderTensor(`<p>${'a'.repeat(124)}</p>`);
    await settle();
    act(() => {
      editor.chain().focus().setLineHeight('2').run();
      editor.commands.setTextSelection(1);
    });
    await settle();

    const caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement | null;
    expect(caret).not.toBeNull();
    expect(caret!.style.height).toBe('16px'); // text band, not the 32px box
    expect(caret!.style.top).toBe(`${CB.y}px`);

    act(() => {
      editor.commands.selectAll();
    });
    await settle();

    const rects = [...document.querySelectorAll('[data-testid="selection-rect"]')] as HTMLElement[];
    expect(rects).toHaveLength(2);
    for (const r of rects) expect(r.style.height).toBe('32px');
    expect(rects[0].style.top).toBe(`${CB.y}px`);
    // Adjacent-line selection rects tile with zero gap.
    expect(rects[0].style.top).toBe(`${CB.y}px`);
    expect(rects[1].style.top).toBe(`${CB.y + 32}px`);
  });
});

// ─── Block-tier spacing (M6): spaceBefore/spaceAfter ────────────────────

describe('block spacing attr path + geometry (M6)', () => {
  it('PM attrs map through the adapter onto the engine block', async () => {
    const { editor } = renderTensor('<p>hello</p><p>world</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.updateAttributes('paragraph', { spaceBefore: 24, spaceAfter: 12 });
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE);
    expect(adapted.doc.blocks[0].spaceBefore).toBe(24);
    expect(adapted.doc.blocks[0].spaceAfter).toBe(12);
    // Untouched blocks carry no spacing keys (hash stays lean).
    expect(adapted.doc.blocks[1].spaceBefore).toBeUndefined();
    expect(adapted.doc.blocks[1].spaceAfter).toBeUndefined();
  });

  it('zero/negative/garbage spacing attrs map to undefined', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();
    for (const raw of [0, -10, Number.NaN, '24', null]) {
      act(() => {
        editor.commands.setTextSelection(2);
        editor.commands.updateAttributes('paragraph', { spaceBefore: raw, spaceAfter: raw });
      });
      const adapted = pmDocToSemantic(editor.state.doc, BASE);
      expect(adapted.doc.blocks[0].spaceBefore, `spaceBefore ${String(raw)}`).toBeUndefined();
      expect(adapted.doc.blocks[0].spaceAfter, `spaceAfter ${String(raw)}`).toBeUndefined();
    }
  });

  it('geometry: spaceBefore pushes the first line down; spaceAfter pads the successor’s entry', () => {
    const result = layoutDoc([
      { id: 'a', kind: 'paragraph', runs: [{ text: 'hello', style: BASE }], spaceBefore: 24 },
      { id: 'b', kind: 'paragraph', runs: [{ text: 'world', style: BASE }], spaceAfter: 8 },
      { id: 'c', kind: 'paragraph', runs: [{ text: 'tail', style: BASE }] },
    ]);
    // a: entry spaceBefore 24 → line top at 24.
    expect(result.lines[0].rect.y).toBe(24);
    // b: enters at 24+16 = 40 (no spaceBefore of its own).
    expect(result.lines[1].rect.y).toBe(40);
    // c: enters at b's exit — 40+16+spaceAfter 8 = 64.
    expect(result.lines[2].rect.y).toBe(64);
  });

  it('shell: lh=2 shows NO top padding; spaceBefore=24 shows it above (perception receipt)', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settle();

    // Double spacing: the line box's top-left is text — the caret
    // (full box) still starts at the content-box top. No padding.
    act(() => {
      editor.chain().focus().setLineHeight('2').run();
      editor.commands.setTextSelection(1);
    });
    await settle();
    let caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement | null;
    expect(caret).not.toBeNull();
    expect(caret!.style.top).toBe(`${CB.y}px`);
    expect(caret!.style.height).toBe('16px'); // text band — the caret ignores the leading

    // spaceBefore 24: the block visibly starts 24px lower.
    act(() => {
      editor.commands.updateAttributes('paragraph', { spaceBefore: 24 });
    });
    await settle();
    caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement | null;
    expect(caret!.style.top).toBe(`${CB.y + 24}px`);
  });
});

// ─── Pagination: a 2.0 block fragmenting across a page boundary ───────────

describe('line spacing × pagination', () => {
  it('fragment’s last line keeps its full leading; the next page starts at y=0', () => {
    // Page content height 864. Block A: 50 single lines (50×16 = 800).
    // Block B: 4 double lines (32px each). Remaining 64px fits exactly
    // two of B’s lines → fragment {2 on page 0, 2 on page 1}, no
    // orphan/widow adjustment (fits ≥ 2 and remainder ≥ 2).
    const result = layoutDoc([
      { id: 'a', kind: 'paragraph', runs: [{ text: 'a'.repeat(62 * 50), style: BASE }] },
      { id: 'b', kind: 'paragraph', runs: [{ text: 'b'.repeat(62 * 4), style: { ...BASE, lineHeight: 2 } }] },
    ]);

    const bLines = result.lines.filter((l) => l.blockId === 'b');
    expect(bLines).toHaveLength(4);

    // Page 0 fragment: lines at y 800 and 832; the LAST line’s full
    // 32px (leading included) stays on page 0 — its bottom edge is
    // exactly the content-box height, no leading pushed across.
    const page0 = bLines.filter((l) => l.pageIndex === 0);
    expect(page0.map((l) => l.rect.y)).toEqual([800, 832]);
    expect(page0[1].rect.y + page0[1].rect.height).toBe(CB.height); // 864

    // Page 1 continues at content y=0 — contiguity, no seam.
    const page1 = bLines.filter((l) => l.pageIndex === 1);
    expect(page1.map((l) => l.rect.y)).toEqual([0, 32]);

    expect(result.breaks.some((b) => b.blockId === 'b')).toBe(true);
  });
});
