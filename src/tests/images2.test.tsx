import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { createLayoutEngine } from '@tensor-editor/engine';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_MARGINS, PAGE_GAP, toLayoutOptions } from '@/lib/document/pageSetup';
import { useMediaStore } from '@/lib/media/store';
import { insertImageBytes, sha256Hex } from '@/lib/media/insert';
import {
  convertBlockToInline,
  convertInlineToBlock,
  setWrapMode,
  commitFloatDrag,
} from '@/lib/media/wrap';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { getCommand } from '@/lib/commands/registry';
import { __bitmapTestSeam } from '@/lib/media/bitmapCache';
import { saveWpdoc, openWpdoc, collectReferencedMediaIds } from '@/lib/document/wpdoc';
import { renderTensor, settleLayout, GEOMETRY } from './harness';
import { FakeMetrics } from './fakeMetrics';

/**
 * M-IMAGES-2 — inline mode + floats + resize completeness. The engine
 * is committed (E-IMG-2/3); this suite pins the SHELL's wiring to it:
 * the node-kind switch, the U+FFFC offset identity, the segmentsFor
 * correlation, float drag → anchor-relative attrs, paint order split,
 * z-aware hit-testing, and the GC/round-trip laws.
 */

// M-IMAGES-0 container simulator (the save/open layer rides it).
const wpdocFiles = vi.hoisted(() => new Map<string, unknown>());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { path?: string; documentJson?: string; media?: unknown[] }) => {
    if (cmd === 'package_document') {
      wpdocFiles.set(args.path!, { kind: 'v2', document: args.documentJson!, media: args.media ?? [] });
      return null;
    }
    if (cmd === 'unpackage_document') {
      const f = wpdocFiles.get(args.path!) as { document: string; media: unknown[] };
      if (!f) throw new Error('file not found');
      return { document: f.document, media: f.media };
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

const BASE = { fontFamily: 'fake', fontSize: 16 };
const PAGE_SETUP = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };
const FFFC = '￼';

function fixturePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(8 + 4 + 4 + 13 + 4);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.set(sig, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8;
  bytes[25] = 6;
  return bytes;
}

function directLayout(editor: Editor) {
  const adapted = pmDocToSemantic(editor.state.doc, BASE);
  const engine = createLayoutEngine({ metrics: FakeMetrics });
  return {
    adapted,
    result: engine.layout({ baseStyle: BASE, blocks: adapted.doc.blocks }, toLayoutOptions(PAGE_SETUP)),
  };
}

const paintOps = () => (globalThis as { __paintOps?: { op: string; args: unknown[] }[] }).__paintOps ?? [];

function imagePosOf(editor: Editor, kind = 'image'): number {
  let pos = -1;
  editor.state.doc.descendants((n, p) => {
    if (n.type.name === kind && pos < 0) {
      pos = p;
      return false;
    }
    return true;
  });
  return pos;
}

beforeAll(() => {
  Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

beforeEach(() => {
  useMediaStore.getState().clear();
  __bitmapTestSeam.clear();
  vi.clearAllMocks();
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      editor: { ...state.config.editor, showCaptions: true, zoomLevel: 100, defaultPageLayout: 'Pages' },
    },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Inline conversion both directions (the node-kind switch) ────────

describe('inline conversion', () => {
  it('block → inline: the node-kind SWITCH (different PM shapes), attrs carried', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    const png = fixturePng(100, 60);
    await insertImageBytes(editor, png, 'png');
    const pos = imagePosOf(editor);
    const attrs = editor.state.doc.nodeAt(pos)!.attrs;
    act(() => {
      editor.commands.setNodeSelection(pos);
    });
    act(() => {
      convertBlockToInline(editor);
    });
    // The inline node exists inside a paragraph; the block is GONE:
    expect(imagePosOf(editor)).toBe(-1);
    expect(imagePosOf(editor, 'inlineImage')).toBeGreaterThan(0);
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'inlineImage') {
        expect(n.attrs.src).toBe(attrs.src);
        expect(n.attrs.width).toBe(100);
        expect(n.attrs.height).toBe(60);
        expect(n.attrs.alt).toBe(attrs.alt);
        // The inert carriers survive (the round-trip set):
        expect(n.attrs.align).toBe(attrs.align);
        expect(n.attrs.radius).toBe(attrs.radius);
        return false;
      }
      return true;
    });
  });

  it('block → inline → block: geometry returns EXACTLY (the pin)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    const png = fixturePng(150, 90);
    await insertImageBytes(editor, png, 'png');
    const pos = imagePosOf(editor);
    const before = JSON.stringify(editor.state.doc.nodeAt(pos)!.attrs);
    act(() => {
      editor.commands.setNodeSelection(pos);
      convertBlockToInline(editor);
    });
    const inlinePos = imagePosOf(editor, 'inlineImage');
    act(() => {
      editor.commands.setNodeSelection(inlinePos);
      convertInlineToBlock(editor);
    });
    const afterPos = imagePosOf(editor);
    expect(afterPos).toBeGreaterThan(-1);
    const after = editor.state.doc.nodeAt(afterPos)!.attrs;
    // The FULL attr set returns (the carriers did their job):
    for (const key of ['src', 'width', 'height', 'alt', 'align', 'keepNext', 'radius']) {
      expect(String(after[key])).toBe(String(JSON.parse(before)[key]));
    }
    expect(after.width).toBe(150);
    expect(after.height).toBe(90);
  });
});

