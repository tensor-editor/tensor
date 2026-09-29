import { render, act } from '@testing-library/react';
import type { ReactElement } from 'react';
import { Editor } from '@/components/editor/Editor';
import { useDocumentStore } from '@/lib/document/store';
import { FakeMetrics } from './fakeMetrics';

/** Renders the REAL production <Editor/> (tensorExtensions, mode routing,
 * PaginatedView) with deterministic FakeMetrics injected through the
 * metrics seam, optionally replacing the document content. */
export function renderTensor(initialHTML?: string) {
  const utils = render(<Editor metrics={FakeMetrics} />);
  const editor = useDocumentStore.getState().editor;
  if (!editor) throw new Error('editor not in document store after render');
  if (initialHTML) {
    act(() => {
      editor.commands.setContent(initialHTML);
    });
  }
  return { editor, ...utils };
}

/** Renders <Editor/> inside the app-shaped scroll container (App.tsx's
 * `absolute inset-0 overflow-auto`), for scroll-behavior assertions. */
export function renderTensorInScrollContainer(initialHTML?: string) {
  let utils: ReturnType<typeof render> | null = null;
  const el: ReactElement = (
    <div
      data-testid="scroll-container"
      // overflowY as an explicit longhand so jsdom's getComputedStyle
      // (used by getScrollParent) reliably reports it — shorthand
      // expansion for inline styles is inconsistent there.
      style={{ overflow: 'auto', overflowY: 'auto', height: 400, width: 900 }}
    >
      <Editor metrics={FakeMetrics} />
    </div>
  );
  utils = render(el);
  const editor = useDocumentStore.getState().editor;
  if (!editor) throw new Error('editor not in document store after render');
  if (initialHTML) {
    act(() => {
      editor.commands.setContent(initialHTML);
    });
  }
  return { editor, ...utils };
}

/** Content width/height numbers under FakeMetrics + default Letter setup. */
export const GEOMETRY = {
  pageWidth: 816,
  pageHeight: 1056,
  contentX: 96,
  contentY: 96,
  contentWidth: 624,
  contentHeight: 864,
  charsPerLine: 62,
  linesPerPage: 54,
} as const;

/** jsdom lays out nothing — pin the two rects geometry math reads. */
export function mockRects(stackTop: number, deskRect: { top: number; bottom: number }) {
  const stack = document.querySelector('[data-testid="paginated-stack"]') as HTMLElement;
  const deskEl = document.querySelector('[data-testid="scroll-container"]') as HTMLElement;
  stack.getBoundingClientRect = () =>
    ({ top: stackTop, left: 0, right: 816, bottom: stackTop + 2176, width: 816, height: 2176, x: 0, y: stackTop, toJSON: () => ({}) }) as DOMRect;
  deskEl.getBoundingClientRect = () =>
    ({ top: deskRect.top, left: 0, right: 900, bottom: deskRect.bottom, width: 900, height: deskRect.bottom - deskRect.top, x: 0, y: deskRect.top, toJSON: () => ({}) }) as DOMRect;
  return { stack, desk: deskEl };
}

/** Capture scrollTop writes (jsdom's has no layout to move). */
export function captureScroll(el: HTMLElement): { read: () => number } {
  let value = 0;
  Object.defineProperty(el, 'scrollTop', {
    get: () => value,
    set: (v: number) => {
      value = v;
    },
    configurable: true,
  });
  return { read: () => value };
}

/** jsdom-safe clipboard/composition event with a pinned payload. */
export function dataEvent(type: string, payload: { clipboardData?: DataTransfer; data?: string }): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  if (payload.clipboardData !== undefined) {
    Object.defineProperty(ev, 'clipboardData', { value: payload.clipboardData });
  }
  if (payload.data !== undefined) {
    Object.defineProperty(ev, 'data', { value: payload.data });
  }
  return ev;
}

/**
 * Version-stability settle — waits until the engine's
 * layout version (data-layout-version on the stack) stops advancing for
 * two consecutive microtask+timeout cycles, or times out. Works
 * identically under the synchronous-first path (immediate) and the
 * coalesced rAF path (one extra frame). Replaces the fixed 20ms
 * timeouts the old coalescer forced onto the suite.
 */
export async function settleLayout(timeoutMs = 200): Promise<void> {
  const version = () =>
    (document.querySelector('[data-testid="paginated-stack"]') as HTMLElement | null)
      ?.dataset.layoutVersion ?? null;

  await act(async () => {
    const deadline = performance.now() + timeoutMs;
    let last = version();
    for (;;) {
      await new Promise((r) => setTimeout(r, 16));
      const now = version();
      if (now === last && now !== null) return; // stabilized
      last = now;
      if (performance.now() > deadline) return; // timeout — best effort
    }
  });
}