import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from '@testing-library/react';
import { renderTensor, settleLayout } from './harness';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';

/**
 * M-STYLES STEP 5 — THE FLAGSHIP EPOCH TESTS. A definition edit is a
 * registry mutation: the epoch bumps, the adapter cache rebuilds, and
 * every user of the style restyles in BOTH modes. In paginated mode
 * the engine's lastStats (surfaced on the __benchRelayouts seam)
 * shows exactly the re-walk the epoch caused — layout-relevant edits
 * re-break (blocksWalked > 0), paint-only edits splice
 * (blocksWalked = 0) and the BlockCanvas epoch key repaints anyway
 * (amendment 1, test 2b — the flagship twin).
 */

type BenchRelayouts = {
  relayouts: Array<{ total: number; at: number; lastStats?: { blocksWalked: number; linesRebroken: number; blocksSpliced: number; invalidated: boolean } }>;
};

function lastStats() {
  const bench = (globalThis as { __benchRelayouts?: BenchRelayouts }).__benchRelayouts;
  if (!bench || bench.relayouts.length === 0) throw new Error('no relayout recorded');
  return bench.relayouts[bench.relayouts.length - 1]!.lastStats!;
}

function resetPaintOps() {
  (globalThis as unknown as { __paintOps: unknown[] }).__paintOps.length = 0;
}

type PaintOp = { op: string; args: unknown[]; fillStyle?: string; font?: string };

function fillTextOps(): PaintOp[] {
  return ((globalThis as unknown as { __paintOps: PaintOp[] }).__paintOps).filter(
    (o) => o.op === 'fillText'
  );
}

function resetRegistry() {
  useStyleRegistryStore.getState().setLayers({ global: [], doc: [] });
}

