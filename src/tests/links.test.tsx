import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act, fireEvent } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensorInScrollContainer, GEOMETRY, mockRects, settleLayout } from './harness';

vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn().mockResolvedValue(undefined),
}));

import { openUrl } from '@tauri-apps/plugin-opener';

/**
 * Links in the paginated tree: the LinkBubble mounts with
 * PAINTED-rect anchors (L3), Ctrl/Cmd+click on a painted link opens it,
 * plain click places the caret (the committed legacy rule).
 */

const CB = GEOMETRY.contentX;
const CY = GEOMETRY.contentY;

const wrapper = () => document.querySelector('[data-testid="paginated-zoom-wrapper"]') as HTMLElement;

async function settle() {
  await settleLayout();
}

beforeEach(() => {
  vi.clearAllMocks();
  useDocumentStore.getState().setPageInfo(1, 1);
});

describe('painted links', () => {
  it('plain click on a link places the caret; Ctrl+click opens via plugin-opener', async () => {
    const { editor } = renderTensorInScrollContainer(
      '<p><a href="https://tensor.dev">link text here</a> tail</p>'
    );
    await settle();

    // Plain click at char 4 of "link text here": caret, no open.
    fireEvent.mouseDown(wrapper(), { clientX: CB + 35, clientY: CY + 8 });
    await settle();
    expect(openUrl).not.toHaveBeenCalled();
    expect(editor.state.selection.head).toBe(5);

    // Ctrl+click inside the link: opens, selection untouched.
    vi.clearAllMocks();
    fireEvent.mouseDown(wrapper(), { clientX: CB + 45, clientY: CY + 8, ctrlKey: true });
    await settle();
    expect(openUrl).toHaveBeenCalledWith('https://tensor.dev');

    // Ctrl+click OUTSIDE any link: no open, no crash.
    vi.clearAllMocks();
    fireEvent.mouseDown(wrapper(), { clientX: CB + 210, clientY: CY + 8, ctrlKey: true });
    await settle();
    expect(openUrl).not.toHaveBeenCalled();
  });

  it('the link bubble mounts at painted coords when the caret enters a link', async () => {
    renderTensorInScrollContainer('<p><a href="https://tensor.dev">link text</a> tail</p>');
    await settle();
    mockRects(100, { top: 0, bottom: 800 }); // stack top 100 (left pinned 0)

    const { editor } = { editor: useDocumentStore.getState().editor! };
    act(() => {
      editor.commands.setTextSelection(3); // inside the link text
    });
    await settle();
    const bubble = document.querySelector('[data-link-bubble]') as HTMLElement;
    expect(bubble).not.toBeNull();
    // Pinned rects: caret at stack (96, 96); the anchor is the caret
    // line BOTTOM (100 + 96 + 16 = 212) + LinkBubble's own +4px.
    expect(bubble.style.top).toBe('216px');
    expect(bubble.style.left).toBe('96px');
  });
});