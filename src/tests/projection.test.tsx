import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { createLayoutEngine } from '@tensor-editor/engine';
import { pmDocToSemantic, type AdapterBlock } from '@/lib/paginated/adapter';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensor } from './harness';
import { settleLayout } from './harness';
import { FakeMetrics } from './fakeMetrics';
import { caretGeometry } from '@/lib/paginated/positionMap';
import { hitTest } from '@/lib/paginated/hitTest';
import { textRangeLineRects } from '@/lib/paginated/positionMap';
import { DEFAULT_MARGINS, PAGE_GAP, toLayoutOptions } from '@/lib/document/pageSetup';

// NOTE: baseStyle MUST match the PaginatedView's (the config default) —
// the identity-cache generation is keyed on it, and the view's
// relayouts interleave with these adapt() calls. A different family
// here would bump the generation on every relayout and miss the cache.
const BASE = { fontFamily: 'system-ui', fontSize: 16 };
const PAGE_SETUP = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };
const CB = { x: 96, y: 96, width: 624, height: 864 };

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({ pageSetup: PAGE_SETUP });
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function settle() {
  await settleLayout();
}

function adapt(editor: Parameters<typeof pmDocToSemantic>[0]) {
  return pmDocToSemantic(editor, BASE);
}

/** Direct engine walk of an adapted doc (FakeMetrics). */
function layoutBlocks(blocks: ReturnType<typeof adapt>['doc']['blocks']) {
  const engine = createLayoutEngine({ metrics: FakeMetrics });
  return { engine, result: engine.layout({ baseStyle: BASE, blocks }, toLayoutOptions(PAGE_SETUP)) };
}

// ─── PART 1: the projection itself ───────────────────────────────────────

describe('projection: lists', () => {
  it('bullet list: one paragraph block per item, indentLeft 32, disc markers 1..n', async () => {
    const { editor } = renderTensor('<ul><li>one</li><li>two</li></ul>');
    await settle();
    const { doc, blocks } = adapt(editor.state.doc);

    // PM's parser appends a trailing empty paragraph after a doc that
    // ends in a list (a cursor must be addressable after it) — standard
    // PM behavior, projected as a plain empty block.
    const items = blocks.filter((b) => b.paint?.marker);
    expect(items.map((b) => b.text)).toEqual(['one', 'two']);
    expect(blocks[blocks.length - 1].text).toBe('');
    for (const [i, b] of items.entries()) {
      expect(b.indentLeft).toBe(32);
      expect(b.paint?.marker).toEqual({
        kind: 'bullet',
        depth: 1,
        index: i + 1,
        styleType: 'disc',
      });
      expect(typeof b.id).toBe('string');
    }
    // Positions ascending (binary-search contract) and PM-true: the
    // first item's paragraph sits at doc position 2 (doc 0, list 0,
    // listItem 1, paragraph 2 — its text starts at 3 = from + 1).
    expect(items[0].from).toBe(2);
    expect(blocks.every((b, i) => i === 0 || blocks[i - 1].from < b.from)).toBe(true);
    // The hints ride the SEMANTIC blocks too, and the engine ignores
    // them: hash-relevant content is just runs.
    expect(doc.blocks[0]).toMatchObject({ indentLeft: 32, listMarker: items[0].paint?.marker });
  });

  it('nested list: depth 2 items indent 64 with their own list’s style', async () => {
    const { editor } = renderTensor(
      '<ul><li>outer<ul style="list-style-type: circle"><li>inner</li></ul></li></ul>'
    );
    await settle();
    const { blocks } = adapt(editor.state.doc);
    const items = blocks.filter((b) => b.paint?.marker);
    expect(items).toHaveLength(2);
    expect(items[0].paint?.marker).toMatchObject({ depth: 1, index: 1 });
    expect(items[1].indentLeft).toBe(64);
    expect(items[1].paint?.marker).toMatchObject({
      kind: 'bullet',
      depth: 2,
      index: 1,
      styleType: 'circle',
    });
  });

  it('ordered list carries the node’s listStyleType and per-list indexes', async () => {
    const { editor } = renderTensor(
      '<ol style="list-style-type: lower-roman"><li>one</li><li>two</li><li>three</li></ol>'
    );
    await settle();
    const { blocks } = adapt(editor.state.doc);
    const items = blocks.filter((b) => b.paint?.marker);
    expect(items.map((b) => b.paint?.marker?.index)).toEqual([1, 2, 3]);
    expect(items.every((b) => b.paint?.marker?.styleType === 'lower-roman')).toBe(true);
    expect(items.every((b) => b.indentLeft === 32)).toBe(true);
  });
});

