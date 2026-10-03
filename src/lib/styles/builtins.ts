import type { StyleDefinition, StyleProperties } from './types';

/**
 * The built-in definitions — the CODE layer of the registry merge
 * (code ← global styles.json ← per-document metadata). Seeded from
 * the values the stamp-era code hardcoded (adapter HEADING_DEFAULTS,
 * the old StylesDropdown preview classes), so the built-in rendering
 * of an unedited install is unchanged.
 *
 * 'normal' carries NO properties: its absent values fall through the
 * cascade to the config-derived baseStyle (defaultFontFamily/Size),
 * so editing config defaults keeps working, and editing 'normal'
 * itself overrides them (baseStyle := resolve('normal'), M-STYLES
 * amendment 6).
 */
export const BUILTIN_DEFINITIONS: StyleDefinition[] = [
  { id: 'normal', name: 'Normal Text', kind: 'paragraph', properties: {} },
  { id: 'heading-1', name: 'Heading 1', kind: 'paragraph', properties: { fontSize: 32, bold: true } },
  { id: 'heading-2', name: 'Heading 2', kind: 'paragraph', properties: { fontSize: 24, bold: true } },
  { id: 'heading-3', name: 'Heading 3', kind: 'paragraph', properties: { fontSize: 19, bold: true } },
  { id: 'quote', name: 'Quote', kind: 'paragraph', properties: { italic: true } },
  // M-IMAGES-1: the caption style — an ordinary built-in, editable
  // like all built-ins (the ToF #31 hook reads captions REGARDLESS of
  // the display toggle — the toggle is presentation-only, never a
  // model fact).
  { id: 'caption', name: 'Caption', kind: 'paragraph', properties: { fontSize: 12, italic: true } },
  { id: 'emphasis', name: 'Emphasis', kind: 'character', properties: { italic: true } },
  { id: 'strong', name: 'Strong', kind: 'character', properties: { bold: true } },
];

/**
 * Keyboard-only heading levels (4..6): reserved ids, not in the fixed
 * built-in list and not shown in the Dropdown — the Heading node kind
 * still produces them via Ctrl+Alt+4..6, so the resolver must have a
 * silent default for them (a warning here would fire on every
 * legitimate level-5 heading). Hand-edited entries for these ids in
 * styles.json / doc metadata MERGE NORMALLY (registry first).
 * Values are the legacy adapter HEADING_DEFAULTS, verbatim.
 */
export const LEGACY_HEADING_FALLBACK: Record<string, StyleProperties> = {
  'heading-4': { fontSize: 16, bold: true },
  'heading-5': { fontSize: 13, bold: true },
  'heading-6': { fontSize: 11, bold: true },
};

/** The one-time custom seed: the stamp-era dropdown's 'Hyperlink'
 * entry (setColor + underline) survives as a normal deletable custom
 * character style in the GLOBAL file. RULING (v1, issue #29): the
 * color is a CONCRETE HEX, not var(--primary) — canvas fillStyle
 * cannot resolve CSS variables in paginated mode. Theme-following
 * link colors are future semantic-color registry work; no per-theme
 * reseeding this milestone. '#ea580c' approximates the light-theme
 * --primary (oklch(0.64 0.19 42)) in hex.
 */
export const HYPERLINK_SEED: StyleDefinition = {
  id: 'hyperlink',
  name: 'Hyperlink',
  kind: 'character',
  properties: { color: '#ea580c', underline: true },
};

export function builtinDefinitionsById(): Record<string, StyleDefinition> {
  return Object.fromEntries(BUILTIN_DEFINITIONS.map((d) => [d.id, d]));
}
