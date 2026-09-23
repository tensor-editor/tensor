import type { Extensions } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, FontSize } from '@tiptap/extension-text-style';
import FontFamily from '@tiptap/extension-font-family';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import Link from '@tiptap/extension-link';
import {
  OrderedListWithStyle,
  UnorderedListWithStyle,
} from '@/lib/lists/listExtensions';
import { HeadingWithExtras, ParagraphExtraCommands, ParagraphWithExtras } from '@/lib/editor/ParagraphExtensions';
import { SearchExtension } from '@/lib/editor/search/SearchExtension';
import { DynamicShortcutsExtension } from '@/lib/editor/ShortcutsExtension';
import {
  BoldNoShortcut,
  ItalicNoShortcut,
  UnderlineNoShortcut,
  StrikeNoShortcut,
  TextAlignNoShortcut,
} from '@/lib/editor/RemoveDefShortcuts';
import { BlockIdExtension } from '@/lib/editor/BlockIdExtension';
import { PaginatedScrollGuard } from '@/lib/paginated/ScrollGuardExtension';
import { PageBreakNode } from '@/lib/pagination/PageBreakNode';

/** The Tensor editor's extension list — one source shared by the app
 * shell (Editor.tsx) and the test harness so tests exercise the exact
 * production editor. */
export function tensorExtensions(): Extensions {
  return [
    StarterKit.configure({
      bulletList: false,
      orderedList: false,
      paragraph: false,
      heading: false,
      link: false,
      bold: false,
      italic: false,
      underline: false,
      strike: false,
    }),
    BoldNoShortcut,
    ItalicNoShortcut,
    UnderlineNoShortcut,
    StrikeNoShortcut,
    OrderedListWithStyle,
    UnorderedListWithStyle,
    TextStyle,
    FontFamily,
    Color,
    Highlight.configure({ multicolor: true }),
    FontSize,
    TextAlignNoShortcut.configure({ types: ['heading', 'paragraph'] }),
    ParagraphWithExtras,
    HeadingWithExtras,
    ParagraphExtraCommands,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow' },
    }),
    SearchExtension,
    DynamicShortcutsExtension,
    // Model node that survives from the legacy pipeline: the pageBreak
    // atom renders its marker, and the M4 adapter translates it into the
    // engine's forced-break spelling (flow.breakBefore: 'page').
    PageBreakNode,
    // M4: stable block ids (engine edit-survival contract) + the
    // paginated-mode scroll guard (L3).
    BlockIdExtension,
    PaginatedScrollGuard,
  ];
}