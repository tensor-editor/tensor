import type { LayoutResult, LineBox, Run, TextMetrics, TextStyle } from '@tensor-editor/engine';
import type { BlockPaint, RunDecor, TextAlign } from './adapter';
import { applyVariantCaps, fontString } from './metrics';
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
 *
 * BLOCK DECOR (M6.1, paint-only — the engine ignores the hints):
 * block backgrounds/borders/rule draw per line so fragments tile
 * seamlessly across pages; list markers draw on the block's first
 * line only (this canvas holds the block start iff lines[0].lineIndex
 * is 0), in the indent gutter [indent − 32, indent) — bullets
 * left-aligned in the gutter, ordered numbers right-aligned into it.
 */

const DEFAULT_TEXT_COLOR = '#000';

/** Muted ink for non-printing-character glyphs (canvas has no theme). */
const NPC_COLOR = 'rgba(0, 0, 0, 0.45)';

/** Block-decor constants (canvas has no theme access — pageless-look
 * approximations of the prose classes). */
const QUOTE_BORDER_COLOR = '#d4d4d8';
const QUOTE_BG_COLOR = 'rgba(0, 0, 0, 0.04)';
const CODE_BG_COLOR = '#f4f4f5';
const RULE_COLOR = '#a1a1aa';
const LIST_INDENT_PX = 32;

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
  /** Block paint hints (adapter BlockPaint): list marker, blockquote
   * border/tint, rule line. Absent = plain block, nothing extra. */
  paint?: BlockPaint;
  /** The marker's font — resolved by the caller from the block's first
   * run, falling back to the document default for empty items
   * ("style from the block's runs"). */
  markerStyle?: TextStyle;
}

/** Paint-only glyph substitution: nbsp → middle-dot, tab → arrow. */
function npcSubstitute(s: string): string {
  return s.replace(/\u00A0/g, '·').replace(/\t/g, '→');
}

/** Ordered-number spelling per CSS list-style-type (the extensions'
 * value set — the M6.1 receipt). */
function orderedMarkerText(index: number, styleType: string): string {
  switch (styleType) {
    case 'lower-alpha':
      return `${toAlpha(index).toLowerCase()}.`;
    case 'upper-alpha':
      return `${toAlpha(index)}.`;
    case 'lower-roman':
      return `${toRoman(index).toLowerCase()}.`;
    case 'upper-roman':
      return `${toRoman(index)}.`;
    default:
      return `${index}.`;
  }
}

/** Bullet-glyph spelling per CSS list-style-type. */
function bulletMarkerText(styleType: string): string {
  switch (styleType) {
    case 'circle':
      return '○';
    case 'square':
      return '▪';
    default:
      return '•';
  }
}

function toAlpha(n: number): string {
  // 1-based spreadsheet spelling: 27 → AA.
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s || 'A';
}

function toRoman(n: number): string {
  const table: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let s = '';
  for (const [value, glyph] of table) {
    while (n >= value) {
      s += glyph;
      n -= value;
    }
  }
  return s || 'I';
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
  const paint = extras.paint;
  const markerStyle = extras.markerStyle;

  for (const line of lines) {
    const off = alignOffset(align, line.rect.width, contentWidth - line.rect.x);
    const baselineY = line.rect.y - minY + line.baseline;
    let x = line.rect.x + off;

    // BLOCK DECOR (before ink, per line — fragments tile seamlessly):
    if (paint?.blockquote) {
      const prev = ctx.fillStyle;
      ctx.fillStyle = QUOTE_BG_COLOR;
      ctx.fillRect(0, line.rect.y - minY, contentWidth, line.rect.height);
      ctx.fillStyle = QUOTE_BORDER_COLOR;
      ctx.fillRect(4, line.rect.y - minY, 3, line.rect.height);
      ctx.fillStyle = prev;
    }
    if (paint?.code) {
      const prev = ctx.fillStyle;
      ctx.fillStyle = CODE_BG_COLOR;
      ctx.fillRect(0, line.rect.y - minY, contentWidth, line.rect.height);
      ctx.fillStyle = prev;
    }

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
      // SMALL-CAPS (M-STYLES): the same applyVariantCaps the metrics
      // singleton used to MEASURE this run — painted advances can
      // never diverge from measured widths (the one-ruler rule).
      applyVariantCaps(ctx, run.style);
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

    // LIST MARKER (the block's first line only — the indent gutter
    // [indent − 32, indent) belongs to the item this block projects).
    // Bullets left-aligned in the gutter; ordered numbers right-aligned
    // into the indent. Style from the block's runs (markerStyle).
    const marker = paint?.marker;
    if (marker && markerStyle && line.lineIndex === 0) {
      const indent = line.rect.x;
      const markerText =
        marker.kind === 'bullet'
          ? bulletMarkerText(marker.styleType)
          : orderedMarkerText(marker.index, marker.styleType);
      const prevFill = ctx.fillStyle;
      const prevFont = ctx.font;
      ctx.font = fontString(markerStyle);
      ctx.fillStyle = DEFAULT_TEXT_COLOR;
      const w = metrics.measure(markerText, markerStyle);
      const markerX =
        marker.kind === 'bullet'
          ? indent - LIST_INDENT_PX + 1
          : indent - 2 - w;
      ctx.fillText(markerText, markerX, baselineY);
      ctx.fillStyle = prevFill;
      ctx.font = prevFont;
    }

    // RULE LINE (horizontalRule, projected as a single-line paragraph):
    // a 1px rule across the (indent-narrowed) content width, drawn at
    // the vertical middle of the line's text band.
    if (paint?.rule) {
      const prev = ctx.fillStyle;
      ctx.fillStyle = RULE_COLOR;
      const ruleY = Math.round(line.rect.y - minY + line.baseline * 0.55);
      ctx.fillRect(line.rect.x, ruleY, contentWidth - line.rect.x, 1);
      ctx.fillStyle = prev;
    }

    // Block-end pilcrow, from the block boundary: only the line whose
    // range ends at the block's text end (an empty block's zero-length
    // range qualifies — its ¶ sits at the line start). A split block's
    // earlier fragments stay bare; the final one paints it. P1: the
    // glyph renders in the block's PLAIN style — bold/italic stripped
    // (a bold paragraph's ¶ is not bold), size/family from the block's
    // effective style (markerStyle; the P1 empty-textblock projection
    // guarantees a run even for empty blocks). Hard-break glyphs have
    // no paginated model (the adapter's sentinel hands such docs to
    // the pageless CSS trick) — noted for whenever the engine grows
    // an inline-break model.
    if (npc && line.rangeEnd === text.length) {
      const restore = ctx.fillStyle;
      const restoreFont = ctx.font;
      if (markerStyle) {
        ctx.font = fontString({
          fontFamily: markerStyle.fontFamily,
          fontSize: markerStyle.fontSize,
        });
      }
      ctx.fillStyle = NPC_COLOR;
      ctx.fillText('¶', x, baselineY);
      ctx.fillStyle = restore;
      ctx.font = restoreFont;
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
