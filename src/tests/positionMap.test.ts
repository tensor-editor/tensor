import { describe, it, expect } from 'vitest';
import type { LayoutResult, LineBox } from '@tensor-editor/engine';
import type { AdapterBlock } from '@/lib/paginated/adapter';
import {
  pmPosToBlockOffset,
  blockOffsetToPmPos,
  lineForOffset,
  lineOffsetX,
  textRangeLineRects,
  caretGeometry,
} from '@/lib/paginated/positionMap';
import { FakeMetrics } from './fakeMetrics';

// STEP 0 unit fixtures — the classic off-by-one habitat is block
// starts/ends, so every boundary has a case.

const blocks: AdapterBlock[] = [
  { id: 'a', runs: [{ text: 'hello', style: { fontFamily: 'x', fontSize: 16 } }], text: 'hello', from: 0, to: 7 },
  { id: 'b', runs: [{ text: 'world', style: { fontFamily: 'x', fontSize: 16 } }], text: 'world', from: 7, to: 14 },
];

function makeLine(blockId: string, page: number, index: number, rangeStart: number, rangeEnd: number, y: number): LineBox {
  return {
    blockId,
    lineIndex: index,
    pageIndex: page,
    rect: { x: 0, y, width: (rangeEnd - rangeStart) * 10, height: 16 },
    baseline: 13,
    rangeStart,
    rangeEnd,
    segments: [{ runIndex: 0, start: rangeStart, end: rangeEnd }],
  };
}

// Line-projection fixtures: block 'a' wraps 150 chars over 3 lines
// (62/62/26) on page 0; block 'b' wraps 90 chars over 2 lines on page 1.
const STYLE = { fontFamily: 'x', fontSize: 16 };
const wrapBlocks: AdapterBlock[] = [
  { id: 'a', runs: [{ text: 'a'.repeat(150), style: STYLE }], text: 'a'.repeat(150), from: 0, to: 152 },
  { id: 'b', runs: [{ text: 'b'.repeat(90), style: STYLE }], text: 'b'.repeat(90), from: 152, to: 244 },
];
const B_TEXT = 153; // 'b' block's first text char

const lines = [
  makeLine('a', 0, 0, 0, 62, 0),
  makeLine('a', 0, 1, 62, 124, 16),
  makeLine('a', 0, 2, 124, 150, 32),
  makeLine('b', 1, 0, 0, 62, 0),
  makeLine('b', 1, 1, 62, 90, 16),
];

const result: LayoutResult = {
  pages: [
    { index: 0, size: { x: 0, y: 0, width: 816, height: 1056 }, contentBox: { x: 96, y: 96, width: 624, height: 864 } },
    { index: 1, size: { x: 0, y: 0, width: 816, height: 1056 }, contentBox: { x: 96, y: 96, width: 624, height: 864 } },
  ],
  lines,
  breaks: [],
  version: 1,
};

describe('STEP 0: pmPosToBlockOffset (boundaries)', () => {
  it('maps interior positions', () => {
    expect(pmPosToBlockOffset(blocks, 3)).toEqual({ block: blocks[0], offset: 2 });
    expect(pmPosToBlockOffset(blocks, 9)).toEqual({ block: blocks[1], offset: 1 });
  });

  it('block start -> offset 0; before first block -> into first block', () => {
    expect(pmPosToBlockOffset(blocks, 1)).toEqual({ block: blocks[0], offset: 0 });
    expect(pmPosToBlockOffset(blocks, 0)).toEqual({ block: blocks[0], offset: 0 });
  });

  it('block end and next-block start project onto the block end', () => {
    // pos 7 == a.to == b.from: a selection ending here covers a's text.
    expect(pmPosToBlockOffset(blocks, 7)).toEqual({ block: blocks[0], offset: 5 });
    // pos 8 is INSIDE b (its text start).
    expect(pmPosToBlockOffset(blocks, 8)).toEqual({ block: blocks[1], offset: 0 });
    // end of doc.
    expect(pmPosToBlockOffset(blocks, 14)).toEqual({ block: blocks[1], offset: 5 });
  });

  it('returns null beyond the doc', () => {
    expect(pmPosToBlockOffset(blocks, 99)).toBeNull();
  });

  it('round-trips through blockOffsetToPmPos', () => {
    expect(blockOffsetToPmPos(blocks[0], 5)).toBe(6);
    expect(blockOffsetToPmPos(blocks[1], 0)).toBe(8);
    expect(blockOffsetToPmPos(blocks[1], 5)).toBe(13);
  });
});

