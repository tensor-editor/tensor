import { useEffect, useRef } from 'react';
import type { LineBox, Run, TextMetrics } from '@tensor-editor/engine';
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
}

/**
 * STEP 5: the per-block-per-page paint surface. DPR-scaled canvas; one
 * fillText per LineSegment so bold/italic survive wrapping (each segment
 * carries its own run style).
 *
 * DIRTY-BLOCK REPAINT, NO REBUILD PER KEYSTROKE: the engine shares frozen
 * LineBox objects ZERO-COPY across layout calls (M3 — cached placements
 * emit the same objects), so reference equality IS the dirty bit. A block
 * whose LineBoxes are all reference-identical to the previous paint, with
 * unchanged text, is skipped entirely. The canvas DOM node itself is
 * never recreated for an existing (page, block) pair — React keys hold.
 */
export function BlockCanvas({ lines, runs, text, metrics, left, top, width }: BlockCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const prevLinesRef = useRef<readonly LineBox[] | null>(null);
  const prevTextRef = useRef('');
  const prevBoxRef = useRef('');

  const first = lines[0];
  const last = lines[lines.length - 1];
  const height = last.rect.y + last.rect.height - first.rect.y;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const boxKey = `${left}|${top}|${width}`;
    const unchanged =
      prevBoxRef.current === boxKey &&
      prevTextRef.current === text &&
      prevLinesRef.current !== null &&
      prevLinesRef.current.length === lines.length &&
      lines.every((l, i) => l === prevLinesRef.current![i]);
    if (unchanged) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    paintLines(ctx, lines, runs, text, first.rect.y, metrics);

    prevLinesRef.current = lines;
    prevTextRef.current = text;
    prevBoxRef.current = boxKey;
  }, [lines, runs, text, metrics, left, top, width, height, first.rect.y]);

  return (
    <canvas
      ref={canvasRef}
      data-block-id={lines[0].blockId}
      role="presentation"
      className="absolute"
      style={{ left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` }}
    />
  );
}