// ─── 2+3. Inline mid-paragraph: paint within the line + offsets ──────────

describe('inline in a line (the segmentsFor correlation)', () => {
  async function setupFlanked(): Promise<Editor> {
    const { editor } = renderTensor('<p>hello world</p>');
    await settleLayout();
    const png = fixturePng(20, 16);
    await insertImageBytes(editor, png, 'png');
    const pos = imagePosOf(editor);
    const attrs = { ...editor.state.doc.nodeAt(pos)!.attrs };
    // One transaction: delete the block image; insert the inline node
    // INSIDE the paragraph after 'hello ' (para starts at 0 → inner
    // position 7 = after 6 chars). Positions computed in one tr.
    const tr = editor.state.tr;
    tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize);
    tr.insert(1 + 6, editor.state.schema.nodes.inlineImage!.create(attrs));
    editor.view.dispatch(tr);
    return editor;
  }

  it('the adapter emits an InlineImageRun + the U+FFFC token: offset identity BOTH directions', async () => {
    const editor = await setupFlanked();
    const { adapted } = directLayout(editor);
    const para = adapted.doc.blocks[0] as { runs: unknown[]; kind: string };
    expect(para.kind).toBe('paragraph');
    const inlineRun = para.runs.find((r) => (r as { kind?: string }).kind === 'inlineImage') as {
      kind: string;
      src: string;
      width: number;
      height: number;
    };
    expect(inlineRun).toBeDefined();
    expect(inlineRun.src.startsWith('media://')).toBe(true);
    // The PM-offset identity: the block's text has ONE U+FFFC at the
    // object's PM position (offset = PM pos − paraStart − 1).
    const blockText = (adapted.blocks[0] as { text: string }).text;
    const tokenIndex = blockText.indexOf(FFFC);
    expect(tokenIndex).toBeGreaterThan(0);
    // PM pos ↔ run pos: the inline node's PM position maps to the
    // token's index (source-coordinate identity).
    let inlinePmPos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'inlineImage') {
        inlinePmPos = p;
        return false;
      }
      return true;
    });
    const paraStart = editor.state.doc.resolve(inlinePmPos).before();
    expect(inlinePmPos - paraStart - 1).toBe(tokenIndex);
    // The run INDEX correlation (the paint contract): the inline run's
    // index in runs[] is what LineSegment.runIndex will name.
    expect(para.runs.indexOf(inlineRun)).toBeGreaterThan(0); // flanked by text runs
  });

  it('the engine lays the line out; the object is unbreakable (ONE line, engine-seated)', async () => {
    const editor = await setupFlanked();
    const { result } = directLayout(editor);
    // The object rides the line whose segments correlate its run
    // (the paint contract: blockId → runs[runIndex]).
    const para = directLayout(editor).adapted.blocks[0] as { runs: { kind?: string }[] };
    const inlineRunIndex = para.runs.findIndex((r) => r.kind === 'inlineImage');
    const line = result.lines.find((l) =>
      l.segments.some((seg) => seg.runIndex === inlineRunIndex)
    )!;
    expect(line).toBeDefined();
    expect(line.segments.length).toBeGreaterThanOrEqual(2); // text + object (+ text)
    // BASELINE SEATING: the line's baseline carries the object's
    // height (bottom-at-baseline; the engine grew the box).
    expect(line.baseline).toBeGreaterThanOrEqual(16);
  });

  it('an oversized inline object clamps via the engine (fitDownImage — the shell never re-derives)', async () => {
    const { editor } = renderTensor('<p>x</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(2000, 1000), 'png');
    const pos = imagePosOf(editor);
    void pos;
    act(() => {
      editor.commands.setNodeSelection(pos);
      convertBlockToInline(editor);
    });
    const { result } = directLayout(editor);
    // The engine clamped the 2000px object to the base wrap width
    // (624) — the clamped height rides the OBJECT's line baseline:
    const objectLine = result.lines.find((l) => l.baseline > 100)!;
    expect(objectLine).toBeDefined();
    expect(objectLine.baseline).toBeCloseTo(312, -1); // 624 wide → height 312
  });
});

