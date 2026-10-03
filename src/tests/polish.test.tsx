import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render } from '@testing-library/react';
import { createLayoutEngine } from '@tensor-editor/engine';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { caretGeometry, textRangeLineRects, textRangeTextExtents } from '@/lib/paginated/positionMap';
import { SearchHighlights } from '@/components/editor/paginated/SearchHighlights';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensor } from './harness';
import { settleLayout } from './harness';
import { FakeMetrics } from './fakeMetrics';
import { DEFAULT_MARGINS, PAGE_GAP, toLayoutOptions } from '@/lib/document/pageSetup';

// P1 POLISH PASS. FakeMetrics @16: ascent 12.8, descent 3.2, glyph box
// 16px; a 2.0 line box is 32px with all leading below.

const BASE = { fontFamily: 'system-ui', fontSize: 16 };
const PAGE_SETUP = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };
const CB = { x: 96, y: 96, width: 624, height: 864 };

function adapt(editor: Parameters<typeof pmDocToSemantic>[0]) {
  return pmDocToSemantic(editor, BASE);
}

function layoutBlocks(blocks: ReturnType<typeof adapt>['doc']['blocks']) {
  const engine = createLayoutEngine({ metrics: FakeMetrics });
  return engine.layout({ baseStyle: BASE, blocks }, toLayoutOptions(PAGE_SETUP));
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

// ─── STEP 1: empty-line inheritance ──────────────────────────────────────

describe('empty-textblock inheritance (P1)', () => {
  it('an empty paragraph in a 2.0-spaced doc measures 2.0 — heights match its neighbors', async () => {
    const { editor } = renderTensor(
      '<p style="line-height: 2">alpha</p>' +
        '<p style="line-height: 2"></p>' +
        '<p style="line-height: 2">omega</p>'
    );
    await settle();
    const adapted = adapt(editor.state.doc);

    // The empty block carries ONE zero-length run with the paragraph's
    // effective style (the adapter's empty-textblock projection).
    const emptyBlock = adapted.doc.blocks[1] as { runs: unknown[] };
    expect(emptyBlock.runs).toEqual([
      { text: '', style: { fontFamily: 'system-ui', fontSize: 16, lineHeight: 2 } },
    ]);

    // Engine receipt (P1 ruling): the present run's style wins — the
    // blank line is as tall as its 2.0 siblings, not the 1.0 default.
    const result = layoutBlocks(adapted.doc.blocks);
    expect(result.lines.map((l) => [l.rect.y, l.rect.height])).toEqual([
      [0, 32],
      [32, 32], // the empty line, 2.0-correct
      [64, 32],
    ]);
  });

  it('an empty heading sizes under the heading default; an empty codeBlock under the mono style', async () => {
    const { editor } = renderTensor('<h1></h1><pre><code></code></pre>');
    await settle();
    const adapted = adapt(editor.state.doc);
    expect((adapted.doc.blocks[0] as { runs: { style: { fontSize: number } }[] }).runs[0]!.style.fontSize).toBe(32); // H1 default
    expect((adapted.doc.blocks[1] as { runs: { style: { fontFamily: string; fontSize: number } }[] }).runs[0]!.style.fontFamily).toBe('monospace');
    expect((adapted.doc.blocks[1] as { runs: { style: { fontFamily: string; fontSize: number } }[] }).runs[0]!.style.fontSize).toBe(16);
  });

  it('the caret on an empty 2.0-spaced paragraph is the 16px text band, matching neighbors', async () => {
    const { editor } = renderTensor(
      '<p style="line-height: 2">alpha</p><p style="line-height: 2"></p>'
    );
    await settle();
    const adapted = adapt(editor.state.doc);
    const empty = adapted.blocks[1];

    const result = layoutBlocks(adapted.doc.blocks);
    const caret = caretGeometry(adapted.blocks, result, empty.from + 1, FakeMetrics);
    expect(caret).not.toBeNull();
    expect(caret!.y).toBe(32); // the empty line's top
    expect(caret!.height).toBe(16); // 12.8 + 3.2 — the text band, not the 32px box

    // Shell-level: the painted caret shows the same band.
    act(() => {
      editor.commands.setTextSelection(empty.from + 1);
    });
    await settle();
    const el = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(el.style.top).toBe(`${CB.y + 32}px`);
    expect(el.style.height).toBe('16px');
  });
});

// ─── STEP 4: find-highlight geometry ─────────────────────────────────────

describe('find-highlight text extents (P1)', () => {
  it('match rects hug the glyphs; selection keeps the full leading box — different geometry, both pinned', async () => {
    const { editor } = renderTensor(
      `<p style="line-height: 2">${'a'.repeat(124)}</p>`
    );
    await settle();
    const adapted = adapt(editor.state.doc);
    const result = layoutBlocks(adapted.doc.blocks);
    const block = adapted.blocks[0];

    // A match on the SECOND line (a wrapped 2.0 line: box 32, band 16).
    const from = block.from + 1 + 62;
    const to = from + 10;

    const find = textRangeTextExtents(adapted.blocks, result, from, to, FakeMetrics, PAGE_GAP);
    expect(find).toHaveLength(1);
    expect(find[0].height).toBe(16); // glyph box: 12.8 + 3.2
    // Under the M6 bottom-only ruling the glyphs sit at the box top
    // (baseline − ascent = 0), so the extent starts at the line top.
    expect(find[0].top).toBe(CB.y + 32);

    const selection = textRangeLineRects(adapted.blocks, result, from, to, FakeMetrics, PAGE_GAP);
    expect(selection[0].height).toBe(32); // full leading box — the ruling stands
    expect(selection[0].top).toBe(CB.y + 32);

    // Same x span (one span walk, no forks).
    expect(find[0].left).toBe(selection[0].left);
    expect(find[0].width).toBe(selection[0].width);
  });

  it('the highlight divs paint at ~0.3 alpha — text stays visible through them', () => {
    const { container } = render(
      <SearchHighlights
        matches={[{ pageIndex: 0, left: 10, top: 20, width: 30, height: 16 }]}
        current={[{ pageIndex: 0, left: 40, top: 20, width: 10, height: 16 }]}
      />
    );
    const match = container.querySelector('[data-testid="search-rect"]') as HTMLElement;
    expect(match.style.opacity).toBe('0.3');
    expect(Number(match.style.opacity)).toBeLessThan(1); // text visible through it
    expect(match.style.height).toBe('16px'); // the extent geometry flows through
    const current = container.querySelector('[data-testid="search-current-rect"]') as HTMLElement;
    expect(current.style.opacity).toBe('0.3');
  });
});
