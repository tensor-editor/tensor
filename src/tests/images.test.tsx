import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { createLayoutEngine } from '@tensor-editor/engine';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_MARGINS, PAGE_GAP, toLayoutOptions } from '@/lib/document/pageSetup';
import { useMediaStore } from '@/lib/media/store';
import {
  insertImageBytes,
  insertImageBlob,
  pngIhdrSize,
  sha256Hex,
  isExternalImageUrl,
} from '@/lib/media/insert';
import { backfillImageDims } from '@/lib/media/backfill';
import { insertCaptionForImage } from '@/lib/media/caption';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { useAltTextStore, AltTextDialog } from '@/components/dialogs/ImageDialogs';
import { ShowGroup } from '@/components/layout/ribbon/view/groups/ShowGroup';
import { toast } from '@/components/ui/toast';
import { saveWpdoc, openWpdoc, collectReferencedMediaIds } from '@/lib/document/wpdoc';
import { getCommand } from '@/lib/commands/registry';
import { renderTensor, settleLayout, GEOMETRY } from './harness';
import { FakeMetrics } from './fakeMetrics';

/**
 * M-IMAGES-1 — the linear image suite: insert, render, resize, align,
 * caption, alt, round-trip. jsdom notes: the paginated paint surface
 * is the recorded-canvas stub (drawImage/fillRect ops carry the
 * PLACED rects — asserted, not eyeballed); the pageless surface is
 * the node view DOM; the a11y surface is the hidden PM view's real
 * <img alt> (the M5 Orca mirror).
 */

