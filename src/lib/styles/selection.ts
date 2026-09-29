import type { Editor } from '@tiptap/core';
import type { StyleDefinition, StyleProperties } from './types';
import { headingStyleId } from './types';
import { lookupStyle } from './registry';
import { baselineRunStyle, captureFromResolved, resolveRun, type RunStyle } from './resolve';

/**
 * UI-tier selection resolution — the SAME resolveRun the adapter and
 * the pageless stylesheet use, never parallel logic (addendum 1). The
 * Font/font-size dropdowns display these EFFECTIVE values (fixes the
 * blank-dropdown default: a caret in a heading shows the heading's
 * resolved size, not an empty box), and "create style from selection"
 * captures them (reverse resolution, addendum 2).
 */

function paragraphStyleIdAt(editor: Editor): string | null {
  const parent = editor.state.selection.$from.parent;
  if (parent.type.name === 'heading') return headingStyleId(parent.attrs.level ?? 1);
  if (parent.type.name === 'paragraph') {
    return typeof parent.attrs.styleId === 'string' && parent.attrs.styleId
      ? parent.attrs.styleId
      : 'normal';
  }
  return null;
}

function charStyleIdAt(editor: Editor): string | null {
  const attrs = editor.getAttributes('charStyle');
  return typeof attrs.styleId === 'string' && attrs.styleId ? attrs.styleId : null;
}

/** The resolved effective run style at the caret/selection start. */
export function effectiveSelectionRunStyle(
  editor: Editor,
  base: RunStyle,
  definitions: Record<string, StyleDefinition>
): RunStyle {
  const paraDef = lookupStyle(paragraphStyleIdAt(editor), definitions);
  const charDef = lookupStyle(charStyleIdAt(editor), definitions);

  const textStyle = editor.getAttributes('textStyle');
  const direct: StyleProperties = {};
  if (typeof textStyle.fontFamily === 'string' && textStyle.fontFamily) direct.fontFamily = textStyle.fontFamily;
  if (typeof textStyle.fontSize === 'string' && textStyle.fontSize) {
    const px = parseFloat(textStyle.fontSize);
    if (Number.isFinite(px) && px > 0) direct.fontSize = px;
  }
  if (editor.isActive('bold')) direct.bold = true;
  if (editor.isActive('italic')) direct.italic = true;
  if (editor.isActive('underline')) direct.underline = true;
  if (editor.isActive('strike')) direct.strike = true;
  if (typeof textStyle.color === 'string' && textStyle.color) direct.color = textStyle.color;
  const highlightAttrs = editor.getAttributes('highlight');
  if (typeof highlightAttrs.color === 'string' && highlightAttrs.color) {
    direct.highlight = highlightAttrs.color;
  } else if (editor.isActive('highlight')) {
    direct.highlight = '#fef08a'; // the adapter's DEFAULT_HIGHLIGHT
  }

  return resolveRun({ base, para: paraDef, char: charDef, direct });
}

/**
 * CAPTURE (addendum 2): the EFFECTIVE formatting at the selection as
 * a definition's properties — everything that differs from the
 * config-derived baseline. Receipt test: capture from a
 * directly-bolded Normal span → { bold: true }.
 */
export function captureStyleFromSelection(
  editor: Editor,
  base: RunStyle,
  definitions: Record<string, StyleDefinition>
): StyleProperties {
  const resolved = effectiveSelectionRunStyle(editor, base, definitions);
  return captureFromResolved(resolved, base);
}

/** Convenience: the baseline the app derives from config + 'normal'. */
export function selectionBaseline(editor: Editor, fontFamily: string, fontSize: number): RunStyle {
  void editor;
  return baselineRunStyle({ fontFamily, fontSize });
}
