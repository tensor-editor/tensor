import { memo, useLayoutEffect, useRef } from 'react';
import type { LineBox, Run, TextMetrics } from '@tensor-editor/engine';
import type { RunDecor, TextAlign } from '@/lib/paginated/adapter';
import { paintLines } from '@/lib/paginated/paint';

interface BlockCanvasProps {
  /** One block's LineBoxes on ONE page, document order. */
  lines: readonly LineBox[];
  runs: readonly Run[];
  text: string;
  metrics: TextMetrics;
  /** Absolute placement inside the page sheet (content-box derived). */
  left: number;
  top: number;
  width: number;
  align: TextAlign;
  runDecor: readonly RunDecor[];
}

/**
 * The per-block-per-page paint surface. DPR-scaled canvas; one
 * fillText per LineSegment so bold/italic survive wrapping.
 *
 * DIRTY-BLOCK REPAINT, NO REBUILD PER KEYSTROKE: the
 * engine shares frozen LineBox objects zero-copy across layout calls,
 * so reference equality IS the dirty bit.
 *
 * DAMAGE-ONLY RASTER: on a single-block text edit, the
 * damage is from the first changed line to the end of the block's
 * fragment on this page (a re-wrap moves everything below). Only that
 * region is cleared and redrawn; identical lines above the edit keep
 * their pixels. Falls back to full repaint on canvas resize, first-line
 * edits, or style changes (the fallback cost = the old behavior).
 */
export const BlockCanvas = memo(function BlockCanvas({ lines, runs, text, metrics, left, top, width, align, runDecor }: BlockCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevLinesRef = useRef<readonly LineBox[] | null>(null);
  const prevTextRef = useRef('');
  const prevBoxRef = useRef('');

  const first = lines[0];
  const last = lines[lines.length - 1];
  const height = last.rect.y + last.rect.height - first.rect.y;

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const decorKey = runDecor.map((d) => `${d.color}|${d.highlight}|${d.underline}|${d.strike}`).join(';');
    const boxKey = `${left}|${top}|${width}|${align}|${decorKey}`;
    const unchanged =
      prevBoxRef.current === boxKey &&
      prevTextRef.current === text &&
      prevLinesRef.current !== null &&
      prevLinesRef.current.length === lines.length &&
      lines.every((l, i) => l === prevLinesRef.current![i]);
    if (unchanged) return;

    // Benchmark seams: paint execution time + px² rasterized.
    const __w = globalThis as {
      __benchPaints?: { paints: Array<{ at: number; blockId: string; px2?: number }> };
    };
    (__w.__benchPaints ??= { paints: [] }).paints.push({ at: performance.now(), blockId: lines[0].blockId });

    const dpr = window.devicePixelRatio || 1;
    const newW = Math.max(1, Math.round(width * dpr));
    const newH = Math.max(1, Math.round(height * dpr));

    // DAMAGE-ONLY: if the canvas bitmap size and placement are unchanged,
    // and the text change starts beyond the first line, only clear and
    // redraw from the first changed line down.
    let damageFrom = 0;
    if (
      canvas.width === newW &&
      canvas.height === newH &&
      prevBoxRef.current === boxKey &&
      prevTextRef.current &&
      prevTextRef.current !== text
    ) {
      const oldText = prevTextRef.current;
      let firstDiff = 0;
      const common = Math.min(oldText.length, text.length);
      while (firstDiff < common && oldText[firstDiff] === text[firstDiff]) firstDiff++;
      damageFrom = lines.findIndex((l) => firstDiff < l.rangeEnd);
      if (damageFrom < 0) damageFrom = 0;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    if (damageFrom > 0) {
      // Damage-only: clear from the first changed line's top to the
      // canvas bottom, redraw those lines (same coordinate space).
      const damageTop = lines[damageFrom].rect.y - first.rect.y;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, damageTop, width, height - damageTop);
      paintLines(ctx, lines.slice(damageFrom), runs, text, first.rect.y, metrics, { align, contentWidth: width, runDecor });
      // Receipt: px² actually rasterized (cleared + repainted region).
      __w.__benchPaints!.paints[__w.__benchPaints!.paints.length - 1].px2 = width * (height - damageTop);
    } else {
      // Full repaint (canvas resize, edit at line 0, style change, or
      // initial mount) — same as the previous behavior.
      canvas.width = newW;
      canvas.height = newH;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      paintLines(ctx, lines, runs, text, first.rect.y, metrics, { align, contentWidth: width, runDecor });
      // Receipt: full canvas.
      __w.__benchPaints!.paints[__w.__benchPaints!.paints.length - 1].px2 = width * height;
    }

    prevLinesRef.current = lines;
    prevTextRef.current = text;
    prevBoxRef.current = boxKey;
  }, [lines, runs, text, metrics, left, top, width, height, first.rect.y, align, runDecor]);

  return (
    <canvas
      ref={canvasRef}
      data-block-id={lines[0].blockId}
      role="presentation"
      className="absolute"
      style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    />
  );
});