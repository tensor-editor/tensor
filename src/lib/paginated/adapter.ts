import type { Node as PMNode } from '@tiptap/pm/model';
import type {
  Block,
  HeadingBlock,
  ParagraphBlock,
  Run,
  SemanticDoc,
  TextStyle,
} from '@tensor-editor/engine';
import type { TextAlign } from './positionMap';
export type { TextAlign } from './positionMap';

/**
 * PM doc -> engine SemanticDoc. Pure conversion, no
 * measurement, no DOM reads (L1: the engine computes, never paints; the
 * shell paints, never computes — this is the shell->engine handoff).
 *
 * STRICT KINDS: anything beyond paragraph/heading/pageBreak at the top
 * level throws LOUDLY (blockquote, codeBlock, bulletList, orderedList,
 * horizontalRule today). The PaginatedView catches the throw and falls
 * back to pageless rendering — a crash is never acceptable, but silent
 * mis-layout would be worse.
 *
 * The pageBreak node is NOT part of the IR: it becomes
 * `flow.breakBefore: 'page'` on the FOLLOWING block (the forced-break
 * spelling the engine's structural tier consumes — engine/src/types.ts
 * FlowPolicy).
 */

export interface AdapterBlock {
  id: string;
  runs: Run[];
  /** Concatenated run text (runs joined in array order) — the engine's
   * LineBox/rangeStart/rangeEnd offsets index into exactly this string. */
  text: string;
  /** PM positions: the block node spans [from, to); its text content
   * starts at from + 1. PM caret pos -> block text offset =
   * pos - (from + 1). */
  from: number;
  to: number;
  /** Block-level text alignment, from PM's textAlign attr. 'justify' is
   * engine work (explicitly out of the shell scope) and stays in
   * the dropped-attr warning list. */
  align: TextAlign;
  /** Visual mark props per run (parallel to `runs`, indexed by the
   * LineBox segments' runIndex) — shell-side paint concerns the engine's
   * layout math never sees. */
  runDecor: RunDecor[];
}

export interface RunDecor {
  /** Text color (PM color mark, hex). */
  color?: string;
  /** Highlight background (PM highlight mark; resolved color). */
  highlight?: string;
  underline?: boolean;
  strike?: boolean;
}

export interface AdapterResult {
  doc: SemanticDoc;
  blocks: AdapterBlock[];
}

/**
 * Level-based default styles arrive from the ADAPTER, never the engine
 * (engine layout.ts: "level is not a layout input here").
 * Word-approximate multiples of the 16px base.
 */
const HEADING_DEFAULTS: Record<number, { fontSize: number; bold: true }> = {
  1: { fontSize: 32, bold: true },
  2: { fontSize: 24, bold: true },
  3: { fontSize: 19, bold: true },
  4: { fontSize: 16, bold: true },
  5: { fontSize: 13, bold: true },
  6: { fontSize: 11, bold: true },
};

// Dropped-attr policy: these PM attributes/marks have no representation
// in the semantic doc. NEVER silent — one dev warning per distinct
// dropped-set (enumerating them), not per block and not per occurrence.
// Painted (runDecor/align, NOT dropped): color, highlight,
// underline, strike, textAlign left/center/right.
const warnedDroppedSignatures = new Set<string>();

const DEFAULT_HIGHLIGHT = '#fef08a';

/**
 * The identity cache that makes the pipeline O(edit):
 * conversions are memoized on the PM NODE object. ProseMirror's
 * structural sharing guarantees a typing transaction rebuilds only the
 * edited node's path — sibling top-level nodes are the same object
 * references across doc versions — so unchanged blocks reuse their
 * semantic Block and AdapterBlock BY REFERENCE. That is exactly the
 * adapter contract the engine's hash identity cache
 * is keyed on: reference-stable blocks → zero re-hashing, zero
 * re-conversion. PM nodes are immutable: a CHANGED paragraph is a new
 * object, which misses here and reconverts. A baseStyle change
 * (font default) invalidates everything via the generation tag, since
 * cached runs embed baseStyle-derived fields.
 */
interface CachedConversion {
  gen: number;
  semantic: ParagraphBlock | HeadingBlock;
  adapter: AdapterBlock;
}

const nodeCache = new WeakMap<PMNode, CachedConversion>();
let cacheGeneration = 0;
let lastStyleKey: string | null = null;

function warnDroppedAttrs(dropped: Set<string>): void {
  if (dropped.size === 0) return;
  if (!import.meta.env.DEV) return;
  const signature = [...dropped].sort().join(',');
  if (warnedDroppedSignatures.has(signature)) return;
  warnedDroppedSignatures.add(signature);
  console.warn(
    `[adapter] attributes present but dropped by the semantic doc: ${signature}. ` +
      'Layout ignores them; they are preserved in the PM document and re-appear in .wpdoc saves.'
  );
}

