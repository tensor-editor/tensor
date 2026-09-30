import { enqueuePreview } from './previewQueue';

/**
 * The lazy preview face (STEP 2): download the real font file ONLY
 * for the entry under active preview — a temporary FontFace scoped to
 * the dialog, never the whole list. On release the face is deleted
 * from document.fonts (A's face-replace pattern). Byte downloads ride
 * the single-slot queue (deliberate-action rate limiting).
 */

const PREVIEW_PREFIX = 'TensorPreview-';

let previewFace: FontFace | null = null;
/** The alias the preview element should render with (test seam). */
let currentAlias: string | null = null;

export async function loadPreviewFace(
  key: string,
  fetchBytes: () => Promise<Uint8Array>,
): Promise<string | null> {
  releasePreviewFace();
  const FontFaceCtor = (
    globalThis as { FontFace?: new (family: string, source: ArrayBuffer) => FontFace }
  ).FontFace;
  if (typeof FontFaceCtor !== 'function' || typeof document === 'undefined' || !document.fonts) {
    return null; // degrade: the preview renders with the system substitute
  }
  try {
    const bytes = await enqueuePreview(fetchBytes);
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const alias = `${PREVIEW_PREFIX}${key}`;
    const face = new FontFaceCtor(alias, buffer);
    document.fonts.add(face);
    await face.load();
    previewFace = face;
    currentAlias = alias;
    return alias;
  } catch {
    releasePreviewFace();
    return null;
  }
}

export function releasePreviewFace(): void {
  if (previewFace) {
    document.fonts?.delete(previewFace);
    previewFace = null;
  }
  currentAlias = null;
}

export function previewAlias(): string | null {
  return currentAlias;
}
