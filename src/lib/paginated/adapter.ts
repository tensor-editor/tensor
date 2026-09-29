import type { Node as PMNode } from '@tiptap/pm/model';
import type {
  Block,
  CodeBlockBlock,
  HeadingBlock,
  ParagraphBlock,
  Run,
  SemanticDoc,
  TextStyle,
} from '@tensor-editor/engine';
import type { TextAlign } from './positionMap';
import type { StyleDefinition, StyleRegistrySnapshot } from '@/lib/styles/types';
import { headingStyleId } from '@/lib/styles/types';
import { builtinDefinitionsById } from '@/lib/styles/builtins';
import { lookupStyle } from '@/lib/styles/registry';
import {
  baselineRunStyle,
  resolveBlockTier,
  resolveRun,
  transformText,
  type BlockTierAttrs,
  type RunStyle,
} from '@/lib/styles/resolve';
export type { TextAlign } from './positionMap';

/**
 * PM doc -> engine SemanticDoc. Pure conversion, no
 * measurement, no DOM reads (L1: the engine computes, never paints; the
 * shell paints, never computes — this is the shell->engine handoff).
 *
 * FULL EXISTING-BLOCK PARITY (M6.1): every block kind the schema can
 * hold projects into engine Blocks:
 *   - bulletList/orderedList recurse: each listItem's inner paragraph
 *     becomes a paragraph block with indentLeft = depth × 32 (px) and
 *     a paint-only listMarker hint (ordered index computed per-list —
 *     sibling deletion reindexes the remainder).
 *   - blockquote bodies project as paragraph blocks with indentLeft 32
 *     and a paint-only blockquote hint.
 *   - codeBlock projects onto the engine's codeBlock kind (source-line
 *     semantics in the engine's breaker), runs mapped per source line,
 *     monospace @ the document-default size (the pageless <pre> look).
 *   - horizontalRule projects as a single-line paragraph block with a
 *     rule paint hint — one LineBox, never fragments.
 * Remaining kinds throw UnsupportedDocError — ONLY the true future
 * features (table, image, drawing). The PaginatedView's fallback
 * catches ONLY that sentinel; everything else crashes loudly in dev
 * (CONVENTIONS.md, the fallback audit).
 *
 * The pageBreak node is NOT part of the IR: it becomes
 * `flow.breakBefore: 'page'` on the FOLLOWING block (the forced-break
 * spelling the engine's structural tier consumes — engine/src/types.ts
 * FlowPolicy).
 */

/**
 * The unsupported-kind sentinel. The pageless fallback catches ONLY
 * this class (CONVENTIONS.md): a document using a node the projection
 * does not support yet degrades gracefully — a real adapter/engine bug
 * is a different exception and must crash loudly in dev.
 */
export class UnsupportedDocError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsupportedDocError';
  }
}

export interface ListMarkerHint {
  kind: 'bullet' | 'ordered';
  /** 1-based nesting depth (top-level items = 1; indentLeft = depth × 32). */
  depth: number;
  /** 1-based index within the item's own list (ordered reindex source). */
  index: number;
  /** The list node's listStyleType attr ('disc'/'decimal'/'lower-roman'/...). */
  styleType: string;
}

/**
 * SHELL-SIDE PAINT HINTS, attached to semantic blocks AND mirrored on
 * AdapterBlock.paint. The ENGINE IGNORES THEM: hashBlock stringifies
 * only {kind, runs, flow, spaceBefore, spaceAfter} and the walk never
 * reads them — they are paint facts. Consequence (deliberate): an
 * ordered reindex produces a NEW Block object with an UNCHANGED hash,
 * so the engine's splice keeps the cached placement — markers are ink,
 * never re-flow.
 */
