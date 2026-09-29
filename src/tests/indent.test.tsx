import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { createLayoutEngine } from '@tensor-editor/engine';
import { pmDocToSemantic, type AdapterBlock } from '@/lib/paginated/adapter';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { renderTensor } from './harness';
import { settleLayout } from './harness';
import { FakeMetrics } from './fakeMetrics';
import { caretGeometry, textRangeLineRects } from '@/lib/paginated/positionMap';
import { hitTest } from '@/lib/paginated/hitTest';
import { DEFAULT_MARGINS, PAGE_GAP, toLayoutOptions } from '@/lib/document/pageSetup';

// INDENT PARITY (M6.2). METRICS: FakeMetrics @16 → 10px/char, line 16px
// (a 12.8 / d 3.2). Letter content box 624×864 at (96, 96) → 62
// chars/line, 54 lines/page.

// baseStyle MUST match the view's (identity-cache generation — the
// projection.test lesson).
const BASE = { fontFamily: 'system-ui', fontSize: 16 };
const PAGE_SETUP = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };
const CB = { x: 96, y: 96, width: 624, height: 864 };

const step = 32;

function adapt(editor: Parameters<typeof pmDocToSemantic>[0]) {
  return pmDocToSemantic(editor, BASE);
}

/** Direct engine walk of an adapted doc. */
function layoutBlocks(blocks: ReturnType<typeof adapt>['doc']['blocks']) {
  const engine = createLayoutEngine({ metrics: FakeMetrics });
  return {
    engine,
    result: engine.layout({ baseStyle: BASE, blocks }, toLayoutOptions(PAGE_SETUP)),
  };
}

function pressTab(shift = false) {
  useDocumentStore.getState().editor!.view.dom.dispatchEvent(
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey: shift, bubbles: true })
  );
}

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({ pageSetup: PAGE_SETUP });
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

async function settle() {
  await settleLayout();
}

// ─── STEP 0d receipts, pinned: Tab TODAY vs the new wiring ───────────────

