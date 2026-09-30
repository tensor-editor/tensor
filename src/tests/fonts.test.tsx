import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { TextMetrics, TextStyle } from '@tensor-editor/engine';
import { Editor as TensorEditor } from '@/components/editor/Editor';
import { useDocumentStore } from '@/lib/document/store';
import { useConfigStore } from '@/lib/config/store';
import { DEFAULT_CONFIG, ConfigSchema } from '@/lib/config/schema';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';
import { parseFontFamilyName } from '@/lib/fonts/fontName';
import { BUNDLED_FONTS } from '@/lib/fonts/bundled';
import {
  useFontRegistryStore,
  filenameToFamily,
} from '@/lib/fonts/registry';
import { useFontBrowserStore } from '@/lib/fonts/browserStore';
import { FontBrowserDialog } from '@/components/dialogs/FontBrowserDialog';
import { PrivacyPanel } from '@/components/settings/panels/PrivacyPanel';
import { FontGroup } from '@/components/layout/ribbon/home/groups/FontGroup';
import { getCommand } from '@/lib/commands/registry';
import { pmDocToSemantic } from '@/lib/paginated/adapter';
import { GEOMETRY } from './harness';
import { renderTensor, settleLayout } from './harness';

// ─── Tauri surface mocks (fs/path/dialog — upload + persistence) ─────────

const mocks = vi.hoisted(() => ({
  pickPath: null as string | null,
  fontsJson: null as string | null,
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async () => fixtureBytes()),
  readTextFile: vi.fn(async () => mocks.fontsJson ?? '{}'),
  writeTextFile: vi.fn(async () => {}),
  exists: vi.fn(async (path: string) =>
    // fonts.json exists only when the test stages one; font files and
    // directories under /appdata always "exist" so copy/remove run.
    path.endsWith('fonts.json') ? mocks.fontsJson !== null : true,
  ),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn(async () => '/appconfig'),
  appDataDir: vi.fn(async () => '/appdata'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => mocks.pickPath),
  save: vi.fn(async () => null),
}));

import { writeTextFile, copyFile, remove } from '@tauri-apps/plugin-fs';

// jsdom has no Tauri internals — set the marker so persistRegistry's
// guard lets the (mocked) fonts.json write through.
beforeAll(() => {
  Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

// ─── Minimal sfnt fixture builder (the parser's test bytes AND the
//     upload flow's mock readFile payload) ────────────────────────────────

/** Builds a valid sfnt (.ttf) with one 'name' table carrying the given
 *  records. platformId 3, encoding 1 → UTF-16BE (the Windows/UCS2
 *  convention real TTFs ship). */
function makeSfnt(records: { nameId: number; text: string }[]): Uint8Array {
  const strings = records.map((r) =>
    [...r.text].map((ch) => ch.charCodeAt(0)),
  );
  const stringBytes = strings.reduce((n, s) => n + s.length * 2, 0);
  const tableLen = 6 + records.length * 12 + stringBytes;
  const total = 12 + 16 + tableLen;
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const bytes = new Uint8Array(buf);
  // sfnt header: version 1.0, 1 table
  view.setUint32(0, 0x00010000);
  view.setUint16(4, 1);
  // table record: tag 'name', checksum 0, offset 12+16, length tableLen
  view.setUint32(12, 0x6e616d65);
  view.setUint32(16, 0);
  view.setUint32(20, 12 + 16);
  view.setUint32(24, tableLen);
  // name table header: format 0, count, stringOffset = 6 + count*12
  const base = 12 + 16;
  view.setUint16(base, 0);
  view.setUint16(base + 2, records.length);
  view.setUint16(base + 4, 6 + records.length * 12);
  let strOff = 0;
  records.forEach((r, i) => {
    const rec = base + 6 + i * 12;
    view.setUint16(rec, 3); // platformId: Windows
    view.setUint16(rec + 2, 1); // encodingId: UCS2
    view.setUint16(rec + 4, 0x0409); // languageId: en-US
    view.setUint16(rec + 6, r.nameId);
    view.setUint16(rec + 8, r.text.length * 2); // length
    view.setUint16(rec + 10, strOff); // offset into string storage
    for (const c of strings[i]!) {
      view.setUint16(base + 6 + records.length * 12 + strOff, c);
      strOff += 2;
    }
  });
  return bytes;
}

function fixtureBytes(): Uint8Array {
  return makeSfnt([
    { nameId: 1, text: 'Real Family' },
    { nameId: 16, text: 'Typo Family' },
  ]);
}

// ─── Store resets ─────────────────────────────────────────────────────────

beforeEach(() => {
  useFontRegistryStore.setState({ entries: [...BUNDLED_FONTS], epoch: 0, status: 'idle', recentFamilies: [] });
  useFontBrowserStore.setState({ isOpen: false, selectedId: null });
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
    isDirty: false,
    filePath: null,
  });
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      editor: { ...state.config.editor, defaultFontFamily: 'system-ui', defaultPageLayout: 'Pages' },
      privacy: { ...state.config.privacy, allowFontCatalogs: false },
    },
  }));
  mocks.pickPath = null;
  mocks.fontsJson = null;
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. The sfnt name-table parser (STEP 2's mini metadata reader) ───────

describe('parseFontFamilyName (mini sfnt parser)', () => {
  it('reads nameID 1 (family) from a minimal sfnt', () => {
    expect(parseFontFamilyName(makeSfnt([{ nameId: 1, text: 'My Font' }]))).toBe('My Font');
  });

  it('PREFERS nameID 16 (typographic family) over nameID 1', () => {
    const bytes = makeSfnt([
      { nameId: 1, text: 'Real Family' },
      { nameId: 16, text: 'Typo Family' },
    ]);
    expect(parseFontFamilyName(bytes)).toBe('Typo Family');
  });

  it('returns null for non-sfnt bytes (.woff2 brotli is not free — filename convention takes over)', () => {
    const junk = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 1, 2, 3, 4, 5, 6, 7, 8]); // 'wOF2'
    expect(parseFontFamilyName(junk)).toBeNull();
    expect(parseFontFamilyName(new Uint8Array(4))).toBeNull();
  });

  it('filename convention: "my-font.ttf" → "My Font"', () => {
    expect(filenameToFamily('/home/u/my-font.ttf')).toBe('My Font');
    expect(filenameToFamily('C:\\Users\\x\\MyFont.otf')).toBe('MyFont');
  });
});

