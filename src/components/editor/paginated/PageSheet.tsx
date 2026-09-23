import type { ReactNode } from 'react';
import type { PageGeometry } from '@tensor-editor/engine';

interface PageSheetProps {
  geometry: PageGeometry;
  /** Stack-local top offset, logical (pre-zoom) px. */
  top: number;
  children: ReactNode;
}

/** STEP 4: one absolutely-positioned sheet per PageGeometry. All painted
 * children live inside the scaled stack, so nothing compensates for zoom. */
export function PageSheet({ geometry, top, children }: PageSheetProps) {
  return (
    <div
      data-page-index={geometry.index}
      data-testid="page-sheet"
      className="absolute left-0 bg-white shadow-lg"
      style={{ top: `${top}px`, width: `${geometry.size.width}px`, height: `${geometry.size.height}px` }}
    >
      {children}
    </div>
  );
}