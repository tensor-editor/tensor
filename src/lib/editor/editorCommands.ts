import type { Editor } from '@tiptap/core';
import { useSidebarStore } from '@/lib/layout/sidebarStore';
import { useSearchStore } from '@/lib/editor/search/store';
import { useLinkEditorStore } from '@/lib/editor/linkEditorStore';
import { stepFontSize } from '@/lib/editor/fontSize';
import { useDocumentStore } from '@/lib/document/store';

/**
 * The single editor-command path. Consumed by BOTH keydown surfaces —
 * ShortcutsExtension's ProseMirror plugin (typing the binding) and the
 * command palette (run by id) — so neither re-implements an editor
 * command. A command missing from this map simply doesn't fire.
 */
export const EDITOR_COMMAND_MAP: Record<string, (editor: Editor) => boolean> = {
  bold: (editor) => editor.commands.toggleBold(),
  italic: (editor) => editor.commands.toggleItalic(),
  underline: (editor) => editor.commands.toggleUnderline(),
  strike: (editor) => editor.commands.toggleStrike(),
  insertPageBreak: (editor) => editor.commands.insertPageBreak(),
  alignLeft: (editor) => editor.commands.setTextAlign('left'),
  alignCenter: (editor) => editor.commands.setTextAlign('center'),
  alignRight: (editor) => editor.commands.setTextAlign('right'),
  alignJustify: (editor) => editor.commands.setTextAlign('justify'),
  unorderedList: (editor) => editor.commands.toggleBulletList(),
  orderedList: (editor) => editor.commands.toggleOrderedList(),
  increaseIndent: (editor) => editor.commands.increaseIndent(),
  decreaseIndent: (editor) => editor.commands.decreaseIndent(),
  clearFormatting: (editor) => editor.commands.clearFormatting(),
  // ±2pt in chrome space, committed as px (fontSize.ts law).
  fontSizeUp: (editor) => stepFontSize(editor, 1),
  fontSizeDown: (editor) => stepFontSize(editor, -1),
  find: () => {
    const sidebarActive = useSidebarStore.getState().active?.id === 'search';
    if (sidebarActive) {
      useSearchStore.getState().bumpFocus();
    } else {
      useSearchStore.getState().open();
    }
    return true;
  },
  insertLink: () => {
    useLinkEditorStore.getState().requestInsert();
    return true;
  },

  // Style application (built-in paragraph styles) — no keybinding, but
  // palette-invoked, so they live on the SAME dispatch path rather than
  // a second mechanism. Ids are the styles registry's builtin ids
  // (builtins.ts); applying is the styleCommands law: sets styleId or
  // converts the node for heading entries / back for the rest.
  applyStyleNormal: (editor) => editor.chain().focus().applyParagraphStyle('normal').run(),
  applyStyleHeading1: (editor) => editor.chain().focus().applyParagraphStyle('heading-1').run(),
  applyStyleHeading2: (editor) => editor.chain().focus().applyParagraphStyle('heading-2').run(),
  applyStyleHeading3: (editor) => editor.chain().focus().applyParagraphStyle('heading-3').run(),
  applyStyleQuote: (editor) => editor.chain().focus().applyParagraphStyle('quote').run(),
};

/** Run an editor command by id against the live editor instance
 *  (from the document store). Returns the command's own handled flag,
 *  or false when there is no editor / no such command. */
export function runEditorCommand(id: string): boolean {
  const editor = useDocumentStore.getState().editor;
  if (!editor) return false;
  const handler = EDITOR_COMMAND_MAP[id];
  if (!handler) return false;
  return handler(editor);
}
