import type { Node as PMNode } from '@tiptap/pm/model';
import type {
  Block,
  HeadingBlock,
  ParagraphBlock,
  Run,
  SemanticDoc,
  TextStyle,
} from '@tensor-editor/engine';

/**
 * STEP 2 (M4): PM doc -> engine SemanticDoc. Pure conversion, no
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
}

export interface AdapterResult {
  doc: SemanticDoc;
  blocks: AdapterBlock[];
}

/**
 * Level-based default styles arrive from the ADAPTER, never the engine
 * (engine TODO(M4), layout.ts: "level is not a layout input here").
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
// in the M4 semantic doc. NEVER silent — one dev warning per distinct
// dropped-set (enumerating them), not per block and not per occurrence.
const warnedDroppedSignatures = new Set<string>();

function warnDroppedAttrs(dropped: Set<string>): void {
  if (dropped.size === 0) return;
  if (!import.meta.env.DEV) return;
  const signature = [...dropped].sort().join(',');
  if (warnedDroppedSignatures.has(signature)) return;
  warnedDroppedSignatures.add(signature);
  console.warn(
    `[adapter] attributes present but dropped by the M4 semantic doc: ${signature}. ` +
      'Layout ignores them; they are preserved in the PM document and re-appear in .wpdoc saves.'
  );
}

function parseFontSize(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function parseLineHeight(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
  if (typeof value === 'string') {
    const parsed = parseFloat(value);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return undefined;
}

function isNonZero(value: unknown): boolean {
  return typeof value === 'number' && value !== 0;
}

export function pmDocToSemantic(pm: PMNode, baseStyle: TextStyle): AdapterResult {
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
        `[adapter] unsupported block kind '${kind}' at offset ${offset}: the M4 engine ` +
          'handles paragraph/heading only (blockquote, codeBlock, bulletList, orderedList, ' +
          'horizontalRule are deliberate loud throws until their milestones)'
      );
    }

    const blockId = node.attrs?.blockId;
    if (typeof blockId !== 'string' || !blockId) {
      throw new Error(
        `[adapter] top-level ${kind} at offset ${offset} has no blockId — ` +
          'BlockIdExtension must mint ids on creation/load/paste before any layout call'
      );
    }

    const headingDefault =
      kind === 'heading' ? HEADING_DEFAULTS[node.attrs.level ?? 1] : undefined;

    const runs: Run[] = [];
    let text = '';

    node.forEach((child) => {
      if (!child.isText || !child.text) {
        throw new Error(
          `[adapter] unsupported inline node '${child.type.name}' inside ${kind} ` +
            `at offset ${offset}: the M4 engine has no inline-break model (hardBreak included)`
        );
      }

      const textStyleMark = child.marks.find((m) => m.type.name === 'textStyle');
      const fontFamilyMark = child.marks.find((m) => m.type.name === 'fontFamily');

      const style: TextStyle = {
        fontFamily:
          typeof fontFamilyMark?.attrs?.fontFamily === 'string' && fontFamilyMark.attrs.fontFamily
            ? fontFamilyMark.attrs.fontFamily
            : baseStyle.fontFamily,
        fontSize:
          textStyleMark?.attrs?.fontSize != null
            ? parseFontSize(textStyleMark.attrs.fontSize, baseStyle.fontSize)
            : headingDefault?.fontSize ?? baseStyle.fontSize,
        bold: child.marks.some((m) => m.type.name === 'bold') || headingDefault?.bold,
        italic: child.marks.some((m) => m.type.name === 'italic'),
        lineHeight: parseLineHeight(node.attrs?.lineHeight),
      };

      // Dropped-attr detection — collected, warned once, never silent.
      if (textStyleMark?.attrs?.color != null) dropped.add('color');
      if (child.marks.some((m) => m.type.name === 'highlight')) dropped.add('highlight');
      if (child.marks.some((m) => m.type.name === 'underline')) dropped.add('underline');
      if (child.marks.some((m) => m.type.name === 'strike')) dropped.add('strike');
      if (child.marks.some((m) => m.type.name === 'link')) dropped.add('link');
      if (node.attrs?.textAlign) dropped.add('textAlign');
      if (isNonZero(node.attrs?.indent)) dropped.add('indent');
      if (isNonZero(node.attrs?.indentLeft)) dropped.add('indentLeft');
      if (isNonZero(node.attrs?.indentRight)) dropped.add('indentRight');
      if (isNonZero(node.attrs?.spaceBefore)) dropped.add('spaceBefore');
      if (isNonZero(node.attrs?.spaceAfter)) dropped.add('spaceAfter');

      runs.push({ text: child.text, style });
      text += child.text;
    });

    const flow = pendingBreakBefore ? { breakBefore: 'page' as const } : undefined;
    pendingBreakBefore = false;

    const block: ParagraphBlock | HeadingBlock =
      kind === 'heading'
        ? { id: blockId, kind: 'heading', level: node.attrs.level ?? 1, runs, ...(flow && { flow }) }
        : { id: blockId, kind: 'paragraph', runs, ...(flow && { flow }) };

    semantic.push(block);
    blocks.push({ id: blockId, runs, text, from: offset, to: offset + node.nodeSize });
  });

  warnDroppedAttrs(dropped);

  return { doc: { blocks: semantic, baseStyle }, blocks };
}
