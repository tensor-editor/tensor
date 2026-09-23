import { useEffect } from "react";
import { useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { TextStyle, FontSize } from "@tiptap/extension-text-style";
import FontFamily from "@tiptap/extension-font-family";
import { Color } from "@tiptap/extension-color";
import { Highlight } from "@tiptap/extension-highlight";
import { useDocumentStore } from "../../lib/document/store";
import { useConfigStore } from "../../lib/config/store";
import { PageBreakNode } from "../../lib/pagination/PageBreakNode";
import { PagelessEditor } from "./PagelessEditor";
import {
  OrderedListWithStyle,
  UnorderedListWithStyle,
} from "@/lib/lists/listExtensions";
import { HeadingWithExtras, ParagraphExtraCommands, ParagraphWithExtras } from "@/lib/editor/ParagraphExtensions";
import { SearchExtension } from "@/lib/editor/search/SearchExtension";
import { DynamicShortcutsExtension } from "@/lib/editor/ShortcutsExtension";
import {
  BoldNoShortcut,
  ItalicNoShortcut,
  UnderlineNoShortcut,
  StrikeNoShortcut,
  TextAlignNoShortcut,
} from "@/lib/editor/RemoveDefShortcuts";
import Link from "@tiptap/extension-link";

export function Editor() {
  const setEditor = useDocumentStore((s) => s.setEditor);
  const markDirty = useDocumentStore((s) => s.markDirty);

  const defaultFontFamily = useConfigStore(
    (s) => s.config.editor.defaultFontFamily,
  );
  const defaultFontSize = useConfigStore(
    (s) => s.config.editor.defaultFontSize,
  );
  const mode = useConfigStore((s) => s.config.editor.defaultPageLayout);

  const editor = useEditor({
    extensions: [
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
      TextAlignNoShortcut.configure({ types: ["heading", "paragraph"] }),
      ParagraphWithExtras,
      HeadingWithExtras,
      ParagraphExtraCommands,
      Link.configure({
        openOnClick: false,
        HTMLAttributes: { target: null, rel: 'noopener noreferrer nofollow' },
      }),
      SearchExtension,
      DynamicShortcutsExtension,
      PageBreakNode,
    ],
    content: "<p>Start typing…</p>",
    onUpdate: () => markDirty(),
    editorProps: {
      handleClick: (_view, _pos, event) => {
        const target = event.target as HTMLElement;
        const link = target.closest('a');
        if (link) {
          event.preventDefault();
          return true;
        }
        return false;
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    const currentEditor = editor;
    const dom = currentEditor.view.dom;

    let downPos: { x: number; y: number } | null = null;
    let isLinkMouseDown = false;

    function handleMouseDown(e: MouseEvent) {
      const target = e.target as HTMLElement;
      const link = target.closest('a');
      isLinkMouseDown = !!link && e.detail === 1 && e.button === 0;
      downPos = isLinkMouseDown ? { x: e.clientX, y: e.clientY } : null;
    }

    function handleMouseUp(e: MouseEvent) {
      if (!isLinkMouseDown || !downPos) return;

      const movedDistance = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y);
      const wasDrag = movedDistance > 4;

      if (!wasDrag) {
        const pos = currentEditor.view.posAtCoords({ left: e.clientX, top: e.clientY });
        if (pos) {
          currentEditor.commands.focus();
          currentEditor.commands.setTextSelection(pos.pos);
        }
      }

      isLinkMouseDown = false;
      downPos = null;
    }

    function preventLinkNav(e: MouseEvent) {
      const target = e.target as HTMLElement;
      if (target.closest('a')) e.preventDefault();
    }

    dom.addEventListener('mousedown', handleMouseDown, true);
    dom.addEventListener('mouseup', handleMouseUp, true);
    dom.addEventListener('click', preventLinkNav, true);
    return () => {
      dom.removeEventListener('mousedown', handleMouseDown, true);
      dom.removeEventListener('mouseup', handleMouseUp, true);
      dom.removeEventListener('click', preventLinkNav, true);
    };
  }, [editor]);

  useEffect(() => {
    setEditor(editor);
    return () => setEditor(null);
  }, [editor, setEditor]);

  // INTERIM: both branches render PagelessEditor until M4 lands
  // PaginatedView, which swaps the 'Pages' branch. Paginated is
  // Tensor's default and identity.
  return mode === 'Pages' ? (
    <PagelessEditor
      editor={editor}
      fontFamily={defaultFontFamily}
      fontSize={defaultFontSize}
    />
  ) : (
    <PagelessEditor
      editor={editor}
      fontFamily={defaultFontFamily}
      fontSize={defaultFontSize}
    />
  );
}
