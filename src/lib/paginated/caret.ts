import type { LayoutResult, LineBox, TextMetrics } from '@tensor-editor/engine';
import type { AdapterBlock } from './adapter';

/**
 * STEP 6 (M4): PM selection -> synthetic caret geometry, using the SAME
 * metrics instance the engine measured with (L2: ONE RealMetrics — measured
 * advance and painted caret position can never disagree).
 *
 * All coordinates are page-content-box-relative (LineBox's own frame);
 * the view adds the contentBox offset when painting.
 */

export interface CaretGeometry {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

/** Stack-absolute caret rect in LOGICAL (pre-zoom) px: page stack offset +
 * content box + LineBox rect. THE single source of this arithmetic — both
 * the caret painter and the M4.2 caret-follow scroll call this; nobody
 * re-derives it (a second derivation would drift, and a drifted scroll
 * target is exactly the legacy jump disease). */
export interface CaretStackRect {
  left: number;
  top: number;
  height: number;
}

export function caretStackRect(
  caret: CaretGeometry,
  contentX: number,
  contentY: number,
  pageHeight: number,
  pageGap: number
): CaretStackRect {
  return {
    left: contentX + caret.x,
    top: caret.pageIndex * (pageHeight + pageGap) + contentY + caret.y,
    height: caret.height,
  };
}

export function caretGeometry(
  blocks: readonly AdapterBlock[],
  result: LayoutResult,
  head: number,
  metrics: TextMetrics
): CaretGeometry | null {
  const block = blocks.find((b) => head > b.from && head <= b.to);
  if (!block) return null;

  const offset = Math.min(Math.max(head - (block.from + 1), 0), block.text.length);
  const blockLines = result.lines.filter((l) => l.blockId === block.id);
  if (blockLines.length === 0) return null;
  const last = blockLines[blockLines.length - 1];

  // Containing line: rangeStart <= offset < rangeEnd. A boundary offset
  // (== some line's rangeEnd, before end-of-text) belongs to the NEXT
  // line's start; end-of-text belongs to the last line's end.
  let line: LineBox | undefined = blockLines.find(
    (l) => offset >= l.rangeStart && offset < l.rangeEnd
  );
  if (!line) {
    if (offset >= last.rangeEnd) {
      line = last;
    } else {
      line = blockLines.find((l) => l.rangeStart === offset);
    }
  }
  if (!line) return null;

  // Caret x = measured run-prefix up to the offset, within this line.
  let x = line.rect.x;
  for (const segment of line.segments) {
    if (offset <= segment.start) break;
    const end = Math.min(offset, segment.end);
    const run = block.runs[segment.runIndex];
    if (run) {
      x += metrics.measure(block.text.slice(segment.start, end), run.style);
    }
    if (offset < segment.end) break;
  }

  return { pageIndex: line.pageIndex, x, y: line.rect.y, height: line.rect.height };
}
