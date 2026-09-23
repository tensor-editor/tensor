import type { ReactNode } from 'react';
import type { PageGeometry } from '@tensor-editor/engine';

interface PageSheetProps {
  geometry: PageGeometry;
  /** Stack-local top offset, logical (pre-zoom) px. */
  top: number;
  children: ReactNode;
}

/** STEP 4: one absolutely-positioned sheet per PageGeometry. All painted
 * children live inside the scaled stack, so nothing compensates for zoom.
 *
 * M4.1 paper visuals — styling only: white paper (#fff via bg-white),
 * 1px border-border, shadow-lg, 6px radius (pinned explicitly: this
 * theme's rounded-md computes to 8px). Every DIMENSION still comes from
 * engine geometry (inline width/height above); no CSS-computed sizes
 * anywhere. */
export function PageSheet({ geometry, top, children }: PageSheetProps) {
  return (
    <div
      data-page-index={geometry.index}
      data-testid="page-sheet"
      className="absolute left-0 rounded-[6px] border border-border bg-white shadow-lg"
      style={{ top: `${top}px`, width: `${geometry.size.width}px`, height: `${geometry.size.height}px` }}
    >
      {children}
    </div>
  );
}