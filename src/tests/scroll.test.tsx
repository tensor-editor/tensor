import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { TextSelection } from '@tiptap/pm/state';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';
import { renderTensorInScrollContainer, mockRects, captureScroll, GEOMETRY } from './harness';
import { settleLayout } from './harness';

/**
 * M4.2 STEP 4 — scroll policy, exact deltas. jsdom lays out nothing, so
 * the two inputs the scroll math reads (stack rect, scroller rect) are
 * mocked per test with KNOWN numbers, and scrollTop is captured through a
 * defineProperty backing variable (jsdom's scrollTop has no layout to
 * move anyway). All caret geometry is real: FakeMetrics tiling (62
 * chars/line, 16px lines, 54 lines/page) through the production
 * PaginatedView, so the deltas below are computed by the code under test,
 * then asserted by hand arithmetic.
 */

// Two 54-line paragraphs: block A fills page 1 exactly (54*16 = 864 =
// content height), block B starts page 2.
const fullPageParagraph = `<p>${'a'.repeat(GEOMETRY.charsPerLine * GEOMETRY.linesPerPage)}</p>`;
const twoPageDoc = fullPageParagraph + fullPageParagraph;

// Stack-local geometry under FakeMetrics + default Letter setup:
// contentY = 96, page stride = 1056+32 = 1088, caret height = 16,
// CARET_SCROLL_PAD_PX = 16. Deltas below are hand-computed from these.
// mockRects/captureScroll live in the shared harness.

/** PM caret-motion intent: selection change + PM's own scrollIntoView flag. */
function moveCaret(editor: ReturnType<typeof renderTensorInScrollContainer>['editor'], pos: number) {
  act(() => {
    editor.view.dispatch(
      editor.state.tr.setSelection(TextSelection.create(editor.state.doc, pos)).scrollIntoView()
    );
  });
}

/** Real typing shape: insert text (selection follows) + PM's intent flag. */
function typeAt(editor: ReturnType<typeof renderTensorInScrollContainer>['editor'], pos: number) {
  act(() => {
    editor.view.dispatch(editor.state.tr.insertText('x', pos).scrollIntoView());
  });
}

function blockStart(editor: ReturnType<typeof renderTensorInScrollContainer>['editor'], which: 0 | 1) {
  let found = -1;
  let index = 0;
  editor.state.doc.forEach((node, offset) => {
    if (node.type.name === 'paragraph' && index === which) found = offset;
    if (node.type.name === 'paragraph') index += 1;
  });
  return found + 1; // first text position inside the paragraph
}

async function settle() {
  await settleLayout();
}

beforeEach(() => {
  // Intra-file isolation: tests mutate pageSetup (d) and zoom (e) — the
  // hardcoded deltas below assume the Letter/100% defaults.
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
  });
  useConfigStore.setState((state) => ({
    config: { ...state.config, editor: { ...state.config.editor, zoomLevel: 100 } },
  }));
});

