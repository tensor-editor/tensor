/**
 * M-IMAGES-2 — the shared media bitmap cache. One resolution point for
 * CANVAS painting (the paginated inline draws + the ImageLayer): the
 * MediaStore owns the bytes/URLs; this module owns the DECODED
 * HTMLImageElements, loaded lazily per sha, with a version counter so
 * paint surfaces repaint exactly once when a bitmap lands (the
 * M-IMAGES-1 arrival law — one repaint, no relayout).
 */

const bitmapCache = new Map<string, HTMLImageElement>();
const pendingLoads = new Map<string, Array<() => void>>();
let bitmapVersion = 0;
const versionListeners = new Set<() => void>();

function loadBitmap(sha: string, url: string): void {
  if (bitmapCache.has(sha) || pendingLoads.has(sha)) return;
  const queue: Array<() => void> = [];
  pendingLoads.set(sha, queue);
  const img = new Image();
  img.onload = () => {
    bitmapCache.set(sha, img);
    pendingLoads.delete(sha);
    bitmapVersion += 1;
    for (const fn of versionListeners) fn();
    for (const done of queue) done();
  };
  img.onerror = () => {
    pendingLoads.delete(sha); // stays a tinted placeholder forever
  };
  img.src = url;
}

/** The decoded bitmap for a sha, or undefined (paint the tint). */
export function getBitmap(sha: string): HTMLImageElement | undefined {
  return bitmapCache.get(sha);
}

/** Kick a load for every unresolved-but-stored media sha. */
export function ensureBitmap(sha: string, url: string): void {
  loadBitmap(sha, url);
}

/**
 * The PAINT-TIME resolver (M-IMAGES-2.1): the bitmap when decoded;
 * otherwise KICKS the load from the MediaStore URL (if the media is
 * in the store) and returns undefined — the placeholder branch is
 * for THIS pending state only, never a permanent state: when the load
 * lands, bitmapVersion bumps and the subscribers repaint once (the
 * arrival law — one paint, no relayout).
 */
export function resolveMediaBitmap(sha: string): HTMLImageElement | undefined {
  const cached = bitmapCache.get(sha);
  if (cached) return cached;
  const url = mediaStoreUrlRef(sha);
  if (url) loadBitmap(sha, url);
  return undefined;
}

// Bound at module init (no cycle: the store does not import this
// module).
import { useMediaStore } from './store';
const mediaStoreUrlRef: (sha: string) => string | undefined = (sha) =>
  useMediaStore.getState().entries.get(sha)?.url;

/** Subscribe to bitmap arrivals (repaint-once surfaces). */
export function subscribeBitmaps(fn: () => void): () => void {
  versionListeners.add(fn);
  return () => {
    versionListeners.delete(fn);
  };
}

export function bitmapVersionNow(): number {
  return bitmapVersion;
}

/** TEST SEAM: jsdom never fires img.onload — resolve a sha manually. */
export const __bitmapTestSeam = {
  resolve(sha: string, img: HTMLImageElement): void {
    bitmapCache.set(sha, img);
    pendingLoads.delete(sha);
    bitmapVersion += 1;
    for (const fn of versionListeners) fn();
  },
  clear(): void {
    bitmapCache.clear();
    pendingLoads.clear();
    bitmapVersion += 1;
    for (const fn of versionListeners) fn();
  },
};
