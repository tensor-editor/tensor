import { Extension } from '@tiptap/core';
import Paragraph from '@tiptap/extension-paragraph';
import Heading from '@tiptap/extension-heading';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    paragraphExtras: {
      setLineHeight: (lineHeight: string) => ReturnType;
      unsetLineHeight: () => ReturnType;
      increaseIndent: () => ReturnType;
      decreaseIndent: () => ReturnType;
      clearFormatting: () => ReturnType;
    };
  }
}

const MAX_INDENT = 8;
const INDENT_STEP_PX = 32;
const MAX_INDENT_PX = MAX_INDENT * INDENT_STEP_PX;

const lineHeightAttribute = {
  lineHeight: {
    default: null,
    parseHTML: (element: HTMLElement) => element.style.lineHeight || null,
    renderHTML: (attributes: { lineHeight?: string | null }) => {
      if (!attributes.lineHeight) return {};
      return { style: `line-height: ${attributes.lineHeight}` };
    },
  },
};

/**
 * FIRST-LINE INDENT (M6.2): px, may be NEGATIVE (hanging indent).
 * Round-trips through CSS text-indent — the pageless editor renders it
 * natively (positive text-indent = first line out; negative under a
 * padding-left = hanging), and the adapter maps it to the engine's
 * firstLineIndent (identical semantics: line 0 sits at
 * indentLeft + firstLineIndent and wraps at its own width). null =
 * unset (no text-indent style).
 */
const firstLineIndentAttribute = {
  firstLineIndent: {
    default: null,
    parseHTML: (element: HTMLElement) => {
      const raw = element.style.textIndent;
      if (!raw) return null;
      const v = parseFloat(raw);
      if (!Number.isFinite(v)) return null;
      // pt at the data boundary like every other CSS unit here
      // (M6-PRE: pt at the chrome, px in the core).
      return raw.trim().endsWith('pt') ? Math.round(v * (96 / 72)) : v;
    },
    renderHTML: (attributes: { firstLineIndent?: number | null }) => {
      if (attributes.firstLineIndent == null) return {};
      return { style: `text-indent: ${attributes.firstLineIndent}px` };
    },
  },
};

/**
 * LEGACY `indent` attr (steps of 32px): the pre-M6.2 spelling, kept
 * for .wpdoc/HTML round-trips of old files. The commands below no
 * longer write it; the adapter folds it into indentLeft (steps × 32,
 * additive), and the first indent command press MIGRATES it away (see
 * currentIndentLeft).
 */
const indentAttribute = {
  indent: {
    default: 0,
    parseHTML: (element: HTMLElement) => {
      const margin = parseInt(element.style.marginLeft || '0', 10);
      return Math.round(margin / INDENT_STEP_PX);
    },
    renderHTML: (attributes: { indent?: number }) => {
      if (!attributes.indent) return {};
      return { style: `margin-left: ${attributes.indent * INDENT_STEP_PX}px` };
    },
  },
};

/** The paragraph's EFFECTIVE left indent (px): the indentLeft attr plus
 * the legacy `indent` steps folded in. One writer (indentLeft), one
 * reader (this), migration on the first command press. */
function currentIndentLeft(node: { attrs?: Record<string, unknown> }): number {
  const left = typeof node.attrs?.indentLeft === 'number' && Number.isFinite(node.attrs.indentLeft)
    ? node.attrs.indentLeft
    : 0;
  const legacy = typeof node.attrs?.indent === 'number' && Number.isFinite(node.attrs.indent)
    ? node.attrs.indent * INDENT_STEP_PX
    : 0;
  return left + legacy;
}

const directionalIndentAttributes = {
  indentLeft: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseInt(element.style.paddingLeft || '0', 10),
    renderHTML: (attributes: { indentLeft?: number }) => {
      if (!attributes.indentLeft) return {};
      return { style: `padding-left: ${attributes.indentLeft}px` };
    },
  },
  indentRight: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseInt(element.style.paddingRight || '0', 10),
    renderHTML: (attributes: { indentRight?: number }) => {
      if (!attributes.indentRight) return {};
      return { style: `padding-right: ${attributes.indentRight}px` };
    },
  },
};

