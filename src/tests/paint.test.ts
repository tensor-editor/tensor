import { describe, it, expect } from 'vitest';
import type { LineBox, Run } from '@tensor-editor/engine';
import type { BlockPaint, RunDecor } from '@/lib/paginated/adapter';
import { paintLines } from '@/lib/paginated/paint';
import { alignOffset } from '@/lib/paginated/positionMap';
import { FakeMetrics } from './fakeMetrics';

/** Paint fidelity: exact underline/strike y, highlight
 * rect, colored fillStyle, and the shared alignOffset, asserted against
 * a recording ctx. All math is FakeMetrics-deterministic: ascent
 * 0.8*fontSize, descent 0.2*fontSize, 10px/char. */

interface Op { op: string; args: unknown[]; font?: string }
interface Ctx extends Record<string, unknown> {
  fillStyle: string;
  font: string;
  ops: Op[];
}

function makeCtx(): Ctx {
  const ops: Op[] = [];
  const ctx: Ctx = {
    fillStyle: '',
    font: '',
    ops,
  };
  ctx.fillText = (...args: unknown[]) => ops.push({ op: 'fillText', args, font: ctx.font });
  ctx.fillRect = (...args: unknown[]) => ops.push({ op: 'fillRect', args, font: ctx.font });
  return ctx;
}

const STYLE = { fontFamily: 'Test Sans', fontSize: 16 };
const runs: Run[] = [{ text: 'Hi there', style: STYLE }];
const text = 'Hi there';

function line(width: number): LineBox {
  return {
    blockId: 'a',
    lineIndex: 0,
    pageIndex: 0,
    rect: { x: 0, y: 0, width, height: 16 },
    baseline: 13,
    rangeStart: 0,
    rangeEnd: 8,
    segments: [{ runIndex: 0, start: 0, end: 8 }],
  };
}

const LEFT = { align: 'left' as const, contentWidth: 624, runDecor: [] as RunDecor[] };

function paint(decor: RunDecor[], align: 'left' | 'center' | 'right' = 'left') {
  const ctx = makeCtx();
  paintLines(ctx as unknown as CanvasRenderingContext2D, [line(80)], runs, text, 0, FakeMetrics, {
    align,
    contentWidth: 624,
    runDecor: decor,
  });
  return ctx;
}

describe('paint: marks', () => {
  it('underlines at ~0.08em below the baseline, exact y and thickness', () => {
    const ctx = paint([{ underline: true }]);
    const ul = ctx.ops.find((o) => o.op === 'fillRect');
    expect(ul).toBeDefined();
    // baselineY = 13; y = 13 + 0.08*16 = 14.28; thickness = round(16/16) = 1
    expect(ul!.args).toEqual([0, 13 + 1.28, 80, 1]);
  });

  it('strikes at ~0.3em above the baseline, exact y', () => {
    const ctx = paint([{ strike: true }]);
    const st = ctx.ops.find((o) => o.op === 'fillRect');
    // y = 13 - 0.3*16 = 8.2
    expect(st!.args).toEqual([0, 13 - 4.8, 80, 1]);
  });

  it('highlight fills ascent-top to descent-bottom, painted before text', () => {
    const ctx = paint([{ highlight: '#fef08a' }]);
    const hl = ctx.ops.find((o) => o.op === 'fillRect');
    // ascent 12.8, descent 3.2: rect (0, baseline-ascent, width, ascent+descent)
    expect(hl!.args[0]).toBe(0);
    expect(hl!.args[1]).toBeCloseTo(13 - 12.8, 10);
    expect(hl!.args[2]).toBe(80);
    expect(hl!.args[3]).toBeCloseTo(16, 10);
    // before the text op
    expect(ctx.ops[0]!.op).toBe('fillRect');
    expect(ctx.ops[1]!.op).toBe('fillText');
    expect(ctx.fillStyle).toBe('#000'); // text color restored after highlight
  });

  it('colored text sets fillStyle from the run decor; font from the shared builder', () => {
    const ctx = paint([{ color: '#dc2626' }]);
    const ft = ctx.ops.find((o) => o.op === 'fillText')!;
    expect(ctx.fillStyle).toBe('#dc2626');
    expect(ft.args).toEqual(['Hi there', 0, 13]);
    expect(ctx.font).toBe('16px Test Sans');
  });

  it('bold/italic ride the shared fontString', () => {
    const ctx = makeCtx();
    const boldRuns: Run[] = [{ text: 'x', style: { ...STYLE, bold: true, italic: true } }];
    paintLines(ctx as unknown as CanvasRenderingContext2D, [line(10)], boldRuns, 'x', 0, FakeMetrics, LEFT);
    expect(ctx.font).toBe('italic 700 16px Test Sans');
  });

  it('a monospace-family block paints with the family in ctx.font', () => {
    const ctx = makeCtx();
    const monoRuns: Run[] = [
      { text: 'code', style: { ...STYLE, fontFamily: 'monospace' } },
      { text: ' plain', style: STYLE },
    ];
    const lines: LineBox[] = [
      {
        blockId: 'a', lineIndex: 0, pageIndex: 0,
        rect: { x: 0, y: 0, width: 90, height: 16 },
        baseline: 13, rangeStart: 0, rangeEnd: 9,
        segments: [{ runIndex: 0, start: 0, end: 4 }, { runIndex: 1, start: 4, end: 9 }],
      },
    ];
    paintLines(ctx as unknown as CanvasRenderingContext2D, lines, monoRuns, 'code plain', 0, FakeMetrics, LEFT);
    const fonts = ctx.ops.filter((o) => o.op === 'fillText');
    expect(fonts.length).toBe(2);
    expect(fonts[0]!.font).toBe('16px monospace');
    expect(fonts[1]!.font).toBe('16px Test Sans');
  });
});

