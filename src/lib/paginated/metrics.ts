import type { TextMetrics, TextStyle } from '@tensor-editor/engine';

/**
 * THE ONE-RULER RULE: ONE RealMetrics instance is the app's
 * single measurement authority. The engine's line/walk caches are keyed on
 * block content and never invalidated by metrics identity (consequence:
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
 * advances can never diverge. Style/weight/size/family, full TextStyle.
 * fontVariant is deliberately NOT in the string: it is a separate
 * canvas property (fontVariantCaps) applied by applyVariantCaps, and
 * it participates in every measurement cache key — small-cap glyphs
 * measure narrower than full caps, so a variant edit must re-measure. */
export function fontString(style: TextStyle): string {
  return `${style.italic ? 'italic ' : ''}${style.bold ? '700 ' : ''}${style.fontSize}px ${style.fontFamily}`;
}

/**
 * SMALL-CAPS (M-STYLES addendum 3), paint-level. RECEIPT: the canvas
 * 2D context's `fontVariantCaps` property (HTML spec: "the font-caps
 * to apply") — Chromium and Gecko support it; WebKit support exists in
 * modern WebKit (Safari 17+/WebKitGTK 2.4x-era builds) but OLDER
 * WebKitGTK (the Tauri Linux webview on distros shipping older
 * webkit2gtk) does NOT implement it, silently ignoring the assignment.
 * FALLBACK: feature-detected once per context — if the assignment does
 * not read back, we paint full-case glyphs (graceful: layout and paint
 * both used the same measured widths, so nothing misaligns) and warn
 * ONCE in dev. The alternative (faking small-caps by substituting
 * downcased smaller caps) is banned: it would change glyph advances
 * without a measurement story.
 */
let variantCapsSupport: boolean | null = null;
let warnedNoVariantCaps = false;

export function applyVariantCaps(ctx: CanvasRenderingContext2D, style: TextStyle): void {
  if (style.fontVariant !== 'small-caps') {
    ctx.fontVariantCaps = 'normal';
    return;
  }
  if (variantCapsSupport === null) {
    try {
      ctx.fontVariantCaps = 'small-caps';
      variantCapsSupport = ctx.fontVariantCaps === 'small-caps';
    } catch {
      variantCapsSupport = false;
    }
  }
  if (variantCapsSupport) {
    ctx.fontVariantCaps = 'small-caps';
  } else if (!warnedNoVariantCaps) {
    warnedNoVariantCaps = true;
    if (import.meta.env.DEV) {
      console.warn(
        '[metrics] canvas fontVariantCaps unsupported in this webview (WebKitGTK builds may lack it) — ' +
          'small-caps text paints with full-case glyphs; layout/paint stay consistent (same widths)'
      );
    }
  }
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
    const font = fontString(style);
    const key = `${font}\u0000${style.fontVariant ?? ''}`;
    let cached = verticalCache.get(key);
    if (!cached) {
      ctx.font = font;
      applyVariantCaps(ctx, style);
      // P1 RECEIPT + RULING: the pre-P1 code measured
      // actualBoundingBoxAscent/Descent of 'Hg' — the INK extent of two
      // specific glyphs (cap-height to the g's descender, typically
      // ~0.72em + ~0.21em) — which made every line box shorter than
      // the font's own line box and let tall glyphs (or the CSS
      // 'normal' line box) visually collide with neighbors.
      // fontBoundingBoxAscent/Descent is the FULL font box — the
      // convention behind CSS 'normal' line-height — so lines measure
      // slightly taller (the exact delta is font-dependent; verify in
      // the running app — jsdom has no canvas). Fallbacks approximate
      // the font box (~0.8em ascent / ~0.2em descent), then the legacy
      // ink-box numbers for engines without either.
      const m = ctx.measureText('Hg');
      cached = {
        ascent:
          m.fontBoundingBoxAscent ||
          m.actualBoundingBoxAscent ||
          style.fontSize * 0.8,
        descent:
          m.fontBoundingBoxDescent ||
          m.actualBoundingBoxDescent ||
          style.fontSize * 0.2,
      };
      verticalCache.set(key, cached);
    }
    return cached;
  }

  return {
    measure(text, style) {
      const font = fontString(style);
      const key = `${font}\u0000${style.fontVariant ?? ''}\u0000${text}`;
      const hit = widthCache.get(key);
      if (hit !== undefined) return hit;
      ctx.font = font;
      applyVariantCaps(ctx, style);
      const width = ctx.measureText(text).width;
      if (widthCache.size >= WIDTH_CACHE_MAX) widthCache.clear();
      widthCache.set(key, width);
      return width;
    },
    ascent: (style) => vertical(style).ascent,
    descent: (style) => vertical(style).descent,
  };
}
