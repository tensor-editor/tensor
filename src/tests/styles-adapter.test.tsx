import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderTensor, settleLayout } from './harness';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { useStyleRegistryStore, lookupStyle } from '@/lib/styles/registry';
import type { StyleDefinition, StyleRegistrySnapshot } from '@/lib/styles/types';

/**
 * M-STYLES STEP 5: the ADAPTER half of resolution — registry-driven
 * runs, the epoch cache, transformed text, missing-id fallback.
 *
 * EPOCH COLLISION NOTE: the rendered PaginatedView relayouts with the
 * STORE's snapshot (small epoch numbers); these direct adapter calls
 * use deliberately large, per-test epoch values so the hand-built
 * snapshots never collide with the store snapshot at the same epoch
 * (the contextKey keys on the epoch — the store-consistency contract
 * documented in types.ts).
 */

const BASE = { fontFamily: 'system-ui', fontSize: 16 };

let epochSeq = 1000;
function snapshot(defs: StyleDefinition[]): StyleRegistrySnapshot {
  epochSeq += 1;
  return { definitions: Object.fromEntries(defs.map((d) => [d.id, d])), epoch: epochSeq };
}

const LEGAL_BODY: StyleDefinition = {
  id: 'legal-body',
  name: 'Legal Body',
  kind: 'paragraph',
  properties: { fontSize: 14, lineHeight: 1.5, firstLineIndent: 24 },
};

const SHOUT: StyleDefinition = {
  id: 'shout',
  name: 'Shout',
  kind: 'paragraph',
  properties: { textTransform: 'uppercase' },
};

function resetRegistry() {
  useStyleRegistryStore.getState().setLayers({ global: [], doc: [] });
}

describe('adapter resolution through the registry', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('a styled paragraph resolves the definition into its runs', async () => {
    const { editor } = renderTensor('<p>Legal text here</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('legal-body');
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE, snapshot([LEGAL_BODY]));
    const block = adapted.doc.blocks[0]!;
    expect(block.runs[0]!.style.fontSize).toBe(14);
    expect(block.runs[0]!.style.lineHeight).toBe(1.5);
    expect(block.firstLineIndent).toBe(24);
  });

  it('missing styleId → baseline rendering + ONE dev warning, never silent', async () => {
    const { editor } = renderTensor('<p>Plain words</p>');
    await settleLayout();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      act(() => {
        editor.commands.setTextSelection(2);
        editor.commands.applyParagraphStyle('ghost-style');
      });
      const adapted = pmDocToSemantic(editor.state.doc, BASE, snapshot([]));
      const block = adapted.doc.blocks[0]!;
      expect(block.runs[0]!.style.fontSize).toBe(16);
      expect(block.runs[0]!.style.fontFamily).toBe('system-ui');
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });

  it('precedence in the adapter: direct bold beats a char-style non-bold', async () => {
    const meek: StyleDefinition = {
      id: 'meek',
      name: 'Meek',
      kind: 'character',
      properties: { bold: false },
    };
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 10 });
      editor.commands.setBold();
      editor.commands.applyCharStyle('meek');
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE, snapshot([meek]));
    expect(adapted.doc.blocks[0]!.runs[0]!.style.bold).toBe(true);
  });

  it('style color rides RunDecor (paint tier), engine hash untouched', async () => {
    const colorStyle: StyleDefinition = {
      id: 'colorful',
      name: 'Colorful',
      kind: 'paragraph',
      properties: { color: '#0a58ca' },
    };
    const { editor } = renderTensor('<p>Some text</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('colorful');
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE, snapshot([colorStyle]));
    expect(adapted.blocks[0]!.runDecor[0]!.color).toBe('#0a58ca');
    // The same doc, missing definition: decor falls back silently to
    // the paint default (undefined = #000 in paint.ts).
    const adapted2 = pmDocToSemantic(editor.state.doc, BASE, snapshot([]));
    expect(adapted2.blocks[0]!.runDecor[0]!.color).toBeUndefined();
  });
});

describe('transformed runs (amendment 3)', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('run TEXT is transformed — the engine measures the transformed string', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('shout');
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE, snapshot([SHOUT]));
    expect(adapted.doc.blocks[0]!.runs[0]!.text).toBe('HELLO WORLD');
    expect(adapted.blocks[0]!.text).toBe('HELLO WORLD');
    // LENGTH-PRESERVED: PM↔engine offsets stay identity-mapped.
    expect(adapted.blocks[0]!.text.length).toBe('hello world'.length);
    // PM keeps the SOURCE: the document text is unchanged.
    expect(editor.state.doc.textContent).toBe('hello world');
  });

  it('the SAME engine doc with no transform: run text is source', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settleLayout();
    const adapted = pmDocToSemantic(editor.state.doc, BASE, snapshot([]));
    expect(adapted.blocks[0]!.text).toBe('hello world');
  });
});

describe('the registry epoch invalidates the adapter identity cache', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('same epoch → reference-stable blocks (the O(edit) contract holds); epoch bump → wholesale rebuild with new resolution', async () => {
    const { editor } = renderTensor('<p>Style me</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('legal-body');
    });

    const snapA = snapshot([LEGAL_BODY]);
    const a1 = pmDocToSemantic(editor.state.doc, BASE, snapA);
    const a2 = pmDocToSemantic(editor.state.doc, BASE, snapA);
    // Reference-stable across calls at the same epoch: the SEMANTIC
    // blocks are the engine's splice currency (AdapterBlock records
    // are per-call projections carrying fresh positions).
    expect(a2.doc.blocks[0]).toBe(a1.doc.blocks[0]);
    expect(a2.blocks[0]).toEqual(a1.blocks[0]);

    // Edit the definition (a later epoch): same PM doc, wholesale reconversion.
    const edited = { ...LEGAL_BODY, properties: { ...LEGAL_BODY.properties, fontSize: 15 } };
    const b = pmDocToSemantic(editor.state.doc, BASE, snapshot([edited]));
    expect(b.doc.blocks[0]).not.toBe(a1.doc.blocks[0]);
    expect(b.doc.blocks[0]!.runs[0]!.style.fontSize).toBe(15);

    // The OLD resolved objects are untouched (immutability).
    expect(a1.blocks[0]!.runs[0]!.style.fontSize).toBe(14);
  });

  it('a heading resolves through heading-{level} (the sync twin), not the raw attr', async () => {
    const { editor } = renderTensor('<h2>Head two</h2>');
    await settleLayout();
    // The synced attr (heading-2) and the level-derived id agree — and
    // the definition drives the size.
    const defs = snapshot([
      { id: 'heading-2', name: 'Heading 2', kind: 'paragraph', properties: { fontSize: 26, bold: true } },
    ]);
    const adapted = pmDocToSemantic(editor.state.doc, BASE, defs);
    expect(adapted.doc.blocks[0]!.kind).toBe('heading');
    expect(adapted.doc.blocks[0]!.runs[0]!.style.fontSize).toBe(26);
    void lookupStyle;
  });
});