describe('paint: non-printing characters (M6 v1)', () => {
  const EXTRAS = (npc?: boolean) => ({ align: 'left' as const, contentWidth: 624, runDecor: [] as RunDecor[], ...(npc != null ? { npc } : {}) });

  function paintWith(text: string, box: LineBox, npc?: boolean) {
    const ctx = makeCtx();
    const r: Run[] = [{ text, style: STYLE }];
    paintLines(ctx as unknown as CanvasRenderingContext2D, [box], r, text, 0, FakeMetrics, EXTRAS(npc));
    return ctx;
  }

  it('npc on: block end paints a muted ¶ at the last glyph’s end', () => {
    const ctx = paintWith('Hi there', line(80), true);
    const texts = ctx.ops.filter((o) => o.op === 'fillText');
    expect(texts.map((o) => o.args[0])).toEqual(['Hi there', '¶']);
    // x = line start + measured width (80); same baseline as the text.
    expect(texts[1]!.args[1]).toBe(80);
    expect(texts[1]!.args[2]).toBe(13);
    // Muted ink, restored afterwards.
    expect(ctx.fillStyle).toBe('#000');
  });

  it('npc off by default: nothing extra is painted', () => {
    const ctx = paintWith('Hi there', line(80), false);
    expect(ctx.ops.filter((o) => o.op === 'fillText')).toHaveLength(1);
    // Absent flag behaves identically (no print/export path ever sets it).
    const ctx2 = paintWith('Hi there', line(80), undefined);
    expect(ctx2.ops.filter((o) => o.op === 'fillText')).toHaveLength(1);
  });

  it('nbsp and tab paint as middle-dot and arrow — ink only, same advance', () => {
    const text = 'a\u00A0b\tc';
    const box: LineBox = { ...line(50), rangeEnd: 5, segments: [{ runIndex: 0, start: 0, end: 5 }] };
    const ctx = paintWith(text, box, true);
    const texts = ctx.ops.filter((o) => o.op === 'fillText');
    expect(texts[0]!.args[0]).toBe('a·b→c');
    // The ¶ still rides the MEASURED width (50) — substitution never moves ink.
    expect(texts[1]!.args[1]).toBe(50);
  });

  it('an earlier fragment of a split block paints no ¶', () => {
    const box: LineBox = { ...line(80), rangeEnd: 4, segments: [{ runIndex: 0, start: 0, end: 4 }] };
    const ctx = paintWith('Hi there', box, true);
    expect(ctx.ops.filter((o) => o.op === 'fillText')).toHaveLength(1);
  });

  it('an empty block paints ¶ at the line start', () => {
    const box: LineBox = {
      blockId: 'a', lineIndex: 0, pageIndex: 0,
      rect: { x: 0, y: 0, width: 0, height: 16 },
      baseline: 13, rangeStart: 0, rangeEnd: 0, segments: [],
    };
    const ctx = paintWith('', box, true);
    const texts = ctx.ops.filter((o) => o.op === 'fillText');
    expect(texts).toHaveLength(1);
    expect(texts[0]!.args).toEqual(['¶', 0, 13]);
  });

  it('P1: the ¶ renders in the block\'s PLAIN style — bold/italic stripped', () => {
    const ctx = makeCtx();
    const box: LineBox = {
      ...line(80),
      rangeEnd: 2,
      segments: [{ runIndex: 0, start: 0, end: 2 }],
    };
    const boldRuns: Run[] = [{ text: 'Hi', style: { ...STYLE, bold: true, italic: true } }];
    paintLines(ctx as unknown as CanvasRenderingContext2D, [box], boldRuns, 'Hi', 0, FakeMetrics, {
      align: 'left',
      contentWidth: 624,
      runDecor: [],
      npc: true,
      markerStyle: STYLE,
    });
    const texts = ctx.ops.filter((o) => o.op === 'fillText');
    expect(texts.map((o) => o.args[0])).toEqual(['Hi', '¶']);
    // The text is bold+italic; the ¶ is PLAIN (bold/italic stripped).
    expect(texts[0]!.font).toBe('italic 700 16px Test Sans');
    expect(texts[1]!.font).toBe('16px Test Sans');
  });

  it('P1: the ¶\'s size follows the block\'s effective style', () => {
    const ctx = makeCtx();
    const box: LineBox = {
      ...line(80),
      rangeEnd: 2,
      segments: [{ runIndex: 0, start: 0, end: 2 }],
    };
    const bigRuns: Run[] = [{ text: 'Hi', style: { ...STYLE, fontSize: 24 } }];
    paintLines(ctx as unknown as CanvasRenderingContext2D, [box], bigRuns, 'Hi', 0, FakeMetrics, {
      align: 'left',
      contentWidth: 624,
      runDecor: [],
      npc: true,
      markerStyle: { fontFamily: 'Test Sans', fontSize: 24 },
    });
    const pilcrow = ctx.ops.find((o) => o.op === 'fillText' && o.args[0] === '¶')!;
    expect(pilcrow.font).toBe('24px Test Sans');
  });
});

