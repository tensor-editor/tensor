import type { ReactNode } from 'react';
import type { PageGeometry } from '@tensor-editor/engine';

interface PageSheetProps {
  geometry: PageGeometry;
  /** Stack-local top offset, logical (pre-zoom) px. */
  top: number;
  /** IntersectionObserver registration for virtualization. */
  observeRef?: (el: HTMLDivElement | null) => void;
  /** Per-document page background color; absent = white. */
  background?: string;
  children: ReactNode;
}

/** STEP 4: one absolutely-positioned sheet per PageGeometry. All painted
 * children live inside the scaled stack, so nothing compensates for zoom.
 *
 * M4.1 paper visuals — styling only: white paper (or the document's
 * pageColor via the background prop), 1px border-border, shadow-lg,
 * 6px radius. Every DIMENSION still comes from engine geometry. */
export function PageSheet({ geometry, top, observeRef, background, children }: PageSheetProps) {
  return (
    <div
      ref={observeRef}
      data-page-index={geometry.index}
      data-testid="page-sheet"
      role="presentation"
      className={`absolute left-0 rounded-[6px] border border-border shadow-lg ${background ? '' : 'bg-white'}`}
      style={{
        top: `${top}px`,
        width: `${geometry.size.width}px`,
        height: `${geometry.size.height}px`,
        ...(background ? { backgroundColor: background } : {}),
      }}
    >
      {children}
    </div>
  );
}