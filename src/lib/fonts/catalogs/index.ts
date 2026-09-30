import { catalogsAllowed } from './http';
import { normalizeFamilyKey } from './normalize';
import { createGoogleSource, ensureGoogleMetadata } from './google';
import { createFontsourceSource, ensureFontsourceMetadata } from './fontsource';
import { createFontShareSource } from './fontshare';
import { ensureBrandMarks } from './brandMarks';
import type { CatalogFont, CatalogSource, CatalogId } from './types';

/**
 * The catalog index — the dialog's ONLY import surface.
 *
 * PRIVACY GATE: getCatalogSources() returns [] while the toggle is
 * OFF — the adapters are not even constructed, and the http wrapper
 * refuses every fetch besides (defense in depth). No network request
 * outside the browser's explicit actions, ever.
 *
 * FONT SQUIRREL — CUT, death certificate (verified 2026-09-29, the
 * app's reqwest path; replaces the original issue comment):
 *   API announced Dec 2010 and partially operational as of the
 *   verification: GET /api/fontlist/all served a valid 1,036-family
 *   JSON to one proxied request (receipt: {"id":"479","family_name":
 *   "1942 report",...,"family_count":"1"}), but the app's own fetch
 *   path (the linkMetadata reqwest pattern, UA "Mozilla/5.0
 *   (compatible; TensorEditor/1.0)") received HTTP 202 + 0-byte HTML
 *   on EVERY endpoint, and /api/familyinfo/<slug> + /api/download/
 *   <slug> returned empty bodies on all attempts via both paths —
 *   including while the list endpoint was still serving. The required
 *   direct-file-download verification never returned a byte.
 *   Programmatic access is offered (their own announcement — this is
 *   not scraping) but gated beyond an attributable non-browser client.
 *   Post-B probe stays but TIMEBOXED, with the CORS blocker recorded:
 *   a WebView fetch additionally needs Access-Control-Allow-Origin
 *   from a 2010 API that never sent any — expectation dead.
 */

const sourceOrder: CatalogId[] = ['google', 'fontshare', 'fontsource'];

export function getCatalogSources(): CatalogSource[] {
  if (!catalogsAllowed()) return [];
  return sourceOrder.map((id) =>
    id === 'google' ? createGoogleSource() : id === 'fontshare' ? createFontShareSource() : createFontsourceSource(),
  );
}

/** Boot prefetch when the toggle is ON (the consent ruling): both
 *  list-all catalogs warm their session caches. Failures are silent
 *  here — the search path marks sources unavailable on use. */
export async function prefetchCatalogs(): Promise<void> {
  if (!catalogsAllowed()) return;
  // Metadata lists + brand favicons — one attributable round each,
  // once per session while the user has opted in.
  await Promise.allSettled([
    ensureGoogleMetadata(),
    ensureFontsourceMetadata(),
    ensureBrandMarks(),
  ]);
}

export interface CatalogSearchResult {
  /** Deduped across sources; sources[] chips in preference order. */
  fonts: MergedCatalogFont[];
  /** Per-source availability for the muted-chip UI. */
  unavailable: CatalogId[];
}

/** A deduped entry carrying each source's OWN catalog font — the
 *  download path dispatches on the user's source choice. */
export interface MergedCatalogFont extends CatalogFont {
  perSource: Partial<Record<CatalogId, CatalogFont>>;
}

/** Search every source; merge on the normalized family key. Each
 *  source's failure degrades to a muted chip — never blocks the
 *  others (the isolation rule). */
export async function searchCatalogs(sources: CatalogSource[], q: string): Promise<CatalogSearchResult> {
  const results = await Promise.all(
    sources.map(async (source) => ({ source, fonts: await source.search(q) })),
  );
  const unavailable: CatalogId[] = results.filter((r) => !r.source.isAvailable()).map((r) => r.source.id);

  const merged = new Map<string, MergedCatalogFont>();
  for (const { source, fonts } of results) {
    for (const font of fonts) {
      const key = normalizeFamilyKey(font.family);
      const existing = merged.get(key);
      if (existing) {
        // Union the chips (preference order preserved); each source's
        // own entry rides perSource — the user's chip choice decides.
        for (const id of font.sources) {
          if (!existing.sources.includes(id)) existing.sources.push(id);
        }
        existing.perSource[source.id] ??= font;
      } else {
        merged.set(key, { ...font, key, sources: [...font.sources], perSource: { [source.id]: font } });
      }
    }
  }
  const list = [...merged.values()];
  // Entries carried by MORE sources rank first (the familiar ones).
  list.sort((a, b) => b.sources.length - a.sources.length || a.family.localeCompare(b.family));
  return { fonts: list.slice(0, 60), unavailable };
}
