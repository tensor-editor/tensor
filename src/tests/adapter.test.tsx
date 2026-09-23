import { describe, it, expect } from 'vitest';
import { act } from '@testing-library/react';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { renderTensorInScrollContainer } from './harness';

const BASE = { fontFamily: 'system-ui', fontSize: 16 };

/**
 * M5.6 STEP 2 — the identity cache contract: a mid-document keystroke
 * leaves untouched blocks' semantic Block objects REFERENCE-IDENTICAL
 * (which is exactly what the engine's hash identity cache — SESSION E —
 * keys on). Positions (from/to) are exempt: they shift with siblings.
 */
describe('M5.6 STEP 2: incremental adapter (reference reuse)', () => {
  it('same doc, same baseStyle -> all blocks reference-identical', async () => {
    const { editor } = renderTensorInScrollContainer('<p>one</p><p>two</p><p>three</p>');
    await act(async () => {});
    const a = pmDocToSemantic(editor.state.doc, BASE);
    const b = pmDocToSemantic(editor.state.doc, BASE);
    expect(b.doc.blocks).toEqual(a.doc.blocks);
    expect(b.doc.blocks[0]).toBe(a.doc.blocks[0]);
    expect(b.doc.blocks[2]).toBe(a.doc.blocks[2]);
    expect(b.blocks[0].runs).toBe(a.blocks[0].runs);
    expect(b.blocks[0].runDecor).toBe(a.blocks[0].runDecor);
  });

  it('mid-doc keystroke: untouched blocks keep identity, the edited one is new', async () => {
    const { editor } = renderTensorInScrollContainer('<p>one</p><p>two</p><p>three</p>');
    await act(async () => {});
    const before = pmDocToSemantic(editor.state.doc, BASE);

    // Type into the middle paragraph -> new PM node object for it only.
    // 'two' text sits at positions 6-8; 7 = after the 't'.
    act(() => {
      editor.commands.setTextSelection(7);
      editor.commands.insertContent('X');
    });

    const after = pmDocToSemantic(editor.state.doc, BASE);
    expect(after.doc.blocks[0]).toBe(before.doc.blocks[0]); // untouched: same object
    expect(after.doc.blocks[2]).toBe(before.doc.blocks[2]); // untouched: same object
    expect(after.doc.blocks[1]).not.toBe(before.doc.blocks[1]); // edited: new object
    expect(after.doc.blocks[1].runs[0]!.text).toBe('tXwo');
  });

  it('baseStyle change invalidates: new objects, correct new defaults', async () => {
    const { editor } = renderTensorInScrollContainer('<p>plain text</p>');
    await act(async () => {});
    const a = pmDocToSemantic(editor.state.doc, BASE);
    const b = pmDocToSemantic(editor.state.doc, { fontFamily: 'Georgia', fontSize: 20 });
    expect(b.doc.blocks[0]).not.toBe(a.doc.blocks[0]);
    expect(b.doc.blocks[0].runs[0]!.style.fontFamily).toBe('Georgia');
    expect(b.doc.blocks[0].runs[0]!.style.fontSize).toBe(20);
  });

  it('forced-break blocks clone per call but stay content-correct', async () => {
    const { editor } = renderTensorInScrollContainer(
      '<p>first</p><div data-page-break="true"></div><p>second</p>'
    );
    await act(async () => {});
    const a = pmDocToSemantic(editor.state.doc, BASE);
    const b = pmDocToSemantic(editor.state.doc, BASE);
    expect(a.doc.blocks[1].flow).toEqual({ breakBefore: 'page' });
    expect(b.doc.blocks[1].flow).toEqual({ breakBefore: 'page' });
    // The flow-clone breaks identity by design (sibling fact, not node fact).
    expect(b.doc.blocks[1]).not.toBe(a.doc.blocks[1]);
    // The node-facts inside are still shared.
    expect(b.doc.blocks[1].runs).toBe(a.doc.blocks[1].runs);
  });

  it('positions stay fresh: deleting a block shifts later from/to', async () => {
    const { editor } = renderTensorInScrollContainer('<p>one</p><p>two</p><p>three</p>');
    await act(async () => {});
    act(() => {
      // Remove the whole first node ('<p>one</p>' spans [0,5)).
      editor.commands.deleteRange({ from: 0, to: 5 });
    });
    const after = pmDocToSemantic(editor.state.doc, BASE);
    expect(after.blocks[0].text).toBe('two');
    expect(after.blocks[0].from).toBe(0); // shifted down — fresh positions
    expect(after.doc.blocks[0].runs[0]!.text).toBe('two');
  });

  it('font family on the textStyle mark is extracted (tiptap v3 global attribute)', async () => {
    // M5.6 STEP 4 receipt: the family used to be read from a standalone
    // 'fontFamily' mark that tiptap v3 never creates.
    const { editor } = renderTensorInScrollContainer('<p>styled words</p>');
    await act(async () => {});
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 13 });
      editor.commands.setFontFamily('Courier New');
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE);
    expect(adapted.doc.blocks[0].runs[0]!.style.fontFamily).toBe('Courier New');

    // Pageless DOM sanity: the same mark renders in the hidden view.
    const styled = (document.querySelector('.pm-input-only [style*="font-family"]') as HTMLElement | null);
    expect(styled?.getAttribute('style')).toContain('Courier New');
  });
});
