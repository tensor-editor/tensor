import type { LayoutResult, TextMetrics } from '@tensor-editor/engine';
import type { AdapterBlock } from './adapter';

/**
 * M4 click hit-testing: painted-canvas point -> text offset -> PM
 * selection. This maps through the engine's POSITIONED FACTS (LineBox
 * rects/segments), NOT through the hidden PM view's DOM — per L3 the
 * hidden view is input-only, never measured, never positioned from.
 * This is the structural cure for the legacy coordsAtPos/posAtCoords
 * dead-zone disease (see docs/legacy/pagination-v1.md): there is no
 * pixel-to-position ambiguity left to correct because the ruler that
 * painted is the ruler that answers.
 *
 * Full interaction fidelity (drag, double-click, IME) is M5 — "the M5
 * hit-test fixture spec" — this file grows there.
 */

export interface HitResult {
  blockId: string;
  /** Offset into the block's concatenated run text. */
  offset: number;
}

/**
 * @param x local x relative to the page CONTENT box (logical, pre-zoom px)
 * @param y local y relative to the page CONTENT box
 */
export function hitTestPoint(
  result: LayoutResult,
  blocks: readonly AdapterBlock[],
  metrics: TextMetrics,
  pageIndex: number,
  x: number,
  y: number
): HitResult | null {
  const pageLines = result.lines.filter((l) => l.pageIndex === pageIndex);
  if (pageLines.length === 0) return null;

  let line = pageLines.find((l) => y >= l.rect.y && y < l.rect.y + l.rect.height);
  if (!line) {
    // Above the first line or below the last: clamp to the nearest end.
    if (y < pageLines[0].rect.y) {
      return { blockId: pageLines[0].blockId, offset: pageLines[0].rangeStart };
    }
    line = pageLines[pageLines.length - 1];
    return { blockId: line.blockId, offset: line.rangeEnd };
  }

  const block = blocks.find((b) => b.id === line!.blockId);
  if (!block) return null;

  let offset = line.rangeStart;
  let cursor = line.rect.x;
  for (const segment of line.segments) {
    const run = block.runs[segment.runIndex];
    if (!run) continue;
    for (let i = segment.start; i < segment.end; i++) {
      const width = metrics.measure(block.text[i]!, run.style);
      if (x < cursor + width / 2) {
        return { blockId: line!.blockId, offset: i };
      }
      cursor += width;
    }
    offset = segment.end;
  }
  return { blockId: line.blockId, offset };
}