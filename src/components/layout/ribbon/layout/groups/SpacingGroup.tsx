import { useEditorState } from '@tiptap/react';
import {
  ArrowUpToLine,
  ArrowDownToLine,
  IndentIncrease,
  IndentDecrease,
  CornerDownRight,
  CornerUpRight,
} from 'lucide-react';
import { RibbonGroup } from '../../../RibbonGroup';
import { RibbonIconInput } from '../../RibbonIconInput';
import { IconButton } from '../../../IconButton';
import type { Editor } from '@tiptap/core';

/** The hanging preset's left indent (px): Word's 0.5" reference-list
 * look on the 32px step grid — first line at the left edge, wrapped
 * lines one gutter in. */
const HANGING_STEP_PX = 32;

/**
 * Layout > Indent & Spacing. RULING (M6.2): per-paragraph controls
 * commit LIVE — unlike document-wide margins (Apply-gated because the
 * whole-document reflow is a heavyweight, deliberate act), a
 * paragraph indent is what the user is looking at; updateAttributes
 * writes the selected paragraphs on every commit/stepper tick, and
 * the paginated relayout is O(edit).
 *
 * FIRST LINE / HANGING (schema decision, documented): two BUTTONS, not
 * a dropdown — they are toggle presets, not a value entry, and the
 * ribbon already speaks buttons. First Line sets
 * firstLineIndent = +32 (one step out); Hanging sets
 * firstLineIndent = −32 AND backs indentLeft to ≥ 32 when needed (the
 * engine floors the first line's left edge at indentLeft + fli, so a
 * hanging first line requires a gutter to hang INTO — Word's 0.5"/0.5"
 * preset, on the 32px step grid). Clicking the active preset clears
 * firstLineIndent (null) — it never touches indentLeft except to
 * raise it when enabling Hanging.
 */
export function ParagraphSpacingGroup({ editor }: { editor: Editor }) {
  const attrs = useEditorState({
    editor,
    selector: (ctx) => ({
      spaceBefore: ctx.editor?.getAttributes('paragraph').spaceBefore ?? 0,
      spaceAfter: ctx.editor?.getAttributes('paragraph').spaceAfter ?? 0,
      indentLeft: ctx.editor?.getAttributes('paragraph').indentLeft ?? 0,
      indentRight: ctx.editor?.getAttributes('paragraph').indentRight ?? 0,
      firstLineIndent: (ctx.editor?.getAttributes('paragraph').firstLineIndent as number | null) ?? 0,
    }),
  });

  const fli = attrs?.firstLineIndent ?? 0;

  function applyFirstLine() {
    editor.chain().focus().updateAttributes('paragraph', {
      firstLineIndent: fli > 0 ? null : HANGING_STEP_PX,
    }).run();
  }

  function applyHanging() {
    if (fli < 0) {
      // Clearing the preset leaves indentLeft as-is (predictable).
      editor.chain().focus().updateAttributes('paragraph', { firstLineIndent: null }).run();
      return;
    }
    const left = attrs?.indentLeft ?? 0;
    editor.chain().focus().updateAttributes('paragraph', {
      firstLineIndent: -HANGING_STEP_PX,
      // A hanging first line needs a gutter to hang into: raise the
      // left indent to one step when the paragraph has none.
      ...(left < HANGING_STEP_PX ? { indentLeft: HANGING_STEP_PX } : {}),
    }).run();
  }

  return (
    <RibbonGroup>
      <RibbonIconInput
        label="Space Before"
        icon={<ArrowUpToLine size={14} />}
        value={attrs?.spaceBefore ?? 0}
        onCommit={(v) => editor.chain().updateAttributes('paragraph', { spaceBefore: v }).run()}
        showSteppers
      />
      <RibbonIconInput
        label="Space After"
        icon={<ArrowDownToLine size={14} />}
        value={attrs?.spaceAfter ?? 0}
        onCommit={(v) => editor.chain().updateAttributes('paragraph', { spaceAfter: v }).run()}
        showSteppers
      />
      <RibbonIconInput
        label="Indent Left"
        icon={<IndentIncrease size={14} />}
        value={attrs?.indentLeft ?? 0}
        onCommit={(v) => editor.chain().updateAttributes('paragraph', { indentLeft: v }).run()}
        showSteppers
      />
      <RibbonIconInput
        label="Indent Right"
        icon={<IndentDecrease size={14} />}
        value={attrs?.indentRight ?? 0}
        onCommit={(v) => editor.chain().updateAttributes('paragraph', { indentRight: v }).run()}
        showSteppers
      />

      <IconButton
        label="First Line Indent"
        icon={<CornerDownRight size={16} />}
        active={fli > 0}
        onClick={applyFirstLine}
      />
      <IconButton
        label="Hanging Indent"
        icon={<CornerUpRight size={16} />}
        active={fli < 0}
        onClick={applyHanging}
      />
    </RibbonGroup>
  );
}