beforeEach(() => {
  resetRegistry();
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      editor: { ...state.config.editor, defaultPageLayout: 'Pages' },
    },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('THE EPOCH TEST (flagship): edit a definition → all users restyle, both modes', () => {
  it('paginated: change one property → every styled paragraph re-walks (lastStats receipt)', async () => {
    const created = useStyleRegistryStore.getState().createDefinition({
      name: 'Legal Body',
      kind: 'paragraph',
      properties: { fontSize: 14, lineHeight: 1.5, firstLineIndent: 24 },
    });
    const { editor } = renderTensor('<p>First para</p><p>Second para</p><p>Third para</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle(created.id);
      editor.commands.setTextSelection(17);
      editor.commands.applyParagraphStyle(created.id);
    });
    await settleLayout();
    resetPaintOps();

    // THE EDIT: one property of the definition.
    useStyleRegistryStore.getState().updateDefinition(created.id, {
      properties: { fontSize: 15, lineHeight: 1.5, firstLineIndent: 24 },
    });
    await settleLayout();

    // THE RECEIPT: the styled blocks re-break (their run styles changed)
    // and, because a 14→15px edit MOVES GEOMETRY, the third block
    // re-walks too (lineCache hits — not re-broken); splicing was
    // impossible downstream of a height change. All three blocks
    // walked, exactly two re-broken.
    const stats = lastStats();
    expect(stats.blocksWalked).toBe(3);
    expect(stats.linesRebroken).toBe(2);
    expect(stats.blocksSpliced).toBe(0);

    // And the canvas painted the NEW size on every styled run.
    const ops = fillTextOps().filter((o) => o.args[0] === 'First para' || o.args[0] === 'Second para');
    expect(ops.length).toBeGreaterThanOrEqual(2);
    for (const op of ops) expect(op.font).toContain('15px');
  });

  it('paginated: OVERWRITE the built-in Quote → ALL Quote paragraphs restyle (a definition edit, never a stamp)', async () => {
    useStyleRegistryStore.getState().updateDefinition('quote', {
      properties: { italic: true, color: '#0a58ca' },
    });
    const { editor } = renderTensor(
      '<p>Quote one</p><p>Quote two</p><p>Quote three</p><p>plain</p>'
    );
    await settleLayout();
    for (const pos of [2, 13, 24]) {
      act(() => {
        editor.commands.setTextSelection(pos);
        editor.commands.applyParagraphStyle('quote');
      });
    }
    await settleLayout();
    resetPaintOps();

    // Overwriting a built-in is a DEFINITION EDIT: it flows through
    // the registry-epoch path and restyles EVERY Quote user — not a
    // stamp that only touched the selection.
    useStyleRegistryStore.getState().updateDefinition('quote', {
      properties: { italic: true, color: '#22c55e' },
    });
    await settleLayout();

    const ops = fillTextOps().filter((o) =>
      ['Quote one', 'Quote two', 'Quote three'].includes(o.args[0] as string)
    );
    expect(ops.length).toBeGreaterThanOrEqual(3);
    for (const op of ops) expect(op.fillStyle).toBe('#22c55e');
    // Nothing was stamped: the PM doc still carries only styleIds, and
    // the plain paragraph is untouched ink.
    const plain = fillTextOps().find((o) => o.args[0] === 'plain');
    expect(plain?.fillStyle).toBe('#000'); // the paint default — not the quote color
  });

  it('2b (flagship twin): a COLOR-ONLY edit splices in the engine (blocksWalked = 0) but the canvas repaints', async () => {
    const created = useStyleRegistryStore.getState().createDefinition({
      name: 'Ink Color',
      kind: 'paragraph',
      properties: { color: '#0a58ca' },
    });
    const { editor } = renderTensor('<p>Colored one</p><p>Colored two</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle(created.id);
      editor.commands.setTextSelection(14);
      editor.commands.applyParagraphStyle(created.id);
    });
    await settleLayout();
    resetPaintOps();

    useStyleRegistryStore.getState().updateDefinition(created.id, {
      properties: { color: '#e111d7' },
    });
    await settleLayout();

    // Color is a PAINT-tier fact (RunDecor): the engine's contentHash
    // is unchanged → splices, walks nothing — that is CORRECT.
    const stats = lastStats();
    expect(stats.blocksWalked).toBe(0);
    // But the styled text still repaints with the new color — the
    // BlockCanvas epoch key pierces the LineBox dirty-skip.
    const ops = fillTextOps().filter((o) =>
      ['Colored one', 'Colored two'].includes(o.args[0] as string)
    );
    expect(ops.length).toBeGreaterThanOrEqual(2);
    for (const op of ops) expect(op.fillStyle).toBe('#e111d7');
  });

  it("amendment 6: edit 'normal' fontSize → unstyled paragraphs AND the baseStyle (empty lines) restyle — the engine wholesale-invalidates", async () => {
    const { editor } = renderTensor('<p>Unstyled one</p><p></p><p>Unstyled two</p>');
    await settleLayout();
    resetPaintOps();

    useStyleRegistryStore.getState().updateDefinition('normal', {
      properties: { fontSize: 20 },
    });
    await settleLayout();

    // baseStyle changed → baseStyleHash changed → the engine drops
    // both caches wholesale (invalidated: true, full walk).
    const stats = lastStats();
    expect(stats.invalidated).toBe(true);
    expect(stats.blocksWalked).toBe(3);
    // Unstyled paragraphs now paint at 20px...
    const ops = fillTextOps().filter((o) =>
      ['Unstyled one', 'Unstyled two'].includes(o.args[0] as string)
    );
    expect(ops.length).toBe(2);
    for (const op of ops) expect(op.font).toContain('20px');

    // ...and the EMPTY line restyles too: it measures under baseStyle
    // (P1 ruling), so its line box is the 20px font's. Pure check:
    // the same doc, adapter + engine directly, before vs after.
    const { createLayoutEngine } = await import('@tensor-editor/engine');
    const { FakeMetrics } = await import('./fakeMetrics');
    const { resolveNormalBase } = await import('@/lib/styles/resolve');
    const { pmDocToSemantic } = await import('@/lib/paginated/adapter');
    const LETTER = {
      page: { width: 816, height: 1056 },
      margins: { top: 96, right: 96, bottom: 96, left: 96 },
    };
    const merged = useStyleRegistryStore.getState().merged;
    const adapted = pmDocToSemantic(
      editor.state.doc,
      resolveNormalBase('system-ui', 16, merged),
      { definitions: merged, epoch: useStyleRegistryStore.getState().epoch }
    );
    const result = createLayoutEngine({ metrics: FakeMetrics }).layout(adapted.doc, LETTER);
    // Shell FakeMetrics: ascent 0.8 + descent 0.2 = 1.0 × the font —
    // 20px baseStyle → a 20px empty line (16.6 would be the pre-edit
    // answer at 16... it was exactly 16); the receipt is 20.
    const emptyLine = result.lines.find(
      (l) => l.blockId === adapted.blocks.find((b) => b.text === '')!.id
    )!;
    expect(emptyLine.rect.height).toBe(20);
  });

  it('pageless: the definition edit regenerates the stylesheet and restyles via the class', async () => {
    useConfigStore.setState((state) => ({
      config: {
        ...state.config,
        editor: { ...state.config.editor, defaultPageLayout: 'Pageless' },
      },
    }));
    const created = useStyleRegistryStore.getState().createDefinition({
      name: 'Legal Body',
      kind: 'paragraph',
      properties: { fontSize: 14 },
    });
    const { editor } = renderTensor('<p>Pageless para</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle(created.id);
    });

    const para = editor.view.dom.querySelector('p');
    expect(para?.className).toContain(`wp-style-${created.id}`);

    const sheet = () =>
      (document.querySelector('[data-testid="styles-stylesheet"]') as HTMLElement)?.textContent ?? '';
    expect(sheet()).toContain(`.wp-style-${created.id} { font-size: 14px; }`);

    // THE EDIT — live restyle in pageless: same paragraph, same class,
    // new rule (nothing was stamped onto the node).
    useStyleRegistryStore.getState().updateDefinition(created.id, {
      properties: { fontSize: 15 },
    });
    await act(async () => {});
    expect(sheet()).toContain(`.wp-style-${created.id} { font-size: 15px; }`);
    // The node itself is untouched — styleId only, no inline stamp.
    expect(para?.getAttribute('style')).toBeNull();
    expect(para?.getAttribute('data-style-id')).toBe(created.id);
  });
});

describe('both-modes parity scaffolding (pageless defaults restore)', () => {
  it('restores the Pages default so sibling suites are unaffected', async () => {
    useConfigStore.setState((state) => ({
      config: {
        ...state.config,
        editor: { ...state.config.editor, defaultPageLayout: 'Pages' },
      },
    }));
    void DEFAULT_MARGINS;
    void PAGE_GAP;
    expect(useConfigStore.getState().config.editor.defaultPageLayout).toBe('Pages');
  });
});
