import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { createLayoutEngine, type TextMetrics } from '@tensor-editor/engine';
import { renderTensor, settleLayout } from './harness';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { caretGeometry } from '@/lib/paginated/positionMap';
import { hitTest } from '@/lib/paginated/hitTest';
import { blockOffsetToPmPos } from '@/lib/paginated/positionMap';
import { searchPluginKey } from '@/lib/editor/search/SearchExtension';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import type { StyleDefinition } from '@/lib/styles/types';

/**
 * M-STYLES addendum 3: TRANSFORMED MEASUREMENT integration. The
 * adapter transforms run text; the engine measures the TRANSFORMED
 * string; the caret, hitTest, and search stay in source coordinates
 * via the length-preserving invariant (offsets identity-mapped).
 *
 * WiderCapsMetrics: uppercase text measures 14px/char, everything else
 * 10px/char (FakeMetrics' rate) — so a paragraph that WRAPS under the
 * transform but would NOT wrap if measured against source proves the
 * measurement flows through the transformed text.
 */

const WiderCapsMetrics: TextMetrics = {
  measure: (text) => (text === text.toUpperCase() ? text.length * 14 : text.length * 10),
  ascent: (style) => 0.85 * style.fontSize,
  descent: (style) => 0.25 * style.fontSize,
};

const LETTER = {
  page: { width: 816, height: 1056 },
  margins: { top: 96, right: 96, bottom: 96, left: 96 },
};
const CONTENT_WIDTH = 816 - 192; // 624

const SHOUT: StyleDefinition = {
  id: 'shout',
  name: 'Shout',
  kind: 'paragraph',
  properties: { textTransform: 'uppercase' },
};

function snapshotOf(defs: StyleDefinition[]) {
  // Unique epoch per call — the rendered view relayouts at store epochs
  // (small numbers); hand-built snapshots must never collide with a
  // store snapshot at the same epoch (adapter contextKey contract).
  snapshotOf.epoch += 1;
  return { definitions: Object.fromEntries(defs.map((d) => [d.id, d])), epoch: snapshotOf.epoch };
}
snapshotOf.epoch = 2000;

function resetRegistry() {
  useStyleRegistryStore.getState().setLayers({ global: [], doc: [] });
}

describe('transformed measurement (amendment 3)', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('an uppercase-styled paragraph WRAPS on the transformed text — no overrun', async () => {
    const { editor } = renderTensor(`<p>${'a'.repeat(60)}</p>`);
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('shout');
    });

    const adapted = pmDocToSemantic(editor.state.doc, { fontFamily: 'system-ui', fontSize: 16 }, snapshotOf([SHOUT]));
    // The adapter handed the engine UPPERCASED text.
    expect(adapted.blocks[0]!.text).toBe('A'.repeat(60));

    const result = createLayoutEngine({ metrics: WiderCapsMetrics }).layout(adapted.doc, LETTER);
    const lines = result.lines;
    // Source-measured (10px/char): 600px — ONE line, no wrap.
    // Transformed-measured (14px/char): 840px — wraps.
    expect(lines.length).toBe(2);
    // NO OVERRUN: every line's ink fits the content box.
    for (const line of lines) {
      expect(line.rect.width).toBeLessThanOrEqual(CONTENT_WIDTH);
      expect(line.rect.x + line.rect.width).toBeLessThanOrEqual(CONTENT_WIDTH);
    }
    // Line 1 carries exactly the transformed width (44 chars × 14).
    expect(lines[0]!.rect.width).toBe(44 * 14);
  });

  it('caret x at end-of-line == the LineBox engine-measured width (uppercase is wider)', async () => {
    const { editor } = renderTensor(`<p>${'a'.repeat(60)}</p>`);
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('shout');
    });
    const adapted = pmDocToSemantic(editor.state.doc, { fontFamily: 'system-ui', fontSize: 16 }, snapshotOf([SHOUT]));
    const result = createLayoutEngine({ metrics: WiderCapsMetrics }).layout(adapted.doc, LETTER);
    const line1 = result.lines[0]!;
    const line2 = result.lines[1]!;

    // The caret measures the TRANSFORMED prefix through the same
    // metrics the engine measured with: at the end of the text
    // (offset 60) it sits exactly at line 2's engine-measured width
    // (16 chars × 14px = 224 — the source-width answer would be 160).
    const block = adapted.blocks[0]!;
    const caret = caretGeometry(adapted.blocks, result, block.from + 1 + 60, WiderCapsMetrics);
    expect(caret).not.toBeNull();
    expect(caret!.x).toBe(line2.rect.width); // 224, not 160
    expect(caret!.x).toBe(16 * 14);
    // And the wrap boundary is a boundary: caret at offset 44 (end of
    // line 1) shows at line 2's START — x 0.
    const boundary = caretGeometry(adapted.blocks, result, block.from + 1 + 44, WiderCapsMetrics);
    expect(boundary!.x).toBe(0);
    void line1;
  });

  it('hitTest resolves clicks against the TRANSFORMED text, offsets identity-mapped to PM', async () => {
    const { editor } = renderTensor(`<p>${'a'.repeat(60)}</p>`);
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('shout');
    });
    const adapted = pmDocToSemantic(editor.state.doc, { fontFamily: 'system-ui', fontSize: 16 }, snapshotOf([SHOUT]));
    const result = createLayoutEngine({ metrics: WiderCapsMetrics }).layout(adapted.doc, LETTER);

    // Stack-local coords: content box at (96, 96). Click at content
    // x = 616 (the transformed width of 44 chars): the caret lands at
    // source offset 44 — same length, identity mapping.
    const hit = hitTest(result, adapted.blocks, WiderCapsMetrics, 0, 96 + 616, 96 + 8);
    expect(hit).not.toBeNull();
    const block = adapted.blocks.find((b) => b.id === hit!.blockId)!;
    expect(blockOffsetToPmPos(block, hit!.offset)).toBe(block.from + 1 + 44);
    // And a click mid-line measures transformed widths too: x = 287 →
    // char 21 (the char-20/21 midpoint lands exactly there; the
    // source-width answer would be char 28).
    const hit2 = hitTest(result, adapted.blocks, WiderCapsMetrics, 0, 96 + 287, 96 + 8);
    expect(hit2!.offset).toBe(21);
  });

  it("find matches SOURCE text through a transformed paragraph ('hello' finds 'HELLO')", async () => {
    const { editor } = renderTensor('<p>say hello there</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('shout');
    });
    // The engine sees 'SAY HELLO THERE' (pinned above); the PM doc
    // keeps 'say hello there'.
    expect(editor.state.doc.textContent).toBe('say hello there');

    act(() => {
      editor.commands.setSearchQuery('hello', { caseSensitive: false, useRegex: false });
    });
    const state = searchPluginKey.getState(editor.state);
    expect(state?.matches.length).toBe(1);
    expect(state!.matches[0]!.from).toBe(5); // source coordinates
    expect(state!.matches[0]!.match.toLowerCase()).toBe('hello');
  });
});
