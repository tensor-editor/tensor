import type { PaintedRect } from '@/lib/paginated/positionMap';

/**
 * Projection of the search plugin's match positions (read from PM
 * plugin state, mapped through positionMap). FIND-HIGHLIGHT GEOMETRY
 * (P1): the rects arrive as the matched TEXT EXTENT
 * (baseline−ascent .. baseline+descent — positionMap's
 * textRangeTextExtents), NOT the leading box, so adjacent
 * non-matching lines show no highlight bleed. The fill is
 * SEMI-TRANSPARENT (~0.3 alpha) over the existing theme color — the
 * matched text stays readable through the highlight (a different
 * feature with different geometry than selection, which keeps the
 * full leading box by standing ruling).
 */
const FIND_HIGHLIGHT_ALPHA = '0.3';

export function SearchHighlights({
  matches,
  current,
}: {
  matches: readonly PaintedRect[];
  current: readonly PaintedRect[];
}) {
  return (
    <>
      {matches.map((r, i) => (
        <div
          key={`m${i}`}
          data-testid="search-rect"
          aria-hidden="true"
          className="tensor-search-match pointer-events-none absolute"
          style={{
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
            backgroundColor: 'var(--color-search-highlight)',
            opacity: FIND_HIGHLIGHT_ALPHA,
          }}
        />
      ))}
      {current.map((r, i) => (
        <div
          key={`c${i}`}
          data-testid="search-current-rect"
          aria-hidden="true"
          className="tensor-search-match-current pointer-events-none absolute"
          style={{
            left: `${r.left}px`,
            top: `${r.top}px`,
            width: `${r.width}px`,
            height: `${r.height}px`,
            backgroundColor: 'var(--color-search-current)',
            opacity: FIND_HIGHLIGHT_ALPHA,
          }}
        />
      ))}
    </>
  );
}