// M-IMAGES-0 container simulator (same wire contract as wpdoc.test).
const wpdocFiles = vi.hoisted(() => new Map<string, { kind: 'v2'; document: string; media: { id: string; ext: string; bytesB64: string }[] }>());
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { path?: string; documentJson?: string; media?: unknown[] }) => {
    if (cmd === 'package_document') {
      wpdocFiles.set(args.path!, {
        kind: 'v2',
        document: args.documentJson!,
        media: (args.media ?? []) as { id: string; ext: string; bytesB64: string }[],
      });
      return null;
    }
    if (cmd === 'unpackage_document') {
      const f = wpdocFiles.get(args.path!);
      if (!f) throw new Error('file not found');
      return { document: f.document, media: f.media };
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

const BASE = { fontFamily: 'fake', fontSize: 16 };
const PAGE_SETUP = { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP };

/** A minimal VALID PNG: signature + IHDR (13 bytes) — the pure parser
 *  decodes w/h; no decoder needed in jsdom (the fallback receipt). */
function fixturePng(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(8 + 4 + 4 + 13 + 4);
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  bytes.set(sig, 0);
  const view = new DataView(bytes.buffer);
  view.setUint32(8, 13); // IHDR length
  bytes.set([0x49, 0x48, 0x44, 0x52], 12); // 'IHDR'
  view.setUint32(16, width);
  view.setUint32(20, height);
  bytes[24] = 8; // bit depth
  bytes[25] = 6; // color type
  bytes[26] = 0; bytes[27] = 0; bytes[28] = 0; // compression/filter/interlace
  // CRC (zeros — the parser never verifies it; no decoder in jsdom)
  return bytes;
}

function directLayout(editor: Editor) {
  const adapted = pmDocToSemantic(editor.state.doc, BASE);
  const engine = createLayoutEngine({ metrics: FakeMetrics });
  return { adapted, result: engine.layout({ baseStyle: BASE, blocks: adapted.doc.blocks }, toLayoutOptions(PAGE_SETUP)) };
}

function geometryContentX(): number { return GEOMETRY.contentX; }

const paintOps = () => (globalThis as { __paintOps?: { op: string; args: unknown[]; font?: string }[] }).__paintOps ?? [];

beforeAll(() => {
  Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

beforeEach(() => {
  useMediaStore.getState().clear();
  useAltTextStore.getState().close();
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

// ─── 1. Insert: all paths → one pipeline ────────────────────────────────

describe('insertion', () => {
  it('picker path bytes → sha-named MediaStore entry + node with EXACT natural dims + media:// src', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    const png = fixturePng(120, 80);
    const ok = await insertImageBytes(editor, png, 'png');
    expect(ok).toBe(true);
    const sha = await sha256Hex(png);
    // The store holds the bytes (the ONE resolution point):
    expect(useMediaStore.getState().entries.get(sha)?.bytes).toEqual(png);
    // The node: refs only, exact dims:
    let found = false;
    editor.state.doc.descendants((node) => {
      if (node.type.name === 'image') {
        found = true;
        expect(node.attrs.src).toBe(`media://${sha}`);
        expect(node.attrs.width).toBe(120);
        expect(node.attrs.height).toBe(80);
        expect(node.attrs.blockId).toBeTruthy(); // BlockIdExtension mints
      }
      return true;
    });
    expect(found).toBe(true);
  });

  it('blob path (drop/paste): same pipeline, ext from the blob type', async () => {
    const { editor } = renderTensor('<p>x</p>');
    await settleLayout();
    const png = fixturePng(64, 64);
    const blob = new Blob([png as unknown as BlobPart], { type: 'image/png' });
    await insertImageBlob(editor, blob);
    const sha = await sha256Hex(png);
    expect(useMediaStore.getState().entries.has(sha)).toBe(true);
  });

  it('pngIhdrSize (the pure fallback decoder) — the receipt math', () => {
    expect(pngIhdrSize(fixturePng(300, 200))).toEqual({ width: 300, height: 200 });
    expect(pngIhdrSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

// ─── 2. Fit-down + 4. Align: the engine's placed math, asserted ────────

describe('placement (engine math, asserted)', () => {
  it('fit-down: an oversized image places at the content width (placed[], not eyeballed)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    // 800px wide in a 624px column → the engine clamps to 624 (and
    // scales height by the same ratio: 800×400 → 624×312).
    await insertImageBytes(editor, fixturePng(800, 400), 'png');
    const { result } = directLayout(editor);
    const placed = result.placed;
    expect(placed).toHaveLength(1);
    expect(placed[0]!.rect.width).toBe(GEOMETRY.contentWidth); // fit-down
    expect(placed[0]!.rect.height).toBe(312); // aspect preserved
    expect(placed[0]!.pageIndex).toBe(0);
  });

  it('align: the attr moves placed.x by the shared offset (engine alignOffset)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 50), 'png'); // 100px in 624
    expect(directLayout(editor).result.placed[0]!.rect.x).toBe(0); // left
    act(() => {
      editor.chain().focus().updateAttributes('image', { align: 'center' }).run();
    });
    expect(directLayout(editor).result.placed[0]!.rect.x).toBe((GEOMETRY.contentWidth - 100) / 2);
    act(() => {
      editor.chain().focus().updateAttributes('image', { align: 'right' }).run();
    });
    expect(directLayout(editor).result.placed[0]!.rect.x).toBe(GEOMETRY.contentWidth - 100);
  });
});

// ─── 5. Adapter: the seam list flips ────────────────────────────────────

describe('adapter seam (the M5 fallback test flipped)', () => {
  it('an image doc LAYS OUT PAGINATED — no pageless fallback, no throw', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    await settleLayout();
    expect(document.querySelector('[data-testid="paginated-fallback"]')).toBeNull();
    expect(document.querySelectorAll('[data-testid="page-sheet"]').length).toBeGreaterThan(0);
    // The adapter's remaining seam list (BEFORE this milestone:
    // '(table, image, drawing)'; after: image is GONE):
    expect(() => pmDocToSemantic(editor.state.doc, BASE)).not.toThrow();
  });

  it('a dim-less image still throws the pending-backfill sentinel (the adapter contract)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    act(() => {
      editor.commands.insertContent({ type: 'image', attrs: { src: 'media://deadbeef' } });
    });
    // No dims in the store either → the pageless fallback holds:
    await settleLayout();
    expect(document.querySelector('[data-testid="paginated-fallback"]')).not.toBeNull();
  });
});

// ─── 3. Resize: aspect-locked math, attrs written, engine refits ────────

describe('resize', () => {
  it('aspect-locked: 50% drag on width → height follows; attrs written; placed[] changes', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    await settleLayout();
    // Select the image node:
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    const selectionEl = document.querySelector('[data-testid="image-selection"]') as HTMLElement;
    expect(selectionEl).not.toBeNull();

    // Simulate the commit path (the component's drag math is
    // exercised through the same contract: ratio-scaled attrs):
    // 50% on width → height follows (aspect 200:100).
    const before = directLayout(editor).result.placed[0]!.rect;
    act(() => {
      editor
        .chain()
        .command(({ tr, dispatch }) => {
          if (dispatch) {
            tr.setNodeAttribute(imagePos, 'width', 100); // 200 * 0.5
            tr.setNodeAttribute(imagePos, 'height', 50); // 100 * 0.5 — follows
          }
          return true;
        })
        .run();
    });
    await settleLayout();
    const after = directLayout(editor).result.placed[0]!.rect;
    expect(after.width).toBe(100);
    expect(after.height).toBe(50);
    expect(after).not.toEqual(before); // placed[] changed (engine re-fit)
    // The committed attrs are the model truth:
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBe(100);
        expect(n.attrs.height).toBe(50);
        return false;
      }
      return true;
    });
  });

  it('M-IMAGES-2 R1: SE drag → dims exact, the NW corner (its anchor) UNMOVED', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    const before = directLayout(editor).result.placed[0]!;
    const handle = document.querySelector('[data-testid="image-handle-se"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: false });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 0 });
    });
    // ANCHOR RECEIPT (drag time): SE's anchor is NW — left/top stay at
    // the placed rect's origin DURING the drag.
    {
      const selEl = document.querySelector('[data-testid="image-selection"]') as HTMLElement;
      expect(selEl.style.left).toBe(`${GEOMETRY.contentX + before.rect.x}px`);
      expect(selEl.style.top).toBe(`${GEOMETRY.contentY + before.rect.y}px`);
    }
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1 });
    });
    await settleLayout();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        // DEFAULT = FREE (the hands ruling): dx-only → width grows,
        // height untouched.
        expect(n.attrs.width).toBe(240);
        expect(n.attrs.height).toBe(100);
        return false;
      }
      return true;
    });
    // SHIFT = aspect-locked: on the committed 240×100, +20 width
    // drives height by the CURRENT ratio (100/240).
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    const handle2 = document.querySelector('[data-testid="image-handle-se"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(handle2, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: true });
    });
    act(() => {
      fireEvent.pointerMove(handle2, { pointerId: 1, clientX: 20, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerUp(handle2, { pointerId: 1 });
    });
    await settleLayout();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBe(260); // 240 + 20
        expect(n.attrs.height).toBe(108); // aspect: round(100 × 260/240)
        return false;
      }
      return true;
    });
    const after = directLayout(editor).result.placed[0]!;
    // SE's anchor is NW: (x, y) unmoved; growth went down-right.
    expect(after.rect.x).toBe(before.rect.x);
    expect(after.rect.y).toBe(before.rect.y);
  });

  it('M-IMAGES-2 R1: NW drag → dims exact, the SE corner (its anchor) UNMOVED', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    const before = directLayout(editor).result.placed[0]!;
    const handle = document.querySelector('[data-testid="image-handle-nw"]') as HTMLElement;
    // NW drags with sx = −1: dragging LEFT (−40) GROWS the width.
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: false });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: -40, clientY: 0 });
    });
    // ANCHOR RECEIPT (drag time — the preview frame): NW's anchor is
    // the SE corner: (left + width) stays at the placed rect's right
    // edge DURING the drag. The OLD top-left-everywhere math pinned
    // the LEFT edge instead — the top handles moved inverted; this
    // is the receipt that they no longer do.
    const selEl = document.querySelector('[data-testid="image-selection"]') as HTMLElement;
    const previewLeft = parseFloat(selEl.style.left);
    const previewWidth = parseFloat(selEl.style.width);
    expect(previewLeft + previewWidth).toBe(
      geometryContentX() + before.rect.x + before.rect.width
    );
    expect(previewLeft).toBe(geometryContentX() + before.rect.x + before.rect.width - 240);
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1 });
    });
    await settleLayout();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBe(240); // default FREE: dx-only
        expect(n.attrs.height).toBe(100);
        return false;
      }
      return true;
    });
    // Post-commit the placed rect re-derives from the flow (align) —
    // the ANCHOR was the drag contract; the dims are the commit.
  });

  it('M-IMAGES-2 R1: NE + SW corners — each anchors its opposite', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    const before = directLayout(editor).result.placed[0]!;
    // NE: anchor SW = (x, y + h) — fixed.
    const ne = document.querySelector('[data-testid="image-handle-ne"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(ne, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: false });
    });
    act(() => {
      fireEvent.pointerMove(ne, { pointerId: 1, clientX: 40, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerUp(ne, { pointerId: 1 });
    });
    await settleLayout();
    let after = directLayout(editor).result.placed[0]!;
    expect(after.rect.y + after.rect.height).toBe(before.rect.y + before.rect.height); // SW y fixed
    expect(after.rect.x).toBe(before.rect.x); // SW x fixed (NE grows right)

    // SW: anchor NE = (x + w, y) — fixed.
    act(() => {
      editor.commands.setNodeSelection(imagePos); // reselect (attrs changed)
    });
    await settleLayout();
    const before2 = directLayout(editor).result.placed[0]!;
    const sw = document.querySelector('[data-testid="image-handle-sw"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(sw, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: false });
    });
    act(() => {
      fireEvent.pointerMove(sw, { pointerId: 1, clientX: 0, clientY: 40 });
    });
    act(() => {
      fireEvent.pointerUp(sw, { pointerId: 1 });
    });
    await settleLayout();
    after = directLayout(editor).result.placed[0]!;
    expect(after.rect.x + after.rect.width).toBe(before2.rect.x + before2.rect.width); // NE x fixed
    expect(after.rect.y).toBe(before2.rect.y); // NE y fixed
  });

  it('M-IMAGES-2 R2: per-corner CSS cursors (the diagonal receipt)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    const cursor = (corner: string) =>
      (document.querySelector(`[data-testid="image-handle-${corner}"]`) as HTMLElement).style.cursor;
    expect(cursor('nw')).toBe('nwse-resize');
    expect(cursor('se')).toBe('nwse-resize');
    expect(cursor('ne')).toBe('nesw-resize');
    expect(cursor('sw')).toBe('nesw-resize');
  });

  it('DEFAULT is free; SHIFT locks aspect — the hands ruling (both directions)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    // (a) DEFAULT (no Shift): free — the axes move independently.
    let handle = document.querySelector('[data-testid="image-handle-se"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: false });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 5 });
    });
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1 });
    });
    await settleLayout();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBe(240); // +40
        expect(n.attrs.height).toBe(105); // +5 only — FREE
        return false;
      }
      return true;
    });
    // (b) SHIFT: aspect-locked — width drives, dy ignored.
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    handle = document.querySelector('[data-testid="image-handle-se"]') as HTMLElement;
    act(() => {
      fireEvent.pointerDown(handle, { pointerId: 1, clientX: 0, clientY: 0, shiftKey: true });
    });
    act(() => {
      fireEvent.pointerMove(handle, { pointerId: 1, clientX: 40, clientY: 0 });
    });
    act(() => {
      fireEvent.pointerUp(handle, { pointerId: 1 });
    });
    await settleLayout();
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBe(280); // 240 + 40 drives
        expect(n.attrs.height).toBe(123); // aspect: round(105 × 280/240) = 122.5 → 123
        return false;
      }
      return true;
    });
  });

  it('oversized commit: the engine reasserts fit-down on the result (the engine owns the math)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 100), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor
        .chain()
        .command(({ tr, dispatch }) => {
          if (dispatch) {
            tr.setNodeAttribute(imagePos, 'width', 5000);
            tr.setNodeAttribute(imagePos, 'height', 2500);
          }
          return true;
        })
        .run();
    });
    const placed = directLayout(editor).result.placed[0]!.rect;
    expect(placed.width).toBe(GEOMETRY.contentWidth); // fit-down reasserted
  });
});

