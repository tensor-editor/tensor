import type { LayoutResult, LineBox, Run, TextMetrics } from '@tensor-editor/engine';
import type { RunDecor, TextAlign } from './adapter';
import { fontString } from './metrics';
import { alignOffset } from './positionMap';

/**
 * Painting LineBox[] onto a per-block-per-page canvas.
 * L1: the shell paints, never computes — every coordinate here comes from
 * the engine's positioned facts (LineBox.rect/baseline/segments); nothing
 * is re-derived or re-measured except glyph advances, which go through
 * the SAME metrics instance the engine measured with (widths painted ==
 * widths measured, by construction).
 *
 * Text color, highlight, underline, and strike ride the segments'
 * run decor (adapter RunDecor); alignment rides the same shared
 * alignOffset the caret and hitTest use. ctx.font comes from the one
 * shared fontString (metrics.ts).
 */

const DEFAULT_TEXT_COLOR = '#000';

/** Muted ink for non-printing-character glyphs (canvas has no theme). */
const NPC_COLOR = 'rgba(0, 0, 0, 0.45)';

export interface PaintExtras {
  align: TextAlign;
  contentWidth: number;
  runDecor: readonly RunDecor[];
  /**
   * NON-PRINTING CHARACTERS (M6, paint-only v1): ¶ at every block
   * end (from the block's text boundary — an empty block paints it at
   * the line start), middle-dot for non-breaking spaces, arrow for
   * tabs. OFF unless explicitly set: the on-screen painter passes the
   * user's config toggle (config.editor.showNonPrintingChars); NO
   * print/export path passes it (none exists today — .wpdoc export
   * serializes document JSON, never pixels). Glyph substitution is
   * INK only: x still advances by the MEASURED layout widths, so
   * painted positions never move. Hard breaks have no paginated model
   * (the adapter throws loudly and falls back to pageless, whose CSS
   * trick keeps showing them); list-marker glyphs are M6-proper scope.
   */
  npc?: boolean;
}

/** Paint-only glyph substitution: nbsp → middle-dot, tab → arrow. */
function npcSubstitute(s: string): string {
  return s.replace(/\u00A0/g, '·').replace(/\t/g, '→');
}

export function paintLines(
  ctx: CanvasRenderingContext2D,
  lines: readonly LineBox[],
  runs: readonly Run[],
  text: string,
  minY: number,
  metrics: TextMetrics,
  extras: PaintExtras
): void {
  const align = extras.align;
  const contentWidth = extras.contentWidth;
  const runDecor = extras.runDecor;
  const npc = extras.npc === true;

  for (const line of lines) {
    // The line's own width sets its align offset — same function the
    // caret/hitTest/selection use, no second derivation.
    const off = alignOffset(align, line.rect.width, contentWidth);
    const baselineY = line.rect.y - minY + line.baseline;
    let x = line.rect.x + off;

    for (const segment of line.segments) {
      const run = runs[segment.runIndex];
      if (!run) continue;
      const decor = runDecor[segment.runIndex] ?? {};
      const segmentText = text.slice(segment.start, segment.end);
      const width = metrics.measure(segmentText, run.style);

      if (decor.highlight) {
        const ascent = metrics.ascent(run.style);
        const descent = metrics.descent(run.style);
        ctx.fillStyle = decor.highlight;
        ctx.fillRect(x, baselineY - ascent, width, ascent + descent);
      }

      ctx.fillStyle = decor.color ?? DEFAULT_TEXT_COLOR;
      ctx.font = fontString(run.style);
      ctx.fillText(npc ? npcSubstitute(segmentText) : segmentText, x, baselineY);

      // TODO(typographic polish): proper underline/strike metrics per
      // font (nskipping ink gaps, weight-scaled thickness) — the
      // typographic-fraction approximations below are the honest
      // starting point.
      const decorationColor = decor.color ?? DEFAULT_TEXT_COLOR;
      if (decor.underline || decor.strike) {
        const thickness = Math.max(1, Math.round(run.style.fontSize / 16));
        ctx.fillStyle = decorationColor;
        if (decor.underline) {
          ctx.fillRect(x, baselineY + 0.08 * run.style.fontSize, width, thickness);
        }
        if (decor.strike) {
          ctx.fillRect(x, baselineY - 0.3 * run.style.fontSize, width, thickness);
        }
      }

      x += width;
    }

    // Block-end pilcrow, from the block boundary: only the line whose
    // range ends at the block's text end (an empty block's zero-length
    // range qualifies — its ¶ sits at the line start). A split
    // block's earlier fragments stay bare; the final one paints it.
    if (npc && line.rangeEnd === text.length) {
      const restore = ctx.fillStyle;
      ctx.fillStyle = NPC_COLOR;
      ctx.fillText('¶', x, baselineY);
      ctx.fillStyle = restore;
    }
  }
}

/**
 * Dev-only contiguity assertion: LineBox rects must tile the page
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