describe('M4.2 scroll policy (minimal-edge caret-follow)', () => {
  it('a. REGRESSION PIN: caret visible, typing at a page boundary -> scrollTop byte-identical', async () => {
    const { editor } = renderTensorInScrollContainer(twoPageDoc);
    await settle();
    const b0 = blockStart(editor, 0);

    // Desk tall enough that BOTH boundary carets are comfortably visible —
    // and stay visible through the reflow typing at the boundary causes.
    const { desk } = mockRects(0, { top: 0, bottom: 1300 });
    const scroll = captureScroll(desk);
    act(() => {
      desk.scrollTop = 100;
    });
    expect(scroll.read()).toBe(100);

    // Last line of page 1 (line 53 of block A): caret bottom = 96+53*16+16 = 960.
    const lastLinePage1 = b0 + 1 + 53 * GEOMETRY.charsPerLine;
    moveCaret(editor, lastLinePage1);
    expect(scroll.read()).toBe(100); // visible: no scroll on caret motion either
    typeAt(editor, editor.state.selection.head);
    expect(scroll.read()).toBe(100); // PIN: typing at the boundary moved nothing

    // First line of page 2 (block B): recompute B's position fresh — the
    // first insert grew block A by one char and shifted every later
    // offset. After the boundary reflow, block B's line 0 sits at
    // stack-local y = 1088+96+16; its caret bottom (1216) is still well
    // inside the padded viewport.
    const b1Now = blockStart(editor, 1);
    moveCaret(editor, b1Now);
    expect(scroll.read()).toBe(100);
    typeAt(editor, editor.state.selection.head);
    expect(scroll.read()).toBe(100); // PIN
  });

  it('b. caret below viewport + scroll-requesting transaction -> exact minimal delta', async () => {
    const { editor } = renderTensorInScrollContainer(twoPageDoc);
    await settle();
    const b1 = blockStart(editor, 1);

    const { desk } = mockRects(0, { top: 0, bottom: 400 });
    const scroll = captureScroll(desk);

    moveCaret(editor, b1); // page 2, line 0: top=1184, bottom=1200
    // delta = caretBottom + PAD - viewportBottom = 1200 + 16 - 400 = 816
    expect(scroll.read()).toBe(816);
  });

  it('c. caret above viewport (scrolled past it) -> exact minimal upward delta', async () => {
    const { editor } = renderTensorInScrollContainer(twoPageDoc);
    await settle();
    const b0 = blockStart(editor, 0);

    // Desk scrolled down: stack top at -2000 (page 1 is far above).
    const { desk } = mockRects(-2000, { top: 0, bottom: 400 });
    const scroll = captureScroll(desk);
    act(() => {
      desk.scrollTop = 2000;
    });

    moveCaret(editor, b0); // page 1, line 0: viewport top = -2000+96 = -1904
    // delta = -(viewportTop + PAD - caretTop) = -(0 + 16 - (-1904)) = -1920
    expect(scroll.read()).toBe(80);
  });

  it('d. layout churn WITHOUT caret motion -> no scroll, ever', async () => {
    const { editor } = renderTensorInScrollContainer(twoPageDoc);
    await settle();
    const b0 = blockStart(editor, 0);
    moveCaret(editor, b0 + 5); // somewhere stable
    const { desk } = mockRects(0, { top: 0, bottom: 1300 });
    const scroll = captureScroll(desk);
    act(() => {
      desk.scrollTop = 333;
    });

    // Churn 1: pageSetup flip (store-driven relayout, no PM transaction).
    act(() => {
      const { pageSetup, setPageSetup } = useDocumentStore.getState();
      setPageSetup({ ...pageSetup, pageSize: 'A4' });
    });
    await settle();
    expect(scroll.read()).toBe(333);

    // Churn 2: a PM transaction WITHOUT the scrollIntoView intent flag.
    act(() => {
      editor.view.dispatch(editor.state.tr.insertText('q'));
    });
    await settle();
    expect(scroll.read()).toBe(333);
  });

  it('e. zoom 150% -> the x-zoom share holds (exact deltas, and no-scroll case)', async () => {
    const { editor } = renderTensorInScrollContainer(twoPageDoc);
    await settle();
    const b1 = blockStart(editor, 1);
    const b0 = blockStart(editor, 0);

    act(() => {
      useConfigStore.setState((state) => ({
        config: { ...state.config, editor: { ...state.config.editor, zoomLevel: 150 } },
      }));
    });
    await settle();

    // Caret page 2 line 0 at z=1.5: top = 1184*1.5 = 1776, bottom = 1800.
    const { desk } = mockRects(0, { top: 0, bottom: 800 });
    const scroll = captureScroll(desk);
    moveCaret(editor, b1);
    // delta = 1800 + 16 - 800 = 1016 (the x1.5 is load-bearing)
    expect(scroll.read()).toBe(1016);

    // Visible at 150%: caret page 1 line 0 -> top = 96*1.5 = 144, bottom
    // = 168, far inside [0+16, 1000-16] -> untouched.
    const { desk: desk2 } = mockRects(0, { top: 0, bottom: 1000 });
    const scroll2 = captureScroll(desk2);
    act(() => {
      desk2.scrollTop = 50;
    });
    moveCaret(editor, b0);
    expect(scroll2.read()).toBe(50);
  });
});