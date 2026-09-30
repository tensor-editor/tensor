import type { LineBox } from '@tensor-editor/engine';

/**
 * M-LINENUMS — pure counting. The engine emits LineBox[]; this file
 * consumes it. No engine session, no DOM, no React: numbers are
 * derived per layout call, so a mid-document edit re-numbers
 * everything after it in the SAME render (the no-debounce law).
 *
 * Modes:
 *  - 'continuous':    one counter over all lines, document order.
 *  - 'per-page':      counter resets when pageIndex changes.
 *  - 'per-paragraph': counter resets when blockId changes — a block's
 *    fragments CONTINUE across pages (the engine's lineIndex is
 *    continuous across fragments by contract, and the blockId doesn't
 *    change across the break, so the counter naturally carries over).
 *
 * Every LineBox consumes a tick — empty lines (no runs) count. countBy
 * N (>= 1) never changes the COUNTING, only the DISPLAY: a number is
 * shown when (n−1) % N === 0 (line 1 always shows), else the entry is
 * null and the gutter renders that line blank.
 */

export type LineNumberMode = 'continuous' | 'per-page' | 'per-paragraph';

export function countLineNumbers(
  lines: LineBox[],
  mode: LineNumberMode,
  countBy = 1,
): (number | null)[] {
  let counter = 0;
  let prev: { pageIndex: number; blockId: string } | null = null;

  return lines.map((line) => {
    if (
      mode === 'per-page' && prev && line.pageIndex !== prev.pageIndex
    ) {
      counter = 0;
    } else if (
      mode === 'per-paragraph' && prev && line.blockId !== prev.blockId
    ) {
      counter = 0;
    }
    counter += 1;
    prev = { pageIndex: line.pageIndex, blockId: line.blockId };
    return (counter - 1) % countBy === 0 ? counter : null;
  });
}
