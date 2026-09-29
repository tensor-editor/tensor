import { useDocumentStore } from '@/lib/document/store';
import { COMMANDS } from './registry';
import type { CommandAction } from './registry';

/**
 * The live, availability-filtered command list for the palette.
 *
 * The registry itself is a plain module (no store needed — commands are
 * static); predicates read live store state, so this hook subscribes
 * to the document-store slices they touch. `revision` bumps on every
 * markDirty — the cheap reactive proxy for history/enablement changes
 * (undo/redo availability). Keybinding-driven re-renders are not
 * needed here: hints are read per-item via useShortcutDisplay.
 */
export function useAppCommands(editorContext: boolean): CommandAction[] {
  // Reactive triggers for the enablement predicates — reading the
  // values (not using them directly) is the point.
  useDocumentStore((s) => s.revision);
  useDocumentStore((s) => s.isDirty);
  useDocumentStore((s) => s.editor);

  return filterCommands(editorContext);
}

/** Pure filter — exported for tests and non-React dispatch surfaces. */
export function filterCommands(editorContext: boolean): CommandAction[] {
  return COMMANDS.filter((c) => {
    const contexts = c.contexts ?? ['app'];
    const contextVisible =
      contexts.includes('app') || (editorContext && contexts.includes('editor'));
    return contextVisible && c.hidden?.() !== true && c.enablement?.() !== false;
  });
}
