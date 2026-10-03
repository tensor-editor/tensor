import type { Editor } from '@tiptap/core';

/**
 * M-IMAGES-1 — the caption bond: "Add Caption" inserts a paragraph
 * with styleId 'caption' (the built-in, editable like all built-ins —
 * the ToF #31 hook reads captions regardless of the display toggle)
 * directly after the selected image, and sets keepNext ON THE IMAGE —
 * the E-IMG-1 bond spelling (FlowPolicy.keepNext: the image's
 * placement and the caption's first line share a page, engine-pinned;
 * the shell never re-implements the bond, only writes the flag).
 * The new paragraph is focused immediately — type right away (Word
 * behavior).
 */
export function insertCaptionForImage(editor: Editor): void {
  const selection = editor.state.selection as unknown as {
    node?: { type?: { name?: string }; nodeSize?: number; attrs?: Record<string, unknown> };
    from?: number;
  };
  const node = selection.node;
  if (!node || node.type?.name !== 'image' || typeof selection.from !== 'number') return;
  const imagePos = selection.from;
  const after = imagePos + (node.nodeSize ?? 2);

  editor
    .chain()
    .focus()
    // The bond (the model fact):
    .command(({ tr, dispatch }) => {
      if (dispatch) tr.setNodeAttribute(imagePos, 'keepNext', true);
      return true;
    })
    // The caption paragraph (BlockIdExtension mints its blockId via
    // appendTransaction — styleId 'caption' is the style identity):
    .insertContentAt(after, { type: 'paragraph', attrs: { styleId: 'caption' } })
    .run();

  // Focus the caption's interior — type right away. The paragraph
  // starts at `after`; its first inside position is after + 1.
  editor.commands.setTextSelection(after + 1);
  editor.view.focus();
}
