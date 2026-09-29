import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { renderTensor, settleLayout } from './harness';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import { headingStyleId, isHeadingStyleId } from '@/lib/styles/types';
import {
  captureStyleFromSelection,
  effectiveSelectionRunStyle,
  selectionBaseline,
} from '@/lib/styles/selection';

/**
 * M-STYLES STEP 5 + amendments 4/5: the model — apply/convert
 * commands, reactive heading sync, one-char-style-per-span.
 */

function resetRegistry() {
  useStyleRegistryStore.getState().setLayers({ global: [], doc: [] });
}

describe('apply/convert commands', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('applying a paragraph style sets styleId on the paragraph (no stamped attrs)', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('quote');
    });
    const p = editor.state.doc.firstChild!;
    expect(p.type.name).toBe('paragraph');
    expect(p.attrs.styleId).toBe('quote');
    // NOT a stamp: no concrete italic mark was pushed onto the text.
    expect(editor.state.doc.nodeAt(2)?.marks.some((m) => m.type.name === 'italic')).toBe(false);
  });

  it('heading entries CONVERT the node and sync the styleId', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('heading-2');
    });
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('heading');
    expect(node.attrs.level).toBe(2);
    expect(node.attrs.styleId).toBe('heading-2');
  });

  it('applying a NON-heading paragraph style to a heading CONVERTS it back (amendment 4)', async () => {
    const { editor } = renderTensor('<h2>Big words</h2>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('quote');
    });
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('paragraph');
    expect(node.attrs.styleId).toBe('quote');
  });

  it('Ctrl+Alt+2 on a level-1 head re-aligns styleId to heading-2 (reactive sync)', async () => {
    const { editor } = renderTensor('<h1>Title</h1>');
    await settleLayout();
    expect(editor.state.doc.firstChild!.attrs.styleId).toBe('heading-1');
    act(() => {
      // The keyboard shortcut's command path (Heading's Mod-Alt-N
      // keymap calls setHeading).
      editor.commands.setTextSelection(2);
      editor.commands.setHeading({ level: 2 });
    });
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('heading');
    expect(node.attrs.level).toBe(2);
    expect(node.attrs.styleId).toBe('heading-2');
  });

  it('every paragraph has a styleId — the non-optional invariant, old docs included', async () => {
    // setContent is the old-doc load path: no styleId anywhere in the
    // JSON, attr defaults carry it.
    const { editor } = renderTensor('<p>one</p><h3>two</h3><p>three</p>');
    await settleLayout();
    act(() => {
      editor.commands.setContent('<p>legacy</p><h2>legacy head</h2>');
    });
    editor.state.doc.forEach((node) => {
      if (node.type.name === 'paragraph') expect(node.attrs.styleId).toBe('normal');
      if (node.type.name === 'heading')
        expect(node.attrs.styleId).toBe(headingStyleId(node.attrs.level));
    });
  });

  it('clearFormatting resets the STYLE: heading → paragraph with styleId normal', async () => {
    const { editor } = renderTensor('<h2>Big words</h2>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.clearFormatting();
    });
    const node = editor.state.doc.firstChild!;
    expect(node.type.name).toBe('paragraph');
    expect(node.attrs.styleId).toBe('normal');
  });
});

describe('char style marks', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('applyCharStyle sets the charStyle mark, stacking with direct formatting', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.commands.setBold();
      editor.commands.applyCharStyle('emphasis');
    });
    const textNode = editor.state.doc.nodeAt(2)!;
    const markNames = textNode.marks.map((m) => m.type.name);
    expect(markNames).toContain('charStyle');
    expect(markNames).toContain('bold');
    expect(textNode.marks.find((m) => m.type.name === 'charStyle')?.attrs.styleId).toBe('emphasis');
  });

  it('ONE CHAR STYLE PER SPAN (amendment 5): Emphasis then Strong → exactly one charStyle (Strong)', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.commands.applyCharStyle('emphasis');
      editor.commands.applyCharStyle('strong');
    });
    const textNode = editor.state.doc.nodeAt(2)!;
    const charMarks = textNode.marks.filter((m) => m.type.name === 'charStyle');
    expect(charMarks).toHaveLength(1);
    expect(charMarks[0]!.attrs.styleId).toBe('strong');
  });

  it('collapsed-caret apply stores the mark for the next input (and replaces a stored one)', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(3); // between 'So' and 'me'
      editor.commands.applyCharStyle('emphasis');
    });
    act(() => {
      editor.commands.insertContent('X'); // 'SoXme text'
    });
    const x = editor.state.doc.nodeAt(3)!;
    expect(x.marks.some((m) => m.type.name === 'charStyle' && m.attrs.styleId === 'emphasis')).toBe(true);

    act(() => {
      editor.commands.setTextSelection(4); // right after the X
      editor.commands.applyCharStyle('strong');
    });
    act(() => {
      editor.commands.insertContent('Y'); // 'SoXYme text'
    });
    const y = editor.state.doc.nodeAt(4)!;
    const charMarks = y.marks.filter((m) => m.type.name === 'charStyle');
    expect(charMarks).toHaveLength(1);
    expect(charMarks[0]!.attrs.styleId).toBe('strong');
  });

  it('isHeadingStyleId accepts 1..6 (keyboard levels included)', () => {
    for (let level = 1; level <= 6; level++) expect(isHeadingStyleId(headingStyleId(level))).toBe(true);
    expect(isHeadingStyleId('heading-7')).toBe(false);
    expect(isHeadingStyleId('normal')).toBe(false);
  });
});

describe('effective values (Font/size dropdowns — addendum 1)', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('a caret in a heading shows the heading RESOLVED size/family (fixes the blank-dropdown default)', async () => {
    const { editor } = renderTensor('<h1>Big Title</h1>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(3);
    });
    const merged = useStyleRegistryStore.getState().merged;
    const effective = effectiveSelectionRunStyle(
      editor,
      selectionBaseline(editor, 'system-ui', 16),
      merged
    );
    expect(effective.fontSize).toBe(32); // heading-1 built-in
    expect(effective.bold).toBe(true);
  });

  it('the cascade reaches the dropdown: char style + direct mark both show effective values', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.commands.setFontFamily('Georgia');
      editor.commands.applyCharStyle('strong');
      editor.commands.setTextSelection(3);
    });
    const merged = useStyleRegistryStore.getState().merged;
    const effective = effectiveSelectionRunStyle(
      editor,
      selectionBaseline(editor, 'system-ui', 16),
      merged
    );
    expect(effective.fontFamily).toBe('Georgia'); // direct mark
    expect(effective.bold).toBe(true); // char style
  });

  it('capture-from-selection receipt: directly-bolded Normal → captured definition includes bold', async () => {
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.commands.setBold();
      editor.commands.setTextSelection(3);
    });
    const merged = useStyleRegistryStore.getState().merged;
    const captured = captureStyleFromSelection(
      editor,
      selectionBaseline(editor, 'system-ui', 16),
      merged
    );
    expect(captured).toEqual({ bold: true });
  });
});
