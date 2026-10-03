import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { PageGeometry, PlacedRect } from '@tensor-editor/engine';
import { useMediaStore } from '@/lib/media/store';
import {
  bitmapVersionNow,
  ensureBitmap,
  getBitmap,
  subscribeBitmaps,
} from '@/lib/media/bitmapCache';

/**
 * M-IMAGES-1 — the paginated image paint: consumes placed[] (the
 * engine's placement facts — the shell never computes image geometry;
 * fit-down/align math already happened engine-side) and draws each
 * image at its placed rect via ctx.drawImage, on a DPR-scaled canvas
 * inside the zoom transform — exactly like BlockCanvas, a sibling
 * surface merged by (pageIndex, rect.y).
 *
 * ASYNC BITMAP: geometry is KNOWN immediately (placed[]) — the tinted
 * placeholder paints first, and the real bitmap paints ONE canvas pass
 * when its decode lands (no relayout — display-only arrival). Media
 * still loading at startup (the store fills asynchronously from the
 * container) shows the same tint.
 */

/** Pre-roundRect path builder (the feature-detect fallback). */
function pathRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r);
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h);
  ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}


interface ImageLayerProps {
  geometry: PageGeometry;
  /** This page's placed images (document order). */
  placed: readonly PlacedRect[];
  /** M-IMAGES-1.5: corner radius per blockId (paint-only, from the
   *  node attrs — NEVER engine geometry; identity changes per attr
   *  write so flips repaint without any epoch). */
  radii: ReadonlyMap<string, number>;
}

/** Sibling of BlockCanvas INSIDE the sheet (page-relative coords — the
 *  sheet owns the stack offset). */
export function ImageLayer({ geometry, placed, radii }: ImageLayerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [, forceRepaint] = useState(0);
  const versionRef = useRef(bitmapVersionNow());

  // Subscribe: a bitmap landing anywhere repaints every layer once.
  useEffect(
    () =>
      subscribeBitmaps(() => {
        if (versionRef.current !== bitmapVersionNow()) {
          versionRef.current = bitmapVersionNow();
          forceRepaint((v) => v + 1);
        }
      }),
    []
  );

  // Kick loads for any unresolved-but-stored media (startup pending).
  useEffect(() => {
    for (const p of placed) {
      const sha = p.src.startsWith('media://') ? p.src.slice('media://'.length) : null;
      if (!sha || getBitmap(sha)) continue;
      const entry = useMediaStore.getState().entries.get(sha);
      if (entry) ensureBitmap(sha, entry.url);
    }
  }, [placed]);

  // LAYOUT effect — BlockCanvas paints in one too; the flush order is
  // then the MOUNT order (the paint-order receipt's basis).
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || placed.length === 0) return;
    const dpr = typeof window !== 'undefined' && window.devicePixelRatio ? window.devicePixelRatio : 1;
    canvas.width = Math.round(geometry.size.width * dpr);
    canvas.height = Math.round(geometry.size.height * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    void radii;
    for (const p of placed) {
      const { x, y, width, height } = p.rect;
      const px = geometry.contentBox.x + x;
      const py = geometry.contentBox.y + y;
      // M-IMAGES-1.5: corner radius — PAINT-ONLY clip. Clamped to half
      // the min placed dim (the registry's law mirrored at paint); 0 =
      // no clip at all (the common case stays a plain drawImage).
      const rawRadius = radii.get(p.blockId) ?? 0;
      const radius = Math.max(0, Math.min(rawRadius, Math.floor(Math.min(width, height) / 2)));
      if (radius > 0) {
        ctx.save();
        if (typeof ctx.roundRect === 'function') {
          ctx.beginPath();
          ctx.roundRect(px, py, width, height, radius);
          ctx.clip();
        } else {
          // Pre-roundRect fallback: manual path (same geometry).
          ctx.beginPath();
          pathRoundedRect(ctx, px, py, width, height, radius);
          ctx.clip();
        }
      }
      const sha = p.src.startsWith('media://') ? p.src.slice('media://'.length) : null;
      const bitmap = sha ? getBitmap(sha) : undefined;
      if (bitmap) {
        ctx.drawImage(bitmap, px, py, width, height);
      } else {
        // The tinted placeholder — identical geometry to the future
        // bitmap (placed[] owns the numbers).
        ctx.fillStyle = 'rgba(0,0,0,0.08)';
        ctx.fillRect(px, py, width, height);
      }
      if (radius > 0) ctx.restore();
    }
  });

  if (placed.length === 0) return null;
  return (
    <canvas
      data-testid="image-layer"
      data-page-index={geometry.index}
      ref={canvasRef}
      className="pointer-events-none absolute left-0"
      style={{ top: 0, width: `${geometry.size.width}px`, height: `${geometry.size.height}px` }}
    />
  );
}
