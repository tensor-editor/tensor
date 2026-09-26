import { useEditorState } from "@tiptap/react";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RibbonGroup } from "../../../RibbonGroup";
import { IconButton } from "../../../IconButton";
import { useDocumentStore } from "@/lib/document/store";
import { FontSizeInput } from "../FontSizeInput";
import { useConfigStore } from "@/lib/config/store";
import { ColorPickerButton } from "../../ColorPickerButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

const FONT_FAMILIES = [
  "Arial",
  "Georgia",
  "Times New Roman",
  "Courier New",
  "Verdana",
  "system-ui",
];

export function FontGroup() {
  const editor = useDocumentStore((s) => s.editor);

  const defaultFontSize = useConfigStore((s) => s.config.editor.defaultFontSize);

  const attrs = useEditorState({
    editor,
    selector: (ctx) => ({
      fontFamily: ctx.editor?.getAttributes("textStyle").fontFamily ?? "",
      fontSize:
        (
          ctx.editor?.getAttributes("textStyle").fontSize as string | undefined
        )?.replace("px", "") ?? "",
      color: ctx.editor?.getAttributes("textStyle").color ?? "#000000",
      isBold: ctx.editor?.isActive("bold") ?? false,
      isItalic: ctx.editor?.isActive("italic") ?? false,
      isUnderline: ctx.editor?.isActive("underline") ?? false,
      isStrike: ctx.editor?.isActive("strike") ?? false,
    }),
  });

  const displayFontSize = attrs?.fontSize || String(defaultFontSize);

  if (!editor) return null;

  return (
    <RibbonGroup>
      <Tooltip>
        <TooltipTrigger
          render={
            <Select
              value={attrs?.fontFamily || ''}
              onValueChange={(value) => editor.chain().focus().setFontFamily(value).run()}
            >
              <Tooltip>
                <TooltipTrigger
                  render={
                    <SelectTrigger className="mx-1.5 h-8 w-32 text-sm">
                      <SelectValue placeholder="Font" />
                    </SelectTrigger>
                  }
                />
                <TooltipContent>Font Family</TooltipContent>
              </Tooltip>
              <SelectContent
                alignItemWithTrigger={false}
                >
                {FONT_FAMILIES.map((font) => (
                  <SelectItem key={font} value={font} style={{ fontFamily: font }}>
                    {font}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
        <TooltipContent>Font Family</TooltipContent>
      </Tooltip>

      <FontSizeInput editor={editor} currentSize={displayFontSize} />

      <ColorPickerButton
        label="Text Color"
        icon={<span className="text-sm font-semibold">A</span>}
        resetLabel="Automatic"
        onChange={(color) => {
          if (color) editor.chain().focus().setColor(color).run();
          else editor.chain().focus().unsetColor().run();
        }}
      />

      <ColorPickerButton
        label="Highlight Color"
        icon={<Highlighter size={16} />}
        resetLabel="Transparent"
        onChange={(color) => {
          if (color) editor.chain().focus().toggleHighlight({ color }).run();
          else editor.chain().focus().unsetHighlight().run();
        }}
      />

      <IconButton
        label="Bold"
        icon={<Bold size={16} />}
        active={attrs?.isBold}
        onClick={() => editor.chain().focus().toggleBold().run()}
        shortcutId="bold"
      />

      <IconButton
        label="Italic"
        icon={<Italic size={16} />}
        active={attrs?.isItalic}
        onClick={() => editor.chain().focus().toggleItalic().run()}
        shortcutId="italic"
      />

      <IconButton
        label="Underline"
        icon={<UnderlineIcon size={16} />}
        active={attrs?.isUnderline}
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        shortcutId="underline"
      />

      <IconButton
        label="Strikethrough"
        icon={<Strikethrough size={16} />}
        active={attrs?.isStrike}
        onClick={() => editor.chain().focus().toggleStrike().run()}
        shortcutId="strike"
      />
    </RibbonGroup>
  );
}
