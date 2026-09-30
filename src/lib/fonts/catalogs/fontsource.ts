import { CATALOG_LABELS, directionFromSubsets, pickSlots, type CatalogFont, type CatalogSource, type CatalogDownload } from './types';
import { catalogFetchBytes, catalogFetchText } from './http';
import { normalizeFamilyKey } from './normalize';

/**
 * Fontsource adapter — RE-PRICED as browsed catalog #3 (the M-FONTS-B
 * amendment replacing A's INSTALL-ONLY ruling): the tarball concern
 * dissolved once the jsDelivr file CDN is the download path.
 *
 * METADATA (receipt, fetched via the app's reqwest path):
 *   https://api.fontsource.org/v1/fonts — HTTP 200 application/json,
 *   538,887 bytes, an array of 2,100 entries:
 *   {"id":"42dot-sans","family":"42dot Sans","subsets":["korean","latin"],
 *    "weights":[300,400,...],"styles":["normal"],"defSubset":"latin",
 *    "variable":true,"lastModified":"2025-06-02","category":"sans-serif",
 *    "license":"OFL-1.1","type":"google"}
 * Boot prefetch when the toggle is ON — the Google-metadata consent
 * pattern, verbatim (session cache, client-side search + dedupe).
 *
 * FILES (receipt, same path): direct CDN URLs return real bytes —
 *   https://cdn.jsdelivr.net/npm/@fontsource/roboto/files/
 *   roboto-latin-400-normal.woff2 → HTTP 200 font/woff2, 21,884
 *   bytes, verified WOFF2. No tarball parsing, no new Rust command.
 *   Variable families ship as @fontsource-variable/<id>/files/
 *   <id>-latin-wght-normal.woff2 — mapping to A's FontEntry.variable.
 *
 * COVERAGE NOTE (the badge tooltip + issue-comment wording): most
 * Fontsource families dedupe against Google (two chips — harmless by
 * design); the adapter's value is the ~120 uniques Google doesn't
 * carry. Geist — Tensor's own bundled UI font — is the existence
 * proof and the continuity: A's bundled catalog ships via Fontsource
 * already.
 *
 * ISOLATION: jsDelivr/npm failures degrade to "source unavailable"
 * per the adapter-isolation rule — same posture as any third party.
 */

const METADATA_URL = 'https://api.fontsource.org/v1/fonts';
const CDN_BASE = 'https://cdn.jsdelivr.net/npm';

interface FontsourceFont {
  id: string;
  family: string;
  subsets?: string[];
  weights: number[];
  styles: string[];
  defSubset: string;
  variable: boolean;
  license: string;
  type: string;
}

let metadataCache: FontsourceFont[] | null = null;
let metadataPromise: Promise<FontsourceFont[]> | null = null;

export async function ensureFontsourceMetadata(): Promise<FontsourceFont[]> {
  if (metadataCache) return metadataCache;
  if (metadataPromise) return metadataPromise;
  metadataPromise = (async () => {
    const text = await catalogFetchText(METADATA_URL);
    metadataCache = JSON.parse(text) as FontsourceFont[];
    return metadataCache;
  })();
  try {
    return await metadataPromise;
  } catch (err) {
    metadataPromise = null;
    throw err;
  }
}

/** The jsDelivr URL for one face — the receipt-verified pattern. */
export function fontsourceFileUrl(font: FontsourceFont, weight: number, style: 'normal' | 'italic'): string {
  const scope = font.variable ? '@fontsource-variable' : '@fontsource';
  // Variable packages carry the wght AXIS in the filename, not a
  // weight (verified against the installed @fontsource-variable/geist
  // package's own files: geist-latin-wght-normal.woff2).
  const weightOrAxis = font.variable ? 'wght' : String(weight);
  return `${CDN_BASE}/${scope}/${font.id}/files/${font.id}-${font.defSubset}-${weightOrAxis}-${style}.woff2`;
}

function toCatalogFont(f: FontsourceFont): CatalogFont {
  // M-FONTS-B.1: slots built from the DECLARED weights/styles arrays
  // — never the fixed 400/700 template.
  const declared = f.weights.flatMap((weight) =>
    f.styles.map((style) => ({ weight, style: style as 'normal' | 'italic' })),
  );
  const slots = pickSlots(declared);
  return {
    key: normalizeFamilyKey(f.family),
    family: f.family,
    displayName: f.family,
    sources: ['fontsource'],
    variable: f.variable,
    variants: [
      ...(slots.regular != null ? [{ weight: slots.regular, style: 'normal' as const }] : []),
      ...(slots.italic != null ? [{ weight: slots.italic, style: 'italic' as const }] : []),
      ...(slots.bold != null ? [{ weight: slots.bold, style: 'normal' as const }] : []),
      ...(slots.boldItalic != null ? [{ weight: slots.boldItalic, style: 'italic' as const }] : []),
    ],
    slots,
    license: f.license,
    direction: directionFromSubsets(f.subsets ?? []),
    ref: f,
  };
}

export function createFontsourceSource(): CatalogSource {
  let available = true;
  return {
    id: 'fontsource',
    label: CATALOG_LABELS.fontsource,

    async search(q) {
      try {
        const list = await ensureFontsourceMetadata();
        const needle = q.trim().toLowerCase();
        const out: CatalogFont[] = [];
        for (const f of list) {
          if (needle && !f.family.toLowerCase().includes(needle)) continue;
          out.push(toCatalogFont(f));
        }
        available = true;
        return out.slice(0, 50);
      } catch {
        available = false;
        return [];
      }
    },

    async previewBytes(entry) {
      const font = entry.ref as FontsourceFont;
      // The DECLARED regular slot (a family without 400 — or with a
      // different only-weight — previews its real face).
      const weight = entry.slots?.regular ?? font.weights[0] ?? 400;
      return catalogFetchBytes(fontsourceFileUrl(font, weight, 'normal'));
    },

    async download(entry) {
      const font = entry.ref as FontsourceFont;
      const slots = entry.slots ?? pickSlots(font.weights.flatMap((weight) => font.styles.map((style) => ({ weight, style: style as 'normal' | 'italic' }))));
      // The DECLARED regular slot — never a fixed 400 (M-FONTS-B.1).
      const files: CatalogDownload['files'] = {
        regular: await catalogFetchBytes(fontsourceFileUrl(font, slots.regular ?? font.weights[0] ?? 400, 'normal')),
      };
      // A variable family installs as ONE variable face (the wght
      // axis covers bold — A's two-worlds rule); static families get
      // exactly the slot faces they declare.
      if (font.variable) {
        if (slots.italic != null) {
          files.italic = await catalogFetchBytes(fontsourceFileUrl(font, slots.italic, 'italic'));
        }
      } else {
        if (slots.bold != null) {
          files.bold = await catalogFetchBytes(fontsourceFileUrl(font, slots.bold, 'normal'));
        }
        if (slots.italic != null) {
          files.italic = await catalogFetchBytes(fontsourceFileUrl(font, slots.italic, 'italic'));
        }
        if (slots.boldItalic != null) {
          files.boldItalic = await catalogFetchBytes(fontsourceFileUrl(font, slots.boldItalic, 'italic'));
        }
      }
      return { family: entry.family, variable: font.variable, files };
    },

    isAvailable: () => available,
  };
}

/** TEST SEAM: drop the session metadata cache (isolation between
 *  tests; never called by app code). */
export function resetForTests(): void {
  metadataCache = null;
  metadataPromise = null;
}