describe('STEP 0: line resolution + x measurement', () => {
  const aLines = lines.filter((l) => l.blockId === 'a');
  const a = wrapBlocks[0]!;

  it('finds the containing line; boundary offsets belong to the later line', () => {
    expect(lineForOffset(aLines, 0)!.rangeStart).toBe(0);
    expect(lineForOffset(aLines, 61)!.rangeEnd).toBe(62);
    expect(lineForOffset(aLines, 62)!.rangeStart).toBe(62);
    expect(lineForOffset(aLines, 124)!.rangeStart).toBe(124);
    expect(lineForOffset(aLines, 150)!.rangeStart).toBe(124); // end of text -> last line
  });

  it('measures the run-prefix x exactly', () => {
    expect(lineOffsetX(aLines[0]!, a, 0, FakeMetrics)).toBe(0);
    expect(lineOffsetX(aLines[0]!, a, 10, FakeMetrics)).toBe(100);
    expect(lineOffsetX(aLines[1]!, a, 72, FakeMetrics)).toBe(100);
    expect(lineOffsetX(aLines[2]!, a, 150, FakeMetrics)).toBe(260);
  });
});

describe('STEP 0: textRangeLineRects (selection/search projection)', () => {
  it('single-line partial x', () => {
    const rects = textRangeLineRects(wrapBlocks, result, 1 + 5, 1 + 10, FakeMetrics, 32);
    expect(rects).toEqual([
      { pageIndex: 0, left: 96 + 50, top: 96, width: 50, height: 16 },
    ]);
  });

  it('multi-line: partial first/last, full-width middles', () => {
    const rects = textRangeLineRects(wrapBlocks, result, 1 + 5, 1 + 134, FakeMetrics, 32);
    expect(rects).toEqual([
      { pageIndex: 0, left: 96 + 50, top: 96, width: 620 - 50, height: 16 },
      { pageIndex: 0, left: 96, top: 96 + 16, width: 624, height: 16 },
      { pageIndex: 0, left: 96, top: 96 + 32, width: 100, height: 16 },
    ]);
  });

  it('across blocks and the page boundary', () => {
    const rects = textRangeLineRects(wrapBlocks, result, 1 + 100, B_TEXT + 3, FakeMetrics, 32);
    // a's L1 partial (100..124), a's L2 fully covered (middle -> full
    // width — the from-block's tail extends like Word), b's L0 partial.
    expect(rects).toEqual([
      { pageIndex: 0, left: 96 + 380, top: 96 + 16, width: 620 - 380, height: 16 },
      { pageIndex: 0, left: 96, top: 96 + 32, width: 624, height: 16 },
      { pageIndex: 1, left: 96, top: 1088 + 96, width: 30, height: 16 },
    ]);
  });

  it('empty/degenerate ranges produce nothing', () => {
    expect(textRangeLineRects(wrapBlocks, result, 3, 3, FakeMetrics, 32)).toEqual([]);
    // pos 152 == 'a'.to == 'b'.from projects onto a's text END — a range
    // already at that end is empty.
    expect(textRangeLineRects(wrapBlocks, result, 151, 152, FakeMetrics, 32)).toEqual([]);
  });

  it('caret geometry rides the same math', () => {
    const g = caretGeometry(wrapBlocks, result, 1 + 100, FakeMetrics)!;
    expect(g).toEqual({ pageIndex: 0, x: 380, y: 16, height: 16 });
    const g2 = caretGeometry(wrapBlocks, result, B_TEXT, FakeMetrics)!;
    expect(g2).toEqual({ pageIndex: 1, x: 0, y: 0, height: 16 });
  });
});