export interface BlockPaint {
  marker?: ListMarkerHint;
  blockquote?: boolean;
  rule?: boolean;
  /** codeBlock backgrounds (the kind's paint face — carried here so the
   * painter stays hint-driven, one extras field for all block decor). */
  code?: boolean;
}

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
  /** Block-tier left indent (px) — mirrors the semantic block's
   * indentLeft for the painter (markers live in the [indent−32,
   * indent) gutter). */
  indentLeft?: number;
  /** Block-tier right indent (px) — informational mirror. */
  indentRight?: number;
  /** Paint hints — see BlockPaint. */
  paint?: BlockPaint;
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
 * The default registry for call sites that predate M-STYLES: the code
 * builtins alone. Heading levels resolve through their built-in
 * definitions (the old HEADING_DEFAULTS values, verbatim) and
 * paragraphs carry styleId 'normal' (no properties) — behavior
 * identical to the pre-registry adapter.
 */
const BUILTIN_REGISTRY: StyleRegistrySnapshot = {
  definitions: builtinDefinitionsById(),
  epoch: 0,
};

// Dropped-attr policy: these PM attributes/marks have no representation
// in the semantic doc. NEVER silent — one dev warning per distinct
// dropped-set (enumerating them), not per block and not per occurrence.
// Painted (runDecor/align, NOT dropped): color, highlight,
// underline, strike, textAlign left/center/right.
const warnedDroppedSignatures = new Set<string>();

const DEFAULT_HIGHLIGHT = '#fef08a';

/** One indent gutter per list nesting level (px) — the marker column
 * is [indentLeft − 32, indentLeft). */
export const LIST_INDENT_PX = 32;

/** Per-list marker style defaults (the extensions' attr defaults). */
function defaultListStyle(kind: 'bullet' | 'ordered'): string {
  return kind === 'bullet' ? 'disc' : 'decimal';
}

/**
 * The identity cache that makes the pipeline O(edit):
 * conversions are memoized on the PM NODE object. ProseMirror's
 * structural sharing guarantees a typing transaction rebuilds only the
 * edited node's path — sibling nodes are the same object references
 * across doc versions — so unchanged blocks reuse their semantic Block
 * and AdapterBlock BY REFERENCE. That is exactly the adapter contract
 * the engine's hash identity cache is keyed on: reference-stable
 * blocks → zero re-hashing, zero re-conversion. PM nodes are
 * immutable: a CHANGED paragraph is a new object, which misses here
 * and reconverts. A baseStyle change (font default) invalidates
 * everything via the generation tag, since cached runs embed
 * baseStyle-derived fields.
 *
 * SIBLING FACTS (indentLeft, the listMarker index, ...) are NOT part
 * of the node: an ordered reindex after a sibling deletion changes an
 * UNCHANGED node's marker. The cache therefore stores the projection
 * facts it was built under and reuses the cached objects ONLY when
 * they are equal — a reindexed item reconverts (O(changed) clones,
 * correct), while an edit inside item 7 leaves item 9's cached objects
 * reference-identical (pinned by tests, both directions).
 */
interface CachedConversion {
  gen: number;
  semantic: ParagraphBlock | HeadingBlock | CodeBlockBlock;
  adapter: AdapterBlock;
  /** Projection facts this conversion was built under (sibling-dependent). */
  indentLeft: number;
  paint?: BlockPaint;
}

const nodeCache = new WeakMap<PMNode, CachedConversion>();
let cacheGeneration = 0;
let lastContextKey: string | null = null;

/** Sibling-fact equality for the identity cache's reuse test. */
function paintEqual(a: BlockPaint | undefined, b: BlockPaint | undefined): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const am = a.marker;
  const bm = b.marker;
  const markersEqual =
    am == null && bm == null
      ? true
      : am != null &&
        bm != null &&
        am.kind === bm.kind &&
        am.depth === bm.depth &&
        am.index === bm.index &&
        am.styleType === bm.styleType;
  return (
    markersEqual &&
    (a.blockquote ?? false) === (b.blockquote ?? false) &&
    (a.rule ?? false) === (b.rule ?? false) &&
    (a.code ?? false) === (b.code ?? false)
  );
}

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