describe('projection: blockquote, codeBlock, horizontalRule', () => {
  it('blockquote → paragraph block, indentLeft 32, blockquote paint hint', async () => {
    const { editor } = renderTensor('<blockquote><p>quoted words</p></blockquote>');
    await settle();
    const { doc, blocks } = adapt(editor.state.doc);
    expect(doc.blocks[0].kind).toBe('paragraph');
    expect(blocks[0].indentLeft).toBe(32);
    expect(blocks[0].paint?.blockquote).toBe(true);
  });

  it('codeBlock → engine codeBlock kind, per-source-line runs, monospace @ doc default', async () => {
    const { editor } = renderTensor(
      '<pre><code>alpha\nbeta\n\ndelta\nepsilon\nzeta</code></pre>'
    );
    await settle();
    const { doc, blocks } = adapt(editor.state.doc);

    expect(doc.blocks[0].kind).toBe('codeBlock');
    // Pageless look receipt: UA monospace + inherited 16px default.
    const codeRuns = (doc.blocks[0] as { runs: { style: { fontFamily: string; fontSize: number } }[] }).runs;
    expect(codeRuns.every((r) => r.style.fontFamily === 'monospace')).toBe(true);
    expect(codeRuns.every((r) => r.style.fontSize === 16)).toBe(true);
    // One run per source line ('\n' kept at each line's end; blank line
    // = a '\n' run) — the engine's source-line breaker consumes them.
    expect(((doc.blocks[0] as { runs: { text: string }[] }).runs).map((r) => r.text)).toEqual([
      'alpha\n',
      'beta\n',
      '\n',
      'delta\n',
      'epsilon\n',
      'zeta',
    ]);
    expect(blocks[0].text).toBe('alpha\nbeta\n\ndelta\nepsilon\nzeta');
    // Paint hint: code background.
    expect(blocks[0].paint?.code).toBe(true);
  });

  it('codeBlock geometry: source lines honored, blank line full-height', () => {
    // Semantic doc built directly (the adapter's run mapping is pinned
    // above); this pins the ENGINE's source-line semantics end-to-end.
    const { result } = layoutBlocks([
      { id: 'c', kind: 'codeBlock', runs: [{ text: 'a\n\nb', style: { fontFamily: 'monospace', fontSize: 16 } }] },
    ]);
    const lines = result.lines.filter((l) => l.blockId === 'c');
    expect(lines).toHaveLength(3); // 'a', blank, 'b'
    expect(lines[1].rect.width).toBe(0); // blank line
    // Shell FakeMetrics: content 16px — the blank line is exactly as
    // tall as its siblings (measured under the first run's style).
    expect(lines[1].rect.y).toBe(16);
    expect(lines[2].rect.y).toBe(32);
  });

  it('horizontalRule → single-line paragraph with rule hint; never fragments', async () => {
    const { editor } = renderTensor('<p>before</p><hr><p>after</p>');
    await settle();
    const { doc, blocks, result } = (() => {
      const a = adapt(editor.state.doc);
      return { ...a, result: layoutBlocks(a.doc.blocks).result };
    })();

    const hrBlock = blocks.find((b) => b.paint?.rule === true)!;
    expect(hrBlock).toBeDefined();
    expect(hrBlock.runs).toEqual([]);
    expect(doc.blocks[1].kind).toBe('paragraph');
    // Exactly one LineBox — an unbreakable atom by construction.
    const hrLines = result.lines.filter((l) => l.blockId === hrBlock.id);
    expect(hrLines).toHaveLength(1);
    expect(result.breaks.some((brk) => brk.blockId === hrBlock.id)).toBe(false);
  });
});

// ─── The identity-cache contract, both directions ────────────────────────

