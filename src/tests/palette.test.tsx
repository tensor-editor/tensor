import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, render, renderHook, fireEvent } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { useConfigStore, ZOOM_MIN, ZOOM_MAX } from '@/lib/config/store';
import { DEFAULT_CONFIG } from '@/lib/config/schema';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { useSidebarStore } from '@/lib/layout/sidebarStore';
import { useStyleDialogStore } from '@/lib/styles/dialogStore';
import { usePaletteStore } from '@/lib/palette/store';
import { CommandPalette } from '@/components/palette/CommandPalette';
import { COMMANDS, getCommand, getCommandByMenuEvent } from '@/lib/commands/registry';
import { filterCommands } from '@/lib/commands/useAppCommands';
import { EDITOR_COMMAND_MAP } from '@/lib/editor/editorCommands';
import { useAppShortcuts } from '@/lib/shortcuts/useAppShortcuts';
import {
  SHORTCUTS,
  getEffectiveKeybinding,
  findShortcutConflicts,
} from '@/lib/shortcuts';
import { renderTensor } from './harness';
import { writeTextFile } from '@tauri-apps/plugin-fs';

// ─── Tauri surface mocks (fs/path/window — quit & recovery paths) ────────

vi.mock('@tauri-apps/plugin-fs', () => ({
  writeTextFile: vi.fn(async () => {}),
  exists: vi.fn(async () => false),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/appdata'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

const windowMocks = vi.hoisted(() => ({ close: vi.fn() }));
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({ close: windowMocks.close }),
}));

// ─── Store resets (module singletons persist across tests) ───────────────

beforeEach(() => {
  useDocumentStore.setState({
    isDirty: false,
    filePath: null,
    revision: 0,
  });
  usePaletteStore.setState({ isOpen: false, editorContext: false });
  useSettingsDialogStore.setState({ isOpen: false });
  useStyleDialogStore.setState({ open: false, editingId: null, kind: 'paragraph' });
  useSidebarStore.setState({ active: null });
  useDocumentPropertiesStore.setState({ isOpen: false, statsIsOpen: false });
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      theme: 'light',
      editor: { ...state.config.editor, zoomLevel: 100, showNonPrintingChars: false },
      // Re-seed from the registry defaults so a rebinding test can't
      // leak into the next one.
      keybindings: { ...DEFAULT_CONFIG.keybindings },
    },
  }));
});

afterEach(() => {
  vi.clearAllMocks();
});

/** jsdom lacks elementFromPoint (PM mouse handlers use it). */
beforeAll(() => {
  document.elementFromPoint = () =>
    document.querySelector('.ProseMirror') ?? document.body;
});

function openPalette(editorContext: boolean) {
  // Bypass open()'s live-focus capture — these tests pin the FILTER,
  // not the capture (that's covered in its own test below).
  act(() => {
    usePaletteStore.setState({ isOpen: true, editorContext });
  });
}

