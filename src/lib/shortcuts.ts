export interface ShortcutDefinition {
  id: string;
  label: string;
  keys: string;
  /**
   * 'editor' -- dispatched by DynamicShortcutsExtension's ProseMirror
   *   plugin; only fires while the editor has focus. Fully rebindable.
   * 'app' -- dispatched by useAppShortcuts' global window listener;
   *   fires regardless of focus. Fully rebindable.
   * 'os' -- owned by the operating system / window manager. Listed for
   *   documentation/visibility only, never rebindable here.
   */
  context: 'editor' | 'app' | 'os';
  category: string;
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { id: 'save', label: 'Save', keys: 'ctrl+s', context: 'app', category: 'General' },
  { id: 'openSettings', label: 'Open Settings', keys: 'ctrl+,', context: 'app', category: 'General' },
  { id: 'undo', label: 'Undo', keys: 'ctrl+z', context: 'os', category: 'General' },
  { id: 'redo', label: 'Redo', keys: 'ctrl+y', context: 'os', category: 'General' },
  { id: 'insertPageBreak', label: 'Insert Page Break', keys: 'ctrl+enter', context: 'editor', category: 'General' },

  { id: 'find', label: 'Find & Replace', keys: 'ctrl+f', context: 'editor', category: 'Search' },

  { id: 'bold', label: 'Bold', keys: 'ctrl+b', context: 'editor', category: 'Formatting' },
  { id: 'italic', label: 'Italic', keys: 'ctrl+i', context: 'editor', category: 'Formatting' },
  { id: 'underline', label: 'Underline', keys: 'ctrl+u', context: 'editor', category: 'Formatting' },
  { id: 'strike', label: 'Strikethrough', keys: 'ctrl+shift+x', context: 'editor', category: 'Formatting' },
  { id: 'clearFormatting', label: 'Clear Formatting', keys: 'ctrl+\\', context: 'editor', category: 'Formatting' },
  { id: 'fontSizeUp', label: 'Increase Font Size', keys: 'ctrl+shift+.', context: 'editor', category: 'Formatting' },
  { id: 'fontSizeDown', label: 'Decrease Font Size', keys: 'ctrl+shift+,', context: 'editor', category: 'Formatting' },

  { id: 'insertLink', label: 'Hyperlink', keys: 'ctrl+k', context: 'editor', category: 'Insert' },

  { id: 'alignLeft', label: 'Align Left', keys: 'ctrl+shift+l', context: 'editor', category: 'Paragraphs' },
  { id: 'alignCenter', label: 'Align Center', keys: 'ctrl+shift+e', context: 'editor', category: 'Paragraphs' },
  { id: 'alignRight', label: 'Align Right', keys: 'ctrl+shift+r', context: 'editor', category: 'Paragraphs' },
  { id: 'alignJustify', label: 'Justify', keys: 'ctrl+shift+j', context: 'editor', category: 'Paragraphs' },
  { id: 'unorderedList', label: 'Bullet List', keys: 'ctrl+shift+8', context: 'editor', category: 'Paragraphs' },
  { id: 'orderedList', label: 'Numbered List', keys: 'ctrl+shift+7', context: 'editor', category: 'Paragraphs' },
  { id: 'increaseIndent', label: 'Increase Indent', keys: 'ctrl+]', context: 'editor', category: 'Paragraphs' },
  { id: 'decreaseIndent', label: 'Decrease Indent', keys: 'ctrl+[', context: 'editor', category: 'Paragraphs' },
];

/** Returns the id's real live binding — user override if one exists in
 *  config, otherwise the registry default. ALWAYS use this rather than
 *  indexing config.keybindings[id] directly — a persisted config that
 *  predates a newly-added shortcut still resolves to a sane default
 *  instead of silently returning undefined (the exact class of bug this
 *  project has been bitten by before with wrong config paths). */
export function getEffectiveKeybinding(keybindings: Record<string, string>, id: string): string {
  const def = SHORTCUTS.find((s) => s.id === id);
  return keybindings[id] ?? def?.keys ?? '';
}

/** Shift-glyph aliases: pressing shift+period/comma produces the
 * SHIFTED glyph in the key event ('>' / '<' on US layouts), so a
 * binding spelled with the unshifted key ('ctrl+shift+.') must match
 * the event's shifted glyph, and a recorded binding spelled with the
 * shifted glyph ('ctrl+shift+>') must match layouts that deliver the
 * unshifted key. Word documents these as Ctrl+Shift+> / Ctrl+Shift+<;
 * the registry spells the physical keys, both match. */
const SHIFT_GLYPH_ALIASES: Record<string, string> = {
  '>': '.',
  '<': ',',
};

export function matchesShortcut(e: KeyboardEvent, shortcut: string): boolean {
  if (!shortcut) return false;
  const parts = shortcut.toLowerCase().split('+');
  const key = parts.pop();
  if (key == null) return false;
  const eventKey = e.key.toLowerCase();
  return (
    (e.ctrlKey || e.metaKey) === parts.includes('ctrl') &&
    e.shiftKey === parts.includes('shift') &&
    e.altKey === parts.includes('alt') &&
    (eventKey === key ||
      SHIFT_GLYPH_ALIASES[eventKey] === key ||
      SHIFT_GLYPH_ALIASES[key] === eventKey)
  );
}

/** Converts a live KeyboardEvent into this app's canonical shortcut
 *  string format, for the "press a key combination" rebind UI. Returns
 *  null while only modifier keys are held (caller should keep listening),
 *  or if no real modifier is held at all — bare-letter shortcuts aren't
 *  supported anywhere in this app today, and allowing one here would risk
 *  silently binding a shortcut to a plain printable character and
 *  breaking normal typing. */
export function captureShortcutString(e: KeyboardEvent): string | null {
  if (['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return null;
  if (e.key === 'Escape') return null; // reserved: always cancels recording

  const hasModifier = e.ctrlKey || e.metaKey || e.shiftKey || e.altKey;
  if (!hasModifier) return null;

  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('ctrl');
  if (e.shiftKey) parts.push('shift');
  if (e.altKey) parts.push('alt');

  let key = e.key.toLowerCase();
  if (key === ' ') key = 'space';
  parts.push(key);

  return parts.join('+');
}

/** Finds another (non-'os') shortcut currently bound to `candidateKeys`,
 *  excluding `excludeId` itself. Used by the rebind UI to flag conflicts
 *  against real current bindings, not just the static defaults. */
export function findLiveConflict(
  keybindings: Record<string, string>,
  excludeId: string,
  candidateKeys: string,
): ShortcutDefinition | null {
  if (!candidateKeys) return null;
  return (
    SHORTCUTS.find(
      (s) =>
        s.id !== excludeId &&
        s.context !== 'os' &&
        getEffectiveKeybinding(keybindings, s.id) === candidateKeys,
    ) ?? null
  );
}

/** Dev-time sanity check that the DEFAULT bindings (before any user
 *  customization) don't collide with each other. */
export function findShortcutConflicts(): string[][] {
  const seen = new Map<string, string[]>();
  for (const s of SHORTCUTS) {
    const list = seen.get(s.keys) ?? [];
    list.push(s.id);
    seen.set(s.keys, list);
  }
  return [...seen.values()].filter((ids) => ids.length > 1);
}

export function formatShortcutParts(shortcut: string): string[] {
  return shortcut.split('+').map((part) => {
    if (part === 'ctrl') return 'Ctrl';
    if (part === 'shift') return 'Shift';
    if (part === 'alt') return 'Alt';
    if (part === 'meta') return 'Cmd';
    return part.toUpperCase();
  });
}