// ─── 2. Bundled catalog claims (bold/italic receipts — amendment 3) ───────

describe('bundled catalog — per-face claims are exactly what Fontsource ships', () => {
  /** '@fontsource/<pkg>/700.css' → node_modules woff2 on disk. */
  function specToDiskFile(spec: string): string {
    const m = /@fontsource\/([\w-]+)\/(\d+)(-italic)?\.css/.exec(spec)!;
    const file = `${m[1]}-latin-${m[2]}-${m[3] ? 'italic' : 'normal'}.woff2`;
    return resolve('node_modules/@fontsource', m[1]!, 'files', file);
  }

  it('no Roboto — the catalog complements Geist (catalog ruling)', () => {
    const families = BUNDLED_FONTS.map((e) => e.family.toLowerCase());
    expect(families).not.toContain('roboto');
    expect(families).toContain('ibm plex sans');
    expect(families).toContain('manrope');
    expect(families).toContain('sora');
  });

  it('every claim resolves to a real face file on disk — no synthetic bold/italic (receipt)', () => {
    expect(BUNDLED_FONTS.length).toBeGreaterThanOrEqual(19); // 13 fontsource+geist + 6 system
    for (const entry of BUNDLED_FONTS) {
      if (!entry.files) continue; // system families — OS resolves
      for (const spec of Object.values(entry.files)) {
        if (!spec) continue;
        expect(existsSync(specToDiskFile(spec)), `${entry.family}: ${spec}`).toBe(true);
      }
    }
  });

  it('Fira Code / Manrope / Sora claim NO italic (no italic design on Fontsource — disk receipt)', () => {
    for (const family of ['Fira Code', 'Manrope', 'Sora']) {
      const entry = BUNDLED_FONTS.find((e) => e.family === family)!;
      expect(entry.files!.italic).toBeUndefined();
      expect(entry.files!.boldItalic).toBeUndefined();
      expect(existsSync(specToDiskFile(entry.files!.bold!))).toBe(true);
    }
  });

  it('Geist Variable is registered variable:true with NO bold file — 700 weights the axis', () => {
    const geist = BUNDLED_FONTS.find((e) => e.family === 'Geist Variable')!;
    expect(geist.variable).toBe(true);
    expect(geist.files).toBeUndefined();
  });

  it('system fallbacks: source system + files:undefined — dialog preview degrades via the system family (amendment 2)', () => {
    for (const family of ['Arial', 'Georgia', 'Verdana']) {
      const entry = BUNDLED_FONTS.find((e) => e.family === family)!;
      expect(entry.files).toBeUndefined();
      expect(entry.source).toBe('system');
    }
    // Tensor's own families stay 'bundled' — the badges/filters
    // distinguish them from the OS families.
    expect(BUNDLED_FONTS.find((e) => e.family === 'Open Sans')!.source).toBe('bundled');
  });
});

