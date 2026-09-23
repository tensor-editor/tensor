import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { act } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensorInScrollContainer, GEOMETRY } from './harness';

/**
 * M5.6 STEP 1 — virtualization: canvases mount only for visible pages
 * ± 1 buffer (IntersectionObserver on the always-mounted sheets), and
 * STEP 6 — the status bar's current page is VIEWPORT based. Structural
 * assertions, not ms thresholds. The jsdom IO stub (setup.ts) fires
 * everything as visible by default; these tests disable auto-fire and
 * drive the observer by hand.
 */

const fullPage = `<p>${'a'.repeat(GEOMETRY.charsPerLine * GEOMETRY.linesPerPage)}</p>`;
const fivePageDoc = fullPage.repeat(5);

type IOStub = {
  instances: Array<{ callback: (entries: unknown[], observer: unknown) => void }>;
  auto: boolean;
};

function io(): IOStub {
  return (globalThis as unknown as { __IO: IOStub }).__IO;
}

function fire(entries: Array<{ pageIndex: number; ratio: number }>) {
  for (const inst of io().instances) {
    act(() => {
      inst.callback(
        entries.map(({ pageIndex, ratio }) => ({
          target: document.querySelector(`[data-page-index="${pageIndex}"]`),
          isIntersecting: ratio > 0,
          intersectionRatio: ratio,
        })),
        inst,
      );
    });
  }
}

const canvasesOn = (pageIndex: number) =>
  document.querySelector(`[data-page-index="${pageIndex}"]`)?.querySelectorAll('canvas').length ?? 0;

const allCanvases = () => document.querySelectorAll('canvas').length;

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  io().auto = false;
  io().instances.length = 0;
});

afterEach(() => {
  io().auto = true;
});

describe('M5.6 STEP 1: virtualization', () => {
  it('canvases mount only for visible ± 1 buffer pages; sheets always mount', async () => {
    const { editor } = renderTensorInScrollContainer(fivePageDoc);
    await act(async () => {});
    expect(document.querySelectorAll('[data-page-index]')).toHaveLength(5); // sheets: always
    // Before the first IO report, everything mounts (first-paint parity).
    expect(allCanvases()).toBe(5);

    // Viewport shows page 2 (index) most: canvases on 1, 2, 3 only.
    fire([{ pageIndex: 2, ratio: 0.9 }]);
    await act(async () => {});
    expect(canvasesOn(0)).toBe(0);
    expect(canvasesOn(1)).toBe(1);
    expect(canvasesOn(2)).toBe(1);
    expect(canvasesOn(3)).toBe(1);
    expect(canvasesOn(4)).toBe(0);
    expect(allCanvases()).toBeLessThanOrEqual(3 * 1); // (visible + buffer) × blocks/page
    expect(document.querySelectorAll('[data-page-index]')).toHaveLength(5); // sheets stay

    // Scroll to the last page: page 2 leaves the viewport, page 4
    // enters — the observer reports both events.
    fire([
      { pageIndex: 2, ratio: 0 },
      { pageIndex: 4, ratio: 0.8 },
    ]);
    await act(async () => {});
    expect(canvasesOn(1)).toBe(0);
    expect(canvasesOn(3)).toBe(1);
    expect(canvasesOn(4)).toBe(1);
    expect(allCanvases()).toBeLessThanOrEqual(2 * 1);
    expect(editor.state.doc.textContent.length).toBeGreaterThan(0); // model untouched
  });
});

describe('M5.6 STEP 6: viewport-based current page', () => {
  it('the highest-ratio sheet is the status bar page, not the caret page', async () => {
    renderTensorInScrollContainer(fivePageDoc);
    await act(async () => {});
    fire([{ pageIndex: 3, ratio: 0.9 }]);
    await act(async () => {});
    expect(useDocumentStore.getState().currentPage).toBe(4); // 1-based
    expect(useDocumentStore.getState().pageCount).toBe(5);
    // Typing at the doc end (page 5, caret there) must NOT move the
    // status bar away from the viewport page 4.
    act(() => {
      const editor = useDocumentStore.getState().editor!;
      editor.commands.setTextSelection(editor.state.doc.content.size);
    });
    await act(async () => {});
    expect(useDocumentStore.getState().currentPage).toBe(4);
  });
});

describe('M5.6 STEP 3: dirty-block repaint', () => {
  it('a mid-doc keystroke repaints only the edited block (paint-ops proof)', async () => {
    const { editor } = renderTensorInScrollContainer('<p>one</p><p>two</p><p>three</p>');
    await act(async () => {});
    expect(document.querySelectorAll('canvas')).toHaveLength(3);

    const ops = () => (globalThis as { __paintOps?: Array<{ op: string; args: unknown[] }> }).__paintOps ?? [];
    act(() => {
      editor.commands.setTextSelection(7); // inside 'two'
      editor.commands.insertContent('X');
    });
    ops().length = 0; // clear: everything mounted and painted already
    // Any repaint now would be from a block re-painting; re-render alone
    // must not record ops (the dirty-skip + memo hold).
    await act(async () => {
      editor.commands.setTextSelection(8);
    });
    expect(ops().length).toBe(0); // selection change: no block repaint

    act(() => {
      editor.commands.insertContent('Y'); // edit 'two' -> 'tXYwo'
    });
    await act(async () => {});
    const texts = ops().filter((o) => o.op === 'fillText').map((o) => o.args[0]);
    expect(texts).toEqual(['tXYwo']); // ONLY the edited block repainted
  });
});
