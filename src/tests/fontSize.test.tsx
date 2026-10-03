import { describe, it, expect, beforeEach } from 'vitest';
import { render, fireEvent, act } from '@testing-library/react';
import type { Editor } from '@tiptap/core';
import { FontSizeInput } from '@/components/layout/ribbon/home/FontSizeInput';
import {
  FONT_STEP_PT,
  fontPxToDisplayPt,
  fontPtToPx,
  stepFontSize,
} from '@/lib/editor/fontSize';
import { matchesShortcut, getEffectiveKeybinding, SHORTCUTS } from '@/lib/shortcuts';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { useConfigStore } from '@/lib/config/store';
import { renderTensor } from './harness';
import { settleLayout } from './harness';

const BASE = { fontFamily: 'fake', fontSize: 16 };

beforeEach(() => {
  // The config store persists across tests (module singleton) — pin
  // the px default the stepping math falls back to.
  useConfigStore.setState((state) => ({
    config: { ...state.config, editor: { ...state.config.editor, defaultFontSize: 16 } },
  }));
});

// ─── Chrome conversion rule (pt at the chrome, px in the core) ────────────

describe('font-size pt↔px conversion', () => {
  it('display: px × 0.75, rounded — 16px shows "12"', () => {
    expect(fontPxToDisplayPt(16)).toBe(12);
    expect(fontPxToDisplayPt(19)).toBe(14); // 14.25 → 14
    expect(fontPxToDisplayPt(17)).toBe(13); // 12.75 → 13
  });

  it('commit: pt × 4/3, rounded — entering "12" writes 16px', () => {
    expect(fontPtToPx(12)).toBe(16);
    expect(fontPtToPx(14)).toBe(19); // 18.67 → 19
  });

  it('common sizes round-trip exactly: 12pt→16px→12pt', () => {
    expect(fontPxToDisplayPt(fontPtToPx(12))).toBe(12);
    expect(fontPxToDisplayPt(fontPtToPx(14))).toBe(14);
  });

  it('the step increment is 2pt in chrome space', () => {
    expect(FONT_STEP_PT).toBe(2);
  });
});

// ─── The Font Size box ────────────────────────────────────────────────────

function mockEditor() {
  const committed: string[] = [];
  const chain = {
    focus: () => chain,
    setFontSize: (v: string) => {
      committed.push(v);
      return chain;
    },
    run: () => true,
  };
  return {
    editor: { chain: () => chain } as unknown as Editor,
    committed,
  };
}

describe('FontSizeInput (pt chrome, px core)', () => {
  it('16px shows "12" in the box', () => {
    const { editor } = mockEditor();
    const { container } = render(<FontSizeInput editor={editor} currentSize="16px" />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('12');
  });

  it('the config default (px) displays as pt too', () => {
    const { editor } = mockEditor();
    const { container } = render(<FontSizeInput editor={editor} currentSize="16" />);
    expect((container.querySelector('input') as HTMLInputElement).value).toBe('12');
  });

  it('entering "12" commits setFontSize("16px") — the core stays px', () => {
    const { editor, committed } = mockEditor();
    const { container } = render(<FontSizeInput editor={editor} currentSize="16px" />);
    const input = container.querySelector('input')!;
    act(() => {
      fireEvent.change(input, { target: { value: '12' } });
    });
    act(() => {
      fireEvent.blur(input);
    });
    expect(committed).toEqual(['16px']);
  });

  it('the tickers step by 2pt: 12 → 14 → commit 19px, back down to 16px', () => {
    const { editor, committed } = mockEditor();
    const { container } = render(<FontSizeInput editor={editor} currentSize="16px" />);
    const buttons = container.querySelectorAll('button');
    act(() => {
      fireEvent.click(buttons[0]!); // up chevron: 12pt + 2 = 14pt → round(18.67) = 19px
    });
    expect(committed).toEqual(['19px']);
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input.value).toBe('14');
    act(() => {
      fireEvent.click(buttons[1]!); // down chevron: 14pt − 2 = 12pt → 16px
    });
    expect(committed).toEqual(['19px', '16px']);
  });
});

// ─── Stepping on a real editor (the shared ±2pt law) ─────────────────────