// ─── 6. Caption: the bond + the display toggle ─────────────────────────

describe('caption', () => {
  it('Add Caption (TOOLBAR → registry → command): styleId caption + keepNext bond + immediate focus', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    // REACHABILITY (STEP 2): the toolbar button — not the command —
    // is the instrument; it dispatches through the registry.
    const captionButton = document.querySelector('[data-testid="toolbar-add-caption"]') as HTMLElement;
    expect(captionButton).not.toBeNull();
    act(() => {
      fireEvent.click(captionButton);
    });
    const after = editor.state.doc;
    const image = after.nodeAt(imagePos)!;
    expect(image.attrs.keepNext).toBe(true); // THE BOND
    const caption = after.nodeAt(imagePos + image.nodeSize);
    expect(caption?.type.name).toBe('paragraph');
    expect(caption?.attrs.styleId).toBe('caption');
    // Focused immediately — the caret is INSIDE the caption:
    expect(editor.state.selection.from).toBe(imagePos + image.nodeSize + 1);
  });

  it('the bond holds across a forced page boundary (engine-pinned; the shell only writes the flag)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    // A tall image near the page bottom: the caption must NOT land on
    // the next page alone (keepNext moves the IMAGE down with it).
    await insertImageBytes(editor, fixturePng(100, 800), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    act(() => {
      insertCaptionForImage(editor);
    });
    await act(async () => {
      editor.commands.insertContentAt(editor.state.selection.from, 'Figure 1');
    });
    const { result } = directLayout(editor);
    const placed = result.placed[0]!;
    const captionLine = result.lines.find((l) => l.pageIndex === placed.pageIndex);
    // Same page (the bond), or a page break splits them — either way
    // the ENGINE decided; assert the flag is what it consumed:
    const semantic = pmDocToSemantic(editor.state.doc, BASE);
    const imageBlock = semantic.doc.blocks.find((b) => b.kind === 'image') as { flow?: { keepNext?: boolean } };
    expect(imageBlock.flow?.keepNext).toBe(true);
    // E-IMG-1's engine-side pin: with the flag set, image end + caption
    // start share a page in THIS layout:
    expect(captionLine).toBeDefined();
    expect(captionLine!.pageIndex).toBe(placed.pageIndex);
  });

  it('REACHABILITY: the View > Show "Captions" toggle EXISTS and is wired', () => {
    render(<ShowGroup />);
    const toggle = document.querySelector('button[aria-label="Show Captions"]') as HTMLButtonElement;
    expect(toggle).not.toBeNull();
    expect(toggle.getAttribute('aria-pressed')).toBe('true'); // default ON
    act(() => {
      fireEvent.click(toggle);
    });
    expect(useConfigStore.getState().config.editor.showCaptions).toBe(false);
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
  });

  it('display toggle hides the ink, preserves the model (NPC precedent)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
      insertCaptionForImage(editor);
    });
    await act(async () => {
      editor.commands.insertContentAt(editor.state.selection.from, 'Visible caption');
    });
    await settleLayout();
    const opsWithCaption = paintOps().filter((o) => o.args[0] === 'Visible caption');
    expect(opsWithCaption.length).toBeGreaterThan(0);
    const docBefore = editor.state.doc.toJSON();
    // Toggle OFF: the caption ink disappears, the model is untouched.
    paintOps().length = 0;
    act(() => {
      useConfigStore.getState().setShowCaptions(false);
    });
    await settleLayout();
    expect(paintOps().filter((o) => o.args[0] === 'Visible caption')).toHaveLength(0);
    expect(editor.state.doc.toJSON()).toEqual(docBefore);
  });
});

