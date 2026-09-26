import type { PaintedRect } from '@/lib/paginated/positionMap';
import { withAlpha } from '@/lib/colorFormat';

/** Projection of PM's selection (one div per line, partial x on the
 * selection's first/last line, full width on middles). Inside the zoom
 * transform — no compensation, per the zoom law. `color` is the user's
 * configured selection background (config.editor.selectionColor); absent
 * = the theme primary at selection opacity. A configured color always
 * paints at SELECTION_ALPHA so text under it stays readable. */
const SELECTION_ALPHA = 0.35;

export function SelectionHighlights({
  rects,
  color,
}: {
  rects: readonly PaintedRect[];
  color?: string;
}) {
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          data-testid="selection-rect"
          aria-hidden="true"
          className={`pointer-events-none absolute ${color ? '' : 'bg-primary/25'}`}
          style={{
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
            ...(color ? { backgroundColor: withAlpha(color, SELECTION_ALPHA) } : {}),
          }}
        />
      ))}
    </>
  );
}
