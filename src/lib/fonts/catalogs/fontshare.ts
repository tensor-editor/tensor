import { CATALOG_LABELS, pickSlots, type CatalogFont, type CatalogSource, type CatalogDownload } from './types';
import { catalogFetchBytes, catalogFetchText } from './http';
import { normalizeFamilyKey } from './normalize';

/**
 * Font Share adapter (STEP 0b ruling).
 *
 * SEARCH: https://api.fontshare.com/v2/fonts?q=<term> — public, no
 * key (verified receipt: { fonts: [{ name, slug, category,
 * license_type, styles: [{ file: "//cdn.fontshare.com/wf/…",
 * weight.number, is_italic, is_variable }], … }] }). Per-query
 * requests are user-actioned (typing in the search box), so no boot
 * prefetch — unlike the list-all catalogs.
 *
 * DOWNLOAD: the styles' file URLs are DIRECT woff2 links
 * (protocol-relative — https: prefixed here). License metadata
 * (e.g. "itf_ffl") surfaces in the detail pane.
 */

const SEARCH_URL = 'https://api.fontshare.com/v2/fonts';

interface FontShareStyle {
  file: string;
  is_italic: boolean;
  is_variable: boolean;
  weight: { number: number };
}

interface FontShareFont {
  name: string;
  slug: string;
  category: string;
  license_type: string;
  styles: FontShareStyle[];
}

interface FontShareResponse {
  fonts: FontShareFont[];
}

function toCatalogFont(f: FontShareFont): CatalogFont {
  // M-FONTS-B.1: slots from the DECLARED styles (their weight.number),
  // never the fixed 400/700 template.
  const declared = f.styles
    .filter((s) => !s.is_variable)
    .map((s) => ({ weight: s.weight.number, style: (s.is_italic ? 'italic' : 'normal') as 'normal' | 'italic' }));
  const slots = pickSlots(declared);
  return {
    key: normalizeFamilyKey(f.name),
    family: f.name,
    displayName: f.name,
    sources: ['fontshare'],
    variable: f.styles.some((s) => s.is_variable),
    variants: [
      ...(slots.regular != null ? [{ weight: slots.regular, style: 'normal' as const }] : []),
      ...(slots.italic != null ? [{ weight: slots.italic, style: 'italic' as const }] : []),
      ...(slots.bold != null ? [{ weight: slots.bold, style: 'normal' as const }] : []),
      ...(slots.boldItalic != null ? [{ weight: slots.boldItalic, style: 'italic' as const }] : []),
    ],
    slots,
    license: f.license_type,
    ref: f,
  };
}

/** Map a style's CDN file to an A-shaped URL set (bytes fetched in
 *  download()). */
function pickStyles(font: FontShareFont): {
  variable: boolean;
  urls: { regular?: string; bold?: string; italic?: string; boldItalic?: string };
} {
  const files: { regular?: string; bold?: string; italic?: string; boldItalic?: string } = {};
  const variable = font.styles.some((s) => s.is_variable);
  for (const s of font.styles) {
    if (s.is_variable) continue; // prefer the static instances for the A shape
    const url = s.file.startsWith('//') ? `https:${s.file}` : s.file;
    if (s.is_italic) {
      if (s.weight.number === 700) files.boldItalic ??= url;
      else files.italic ??= url;
    } else if (s.weight.number === 700) files.bold ??= url;
    else files.regular ??= url;
  }
  // Variable-only families still install: the variable file IS the
  // regular face (wght axis covers bold).
  if (!files.regular) {
    const variableStyle = font.styles.find((s) => s.is_variable);
    if (variableStyle) {
      files.regular = variableStyle.file.startsWith('//')
        ? `https:${variableStyle.file}`
        : variableStyle.file;
    }
  }
  return { variable: variable && !files.bold, urls: files };
}

export function createFontShareSource(): CatalogSource {
  let available = true;
  return {
    id: 'fontshare',
    label: CATALOG_LABELS.fontshare,

    async search(q) {
      try {
        const text = await catalogFetchText(`${SEARCH_URL}?q=${encodeURIComponent(q)}&limit=20`);
        const json = JSON.parse(text) as FontShareResponse;
        available = true;
        return (json.fonts ?? []).map(toCatalogFont);
      } catch {
        available = false;
        return [];
      }
    },

    async previewBytes(entry) {
      const { urls } = pickStyles(entry.ref as FontShareFont);
      const url = urls.regular ?? urls.bold;
      if (!url) throw new Error(`no fontshare faces for ${entry.family}`);
      return catalogFetchBytes(url);
    },

    async download(entry) {
      const font = entry.ref as FontShareFont;
      const { variable, urls } = pickStyles(font);
      const files: CatalogDownload['files'] = {
        regular: await catalogFetchBytes(urls.regular ?? urls.bold ?? ''),
      };
      for (const key of ['bold', 'italic', 'boldItalic'] as const) {
        if (urls[key]) files[key] = await catalogFetchBytes(urls[key]!);
      }
      return { family: entry.family, variable, files };
    },

    isAvailable: () => available,
  };
}