describe('stepFontSize', () => {
  it('16px ↑2pt → 19px, ↓2pt back → 16px (mark attr stays a px string)', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.setFontSize('16px');
    });

    act(() => {
      expect(stepFontSize(editor, 1)).toBe(true);
    });
    expect(editor.getAttributes('textStyle').fontSize).toBe('19px');

    act(() => {
      expect(stepFontSize(editor, -1)).toBe(true);
    });
    expect(editor.getAttributes('textStyle').fontSize).toBe('16px');

    // Core/persistence round-trip in px: the mark attr, the doc JSON,
    // and the adapter all stay px.
    const mark = editor.state.doc.resolve(1).marks().find((m) => m.type.name === 'textStyle');
    expect(mark?.attrs.fontSize).toBe('16px');
    expect(editor.getJSON().content![0]!.content![0]!.marks![0]!.attrs!.fontSize).toBe('16px');
    const adapted = pmDocToSemantic(editor.state.doc, BASE);
    expect((adapted.doc.blocks[0] as { runs: { style: { fontSize: number } }[] }).runs[0]!.style.fontSize).toBe(16);
  });

  it('unmarked text steps from the config default (16px → 19px)', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      stepFontSize(editor, 1);
    });
    expect(editor.getAttributes('textStyle').fontSize).toBe('19px');
  });
});

// ─── Shortcuts: registry, matcher aliases, live dispatch ─────────────────

describe('font-size shortcuts', () => {
  it('registered: ctrl+shift+. up, ctrl+shift+, down (editor context)', () => {
    const up = SHORTCUTS.find((s) => s.id === 'fontSizeUp')!;
    const down = SHORTCUTS.find((s) => s.id === 'fontSizeDown')!;
    expect(up.keys).toBe('ctrl+shift+.');
    expect(down.keys).toBe('ctrl+shift+,');
    expect(up.context).toBe('editor');
    expect(getEffectiveKeybinding({}, 'fontSizeUp')).toBe('ctrl+shift+.');
  });

  it('matchesShortcut: shift produces the shifted glyph — both spellings match', () => {
    const period = { ctrlKey: true, shiftKey: true, altKey: false, metaKey: false } as KeyboardEvent;
    // Registry spelling (unshifted) matches the shifted event glyph:
    expect(matchesShortcut({ ...period, key: '>' } as KeyboardEvent, 'ctrl+shift+.')).toBe(true);
    expect(matchesShortcut({ ...period, key: '<' } as KeyboardEvent, 'ctrl+shift+,')).toBe(true);
    // Recorded spelling (shifted glyph) matches an unshifted-key layout:
    expect(matchesShortcut({ ...period, key: '.' } as KeyboardEvent, 'ctrl+shift+>')).toBe(true);
    expect(matchesShortcut({ ...period, key: ',' } as KeyboardEvent, 'ctrl+shift+<')).toBe(true);
    // And the direct recorded spelling still matches itself:
    expect(matchesShortcut({ ...period, key: '>' } as KeyboardEvent, 'ctrl+shift+>')).toBe(true);
    // No cross-talk:
    expect(matchesShortcut({ ...period, key: '<' } as KeyboardEvent, 'ctrl+shift+.')).toBe(false);
    // Letters unaffected:
    expect(matchesShortcut({ ...period, key: 'X' } as KeyboardEvent, 'ctrl+shift+x')).toBe(true);
  });

  it('live: ctrl+shift+. dispatch grows the selection by 2pt', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.setFontSize('16px');
    });
    const viewDom = editor.view.dom;
    act(() => {
      viewDom.dispatchEvent(
        new KeyboardEvent('keydown', { key: '>', ctrlKey: true, shiftKey: true, bubbles: true })
      );
    });
    expect(editor.getAttributes('textStyle').fontSize).toBe('19px');
    act(() => {
      viewDom.dispatchEvent(
        new KeyboardEvent('keydown', { key: '<', ctrlKey: true, shiftKey: true, bubbles: true })
      );
    });
    expect(editor.getAttributes('textStyle').fontSize).toBe('16px');
  });
});

// ─── Data boundary: the adapter converts pt attrs to core px ──────────────

describe('adapter font-size/line-height pt paths', () => {
  it('a pasted fontSize "12pt" attr lands in the core as 16px; "18pt" line-height → multiplier 1.5', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.updateAttributes('textStyle', { fontSize: '12pt' });
      editor.commands.updateAttributes('paragraph', { lineHeight: '18pt' });
    });
    const adapted = pmDocToSemantic(editor.state.doc, BASE);
    // 12pt × 4/3 = 16px in the core; line-height 18pt at 16px = 1.5.
    const run0 = (adapted.doc.blocks[0] as { runs: { style: { fontSize: number; lineHeight: number } }[] }).runs[0]!;
    expect(run0.style.fontSize).toBe(16);
    expect(run0.style.lineHeight).toBe(1.5);
  });
});
