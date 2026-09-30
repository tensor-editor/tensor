import { useState } from 'react';
import { useEditorState } from "@tiptap/react";
import {
  Bold,
  ChevronDown,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  Highlighter,
  Library,
  ChevronsUpDown,
  WholeWord,
} from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { RibbonGroup } from "../../../RibbonGroup";
import { IconButton } from "../../../IconButton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useDocumentStore } from "@/lib/document/store";
import { FontSizeInput } from "../FontSizeInput";
import { useConfigStore } from "@/lib/config/store";
import { useStyleRegistryStore } from "@/lib/styles/registry";
import { useFontRegistryStore, type FontEntry } from "@/lib/fonts/registry";
import { useFontBrowserStore } from "@/lib/fonts/browserStore";
import {
  effectiveSelectionRunStyle,
  selectionBaseline,
} from "@/lib/styles/selection";
import { ColorPickerButton } from "../../ColorPickerButton";

/**
 * M-FONTS-A/B — the family picker, styled like the Styles dropdown
 * (not the thin base-ui Select): a wide popover with preview-rendered
 * rows, alphabetical, a "recently used" section (top 5, session
 * scope), per-family weight flyouts, and the Browse Fonts action as a
 * real row. Names are DISPLAY names — "System UI", never a raw
 * 'system-ui' or a "Variable" suffix (Geist is just "Geist").
 *
 * WEIGHT FLYOUTS: the axis/face weights a family actually offers.
 * 400 Regular and 700 Bold are selectable TODAY (they map onto the
 *  existing bold mark / its absence — fontString's two worlds). The
 * other axis stops (Light, ExtraLight, Black…) list with their names
 * but are disabled until the ENGINE's TextStyle grows a weight axis
 * (measured + painted through fontString — a shell-only lie would
 * break the one-ruler rule).
 */

const RECENT_LIMIT = 5;

function weightLabel(weight: number): string {
  const names: Record<number, string> = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };
  return names[weight] ?? String(weight);
}

/** The weights a family offers: variable → the full axis stops;
 *  static → its registered faces. */
function availableWeights(entry: FontEntry): number[] {
  if (entry.variable) return [100, 200, 300, 400, 500, 600, 700, 800, 900];
  const weights = new Set<number>([400]);
  if (entry.files?.bold) weights.add(700);
  return [...weights];
}