// ─── 3. Upload → registry + copied file + registered FontFace ─────────────

describe('upload flow', () => {
  it('upload: file COPIED into appDataDir()/fonts/, entry registered, FontFace added and loaded', async () => {
    mocks.pickPath = '/home/u/MyFont.ttf';

    // The dialog flow: detect (parser) → confirm → addUploaded.
    const entry = await useFontRegistryStore.getState().addUploaded({
      family: 'Typo Family', // parsed nameID 16 from the fixture bytes
      displayName: 'Typo Family',
      sourcePath: '/home/u/MyFont.ttf',
    });
    expect(entry).not.toBeNull();

    // COPIED — never referenced in place (the receipt's law):
    const [from, to] = (copyFile as ReturnType<typeof vi.fn>).mock.calls[0] as [string, string];
    expect(from).toBe('/home/u/MyFont.ttf');
    expect(to).toMatch(/^\/appdata\/fonts\/[\w-]+-MyFont\.ttf$/);

    // Registry entry:
    const now = useFontRegistryStore.getState().entries.find((e) => e.id === entry!.id);
    expect(now?.family).toBe('Typo Family');
    expect(now?.source).toBe('uploaded');
    expect(now?.status).toBe('ready');
    expect(useFontRegistryStore.getState().epoch).toBe(1);

    // FontFace registered against document.fonts (the setup stubs
    // give the real code path an honest recording surface):
    const faces = [...(document.fonts as unknown as Iterable<{ family: string; status: string }>)];
    const face = faces.find((f) => f.family === 'Typo Family');
    expect(face).toBeDefined();
    expect(face!.status).toBe('loaded');
  });

  it('detectUploadFamily: the sfnt parser names .ttf uploads', async () => {
    const { detectUploadFamily } = await import('@/lib/fonts/registry');
    const staged = await detectUploadFamily('/home/u/some-font.ttf');
    expect(staged.detectedFamily).toBe('Typo Family'); // fixture bytes
    expect(staged.fallbackName).toBe('Some Font');
  });
});

// ─── 4. Persistence round-trip (relaunch flow) ───────────────────────────

describe('persistence round-trip', () => {
  it('fonts.json written with the uploaded entry; relaunch re-registers from disk; bundled re-seeded', async () => {
    await useFontRegistryStore.getState().addUploaded({
      family: 'Typo Family',
      displayName: 'Typo Family',
      sourcePath: '/home/u/MyFont.ttf',
    });
    // Persisted (registry in app-config — styles.json precedent):
    const [path, contents] = (writeTextFile as ReturnType<typeof vi.fn>).mock.calls.find(
      (c) => (c[0] as string).endsWith('fonts.json'),
    ) as [string, string];
    expect(path).toBe('/appconfig/fonts.json');
    const file = JSON.parse(contents);
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0].family).toBe('Typo Family');

    // Simulate relaunch: fresh store state, fonts.json on disk.
    useFontRegistryStore.setState({ entries: [...BUNDLED_FONTS], epoch: 0, status: 'idle', recentFamilies: [] });
    const faceBefore = [...(document.fonts as unknown as Iterable<{ family: string }>)].find(
      (f) => f.family === 'Typo Family',
    );
    mocks.fontsJson = contents;
    await useFontRegistryStore.getState().loadFromDisk();

    const entries = useFontRegistryStore.getState().entries;
    // Bundled still seeded:
    expect(entries.some((e) => e.family === 'Geist Variable')).toBe(true);
    expect(entries.some((e) => e.family === 'Open Sans')).toBe(true);
    expect(entries.some((e) => e.family === 'Arial')).toBe(true);
    // Uploaded re-registered from disk: registration REPLACES faces
    // for the same family (registerFont's dedupe law), so the honest
    // assertion is IDENTITY — a FRESH FontFace built from
    // appDataDir()/fonts/ bytes, not the session's original object.
    expect(entries.find((e) => e.family === 'Typo Family')?.source).toBe('uploaded');
    const faceAfter = [...(document.fonts as unknown as Iterable<{ family: string }>)].find(
      (f) => f.family === 'Typo Family',
    );
    expect(faceAfter).toBeDefined();
    expect(faceAfter).not.toBe(faceBefore);
    expect(useFontRegistryStore.getState().status).toBe('ready');
  });

  it('missing fonts.json at first launch: bundled-only, no crash', async () => {
    mocks.fontsJson = null; // exists() false → no file yet
    await useFontRegistryStore.getState().loadFromDisk();
    expect(useFontRegistryStore.getState().entries).toEqual(BUNDLED_FONTS);
    expect(useFontRegistryStore.getState().status).toBe('ready');
  });
});

