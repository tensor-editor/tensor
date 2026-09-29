import { useEffect } from 'react';
import { useConfigStore } from '@/lib/config/store';
import { usePaletteStore } from '@/lib/palette/store';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { getCommand } from '@/lib/commands/registry';
import { getEffectiveKeybinding, matchesShortcut, SHORTCUTS } from '@/lib/shortcuts';

/**
 * App-context shortcuts dispatch through the command registry
 * (registry.ts) — the same run() bodies the menu and palette use.
 * Every app-context SHORTCUTS id resolves to a registry command
 * ('palette' included: its run toggles the palette store).
 */
export function useAppShortcuts() {
  const keybindings = useConfigStore((s) => s.config.keybindings);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      // While Settings is open, every app-level shortcut is suppressed —
      // closing is left entirely to the dialog's own X/Escape/overlay
      // click. Without this, e.g. Ctrl+S would silently save the
      // document in the background while just browsing preferences.
      // NOTE THE SYMMETRY: this guard and ShortcutsExtension's are
      // written as a pair — any new "chrome surface suppresses
      // shortcuts" condition (settings, palette) MUST be added to BOTH
      // or keymap behavior silently forks by focus context.
      if (useSettingsDialogStore.getState().isOpen) return;
      if (usePaletteStore.getState().isOpen) return;

      for (const def of SHORTCUTS) {
        if (def.context !== 'app') continue;
        const binding = getEffectiveKeybinding(keybindings, def.id);
        if (!binding || !matchesShortcut(e, binding)) continue;

        const command = getCommand(def.id);
        if (command) {
          void command.run();
          e.preventDefault();
          return;
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [keybindings]);
}
