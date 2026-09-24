import { describe, it, expect, beforeEach } from 'vitest';
import { act } from '@testing-library/react';
import { useDocumentStore } from '@/lib/document/store';
import { renderTensorInScrollContainer, settleLayout } from './harness';

/**
 * M5.9 STEP 1 — synchronous-first relayout with the rAF coalescer as
 * pressure valve. Within one ~16ms frame:
 *   - The FIRST SYNC_BUDGET_PER_FRAME (2) transactions run SYNCHRONOUSLY
 *     (adapter+engine+commit inline with the input — 0 added latency).
 *   - Transactions beyond the budget defer to the rAF coalescer and
 *     coalesce into ONE deferred layout.
 * So 5 synchronous transactions → 2 sync + 1 coalesced = 3 total engine
 * layout calls. The coalescer-only path (all 5→1) was the M5.7 default;
 * the mutation check forces everything through rAF to prove the
 * deferred branch still works.
 */

function version(): number {
  return Number(
    (document.querySelector('[data-testid="paginated-stack"]') as HTMLElement).dataset
      .layoutVersion
  );
}

async function settle() {
  await settleLayout();
}

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
});

describe('M5.9 STEP 1: sync-first + coalesced overflow', () => {
  it('5 transactions in one frame → all sync (budget Infinity), one paint batch', async () => {
    const { editor } = renderTensorInScrollContainer('<p>coalescing test text</p>');
    await settle();
    const before = version();
    expect(Number.isFinite(before)).toBe(true);

    act(() => {
      for (let i = 0; i < 5; i++) {
        editor.view.dispatch(editor.state.tr.insertText(`${i}`, 1));
      }
    });
    await settle();

    // M5.12 STEP 3: budget = Infinity — every key processes in its
    // input event (no deferral, no stagger). 5 dispatches → 5 layouts.
    expect(version()).toBe(before + 5);
    // The LAST layout saw the LATEST doc state.
    expect(editor.state.doc.textContent).toContain('43210');
  });

  it('typing speed (separate frames) — each keystroke gets a synchronous layout', async () => {
    const { editor } = renderTensorInScrollContainer('<p>typed here</p>');
    await settle();
    const before = version();

    for (let i = 0; i < 3; i++) {
      act(() => {
        editor.view.dispatch(editor.state.tr.insertText('x', 1));
      });
      await settle();
    }

    // 3 separate frames, each within budget → 3 sync layouts.
    expect(version()).toBe(before + 3);
  });

  it('M5.9 STEP 2: keystroke → caret solid at new position in the input frame', async () => {
    const { editor } = renderTensorInScrollContainer('<p>hello world</p>');
    await settle();

    // Dispatch a keystroke; the caret should appear immediately (solid,
    // not blinking — blink starts after 500ms idle).
    act(() => {
      editor.commands.setTextSelection(3);
    });
    await settle();

    const caret = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(caret).not.toBeNull();
    // Solid: no .tensor-caret-blinking class.
    expect(caret.className).not.toContain('tensor-caret-blinking');
    expect(caret.className).toContain('tensor-caret');

    // After 600ms idle, blinking starts.
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    const blinking = document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement;
    expect(blinking?.className).toContain('tensor-caret-blinking');
  });

  it('M5.9 STEP 2: non-collapsed selection hides the caret; collapsed shows it', async () => {
    const { editor } = renderTensorInScrollContainer('<p>hello world</p>');
    await settle();

    // Collapsed: caret visible.
    act(() => {
      editor.commands.setTextSelection(3);
    });
    await settle();
    expect(document.querySelector('[data-testid="synthetic-caret"]')).not.toBeNull();

    // Non-collapsed: no caret.
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 5 });
    });
    await settle();
    expect(document.querySelector('[data-testid="synthetic-caret"]')).toBeNull();
  });
});