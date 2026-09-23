import type { TextMetrics, TextStyle } from '@tensor-editor/engine';

/**
 * THE ONE-RULER RULE (M4 proposal): ONE RealMetrics instance is the app's
 * single measurement authority. The engine's line/walk caches are keyed on
 * block content and never invalidated by metrics identity (M3 consequence:
 * "new metrics requires a new engine") — so a second, differently-warm
 * metrics instance paired with a cached engine would silently produce
 * parity-violating layout. Paint (fillText positioning) goes through the
 * SAME instance so measured widths and painted advances can never diverge.
 *
 * L1: the engine computes, never paints; the shell paints, never computes.
 * RealMetrics is the port through which the shell lends the engine its
 * canvas — measurement only, no layout decisions here.
 *
 * NOTE (font loading): callers must gate the FIRST layout on
 * document.fonts.ready — measurements taken before webfonts load would be
 * cached by the engine against fallback-font widths for the session. The
 * PaginatedView does this gating.
 */

/** THE one font-string builder — RealMetrics measures with it and the
 * track painter sets ctx.font from it, so measured widths and painted
 * advances can never diverge. Style/weight/size/family, full TextStyle. */
export function fontString(style: TextStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.fontSize}px ${style.fontFamily}`;
}

let singleton: TextMetrics | null = null;

/** The app-wide single measurement authority (see module comment). */
export function getRealMetrics(): TextMetrics {
  if (!singleton) singleton = createRealMetrics();
  return singleton;
}

function createRealMetrics(): TextMetrics {
  const canvas = document.createElement('canvas');
  const maybeCtx = canvas.getContext('2d');
  if (!maybeCtx) throw new Error('RealMetrics requires a 2D canvas context');
  const ctx = maybeCtx;

  // Memoization is the production metrics implementation's job
  // (engine/src/types.ts TextMetrics contract) — the engine never caches.
  const verticalCache = new Map<string, { ascent: number; descent: number }>();
  const widthCache = new Map<string, number>();
  const WIDTH_CACHE_MAX = 20_000;

  function vertical(style: TextStyle): { ascent: number; descent: number } {
    const key = fontString(style);
    let cached = verticalCache.get(key);
    if (!cached) {
      ctx.font = key;
      // 'Hg' spans cap height and descender — a stable vertical
      // representative for the style. actualBoundingBox* is unsupported in
      // ancient engines; approximate rather than fail.
      const m = ctx.measureText('Hg');
      cached = {
        ascent: m.actualBoundingBoxAscent || style.fontSize * 0.8,
        descent: m.actualBoundingBoxDescent || style.fontSize * 0.2,
      };
      verticalCache.set(key, cached);
    }
    return cached;
  }

  return {
    measure(text, style) {
      const key = `${fontString(style)}\u0000${text}`;
      const hit = widthCache.get(key);
      if (hit !== undefined) return hit;
      ctx.font = fontString(style);
      const width = ctx.measureText(text).width;
      if (widthCache.size >= WIDTH_CACHE_MAX) widthCache.clear();
      widthCache.set(key, width);
      return width;
    },
    ascent: (style) => vertical(style).ascent,
    descent: (style) => vertical(style).descent,
  };
}