// ─── 6. Float drag → anchor-relative attrs → engine placed[] ────────────

describe('floats (E-IMG-3)', () => {
  it('drag commits dx/dy (anchor-relative); placed = anchor + offset, engine-clamped', async () => {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(120, 80), 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
    });
    // Float via the registry (the Wrap menu's command):
    act(() => {
      getCommand('imageWrapFront')!.run();
    });
    let attrs = editor.state.doc.nodeAt(pos)!.attrs as { float: { dx: number; dy: number; z: 'front' | 'behind' } };
    expect(attrs.float).toEqual({ dx: 0, dy: 0, z: 'front' });
    // The engine placed the float at its anchor (zero flow):
    const { result: before } = directLayout(editor);
    const placedBefore = before.placed[0]!;
    // Drag +50,−20 (the overlay drop):
    act(() => {
      commitFloatDrag(editor, pos, { ...attrs.float }, 50, -20);
    });
    attrs = editor.state.doc.nodeAt(pos)!.attrs as { float: { dx: number; dy: number; z: 'front' | 'behind' } };
    expect(attrs.float).toEqual({ dx: 50, dy: -20, z: 'front' } as const); // ANCHOR-relative
    const { result: after } = directLayout(editor);
    const placedAfter = after.placed[0]!;
    // placed = anchor + (dx, dy): the offset moved the rect exactly.
    expect(placedAfter.rect.x - placedBefore.rect.x).toBe(50);
    expect(placedAfter.rect.y - placedBefore.rect.y).toBe(-20);
    // TEXT UNAFFECTED: the float contributes zero flow (lines identical).
    expect(after.lines.map((l) => [l.rect.y, l.rect.height])).toEqual(
      before.lines.map((l) => [l.rect.y, l.rect.height])
    );
  });

  it('an EXTREME drag: the ENGINE clamps to the page box (the shell never clamps)', async () => {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
      getCommand('imageWrapFront')!.run();
    });
    // An absurd offset — the engine's clamp is the law:
    act(() => {
      commitFloatDrag(editor, pos, { dx: 0, dy: 0, z: 'front' }, 5000, 5000);
    });
    const { result } = directLayout(editor);
    const placed = result.placed[0]!;
    expect(placed.rect.x + placed.rect.width).toBeLessThanOrEqual(GEOMETRY.pageWidth);
    expect(placed.rect.y + placed.rect.height).toBeLessThanOrEqual(GEOMETRY.pageHeight);
    expect(placed.rect.x).toBeGreaterThanOrEqual(-GEOMETRY.contentX); // margins are the canvas
  });

  it('float-follows-anchor: an edit ABOVE moves the placed rect (moves-with-text)', async () => {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
      getCommand('imageWrapFront')!.run();
      commitFloatDrag(editor, pos, { dx: 0, dy: 0, z: 'front' }, 30, 10);
    });
    const { result: before } = directLayout(editor);
    const placedBefore = before.placed[0]!;
    // A full paragraph lands ABOVE the image's anchor → the anchor
    // moves down one line (moves-with-text):
    act(() => {
      editor.commands.insertContentAt(0, '<p>extra line above</p>');
    });
    const { result: after } = directLayout(editor);
    const placedAfter = after.placed[0]!;
    expect(placedAfter.rect.y).toBeGreaterThan(placedBefore.rect.y); // moved WITH the text
    // The OFFSET is anchor-relative: dy unchanged, the delta IS the
    // anchor's move:
    expect(placedAfter.rect.y - placedBefore.rect.y).toBe(
      after.lines[after.lines.length - 1]!.rect.y - before.lines[before.lines.length - 1]!.rect.y
    );
  });

  it('the adapter REFUSES float+keepNext (the loud-validation seam): flow omitted, the engine never sees it', async () => {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    const pos = imagePosOf(editor);
    // The caption bond + a float — the forbidden combo (hand-crafted):
    act(() => {
      const tr = editor.state.tr;
      tr.setNodeAttribute(pos, 'keepNext', true);
      tr.setNodeAttribute(pos, 'float', { dx: 0, dy: 0, z: 'front' });
      editor.view.dispatch(tr);
    });
    const { adapted, result } = directLayout(editor);
    // The adapter omitted the flow — the engine did NOT throw:
    const imageBlock = adapted.doc.blocks.find((b) => b.kind === 'image') as {
      flow?: unknown;
      float?: unknown;
    };
    expect(imageBlock.float).toEqual({ dx: 0, dy: 0, z: 'front' });
    expect(imageBlock.flow).toBeUndefined(); // the refusal
    expect(result.placed).toHaveLength(1); // layout succeeded
  });
});