describe('projection identity (list items)', () => {
  function itemBlocks(blocks: AdapterBlock[]) {
    return blocks.filter((b) => b.paint?.marker);
  }

  it('an edit INSIDE item 2 leaves items 1 and 3 reference-identical', async () => {
    const { editor } = renderTensor(
      '<ol><li>one</li><li>two</li><li>three</li></ol>'
    );
    await settle();
    const before = adapt(editor.state.doc);
    const beforeItems = itemBlocks(before.blocks);

    // Type inside item 2: its paragraph sits at PM position 9 (text
    // 'two' at 10..13) — the cursor between 't' and 'w' is position 11.
    act(() => {
      editor.commands.setTextSelection(beforeItems[1].from + 2);
      editor.commands.insertContent('X');
    });
    const after = adapt(editor.state.doc);
    const afterItems = itemBlocks(after.blocks);

    expect(afterItems[1].text).toBe('tXwo');
    // Untouched items keep their semantic Block AND AdapterBlock identity.
    expect(after.doc.blocks[0]).toBe(before.doc.blocks[0]);
    expect(after.doc.blocks[2]).toBe(before.doc.blocks[2]);
    expect(afterItems[0].runs).toBe(beforeItems[0].runs);
    expect(afterItems[2].runs).toBe(beforeItems[2].runs);
  });

  it('sibling deletion reindexes the remainder: NEW objects, UNCHANGED runs', async () => {
    const { editor } = renderTensor(
      '<ol><li>one</li><li>two</li><li>three</li></ol>'
    );
    await settle();
    const before = adapt(editor.state.doc);
    const beforeItems = itemBlocks(before.blocks);

    // Delete item 1's LISTITEM node: [1, 8) — the paragraph sits at 2,
    // the next listItem starts at 8 (= item 2's paragraph pos − 1).
    act(() => {
      editor.commands.deleteRange({ from: beforeItems[0].from - 1, to: beforeItems[1].from - 1 });
    });
    const after = adapt(editor.state.doc);
    const afterItems = itemBlocks(after.blocks);

    expect(afterItems.map((b) => b.text)).toEqual(['two', 'three']);
    // REMAINDER REINDEXED: old item 2 is now index 1 — a NEW Block
    // object (paint facts changed)...
    expect(afterItems[0]).not.toBe(beforeItems[1]);
    expect(afterItems[0].paint?.marker?.index).toBe(1);
    // ...but its hash-relevant content is unchanged (the engine's
    // splice keeps the cached placement — markers are ink, not flow).
    expect(afterItems[0].runs).toEqual(beforeItems[1].runs);
    // And the edit-SURVIVAL invariant still holds for untouched items:
    // item 'three' moved up a slot but its node object is unchanged —
    // its marker index changed (2→... wait: after deleting item 1,
    // 'two' is index 1 and 'three' index 2 (was 3): ALSO reindexed.
    expect(afterItems[1].paint?.marker?.index).toBe(2);
  });
});

// ─── PART 2: input correctness on indented blocks ─────────────────────────

describe('indented-block input', () => {
  async function listDoc() {
    const { editor } = renderTensor(
      `<ul><li>${'a'.repeat(124)}</li><li>second</li></ul>`
    );
    await settle();
    return { editor, adapted: adapt(editor.state.doc) };
  }

  it('caret x accounts for indentLeft; selection rects start at the indent', async () => {
    const { adapted } = await listDoc();
    const block = adapted.blocks[0]; // 2-line item, indent 32
    const { result } = layoutBlocks(adapted.doc.blocks);

    const caret = caretGeometry(adapted.blocks, result, block.from + 1, FakeMetrics);
    expect(caret!.x).toBe(32); // content-box x = indentLeft

    // Selection over the first line: rect.left starts at the indent.
    const rects = textRangeLineRects(
      adapted.blocks,
      result,
      block.from + 1,
      block.from + 1 + 10,
      FakeMetrics,
      PAGE_GAP
    );
    expect(rects[0].left).toBe(CB.x + 32);
  });

  it('hitTest: a click in the marker gutter resolves to the item’s first position', async () => {
    const { adapted } = await listDoc();
    const { result } = layoutBlocks(adapted.doc.blocks);
    // Gutter click: x = 5 (inside [0, 32)), y on the item's first line.
    const hit = hitTest(result, adapted.blocks, FakeMetrics, PAGE_GAP, CB.x + 5, CB.y + 4);
    expect(hit).toEqual({ blockId: adapted.blocks[0].id, offset: 0 });
  });

  it('indents survive on BOTH sides of a page-fragmenting list item', async () => {
    // A deeply nested, long item that must cross the page boundary.
    const { editor } = renderTensor(
      `<ul><li>${'a'.repeat(62 * 60)}</li></ul>`
    );
    await settle();
    const adapted = adapt(editor.state.doc);
    const { result } = layoutBlocks(adapted.doc.blocks);
    const lines = result.lines.filter((l) => l.blockId === adapted.blocks[0].id);
    expect(result.pages.length).toBeGreaterThan(1);
    expect(lines.length).toBeGreaterThan(54);
    // EVERY line on EVERY page carries the indent.
    for (const line of lines) expect(line.rect.x).toBe(32);
  });
});

// ─── PART 3: the kitchen-sink acceptance document ────────────────────────

