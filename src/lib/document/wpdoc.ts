import { invoke } from '@tauri-apps/api/core';
import { DocumentFileSchema, type DocumentFile } from './schema';
import { useMediaStore } from '@/lib/media/store';

/**
 * M-IMAGES-0 — the .wpdoc v2 container layer.
 *
 * BREAKING FORMAT EVENT (#28 format note): v1 = a bare JSON file;
 * v2 = a zip container (document.json DEFLATED verbatim-schema +
 * manifest.json {wpdocVersion, media[]} + media/<sha256>.<ext>
 * STORED). Zero users at the event (the M2 disclaimer). The v1→v2
 * CONVERTER IS PERMANENT: v1 files open forever; saves always write
 * v2. The Rust packager is dumb — it writes exactly the media passed;
 * SAVE-TIME GC happens HERE (only document-referenced ids package).
 */

/** The not-zip marker unpackage_document returns for v1 files (the
 *  Rust constant, quoted). */
const NOT_ZIP_MARKER = 'NOT_ZIP';

export interface WireMediaFile {
  id: string;
  ext: string;
  bytesB64: string;
}

export interface UnpackResult {
  document: string;
  media: WireMediaFile[];
}

function bytesToB64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function b64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * THE V1 LEGACY CONVERTER (permanent). v1's content IS document.json's
 * schema verbatim — conversion is validation + the in-memory model;
 * the media set is empty by construction. A v1 file that fails the
 * schema throws the standard invalid-document error (the loud
 * posture) — never a silent loss.
 */
export function parseLegacyV1(raw: string): DocumentFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Corrupt v1 JSON — the same loud posture as a failed schema:
    // never a crash, never silent loss.
    throw new Error('This file is not a valid document, or was saved by an incompatible version.');
  }
  const result = DocumentFileSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error('This file is not a valid document, or was saved by an incompatible version.');
  }
  return result.data;
}

/** The v2 open path: unpackage → validate → feed the MediaStore. */
async function openV2(path: string): Promise<DocumentFile> {
  const result = await invoke<UnpackResult>('unpackage_document', { path });
  const parsed = DocumentFileSchema.safeParse(JSON.parse(result.document));
  if (!parsed.success) {
    throw new Error('This file is not a valid document, or was saved by an incompatible version.');
  }
  useMediaStore
    .getState()
    .setFromUnpackage(result.media.map((m) => ({ id: m.id, ext: m.ext, bytes: b64ToBytes(m.bytesB64) })));
  return parsed.data;
}

/** Open a .wpdoc — v2 container, or v1 plain JSON via the PERMANENT
 *  converter (detected by the unpackager's NOT_ZIP marker). Corrupted
 *  files throw (the open path's loud posture — the store surfaces the
 *  error dialog; never a crash, never silent loss). */
export async function openWpdoc(path: string): Promise<DocumentFile> {
  try {
    return await openV2(path);
  } catch (err) {
    if (String(err).includes(NOT_ZIP_MARKER)) {
      // v1: read the plain JSON and convert — forever.
      const { readTextFile } = await import('@tauri-apps/plugin-fs');
      return parseLegacyV1(await readTextFile(path));
    }
    throw err;
  }
}

/**
 * Save-time GC: collect the media ids the DOCUMENT actually
 * references (media://<sha256> in any string value) and package only
 * those. Dropped ids stay in the in-session MediaStore until it is
 * replaced on the next open — uninstall/GC of files is caller policy,
 * never the packager's.
 */
export function collectReferencedMediaIds(value: unknown, into: Set<string> = new Set()): Set<string> {
  if (typeof value === 'string') {
    if (value.startsWith('media://')) into.add(value.slice('media://'.length));
    return into;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectReferencedMediaIds(v, into);
    return into;
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value)) collectReferencedMediaIds(v, into);
  }
  return into;
}

/** The v2 save path: document JSON + REFERENCED media only. */
export async function saveWpdoc(path: string, file: DocumentFile): Promise<void> {
  const referenced = collectReferencedMediaIds(file.docJSON);
  const entries = useMediaStore.getState().entries;
  const media: WireMediaFile[] = [...entries]
    .filter(([id]) => referenced.has(id))
    .map(([id, entry]) => ({ id, ext: entry.ext, bytesB64: bytesToB64(entry.bytes) }));
  await invoke('package_document', { path, documentJson: JSON.stringify(file), media });
}