// ─── 5. The stale-widths symptom test (amendment 1) ───────────────────────

describe('stale widths — the install symptom, asserted not assumed', () => {
  /** The seam: a ruler whose substitute measures NARROW and whose real
   *  face measures WIDE, keyed on the registry's own state — exactly
   *  what the real ruler does when a registered face replaces the
   *  system substitute. */
  function symptomMetrics(): TextMetrics {
    return {
      measure: (text, style: TextStyle) => {
        const registered = useFontRegistryStore
          .getState()
          .entries.some((e) => e.family === style.fontFamily && e.status === 'ready');
        return text.length * (registered ? 20 : 10);
      },
      ascent: () => 12,
      descent: () => 4,
    };
  }

  it('doc measured in substitute → after install: lines re-walked, pages re-walked, widths DIFFER', async () => {
    // The doc references 'TempFam' BEFORE it is installed (config
    // default family — the baseStyle channel real docs use).
    act(() => {
      useConfigStore.setState((state) => ({
        config: {
          ...state.config,
          editor: { ...state.config.editor, defaultFontFamily: 'TempFam' },
        },
      }));
    });
    // 54*62 chars at 10px/char = exactly one page of lines (FakeMetrics
    // geometry constants); at 20px/char the same text wraps to ~108
    // lines → 2 pages. Line height identical (ascent 12 + descent 4).
    const utils = render(
      <TensorEditor metrics={symptomMetrics()} />,
    );
    const editor = useDocumentStore.getState().editor!;
    act(() => {
      editor.commands.setContent(`<p>${'a'.repeat(GEOMETRY.charsPerLine * GEOMETRY.linesPerPage)}</p>`);
    });
    await settleLayout();

    // BEFORE: substitute widths — one page, last line index 53.
    expect(document.querySelectorAll('[data-page-index]')).toHaveLength(1);
    const versionBefore = (
      document.querySelector('[data-testid="paginated-stack"]') as HTMLElement
    ).dataset.layoutVersion;
    act(() => {
      editor.commands.setTextSelection(editor.state.doc.content.size - 1); // end of paragraph
      editor.commands.focus();
    });
    await settleLayout();
    const caretBefore = (document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement)
      .style.top;

    // INSTALL the real font (the registry's registration primitive —
    // same path the dialog's Install button takes).
    await act(async () => {
      await useFontRegistryStore.getState().registerFont({
        id: 'uploaded:temp',
        family: 'TempFam',
        displayName: 'TempFam',
        source: 'uploaded',
        files: { regular: 'temp.ttf' },
        status: 'ready',
      });
    });
    // The font-epoch effect: re-gate → engine recreate → relayout.
    await settleLayout();

    // SYMPTOM ASSERTIONS — same doc, same strings, a different ruler:
    // 1. pages re-walked: 20px/char wraps to ~108 lines → 2 sheets.
    expect(document.querySelectorAll('[data-page-index]')).toHaveLength(2);
    // 2. lines re-walked: the caret at the same doc position now sits
    //    on a different line (its LineBox rect y moved).
    const caretAfter = (document.querySelector('[data-testid="synthetic-caret"]') as HTMLElement)
      .style.top;
    expect(caretAfter).not.toBe(caretBefore);
    // 3. the re-gate held: the installed face is LOADED before the
    //    re-measure (M5.6 extended to installs — a recreated engine
    //    restarts its layout version, so the face, not the version
    //    counter, is the honest gate receipt).
    void versionBefore;
    const face = [...(document.fonts as unknown as Iterable<{ family: string; status: string }>)].find(
      (f) => f.family === 'TempFam',
    );
    expect(face).toBeDefined();
    expect(face!.status).toBe('loaded');
    utils.unmount();
  });
});