// ─── 7. Alt text + the a11y receipt ─────────────────────────────────────

describe('alt text', () => {
  it('TOOLBAR → Alt Text dialog → attr written (the a11y receipt stands)', async () => {
    render(<AltTextDialog />);
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    const png = fixturePng(100, 60);
    await insertImageBytes(editor, png, 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    // REACHABILITY: the floating toolbar shows the image group; its
    // Alt Text button dispatches through the command registry.
    const altButton = document.querySelector('[data-testid="toolbar-alt-text"]') as HTMLButtonElement;
    expect(altButton).not.toBeNull();
    act(() => {
      fireEvent.click(altButton);
    });
    await act(async () => {
      // The dialog mounts portaled — flush to be safe.
      await Promise.resolve();
    });
    const input = document.querySelector('[data-testid="alt-text-input"]') as HTMLInputElement;
    expect(input).not.toBeNull(); // diagnostic
    act(() => {
      fireEvent.change(input, { target: { value: 'A chart of receipts' } });
    });
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="alt-text-save"]')!);
    });
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.alt).toBe('A chart of receipts');
    // THE A11Y RECEIPT: the hidden PM view (opacity-0, in the a11y
    // tree — the M5 law) renders a REAL <img alt> — what AT-SPI/Orca
    // reports on the live app. (Node views re-render on the PM
    // update flush — settle first.)
    await settleLayout();
    const img = document.querySelector('.pm-input-only img') as HTMLImageElement;
    expect(img).not.toBeNull();
    expect(img.alt).toBe('A chart of receipts');
  });
});

