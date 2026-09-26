import { useRef } from "react";
import { EditorContent, type Editor } from "@tiptap/react";
import { useLinkBubble } from "@/lib/editor/useLinkBubble";
import { LinkBubble } from "./LinkBubble";
import { TooltipProvider } from "../ui/tooltip";
import { useConfigStore } from "@/lib/config/store";
import { FloatingToolbar } from "./FloatingToolbar";
import { useFloatingToolbar } from "@/lib/editor/useFloatingToolbar";

interface PagelessEditorProps {
  editor: Editor | null;
  fontFamily: string;
  fontSize: number;
}

export function PagelessEditor({ editor, fontFamily, fontSize }: PagelessEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const linkBubbleRef = useRef<HTMLDivElement>(null);
  const linkBubble = useLinkBubble(editor, linkBubbleRef);
  const showNonPrintingChars = useConfigStore((s) => s.config.editor.showNonPrintingChars);
  const zoomLevel = useConfigStore((s) => s.config.editor.zoomLevel);
  const showFloatingToolbar = useConfigStore((s) => s.config.useFloatingToolbar);
  const floatingToolbarPosition = useFloatingToolbar(editor, showFloatingToolbar);

  return (
    <TooltipProvider>
      <div
        ref={containerRef}
        className="relative mx-auto"
        style={{
          transform: `scale(${zoomLevel / 100})`,
          transformOrigin: 'top center',
        }}
      >
        <div className={`relative z-10 ${showNonPrintingChars ? "show-non-printing" : ""}`}>
          <EditorContent
            editor={editor}
            className="prose prose-neutral min-h-100 focus:outline-none text-black"
            style={{ fontFamily, fontSize: `${fontSize}px` }}
          />
        </div>

        {linkBubble && editor && containerRef.current && (
          <LinkBubble
            ref={linkBubbleRef}
            editor={editor}
            bubble={linkBubble}
            containerTop={containerRef.current.getBoundingClientRect().top}
            containerLeft={containerRef.current.getBoundingClientRect().left}
          />
        )}

        {floatingToolbarPosition && editor && containerRef.current && (
          <FloatingToolbar
            editor={editor}
            position={floatingToolbarPosition}
            containerTop={containerRef.current.getBoundingClientRect().top}
            containerLeft={containerRef.current.getBoundingClientRect().left}
          />
        )}
      </div>
    </TooltipProvider>
  );
}