function paletteItem(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="palette-item-${id}"]`);
}

function paletteHint(id: string): HTMLElement | null {
  return document.querySelector(`[data-testid="palette-hint-${id}"]`);
}

// ─── 1. Menu ⇄ registry: single source of truth, no drift ─────────────────

/** RECEIPT — the Rust-side MenuItem ids (src-tauri/src/lib.rs, lines
 *  17-55). The native menu can only emit these payloads; each must
 *  map to EXACTLY ONE registry entry, or the menu would dispatch a
 *  different action than the palette shows. */
const RUST_MENU_EVENT_IDS = [
  'menu-new',
  'menu-open',
  'menu-save',
  'menu-save-as',
  'menu-quit',
  'menu-undo',
  'menu-redo',
  'menu-cut',
  'menu-copy',
  'menu-paste',
  'menu-toggle-dark-mode',
] as const;

describe('registry ⇄ menu parity (drift is structurally impossible)', () => {
  it('every Rust menu id resolves to exactly one registry command', () => {
    for (const id of RUST_MENU_EVENT_IDS) {
      const matches = COMMANDS.filter((c) => c.menuEventId === id);
      expect(matches, id).toHaveLength(1);
    }
  });

  it('no orphan menuEventIds — the registry carries nothing the Rust menu cannot emit', () => {
    const registryMenuIds = COMMANDS.filter((c) => c.menuEventId).map((c) => c.menuEventId);
    for (const id of registryMenuIds) {
      expect(RUST_MENU_EVENT_IDS, `orphan menuEventId ${id}`).toContain(id);
    }
  });

  it('toggle-dark-mode is ONE entry serving both menu and palette (no duplicate non-menu dark action)', () => {
    const darkCommands = COMMANDS.filter(
      (c) => c.keywords.includes('dark') || c.title.toLowerCase().includes('dark'),
    );
    expect(darkCommands.map((c) => c.id)).toEqual(['toggleDarkMode']);
    expect(getCommandByMenuEvent('menu-toggle-dark-mode')!.id).toBe('toggleDarkMode');
  });

  it('registry ids are unique', () => {
    const ids = COMMANDS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('hidden is PALETTE-only: "new" (stub) never shows in the palette, but the menu still dispatches it', () => {
    expect(filterCommands(false).some((c) => c.id === 'new')).toBe(false);
    expect(filterCommands(true).some((c) => c.id === 'new')).toBe(false);
    // Menu path still resolves and runs the stub (the console.warn
    // receipt) without throwing:
    expect(() => getCommandByMenuEvent('menu-new')!.run()).not.toThrow();
  });

  it('quit IS a palette command (amendment 1a) and carries the safe-quit marker', () => {
    const quit = getCommand('quit')!;
    expect(filterCommands(false).some((c) => c.id === 'quit')).toBe(true);
    expect(quit.requiresSafeQuit).toBe(true);
    expect(quit.menuEventId).toBe('menu-quit');
  });

  it('quit and "new-when-real" are the only safe-quit surfaces', () => {
    expect(COMMANDS.filter((c) => c.requiresSafeQuit).map((c) => c.id)).toEqual(['quit']);
  });
});

// ─── 2. Palette shortcut wiring ──────────────────────────────────────────

describe('palette shortcut', () => {
  it('registered: ctrl+shift+p, app context (collision-free — STEP 0 receipt)', () => {
    const def = SHORTCUTS.find((s) => s.id === 'palette')!;
    expect(def.keys).toBe('ctrl+shift+p');
    expect(def.context).toBe('app');
    expect(findShortcutConflicts()).toEqual([]); // no default collisions at all
  });

  it('older persisted configs resolve via the registry fallback (fontSizeUp precedent)', () => {
    // A config object saved BEFORE 'palette' existed has no entry —
    // getEffectiveKeybinding still returns the default.
    expect(getEffectiveKeybinding({}, 'palette')).toBe('ctrl+shift+p');
    expect(getEffectiveKeybinding({}, 'fontSizeUp')).toBe('ctrl+shift+.'); // the precedent
  });

  it('auto-seeded into DEFAULT_KEYBINDINGS from the registry', () => {
    expect(DEFAULT_CONFIG.keybindings.palette).toBe('ctrl+shift+p');
  });

  it('live: ctrl+shift+p opens the palette via useAppShortcuts', () => {
    renderHook(() => useAppShortcuts());
    act(() => {
      fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    });
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it('rebound: ctrl+/ opens it too (settings rebind path)', () => {
    useConfigStore.getState().setKeybinding('palette', 'ctrl+/');
    renderHook(() => useAppShortcuts());
    act(() => {
      fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    });
    expect(usePaletteStore.getState().isOpen).toBe(false); // old binding gone
    act(() => {
      fireEvent.keyDown(window, { key: '/', ctrlKey: true });
    });
    expect(usePaletteStore.getState().isOpen).toBe(true);
  });

  it('suppressed while the Settings dialog is open (keymap-layer guard symmetry)', () => {
    renderHook(() => useAppShortcuts());
    act(() => {
      useSettingsDialogStore.getState().open();
      fireEvent.keyDown(window, { key: 'p', ctrlKey: true, shiftKey: true });
    });
    expect(usePaletteStore.getState().isOpen).toBe(false);
  });

  it('suppressed while the palette itself is open — ctrl+s does not save behind it', async () => {
    renderTensor('<p>hello</p>');
    // renderTensor's initial setContent triggers Editor's onUpdate →
    // markDirty (the receipt); pin the pristine state this test means.
    act(() => {
      useDocumentStore.setState({ isDirty: false });
    });
    const saveSpy = vi.spyOn(useDocumentStore.getState(), 'save');
    renderHook(() => useAppShortcuts());
    openPalette(true);
    act(() => {
      fireEvent.keyDown(window, { key: 's', ctrlKey: true });
    });
    expect(saveSpy).not.toHaveBeenCalled();
    expect(useDocumentStore.getState().isDirty).toBe(false);
  });

  it('ShortcutsExtension guard symmetry: editor shortcuts suppressed while the palette is open', () => {
    const { editor } = renderTensor('<p>hello</p>');
    const viewDom = editor.view.dom;
    act(() => {
      viewDom.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    });
    expect(editor.isActive('bold')).toBe(true); // control: normally works
    openPalette(true);
    act(() => {
      viewDom.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', ctrlKey: true, bubbles: true }));
    });
    // No SECOND toggle while the palette is open — bold stays ON.
    expect(editor.isActive('bold')).toBe(true);
  });
});

// ─── 3. Context filtering & enablement in the palette UI ────────────────

describe('palette UI', () => {
  it('editor-context commands are absent when the palette was opened outside the editor', () => {
    render(<CommandPalette />);
    openPalette(false);
    expect(paletteItem('saveAs')).not.toBeNull();
    expect(paletteItem('bold')).toBeNull();
    expect(paletteItem('insertPageBreak')).toBeNull();
    expect(paletteItem('applyStyleHeading1')).toBeNull();
  });

  it('editor-context commands surface when opened from the editor', () => {
    render(<CommandPalette />);
    openPalette(true);
    expect(paletteItem('bold')).not.toBeNull();
    expect(paletteItem('insertPageBreak')).not.toBeNull();
    expect(paletteItem('applyStyleQuote')).not.toBeNull();
  });

  it('open() captures the editor-focus context at open time', () => {
    renderTensor('<p>hello</p>');
    // Not focused → editorContext false.
    act(() => {
      usePaletteStore.getState().open();
    });
    expect(usePaletteStore.getState().editorContext).toBe(false);
    usePaletteStore.getState().close();
    // Focused → true.
    const { editor } = { editor: useDocumentStore.getState().editor! };
    act(() => {
      editor.view.dom.focus();
      editor.commands.focus();
    });
    act(() => {
      usePaletteStore.getState().open();
    });
    expect(usePaletteStore.getState().editorContext).toBe(true);
  });

  it('enablement: save is cleared while !isDirty, appears once marked dirty', () => {
    render(<CommandPalette />);
    openPalette(false);
    expect(paletteItem('save')).toBeNull();
    act(() => {
      useDocumentStore.getState().markDirty();
    });
    expect(paletteItem('save')).not.toBeNull();
  });

  it('enablement: undo/redo track history availability', () => {
    renderTensor('<p>hello</p>');
    render(<CommandPalette />);
    // The initial setContent IS an undoable history entry (receipt:
    // canUndo() is true right after mount) — honest assertion:
    openPalette(false);
    expect(paletteItem('undo')).not.toBeNull();
    const { editor } = useDocumentStore.getState();
    act(() => {
      editor!.commands.undo(); // history empties → item cleared
    });
    expect(paletteItem('undo')).toBeNull();
    act(() => {
      editor!.commands.insertContent('more'); // new entry → back
    });
    expect(paletteItem('undo')).not.toBeNull();
  });

  it('search: keywords find actions — "save as" surfaces Save As, not Save', () => {
    render(<CommandPalette />);
    openPalette(false);
    act(() => {
      useDocumentStore.getState().markDirty(); // make plain save eligible too
    });
    const input = document.querySelector('[data-testid="palette-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'save as' } });
    });
    expect(paletteItem('saveAs')).not.toBeNull();
    // cmdk's fuzzy filter also keeps plain "Save" alive — but scores
    // the exact "save as" substring higher, so Save As ranks FIRST.
    const first = document.querySelector('[cmdk-item]');
    expect(first?.getAttribute('data-testid')).toBe('palette-item-saveAs');
  });

  it('search misses render the empty state; footer hint line is present', () => {
    render(<CommandPalette />);
    openPalette(false);
    const input = document.querySelector('[data-testid="palette-input"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(input, { target: { value: 'zzzz-no-such-command' } });
    });
    expect(document.body.textContent).toContain('No matching commands.');
    expect(document.querySelector('[data-testid="palette-footer"]')?.textContent).toContain(
      '↑↓ navigate · ↵ run · esc close',
    );
  });

  it('hint renders the USER binding and updates live on rebind (palette + bold)', () => {
    render(<CommandPalette />);
    openPalette(true);
    // Default binding:
    expect(paletteHint('palette')?.textContent).toContain('Ctrl');
    expect(paletteHint('palette')?.textContent).toContain('P');
    expect(paletteHint('bold')?.textContent).toContain('B');
    // Rebind palette → hint follows:
    act(() => {
      useConfigStore.getState().setKeybinding('palette', 'ctrl+/');
    });
    expect(paletteHint('palette')?.textContent).toContain('/');
    // Rebind bold → bold's hint follows:
    act(() => {
      useConfigStore.getState().setKeybinding('bold', 'ctrl+shift+b');
    });
    expect(paletteHint('bold')?.textContent).toContain('Shift');
  });

  it('closing the palette returns focus to the editor with the selection intact', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    act(() => {
      editor.view.dom.focus();
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.focus();
    });
    const headBefore = editor.state.selection.head;
    act(() => {
      usePaletteStore.getState().open(); // focused → editorContext true
    });
    expect(usePaletteStore.getState().editorContext).toBe(true);
    await act(async () => {
      usePaletteStore.getState().close();
    }); // flushes the deferred refocus past the dialog unmount
    expect(editor.isFocused).toBe(true);
    expect(editor.state.selection.head).toBe(headBefore); // caret intact
  });
});

// ─── 4. Dispatch: palette run == menu run (the drift-proof test) ────────

describe('dispatch equivalence', () => {
  it('menu path and palette path run the SAME save (identical store effect)', () => {
    const saveSpy = vi.spyOn(useDocumentStore.getState(), 'save');
    // Menu path:
    void getCommandByMenuEvent('menu-save')!.run();
    // Palette path:
    void getCommand('save')!.run();
    expect(saveSpy).toHaveBeenCalledTimes(2);
    saveSpy.mockRestore();
  });

  it('menu path and palette path run the SAME undo (identical doc effect)', () => {
    renderTensor('<p>hello</p>');
    const editor = useDocumentStore.getState().editor!;
    // Menu path undoes a real edit:
    act(() => {
      editor.commands.insertContent(' MORE');
    });
    expect(editor.state.doc.textContent).toContain('MORE');
    void getCommandByMenuEvent('menu-undo')!.run();
    expect(editor.state.doc.textContent).not.toContain('MORE');
    // Palette path — identical effect:
    act(() => {
      editor.commands.insertContent(' AGAIN');
    });
    void getCommand('undo')!.run();
    expect(editor.state.doc.textContent).not.toContain('AGAIN');
  });

  it('palette bold dispatches the SAME path ShortcutsExtension uses (EDITOR_COMMAND_MAP), and it applies', () => {
    renderTensor('<p>hello</p>');
    const editor = useDocumentStore.getState().editor!;
    const boldHandler = EDITOR_COMMAND_MAP.bold!;
    const handlerSpy = vi.fn(boldHandler);
    EDITOR_COMMAND_MAP.bold = handlerSpy;
    try {
      void getCommand('bold')!.run();
      expect(handlerSpy).toHaveBeenCalledWith(editor);
      expect(editor.isActive('bold')).toBe(true);
    } finally {
      EDITOR_COMMAND_MAP.bold = boldHandler;
    }
  });

  it('non-menu actions flip their respective stores', () => {
    void getCommand('openSettings')!.run();
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);

    void getCommand('documentProperties')!.run();
    expect(useDocumentPropertiesStore.getState().isOpen).toBe(true);

    void getCommand('documentStatistics')!.run();
    expect(useDocumentPropertiesStore.getState().statsIsOpen).toBe(true);

    void getCommand('findSidebar')!.run();
    expect(useSidebarStore.getState().active).toEqual({ id: 'search', anchor: 'right' });

    void getCommand('createStyle')!.run();
    expect(useStyleDialogStore.getState().open).toBe(true);
    expect(useStyleDialogStore.getState().editingId).toBeNull();

    void getCommand('toggleDarkMode')!.run();
    expect(useConfigStore.getState().config.theme).toBe('dark');
    // ...and it is the same entry the menu dispatches:
    expect(getCommandByMenuEvent('menu-toggle-dark-mode')!.id).toBe('toggleDarkMode');

    void getCommand('toggleNPC')!.run();
    expect(useConfigStore.getState().config.editor.showNonPrintingChars).toBe(true);
  });

  it('zoom commands go through the clamped setter (50–200 law)', () => {
    void getCommand('zoomIn')!.run();
    expect(useConfigStore.getState().config.editor.zoomLevel).toBe(110);
    void getCommand('zoomOut')!.run();
    expect(useConfigStore.getState().config.editor.zoomLevel).toBe(100);
    useConfigStore.getState().setZoomLevel(999);
    expect(useConfigStore.getState().config.editor.zoomLevel).toBe(ZOOM_MAX);
    useConfigStore.getState().setZoomLevel(-5);
    expect(useConfigStore.getState().config.editor.zoomLevel).toBe(ZOOM_MIN);
    void getCommand('zoomReset')!.run();
    expect(useConfigStore.getState().config.editor.zoomLevel).toBe(100);
  });
});

// ─── 5. Safe quit: recovery snapshot before close ────────────────────────

describe('safe quit (requiresSafeQuit)', () => {
  it('dirty doc → recovery snapshot written to appDataDir/recovery/ with current content, THEN close', async () => {
    const { editor } = renderTensor('<p>quit me</p>');
    act(() => {
      useDocumentStore.setState({ isDirty: true, filePath: null });
    });

    await act(async () => {
      await getCommand('quit')!.run();
    });

    expect(windowMocks.close).toHaveBeenCalledTimes(1);
    expect(writeTextFile).toHaveBeenCalledTimes(1);
    // Same path + format as the autosave recovery (recovery.ts law):
    const [path, contents] = (writeTextFile as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      string,
    ];
    expect(path).toMatch(/^\/appdata\/recovery\/[\w-]+\.wpdoc$/);
    const file = JSON.parse(contents);
    expect(file.version).toBeTypeOf('number');
    expect(file.docJSON).toEqual(editor.getJSON());
    expect(file.metadata.originalPath).toBeUndefined();
    // Order: snapshot BEFORE close, never after.
    expect((writeTextFile as ReturnType<typeof vi.fn>).mock.invocationCallOrder[0]).toBeLessThan(
      windowMocks.close.mock.invocationCallOrder[0],
    );
  });

  it('clean doc → close without a recovery write', async () => {
    renderTensor('<p>clean</p>');
    // renderTensor's initial setContent triggers Editor's onUpdate →
    // markDirty (the receipt); an untouched, saved doc is what "clean"
    // means here:
    act(() => {
      useDocumentStore.setState({ isDirty: false });
    });
    await act(async () => {
      await getCommand('quit')!.run();
    });
    expect(windowMocks.close).toHaveBeenCalledTimes(1);
    expect(writeTextFile).not.toHaveBeenCalled();
  });
});
