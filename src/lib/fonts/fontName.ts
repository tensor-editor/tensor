/**
 * M-FONTS-A. Minimal sfnt 'name'-table reader — the family name for an
 * uploaded .ttf/.otf, without a parsing dependency (no fontkit/
 * opentype.js in the tree — the receipt that motivated this file).
 *
 * Scope is deliberately tiny: find the 'name' table in the sfnt
 * directory, read name records for nameID 1 (family) and 16
 * (typographic family — preferred: it groups styles under one family
 * where nameID 1 splits them, e.g. "Roboto" vs "Roboto Condensed").
 * Returns null for anything else (woff2's brotli stream is NOT free
 * to parse — those uploads fall back to the filename convention).
 */

const SFNT_MAGIC = new Set([0x00010000, 0x74727565, 0x4f54544f]); // 1.0, 'true', 'OTTO'
const TAG_NAME = 0x6e616d65; // 'name'

const PLATFORM_UNICODE = 0;
const PLATFORM_WINDOWS = 3;
const WIN_ENCODING_UCS2 = 1;
const WIN_ENCODING_UCS4 = 10;

function decodeString(
  view: DataView,
  offset: number,
  length: number,
  unicode: boolean,
): string {
  const out: string[] = [];
  if (unicode) {
    for (let i = 0; i + 1 < length; i += 2) {
      out.push(String.fromCharCode(view.getUint16(offset + i)));
    }
  } else {
    for (let i = 0; i < length; i++) {
      out.push(String.fromCharCode(view.getUint8(offset + i)));
    }
  }
  return out.join('');
}

/** The font's family name, or null when the bytes aren't a parseable
 *  sfnt .ttf/.otf. Pure — no platform I/O. */
export function parseFontFamilyName(bytes: Uint8Array): string | null {
  if (bytes.byteLength < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (!SFNT_MAGIC.has(view.getUint32(0))) return null;

  const numTables = view.getUint16(4);
  for (let t = 0; t < numTables; t++) {
    const record = 12 + t * 16;
    if (record + 16 > view.byteLength) return null;
    if (view.getUint32(record) !== TAG_NAME) continue;

    const tableOffset = view.getUint32(record + 8);
    if (tableOffset + 6 > view.byteLength) return null;
    const count = view.getUint16(tableOffset + 2);
    const stringOffset = view.getUint16(tableOffset + 4);

    let family: string | null = null; // nameID 1
    let typographic: string | null = null; // nameID 16 (preferred)
    for (let r = 0; r < count; r++) {
      const rec = tableOffset + 6 + r * 12;
      if (rec + 12 > view.byteLength) break;
      const platformId = view.getUint16(rec);
      const encodingId = view.getUint16(rec + 2);
      const nameId = view.getUint16(rec + 6);
      if (nameId !== 1 && nameId !== 16) continue;
      const unicode =
        platformId === PLATFORM_UNICODE ||
        (platformId === PLATFORM_WINDOWS &&
          (encodingId === WIN_ENCODING_UCS2 || encodingId === WIN_ENCODING_UCS4));
      const strOffset = tableOffset + stringOffset + view.getUint16(rec + 10);
      const strLength = view.getUint16(rec + 8);
      if (strOffset + strLength > view.byteLength) continue;
      const text = decodeString(view, strOffset, strLength, unicode);
      if (!text) continue;
      if (nameId === 16) typographic ??= text;
      else family ??= text;
    }
    return typographic || family;
  }
  return null;
}
