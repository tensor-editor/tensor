import { create } from 'zustand';
import { catalogsAllowed, catalogFetchBytes } from './http';
import type { CatalogId } from './types';

/**
 * M-FONTS-B — runtime brand marks for the catalog sources: fetch each
 * service's favicon ONCE at boot while the metadata prefetch warms
 * (only while allowFontCatalogs is ON — the same consent; the user
 * already allows outbound requests to these services). Keeps the mark
 * in sync with whatever icon the service itself uses.
 *
 * ALL catalog marks come from the same source — each service's own
 * favicon, fetched once per session at boot (receipts, the app's
 * reqwest path): www.google.com/favicon.ico → HTTP 200,
 * image/x-icon, 5,430 bytes (the four-color G favicon — fonts.google
 * .com/favicon.ico 404s, so the parent domain serves the mark);
 * fontsource.org/favicon.ico → HTTP 200, image/vnd.microsoft.icon,
 * 15,086 bytes; www.fontshare.com/favicon.ico (and /favicon.svg,
 * /static/…) → 691 bytes of HTML — the SPA serves no static icon to
 * non-JS clients. Byte-sniffing validates every response (HTML bodies
 * are NOT marks) and rejects failures → the fallback mark shows, by
 * the same isolation posture as any third party. When Font Share
 * serves a real favicon, the brand mark lights up with zero code
 * changes.
 */

const FAVICON_URLS: Record<CatalogId, string> = {
  google: 'https://www.google.com/favicon.ico',
  fontshare: 'https://www.fontshare.com/favicon.ico',
  fontsource: 'https://fontsource.org/favicon.ico',
};

/** data-URL per source once fetched; absent = fallback icon.
 *  Reactive (zustand): components subscribe with useBrandMark, so a
 *  mark arriving AFTER first paint swaps the fallback icon out
 *  immediately — the "plain text G instead of the logo" class of
 *  staleness. */
const useBrandMarkStore = create<{ marks: Partial<Record<CatalogId, string>> }>(() => ({
  marks: {},
}));
/** Attempted within the current ensure round — retried on the NEXT
 *  ensureBrandMarks() when the mark is still missing, so a failed or
 *  HTML-body boot fetch never pins the fallback icon for a whole
 *  session (the staleness fix): the font browser retries on open,
 *  which is an explicit user action. */
const attempted = new Set<CatalogId>();

/** Magic-byte sniff — the honest favicon check (content, not URL). */
function sniffMime(bytes: Uint8Array): string | null {
  if (bytes.length < 4) return null;
  const [a, b, c, d] = [bytes[0], bytes[1], bytes[2], bytes[3]];
  if (a === 0x00 && b === 0x00 && c === 0x01 && d === 0x00) return 'image/x-icon';
  if (a === 0x89 && b === 0x50 && c === 0x4e && d === 0x47) return 'image/png';
  if (a === 0x47 && b === 0x49 && c === 0x46) return 'image/gif';
  if (a === 0xff && b === 0xd8) return 'image/jpeg';
  if (a === 0x3c && (bytes[1] === 0x73 || bytes[1] === 0x3f)) return 'image/svg+xml'; // '<s' | '<?'
  return null;
}

function toDataUrl(bytes: Uint8Array, mime: string): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `data:${mime};base64,${btoa(binary)}`;
}

/** Fetch any still-missing marks. Called at boot (prefetchCatalogs)
 *  and on every font-browser open (user action) — a mark that failed
 *  once gets retried, so the fallback icon is always temporary.
 *  Failures stay silent — the fallback icon is the design. */
export async function ensureBrandMarks(): Promise<void> {
  if (!catalogsAllowed()) return;
  await Promise.allSettled(
    (Object.keys(FAVICON_URLS) as CatalogId[]).map(async (id) => {
      if (useBrandMarkStore.getState().marks[id]) return; // have it
      if (attempted.has(id)) return; // in-flight or failed this round
      attempted.add(id);
      try {
        const bytes = await catalogFetchBytes(FAVICON_URLS[id]!);
        const mime = sniffMime(bytes);
        if (mime) {
          useBrandMarkStore.setState((s) => ({ marks: { ...s.marks, [id]: toDataUrl(bytes, mime) } }));
        } else {
          attempted.delete(id); // HTML shell — retry on the next ensure
        }
      } catch {
        attempted.delete(id); // network flake — retry on the next ensure
      }
    }),
  );
}

/** The fetched mark as a data URL, or null → render the fallback.
 *  REACTIVE hook — components re-render when the mark lands. */
export function useBrandMark(id: CatalogId): string | null {
  return useBrandMarkStore((s) => s.marks[id] ?? null);
}

/** Non-hook read (tests). */
export function brandMarkUrl(id: CatalogId): string | null {
  return useBrandMarkStore.getState().marks[id] ?? null;
}

/** TEST SEAM. */
export function resetBrandMarksForTests(): void {
  useBrandMarkStore.setState({ marks: {} });
  attempted.clear();
}