describe('Tab keymaps (receipts pinned)', () => {
  it('RECEIPT: inside a list, Tab/Shift+Tab are the LIST\'s (sink/lift) — never the paragraph indent', async () => {
    const { editor } = renderTensor('<ul><li>one</li><li>two</li></ul>');
    await settle();

    act(() => {
      editor.commands.setTextSelection(10); // inside 'two' text
      pressTab();
    });
    // Sunk: a second (nested) bulletList exists; the inner paragraph's
    // indentLeft ATTR is untouched — the item's indentLeft comes from
    // the depth gutter alone (2 × 32), never a stepped attr.
    expect(JSON.stringify(editor.getJSON()).split('"type":"bulletList"').length - 1).toBe(2);
    const afterSink = adapt(editor.state.doc);
    expect(afterSink.blocks[0].indentLeft).toBe(step); // 'one', depth 1
    expect(afterSink.blocks[1].indentLeft).toBe(2 * step); // 'two', depth 2 — gutter, not attr

    act(() => {
      pressTab(true);
    });
    expect(JSON.stringify(editor.getJSON()).split('"type":"bulletList"').length - 1).toBe(1); // lifted
  });

  it('RECEIPT: Tab in the FIRST list item does nothing (the sink cannot run; ours declines)', async () => {
    const { editor } = renderTensor('<ul><li>one</li><li>two</li></ul>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(3); // inside 'one'
      pressTab();
    });
    expect(JSON.stringify(editor.getJSON()).split('"type":"bulletList"').length - 1).toBe(1); // flat
    expect(adapt(editor.state.doc).blocks[0].indentLeft).toBe(step); // depth 1 gutter only
  });

  it('P1: Tab at BLOCK START steps firstLineIndent +32; Shift+Tab steps back, floored at 0', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settle();

    act(() => {
      editor.commands.setTextSelection(1); // pos 0 of the block
      pressTab();
    });
    expect(editor.getAttributes('paragraph').firstLineIndent).toBe(step);

    act(() => {
      pressTab();
    });
    expect(editor.getAttributes('paragraph').firstLineIndent).toBe(2 * step);

    act(() => {
      pressTab(true);
    });
    expect(editor.getAttributes('paragraph').firstLineIndent).toBe(step);

    // Floor: Shift+Tab at 0 keeps 0 (below that, nothing to un-indent).
    act(() => {
      pressTab(true);
      pressTab(true);
    });
    expect(editor.getAttributes('paragraph').firstLineIndent).toBe(0);
    // The paragraph indentLeft was never touched by Tab (that is
    // ctrl+]/ctrl+[ territory).
    expect(editor.getAttributes('paragraph').indentLeft).toBe(0);
  });

  it('P1: mid-line Tab in prose is a NO-OP (indent and fli unchanged)', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(3); // mid-line
      pressTab();
      pressTab(true);
    });
    expect(editor.getAttributes('paragraph').indentLeft).toBe(0);
    expect(editor.getAttributes('paragraph').firstLineIndent).toBeNull();
    expect(editor.state.doc.textContent).toBe('hello world');
  });

  it('P1: Backspace-at-start ordering — firstLineIndent steps out first, then indentLeft', async () => {
    const { editor } = renderTensor('<p>words</p>');
    await settle();
    act(() => {
      editor.commands.updateAttributes('paragraph', {
        indentLeft: step,
        firstLineIndent: step,
      });
    });
    // First backspace: the FIRST-LINE indent goes (32 → 0), block intact.
    act(() => {
      editor.commands.setTextSelection(1);
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(editor.getAttributes('paragraph').firstLineIndent).toBe(0);
    expect(editor.getAttributes('paragraph').indentLeft).toBe(step);
    expect(editor.state.doc.childCount).toBe(1);
    // Second: the paragraph indentLeft steps (the M6.2 rule).
    act(() => {
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(editor.getAttributes('paragraph').indentLeft).toBe(0);
    expect(editor.state.doc.childCount).toBe(1);
  });

  it('ctrl+]/ctrl+[ (the indentLeft commands) cap at the 8-step bound; the legacy indent attr migrates on first press', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(2);
      for (let i = 0; i < 12; i++) editor.commands.increaseIndent();
    });
    expect(editor.getAttributes('paragraph').indentLeft).toBe(8 * step);

    // A legacy doc (indent: 2 steps from the old commands) migrates:
    // first press folds 64 + 32 into indentLeft and clears `indent`.
    const { editor: legacy } = renderTensor('<p>old</p>');
    await settle();
    act(() => {
      legacy.commands.setTextSelection(2);
      legacy.commands.updateAttributes('paragraph', { indent: 2 });
    });
    expect(adapt(legacy.state.doc).blocks[0].indentLeft).toBe(2 * step); // folded by the adapter
    act(() => {
      legacy.commands.increaseIndent();
    });
    expect(legacy.getAttributes('paragraph').indent).toBe(0); // migrated
    expect(legacy.getAttributes('paragraph').indentLeft).toBe(3 * step); // 64 folded + 32
  });

  it('RECEIPT: Tab in a codeBlock inserts a LITERAL tab character', async () => {
    const { editor } = renderTensor('<pre><code>ab</code></pre>');
    await settle();
    act(() => {
      // <pre> unwraps: codeBlock@0, text 'ab' at [1,3). Pos 2 = between.
      editor.commands.setTextSelection(2);
      pressTab();
    });
    expect(editor.state.doc.textContent).toBe('a\tb');
  });

  it('Tab in a heading does nothing (headings carry no indent attrs — receipt)', async () => {
    const { editor } = renderTensor('<h1>title</h1>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(2);
      pressTab();
    });
    expect(editor.state.doc.textContent).toBe('title');
    expect(editor.getAttributes('heading').indentLeft).toBeUndefined();
  });
});