describe('paint: block decor (M6.1 — markers, blockquote, code, rule)', () => {
  const MARKER_STYLE = { fontFamily: 'Test Sans', fontSize: 16 };

  function paintBox(
    box: LineBox,
    text: string,
    paint: BlockPaint | undefined,
    extra?: { contentWidth?: number }
  ) {
    const ctx = makeCtx();
    const r: Run[] = text ? [{ text, style: STYLE }] : [];
    paintLines(ctx as unknown as CanvasRenderingContext2D, [box], r, text, 0, FakeMetrics, {
      align: 'left',
      contentWidth: extra?.contentWidth ?? 624,
      runDecor: [],
      paint,
      markerStyle: MARKER_STYLE,
    });
    return ctx;
  }

  function indentLine(indent: number, lineIndex = 0): LineBox {
    return {
      blockId: 'a',
      lineIndex,
      pageIndex: 0,
      rect: { x: indent, y: 0, width: 60, height: 16 },
      baseline: 13,
      rangeStart: 0,
      rangeEnd: 6,
      segments: text ? [{ runIndex: 0, start: 0, end: 6 }] : [],
    };
  }
  let text = 'aaaaaa';

  it('bullet markers: every listStyleType glyph, left-aligned in the indent gutter', () => {
    const cases: Array<[string, string]> = [
      ['disc', '•'],
      ['circle', '○'],
      ['square', '▪'],
    ];
    for (const [styleType, glyph] of cases) {
      const ctx = paintBox(indentLine(32), 'aaaaaa', {
        marker: { kind: 'bullet', depth: 1, index: 1, styleType },
      });
      const marker = ctx.ops.find((o) => o.op === 'fillText' && o.args[0] === glyph)!;
      expect(marker, styleType).toBeDefined();
      // x = indent − 32 + 1 = 1; same baseline as the text.
      expect(marker.args[1]).toBe(1);
      expect(marker.args[2]).toBe(13);
    }
  });

  it('ordered markers: every styleType spelling, right-aligned INTO the indent', () => {
    const cases: Array<[string, number, string]> = [
      // [styleType, index, expected text] — FakeMetrics: 10px/char.
      ['decimal', 1, '1.'],
      ['decimal', 27, '27.'],
      ['lower-alpha', 1, 'a.'],
      ['upper-alpha', 27, 'AA.'],
      ['lower-roman', 1, 'i.'],
      ['lower-roman', 4, 'iv.'],
      ['upper-roman', 9, 'IX.'],
    ];
    for (const [styleType, index, expected] of cases) {
      const ctx = paintBox(indentLine(32), 'aaaaaa', {
        marker: { kind: 'ordered', depth: 1, index, styleType },
      });
      const marker = ctx.ops.find((o) => o.op === 'fillText' && o.args[0] === expected)!;
      expect(marker, `${styleType} ${index}`).toBeDefined();
      // Right edge at indent − 2: x = 32 − 2 − width.
      expect(marker.args[1]).toBe(32 - 2 - expected.length * 10);
    }
  });

  it('the marker paints ONLY on the block’s first line (fragments stay bare)', () => {
    const ctx = makeCtx();
    const lines: LineBox[] = [
      indentLine(32, 0),
      { ...indentLine(32, 1), rect: { x: 32, y: 16, width: 40, height: 16 } },
    ];
    paintLines(ctx as unknown as CanvasRenderingContext2D, lines, [{ text: 'aaaaaa', style: STYLE }], 'aaaaaa', 0, FakeMetrics, {
      align: 'left',
      contentWidth: 624,
      runDecor: [],
      paint: { marker: { kind: 'bullet', depth: 1, index: 1, styleType: 'disc' } },
      markerStyle: MARKER_STYLE,
    });
    const bullets = ctx.ops.filter((o) => o.op === 'fillText' && o.args[0] === '•');
    expect(bullets).toHaveLength(1);
    expect(bullets[0]!.args[2]).toBe(13); // first line's baseline
  });

  it('blockquote: tinted full-width background + left border, per line', () => {
    const ctx = paintBox(indentLine(32), 'aaaaaa', { blockquote: true });
    const rects = ctx.ops.filter((o) => o.op === 'fillRect');
    // Background: (0, y, contentWidth, height); border: (4, y, 3, height).
    expect(rects[0]!.args).toEqual([0, 0, 624, 16]);
    expect(rects[1]!.args).toEqual([4, 0, 3, 16]);
    // Ink restored afterwards.
    expect(ctx.fillStyle).toBe('#000');
  });

  it('code: full-width background per line', () => {
    const ctx = paintBox({ ...indentLine(0), rect: { x: 0, y: 0, width: 60, height: 16 } }, 'aaaaaa', { code: true });
    const rects = ctx.ops.filter((o) => o.op === 'fillRect');
    expect(rects[0]!.args).toEqual([0, 0, 624, 16]);
  });

  it('rule: a 1px rule across the indent-narrowed content width', () => {
    const ctx = paintBox({ ...indentLine(0), segments: [], rect: { x: 0, y: 0, width: 0, height: 16 } }, '', { rule: true });
    const rects = ctx.ops.filter((o) => o.op === 'fillRect');
    // y = round(0 + baseline 13 × 0.55) = 7.
    expect(rects[0]!.args).toEqual([0, 7, 624, 1]);
  });

  it('no paint hints → no decor ops (plain block)', () => {
    const ctx = paintBox(indentLine(0), 'aaaaaa', undefined);
    expect(ctx.ops.filter((o) => o.op === 'fillRect')).toHaveLength(0);
    expect(ctx.ops.filter((o) => o.op === 'fillText')).toHaveLength(1);
  });
});

describe('paint: alignment (one shared offset)', () => {
  it('alignOffset: left 0, center (cw-lw)/2, right cw-lw', () => {
    expect(alignOffset('left', 80, 624)).toBe(0);
    expect(alignOffset('center', 80, 624)).toBe(272);
    expect(alignOffset('right', 80, 624)).toBe(544);
  });

  it('centered line paints at contentX + offset within the canvas', () => {
    const ctx = paint([], 'center');
    const ft = ctx.ops.find((o) => o.op === 'fillText')!;
    expect(ft.args[1]).toBe(272);
  });

  it('right-aligned line paints at the content-box right edge', () => {
    const ctx = paint([], 'right');
    expect(ctx.ops.find((o) => o.op === 'fillText')!.args[1]).toBe(544);
  });
});
