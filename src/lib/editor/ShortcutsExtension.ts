import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { useConfigStore } from '@/lib/config/store';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { usePaletteStore } from '@/lib/palette/store';
import { getEffectiveKeybinding, matchesShortcut, SHORTCUTS } from '@/lib/shortcuts';
import { EDITOR_COMMAND_MAP } from '@/lib/editor/editorCommands';

export const DynamicShortcutsExtension = Extension.create({
  name: 'dynamicShortcuts',

  addProseMirrorPlugins() {
    const editor = this.editor;

    return [
      new Plugin({
        key: new PluginKey('dynamicShortcuts'),
        props: {
          handleKeyDown(_view, event) {
            // Same reasoning as useAppShortcuts' identical guard. NOTE
            // THE SYMMETRY: this guard and useAppShortcuts' are written
            // as a pair — any new "chrome surface suppresses editor
            // shortcuts" condition (settings, palette) MUST be added to
            // BOTH or keymap behavior silently forks by focus context.
            if (useSettingsDialogStore.getState().isOpen) return false;
            if (usePaletteStore.getState().isOpen) return false;

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