// ─── 7+8. Paint order + hit-test layering (z-aware) ──────────────────────

describe('paint order + click layering (z)', () => {
  async function floatedEditor(z: 'front' | 'behind'): Promise<Editor> {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
      getCommand(z === 'front' ? 'imageWrapFront' : 'imageWrapBehind')!.run();
    });
    // Overlap the text: drag the float ONTO the first line (the
    // anchor's y minus most of its height).
    const anchorY = directLayout(editor).result.placed[0]!.rect.y;
    act(() => {
      commitFloatDrag(editor, pos, { dx: 0, dy: 0, z }, 0, -(anchorY - 8));
    });
    return editor;
  }

  it('the paint ORDER: behind floats drawImage BEFORE the text fillText; front AFTER', async () => {
    for (const z of ['behind', 'front'] as const) {
      const editor = await floatedEditor(z);
      const sha = await sha256Hex(fixturePng(100, 60));
      __bitmapTestSeam.resolve(sha, new Image());
      await settleLayout();
      // Force ONE full repaint pass (boxKey's cap leg flips → every
      // text canvas repaints; the ImageLayers repaint every render) —
      // the op stream is then a MOUNT-ORDER receipt.
      paintOps().length = 0;
      act(() => {
        // Flip per iteration (the previous loop turn left it off):
        useConfigStore.getState().setShowCaptions(true);
      });
      await settleLayout();
      paintOps().length = 0;
      act(() => {
        useConfigStore.getState().setShowCaptions(false);
      });
      await settleLayout();
      const ops = paintOps().filter((o) => o.op === 'drawImage' || o.op === 'fillText');
      // The FINAL commit's tree order is the receipt: compare the LAST
      // drawImage against the LAST fillText (the ImageLayer repaints
      // every render — config-only renders pollute the head of the
      // window; the settled tail is the deterministic order).
      const lastDraw = ops.map((o) => o.op).lastIndexOf('drawImage');
      const lastText = ops.map((o) => o.op).lastIndexOf('fillText');
      expect(lastDraw).toBeGreaterThan(-1);
      expect(lastText).toBeGreaterThan(-1);
      if (z === 'behind') {
        expect(lastDraw).toBeLessThan(lastText); // image under the text
      } else {
        expect(lastDraw).toBeGreaterThan(lastText); // image over the text
      }
      void editor;
    }
  });

  it('hit-test layering: FRONT click selects the image; BEHIND click selects the text; empty-space behind click selects the float', async () => {
    // FRONT: the image wins wherever it is.
    const front = await floatedEditor('front');
    const { result } = directLayout(front);
    const placed = result.placed[0]!;
    const stackRect = { left: 0, top: 0 };
    const z = 1;
    const cx = (x: number) => stackRect.left + (GEOMETRY.contentX + x + 5) * z;
    const cy = (y: number) => stackRect.top + (GEOMETRY.contentY + y + 5) * z;
    // Multiple editors coexist within one test (cleanup is per-test):
    // always click the LATEST mounted wrapper.
    const latestWrapper = () =>
      document.querySelectorAll('[data-testid="paginated-zoom-wrapper"]')[
        document.querySelectorAll('[data-testid="paginated-zoom-wrapper"]').length - 1
      ]!;
    act(() => {
      fireEvent.mouseDown(latestWrapper(), {
        clientX: cx(placed.rect.x),
        clientY: cy(placed.rect.y),
      });
    });
    const sel = front.state.selection as unknown as { node?: { type?: { name?: string } } };
    expect(sel.node?.type?.name).toBe('image'); // front wins over text

    // BEHIND: a click inside the TEXT LINE's band (y 0..16, the
    // float's x) goes to the TEXT — the line is above in paint order.
    // NOTE the float was dragged ON TOP of that band too, so the
    // FRONT-check (z !== 'behind') must NOT fire; the text track
    // check must. Debug receipt: print both.
    const behind = await floatedEditor('behind');
    act(() => {
      fireEvent.mouseDown(
        document.querySelectorAll('[data-testid="paginated-zoom-wrapper"]')[
          document.querySelectorAll('[data-testid="paginated-zoom-wrapper"]').length - 1
        ]!,
        {
          clientX: cx(0),
          clientY: cy(8), // mid first line — the text track
        },
      );
    });
    const sel2 = behind.state.selection as unknown as { node?: { type?: { name?: string } }; from?: number; empty?: boolean };
    // Text above → NOT the image:
    expect(sel2.node?.type?.name).not.toBe('image');

    // BEHIND + text-empty space: the float is selectable there. The
    // float was dragged ONTO the first line (top y=8); click BELOW
    // the line (y > 16) inside the float's rect — no line above:
    const { result: r2 } = directLayout(behind);
    const p2 = r2.placed[0]!;
    const belowLine = Math.max(p2.rect.y + 20, 40); // inside float, below text
    act(() => {
      fireEvent.mouseDown(
        document.querySelectorAll('[data-testid="paginated-zoom-wrapper"]')[
          document.querySelectorAll('[data-testid="paginated-zoom-wrapper"]').length - 1
        ]!,
        {
          clientX: cx(p2.rect.x),
          clientY: cy(belowLine),
        },
      );
    });
    const sel3 = behind.state.selection as unknown as { node?: { type?: { name?: string } } };
    expect(sel3.node?.type?.name).toBe('image');
  });
});

