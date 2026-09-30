import { create } from 'zustand';

/**
 * M-IMAGES-0 — the ONE resolution point for media:// references.
 * Fed by unpackage on document open and (later milestones) by insert
 * paths; the save path GCs against it. This milestone wires load/save
 * only — no document content references media yet.
 */

export interface MediaEntry {
  bytes: Uint8Array;
  ext: string;
  /** Renderable URL: object URL when the platform offers it, a data
   *  URL otherwise (jsdom). The id IS the content address —
   *  media://<sha256> — so byte-identity is the identity contract. */
  url: string;
}

interface MediaState {
  entries: Map<string, MediaEntry>;
  /** Replace the store with an opened document's media set. */
  setFromUnpackage: (media: { id: string; ext: string; bytes: Uint8Array }[]) => void;
  /** Insert paths (later milestones). */
  add: (id: string, ext: string, bytes: Uint8Array) => void;
  remove: (id: string) => void;
  clear: () => void;
}

function toUrl(bytes: Uint8Array, ext: string): string {
  const type = `image/${ext}`;
  if (typeof URL.createObjectURL === 'function') {
    try {
      return URL.createObjectURL(new Blob([bytes as unknown as BlobPart], { type }));
    } catch {
      // jsdom's Blob can be half-implemented — the data URL fallback
      // below stays correct for tests either way.
    }
  }
  // No-objectURL fallback: a data URL (test-visible, not the
  // production path).
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return `data:${type};base64,${btoa(binary)}`;
}

export const useMediaStore = create<MediaState>((set) => ({
  entries: new Map(),

  setFromUnpackage: (media) => {
    const entries = new Map<string, MediaEntry>();
    for (const m of media) {
      entries.set(m.id, { bytes: m.bytes, ext: m.ext, url: toUrl(m.bytes, m.ext) });
    }
    set({ entries });
  },

  add: (id, ext, bytes) =>
    set((s) => {
      const entries = new Map(s.entries);
      entries.set(id, { bytes, ext, url: toUrl(bytes, ext) });
      return { entries };
    }),

  remove: (id) =>
    set((s) => {
      const entries = new Map(s.entries);
      entries.delete(id);
      return { entries };
    }),

  clear: () => set({ entries: new Map() }),
}));