// ─── Backspace step (Word/GDocs) ──────────────────────────────────────────
describe('Backspace at an indented paragraph start', () => {
  // Harness notes (receipts): raw Backspace keydowns reach the tiptap
  // shortcut registry — our step — and, at a BLOCK START, PM's native
  // join-at-start (prosemirror-view's keydown fallback). MID-TEXT char
  // deletion rides the browser's beforeinput pipeline and cannot be
  // driven in jsdom — pinned here by the DECLINE (the step not firing),
  // which is the part that is ours.

  it('steps the indent out INSTEAD of joining; at 0 the normal join runs', async () => {
    const { editor } = renderTensor('<p>first</p><p>second</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(9); // inside 'second' text
      editor.commands.updateAttributes('paragraph', { indentLeft: step });
    });

    // Position 0 of the SECOND block ('second' text starts at 8), empty
    // selection → the step fires: 32 → 0, block NOT joined.
    act(() => {
      editor.commands.setTextSelection(8);
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(editor.getAttributes('paragraph').indentLeft).toBe(0);
    expect(editor.state.doc.childCount).toBe(2);
    expect(editor.state.doc.textContent).toBe('firstsecond');

    // Again at 0: our step declines (indent 0) — the normal backspace
    // join runs (PM's keydown fallback, empirically alive in jsdom).
    act(() => {
      editor.commands.setTextSelection(8);
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe('firstsecond');
  });

  it('mid-block: the step never fires (normal backspace — the browser\'s path)', async () => {
    const { editor } = renderTensor('<p>indented</p>');
    await settle();
    act(() => {
      editor.commands.setTextSelection(2); // inside the text
      editor.commands.updateAttributes('paragraph', { indentLeft: step });
      editor.commands.setTextSelection(3); // mid-text
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    // Our step declined (offset ≠ 0): the indent survived, the block
    // was not joined, and the char delete is the browser's own pipeline.
    expect(editor.getAttributes('paragraph').indentLeft).toBe(step);
    expect(editor.state.doc.childCount).toBe(1);
    expect(editor.state.doc.textContent).toBe('indented');
  });
});

// ─── STEP 1: adapter mapping + validation ──────────────────────────────────

describe('adapter: indent family mapping', () => {
  it('indentLeft/indentRight/firstLineIndent pass through px 1:1 (consumed, not dropped)', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();
    act(() => {
      editor.commands.updateAttributes('paragraph', {
        indentLeft: 64,
        indentRight: 48,
        firstLineIndent: 32,
      });
    });
    const { doc } = adapt(editor.state.doc);
    expect(doc.blocks[0]).toMatchObject({ indentLeft: 64, indentRight: 48, firstLineIndent: 32 });
  });

  it('dropped-attr list BEFORE/AFTER: the indent family is gone from the warning', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { editor } = renderTensor('<p>hello</p>');
    await settle();
    act(() => {
      editor.commands.updateAttributes('paragraph', {
        indent: 1,
        indentLeft: 32,
        indentRight: 32,
      });
    });
    adapt(editor.state.doc);
    const calls = warn.mock.calls.map((c) => String(c[0]));
    // BEFORE (M5.13): 'indent,indentLeft,indentRight' appeared in the
    // dropped signature. AFTER (M6.2): none of the three.
    expect(calls.some((c) => c.includes('dropped') && /indent/.test(c))).toBe(false);
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('dropped by the semantic doc: indent'));
    warn.mockRestore();
  });

  it('VALIDATION: negative indents clamp to 0 with a dev warning; a too-deep hanging clamps to the first-line floor', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { editor } = renderTensor('<p>hello</p>');
    await settle();

    // Negative left/right: nearest legal = 0.
    act(() => {
      editor.commands.updateAttributes('paragraph', { indentLeft: -50, indentRight: -8 });
    });
    let { doc } = adapt(editor.state.doc);
    expect(doc.blocks[0]).not.toHaveProperty('indentLeft');
    expect(doc.blocks[0]).not.toHaveProperty('indentRight');
    expect(warn.mock.calls.some((c) => String(c[0]).includes('indentLeft -50 < 0 → 0'))).toBe(true);

    // firstLineIndent −64 under indentLeft 32: the first line's left
    // edge would be −32 — clamped to −32... floor is −indentLeft = −32.
    warn.mockClear();
    act(() => {
      editor.commands.updateAttributes('paragraph', { indentLeft: 32, indentRight: 0, firstLineIndent: -64 });
    });
    ({ doc } = adapt(editor.state.doc));
    expect(doc.blocks[0].firstLineIndent).toBe(-32);
    expect(warn.mock.calls.some((c) => String(c[0]).includes('firstLineIndent -64'))).toBe(true);

    // NEVER crashes: the clamped doc lays out.
    const { result } = layoutBlocks(doc.blocks);
    expect(result.lines.length).toBeGreaterThan(0);
  });

  it('identity: an indent-attr change produces a NEW block object', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settle();
    const before = adapt(editor.state.doc);
    act(() => {
      editor.commands.updateAttributes('paragraph', { indentLeft: step });
    });
    const after = adapt(editor.state.doc);
    expect(after.doc.blocks[0]).not.toBe(before.doc.blocks[0]);
    expect(after.blocks[0].runs).toEqual(before.blocks[0].runs);
  });

  it('list items: the paragraph\'s OWN indent adds on top of the depth gutter', async () => {
    const { editor } = renderTensor('<ul><li>one</li><li>two</li></ul>');
    await settle();
    act(() => {
      // 'two' text at [9,12): pos 10 = inside (updateAttributes'
      // nodesBetween needs the selection strictly inside the text).
      editor.commands.setTextSelection(10);
      editor.commands.updateAttributes('paragraph', { indentLeft: step });
    });
    const { doc } = adapt(editor.state.doc);
    // Item 1: depth gutter 32. Item 2: depth 32 + own 32 = 64.
    expect(doc.blocks[0].indentLeft).toBe(step);
    expect(doc.blocks[1].indentLeft).toBe(2 * step);
  });
});