export function FontGroup() {
  const editor = useDocumentStore((s) => s.editor);

  const defaultFontSize = useConfigStore((s) => s.config.editor.defaultFontSize);
  const defaultFontFamily = useConfigStore((s) => s.config.editor.defaultFontFamily);
  const mergedStyles = useStyleRegistryStore((s) => s.merged);

  // The registry is the data source (bundled + system + uploaded +
  // catalog), alphabetical by DISPLAY name.
  const entries = useFontRegistryStore((s) => s.entries);
  const recentFamilies = useFontRegistryStore((s) => s.recentFamilies);
  const openFontBrowser = useFontBrowserStore((s) => s.open);

  const [open, setOpen] = useState(false);
  const [weightsOpenFor, setWeightsOpenFor] = useState<string | null>(null);

  const sorted = [...entries].sort((a, b) => a.displayName.localeCompare(b.displayName));
  const byFamily = new Map(entries.map((e) => [e.family, e]));
  const recent = recentFamilies
    .map((family) => byFamily.get(family))
    .filter((e): e is FontEntry => !!e);

  const attrs = useEditorState({
    editor,
    selector: (ctx) => ({
      color: ctx.editor?.getAttributes("textStyle").color ?? "#000000",
      isBold: ctx.editor?.isActive("bold") ?? false,
      isItalic: ctx.editor?.isActive("italic") ?? false,
      isUnderline: ctx.editor?.isActive("underline") ?? false,
      isStrike: ctx.editor?.isActive("strike") ?? false,
      effectiveFontFamily: ctx.editor
        ? effectiveSelectionRunStyle(
            ctx.editor,
            selectionBaseline(ctx.editor, defaultFontFamily, defaultFontSize),
            mergedStyles,
          ).fontFamily
        : "",
      effectiveFontSize: ctx.editor
        ? effectiveSelectionRunStyle(
            ctx.editor,
            selectionBaseline(ctx.editor, defaultFontFamily, defaultFontSize),
            mergedStyles,
          ).fontSize
        : 0,
    }),
  });

  if (!editor) return null;

  const effectiveName = byFamily.get(attrs?.effectiveFontFamily ?? '')?.displayName ?? attrs?.effectiveFontFamily;

  function apply(family: string) {
    editor!.chain().focus().setFontFamily(family).run();
    useFontRegistryStore.getState().noteRecentFont(family);
    setOpen(false);
  }

  /** 400 clears the bold mark; 700 sets it — the two worlds the
   *  engine's TextStyle speaks today. */
  function applyWeight(entry: FontEntry, weight: number) {
    if (weight === 400) {
      editor!.chain().focus().setFontFamily(entry.family).unsetBold().run();
    } else if (weight === 700) {
      editor!.chain().focus().setFontFamily(entry.family).setBold().run();
    } else {
      return; // axis stops beyond the engine's reach stay disabled
    }
    useFontRegistryStore.getState().noteRecentFont(entry.family);
    setWeightsOpenFor(null);
    setOpen(false);
  }

  const row = (entry: FontEntry, section: 'recent' | 'all') => (
    <div
      key={`${section}:${entry.family}`}
      data-testid={`font-picker-row-${entry.family}`}
      className={`group relative flex items-center justify-between rounded px-2 py-1 text-sm hover:bg-muted ${
        entry.family === attrs?.effectiveFontFamily ? 'bg-muted' : ''
      }`}
    >
      <button
        className="flex-1 truncate text-left"
        style={{ fontFamily: entry.family }}
        onClick={() => apply(entry.family)}
      >
        {entry.displayName}
      </button>
      <button
        data-testid={`font-picker-weights-${entry.family}`}
        className="ml-1 rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent"
        aria-label={`Weights for ${entry.displayName}`}
        onClick={() => setWeightsOpenFor(weightsOpenFor === entry.family ? null : entry.family)}
      >
        <ChevronsUpDown size={12} />
      </button>
      {weightsOpenFor === entry.family && (
        <div
          data-testid={`font-picker-weight-list-${entry.family}`}
          className="absolute left-[calc(100%-4px)] top-0 z-50 w-36 rounded-lg border bg-popover p-1 shadow-md"
        >
          <div className="px-1.5 py-1 text-[10px] font-medium uppercase text-muted-foreground">
            {entry.displayName}
          </div>
          {availableWeights(entry).map((weight) => {
            const selectable = weight === 400 || weight === 700;
            const item = (
              <button
                key={weight}
                data-testid={`font-picker-weight-${entry.family}-${weight}`}
                className={`flex w-full items-center justify-between rounded px-2 py-1 text-left text-sm ${
                  selectable ? 'hover:bg-muted' : 'cursor-not-allowed opacity-40'
                }`}
                disabled={!selectable}
                onClick={() => applyWeight(entry, weight)}
              >
                <span>{weightLabel(weight)}</span>
                <span className="text-xs text-muted-foreground">{weight}</span>
              </button>
            );
            if (selectable) return item;
            return (
              <Tooltip key={weight}>
                <TooltipTrigger render={item} />
                <TooltipContent>Coming soon — needs engine weight support</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <RibbonGroup>
      <Popover open={open} onOpenChange={(o) => { setOpen(o); if (!o) setWeightsOpenFor(null); }}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-36 justify-between gap-1 px-2 text-sm font-normal"
              aria-label="Font Family"
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <WholeWord size={12} className="shrink-0 text-muted-foreground" />
                <span className="truncate capitalize" style={{ fontFamily: attrs?.effectiveFontFamily || undefined }}>
                  {effectiveName || 'Font'}
                </span>
              </span>
              <ChevronDown size={12} className="shrink-0 opacity-60" />
            </Button>
          }
        />
        <PopoverContent className="flex max-h-150 w-64 flex-col p-1" align="start">
          {/* The font list scrolls; the Browse action is a FOOTER —
              always anchored to the bottom, never scrolled away. */}
          <div className="min-h-0 flex-1 overflow-y-auto">
            {recent.length > 0 && (
              <>
                <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
                  Recently Used
                </div>
                {recent.slice(0, RECENT_LIMIT).map((entry) => row(entry, 'recent'))}
                <div className="mx-1 my-1 border-t" />
              </>
            )}
            <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              All Fonts
            </div>
            {sorted.map((entry) => row(entry, 'all'))}
          </div>
          <div className="border-t">
            <button
              data-testid="font-picker-browse"
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm text-muted-foreground hover:bg-muted"
              onClick={() => {
                setOpen(false);
                openFontBrowser();
              }}
            >
              <Library size={12} /> Browse Fonts…
            </button>
          </div>
        </PopoverContent>
      </Popover>

      <FontSizeInput editor={editor} currentSize={String(attrs?.effectiveFontSize || defaultFontSize)} />

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
