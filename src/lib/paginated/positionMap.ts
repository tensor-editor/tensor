import type { Node as PMNode } from '@tiptap/pm/model';
import type { LayoutResult, LineBox, TextMetrics } from '@tensor-editor/engine';
import type { AdapterBlock } from './adapter';

// THE PRINCIPLE (M5): all selection state changes go through PM
// transactions — the shell never tracks its own selection. The painted
// selection, search highlights, caret, and toolbar are projections of
// PM state, exactly as tracks are a projection of the doc.
//
// This module is the bridge between PM's coordinate space and the
// engine's: PM pos <-> (block, offset-in-block) <-> LineBox ranges, and
// from there to stack-local painted rects shared by every overlay.

export type TextAlign = 'left' | 'center' | 'right';

/** THE one alignment-offset function (left/center/right; justify is
 * engine work, out of the shell). Consumed by paint, caret, selection
 * rects, and hitTest — a second derivation anywhere is the asymmetry
 * bug class this kills. */
export function alignOffset(align: TextAlign, lineWidth: number, contentWidth: number): number {
  if (align === 'center') return (contentWidth - lineWidth) / 2;
  if (align === 'right') return contentWidth - lineWidth;
  return 0;
}

export interface PaintedRect {
  pageIndex: number;
  /** Stack-local px (pre-zoom). */
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface BlockOffset {
  block: AdapterBlock;
  offset: number;
}

/** PM pos -> (block, text offset). Boundaries: pos at a block's start
 * maps to offset 0; pos at/after a block's end clamps to its text end
 * (a selection ending at the next block's start projects onto this
 * block's last position). pos before the first block maps into it. */
export function pmPosToBlockOffset(
  blocks: readonly AdapterBlock[],
  pos: number
): BlockOffset | null {
  if (blocks.length === 0) return null;
  if (pos <= blocks[0].from) return { block: blocks[0], offset: 0 };
  let lo = 0;
  let hi = blocks.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const b = blocks[mid];
    if (pos > b.from && pos <= b.to) {
      return { block: b, offset: Math.min(pos - (b.from + 1), b.text.length) };
    }
    if (pos <= b.from) hi = mid - 1;
    else lo = mid + 1;
  }
  return null;
}

export function blockOffsetToPmPos(block: AdapterBlock, offset: number): number {
  return block.from + 1 + offset;
}

/** The LineBox containing a text offset. Boundary offsets (== a line's
 * rangeStart) belong to the later line; end-of-text belongs to the last. */
export function lineForOffset(lines: readonly LineBox[], offset: number): LineBox | null {
  const first = lines[0];
  const last = lines[lines.length - 1];
  if (!first || !last) return null;
  if (offset < first.rangeStart) return first;
  if (offset >= last.rangeEnd) return last;
  for (const l of lines) {
    if (offset >= l.rangeStart && offset < l.rangeEnd) return l;
  }
  return last;
}

/** x (content-box px) of a text offset within its line, measured with
 * the same metrics instance that measured the layout. */
export function lineOffsetX(
  line: LineBox,
  block: AdapterBlock,
  offset: number,
  metrics: TextMetrics
): number {
  let x = line.rect.x;
  for (const seg of line.segments) {
    if (offset <= seg.start) break;
    const end = Math.min(offset, seg.end);
    const run = block.runs[seg.runIndex];
    if (run) x += metrics.measure(block.text.slice(seg.start, end), run.style);
    if (offset < seg.end) break;
  }
  return x;
}

/** PM range -> per-line painted rects: partial x-range on the selection's
 * first/last line, full content width on middle lines. Stack-local,
 * pre-zoom — the caller renders inside the transform (M4.2 law: no
 * compensation). */
