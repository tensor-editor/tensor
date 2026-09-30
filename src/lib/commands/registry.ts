import type { LucideIcon } from 'lucide-react';
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  CaseSensitive,
  ClipboardPaste,
  Copy,
  FileSearchCorner,
  FileStack,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  IndentDecrease,
  IndentIncrease,
  Info,
  Italic,
  Library,
  Link2,
  List,
  ListOrdered,
  LogOut,
  Maximize,
  Moon,
  Pilcrow,
  Plus,
  Quote,
  Redo2,
  RemoveFormatting,
  Save,
  SaveAll,
  Scissors,
  SeparatorHorizontal,
  Settings,
  Sparkles,
  Strikethrough,
  Underline as UnderlineIcon,
  Undo2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { pasteFromSystemClipboard } from '@/lib/editor/clipboard';
import { runEditorCommand } from '@/lib/editor/editorCommands';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { saveRecoveryCopy } from '@/lib/document/recovery';
import { useDocumentStore } from '@/lib/document/store';
import { useSidebarStore } from '@/lib/layout/sidebarStore';
import { useConfigStore } from '@/lib/config/store';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { usePaletteStore } from '@/lib/palette/store';
import { useStyleDialogStore } from '@/lib/styles/dialogStore';
import { useFontBrowserStore } from '@/lib/fonts/browserStore';

/**
 * M-PALETTE. The declarative app command registry — the single source
 * of truth for app actions, consumed by BOTH the native menu
 * (useMenuEvents dispatches menu-event payloads through here) and the
 * command palette. Menu and palette cannot drift: they run the same
 * run() bodies.
 *
 * Editor commands are NOT re-implemented here — each entry dispatches
 * through the shared EDITOR_COMMAND_MAP path (editorCommands.ts), the
 * same one ShortcutsExtension uses for keybindings.
 */

export type CommandGroup = 'actions' | 'format' | 'navigate';

export interface CommandAction {
  id: string;
  title: string;
  icon?: LucideIcon;
  group: CommandGroup;
  /** Invocation contexts. 'app' = always available (default);
   *  'editor' = only while the editor surface had focus at palette
   *  open time. */
  contexts?: ('app' | 'editor')[];
  /** The Tauri native-menu item this action backs (menu-event
   *  payload id, src-tauri/src/lib.rs). Present = the menu dispatches
   *  this same registry entry. */
  menuEventId?: string;
  /** SHORTCUTS id whose LIVE binding (user-rebindable) the palette
   *  renders as a hint via getEffectiveKeybinding. */
  shortcutId?: string;
  keywords: string[];
  /** Palette VISIBILITY filter only — run() and menu dispatch ignore
   *  it, so a hidden action still fires from the menu. */
  hidden?: () => boolean;
  /** Destructive surface marker (quit; 'new' once real): run() must
   *  first persist a recovery snapshot of unsaved work via the
   *  existing autosave recovery path — same format, same recovery/
   *  location, so the existing restore flow picks it up with zero new
   *  machinery. */
  requiresSafeQuit?: boolean;
  /** Palette availability filter only — run() ignores it. Must be
   *  cheaply/synchronously readable from store state; if not, omit
   *  (never guess). */
  enablement?: () => boolean;
  run: () => void | Promise<void>;
}

const doc = () => useDocumentStore.getState();
const cfg = () => useConfigStore.getState();

/** enablement: cheap + sync (store reads, editor.can()). */
const canUndo = () => doc().editor?.can().undo() ?? false;
const canRedo = () => doc().editor?.can().redo() ?? false;
const isDirty = () => doc().isDirty;

/** Editor-context formatting entry: dispatches the shared
 *  ShortcutsExtension command path by id — never re-implemented. */
function editorCommand(id: string, def: Omit<CommandAction, 'id' | 'run' | 'contexts'>): CommandAction {
  return { ...def, id, contexts: ['editor'], run: () => { runEditorCommand(id); } };
}