// ─── 6. The installed family reaches all three surfaces (STEP 5 test 3) ───

describe('installed family reaches every surface', () => {
  it('adapter TextStyle.fontFamily + paginated paint font-string carry the family', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 12 });
      editor.commands.setFontFamily('TempFam');
    });
    await settleLayout();

    // Adapter: the engine-bound run style carries the family string.
    const base = {
      fontFamily: useConfigStore.getState().config.editor.defaultFontFamily,
      fontSize: useConfigStore.getState().config.editor.defaultFontSize,
    };
    const adapted = pmDocToSemantic(editor.state.doc, base);
    expect(adapted.doc.blocks[0].runs[0].style.fontFamily).toBe('TempFam');

    // Paginated paint: fillText's ctx.font comes from fontString —
    // the ONE builder both measurement and paint consume.
    const ops = (globalThis as { __paintOps?: { op: string; font?: string }[] }).__paintOps ?? [];
    expect(ops.some((o) => o.font?.includes('TempFam'))).toBe(true);
  });

  it('pageless surface CSS fontFamily carries the family', async () => {
    const { editor } = renderTensor('<p>hello world</p>');
    await settleLayout();
    act(() => {
      useConfigStore.setState((state) => ({
        config: {
          ...state.config,
          editor: { ...state.config.editor, defaultPageLayout: 'Pageless', defaultFontFamily: 'TempFam' },
        },
      }));
    });
    await settleLayout();
    const surface = document.querySelector('[data-testid="pageless-surface"]') as HTMLElement;
    expect(surface).not.toBeNull();
    // The fontFamily sits on the EditorContent WRAPPER inside the
    // surface (PagelessEditor.tsx — the surface div carries pageColor,
    // the wrapper carries the resolved normal-base font).
    const wrapper = surface.querySelector('.prose') as HTMLElement;
    expect(wrapper).not.toBeNull();
    expect(wrapper.style.fontFamily).toBe('TempFam');
    void editor;
  });
});

// ─── 7. Uninstall (warned-set — the styles precedent) ─────────────────────

describe('uninstall', () => {
  it('removes files + entry + faces; a doc using the family warns ONCE (warned set)', async () => {
    const entry = await useFontRegistryStore.getState().addUploaded({
      family: 'Typo Family',
      displayName: 'Typo Family',
      sourcePath: '/home/u/MyFont.ttf',
    });
    const { editor } = renderTensor('<p>hello</p>');
    await settleLayout();
    // The doc references the family (mark-level):
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 6 });
      editor.commands.setFontFamily('Typo Family');
    });
    void entry;

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await act(async () => {
      await useFontRegistryStore.getState().uninstall(entry!.id);
    });
    expect(useFontRegistryStore.getState().entries.some((e) => e.id === entry!.id)).toBe(false);
    expect(remove).toHaveBeenCalled();
    expect(useFontRegistryStore.getState().epoch).toBe(2);
    // Warned-set: once, not per call:
    expect(warnSpy).toHaveBeenCalledTimes(1);
    await act(async () => {
      await useFontRegistryStore.getState().uninstall('missing'); // no-op — no second warning
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });
});

// ─── 8. Privacy toggle (STEP 3) ──────────────────────────────────────────

describe('privacy: allow font catalogs (inert until milestone B)', () => {
  it('default OFF — schema round-trip keeps it off', () => {
    expect(DEFAULT_CONFIG.privacy.allowFontCatalogs).toBe(false);
    const parsed = ConfigSchema.parse({});
    expect(parsed.privacy.allowFontCatalogs).toBe(false);
  });

  it('the panel renders the toggle with its consequence note', () => {
    render(<PrivacyPanel />);
    const sw = document.querySelector('[data-testid="allow-font-catalogs-switch"]')!;
    expect(sw).not.toBeNull();
    expect(document.body.textContent).toContain('Google Fonts / Font Share');
    act(() => {
      useConfigStore.getState().setAllowFontCatalogs(true);
    });
    expect(useConfigStore.getState().config.privacy.allowFontCatalogs).toBe(true);
  });
});

// ─── 9. Dialog + FontGroup entry points + palette (STEP 5 test 7) ────────

