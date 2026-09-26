import type { TextMetrics } from '@tensor-editor/engine';

/**
 * Deterministic metrics for the integration suite (injected via the
 * PaginatedView metrics seam). Numbers chosen to tile cleanly against the
 * default Letter pageSetup (816x1056, 96px margins):
 *   content width  624px -> 62 chars/line at 16px font (10px per char)
 *   content height 864px -> 54 lines/page (16px line: 0.8+0.2 ascent/descent)
 */
export const FakeMetrics: TextMetrics = {
  measure: (text, style) => text.length * 10 * (style.fontSize / 16),
  ascent: (style) => 0.8 * style.fontSize,
  descent: (style) => 0.2 * style.fontSize,
};