// ─── STEP 4: input geometry ───────────────────────────────────────────────

describe('indent input geometry (paginated)', () => {
  function block(id: string, text: string, extra: Record<string, number> = {}): AdapterBlock {
    const style = { ...BASE };
    return {
      id,
      runs: [{ text, style }],
      text,
      from: 0,
      to: text.length + 2,
      align: 'left',
      runDecor: [],
      ...(extra.indentLeft ? { indentLeft: extra.indentLeft } : {}),
    };
  }

  it('first-line indent: line 0 sits at indentLeft + fli; wrapped lines at indentLeft', () => {
    const { result } = layoutBlocks([
      {
        id: 'a',
        kind: 'paragraph',
        runs: [{ text: 'a'.repeat(124), style: BASE }],
        indentLeft: step,
        firstLineIndent: step,
      },
    ]);
    const lines = result.lines.filter((l) => l.blockId === 'a');
    expect(lines[0].rect.x).toBe(2 * step); // 64
    expect(lines.slice(1).every((l) => l.rect.x === step)).toBe(true);
  });

  it('hanging: line 0 at indentLeft + (−fli-back) — i.e. 0 under left 32/fli −32; wrapped deeper', () => {
    const { result } = layoutBlocks([
      {
        id: 'h',
        kind: 'paragraph',
        runs: [{ text: 'a'.repeat(124), style: BASE }],
        indentLeft: step,
        firstLineIndent: -step,
      },
    ]);
    const lines = result.lines.filter((l) => l.blockId === 'h');
    expect(lines[0].rect.x).toBe(0); // 32 − 32
    expect(lines.slice(1).every((l) => l.rect.x === step)).toBe(true);
  });

  it('indentRight narrows the wrap: fewer chars per line, x unchanged', () => {
    const plain = layoutBlocks([
      { id: 'p', kind: 'paragraph', runs: [{ text: 'a'.repeat(124), style: BASE }] },
    ]).result;
    const right = layoutBlocks([
      { id: 'p', kind: 'paragraph', runs: [{ text: 'a'.repeat(124), style: BASE }], indentRight: 96 },
    ]).result;
    // 624 → 528px wrap: 52/line → 3 lines (124 chars) vs 2.
    expect(plain.lines).toHaveLength(2);
    expect(right.lines).toHaveLength(3);
    expect(right.lines.every((l) => l.rect.x === 0)).toBe(true);
  });

  it('caret x on an indented first line = indentLeft + fli; selection rect left likewise', () => {
    const b = block('a', 'hello');
    const { result } = layoutBlocks([
      { id: 'a', kind: 'paragraph', runs: [{ text: 'hello', style: BASE }], indentLeft: step, firstLineIndent: step },
    ]);
    const caret = caretGeometry([b], result, 1, FakeMetrics);
    expect(caret!.x).toBe(2 * step);
    expect(caret!.y).toBe(0);

    const rects = textRangeLineRects([b], result, 1, 1 + 5, FakeMetrics, PAGE_GAP);
    expect(rects[0].left).toBe(CB.x + 2 * step);
  });

  it('hitTest: LEFT gutter → line start; RIGHT gutter → the line\'s END (trailing rule)', () => {
    const b = block('a', 'a'.repeat(30));
    const { result } = layoutBlocks([
      { id: 'a', kind: 'paragraph', runs: [{ text: 'a'.repeat(30), style: BASE }], indentLeft: step, indentRight: 96 },
    ]);
    const line = result.lines[0];
    expect(line.rect.x).toBe(step);

    // Left gutter click (x=4, left of rect.x 32): line start.
    expect(hitTest(result, [b], FakeMetrics, PAGE_GAP, CB.x + 4, CB.y + 4)).toEqual({
      blockId: 'a',
      offset: 0,
    });
    // Between text end (32+300=332) and the narrowed right edge: the
    // line's END position (offset 30 = rangeEnd), like the trailing rule.
    expect(hitTest(result, [b], FakeMetrics, PAGE_GAP, CB.x + 500, CB.y + 4)).toEqual({
      blockId: 'a',
      offset: 30,
    });
  });

  it('fragment continuation keeps the BASE indent (fli never reapplies across pages)', () => {
    // 100 lines → 2 pages. Line 0 (block start): left 32 + fli −32 = 0.
    // Continuation page's first line: BASE edge 32 (engine ruling).
    const { result } = layoutBlocks([
      {
        id: 'h',
        kind: 'paragraph',
        runs: [{ text: 'a'.repeat(62 * 100), style: BASE }],
        indentLeft: step,
        firstLineIndent: -step,
      },
    ]);
    const lines = result.lines.filter((l) => l.blockId === 'h');
    expect(result.pages.length).toBeGreaterThan(1);
    expect(lines[0].pageIndex).toBe(0);
    expect(lines[0].rect.x).toBe(0);
    const continuation = lines.find((l) => l.pageIndex === 1)!;
    expect(continuation.rect.x).toBe(step); // base edge, not 0
  });
});