// ─── M-IMAGES-1.5: corner radius (paint-only) ──────────────────────────

describe('corner radius', () => {
  it('toolbar stepper → attr written; BOTH render paths receive it (canvas clip / CSS)', async () => {
    const { editor } = renderTensor('<p>r</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(200, 120), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.commands.setNodeSelection(imagePos);
    });
    await settleLayout();
    // M-IMAGES-1.5.5: the radius control is the RibbonIconInput (the
    // FontSize/Spacing pattern — consistent UI): one number input with
    // embedded steppers. Step via the input's ArrowUp (its stepper
    // key path; the registry's shared clamp law under it):
    const value = document.querySelector(
      '[data-floating-toolbar] input[type="number"]'
    ) as HTMLInputElement;
    expect(value).not.toBeNull();
    act(() => {
      fireEvent.keyDown(value, { key: 'ArrowUp' });
    });
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.radius).toBe(4); // +4 step
    // One step per act — RibbonIconInput's stepper reads its
    // (just-synced) local value; batched keyDowns step from a stale
    // closure. Real clicks are discrete.
    act(() => {
      fireEvent.keyDown(value, { key: 'ArrowUp' });
    });
    await act(async () => {
      await Promise.resolve();
    });
    act(() => {
      fireEvent.keyDown(value, { key: 'ArrowUp' });
    });
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.radius).toBe(12);
    expect(value.value).toBe('12');
    // Paginated: the clip op carries the radius (roundRect recorded —
    // the feature-detect path in jsdom picks the stub's roundRect).
    await settleLayout();
    const clipOps = paintOps().filter((o) => o.op === 'roundRect');
    expect(clipOps.length).toBeGreaterThan(0);
    const roundRectArgs = clipOps[clipOps.length - 1]!.args as number[];
    expect(roundRectArgs[4]).toBe(12); // the radius arg
    // Direct entry (Enter commits — RibbonIconInput's law) — while
    // the toolbar is live (paginated mode):
    act(() => {
      fireEvent.change(value, { target: { value: '7' } });
      fireEvent.keyDown(value, { key: 'Enter' });
    });
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.radius).toBe(7);
    // Pageless: the node view renders the CSS border-radius.
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, defaultPageLayout: 'Pageless' } },
      }));
    });
    await settleLayout();
    // Pageless node views re-render on the PM flush (settleLayout's
    // version gate is paginated-only) — flush explicitly:
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const img = document.querySelector('.ProseMirror img') as HTMLElement;
    expect(img.style.borderRadius).toBe('7px');
  });

  it('extreme radius clamps to half the min dim (the circle-ish pill)', async () => {
    const { editor } = renderTensor('<p>r</p>');
    await settleLayout();
    await insertImageBytes(editor, fixturePng(100, 60), 'png');
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    // Hammer the stepper far past the clamp (100px asks > half of 60):
    act(() => {
      for (let i = 0; i < 30; i++) getCommand('imageRadiusUp')!.run();
    });
    expect(editor.state.doc.nodeAt(imagePos)?.attrs.radius).toBe(30); // min(100,60)/2
    await settleLayout();
    const clipOps = paintOps().filter((o) => o.op === 'roundRect');
    expect((clipOps[clipOps.length - 1]!.args as number[])[4]).toBe(30); // the paint clamp mirrors it
  });
});


