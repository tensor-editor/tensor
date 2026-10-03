import { NodeViewWrapper } from '@tiptap/react';
import type { ReactNodeViewProps } from '@tiptap/react';
import { useMediaStore } from '@/lib/media/store';

/**
 * M-IMAGES-2 — the INLINE image node view (pageless rendering + the
 * hidden-PM-view a11y surface). Natural size inline (the CSS baseline
 * seats it — the engine's seating law made visible); clamped by CSS's
 * own max-width:100% (a paint-side nicety; the ENGINE's fitDownImage
 * owns the paginated clamp).
 */
type InlineImageNodeViewProps = ReactNodeViewProps;

export function InlineImageNodeView({ node }: InlineImageNodeViewProps) {
  const { src, alt, width, height, radius } = node.attrs as {
    src: string | null;
    alt: string;
    width: number | null;
    height: number | null;
    radius?: number;
  };
  const id = src?.startsWith('media://') ? src.slice('media://'.length) : null;
  const entry = useMediaStore((s) => (id ? s.entries.get(id) : undefined));

  if (!id || !entry) {
    return (
      <NodeViewWrapper as="span" data-inline-image-node="true" data-resolved="false">
        <span
          data-testid="inline-image-placeholder"
          role="img"
          aria-label={alt || 'image'}
          style={{
            display: 'inline-block',
            width: width ? `${width}px` : '48px',
            height: height ? `${height}px` : '32px',
            background: 'rgba(0,0,0,0.08)',
            borderRadius: radius ? `${radius}px` : undefined,
          }}
        />
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper as="span" data-inline-image-node="true" data-resolved="true">
      <img
        src={entry.url}
        alt={alt}
        draggable={false}
        style={{
          display: 'inline-block',
          verticalAlign: 'baseline',
          maxWidth: '100%',
          ...(width && height ? { width: `${width}px`, height: `${height}px` } : {}),
          ...(radius ? { borderRadius: `${radius}px` } : {}),
        }}
      />
    </NodeViewWrapper>
  );
}