// ─── Ribbon: First Line / Hanging presets ────────────────────────────────

describe('Layout ribbon: first-line / hanging buttons', () => {
  it('First Line toggles +32 / clear; Hanging sets the reference-list style and clears', async () => {
    const { render, fireEvent } = await import('@testing-library/react');
    const { ParagraphSpacingGroup } = await import(
      '@/components/layout/ribbon/layout/groups/SpacingGroup'
    );
    const utils = renderTensor('<p>hello world</p>');
    await settle();
    render(<ParagraphSpacingGroup editor={utils.editor} />);

    const first = () => document.querySelector('button[aria-label="First Line Indent"]')!;
    const hanging = () => document.querySelector('button[aria-label="Hanging Indent"]')!;

    // First Line: fli +32, left untouched.
    act(() => {
      fireEvent.click(first());
    });
    expect(utils.editor.getAttributes('paragraph').firstLineIndent).toBe(step);
    expect(utils.editor.getAttributes('paragraph').indentLeft).toBe(0);

    // Toggle off: clear.
    act(() => {
      fireEvent.click(first());
    });
    expect(utils.editor.getAttributes('paragraph').firstLineIndent).toBeNull();

    // Hanging on an unindented paragraph: left → 32, fli → −32 (the
    // first line floors at 0, wrapped lines at 32).
    act(() => {
      fireEvent.click(hanging());
    });
    expect(utils.editor.getAttributes('paragraph').indentLeft).toBe(step);
    expect(utils.editor.getAttributes('paragraph').firstLineIndent).toBe(-step);

    // Toggle off: fli cleared, the raised left stays (predictable).
    act(() => {
      fireEvent.click(hanging());
    });
    expect(utils.editor.getAttributes('paragraph').firstLineIndent).toBeNull();
    expect(utils.editor.getAttributes('paragraph').indentLeft).toBe(step);
    utils.unmount();
  });
});

// ─── STEP 5: the essay — every indent style, both modes, round-trip ───────