describe('kitchen-sink document (M6.1 acceptance)', () => {
  const longText = 'a'.repeat(62 * 30); // 30 lines
  const codeSix = 'one\ntwo\nthree\nfour\nfive\nsix';
  const codeLong = 'x'.repeat(62) + '\ny'.repeat(62) + '\nz'.repeat(62) + '\nw'.repeat(40);
  const kitchenSink = [
    '<h1>Kitchen Sink</h1>',
    `<p>${longText}</p>`,
    '<hr>',
    `<ul><li>${'b'.repeat(62 * 3)}</li><li>short<ul><li>nested one</li><li>nested two</li></ul></li></ul>`,
    `<ol style="list-style-type: upper-roman"><li>roman one</li><li>roman two</li></ol>`,
    '<blockquote><p>quoted line</p></blockquote>',
    `<pre><code>${codeSix}</code></pre>`,
    `<pre><code>${codeLong}</code></pre>`,
    '<hr>',
    `<p>${'c'.repeat(62 * 20)}</p>`,
  ].join('');

  it('renders PAGINATED (no fallback), every kind projected, fragments keep indent', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { editor } = renderTensor(kitchenSink);
    await settle();

    // PAGINATED, multi-page, no fallback, no adapter/engine errors.
    expect(document.querySelector('[data-testid="paginated-fallback"]')).toBeNull();
    const sheets = document.querySelectorAll('[data-page-index]');
    expect(sheets.length).toBeGreaterThanOrEqual(2);
    expect(
      consoleError.mock.calls.filter((c) => String(c[0]).includes('[PaginatedView]'))
    ).toEqual([]);

    const adapted = adapt(editor.state.doc);
    const kinds = adapted.doc.blocks.map((b) => b.kind);
    expect(kinds).toContain('heading');
    expect(kinds).toContain('codeBlock');
    expect(kinds.filter((k) => k === 'codeBlock')).toHaveLength(2);

    // Markers + hints present: bullets (depth 1 + 2), roman ordered,
    // blockquote, two rules, code paint.
    const paints = adapted.blocks.map((b) => b.paint);
    expect(paints.filter((p) => p?.marker?.kind === 'bullet').length).toBeGreaterThanOrEqual(4);
    expect(paints.some((p) => p?.marker?.styleType === 'upper-roman')).toBe(true);
    expect(paints.filter((p) => p?.blockquote).length).toBe(1);
    expect(paints.filter((p) => p?.rule).length).toBe(2);
    expect(paints.filter((p) => p?.code).length).toBe(2);

    const { result } = layoutBlocks(adapted.doc.blocks);

    // Indents on both sides of every fragmenting block.
    const fragmentIds = new Set(result.breaks.map((b) => b.blockId));
    expect(fragmentIds.size).toBeGreaterThan(0);
    for (const line of result.lines) {
      const block = adapted.blocks.find((b) => b.id === line.blockId)!;
      if (block.indentLeft) expect(line.rect.x).toBe(block.indentLeft);
    }

    // Code geometry matches the pageless look: monospace runs, source
    // lines honored (the 6-line block yields exactly 6 LineBoxes).
    const codeBlock = adapted.doc.blocks.find((b) => b.kind === 'codeBlock' && b.runs.length === 6)!;
    const codeLines = result.lines.filter((l) => l.blockId === (codeBlock as { id: string }).id);
    expect(codeLines).toHaveLength(6);

    // Dev-only contiguity: no seams anywhere.
    expect(
      consoleError.mock.calls.filter((c) => String(c[0]).includes('contiguity'))
    ).toEqual([]);
  });

  it('lastStats receipt: one in-item edit → the walk stays O(edit)', async () => {
    const { editor } = renderTensor(
      `<ol>${Array.from({ length: 10 }, (_, i) => `<li>item ${i + 1} text</li>`).join('')}</ol>` +
        `<p>${longText}</p>`
    );
    await settle();

    const engine = createLayoutEngine({ metrics: FakeMetrics });
    const opts = toLayoutOptions(PAGE_SETUP);
    const cold = adapt(editor.state.doc);
    engine.layout(cold.doc, opts); // COLD walk: every block walked.
    const coldWalked = engine.lastStats.blocksWalked;
    expect(coldWalked).toBe(cold.doc.blocks.length);

    // ONE edit inside item 7 (blocks[6]: 11 blocks total — 10 items,
    // the long paragraph, no trailing-empty because the doc ends in a
    // paragraph).
    act(() => {
      const p7 = cold.blocks[6];
      editor.commands.setTextSelection(p7.from + 1 + 5);
      editor.commands.insertContent('!');
    });
    const warm = adapt(editor.state.doc);
    expect(warm.doc.blocks).toHaveLength(11);
    engine.layout(warm.doc, opts); // WARM: prefix reused, suffix spliced.

    // RECEIPT (quote in the FINISH report): blocksWalked === 1 — only
    // the edited block re-walked; the 6-block prefix reused directly,
    // the 4-block suffix spliced (11 = 6 + 1 + 4).
    expect(engine.lastStats.blocksWalked).toBe(1);
    expect(engine.lastStats.blocksSpliced).toBe(4);
  });
});
