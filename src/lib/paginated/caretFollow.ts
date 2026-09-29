import { getScrollParent } from '@/lib/editor/domUtils';
import type { CaretStackRect } from './positionMap';

/**
 * THE SCROLL SPEC (minimal-edge caret-follow, engine-driven):
 *
 *   Scroll moves ONLY when a caret motion would clip the caret, and then
 *   only by the minimal delta that reveals it. No snapping, no
 *   re-centering, never on layout churn without caret motion.
 *
 * - TRIGGER: PM's own intent signal, nothing else. PM invokes
 *   view.scrollToSelection() only for transactions carrying its
 *   scrollIntoView flag (tr.scrollIntoView() — set by PM's own key/input
 *   handling on caret motion); ScrollGuardExtension routes that call here
 *   in paginated mode and BLOCKS PM's native default, which would scroll
 *   to coordsAtPos on the hidden input-only view (L3 — meaningless
 *   geometry). No intent signal → this function is never called → no
 *   scroll, ever. Layout churn (pageSetup flip, zoom change, relayout)
 *   dispatches no such transaction, so churn never moves the desk.
 * - COORDINATES: the caret rect in container coords = caretStackRect
 *   (page stack offset + LineBox rect — the SAME function the caret
 *   painter uses; never re-derived), × zoom, + the stack's live
 *   getBoundingClientRect offset (which includes the scale transform, so
 *   the ×zoom here is the only zoom math this file does).
 * - PADDING: a caret rect padded by CARET_SCROLL_PAD_PX that intersects
 *   the scroller's visible rect scrolls NOTHING. A bottom-edge violation
 *   scrolls down by exactly caretBottom − viewportBottom + pad; a
 *   top-edge violation symmetrically up. Clipped horizontally? NEVER for
 *   now — the horizontal seam (mirroring the two vertical arms) is left
 *   for RTL / extreme-zoom edge cases, deliberately.
 * - INSTANT: direct scrollTop mutation, no smooth behavior — Word-style;
 *   revisit later.
 */
export const CARET_SCROLL_PAD_PX = 16;

export function scrollCaretIntoView(
  stack: HTMLElement,
  caret: CaretStackRect,
  zoom: number
): void {
  const scroller = getScrollParent(stack);
  if (!scroller) return;

  const stackRect = stack.getBoundingClientRect();
  const viewRect = scroller.getBoundingClientRect();

  const top = stackRect.top + caret.top * zoom;
  const bottom = top + caret.height * zoom;

  if (bottom > viewRect.bottom - CARET_SCROLL_PAD_PX) {
    scroller.scrollTop += bottom + CARET_SCROLL_PAD_PX - viewRect.bottom;
  } else if (top < viewRect.top + CARET_SCROLL_PAD_PX) {
    scroller.scrollTop -= viewRect.top + CARET_SCROLL_PAD_PX - top;
  }
  // Intersects the visible rect (padded): scrollTop untouched.
}