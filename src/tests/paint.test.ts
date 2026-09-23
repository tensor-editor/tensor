import { describe, it, expect } from 'vitest';
import type { LineBox, Run } from '@tensor-editor/engine';
import type { RunDecor } from '@/lib/paginated/adapter';
import { paintLines } from '@/lib/paginated/paint';
import { alignOffset } from '@/lib/paginated/positionMap';
import { FakeMetrics } from './fakeMetrics';

/** M5.5 STEP 6 — paint fidelity: exact underline/strike y, highlight
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

describe('M5.5 paint: marks', () => {
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

  it('M5.6 STEP 4: a monospace-family block paints with the family in ctx.font', () => {
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

describe('M5.5 paint: alignment (one shared offset)', () => {
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
