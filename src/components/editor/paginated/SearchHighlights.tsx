import type { PaintedRect } from '@/lib/paginated/positionMap';

/** Projection of the search plugin's match positions (read from PM
 * plugin state, mapped through positionMap). Reuses the existing search
 * token classes so painted and pageless highlights share one palette. */
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
          style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
        />
      ))}
      {current.map((r, i) => (
        <div
          key={`c${i}`}
          data-testid="search-current-rect"
          aria-hidden="true"
          className="tensor-search-match-current pointer-events-none absolute"
          style={{ left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` }}
        />
      ))}
    </>
  );
}