const spacingAttributes = {
  spaceBefore: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseInt(element.style.marginTop || '0', 10),
    renderHTML: (attributes: { spaceBefore?: number }) => {
      if (!attributes.spaceBefore) return {};
      return { style: `margin-top: ${attributes.spaceBefore}px` };
    },
  },
  spaceAfter: {
    default: 0,
    parseHTML: (element: HTMLElement) => parseInt(element.style.marginBottom || '0', 10),
    renderHTML: (attributes: { spaceAfter?: number }) => {
      if (!attributes.spaceAfter) return {};
      return { style: `margin-bottom: ${attributes.spaceAfter}px` };
    },
  },
};

export const ParagraphWithExtras = Paragraph.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...lineHeightAttribute,
      ...indentAttribute,
      ...directionalIndentAttributes,
      ...firstLineIndentAttribute,
      ...spacingAttributes,
    };
  },
});

export const HeadingWithExtras = Heading.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      ...lineHeightAttribute,
    };
  },
});

export const ParagraphExtraCommands = Extension.create({
  name: 'paragraphExtraCommands',

  addCommands() {
    return {
      setLineHeight:
        (lineHeight: string) =>
        ({ commands }: { commands: any }) =>
          commands.focus() &&
          ['paragraph', 'heading'].every((type: string) => commands.updateAttributes(type, { lineHeight })),

      unsetLineHeight:
        () =>
        ({ commands }: { commands: any }) =>
          commands.focus() &&
          ['paragraph', 'heading'].every((type: string) => commands.resetAttributes(type, 'lineHeight')),

      // INDENT COMMANDS (M6.2): ONE writer — the indentLeft attr, in
      // px, stepped by INDENT_STEP_PX (32, the historical step, now in
      // px on the px attr the ribbon input shows). The legacy `indent`
      // attr is folded in and cleared on the first press (migration),
      // so command, ribbon, engine field, and adapter all agree.
      increaseIndent:
        () =>
        ({ tr, state, dispatch }: { tr: any; state: any; dispatch: any }) => {
          const { $from } = state.selection;
          const pos = $from.before($from.depth);
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== 'paragraph') return false;

          const current = currentIndentLeft(node);
          const next = Math.min(MAX_INDENT_PX, current + INDENT_STEP_PX);
          if (next === current) return false;

          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0, indentLeft: next });
            dispatch(tr);
          }
          return true;
        },

      decreaseIndent:
        () =>
        ({ tr, state, dispatch }: { tr: any; state: any; dispatch: any }) => {
          const { $from } = state.selection;
          const pos = $from.before($from.depth);
          const node = state.doc.nodeAt(pos);
          if (!node || node.type.name !== 'paragraph') return false;

          const current = currentIndentLeft(node);
          if (current <= 0) return false; // at the floor: today's no-op

          const next = Math.max(0, current - INDENT_STEP_PX);
          if (dispatch) {
            tr.setNodeMarkup(pos, undefined, { ...node.attrs, indent: 0, indentLeft: next });
            dispatch(tr);
          }
          return true;
        },

      clearFormatting:
        () =>
        ({ editor }: { editor: any }) => {
          editor
            .chain()
            .focus()
            .unsetAllMarks()
            .updateAttributes('paragraph', { lineHeight: null, indent: 0, textAlign: null })
            .updateAttributes('heading', { lineHeight: null, textAlign: null })
            .run();
          return true;
        },
    };
  },

  addKeyboardShortcuts() {
    /**
     * TAB KEYMAPS (P1 semantics — receipts first, wiring second):
     *  - LIST (receipt: ListItem's Tab→sinkListItem / Shift-Tab→
     *    liftListItem are alive, verified empirically): the list
     *    extensions register before this one, so inside a list their
     *    handlers win. The guard below covers the first-item case
     *    where their sink declines and the event falls through: Tab
     *    there does NOTHING (today's behavior).
     *  - codeBlock (receipt: enableTabIndentation defaults FALSE): a
     *    literal '\t' character (the stock option inserts SPACES —
     *    rejected deliberately).
     *  - paragraph AT BLOCK START (empty selection, pos 0): the GDocs
     *    convention — firstLineIndent += 32. Shift+Tab: −= 32, floored
     *    at 0.
     *  - paragraph MID-LINE: NO-OP v1 (returning true swallows the
     *    keypress so the browser's focus traversal cannot steal focus).
     *    DEFERRED: a tab CHARACTER in prose needs engine tab stops —
     *    issue tree, separate session; do not bolt it on here.
     *  - headings carry no indent attrs (receipt: HeadingWithExtras
     *    adds only lineHeight) → Tab does nothing there.
     *  - ctrl+]/ctrl+[ remain the paragraph indentLeft ±32 commands
     *    (registered, rebindable — see shortcuts.ts).
     */
    const inListItem = ($from: any): boolean => {
      for (let i = $from.depth; i > 0; i--) {
        if ($from.node(i).type.name === 'listItem') return true;
      }
      return false;
    };

    const firstLineIndentOf = (node: { attrs?: Record<string, unknown> }): number =>
      typeof node.attrs?.firstLineIndent === 'number' &&
      Number.isFinite(node.attrs.firstLineIndent) &&
      node.attrs.firstLineIndent > 0
        ? node.attrs.firstLineIndent
        : 0;

    return {
      Tab: () => {
        const { $from, empty } = this.editor.state.selection;
        const name = $from.parent.type.name;

        if (name === 'codeBlock') {
          if (!empty) return false;
          return this.editor.commands.insertContent('\t');
        }
        if (name !== 'paragraph') return false; // headings: nothing today
        if (inListItem($from)) return false; // the list owns Tab

        // Mid-line: NO-OP v1 (see the deferred tab-stop note above).
        if (!empty || $from.parentOffset !== 0) return true;

        // Block start: first line indent, one gutter out.
        const node = $from.parent;
        return this.editor.commands.updateAttributes('paragraph', {
          firstLineIndent: firstLineIndentOf(node) + INDENT_STEP_PX,
        });
      },

      'Shift-Tab': () => {
        const { $from, empty } = this.editor.state.selection;
        const name = $from.parent.type.name;

        if (name !== 'paragraph') return false;
        if (inListItem($from)) return false;
        if (!empty || $from.parentOffset !== 0) return true; // NO-OP v1 (symmetric)

        // Floor: 0 (below that there is nothing to un-indent via
        // Shift+Tab — ctrl+[ owns paragraph indentLeft).
        const node = $from.parent;
        const fli = firstLineIndentOf(node);
        if (fli <= 0) return false;
        return this.editor.commands.updateAttributes('paragraph', {
          firstLineIndent: fli - INDENT_STEP_PX,
        });
      },

      // BACKSPACE STEP (Word/GDocs, P1 ordering): at an indented
      // paragraph's start (empty selection, offset 0), step the
      // FIRST-LINE indent out first; only when that is already 0 does
      // the paragraph indentLeft step (the M6.2 rule). Everything
      // else — normal backspace.
      Backspace: () => {
        const { state } = this.editor;
        const { $from, empty } = state.selection;

        if (!empty || $from.parentOffset !== 0) return false;

        const node = $from.parent;
        if (node.type.name !== 'paragraph') return false;

        const fli = firstLineIndentOf(node);
        if (fli > 0) {
          return this.editor.commands.updateAttributes('paragraph', {
            firstLineIndent: fli - INDENT_STEP_PX,
          });
        }
        if (currentIndentLeft(node) > 0) {
          return this.editor.commands.decreaseIndent();
        }
        return false;
      },
    };
  },
});