export function textRangeLineRects(
  blocks: readonly AdapterBlock[],
  result: LayoutResult,
  from: number,
  to: number,
  metrics: TextMetrics,
  pageGap: number
): PaintedRect[] {
  if (to <= from) return [];
  const a = pmPosToBlockOffset(blocks, from);
  const b = pmPosToBlockOffset(blocks, to);
  const page0 = result.pages[0];
  if (!a || !b || !page0) return [];
  const cb = page0.contentBox;
  const stride = page0.size.height + pageGap;

  const spans: { line: LineBox; s: number; e: number; block: AdapterBlock }[] = [];
  const ai = blocks.indexOf(a.block);
  const bi = blocks.indexOf(b.block);
  for (let i = ai; i <= bi; i++) {
    const block = blocks[i];
    const startOff = i === ai ? a.offset : 0;
    const endOff = i === bi ? b.offset : block.text.length;
    if (endOff <= startOff) continue;
    for (const line of result.lines) {
      if (line.blockId !== block.id) continue;
      const s = Math.max(startOff, line.rangeStart);
      const e = Math.min(endOff, line.rangeEnd);
      if (e > s) spans.push({ line, s, e, block });
    }
  }

  return spans.map(({ line, s, e, block }, idx) => {
    const first = idx === 0;
    const last = idx === spans.length - 1;
    // Partial first/last lines ride the same alignOffset the caret and
    // hitTest use; middle lines span the full content width.
    const off = first || last ? alignOffset(block.align, line.rect.width, cb.width) : 0;
    const x1 = first || last ? off + lineOffsetX(line, block, s, metrics) : line.rect.x;
    const x2 = first || last ? off + lineOffsetX(line, block, e, metrics) : cb.width;
    return {
      pageIndex: line.pageIndex,
      left: cb.x + x1,
      top: stride * line.pageIndex + cb.y + line.rect.y,
      width: x2 - x1,
      height: line.rect.height,
    };
  });
}

export interface CaretGeometry {
  pageIndex: number;
  x: number;
  y: number;
  height: number;
}

export function caretGeometry(
  blocks: readonly AdapterBlock[],
  result: LayoutResult,
  head: number,
  metrics: TextMetrics
): CaretGeometry | null {
  const bo = pmPosToBlockOffset(blocks, head);
  if (!bo) return null;
  const lines = result.lines.filter((l) => l.blockId === bo.block.id);
  const line = lineForOffset(lines, bo.offset);
  const page0 = result.pages[0];
  if (!line || !page0) return null;
  return {
    pageIndex: line.pageIndex,
    x:
      lineOffsetX(line, bo.block, bo.offset, metrics) +
      alignOffset(bo.block.align, line.rect.width, page0.contentBox.width),
    y: line.rect.y,
    height: line.rect.height,
  };
}

export interface CaretStackRect {
  left: number;
  top: number;
  height: number;
}

/** Caret/caret-like rect in stack-local px: page stack offset + content
 * box + LineBox rect. Shared by the caret painter and the M4.2
 * caret-follow scroll — one source of this arithmetic. */
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

export interface PaintedBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function paintedBounds(rects: readonly PaintedRect[]): PaintedBounds | null {
  if (rects.length === 0) return null;
  const b: PaintedBounds = { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity };
  for (const r of rects) {
    b.left = Math.min(b.left, r.left);
    b.top = Math.min(b.top, r.top);
    b.right = Math.max(b.right, r.left + r.width);
    b.bottom = Math.max(b.bottom, r.top + r.height);
  }
  return b;
}

/** Word range around pos, from the doc model (PM ships no word utilities;
 * the legacy lesson was fighting PM's native path — here events land on
 * the painted surface, so owning the range derivation is required). */
export function wordRangeAround(doc: PMNode, pos: number): { from: number; to: number } {
  const $pos = doc.resolve(pos);
  const parentStart = $pos.start();
  const text = $pos.parent.textContent;
  const offset = pos - parentStart;
  const isWordChar = (ch: string | undefined) => !!ch && /[\p{L}\p{N}_]/u.test(ch);
  let from = offset;
  let to = offset;
  while (from > 0 && isWordChar(text[from - 1])) from--;
  while (to < text.length && isWordChar(text[to])) to++;
  return from === to ? { from: pos, to: pos } : { from: parentStart + from, to: parentStart + to };
}

export function blockRangeAround(doc: PMNode, pos: number): { from: number; to: number } | null {
  const $pos = doc.resolve(pos);
  for (let i = $pos.depth; i >= 0; i--) {
    const node = $pos.node(i);
    if (node.inlineContent) return { from: $pos.start(i), to: $pos.start(i) + node.content.size };
  }
  return null;
}