export const COMMANDS: CommandAction[] = [
  // ── Actions (menu-seeded — the useMenuEvents receipts) ────────────
  {
    id: 'new',
    title: 'New Document',
    icon: FileStack,
    group: 'navigate',
    menuEventId: 'menu-new',
    keywords: ['new', 'document', 'window', 'blank'],
    // Stub receipt (useMenuEvents): "New Document not yet implemented" —
    // a console.warn no-op that would LOOK broken in a palette. Hidden
    // from the palette until real; the menu still dispatches it.
    // When implemented: unhide AND add requiresSafeQuit (unsaved work
    // in the current doc must survive the switch).
    hidden: () => true,
    run: () => {
      console.warn('New Document not yet implemented');
    },
  },
  {
    id: 'open',
    title: 'Open Document',
    icon: FolderOpen,
    group: 'actions',
    menuEventId: 'menu-open',
    keywords: ['open', 'file', 'load', 'document'],
    run: () => void doc().openFile(),
  },
  {
    id: 'save',
    title: 'Save',
    icon: Save,
    group: 'actions',
    menuEventId: 'menu-save',
    shortcutId: 'save',
    keywords: ['save', 'store', 'write', 'disk'],
    enablement: isDirty,
    run: () => void doc().save(),
  },
  {
    id: 'saveAs',
    title: 'Save As',
    icon: SaveAll,
    group: 'actions',
    menuEventId: 'menu-save-as',
    keywords: ['save', 'save as', 'export', 'rename', 'file'],
    run: () => void doc().saveAs(),
  },
  {
    id: 'undo',
    title: 'Undo',
    icon: Undo2,
    group: 'actions',
    menuEventId: 'menu-undo',
    shortcutId: 'undo',
    keywords: ['undo', 'revert', 'history'],
    enablement: canUndo,
    run: () => {
      doc().editor?.commands.undo();
    },
  },
  {
    id: 'redo',
    title: 'Redo',
    icon: Redo2,
    group: 'actions',
    menuEventId: 'menu-redo',
    shortcutId: 'redo',
    keywords: ['redo', 'repeat', 'history'],
    enablement: canRedo,
    run: () => {
      doc().editor?.commands.redo();
    },
  },
  {
    id: 'cut',
    title: 'Cut',
    icon: Scissors,
    group: 'actions',
    menuEventId: 'menu-cut',
    keywords: ['cut', 'clipboard', 'selection'],
    // TODO(Clipboard API): document.execCommand is deprecated but
    // universally supported — replacing it is not this milestone.
    run: () => {
      document.execCommand('cut');
    },
  },
  {
    id: 'copy',
    title: 'Copy',
    icon: Copy,
    group: 'actions',
    menuEventId: 'menu-copy',
    keywords: ['copy', 'clipboard', 'duplicate'],
    // TODO(Clipboard API): see cut — execCommand v1, not this milestone.
    run: () => {
      document.execCommand('copy');
    },
  },
  {
    id: 'paste',
    title: 'Paste',
    icon: ClipboardPaste,
    group: 'actions',
    menuEventId: 'menu-paste',
    keywords: ['paste', 'clipboard'],
    // Enablement omitted by law: clipboard emptiness is not cheaply/
    // synchronously readable (async + permission-gated) — never guess.
    run: () => {
      const editor = doc().editor;
      if (editor) void pasteFromSystemClipboard(editor);
    },
  },
  {
    id: 'toggleDarkMode',
    title: 'Toggle Dark Mode',
    icon: Moon,
    group: 'actions',
    menuEventId: 'menu-toggle-dark-mode',
    keywords: ['dark', 'light', 'theme', 'mode', 'night'],
    run: () => {
      const { config, setTheme } = cfg();
      setTheme(config.theme === 'dark' ? 'light' : 'dark');
    },
  },
  {
    id: 'quit',
    title: 'Quit',
    icon: LogOut,
    group: 'actions',
    menuEventId: 'menu-quit',
    keywords: ['quit', 'exit', 'close', 'shutdown'],
    requiresSafeQuit: true,
    run: async () => {
      const { editor, filePath, isDirty, pageSetup, lineNumbers } = doc();
      // Safe-quit: dirty doc → recovery snapshot NOW via the EXISTING
      // autosave recovery path (recovery.ts saveRecoveryCopy — same
      // format, same appDataDir()/recovery/ location), so the existing
      // restore flow picks it up. No second snapshot format, no
      // forked restore logic.
      if (editor && isDirty) {
        await saveRecoveryCopy(editor, filePath, pageSetup, lineNumbers);
      }
      getCurrentWindow().close();
    },
  },

  // ── Actions (non-menu) ───────────────────────────────────────────
  {
    id: 'openSettings',
    title: 'Open Settings',
    icon: Settings,
    group: 'actions',
    shortcutId: 'openSettings',
    keywords: ['settings', 'preferences', 'options', 'config', 'configure'],
    run: () => useSettingsDialogStore.getState().open(),
  },
  {
    id: 'browseFonts',
    title: 'Browse Fonts',
    icon: Library,
    group: 'actions',
    keywords: ['fonts', 'font family', 'install', 'upload', 'typeface', 'browse'],
    run: () => useFontBrowserStore.getState().open(),
  },
  {
    id: 'createStyle',
    title: 'Create Style',
    icon: Plus,
    group: 'format',
    keywords: ['style', 'create', 'new', 'define', 'format'],
    run: () => useStyleDialogStore.getState().openDialog(null, 'paragraph'),
  },
  {
    id: 'palette',
    title: 'Command Palette',
    group: 'actions',
    shortcutId: 'palette',
    keywords: ['palette', 'command', 'search', 'actions', 'run'],
    run: () => usePaletteStore.getState().toggle(),
  },

  // ── Navigate (docs: view/document navigation & window) ───────────
  {
    id: 'documentProperties',
    title: 'Document Properties',
    icon: Info,
    group: 'navigate',
    keywords: ['properties', 'margins', 'size', 'document', 'info'],
    run: () => useDocumentPropertiesStore.getState().open(),
  },
  {
    id: 'documentStatistics',
    title: 'Document Statistics',
    icon: Sparkles,
    group: 'navigate',
    keywords: ['statistics', 'stats', 'words', 'count', 'document'],
    run: () => useDocumentPropertiesStore.getState().openStats(),
  },
  {
    id: 'findSidebar',
    title: 'Find & Replace (Sidebar)',
    icon: FileSearchCorner,
    group: 'navigate',
    shortcutId: 'find',
    keywords: ['find', 'search', 'replace', 'sidebar', 'advanced'],
    run: () => useSidebarStore.getState().open('search', 'right'),
  },
  {
    id: 'toggleNPC',
    title: 'Toggle Non-Printing Characters',
    icon: Pilcrow,
    group: 'navigate',
    keywords: ['non-printing', 'nonprinting', 'pilcrow', 'paragraph marks', 'npc', 'formatting marks'],
    run: () => {
      const { config, setShowNonPrintingChars } = cfg();
      setShowNonPrintingChars(!config.editor.showNonPrintingChars);
    },
  },
  {
    id: 'toggleLineNumbers',
    title: 'Toggle Line Numbers',
    icon: List,
    group: 'navigate',
    keywords: ['line numbers', 'gutter', 'numbering', 'count', 'lines'],
    // No enablement predicate by design: toggling is always offered —
    // it writes the DOCUMENT's setting (marks dirty), not app config.
    run: () => {
      const store = useDocumentStore.getState();
      const current = store.lineNumbers;
      store.setLineNumbers({
        enabled: !(current?.enabled ?? false),
        mode: current?.mode ?? 'per-page',
        countBy: current?.countBy,
      });
    },
  },
  // The mode flavors — every one enables with its mode; invoking the
  // command while ALREADY in that exact state turns the gutter off
  // (toggle semantics, so the palette alone can fully drive the
  // setting without the ribbon).
  ...(['per-page', 'continuous', 'per-paragraph'] as const).map((mode) => ({
    id: `lineNumbers:${mode}`,
    title: `Line Numbers: ${mode === 'per-page' ? 'Per Page' : mode === 'per-paragraph' ? 'Per Paragraph' : 'Continuous'}`,
    icon: ListOrdered,
    group: 'navigate' as const,
    keywords: ['line numbers', 'gutter', 'numbering', mode.replace('-', ' '), 'count', 'lines'],
    run: () => {
      const store = useDocumentStore.getState();
      const current = store.lineNumbers;
      const alreadyActive = current?.enabled === true && current.mode === mode;
      store.setLineNumbers({
        enabled: !alreadyActive,
        mode,
        countBy: current?.countBy,
      });
    },
  })),
  {
    id: 'zoomIn',
    title: 'Zoom In',
    icon: ZoomIn,
    group: 'navigate',
    keywords: ['zoom', 'in', 'magnify', 'bigger', 'larger'],
    run: () => cfg().setZoomLevel(cfg().config.editor.zoomLevel + 10),
  },
  {
    id: 'zoomOut',
    title: 'Zoom Out',
    icon: ZoomOut,
    group: 'navigate',
    keywords: ['zoom', 'out', 'shrink', 'smaller'],
    run: () => cfg().setZoomLevel(cfg().config.editor.zoomLevel - 10),
  },
  {
    id: 'zoomReset',
    title: 'Reset Zoom to 100%',
    icon: Maximize,
    group: 'navigate',
    keywords: ['zoom', 'reset', '100', 'normal', 'default'],
    run: () => cfg().setZoomLevel(100),
  },

  // ── Format (editor-context commands — shared ShortcutsExtension
  //    dispatch path; the palette never re-implements one) ──────────
  editorCommand('bold', {
    title: 'Bold',
    icon: Bold,
    group: 'format',
    shortcutId: 'bold',
    keywords: ['bold', 'b', 'format', 'strong'],
  }),
  editorCommand('italic', {
    title: 'Italic',
    icon: Italic,
    group: 'format',
    shortcutId: 'italic',
    keywords: ['italic', 'i', 'format', 'emphasis'],
  }),
  editorCommand('underline', {
    title: 'Underline',
    icon: UnderlineIcon,
    group: 'format',
    shortcutId: 'underline',
    keywords: ['underline', 'u', 'format'],
  }),
  editorCommand('strike', {
    title: 'Strikethrough',
    icon: Strikethrough,
    group: 'format',
    shortcutId: 'strike',
    keywords: ['strikethrough', 'strike', 'cross out', 'format'],
  }),
  editorCommand('clearFormatting', {
    title: 'Clear Formatting',
    icon: RemoveFormatting,
    group: 'format',
    shortcutId: 'clearFormatting',
    keywords: ['clear', 'remove', 'formatting', 'plain', 'reset'],
  }),
  editorCommand('fontSizeUp', {
    title: 'Increase Font Size',
    icon: CaseSensitive,
    group: 'format',
    shortcutId: 'fontSizeUp',
    keywords: ['font', 'size', 'grow', 'bigger', 'larger'],
  }),
  editorCommand('fontSizeDown', {
    title: 'Decrease Font Size',
    icon: CaseSensitive,
    group: 'format',
    shortcutId: 'fontSizeDown',
    keywords: ['font', 'size', 'shrink', 'smaller'],
  }),
  editorCommand('insertPageBreak', {
    title: 'Insert Page Break',
    icon: SeparatorHorizontal,
    group: 'format',
    shortcutId: 'insertPageBreak',
    keywords: ['page', 'break', 'insert', 'new page'],
  }),
  editorCommand('insertLink', {
    title: 'Insert Hyperlink',
    icon: Link2,
    group: 'format',
    shortcutId: 'insertLink',
    keywords: ['link', 'hyperlink', 'url', 'insert'],
  }),
  editorCommand('alignLeft', {
    title: 'Align Left',
    icon: AlignLeft,
    group: 'format',
    shortcutId: 'alignLeft',
    keywords: ['align', 'left', 'justify'],
  }),
  editorCommand('alignCenter', {
    title: 'Align Center',
    icon: AlignCenter,
    group: 'format',
    shortcutId: 'alignCenter',
    keywords: ['align', 'center', 'middle'],
  }),
  editorCommand('alignRight', {
    title: 'Align Right',
    icon: AlignRight,
    group: 'format',
    shortcutId: 'alignRight',
    keywords: ['align', 'right'],
  }),
  editorCommand('alignJustify', {
    title: 'Justify',
    icon: AlignJustify,
    group: 'format',
    shortcutId: 'alignJustify',
    keywords: ['align', 'justify', 'full'],
  }),
  editorCommand('unorderedList', {
    title: 'Bullet List',
    icon: List,
    group: 'format',
    shortcutId: 'unorderedList',
    keywords: ['bullet', 'list', 'unordered', 'ul'],
  }),
  editorCommand('orderedList', {
    title: 'Numbered List',
    icon: ListOrdered,
    group: 'format',
    shortcutId: 'orderedList',
    keywords: ['numbered', 'list', 'ordered', 'ol'],
  }),
  editorCommand('increaseIndent', {
    title: 'Increase Indent',
    icon: IndentIncrease,
    group: 'format',
    shortcutId: 'increaseIndent',
    keywords: ['indent', 'increase', 'more', 'tab'],
  }),
  editorCommand('decreaseIndent', {
    title: 'Decrease Indent',
    icon: IndentDecrease,
    group: 'format',
    shortcutId: 'decreaseIndent',
    keywords: ['indent', 'decrease', 'less', 'outdent'],
  }),
  editorCommand('applyStyleNormal', {
    title: 'Apply Normal Text Style',
    icon: Pilcrow,
    group: 'format',
    keywords: ['style', 'normal', 'body', 'apply'],
  }),
  editorCommand('applyStyleHeading1', {
    title: 'Apply Heading 1 Style',
    icon: Heading1,
    group: 'format',
    keywords: ['style', 'heading', 'title', 'h1', 'apply'],
  }),
  editorCommand('applyStyleHeading2', {
    title: 'Apply Heading 2 Style',
    icon: Heading2,
    group: 'format',
    keywords: ['style', 'heading', 'h2', 'apply'],
  }),
  editorCommand('applyStyleHeading3', {
    title: 'Apply Heading 3 Style',
    icon: Heading3,
    group: 'format',
    keywords: ['style', 'heading', 'h3', 'apply'],
  }),
  editorCommand('applyStyleQuote', {
    title: 'Apply Quote Style',
    icon: Quote,
    group: 'format',
    keywords: ['style', 'quote', 'blockquote', 'apply'],
  }),
];

export function getCommand(id: string): CommandAction | undefined {
  return COMMANDS.find((c) => c.id === id);
}

export function getCommandByMenuEvent(menuEventId: string): CommandAction | undefined {
  return COMMANDS.find((c) => c.menuEventId === menuEventId);
}