describe('Font Browser + entry points', () => {
  it('the dialog lists bundled + uploaded with per-font previews and source badges', () => {
    act(() => {
      useFontBrowserStore.getState().open();
    });
    render(<FontBrowserDialog />);
    expect(document.querySelector('[data-testid="font-row-bundled:geist"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="font-row-bundled:ibm-plex-sans"]')).not.toBeNull();
    const preview = document.querySelector('[data-testid="font-detail-preview"]') as HTMLElement;
    expect(preview).not.toBeNull();
    expect(preview.style.fontFamily).not.toBe(''); // the real registered family
    // Uninstall is uploaded-only — the default selection (Geist, a
    // bundled entry) has none:
    expect(document.querySelector('[data-testid="font-uninstall"]')).toBeNull();

    // Source badges: the Tensor mark for bundled (orange), the
    // computer for system families — no clunky text badges.
    expect(document.querySelector('[data-testid="font-badge-bundled"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="font-badge-system"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain('BUNDLED');
    // Style + direction badges replace the old prose subtitle:
    expect(document.querySelector('[data-testid="font-styles-badge"]')).not.toBeNull();
    expect(document.querySelector('[data-testid="font-direction-badge"]')?.textContent).toBe('LTR');
    // Tooltips are bare source names now — no "Source (...)" wrapper:
    expect(document.body.textContent).not.toContain('Source (');
  });

  it('search narrows the list by name; source filters partition it', () => {
    act(() => {
      useFontBrowserStore.getState().open();
    });
    render(<FontBrowserDialog />);
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'merri' } });
    });
    let rows = [...document.querySelectorAll('[data-testid^="font-row-"]')];
    expect(rows).toHaveLength(1);
    expect(rows[0]!.textContent).toContain('Merriweather');
    // Clear + filter by source: Tensor families only — system ones
    // (Georgia, Arial…) disappear.
    act(() => {
      fireEvent.change(search, { target: { value: '' } });
      fireEvent.click(document.querySelector('[data-testid="font-filter-bundled"]')!);
    });
    rows = [...document.querySelectorAll('[data-testid^="font-row-"]')];
    expect(rows.some((r) => r.getAttribute('data-testid') === 'font-row-bundled:open-sans')).toBe(true);
    expect(rows.some((r) => r.getAttribute('data-testid') === 'font-row-bundled:system:Georgia')).toBe(false);
    // System filter: the inverse partition.
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="font-filter-system"]')!);
    });
    rows = [...document.querySelectorAll('[data-testid^="font-row-"]')];
    expect(rows.some((r) => r.getAttribute('data-testid') === 'font-row-bundled:system:Georgia')).toBe(true);
    expect(rows.some((r) => r.getAttribute('data-testid') === 'font-row-bundled:open-sans')).toBe(false);
  });

  it('the Online tab is ALWAYS visible; OFF shows the CloudOff Empty + link, ON the honest empty state', () => {
    act(() => {
      useFontBrowserStore.getState().open();
    });
    render(<FontBrowserDialog />);
    // Always visible — previously installed catalog fonts stay
    // reachable even with catalogs off:
    expect(document.querySelector('[data-testid="font-filter-catalog"]')).not.toBeNull();
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="font-filter-catalog"]')!);
    });
    // OFF: CloudOff icon + the turn-on link (guidance moved out of
    // the slim banner):
    expect(document.querySelector('[data-testid="font-list"]')!.textContent).toContain(
      'no network requests',
    );
    expect(document.querySelector('[data-testid="catalogs-off-link"]')).not.toBeNull();
    const banner = document.querySelector('[data-testid="catalogs-off-banner"]')!;
    expect(banner.textContent).toBe('Online catalogs are off'); // slim — icon + title
    act(() => {
      useConfigStore.getState().setAllowFontCatalogs(true);
    });
    // ON: the banner disappears; the Empty drops the link.
    expect(document.querySelector('[data-testid="catalogs-off-banner"]')).toBeNull();
    expect(document.querySelector('[data-testid="font-list"]')!.textContent).toContain(
      'No online fonts installed yet',
    );
    expect(document.querySelector('[data-testid="catalogs-off-link"]')).toBeNull();
  });

  it('"Use this font" applies the selected family through the picker\u2019s own path', () => {
    const { editor } = renderTensor('<p>hello world</p>');
    act(() => {
      useFontBrowserStore.getState().open();
      useFontBrowserStore.getState().select('bundled:lora');
    });
    render(<FontBrowserDialog />);
    const use = document.querySelector('[data-testid="font-use"]') as HTMLButtonElement;
    expect(use).not.toBeNull();
    act(() => {
      editor.commands.setTextSelection({ from: 1, to: 12 });
      fireEvent.click(use);
    });
    expect(editor.getAttributes('textStyle').fontFamily).toBe('Lora');
  });

  it('the icon-only Upload button in the toolbar stages the same confirm flow', async () => {
    mocks.pickPath = '/home/u/MyFont.ttf';
    act(() => {
      useFontBrowserStore.getState().open();
    });
    render(<FontBrowserDialog />);
    const upload = document.querySelector('button[aria-label="Upload Font"]') as HTMLButtonElement;
    expect(upload).not.toBeNull();
    await act(async () => {
      fireEvent.click(upload);
    });
    const nameInput = document.querySelector('[data-testid="font-name-input"]') as HTMLInputElement;
    expect(nameInput).not.toBeNull();
    expect(nameInput.value).toBe('Typo Family'); // parsed from the fixture bytes
  });

  it('FontGroup: the popover picker (StylesDropdown pattern) — alphabetical, recent, weights, Browse', async () => {
    const { editor } = renderTensor('<p>hello</p>');
    await settleLayout();
    render(<FontGroup />);
    const trigger = document.querySelector('button[aria-label="Font Family"]') as HTMLButtonElement;
    expect(trigger).not.toBeNull();
    act(() => {
      fireEvent.click(trigger);
    });

    // Alphabetical by DISPLAY name, wide popover, preview-rendered:
    const allNames = [...document.querySelectorAll('[data-slot="popover-content"] [data-testid^="font-picker-row-"]')]
      .map((el) => el.textContent);
    expect(allNames.length).toBeGreaterThanOrEqual(19);
    // Alphabetical (System UI sorts by display name, not 'system-ui').
    // Recent rows (top of the popover) sit OUTSIDE the sort — skip
    // them; a previous test's "Use font" may have recorded one.
    const recentCount = document.body.textContent!.includes('Recently Used')
      ? Math.max(1, useFontRegistryStore.getState().recentFamilies.length)
      : 0;
    const allSection = allNames.slice(recentCount);
    const sorted = [...allSection].sort((a, b) => a!.localeCompare(b!));
    expect(allSection).toEqual(sorted);
    // 'system-ui' shows as "System UI"; Geist is just "Geist" (no Variable suffix):
    expect(allSection).toContain('System UI');
    expect(allSection).not.toContain('Geist Variable');
    expect(allSection.some((n) => /\.?\s*Variable$/.test(n ?? ''))).toBe(false);

    // Weight flyout: variable Geist offers axis stops; only 400/700
    // selectable (the engine's two worlds), the rest disabled.
    const geistRow = document.querySelector('[data-testid="font-picker-row-Geist Variable"]') as HTMLElement;
    expect(geistRow.textContent).toContain('Geist'); // display name only
    act(() => {
      fireEvent.click(geistRow.querySelector('button[aria-label="Weights for Geist"]')!);
    });
    const light = document.querySelector('[data-testid="font-picker-weight-Geist Variable-300"]') as HTMLButtonElement;
    expect(light.disabled).toBe(true);
    const boldBtn = document.querySelector('[data-testid="font-picker-weight-Geist Variable-700"]') as HTMLButtonElement;
    expect(boldBtn.disabled).toBe(false);

    // Applying a font records it as recently used:
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="font-picker-row-Open Sans"]')!.querySelector('button')!);
    });
    expect(editor.getAttributes('textStyle').fontFamily).toBe('Open Sans');
    act(() => {
      fireEvent.click(document.querySelector('button[aria-label="Font Family"]')!);
    });
    expect(document.querySelector('[data-testid="font-picker-row-Open Sans"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Recently Used');

    // The Browse row is a real item (bottom, full width):
    const browse = document.querySelector('[data-testid="font-picker-browse"]') as HTMLElement;
    expect(browse.textContent).toContain('Browse Fonts');
    const before = editor.state.doc.toJSON();
    act(() => {
      fireEvent.click(browse);
    });
    expect(useFontBrowserStore.getState().isOpen).toBe(true);
    expect(editor.state.doc.toJSON()).toEqual(before);
  });

  it('palette: "Browse Fonts" is present, runs, opens the dialog', () => {
    const command = getCommand('browseFonts')!;
    expect(command).toBeDefined();
    expect(command.title).toBe('Browse Fonts');
    void command.run();
    expect(useFontBrowserStore.getState().isOpen).toBe(true);
  });
});
