import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { Editor } from '@/components/editor/Editor';
import { DisplayModeGroup } from '@/components/layout/ribbon/view/groups/DisplayModeGroup';
import { PageSetupGroup } from '@/components/layout/ribbon/layout/groups/PageSetupGroup';
import { useConfigStore } from '@/lib/config/store';
import { useDocumentStore } from '@/lib/document/store';
import { useDocumentPropertiesStore } from '@/lib/document/propertiesStore';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';
import { FakeMetrics } from './fakeMetrics';
import { settleLayout } from './harness';

// The mode toggle + its Layout-tab consequences. The ribbon groups are
// rendered DIRECTLY (they are store-driven and propless): tab-chrome
// activation is Base UI pointer-event machinery jsdom can't fire, and
// the wiring under test is button -> config store -> Editor routing
// and button disabled states — none of which the Tabs add.

const button = (label: string) =>
  document.querySelector(`button[aria-label="${label}"]`) as HTMLButtonElement | null;

beforeEach(() => {
  useDocumentStore.getState().setPageInfo(1, 1);
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
  });
  useDocumentPropertiesStore.setState({ marginsIsOpen: false, customSizeIsOpen: false });
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

/** The editor + the two ribbon groups whose interaction is under test. */
function harness(initialHTML?: string) {
  const utils = render(
    <>
      <Editor metrics={FakeMetrics} />
      <DisplayModeGroup />
      <PageSetupGroup />
    </>
  );
  const editor = useDocumentStore.getState().editor;
  if (!editor) throw new Error('editor not in store after render');
  if (initialHTML) {
    act(() => {
      editor.commands.setContent(initialHTML);
    });
  }
  return { editor, ...utils };
}

describe('View > Paginated / Pageless toggle', () => {
  it('flips the mode: paginated surface -> pageless surface -> back', async () => {
    const { editor } = harness('<p>hello world</p>');
    await settle();

    // PAGINATED (default): the engine-driven surface with sheets.
    expect(document.querySelector('[data-testid="paginated-root"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="pageless-surface"]')).toBeNull();

    const toggle = button('Paginated / Pageless')!;
    expect(toggle).not.toBeNull();
    // Active when paginated (GDocs' Print Layout convention).
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      fireEvent.click(toggle);
    });
    await settle();

    expect(useConfigStore.getState().config.editor.defaultPageLayout).toBe('Pageless');
    expect(document.querySelector('[data-testid="paginated-root"]')).toBeNull();
    expect(document.querySelector('[data-testid="pageless-surface"]')).not.toBeNull();

    act(() => {
      fireEvent.click(button('Paginated / Pageless')!);
    });
    await settle();

    expect(useConfigStore.getState().config.editor.defaultPageLayout).toBe('Pages');
    expect(document.querySelector('[data-testid="paginated-root"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="pageless-surface"]')).toBeNull();
    void editor;
  });

  it('the document survives the mode flip (one PM instance, content intact)', async () => {
    const { editor } = harness('<p>the words stay</p>');
    await settle();
    const before = editor.state.doc;

    act(() => {
      fireEvent.click(button('Paginated / Pageless')!);
    });
    await settle();

    // Same editor instance (the mode routes the VIEW, never rebuilds
    // the document), and pageless shows the content.
    expect(useDocumentStore.getState().editor).toBe(editor);
    expect(document.querySelector('.ProseMirror')!.textContent).toContain('the words stay');
    expect(before.textContent).toContain('the words stay');

    // Typing still works in pageless (the visible surface is the
    // editing surface).
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1);
      editor.commands.insertContent('!');
    });
    expect(document.querySelector('.ProseMirror')!.textContent).toContain('the words stay!');
  });
});

describe('Layout tab page-geometry controls in pageless mode', () => {
  it('pageless: Paper Size / Orientation / Margins disabled; Page Background stays live', async () => {
    harness('<p>hello world</p>');
    await settle();

    // Paginated: everything live.
    expect(button('Margins')!.disabled).toBe(false);
    expect(button('Orientation')!.disabled).toBe(false);
    expect(button('Paper Size')).not.toBeNull();

    act(() => {
      fireEvent.click(button('Paginated / Pageless')!);
    });
    await settle();

    // Pageless: the page-geometry controls are disabled, NOT removed.
    expect(button('Margins')!.disabled).toBe(true);
    expect(button('Orientation')!.disabled).toBe(true);
    expect(button('Paper Size')!.disabled).toBe(true);
    expect(button('Page Background')!.disabled).toBe(false);
    expect(button('Page Background options')!.disabled).toBe(false);

    // Toggling back re-enables them.
    act(() => {
      fireEvent.click(button('Paginated / Pageless')!);
    });
    await settle();
    expect(button('Margins')!.disabled).toBe(false);
    expect(button('Orientation')!.disabled).toBe(false);
    expect(button('Paper Size')!.disabled).toBe(false);
  });

  it('pageless: a disabled Margins button opens nothing (the guard holds)', async () => {
    harness('<p>hello world</p>');
    await settle();
    act(() => {
      fireEvent.click(button('Paginated / Pageless')!);
    });
    await settle();

    // jsdom happily "clicks" disabled buttons via .click(), but React
    // never fires the handler — pin that the dialog stays closed even
    // under a forced dispatch.
    button('Margins')!.click();
    expect(useDocumentPropertiesStore.getState().marginsIsOpen).toBe(false);
  });
});

describe('Page Background in pageless mode', () => {
  it('picking a color through the Layout button paints the pageless surface', async () => {
    harness('<p>hello world</p>');
    await settle();

    act(() => {
      fireEvent.click(button('Paginated / Pageless')!);
    });
    await settle();

    const surface = document.querySelector('[data-testid="pageless-surface"]') as HTMLElement;
    expect(surface).not.toBeNull();
    expect(surface.style.background).toBe(''); // no color set yet

    // Open the palette (the chevron) and pick a swatch — the real
    // user path in pageless mode.
    act(() => {
      fireEvent.click(button('Page Background options')!);
    });
    const swatch = document.querySelector('button[aria-label="#dc2626"]') as HTMLElement;
    expect(swatch).not.toBeNull();
    act(() => {
      fireEvent.click(swatch);
    });
    await settle();

    // ONE setting, TWO surfaces: the store holds the color, and the
    // pageless surface paints it (paginated sheets paint the same
    // value — pinned in carryovers.test.tsx).
    expect(useDocumentStore.getState().pageSetup.pageColor).toBe('#dc2626');
    expect(surface.style.background).toBe('rgb(220, 38, 38)');

    // Reset ("Default") clears it back to no background.
    act(() => {
      fireEvent.click(button('Page Background options')!);
    });
    const reset = [...document.querySelectorAll('button')].find(
      (b) => b.textContent === 'Default'
    )!;
    act(() => {
      fireEvent.click(reset);
    });
    await settle();
    expect(useDocumentStore.getState().pageSetup.pageColor).toBe('');
    expect((document.querySelector('[data-testid="pageless-surface"]') as HTMLElement).style.background).toBe('');
  });
});
