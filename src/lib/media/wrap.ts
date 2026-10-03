import type { Editor } from '@tiptap/core';

/**
 * M-IMAGES-2 — the wrap conversions. THE MECHANICS RECEIPT (quoted in
 * InlineImageNode.ts): block and inline are DIFFERENT PM SHAPES —
 * conversion is a node-kind SWITCH (replaceWith), never a position
 * transform. All attrs copy BOTH WAYS (align/keepNext/radius ride
 * inert on the inline node) so block→inline→block returns geometry
 * EXACTLY (the return-exact pin).
 */

type Attrs = Record<string, unknown>;

function selectedImageNode(editor: Editor):
  | { kind: 'image' | 'inlineImage'; pos: number; attrs: Attrs; nodeSize: number }
  | null {
  const sel = editor.state.selection as unknown as {
    node?: { type?: { name?: string }; attrs?: Attrs; nodeSize?: number };
    from?: number;
  };
  const name = sel.node?.type?.name;
  if ((name !== 'image' && name !== 'inlineImage') || typeof sel.from !== 'number') return null;
  return { kind: name, pos: sel.from, attrs: sel.node?.attrs ?? {}, nodeSize: sel.node?.nodeSize ?? 1 };
}

/** The shared attr payload (the round-trip carrier set). */
function carryAttrs(attrs: Attrs): Attrs {
  return {
    src: attrs.src,
    width: attrs.width,
    height: attrs.height,
    alt: attrs.alt ?? '',
    align: attrs.align ?? 'left',
    keepNext: attrs.keepNext === true,
    radius: attrs.radius ?? 0,
  };
}

/** block image → inline (inside a paragraph at its position). */
export function convertBlockToInline(editor: Editor): void {
  const sel = selectedImageNode(editor);
  if (!sel || sel.kind !== 'image') return;
  const tr = editor.state.tr;
  // Replace [pos, pos+nodeSize) with a paragraph wrapping the inline
  // node — the Word placement (the image lands where the block was).
  tr.replaceWith(sel.pos, sel.pos + sel.nodeSize, editor.state.schema.nodes.paragraph!.create(
    { styleId: 'normal' },
    editor.state.schema.nodes.inlineImage!.create(carryAttrs(sel.attrs))
  ));
  editor.view.dispatch(tr);
}

/** inline image → block (extracted; the wrapper paragraph survives —
 *  its remaining text keeps its home). */
export function convertInlineToBlock(editor: Editor): void {
  const sel = selectedImageNode(editor);
  if (!sel || sel.kind !== 'inlineImage') return;
  const tr = editor.state.tr;
  // The parent paragraph's position: the inline node sits at sel.pos;
  // its parent starts before it. $from.before() gives the paragraph.
  const $from = editor.state.doc.resolve(sel.pos);
  const paraStart = $from.before();
  // Delete the inline node; insert the block image AFTER the paragraph
  // (the containing textblock cannot hold block content).
  tr.delete(sel.pos, sel.pos + sel.nodeSize);
  tr.insert(paraStart + editor.state.doc.nodeAt(paraStart)!.nodeSize, editor.state.schema.nodes.image!.create(carryAttrs(sel.attrs)));
  editor.view.dispatch(tr);
}

/** Set the wrap mode on the SELECTED image (any kind):
 *  'inline' → block→inline (or no-op);
 *  'front'/'behind' → inline→block first if needed, then float z
 *  (dx/dy preserved — mode switches never move the image). */
export function setWrapMode(
  editor: Editor,
  mode: 'inline' | 'front' | 'behind'
): void {
  const sel = selectedImageNode(editor);
  if (!sel) return;
  if (mode === 'inline') {
    if (sel.kind === 'image') convertBlockToInline(editor);
    return;
  }
  // Float modes need the BLOCK shape:
  let attrs = sel.attrs;
  if (sel.kind === 'inlineImage') {
    convertInlineToBlock(editor);
    // Re-resolve (the positions moved):
    const next = selectedImageNode(editor);
    if (!next || next.kind !== 'image') return;
    attrs = next.attrs;
    sel.pos = next.pos;
  }
  const existing = attrs.float as { dx?: number; dy?: number } | null | undefined;
  const float = {
    dx: existing?.dx ?? 0,
    dy: existing?.dy ?? 0,
    z: mode,
  };
  const tr = editor.state.tr;
  tr.setNodeAttribute(sel.pos, 'float', float);
  editor.view.dispatch(tr);
}

/** Float drag commit: dx/dy are ANCHOR-RELATIVE — the drag delta adds
 *  to the current offset (the engine re-derives + clamps the placed
 *  rect; the shell never clamps). A drag on an unfloated image
 *  FLOATS it (front, Word behavior). */
export function commitFloatDrag(
  editor: Editor,
  pos: number,
  currentFloat: { dx: number; dy: number; z: 'front' | 'behind' } | null,
  dragDx: number,
  dragDy: number
): void {
  const float = {
    dx: (currentFloat?.dx ?? 0) + dragDx,
    dy: (currentFloat?.dy ?? 0) + dragDy,
    z: currentFloat?.z ?? 'front',
  };
  const tr = editor.state.tr;
  tr.setNodeAttribute(pos, 'float', float);
  editor.view.dispatch(tr);
}