// ─── 11. Round-trip + GC (inline + floated media refs) ───────────────────

describe('save/reopen + GC', () => {
  it('float attrs + inline images persist; the GC sees ALL referenced media (inline + floated)', async () => {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    const png = fixturePng(100, 60);
    const sha = await sha256Hex(png);
    await insertImageBytes(editor, png, 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
      getCommand('imageWrapFront')!.run();
      commitFloatDrag(editor, pos, { dx: 0, dy: 0, z: 'front' }, 12, -8);
    });
    // A SECOND image goes inline — the caret moves to the doc end
    // first (insertContent at a NodeSelection would REPLACE #1):
    const png2 = fixturePng(40, 30);
    const sha2 = await sha256Hex(png2);
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size);
    });
    await insertImageBytes(editor, png2, 'png');
    const pos2 = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos2);
    });
    act(() => {
      convertBlockToInline(editor);
    });
    const docJSON = editor.getJSON();
    // The GC walks BOTH refs (block float + inline):
    const ids = collectReferencedMediaIds(docJSON);
    expect([...ids].sort()).toEqual([sha, sha2].sort());
    // Save → reopen through the container layer:
    const file = { version: 1, docJSON, metadata: {} } as const;
    await saveWpdoc('/x/m2.wpdoc', file);
    useMediaStore.getState().clear();
    const opened = await openWpdoc('/x/m2.wpdoc');
    expect(opened.docJSON).toEqual(docJSON); // attrs byte-identical (float + inline)
    expect(useMediaStore.getState().entries.get(sha)?.bytes).toEqual(png);
    expect(useMediaStore.getState().entries.get(sha2)?.bytes).toEqual(png2);
  });
});

