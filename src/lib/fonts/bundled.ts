/**
 * M-FONTS-A. The bundled catalog: system fallbacks + the Geist
 * Variable precedent + curated OFL families via Fontsource CSS
 * imports. The registry seeds itself from BUNDLED_FONTS at store
 * creation; these imports are what actually makes the families load in
 * the app (the Geist precedent — index.css's @fontsource-variable
 * import). files entries are the per-face CSS specifiers — also the
 * receipt keys for the on-disk bold-resolution test (each maps to
 * node_modules/@fontsource/<pkg>/files/<pkg>-latin-<w>-<s>.woff2).
 *
 * CATOLOG RULING: no Roboto (product-identity — reads as
 * default-Android; the catalog complements Geist). Manrope/Sora/
 * IBM Plex Sans took its slots. Per-family claims are exactly what
 * Fontsource ships: Fira Code, Manrope, and Sora have NO italic design
 * (verified on disk) — their entries claim only regular+bold, and the
 * dialog never previews a face they don't have.
 */

import '@fontsource-variable/geist/wght.css';
import '@fontsource/open-sans/400.css';
import '@fontsource/open-sans/400-italic.css';
import '@fontsource/open-sans/700.css';
import '@fontsource/open-sans/700-italic.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/700.css';
import '@fontsource/lora/700-italic.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/400-italic.css';
import '@fontsource/playfair-display/700.css';
import '@fontsource/playfair-display/700-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/400-italic.css';
import '@fontsource/jetbrains-mono/700.css';
import '@fontsource/jetbrains-mono/700-italic.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/source-serif-4/700-italic.css';
import '@fontsource/merriweather/400.css';
import '@fontsource/merriweather/400-italic.css';
import '@fontsource/merriweather/700.css';
import '@fontsource/merriweather/700-italic.css';
import '@fontsource/fira-code/400.css';
import '@fontsource/fira-code/700.css';
import '@fontsource/nunito/400.css';
import '@fontsource/nunito/400-italic.css';
import '@fontsource/nunito/700.css';
import '@fontsource/nunito/700-italic.css';
import '@fontsource/crimson-pro/400.css';
import '@fontsource/crimson-pro/400-italic.css';
import '@fontsource/crimson-pro/700.css';
import '@fontsource/crimson-pro/700-italic.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/400-italic.css';
import '@fontsource/ibm-plex-sans/700.css';
import '@fontsource/ibm-plex-sans/700-italic.css';
import '@fontsource/manrope/400.css';
import '@fontsource/manrope/700.css';
import '@fontsource/sora/400.css';
import '@fontsource/sora/700.css';

import type { FontEntry } from './registry';

/** The UI font (index.css precedent) — registered as a variable font:
 *  700 weights the axis; there is no static bold FILE. */
const GEIST: FontEntry = {
  id: 'bundled:geist',
  family: 'Geist Variable',
  displayName: 'Geist',
  source: 'bundled',
  variable: true,
  status: 'ready',
};

/** System fallbacks (the old FontGroup hard-coded list): no files —
 *  the OS resolves them; the browser dialog's preview DEGRADES
 *  gracefully (family string renders via whatever the system
 *  provides; on a machine without Georgia, its preview line falls
 *  back visually and that is by design). Source 'system' (the
 *  OS's families), NOT 'bundled' (Tensor's own catalog) — the source
 *  badges and filters distinguish them. */
const SYSTEM: FontEntry[] = [
  ['system-ui', 'System UI'],
  ['Arial', 'Arial'],
  ['Georgia', 'Georgia'],
  ['Times New Roman', 'Times New Roman'],
  ['Courier New', 'Courier New'],
  ['Verdana', 'Verdana'],
].map(([family, displayName]) => ({
  id: `bundled:system:${family}`,
  family,
  displayName,
  source: 'system' as const,
  status: 'ready' as const,
}));

/** Curated OFL families — files are per-face CSS specifiers matching
 *  the imports above. */
const FONTSOURCE: FontEntry[] = [
  fontsource('open-sans', 'Open Sans', { italic: true, boldItalic: true }),
  fontsource('lora', 'Lora', { italic: true, boldItalic: true }),
  fontsource('playfair-display', 'Playfair Display', { italic: true, boldItalic: true }),
  fontsource('jetbrains-mono', 'JetBrains Mono', { italic: true, boldItalic: true }),
  fontsource('source-serif-4', 'Source Serif 4', { italic: true, boldItalic: true }),
  fontsource('merriweather', 'Merriweather', { italic: true, boldItalic: true }),
  fontsource('fira-code', 'Fira Code', {}), // mono — Fontsource ships no italic
  fontsource('nunito', 'Nunito', { italic: true, boldItalic: true }),
  fontsource('crimson-pro', 'Crimson Pro', { italic: true, boldItalic: true }),
  fontsource('ibm-plex-sans', 'IBM Plex Sans', { italic: true, boldItalic: true }),
  fontsource('manrope', 'Manrope', {}), // no italic design
  fontsource('sora', 'Sora', {}), // no italic design
];

function fontsource(
  pkg: string,
  displayName: string,
  faces: { italic?: boolean; boldItalic?: boolean },
): FontEntry {
  return {
    id: `bundled:${pkg}`,
    family: displayName,
    displayName,
    source: 'bundled',
    files: {
      regular: `@fontsource/${pkg}/400.css`,
      bold: `@fontsource/${pkg}/700.css`,
      ...(faces.italic ? { italic: `@fontsource/${pkg}/400-italic.css` } : {}),
      ...(faces.boldItalic ? { boldItalic: `@fontsource/${pkg}/700-italic.css` } : {}),
    },
    status: 'ready',
  };
}

export const BUNDLED_FONTS: FontEntry[] = [GEIST, ...FONTSOURCE, ...SYSTEM];