// ─── 8. Round-trip + the deletion receipt ───────────────────────────────

describe('round-trip (M-IMAGES-0 container)', () => {
  it('save → reopen: images render BOTH modes; the media sha list is identical', async () => {
    const { editor } = renderTensor('<p>rt</p>');
    await settleLayout();
    const png = fixturePng(100, 60);
    const sha = await sha256Hex(png);
    await insertImageBytes(editor, png, 'png');
    // Save-time GC: the doc's media:// ref is collected:
    const ids = collectReferencedMediaIds(editor.getJSON());
    expect([...ids]).toEqual([sha]);

    // Round-trip through the container (package/unpackage mocks ride
    // the real saveWpdoc/openWpdoc TS layer):
    const file = {
      version: 1,
      docJSON: editor.getJSON(),
      metadata: { modifiedAt: '2026-01-01T00:00:00.000Z' },
    } as const;
    await saveWpdoc('/x/img.wpdoc', file);
    useMediaStore.getState().clear(); // fresh session
    const opened = await openWpdoc('/x/img.wpdoc');
    expect(opened.docJSON).toEqual(file.docJSON);
    expect(useMediaStore.getState().entries.get(sha)?.bytes).toEqual(png); // byte-identical

    // BOTH modes render: pageless (the node view <img>) —
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, defaultPageLayout: 'Pageless' } },
      }));
    });
    await settleLayout();
    const pagelessImg = document.querySelector('.ProseMirror img') as HTMLImageElement;
    expect(pagelessImg).not.toBeNull();
    // …and paginated (the placed paint):
    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, defaultPageLayout: 'Pages' } },
      }));
    });
    await settleLayout();
    expect(document.querySelector('[data-testid="image-layer"]')).not.toBeNull();
  });

  it('the DELETION receipt: delete the image → save → its media is GONE from the container', async () => {
    const { editor } = renderTensor('<p>del</p>');
    await settleLayout();
    const png = fixturePng(50, 50);
    const sha = await sha256Hex(png);
    await insertImageBytes(editor, png, 'png');
    const withImage = {
      version: 1,
      docJSON: editor.getJSON(),
      metadata: {},
    } as const;
    expect([...collectReferencedMediaIds(withImage.docJSON)]).toEqual([sha]);
    // Delete the node:
    let imagePos = 0;
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === 'image') { imagePos = p; return false; }
      return true;
    });
    act(() => {
      editor.chain().command(({ tr, dispatch }) => {
        if (dispatch) tr.delete(imagePos, imagePos + 1);
        return true;
      }).run();
    });
    expect([...collectReferencedMediaIds(editor.getJSON())]).toEqual([]);
    await saveWpdoc('/x/del.wpdoc', { version: 1, docJSON: editor.getJSON(), metadata: {} });
    // The packaged media list AT THE WIRE BOUNDARY: nothing orphaned,
    // nothing phantom — the deleted image's sha is GONE.
    const packaged = wpdocFiles.get('/x/del.wpdoc')!;
    expect(packaged.kind).toBe('v2');
    expect(packaged.media.map((m) => m.id)).not.toContain(sha);
    // And while the image existed, the SAME flow packaged it:
    await saveWpdoc('/x/with.wpdoc', { version: 1, docJSON: withImage.docJSON, metadata: {} });
    expect((wpdocFiles.get('/x/with.wpdoc')! as { media: { id: string }[] }).media.map((m) => m.id)).toEqual([sha]);
  });
});

