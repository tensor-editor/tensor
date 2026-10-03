import type { Editor } from '@tiptap/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readFile } from '@tauri-apps/plugin-fs';
import { useMediaStore } from './store';

/**
 * M-IMAGES-1 — THE insertion pipeline (all three insert paths land
 * here: file picker, drag-and-drop, clipboard paste). bytes → sha256
 * (WebCrypto subtle.digest — the content-address contract) →
 * MediaStore.register → natural dims → insert the node. The node
 * NEVER holds bytes or data URLs — refs only.
 *
 * EXTERNAL URLs (an http(s) image pasted in) are NOT fetched silently:
 * the deliberate-action dialog (the fonts privacy precedent) — the
 * user confirms "Download and embed", or the paste is refused with
 * ZERO network calls.
 */

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', bytes as unknown as ArrayBuffer);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Natural dims decode — the receipt: createImageBitmap PRIMARY (the
 * platform decoder, any format the webview supports), with a PURE
 * PNG-IHDR fallback (bytes 16..24, big-endian) for environments
 * without ImageBitmap (jsdom tests; also the most common container
 * format in practice). Whichever decodes first wins; neither ever
 * fabricates numbers.
 */
export async function decodeImageSize(
  bytes: Uint8Array,
  ext: string,
): Promise<{ width: number; height: number }> {
  if (typeof createImageBitmap === 'function') {
    const blob = new Blob([bytes as unknown as BlobPart], { type: `image/${ext}` });
    const bitmap = await createImageBitmap(blob);
    const size = { width: bitmap.width, height: bitmap.height };
    bitmap.close?.();
    return size;
  }
  const png = pngIhdrSize(bytes);
  if (png) return png;
  throw new Error(`cannot decode image dims for .${ext} in this environment`);
}

/** Pure PNG IHDR read: signature(8) + len(4) + 'IHDR'(4) → width,height
 *  big-endian at offsets 16..24. Testable with fixture bytes. */
export function pngIhdrSize(bytes: Uint8Array): { width: number; height: number } | null {
  const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.length < 24) return null;
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== PNG_SIG[i]) return null;
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    width: view.getUint32(16),
    height: view.getUint32(20),
  };
}

export async function insertImageBytes(
  editor: Editor | null,
  bytes: Uint8Array,
  ext: string,
): Promise<boolean> {
  if (!editor) return false;
  const id = await sha256Hex(bytes);
  useMediaStore.getState().add(id, ext, bytes);
  const { width, height } = await decodeImageSize(bytes, ext);
  return editor
    .chain()
    .focus()
    .insertContent({ type: 'image', attrs: { src: `media://${id}`, width, height, alt: '' } })
    .run();
}

/** The Insert > Image path: OS picker → binary read (the fs
 *  capability fonts-A opened) → the pipeline. */
export async function insertImageFromPicker(editor: Editor | null): Promise<boolean> {
  const path = await openDialog({
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
    multiple: false,
  });
  if (!path || Array.isArray(path)) return false;
  const ext = (path.split('.').pop() ?? 'png').toLowerCase();
  const bytes = await readFile(path);
  return insertImageBytes(editor, bytes, ext === 'jpeg' ? 'jpeg' : ext);
}

/** Drop + paste: the browser already HAS the bytes — a Blob, no fs
 *  round-trip. */
export async function insertImageBlob(editor: Editor | null, blob: Blob): Promise<boolean> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const ext = (blob.type.split('/')[1] ?? 'png').toLowerCase();
  return insertImageBytes(editor, bytes, ext === 'jpeg' ? 'jpeg' : ext);
}

// ─── The external-URL refusal (M-IMAGES-1.5) ────────────────────────────
//
// An http(s) image pasted in is REFUSED — no download arm, no dialog:
// the document holds internal media:// refs only, and no network call
// ever fires from a paste (the fonts privacy precedent, hardened).
// The refusal is a TOAST (useToast in the paste handler).
export function isExternalImageUrl(src: string): boolean {
  return /^https?:\/\//i.test(src);
}
