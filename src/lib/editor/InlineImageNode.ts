import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { InlineImageNodeView } from '@/components/editor/InlineImageNodeView';

/**
 * M-IMAGES-2 — the INLINE image node (E-IMG-2).
 *
 * WHY A SEPARATE NODE (the mechanics receipt): block and inline are
 * DIFFERENT PM SHAPES — different `group` (top-level block content vs
 * `inline`, allowed only INSIDE a textblock), different content
 * models (atom-in-flow vs atom-in-text), different schema slots. A
 * node-kind SWITCH (replace block image ↔ inline image inside a
 * paragraph) is the only honest conversion; there is no "position
 * transform" that turns one shape into the other.
 *
 * The node mirrors the block image's attrs (src media:// ref, REQUIRED
 * width/height, alt) plus the inert carry-overs (align, keepNext,
 * radius) so the block ↔ inline round-trip returns geometry EXACTLY
 * (the conversion copies all attrs both ways; the adapter ignores the
 * inert ones inline). The token is ONE PM position per object — the
 * engine's U+FFFC contract.
 *
 * Baseline seating is the ENGINE's law (bottom-at-baseline, the CSS
 * default); the node view renders at the natural/clamped size and the
 * text baseline sits it — no shell math.
 */
export const InlineImageNode = Node.create({
  name: 'inlineImage',
  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      width: { default: null },
      height: { default: null },
      alt: { default: '' },
      // Inert inline (round-trip carriers; the adapter's InlineImageRun
      // carries none of these):
      align: { default: 'left' },
      keepNext: { default: false },
      radius: { default: 0 },
    };
  },

  // No parseHTML (nothing parses in — internal refs only). renderHTML:
  // a minimal attr-free spec (PM requires toDOM; node views render).
  renderHTML() {
    return ['span', { 'data-inline-image': 'true' }, 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(InlineImageNodeView);
  },
});
