import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { ImageNodeView } from '@/components/editor/ImageNodeView';

/**
 * M-IMAGES-1 — the image model.
 *
 * CUSTOM NODE, not @tiptap/extension-image (the divergence receipt):
 * the stock extension ships a paragraph-grouped node whose attrs are
 * just {src, alt, title} aimed at external/data URLs, renders via
 * plain renderHTML with no size control, and parses pasted HTML <img>
 * on sight. Tensor needs: (a) src as an INTERNAL 'media://<sha256>'
 * ref — never a URL the document reaches out to; (b) REQUIRED
 * width/height document data (the engine's ImageBlock contract:
 * "intrinsic px, REQUIRED document data, never fetched at layout
 * time"); (c) align + keepNext (the caption bond); (d) a NODE VIEW so
 * the hidden PM view renders a real <img alt> (the M5 Orca a11y
 * mirror) and the pageless mode renders through the ONE MediaStore
 * resolution point. parseHTML/renderHTML are DELIBERATELY ABSENT —
 * image nodes never ride clipboard HTML round-trips; the ref would be
 * meaningless outside the container anyway.
 *
 * The node NEVER holds bytes or data URLs — refs only. Dims are
 * required at INSERT time; dim-less legacy nodes are backfilled on
 * open (imageBackfill.ts).
 */

export interface ImageAttrs {
  src: string;
  width: number | null;
  height: number | null;
  alt: string;
  align: 'left' | 'center' | 'right';
  keepNext: boolean;
  /** Corner radius (px, default 0) — PAINT-ONLY (the clip/CSS border
   *  radius); never a layout fact, so attr writes splice without
   * relayout geometry changes. Clamped to half the min placed dim. */
  radius: number;
}

export const ImageNode = Node.create({
  name: 'image',
  group: 'block',
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      height: { default: null },
      alt: { default: '' },
      align: { default: 'left' },
      keepNext: { default: false },
      radius: { default: 0 },
      float: { default: null },
    };
  },

  // No parseHTML — nothing parses IN (clipboard HTML <img> is
  // ignored; internal refs only). renderHTML exists only because PM's
  // renderer spec REQUIRES a toDOM for its fallback/serialization
  // paths — it carries NO attrs (the media:// ref is meaningless
  // outside the container; node views render the real <img>).
  renderHTML() {
    return ['div', { 'data-image': 'true' }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(ImageNodeView);
  },
});
