import type { LayoutResult, TextMetrics } from '@tensor-editor/engine';
import type { AdapterBlock } from './adapter';
import { alignOffset } from './positionMap';

// THE NEAREST-LINE RULE (from the legacy dead-zone fixtures): clicks
// resolve to the nearest line WITHIN the nearest sheet — a click in a
// page margin or the inter-sheet gap clamps to that sheet's nearest
// line, and x beyond a line's end resolves to that line's end position.
// The spacer/gap geometry that made the legacy clicks ambiguous no
// longer exists; this is clamping, never correction.

export interface HitResult {
  blockId: string;
  /** Offset into the block's concatenated run text. */
  offset: number;
}

/** @param localX/localY stack-local (pre-zoom) px. */
export function hitTest(
  result: LayoutResult,
  blocks: readonly AdapterBlock[],
  metrics: TextMetrics,
  pageGap: number,
  localX: number,
  localY: number
): HitResult | null {
  const page0 = result.pages[0];
  if (!page0) return null;
  const pageH = page0.size.height;
  const stride = pageH + pageGap;
  const cb = page0.contentBox;

  let pageIndex = Math.floor(localY / stride);
  // Gap ownership: the second half of a gap belongs to the next sheet.
  if (localY - pageIndex * stride > pageH + pageGap / 2 && pageIndex < result.pages.length - 1) {
    pageIndex += 1;
  }
  pageIndex = Math.min(Math.max(pageIndex, 0), result.pages.length - 1);

  const pageLines = result.lines.filter((l) => l.pageIndex === pageIndex);
  if (pageLines.length === 0) return null;

  const first = pageLines[0];
  const last = pageLines[pageLines.length - 1];
  const y = localY - pageIndex * stride - cb.y;
  if (y < first.rect.y) return { blockId: first.blockId, offset: first.rangeStart };
  if (y >= last.rect.y + last.rect.height) return { blockId: last.blockId, offset: last.rangeEnd };

  // Lines tile the content box (contiguity invariant) — exactly one
  // contains y; the fallback only guards a broken invariant.
  const line = pageLines.find((l) => y >= l.rect.y && y < l.rect.y + l.rect.height) ?? last;

  const block = blocks.find((b) => b.id === line.blockId);
  if (!block) return null;
  const x = localX - cb.x;
  // Same offset the painter and caret use — the nearest-line rule stays
  // symmetric with the painted geometry for aligned lines.
  let cursor = line.rect.x + alignOffset(block.align, line.rect.width, cb.width);
  for (const seg of line.segments) {
    const run = block.runs[seg.runIndex];
    if (!run) continue;
    for (let i = seg.start; i < seg.end; i++) {
      const w = metrics.measure(block.text[i]!, run.style);
      if (x < cursor + w / 2) return { blockId: line.blockId, offset: i };
      cursor += w;
    }
  }
  return { blockId: line.blockId, offset: line.rangeEnd };
}