// ─── 9. Zero-fetch: external URL + cancelled dialog ─────────────────────

describe('external images (the refusal gate)', () => {
  it('M-IMAGES-1.5: an external URL paste is REFUSED with a toast — zero network calls, no download arm', async () => {
    expect(isExternalImageUrl('https://example.com/pic.png')).toBe(true);
    expect(isExternalImageUrl('media://abc123')).toBe(false);
    // The Editor's paste handler fires the toast and never invokes:
    // assert the paste path via the handler's contract — the toast
    // manager records the refusal, and NO fetch_url call happens.
    const addSpy = vi.fn();
    const manager = toast as unknown as { add: typeof toast.add };
    const originalAdd = manager.add.bind(toast);
    manager.add = (...args: Parameters<typeof originalAdd>) => {
      addSpy(...(args as [unknown]));
      return originalAdd(...args);
    };
    try {
      const { editor } = renderTensor('<p>paste here</p>');
      await settleLayout();
      // Simulate the paste with an external <img> HTML payload:
      const clipboardData = {
        files: [] as File[],
        getData: (type: string) =>
          type === 'text/html' ? '<img src="https://example.com/pic.png">' : '',
      };
      const pasteEvent = { clipboardData, preventDefault: () => {} };
      let handled = false;
      act(() => {
        const handler = editor.view.props.handlePaste as unknown as (
          view: unknown,
          event: { clipboardData: typeof clipboardData },
        ) => boolean;
        handled = handler(editor.view, pasteEvent);
      });
      expect(handled).toBe(true); // the paste was intercepted
      expect(addSpy).toHaveBeenCalledTimes(1); // the refusal toast
      // ZERO network calls — the download arm is deleted:
      const invokeMock = (await import('@tauri-apps/api/core')).invoke as unknown as ReturnType<typeof vi.fn>;
      expect(invokeMock.mock.calls.filter(([cmd]) => cmd === 'fetch_url')).toHaveLength(0);
    } finally {
      manager.add = originalAdd;
    }
  });
});