// ─── Indent family mapping (M6.2) ─────────────────────────────────────────
//
// RECEIPTS (the units, reconciled at the ADAPTER — the conversion
// site, per the STEP 1 ruling):
//  - PM indentLeft/indentRight attrs are PX already (the ribbon input
//    writes px, parseHTML reads px) → pass through 1:1.
//  - The legacy `indent` attr is STEPS of 32px → folded in here
//    (steps × 32, additive); the commands migrate it away on first
//    press, so in practice at most one of the two is ever set.
//  - firstLineIndent is px (may be negative — hanging), mapped 1:1.
//
// VALIDATION BEFORE THE ENGINE CAN THROW (engine layout.ts throws on
// indentLeft + firstLineIndent < 0 — "the adapter must validate before
// sending; this throw is the backstop"): rejected values fall back to
// the NEAREST LEGAL one and warn once per distinct clamp in dev —
// never silent, never a layout crash.

const warnedIndentClamps = new Set<string>();

function warnIndentClamp(fact: string): void {
  if (!import.meta.env.DEV) return;
  if (warnedIndentClamps.has(fact)) return;
  warnedIndentClamps.add(fact);
  console.warn(`[adapter] indent value rejected, clamped to the nearest legal one: ${fact}`);
}

/** Any numeric-ish attr → px number (strings tolerated defensively). */
function parseIndentPx(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

/** The block's OWN left indent (px): indentLeft + legacy `indent`
 * steps folded. Clamped ≥ 0 (negative left indent is not a thing). */
function ownIndentLeft(node: PMNode): number {
  const raw =
    parseIndentPx(node.attrs?.indentLeft) +
    (isNonZero(node.attrs?.indent) ? parseIndentPx(node.attrs?.indent) * LIST_INDENT_PX : 0);
  if (raw < 0) {
    warnIndentClamp(`indentLeft ${node.attrs?.indentLeft} < 0 → 0`);
    return 0;
  }
  return raw;
}

function ownIndentRight(node: PMNode): number {
  const raw = parseIndentPx(node.attrs?.indentRight);
  if (raw < 0) {
    warnIndentClamp(`indentRight ${node.attrs?.indentRight} < 0 → 0`);
    return 0;
  }
  return raw;
}

/** How a PM node projects into the engine's Block union. */
interface Projection {
  kind: 'paragraph' | 'heading' | 'codeBlock';
  /** Block-tier left indent (px) — 0 for unindented blocks. */
  indentLeft: number;
  /** Paint hints (sibling facts — see CachedConversion). */
  paint?: BlockPaint;
}

/**
 * Pageless-look receipt (engine E2, tests/code-block.test.ts): the
 * pageless editor renders codeBlock as <pre><code> with NO font of its
 * own — the UA stylesheet's `pre { font-family: monospace }` applies
 * and the size INHERITS the container's document-default. Runs carry
 * exactly that. One run per source line ('\n' kept at the end of the
 * line it terminates): the engine's breakCodeLines honors the
 * separators (the '\n' belongs to no LineBox range) and measures blank
 * lines under the first run's style, so blank lines are exactly as
 * tall as their siblings.
 */
function codeRuns(node: PMNode, base: RunStyle): { runs: Run[]; text: string } {
  const style: TextStyle = { fontFamily: 'monospace', fontSize: base.fontSize };
  const runs: Run[] = [];
  let text = '';
  node.forEach((child) => {
    if (!child.isText || !child.text) {
      throw new UnsupportedDocError(
        `[adapter] unsupported inline node '${child.type.name}' inside codeBlock`
      );
    }
    const pieces = child.text.split('\n');
    for (let i = 0; i < pieces.length; i++) {
      const piece = i < pieces.length - 1 ? pieces[i] + '\n' : pieces[i];
      if (piece) {
        runs.push({ text: piece, style });
        text += piece;
      }
    }
  });
  return { runs, text };
}

/** The resolved RunStyle → the engine's TextStyle. bold/italic are
 * always-present booleans (the non-empty-run contract the tests
 * pin); lineHeight passes through verbatim — a direct attr's '1'
 * stays 1, an absent attr AND absent tier stays absent (the engine's
 * absent ≡ 1.0 bit-for-bit invariant), a style-provided value wins
 * when the attr is unset. fontVariant 'normal' is stripped (explicit
 * 'normal' hashes ≠ absent — engine tests/font-variant.test.ts pins
 * the seam ruling: the shell normalizes). */
function textStyleOf(resolved: RunStyle, lineHeight: number | undefined, withBoldItalic = true): TextStyle {
  return {
    fontFamily: resolved.fontFamily,
    fontSize: resolved.fontSize,
    ...(withBoldItalic ? { bold: resolved.bold, italic: resolved.italic } : {}),
    ...(lineHeight !== undefined ? { lineHeight } : {}),
    ...(resolved.fontVariant === 'small-caps' ? { fontVariant: 'small-caps' as const } : {}),
  };
}

/** The per-node conversion (the expensive part): runs, marks, decor,
 * text, align, spacing, indent, hints. Cached on the node object (see
 * CachedConversion for the sibling-fact reuse test). PM positions
 * (from/to) are deliberately NOT cached — they depend on preceding
 * siblings and are recomputed per call (cheap).
 *
 * M-STYLES: all style resolution flows through resolve.ts resolveRun /
 * resolveBlockTier (THE one function) with the registry snapshot —
 * baseStyle < paragraph style < charStyle < direct marks, per
 * property. */
function convertNode(
  node: PMNode,
  projection: Projection,
  blockId: string,
  base: RunStyle,
  definitions: Record<string, StyleDefinition>,
  dropped: Set<string>
): CachedConversion {
  const kind = projection.kind;

  // The paragraph tier's style identity. Headings resolve through
  // `heading-{level}` — the styleId attr's guaranteed twin (the
  // HeadingSync plugin maintains the alignment); paragraphs through
  // their styleId attr ('normal' default, schema-guaranteed).
  const paraDef =
    kind === 'heading'
      ? lookupStyle(headingStyleId(node.attrs.level ?? 1), definitions)
      : lookupStyle(
          typeof node.attrs?.styleId === 'string' && node.attrs.styleId
            ? node.attrs.styleId
            : 'normal',
          definitions
        );

  const runs: Run[] = [];
  const runDecor: RunDecor[] = [];
  let text = '';

  const alignAttr = node.attrs?.textAlign;

  if (kind === 'codeBlock') {
    const code = codeRuns(node, base);
    runs.push(...code.runs);
    text = code.text;
    // EMPTY-TEXTBLOCK INHERITANCE (P1): an empty codeBlock emits one
    // zero-length run carrying the pageless-look style — the engine
    // measures present-run styles over baseStyle (P1 ruling), so the
    // blank line matches its mono siblings, not the prose default.
    if (runs.length === 0) {
      runs.push({ text: '', style: { fontFamily: 'monospace', fontSize: base.fontSize } });
    }
  } else {
    node.forEach((child) => {
      if (!child.isText || !child.text) {
        throw new UnsupportedDocError(
          `[adapter] unsupported inline node '${child.type.name}' inside ${kind}: ` +
            'the engine has no inline-break model (hardBreak included) — the pageless ' +
            'fallback renders it until the engine grows one'
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

      const fontSizeAttr =
        textStyleMark?.attrs?.fontSize != null
          ? parseFontSize(textStyleMark.attrs.fontSize, base.fontSize)
          : undefined;

      // The charStyle mark: a registry reference, resolved alongside
      // the formatting marks (stacks with them, never stamps).
      const charStyleMark = child.marks.find((m) => m.type.name === 'charStyle');
      const charDef =
        typeof charStyleMark?.attrs?.styleId === 'string' && charStyleMark.attrs.styleId
          ? lookupStyle(charStyleMark.attrs.styleId, definitions)
          : null;

      const highlightMark = child.marks.find((m) => m.type.name === 'highlight');

      // DIRECT MARKS (strongest tier).
      const direct = {
        ...(familyAttr ? { fontFamily: familyAttr } : {}),
        ...(fontSizeAttr != null ? { fontSize: fontSizeAttr } : {}),
        ...(child.marks.some((m) => m.type.name === 'bold') ? { bold: true } : {}),
        ...(child.marks.some((m) => m.type.name === 'italic') ? { italic: true } : {}),
        ...(child.marks.some((m) => m.type.name === 'underline') ? { underline: true } : {}),
        ...(child.marks.some((m) => m.type.name === 'strike') ? { strike: true } : {}),
        ...(typeof textStyleMark?.attrs?.color === 'string' && textStyleMark.attrs.color
          ? { color: textStyleMark.attrs.color }
          : {}),
        ...(highlightMark
          ? { highlight: ((highlightMark.attrs?.color as string | undefined) ?? DEFAULT_HIGHLIGHT) }
          : {}),
      };

      // ONE resolution function (resolve.ts): baseStyle < paragraph
      // style < charStyle < direct marks, per property, complete
      // values — the registry never leaves a property undefined.
      const resolved = resolveRun({ base, para: paraDef, char: charDef, direct });

      // Direct BLOCK formatting (the lineHeight attr) parses against
      // the RESOLVED font size (CSS: absolute units are relative to
      // the element's own size) and beats the char/para tiers. The
      // attr value passes through VERBATIM (1 stays 1 — the pinned
      // attr-table contract); tiers apply only when the attr is unset.
      const attrLineHeight = parseLineHeight(node.attrs?.lineHeight, resolved.fontSize);
      const tierLineHeight = charDef?.properties.lineHeight ?? paraDef?.properties.lineHeight;
      const lineHeight = attrLineHeight !== undefined ? attrLineHeight : tierLineHeight;

      // Dropped-attr detection — collected, warned once, never silent.
      // color/highlight/underline/strike and left/center/right textAlign
      // are painted (runDecor / block align); spaceBefore/spaceAfter are
      // MAPPED to the engine's block-tier spacing (M6); the INDENT
      // FAMILY is mapped to engine geometry (M6.2 — indent/indentLeft/
      // indentRight consumed, no longer dropped); justify remains
      // engine work and stays loud.
      if (child.marks.some((m) => m.type.name === 'link')) dropped.add('link');

      // TRANSFORMED MEASUREMENT (amendment 3): run TEXT is transformed
      // HERE, so the engine measures (and wraps) the transformed text
      // — uppercase is wider than source in real fonts. PM keeps the
      // source text; the length-preserving invariant (transformText
      // throws otherwise) keeps engine offsets identity-mapped to PM
      // offsets, so caret/hitTest/search all stay in source coords.
      const runText = transformText(child.text, resolved.textTransform);
      runs.push({ text: runText, style: textStyleOf(resolved, lineHeight) });
      runDecor.push({
        color: resolved.color !== '#000000' ? resolved.color : undefined,
        // The HIGHLIGHT tier cascades like color (direct mark > char
        // style > paragraph style; '' baseline = no highlight).
        highlight: resolved.highlight !== '' ? resolved.highlight : undefined,
        underline: resolved.underline,
        strike: resolved.strike,
      });
      text += runText;
    });
  }

  // EMPTY-TEXTBLOCK INHERITANCE (P1): an empty paragraph/heading emits
  // ONE zero-length run with the block's effective style — same
  // resolution as normal runs minus the marks (none exist on an empty
  // textblock). The engine measures present-run styles over baseStyle
  // (P1 ruling), so an empty paragraph in a 2.0-spaced style measures
  // 2.0 and its NPC ¶ paints at the right size. The horizontalRule
  // atom (kind 'paragraph' by projection) is excluded — it carries no
  // text style and keeps the baseStyle-measured placeholder line.
  if (
    runs.length === 0 &&
    (node.type.name === 'paragraph' || node.type.name === 'heading')
  ) {
    const resolved = resolveRun({ base, para: paraDef });
    const attrLineHeight = parseLineHeight(node.attrs?.lineHeight, resolved.fontSize);
    const tierLineHeight = paraDef?.properties.lineHeight;
    const lineHeight = attrLineHeight !== undefined ? attrLineHeight : tierLineHeight;
    // No bold/italic keys on the empty-textblock style (the pinned
    // P1 projection shape) — the glyph is the ¶ placeholder.
    runs.push({ text: '', style: textStyleOf(resolved, lineHeight, false) });
  }

  // BLOCK TIER (M6 + M-STYLES): direct attrs beat the paragraph style's
  // geometry properties, which beat the baseline. Unset = default attr
  // value (0 / null), so the STYLE provides the value in that case; the
  // legacy `indent` steps fold into the attr side as today.
  const attrsTier: BlockTierAttrs =
    kind === 'paragraph'
      ? {
          spaceBefore: node.attrs?.spaceBefore || undefined,
          spaceAfter: node.attrs?.spaceAfter || undefined,
          indentLeft: ownIndentLeft(node) || undefined,
          indentRight: ownIndentRight(node) || undefined,
          firstLineIndent: node.attrs?.firstLineIndent,
          textAlign: alignAttr,
        }
      : { textAlign: alignAttr };
  const tier = resolveBlockTier(paraDef, attrsTier, projection.indentLeft);

  // Validation before the engine can throw (negative left edge), plus
  // the style tier's own values — same clamps, same one-time warnings.
  const totalLeft = tier.indentLeft < 0 ? (warnIndentClamp(`style indentLeft < 0 → 0`), 0) : tier.indentLeft;
  const indentRight = tier.indentRight < 0 ? (warnIndentClamp(`style indentRight < 0 → 0`), 0) : tier.indentRight;
  let firstLineIndent = tier.firstLineIndent;
  if (firstLineIndent != null && totalLeft + firstLineIndent < 0) {
    warnIndentClamp(
      `firstLineIndent ${firstLineIndent} under indentLeft ${totalLeft} → ${-totalLeft} (first line left edge floored at 0)`
    );
    firstLineIndent = totalLeft > 0 ? -totalLeft : undefined;
  }

  // 'justify' (attr OR style tier) is engine work and stays LOUD: the
  // pageless CSS renders it natively, the paginated mode drops it to
  // left through the same one-time warning the textAlign attr always
  // had — identical ruling for the style tier.
  const align: TextAlign = tier.align === 'justify' ? 'left' : tier.align;
  if (tier.align === 'justify') dropped.add('textAlign (justify — engine work)');
  const spaceBefore = tier.spaceBefore != null && tier.spaceBefore > 0 ? tier.spaceBefore : undefined;
  const spaceAfter = tier.spaceAfter != null && tier.spaceAfter > 0 ? tier.spaceAfter : undefined;

  const hints = projection.paint ?? {};
  // SEMANTIC-side hint spelling (M6.1): listMarker per the projection
  // spec; blockquote/rule/code as booleans. The engine ignores all of
  // them (hashBlock covers kind/runs/flow/space only).
  const hintFields = {
    ...(hints.marker ? { listMarker: hints.marker } : {}),
    ...(hints.blockquote ? { blockquote: true } : {}),
    ...(hints.rule ? { rule: true } : {}),
    ...(hints.code ? { code: true } : {}),
  };
  const shared = {
    id: blockId,
    runs,
    spaceBefore,
    spaceAfter,
    ...(totalLeft ? { indentLeft: totalLeft } : {}),
    ...(indentRight ? { indentRight } : {}),
    ...(firstLineIndent != null ? { firstLineIndent } : {}),
    ...hintFields,
  };

  const semantic: Block =
    kind === 'heading'
      ? { ...shared, kind: 'heading', level: node.attrs.level ?? 1 }
      : kind === 'codeBlock'
        ? { ...shared, kind: 'codeBlock' }
        : { ...shared, kind: 'paragraph' };

  return {
    gen: cacheGeneration,
    semantic: semantic as CachedConversion['semantic'],
    adapter: {
      id: blockId,
      runs,
      text,
      from: 0,
      to: 0,
      align,
      ...(totalLeft ? { indentLeft: totalLeft } : {}),
      ...(indentRight ? { indentRight } : {}),
      ...(projection.paint ? { paint: projection.paint } : {}),
      runDecor,
    },
    // The cache's sibling-fact key is the BASE indent (structural:
    // list depth / blockquote gutter) — own-attr changes produce a NEW
    // node object (PM immutability) and miss the WeakMap by
    // construction, so only the base needs the equality test.
    indentLeft: projection.indentLeft,
    paint: projection.paint,
  };
}

export function pmDocToSemantic(
  pm: PMNode,
  baseStyle: TextStyle,
  registry: StyleRegistrySnapshot = BUILTIN_REGISTRY
): AdapterResult {
  // THE REGISTRY EPOCH (M-STYLES STEP 3): the shell-side mirror of the
  // engine's baseStyleHash. A baseStyle change OR any definition edit
  // (epoch bump) invalidates the identity cache wholesale — every
  // block re-converts with fresh resolved runs/decor. The engine then
  // decides per block what re-breaks via contentHash (layout-relevant
  // edits) or splices (paint-only edits — those still reach the canvas
  // through the rebuilt AdapterBlocks).
  const contextKey = `${baseStyle.fontFamily}\u0000${baseStyle.fontSize}\u0000${registry.epoch}`;
  if (contextKey !== lastContextKey) {
    cacheGeneration += 1;
    lastContextKey = contextKey;
  }

  const base = baselineRunStyle(baseStyle);
  const definitions = registry.definitions;

  const blocks: AdapterBlock[] = [];
  const semantic: Block[] = [];
  const dropped = new Set<string>();
  let pendingBreakBefore = false;

  /** Cache-aware projection of one PM node. Reuses the cached
   * conversion only when the sibling facts are unchanged (see
   * CachedConversion); a stale-marker or stale-indent hit reconverts.
   * codeBlock blocks always carry the code paint hint — merged here so
   * the cache comparison and the stored facts agree. */
  const projected = (node: PMNode, projectionIn: Projection, pos: number): CachedConversion => {
    const projection: Projection =
      projectionIn.kind === 'codeBlock' && !projectionIn.paint?.code
        ? { ...projectionIn, paint: { ...projectionIn.paint, code: true } }
        : projectionIn;
    const cached = nodeCache.get(node);
    if (
      cached &&
      cached.gen === cacheGeneration &&
      cached.indentLeft === projection.indentLeft &&
      paintEqual(cached.paint, projection.paint)
    ) {
      return cached;
    }
    const blockId = node.attrs?.blockId;
    if (typeof blockId !== 'string' || !blockId) {
      throw new Error(
        `[adapter] ${projection.kind} at offset ${pos} has no blockId — ` +
          'BlockIdExtension must mint ids on creation/load/paste before any layout call'
      );
    }
    const conv = convertNode(node, projection, blockId, base, definitions, dropped);
    nodeCache.set(node, conv);
    return conv;
  };

  /** Commit one projected block: forced breakBefore from a PRECEDING
   * pageBreak is a sibling fact, applied per call (the clone breaks
   * object identity for that one block and the engine re-hashes it;
   * forced-break blocks are rare). Positions are always fresh. */
  const push = (conv: CachedConversion, node: PMNode, pos: number): void => {
    const block = pendingBreakBefore
      ? { ...conv.semantic, flow: { breakBefore: 'page' as const } }
      : conv.semantic;
    pendingBreakBefore = false;
    semantic.push(block);
    blocks.push({ ...conv.adapter, from: pos, to: pos + node.nodeSize });
  };

  /** Any block a list item may hold. `marker` is the item's own hint —
   * only its paragraph/heading carries it. */
  const walkListItemChild = (
    child: PMNode,
    childPos: number,
    depth: number,
    indentLeft: number,
    marker: ListMarkerHint
  ): void => {
    const name = child.type.name;
    if (name === 'paragraph' || name === 'heading') {
      push(projected(child, { kind: name, indentLeft, paint: { marker } }, childPos), child, childPos);
    } else if (name === 'bulletList' || name === 'orderedList') {
      walkList(child, childPos, depth + 1);
    } else if (name === 'codeBlock') {
      push(projected(child, { kind: 'codeBlock', indentLeft }, childPos), child, childPos);
    } else if (name === 'horizontalRule') {
      push(
        projected(child, { kind: 'paragraph', indentLeft, paint: { rule: true } }, childPos),
        child,
        childPos
      );
    } else if (name === 'blockquote') {
      walkBlockquote(child, childPos);
    } else {
      throw new UnsupportedDocError(
        `[adapter] unsupported block kind '${name}' inside a list item at offset ${childPos}`
      );
    }
  };

  /** A list: each listItem's inner blocks project with the item's
   * marker hint; ordered indexes are computed per-list — a sibling
   * deletion reindexes the remainder (O(changed) reconversions). */
  const walkList = (list: PMNode, listPos: number, depth: number): void => {
    const kind: 'bullet' | 'ordered' = list.type.name === 'orderedList' ? 'ordered' : 'bullet';
    const styleType = list.attrs?.listStyleType ?? defaultListStyle(kind);
    let index = 0;
    list.forEach((item, itemRel) => {
      if (item.type.name !== 'listItem') {
        throw new UnsupportedDocError(
          `[adapter] unexpected node '${item.type.name}' inside a ${list.type.name}`
        );
      }
      index += 1;
      // PM forEach offsets are CONTENT-relative (Fragment.forEach
      // starts at 0): a child's position = parent position + 1 + rel.
      const itemPos = listPos + 1 + itemRel;
      const marker: ListMarkerHint = { kind, depth, index, styleType };
      const indentLeft = depth * LIST_INDENT_PX;
      item.forEach((child, rel) => {
        walkListItemChild(child, itemPos + 1 + rel, depth, indentLeft, marker);
      });
    });
  };

  /** A blockquote: each inner paragraph/heading projects with
   * indentLeft 32 and the blockquote paint hint (left border + tint). */
  const walkBlockquote = (bq: PMNode, bqPos: number): void => {
    bq.forEach((child, rel) => {
      // Content-relative offsets (see walkList): +1 for the parent's
      // opening boundary.
      const childPos = bqPos + 1 + rel;
      const name = child.type.name;
      if (name === 'paragraph' || name === 'heading') {
        push(
          projected(child, { kind: name, indentLeft: LIST_INDENT_PX, paint: { blockquote: true } }, childPos),
          child,
          childPos
        );
      } else if (name === 'bulletList' || name === 'orderedList') {
        walkList(child, childPos, 1);
      } else if (name === 'codeBlock') {
        push(projected(child, { kind: 'codeBlock', indentLeft: LIST_INDENT_PX }, childPos), child, childPos);
      } else if (name === 'horizontalRule') {
        push(
          projected(child, { kind: 'paragraph', indentLeft: LIST_INDENT_PX, paint: { rule: true } }, childPos),
          child,
          childPos
        );
      } else {
        throw new UnsupportedDocError(
          `[adapter] unsupported block kind '${name}' inside a blockquote at offset ${childPos}`
        );
      }
    });
  };

  pm.forEach((node, offset) => {
    const name = node.type.name;

    if (name === 'pageBreak') {
      // Forced page break on the FOLLOWING block. A trailing pageBreak
      // (nothing follows) has no block to force — the engine derives
      // pages from placed lines, so it is simply skipped.
      pendingBreakBefore = true;
      return;
    }

    if (name === 'paragraph' || name === 'heading') {
      push(projected(node, { kind: name, indentLeft: 0 }, offset), node, offset);
    } else if (name === 'bulletList' || name === 'orderedList') {
      walkList(node, offset, 1);
    } else if (name === 'blockquote') {
      walkBlockquote(node, offset);
    } else if (name === 'codeBlock') {
      push(projected(node, { kind: 'codeBlock', indentLeft: 0 }, offset), node, offset);
    } else if (name === 'horizontalRule') {
      // No atomic union member in the engine (receipt: Block =
      // paragraph | heading | codeBlock) — project as a single-line
      // paragraph with a rule paint hint. One LineBox can never
      // fragment across pages.
      push(projected(node, { kind: 'paragraph', indentLeft: 0, paint: { rule: true } }, offset), node, offset);
    } else {
      // THE THROW LIST (M6.1): only the true future features remain.
      throw new UnsupportedDocError(
        `[adapter] unsupported block kind '${name}' at offset ${offset}: future features ` +
          '(table, image, drawing) — the pageless fallback renders them until the engine supports them'
      );
    }
  });

  warnDroppedAttrs(dropped);

  return { doc: { blocks: semantic, baseStyle }, blocks };
}
