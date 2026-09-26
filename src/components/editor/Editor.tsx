import { useEffect } from "react";
import { useEditor } from "@tiptap/react";
import type { TextMetrics } from "@tensor-editor/engine";
import { useDocumentStore } from "../../lib/document/store";
import { useConfigStore } from "../../lib/config/store";
import { tensorExtensions } from "@/lib/editor/tensorExtensions";
import { ensureBlockIds } from "@/lib/editor/BlockIdExtension";
import { PaginatedView } from "./PaginatedView";
import { PagelessEditor } from "./PagelessEditor";

export function Editor({ metrics }: { metrics?: TextMetrics }) {
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
    extensions: tensorExtensions(),
    content: "<p>Start typing…</p>",
    // The INITIAL content is created without a transaction, so the
    // BlockIdExtension's appendTransaction never fires for it — run the
    // mint pass explicitly or the first layout call throws on the
    // id-less doc (adapter contract) and boots into the fallback.
    onCreate: ({ editor }) => ensureBlockIds(editor),
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
      // Fallback-mode middle-click: the visible PM view is an editable,
      // and Linux webviews paste the X11 primary selection by default —
      // the Behavior toggle must hold in every mode.
      if (e.button === 1 && !useConfigStore.getState().config.editor.pasteOnMiddleClick) {
        e.preventDefault();
      }
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

  // Mode routing seam (M4): 'Pages' is Tensor's default and identity —
  // it renders the engine-driven PaginatedView; everything else renders
  // the pageless interim shell. M5+ new modes are new branches here.
  return mode === 'Pages' ? (
    <PaginatedView editor={editor} metrics={metrics} />
  ) : (
    <PagelessEditor
      editor={editor}
      fontFamily={defaultFontFamily}
      fontSize={defaultFontSize}
    />
  );
}