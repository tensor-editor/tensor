import { useState } from 'react';
import { ChevronDown, Pencil, Plus } from 'lucide-react';
import { useEditorState } from '@tiptap/react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { Editor } from '@tiptap/core';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import { headingStyleId, type StyleDefinition } from '@/lib/styles/types';
import { inlineStyle } from '@/lib/styles/resolve';
import { StyleDialog, type StyleDialogState } from '@/components/dialogs/StyleDialog';

/**
 * M-STYLES STEP 4. The dropdown lists the merged registry (built-ins +
 * customs) grouped by kind; applying a PARAGRAPH style sets styleId
 * (or CONVERTS the node for heading entries / converts a heading
 * back for the rest — the styleCommands); applying a CHARACTER style
 * sets the charStyle mark (one per span, replaced on re-apply). The
 * old preset-stamp path (styleDefinitions.ts: imperative chains
 * stamping concrete attrs/marks onto nodes) is DELETED — this is its
 * deliberate replacement, not a parallel mechanism.
 */

function stylePreviewStyle(def: StyleDefinition): React.CSSProperties {
  return inlineStyle({
    ...def.properties,
    // Geometry has no place in a list-item preview.
    spaceBefore: undefined,
    spaceAfter: undefined,
    indentLeft: undefined,
    indentRight: undefined,
    firstLineIndent: undefined,
    lineHeight: undefined,
  }) as React.CSSProperties;
}

export function StylesDropdown({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<StyleDialogState>({
    open: false,
    editingId: null,
    kind: 'paragraph',
  });
  const merged = useStyleRegistryStore((s) => s.merged);

  const active = useEditorState({
    editor,
    selector: (ctx) => {
      const parent = ctx.editor?.state.selection.$from.parent;
      let paragraph: string | null = null;
      if (parent?.type.name === 'heading') paragraph = headingStyleId(parent.attrs.level ?? 1);
      else if (parent?.type.name === 'paragraph')
        paragraph =
          typeof parent.attrs.styleId === 'string' && parent.attrs.styleId
            ? parent.attrs.styleId
            : 'normal';
      const charAttrs = ctx.editor?.getAttributes('charStyle');
      return {
        paragraph,
        character:
          typeof charAttrs?.styleId === 'string' && charAttrs.styleId ? charAttrs.styleId : null,
      };
    },
  });

  const definitions = Object.values(merged);
  const paragraphStyles = definitions.filter((d) => d.kind === 'paragraph');
  const characterStyles = definitions.filter((d) => d.kind === 'character');

  const openDialog = (editingId: string | null, kind: 'paragraph' | 'character') => {
    setOpen(false);
    setDialog({ open: true, editingId, kind });
  };

  const applyParagraph = (def: StyleDefinition) => {
    editor.chain().focus().applyParagraphStyle(def.id).run();
    setOpen(false);
  };

  const applyCharacter = (def: StyleDefinition) => {
    // Toggle: applying the already-active char style removes it
    // (Word-like); any other apply replaces the previous char style
    // (the mark's excludes-self rule — one char style per span).
    if (active?.character === def.id) {
      editor.chain().focus().removeCharStyle().run();
    } else {
      editor.chain().focus().applyCharStyle(def.id).run();
    }
    setOpen(false);
  };

  const row = (def: StyleDefinition, character: boolean) => {
    const isActive = character
      ? active?.character === def.id
      : active?.paragraph === def.id;
    return (
      <div
        key={def.id}
        className={`group flex items-center justify-between rounded px-2 ${isActive ? 'bg-muted' : ''}`}
      >
        <button
          className={`flex-1 truncate py-1.5 pr-1 text-left text-sm hover:text-foreground ${isActive ? 'font-medium' : ''}`}
          style={stylePreviewStyle(def)}
          onClick={() => (character ? applyCharacter(def) : applyParagraph(def))}
        >
          {def.name}
        </button>
        <div className="flex shrink-0 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            className="rounded p-1 hover:bg-muted"
            title="Edit style"
            onClick={() => openDialog(def.id, def.kind)}
          >
            <Pencil size={12} />
          </button>
        </div>
      </div>
    );
  };

  // The trigger NAMES the current style (Word's spelling of the same
  // affordance) — the caret block's paragraph style, truncated when a
  // custom name runs long.
  const currentStyleName = active?.paragraph ? (merged[active.paragraph]?.name ?? active.paragraph) : 'Styles';

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-36 justify-between gap-2 px-2 text-sm font-normal"
              aria-label={`Styles (current: ${currentStyleName})`}
            >
              <span className="truncate">{currentStyleName}</span>
              <ChevronDown size={12} className="shrink-0 opacity-60" />
            </Button>
          }
        />
        <PopoverContent className="w-64 p-1">
          <div className="max-h-[28rem] overflow-y-auto">
            <div className="px-2 pt-1 pb-0.5 text-xs font-medium text-muted-foreground">
              Paragraph Styles
            </div>
            {paragraphStyles.map((def) => row(def, false))}
            <div className="px-2 pt-2 pb-0.5 text-xs font-medium text-muted-foreground">
              Text Styles
            </div>
            {characterStyles.map((def) => row(def, true))}
          </div>
          <div className="mt-1 border-t pt-1">
            <button
              className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-sm hover:bg-muted"
              onClick={() => openDialog(null, 'paragraph')}
            >
              <Plus size={12} />
              New Style from Selection…
            </button>
          </div>
        </PopoverContent>
      </Popover>
      <StyleDialog state={dialog} onClose={() => setDialog((d) => ({ ...d, open: false }))} />
    </>
  );
}
