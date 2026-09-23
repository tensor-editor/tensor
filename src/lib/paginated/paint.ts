import type { LayoutResult, LineBox, Run, TextMetrics } from '@tensor-editor/engine';
import { fontString } from './metrics';

/**
 * STEP 5 (M4): painting LineBox[] onto a per-block-per-page canvas.
 * L1: the shell paints, never computes — every coordinate here comes from
 * the engine's positioned facts (LineBox.rect/baseline/segments); nothing
 * is re-derived or re-measured except glyph advances, which go through
 * the SAME metrics instance the engine measured with (widths painted ==
 * widths measured, by construction).
 */

export function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly LineBox[],
  runs: readonly Run[],
  text: string,
  minY: number,
  metrics: TextMetrics
): void {
  ctx.fillStyle = '#000';
  for (const line of lines) {
    let x = line.rect.x;
    const baselineY = line.rect.y - minY + line.baseline;
    for (const segment of line.segments) {
      const run = runs[segment.runIndex];
      if (!run) continue;
      const segmentText = text.slice(segment.start, segment.end);
      ctx.font = fontString(run.style);
      ctx.fillText(segmentText, x, baselineY);
      x += metrics.measure(segmentText, run.style);
    }
  }
}

/**
 * Dev-only contiguity assertion (STEP 5): LineBox rects must tile the page
 * content box with no seams — each page's lines, in document order, run
 * y=0, y+height, y+height+height... The walk machine guarantees this by
 * construction (the y cursor only resets at a page close); this assert is
 * the tripwire if that invariant ever breaks. Runs under vitest too
 * (import.meta.env.DEV is true there) — test (a) pins it.
 */
export function assertContiguity(result: LayoutResult): void {
  if (!import.meta.env.DEV) return;
  for (let p = 0; p < result.pages.length; p++) {
    let expectedY = 0;
    for (const line of result.lines) {
      if (line.pageIndex !== p) continue;
      if (line.rect.y !== expectedY) {
        console.error(
          `[paginated] contiguity violated on page ${p}: line y=${line.rect.y}, expected ${expectedY}`
        );
      }
      expectedY = line.rect.y + line.rect.height;
    }
  }
}