/** PM fontSize attr (a CSS string; the UI writes 'NNpx') → core px.
 * Pasted HTML may carry pt — the DATA BOUNDARY converts it to the
 * core's px (M6-PRE: pt at the chrome, px in the core; parseLineHeight
 * applies the same conversion for its absolute unit paths). */
function parseFontSize(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) {
      return value.trim().endsWith('pt') ? Math.round(parsed * (96 / 72)) : parsed;
    }
  }
  return fallback;
}

/**
 * PM lineHeight attr (a string — the schema stores CSS values) → the
 * engine's multiplier. CSS semantics, in declining order of how the
 * UI emits them (LineSpacingButton writes only unitless multipliers
 * '1'/'1.15'/'1.5'/'2' and arbitrary custom numeric strings):
 *   unitless 'NNN' | number → NNN            (multiplier, Word set)
 *   'NNN%'                  → NNN / 100      (pasted HTML)
 *   'NNNpx' | 'NNNpt'        → absolute → ÷fontSize (CSS: relative
 *                             to the element's own font size)
 *   'NNNem'                 → NNN            (already × fontSize)
 *   'normal' / junk / non-positive → undefined (single spacing)
 * Outside [0.25, 4] → undefined: a garbage multiplier ('25px' pasted
 * raw used to become 25×) must degrade to single, never to a wreck.
 */
function parseLineHeight(value: unknown, fontSize: number): number | undefined {
  const MIN_LH = 0.25;
  const MAX_LH = 4;
  let multiplier: number | undefined;
  if (typeof value === 'number' && Number.isFinite(value)) {
    multiplier = value;
  } else if (typeof value === 'string') {
    const raw = value.trim();
    if (!raw || raw === 'normal') return undefined;
    const parsed = parseFloat(raw);
    if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
    if (raw.endsWith('%')) multiplier = parsed / 100;
    else if (raw.endsWith('px')) multiplier = parsed / fontSize;
    else if (raw.endsWith('pt')) multiplier = (parsed * (96 / 72)) / fontSize;
    else if (raw.endsWith('em')) multiplier = parsed;
    else multiplier = parsed;
  }
  if (multiplier == null || !Number.isFinite(multiplier) || multiplier <= 0) return undefined;
  if (multiplier < MIN_LH || multiplier > MAX_LH) return undefined;
  return multiplier;
}

function isNonZero(value: unknown): boolean {
  return typeof value === 'number' && value !== 0;
}

/**
 * PM spaceBefore/spaceAfter attrs (numbers, px — the schema stores
 * CSS px values, same unit the engine consumes) → engine block-tier
 * spacing. Non-positive/NaN → undefined: the walk treats undefined as
 * 0, and undefined keeps the engine's contentHash free of no-op keys.
 */
function parseSpacing(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  return undefined;
}

/** The per-node conversion (the expensive part): runs, marks, decor,
 * text, align. Cached on the node object. PM positions (from/to) are
 * deliberately NOT cached — they depend on preceding siblings and are
 * recomputed per call (cheap). */
