import type { PaintedRect } from '@/lib/paginated/positionMap';

/** Projection of PM's selection (one div per line, partial x on the
 * selection's first/last line, full width on middles). Inside the zoom
 * transform — no compensation, per the M4.2 law. */
export function SelectionHighlights({ rects }: { rects: readonly PaintedRect[] }) {
  return (
    <>
      {rects.map((r, i) => (
        <div
          key={i}
          data-testid="selection-rect"
          aria-hidden="true"
          className="pointer-events-none absolute bg-primary/25"
          style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
        />
      ))}
    </>
  );
}
