import { Extension, type Editor } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useConfigStore } from '@/lib/config/store';
import { useSearchStore } from '@/lib/editor/search/store';
import { useSidebarStore } from '@/lib/layout/sidebarStore';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { useLinkEditorStore } from '@/lib/editor/linkEditorStore';
import { getEffectiveKeybinding, matchesShortcut, SHORTCUTS } from '@/lib/shortcuts';
import { stepFontSize } from '@/lib/editor/fontSize';

const EDITOR_COMMAND_MAP: Record<string, (editor: Editor) => boolean> = {
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
};

export const DynamicShortcutsExtension = Extension.create({
  name: 'dynamicShortcuts',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('dynamicShortcuts'),
        props: {
          handleKeyDown(_view, event) {
            // Same reasoning as useAppShortcuts' identical guard.
            if (useSettingsDialogStore.getState().isOpen) return false;

            const { config } = useConfigStore.getState();

            for (const def of SHORTCUTS) {
              if (def.context !== 'editor') continue;
              const binding = getEffectiveKeybinding(config.keybindings, def.id);
              if (!binding) continue;
              if (!matchesShortcut(event, binding)) continue;

              const handler = EDITOR_COMMAND_MAP[def.id];
              if (!handler) continue;

              const handled = handler(editor);
              if (handled) {
                event.preventDefault();
                return true;
              }
            }

            return false;
          },
        },
      }),
    ];
  },
});