describe('essay acceptance (M6.2)', () => {
  it('all styles render in BOTH modes; attrs survive the .wpdoc round-trip; Tab/Backspace work through them', async () => {
    const long = 'p'.repeat(62 * 60); // 60-line paragraph — crosses pages
    const essay = [
      '<h2>Indentation Essay</h2>',
      `<p>${long}</p>`, // plain, crosses the page boundary
      '<p>left indented by one gutter</p>',
      '<p>first line out</p>',
      '<p>reference list entry</p>',
      '<p>right indented block</p>',
    ].join('');

    const { editor } = renderTensor(essay);
    await settle();

    // blocks: [0]=heading, [1]=long, [2]=left, [3]=fli, [4]=hang,
    // [5]=right (+ PM's trailing paragraph after the list-free doc? —
    // no list at doc end, none appended; text ends with a paragraph).
    const paras = adapt(editor.state.doc).blocks;
    const [left, fli, hang, right] = [paras[2], paras[3], paras[4], paras[5]].map(
      (b: AdapterBlock) => b
    );
    act(() => {
      // from+2 = strictly inside the text (nodesBetween boundary).
      editor.commands.setTextSelection(fli!.from + 2);
      editor.commands.updateAttributes('paragraph', { firstLineIndent: step });
      editor.commands.setTextSelection(hang!.from + 2);
      editor.commands.updateAttributes('paragraph', {
        indentLeft: step,
        firstLineIndent: -step,
      });
      editor.commands.setTextSelection(left!.from + 2);
      editor.commands.updateAttributes('paragraph', { indentLeft: step });
      editor.commands.setTextSelection(right!.from + 2);
      editor.commands.updateAttributes('paragraph', { indentRight: 96 });
    });

    // Tab at the indented starts (P1: firstLineIndent, the GDocs
    // convention) and the ctrl+] command (indentLeft) both work
    // through the essay.
    act(() => {
      editor.commands.setTextSelection(left!.from + 1); // block start
      pressTab();
      editor.commands.setTextSelection(right!.from + 2);
      editor.commands.increaseIndent();
    });
    expect(editor.state.doc.nodeAt(left!.from)!.attrs.firstLineIndent).toBe(step);
    // right had indentRight 96 only — one indentLeft step lands 32.
    expect(editor.state.doc.nodeAt(right!.from)!.attrs.indentLeft).toBe(step);

    // Backspace-at-start ordering (P1): firstLineIndent steps out
    // first, then the paragraph indentLeft — never joins.
    act(() => {
      editor.commands.setTextSelection(left!.from + 1);
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(editor.state.doc.nodeAt(left!.from)!.attrs.firstLineIndent).toBe(0);
    expect(editor.state.doc.nodeAt(left!.from)!.attrs.indentLeft).toBe(step);
    act(() => {
      useDocumentStore.getState().editor!.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(editor.state.doc.nodeAt(left!.from)!.attrs.indentLeft).toBe(0);
    expect(editor.state.doc.textContent).toContain('left indented by one gutter');

    // PAGINATED: renders, crosses pages, every indent visible on both
    // sides of every fragment.
    await settle();
    expect(document.querySelector('[data-testid="paginated-fallback"]')).toBeNull();
    expect(document.querySelectorAll('[data-page-index]').length).toBeGreaterThan(1);
    const adapted = adapt(editor.state.doc);
    const { result } = layoutBlocks(adapted.doc.blocks);
    for (const line of result.lines) {
      const b = adapted.blocks.find((x) => x.id === line.blockId)!;
      if (b.id === hang!.id && line.lineIndex === 0) {
        expect(line.rect.x).toBe(0); // hanging first line: 32 + (−32)
      } else if (b.id === fli!.id && line.lineIndex === 0) {
        expect(line.rect.x).toBe(step); // first line out: 0 left + fli 32
      } else if (b.indentLeft) {
        expect(line.rect.x).toBe(b.indentLeft);
      }
    }

    // .wpdoc ROUND-TRIP: getJSON carries the attrs; setContent(json)
    // restores them exactly (the save/load mechanism).
    const json = editor.getJSON();
    act(() => {
      editor.commands.setContent(json);
    });
    await settle();
    const reopened = adapt(editor.state.doc);
    expect(reopened.blocks.map((b) => [b.indentLeft, b.indentRight, (b as never as { firstLineIndent?: number }).firstLineIndent]))
      .toEqual(adapted.blocks.map((b) => [b.indentLeft, b.indentRight, (b as never as { firstLineIndent?: number }).firstLineIndent]));

    // PAGELESS: same attrs, pageless renders them via inline styles
    // (renderHTML → padding-left / text-indent — the parity receipt).
    act(() => {
      useConfigStore.setState((state) => ({
        config: {
          ...state.config,
          editor: { ...state.config.editor, defaultPageLayout: 'Pageless' },
        },
      }));
    });
    await settle();
    const prose = document.querySelector('.ProseMirror')!;
    expect(prose).not.toBeNull();
    const ps = [...prose.querySelectorAll('p')] as HTMLElement[];
    const hangP = ps.find((p) => p.textContent === 'reference list entry')!;
    expect(hangP.style.paddingLeft).toBe(`${step}px`);
    expect(hangP.style.textIndent).toBe(`${-step}px`);
    const fliP = ps.find((p) => p.textContent === 'first line out')!;
    expect(fliP.style.textIndent).toBe(`${step}px`);
    const rightP = ps.find((p) => p.textContent === 'right indented block')!;
    expect(rightP.style.paddingRight).toBe('96px');
  });
});