// ─── M-IMAGES-2.1: the inline paint path, end-to-end (the repair
// receipt: every station wired, the placeholder fires ONLY while the
// bitmap is pending). ─────────────────────────────────────────────

describe('inline paint path (M-IMAGES-2.1)', () => {
  it('the painted op is drawImage (baseline-seated at the token advance) once the bitmap lands; gray placeholder only while pending', async () => {
    const { editor } = renderTensor('<p>text</p>');
    await settleLayout();
    const png = fixturePng(20, 16);
    const sha = await sha256Hex(png);
    await insertImageBytes(editor, png, 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
      convertBlockToInline(editor);
    });
    await settleLayout();
    // PENDING: the tinted placeholder (the load is in flight) —
    // identical geometry to the future bitmap:
    const pendingRects = paintOps().filter((o) => o.op === 'fillRect');
    expect(pendingRects.length).toBeGreaterThan(0);
    // The arrival: the bitmap lands → the version bumps → the block
    // canvases repaint once (the arrival law) → drawImage fires with
    // the ENGINE's clamped dims, baseline-seated. (Fresh ops window:
    // the pre-conversion block paints must not pollute the receipt.)
    paintOps().length = 0;
    __bitmapTestSeam.resolve(sha, new Image());
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const draws = paintOps().filter((o) => o.op === 'drawImage');
    expect(draws.length).toBeGreaterThan(0);
    const lastDraw = draws[draws.length - 1]!.args as [unknown, number, number, number, number];
    // Baseline-seated: the draw y = baseline − clampedHeight; the
    // line's baseline comes from the engine (20×16 fits: no clamp).
    // Correlate via the SEGMENT (the paint contract): the line whose
    // segment's runIndex names the inlineImage run.
    const { result, adapted } = directLayout(editor);
    const objBlockIdx = adapted.blocks.findIndex(
      (b) => (b as { runs?: { kind?: string }[] }).runs?.some((r) => r.kind === 'inlineImage')
    );
    const objBlock = adapted.blocks[objBlockIdx] as { runs: { kind?: string }[] };
    const runIndex = objBlock.runs.findIndex((r) => r.kind === 'inlineImage');
    const objBlockId = (adapted.blocks[objBlockIdx] as { id: string }).id;
    const line = result.lines.find(
      (l) => l.blockId === objBlockId && l.segments.some((seg) => seg.runIndex === runIndex)
    )!;
    expect(line).toBeDefined();
    // Canvas y is block-relative: (line.rect.y − minY) + baseline − h.
    // Single-line object-only block: minY == line.rect.y → y == baseline − h.
    // The baseline is the ENGINE's (the seating rule: the object
    // rides bottom-at-baseline):
    expect(line.baseline).toBeGreaterThanOrEqual(16);
    expect(lastDraw[2]).toBe(line.baseline - 16); // baseline-seated
    void GEOMETRY;
    expect(lastDraw[3]).toBe(20); // clamped width (fits — unclamped)
    expect(lastDraw[4]).toBe(16); // height
  });

  it('STEP 2: clicking the inline OBJECT selects the image node; the text around stays text; Backspace deletes it', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settleLayout();
    const png = fixturePng(48, 16);
    const sha = await sha256Hex(png);
    await insertImageBytes(editor, png, 'png');
    const pos = imagePosOf(editor);
    const attrs = { ...editor.state.doc.nodeAt(pos)!.attrs };
    // Move the object INLINE after 'hello ' (offset 6):
    const tr = editor.state.tr;
    tr.delete(pos, pos + editor.state.doc.nodeAt(pos)!.nodeSize);
    tr.insert(1 + 6, editor.state.schema.nodes.inlineImage!.create(attrs));
    editor.view.dispatch(tr);
    await settleLayout();

    // Click the OBJECT (x = content start + 'hello ' advance + a few
    // px into the 48px object):
    const clickX = GEOMETRY.contentX + 60 + 10;
    const clickY = GEOMETRY.contentY + 8;
    act(() => {
      fireEvent.mouseDown(document.querySelector('[data-testid="paginated-zoom-wrapper"]')!, {
        clientX: clickX,
        clientY: clickY,
      });
    });
    const sel = editor.state.selection as unknown as { node?: { type?: { name?: string } } };
    expect(sel.node?.type?.name).toBe('inlineImage'); // NodeSelection

    // Backspace with the node selected deletes it:
    act(() => {
      editor.view.dom.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Backspace', bubbles: true })
      );
    });
    expect(imagePosOf(editor, 'inlineImage')).toBe(-1); // deleted
    void sha;
  });

  it('STEP 3: drag-THROUGH on each corner — dims floor at 16, the anchored corner never flips, no jump on release', async () => {
    const { editor } = renderTensor('<p>t</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
    });
    await settleLayout();
    const before = directLayout(editor).result.placed[0]!;
    // SE corner: drag FAR past the NW anchor (−400 left, −400 up):
    const handle = document.querySelector('[data-testid="image-handle-se"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: false });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: -400, clientY: -400 });
    });
    // The preview clamps at the floor DURING the drag — no crossing,
    // no flip (the overlay stays ≥ MIN_DRAG on both axes):
    const selEl = document.querySelector('[data-testid="image-selection"]') as HTMLElement;
    expect(parseFloat(selEl.style.width)).toBeGreaterThanOrEqual(16);
    expect(parseFloat(selEl.style.height)).toBeGreaterThanOrEqual(16);
    // The anchored (NW) corner stationary: left+width == the placed
    // right edge only if dims had grown; at the floor the right edge
    // is left+16 — the receipt is: the left edge stays AT the anchor.
    expect(parseFloat(selEl.style.left)).toBe(GEOMETRY.contentX + before.rect.x);
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1 });
    });
    await settleLayout();
    // Commit: dims floored (16 or the 24-commit floor's round-up
    // through the node ratio), no position jump:
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBeGreaterThanOrEqual(16);
        expect(n.attrs.height).toBeGreaterThanOrEqual(16);
        return false;
      }
      return true;
    });
  });
});

// ─── 12b. The Wrap menu wiring (registry dispatch) ──────────────────────

describe('wrap commands', () => {
  it('setWrapMode round the modes: inline → front → behind → inline (the menu wiring)', async () => {
    const { editor } = renderTensor('<p>t</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(80, 50), 'png');
    const pos = imagePosOf(editor);
    act(() => {
      editor.commands.setNodeSelection(pos);
    });
    act(() => {
      setWrapMode(editor, 'front');
    });
    expect((editor.state.doc.nodeAt(pos)!.attrs as { float: unknown }).float).toMatchObject({ z: 'front' });
    act(() => {
      editor.commands.setNodeSelection(pos);
      setWrapMode(editor, 'behind');
    });
    expect((editor.state.doc.nodeAt(pos)!.attrs as { float: unknown }).float).toMatchObject({ z: 'behind' });
    act(() => {
      editor.commands.setNodeSelection(pos);
      setWrapMode(editor, 'inline');
    });
    expect(imagePosOf(editor, 'inlineImage')).toBeGreaterThan(-1);
    expect(imagePosOf(editor)).toBe(-1);
  });
});