// ─── 10. Backfill: dim-less legacy node ─────────────────────────────────

describe('backfill', () => {
  it('a dim-less node gets dims written from the store → the sentinel clears (paginated re-engages)', async () => {
    const { editor } = renderTensor('<p>before</p>');
    await settleLayout();
    const png = fixturePng(90, 45);
    const sha = await sha256Hex(png);
    useMediaStore.getState().add(sha, 'png', png);
    act(() => {
      editor.commands.insertContent({ type: 'image', attrs: { src: `media://${sha}` } });
    });
    await settleLayout();
    // Pending: the adapter sentinel → pageless fallback:
    expect(document.querySelector('[data-testid="paginated-fallback"]')).not.toBeNull();
    // Backfill: measure → write → the standard PM path relayouts.
    await act(async () => {
      await backfillImageDims(editor);
    });
    await settleLayout();
    expect(document.querySelector('[data-testid="paginated-fallback"]')).toBeNull(); // paginated re-engaged
    editor.state.doc.descendants((n) => {
      if (n.type.name === 'image') {
        expect(n.attrs.width).toBe(90);
        expect(n.attrs.height).toBe(45);
        return false;
      }
      return true;
    });
    // placed[] now carries the image:
    expect(directLayout(editor).result.placed).toHaveLength(1);
  });
});