function convertNode(
  node: PMNode,
  kind: 'paragraph' | 'heading',
  blockId: string,
  baseStyle: TextStyle,
  dropped: Set<string>
): CachedConversion {
  const headingDefault =
    kind === 'heading' ? HEADING_DEFAULTS[node.attrs.level ?? 1] : undefined;

  const runs: Run[] = [];
  const runDecor: RunDecor[] = [];
  let text = '';

  const alignAttr = node.attrs?.textAlign;
  const align: TextAlign =
    alignAttr === 'center' || alignAttr === 'right' ? alignAttr : 'left';

  node.forEach((child) => {
    if (!child.isText || !child.text) {
      throw new Error(
        `[adapter] unsupported inline node '${child.type.name}' inside ${kind}: ` +
          'the engine has no inline-break model (hardBreak included)'
      );
    }

const textStyleMark = child.marks.find((m) => m.type.name === 'textStyle');

      // tiptap v3's FontFamily is a GLOBAL ATTRIBUTE on the textStyle
      // mark (verified against extension-text-style's dist), not a
      // separate mark — read it from there. (A standalone 'fontFamily'
      // mark stays supported defensively for any custom schema.)
      const standaloneFamilyMark = child.marks.find((m) => m.type.name === 'fontFamily');
      const familyAttr =
        typeof standaloneFamilyMark?.attrs?.fontFamily === 'string' && standaloneFamilyMark.attrs.fontFamily
          ? standaloneFamilyMark.attrs.fontFamily
          : typeof textStyleMark?.attrs?.fontFamily === 'string' && textStyleMark.attrs.fontFamily
            ? textStyleMark.attrs.fontFamily
            : null;

      const fontSize =
        textStyleMark?.attrs?.fontSize != null
          ? parseFontSize(textStyleMark.attrs.fontSize, baseStyle.fontSize)
          : headingDefault?.fontSize ?? baseStyle.fontSize;

      const style: TextStyle = {
        fontFamily: familyAttr ?? baseStyle.fontFamily,
        fontSize,
        bold: child.marks.some((m) => m.type.name === 'bold') || headingDefault?.bold,
        italic: child.marks.some((m) => m.type.name === 'italic'),
        lineHeight: parseLineHeight(node.attrs?.lineHeight, fontSize),
      };

    // Dropped-attr detection — collected, warned once, never silent.
    // color/highlight/underline/strike and left/center/right textAlign
    // are painted (runDecor / block align); spaceBefore/spaceAfter are
    // MAPPED to the engine's block-tier spacing (M6); justify remains
    // engine work and stays loud.
    if (alignAttr === 'justify') dropped.add('textAlign (justify — engine work)');
    if (child.marks.some((m) => m.type.name === 'link')) dropped.add('link');
    if (isNonZero(node.attrs?.indent)) dropped.add('indent');
    if (isNonZero(node.attrs?.indentLeft)) dropped.add('indentLeft');
    if (isNonZero(node.attrs?.indentRight)) dropped.add('indentRight');

    const highlightMark = child.marks.find((m) => m.type.name === 'highlight');
    runs.push({ text: child.text, style });
    runDecor.push({
      color:
        typeof textStyleMark?.attrs?.color === 'string' && textStyleMark.attrs.color
          ? textStyleMark.attrs.color
          : undefined,
      highlight: highlightMark
        ? ((highlightMark.attrs?.color as string | undefined) ?? DEFAULT_HIGHLIGHT)
        : undefined,
      underline: child.marks.some((m) => m.type.name === 'underline'),
      strike: child.marks.some((m) => m.type.name === 'strike'),
    });
    text += child.text;
  });

  // Block-tier spacing (M6): engine px, same unit the PM schema
  // stores. Applied once at block entry / block exit by the walk —
  // never re-applied on fragment continuations.
  const spaceBefore = parseSpacing(node.attrs?.spaceBefore);
  const spaceAfter = parseSpacing(node.attrs?.spaceAfter);

  const semantic: ParagraphBlock | HeadingBlock =
    kind === 'heading'
      ? { id: blockId, kind: 'heading', level: node.attrs.level ?? 1, runs, spaceBefore, spaceAfter }
      : { id: blockId, kind: 'paragraph', runs, spaceBefore, spaceAfter };

  return { gen: cacheGeneration, semantic, adapter: { id: blockId, runs, text, from: 0, to: 0, align, runDecor } };
}

export function pmDocToSemantic(pm: PMNode, baseStyle: TextStyle): AdapterResult {
  const styleKey = `${baseStyle.fontFamily}\u0000${baseStyle.fontSize}`;
  if (styleKey !== lastStyleKey) {
    cacheGeneration += 1;
    lastStyleKey = styleKey;
  }

  const blocks: AdapterBlock[] = [];
  const semantic: Block[] = [];
  const dropped = new Set<string>();
  let pendingBreakBefore = false;

  pm.forEach((node, offset) => {
    const kind = node.type.name;

    if (kind === 'pageBreak') {
      // Forced page break on the FOLLOWING block. A trailing pageBreak
      // (nothing follows) has no block to force — the engine derives
      // pages from placed lines, so it is simply skipped.
      pendingBreakBefore = true;
      return;
    }

    if (kind !== 'paragraph' && kind !== 'heading') {
      throw new Error(
        `[adapter] unsupported block kind '${kind}' at offset ${offset}: the engine ` +
          'handles paragraph/heading only (blockquote, codeBlock, bulletList, orderedList, ' +
          'horizontalRule are deliberate loud throws until the engine supports them)'
      );
    }

    // Identity cache hit? Same node object + same baseStyle generation.
    const cached = nodeCache.get(node);
    let conv: CachedConversion;
    if (cached && cached.gen === cacheGeneration) {
      conv = cached;
    } else {
      const blockId = node.attrs?.blockId;
      if (typeof blockId !== 'string' || !blockId) {
        throw new Error(
          `[adapter] top-level ${kind} at offset ${offset} has no blockId — ` +
            'BlockIdExtension must mint ids on creation/load/paste before any layout call'
        );
      }
      conv = convertNode(node, kind, blockId, baseStyle, dropped);
      nodeCache.set(node, conv);
    }

    // flow.breakBefore derives from a PRECEDING pageBreak — it is a
    // sibling fact, not a node fact, so it is applied per call (the
    // clone breaks object identity for that one block and the engine
    // re-hashes it; forced-break blocks are rare).
    const block =
      pendingBreakBefore
        ? { ...conv.semantic, flow: { breakBefore: 'page' as const } }
        : conv.semantic;
    pendingBreakBefore = false;

    semantic.push(block);
    // Positions are always fresh (sibling sizes shift them).
    blocks.push({ ...conv.adapter, from: offset, to: offset + node.nodeSize });
  });

  warnDroppedAttrs(dropped);

  return { doc: { blocks: semantic, baseStyle }, blocks };
}
