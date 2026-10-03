import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { useMediaStore } from '@/lib/media/store';

/**
 * M-IMAGES-1 — the image node view. ONE resolution point: the
 * MediaStore (objectURL) — no parallel path, ever. Rendered in BOTH
 * worlds:
 *  - PAGELESS: this is the visible rendering (natural size — the
 *    parity bar with the paginated placed dims).
 *  - PAGINATED: the hidden PM view (pm-input-only) still renders it
 *    invisibly — and that is the a11y receipt: a real <img alt> in
 *    the accessibility tree, exactly the M5 Orca mirror ("NOT
 *    aria-hidden: opacity 0 keeps it in the accessibility tree" —
 *    PaginatedView's HiddenInputView law).
 */

type ImageNodeViewProps = ReactNodeViewProps;

export function ImageNodeView({ node }: ImageNodeViewProps) {
  const { src, width, height, alt, radius } = node.attrs as {
    src: string | null;
    width: number | null;
    height: number | null;
    alt: string;
    radius?: number;
  };
  const id = src?.startsWith('media://') ? src.slice('media://'.length) : null;
  const entry = useMediaStore((s) => (id ? s.entries.get(id) : undefined));

  if (!id || !entry) {
    return (
      <NodeViewWrapper data-image-node="true" data-resolved="false">
        {/* Unresolved ref (media not in the store — e.g. an external
            doc opened without its container): the tinted placeholder,
            never a broken-image glyph. */}
        <div
          data-testid="image-placeholder"
          aria-label={alt || 'image'}
          role="img"
          style={{
            width: width ? `${width}px` : '96px',
            height: height ? `${height}px` : '64px',
            background: 'rgba(0,0,0,0.08)',
            borderRadius: '4px',
          }}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper data-image-node="true" data-resolved="true">
      <img
        src={entry.url}
        alt={alt}
        draggable={false}
        style={{
          ...(width && height ? { width: `${width}px`, height: `${height}px` } : {}),
          borderRadius: radius ? `${Math.min(radius, Math.floor(Math.min(width ?? radius, height ?? radius) / 2))}px` : undefined,
        }}
      />
    </NodeViewWrapper>
  );
}
