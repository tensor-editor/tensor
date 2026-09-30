/**
 * M-FONTS-B — the online catalog seam. A's registerFont() is the
 * install API; B adds: search, preview, download, register.
 *
 * RESEARCH RULINGS (receipts in the M-FONTS-B plan/report):
 *  - Google Fonts: metadata via fonts.google.com/metadata/fonts
 *    (boot prefetch when the toggle is ON — the consent ruling),
 *    files via the css2 API's latin-subset @font-face URLs.
 *  - Font Share: api.fontshare.com/v2/fonts (search + direct woff2).
 *  - Fontsource: api.fontsource.org/v1/fonts metadata (boot prefetch,
 *    same consent pattern) + cdn.jsdelivr.net file URLs — no tarball
 *    parsing, no third Rust command. The adapter's value is the
 *    uniques Google doesn't carry (Geist is the existence proof; most
 *    families dedupe against Google — two chips, harmless by design).
 *  - Font Squirrel: CUT (death certificate in this file's index.ts).
 *
 * PRIVACY: privacy.allowFontCatalogs gates ALL of it. OFF → the
 * browser shows installed + upload only, adapters never constructed,
 * zero fetches. ON → search activates. No network request outside the
 * browser's explicit actions, ever.
 */

export type CatalogId = 'google' | 'fontshare' | 'fontsource';

export const CATALOG_LABELS: Record<CatalogId, string> = {
  google: 'Google Fonts',
  fontshare: 'Font Share',
  fontsource: 'Fontsource',
};

/** The byte-level download a catalog can provide for one family,
 *  shaped to land directly on A's FontEntry.files (bytes — the
 *  registry writes them into appDataDir()/fonts/ and records names). */
export interface CatalogDownload {
  /** CSS family name (the editable confirm dialog may change it). */
  family: string;
  variable: boolean;
  files: { regular: Uint8Array; bold?: Uint8Array; italic?: Uint8Array; boldItalic?: Uint8Array };
}

export interface CatalogSource {
  id: CatalogId;
  label: string;
  /** Search must never throw — failures degrade to an empty result
   *  and mark the source unavailable (the isolation rule: one dead
   *  third party must never notice first, nor block the others). */
  search(q: string): Promise<CatalogFont[]>;
  /** One regular-face file's bytes — for the lazy single-slot preview. */
  previewBytes(entry: CatalogFont): Promise<Uint8Array>;
  /** All faces the family offers, as bytes. */
  download(entry: CatalogFont): Promise<CatalogDownload>;
  /** False after a failed request this session — the UI mutes the
   *  chip. Resets on next attempt. */
  isAvailable(): boolean;
}

export interface CatalogFont {
  /** normalizeFamilyKey(family) — the cross-source dedupe key. */
  key: string;
  family: string;
  displayName: string;
  sources: CatalogId[];
  variable: boolean;
  variants?: { weight: number; style: 'normal' | 'italic' }[];
  /** The declared A-slot faces — request/download builders consume
   *  these, never a fixed template (M-FONTS-B.1). */
  slots?: VariantSlots;
  license?: string;
  /** Script direction for the LTR/RTL badge — derived from the
   *  source's subsets (arabic/hebrew → rtl); default ltr. */
  direction?: 'ltr' | 'rtl';
  /** Implementation detail for the adapter's own download path. */
  ref?: unknown;
}

/** arabic/hebrew subsets → rtl; everything else ltr. */
export function directionFromSubsets(subsets: readonly string[]): 'ltr' | 'rtl' {
  return subsets.some((s) => s === 'arabic' || s === 'hebrew') ? 'rtl' : 'ltr';
}

/**
 * M-FONTS-B.1 — the A-slot faces a family DECLARES. Variant requests
 * build ONLY from these (never a fixed template): regular = 400 when
 * offered, else the lowest declared normal weight; bold = 700 only
 * when declared (the A no-synthetic rule already renders families
 * without bold); italics likewise. A 400-only family downloads
 * exactly one regular face.
 */
export interface VariantSlots {
  regular?: number;
  bold?: number;
  italic?: number;
  boldItalic?: number;
}

export function pickSlots(declared: { weight: number; style: 'normal' | 'italic' }[]): VariantSlots {
  const normals = declared.filter((v) => v.style === 'normal').map((v) => v.weight).sort((a, b) => a - b);
  const italics = declared.filter((v) => v.style === 'italic').map((v) => v.weight).sort((a, b) => a - b);
  return {
    regular: normals.includes(400) ? 400 : normals[0],
    bold: normals.includes(700) ? 700 : undefined,
    italic: italics.length ? (italics.includes(400) ? 400 : italics[0]) : undefined,
    boldItalic: italics.includes(700) ? 700 : undefined,
  };
}
