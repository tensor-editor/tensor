import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { renderTensor } from './harness';
import { settleLayout } from './harness';

function topLevelIds(doc: PMNode): Array<string | null> {
  const ids: Array<string | null> = [];
  doc.forEach((node) => {
    ids.push(node.attrs.blockId ?? null);
  });
  return ids;
}

describe('BlockIdExtension', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('f. paste re-mints ids (no duplicates)', async () => {
    const { editor } = renderTensor();
    await settleLayout();

    // Load pass: every created block got a minted id (legacy docs without
    // ids come through this same path).
    act(() => {
      editor.commands.setContent('<p>A</p><p>B</p>');
    });
    const before = topLevelIds(editor.state.doc);
    expect(before).toHaveLength(2);
    expect(before[0]).toBeTruthy();
    expect(before[1]).toBeTruthy();
    expect(before[0]).not.toBe(before[1]);

    // "Paste": insert a paragraph carrying an EXISTING id (what a copy
    // from this document produces) — the LATER node is re-minted; the
    // original keeps its id.
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size);
      editor.commands.insertContent({
        type: 'paragraph',
        attrs: { blockId: before[0] },
        content: [{ type: 'text', text: 'Pasted' }],
      });
    });

    const after = topLevelIds(editor.state.doc);
    expect(after).toHaveLength(3);
    expect(new Set(after).size).toBe(3); // uniqueness assert (engine would throw on duplicates)
    expect(after[0]).toBe(before[0]); // earlier occurrence keeps its id
    expect(after[2]).not.toBe(before[0]); // the later (pasted) node re-minted

    // Splitting a block (keepOnSplit: false) also duplicates -> re-mint.
    act(() => {
      editor.commands.setContent('<p>splitme</p>');
    });
    const single = topLevelIds(editor.state.doc)[0]!;
    act(() => {
      editor.commands.setTextSelection(1 + 4); // after 'split'
      editor.commands.splitBlock();
    });
    const splitIds = topLevelIds(editor.state.doc);
    expect(splitIds).toHaveLength(2);
    expect(new Set(splitIds).size).toBe(2);
    expect(splitIds[0]).toBe(single);
  });
});