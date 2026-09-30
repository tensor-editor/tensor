import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import { act, render, fireEvent } from '@testing-library/react';
import { FontBrowserDialog } from '@/components/dialogs/FontBrowserDialog';
import { useFontBrowserStore } from '@/lib/fonts/browserStore';
import { useFontRegistryStore } from '@/lib/fonts/registry';
import { BUNDLED_FONTS } from '@/lib/fonts/bundled';
import { useConfigStore } from '@/lib/config/store';
import { useSettingsDialogStore } from '@/lib/settings/store';
import { normalizeFamilyKey } from '@/lib/fonts/catalogs/normalize';
import { parseCss2LatinUrls, css2FamilyQuery, createGoogleSource, resetForTests as resetGoogle } from '@/lib/fonts/catalogs/google';
import { createFontShareSource } from '@/lib/fonts/catalogs/fontshare';
import { createFontsourceSource, resetForTests as resetFontsource } from '@/lib/fonts/catalogs/fontsource';
import { getCatalogSources, searchCatalogs, prefetchCatalogs } from '@/lib/fonts/catalogs';
import { pickSlots } from '@/lib/fonts/catalogs/types';
import { brandMarkUrl, resetBrandMarksForTests } from '@/lib/fonts/catalogs/brandMarks';
import { enqueuePreview, resetPreviewQueue, queueStats } from '@/lib/fonts/catalogs/previewQueue';
import { releasePreviewFace, previewAlias } from '@/lib/fonts/catalogs/preview';

// ─── Fixtures (receipts, trimmed) + the fetch_url mock ────────────────────

const fixtures = vi.hoisted(() => ({
  googleMeta: JSON.stringify({
    familyMetadataList: [
      {
        family: 'Roboto', displayName: null, category: 'Sans Serif',
        fonts: { '400': {}, '400i': {}, '700': {}, '700i': {} },
      },
      {
        family: 'Lora', displayName: null, category: 'Serif', subsets: ['latin'],
        fonts: { '400': {}, '500': {}, '700': {}, '700i': {} },
      },
      {
        // M-FONTS-B.1's failing family: multi-word, 400-only, NO
        // italics — the single-axis shape the old tuple syntax broke.
        family: 'Rubik 80s Fade', displayName: null, category: 'Display', subsets: ['latin'],
        fonts: { '400': {} },
      },
      {
        // A family whose ONLY weight is 500 — sparse slots must
        // install the real 500 as regular, never a fixed 400.
        family: 'Only Medium', displayName: null, category: 'Display', subsets: ['latin'],
        fonts: { '500': {} },
      },
    ],
  }),
  googleCss2: `/* latin-ext */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/roboto/LATIN-EXT-400.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/roboto/LATIN-400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: normal;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/roboto/LATIN-700.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: italic;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/roboto/LATIN-400I.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}
/* latin */
@font-face {
  font-family: 'Roboto';
  font-style: italic;
  font-weight: 700;
  src: url(https://fonts.gstatic.com/s/roboto/LATIN-700I.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`,
  googleCss2Rubik: `/* latin-ext */
@font-face {
  font-family: 'Rubik 80s Fade';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/rubik80sfade/RUBIK-LATIN-EXT-400.woff2) format('woff2');
  unicode-range: U+0100-02BA;
}
/* latin */
@font-face {
  font-family: 'Rubik 80s Fade';
  font-style: normal;
  font-weight: 400;
  src: url(https://fonts.gstatic.com/s/rubik80sfade/RUBIK-LATIN-400.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`,
  googleCss2Medium: `/* latin */
@font-face {
  font-family: 'Only Medium';
  font-style: normal;
  font-weight: 500;
  src: url(https://fonts.gstatic.com/s/onlymedium/MEDIUM-LATIN-500.woff2) format('woff2');
  unicode-range: U+0000-00FF;
}`,
  fontshare: JSON.stringify({
    count: 2,
    fonts: [
      {
        name: 'Clash Grotesk', slug: 'clash-grotesk', category: 'Sans', license_type: 'itf_ffl',
        styles: [
          { file: '//cdn.fontshare.com/wf/REG400', weight: { number: 400 }, is_italic: false, is_variable: false },
          { file: '//cdn.fontshare.com/wf/BOLD700', weight: { number: 700 }, is_italic: false, is_variable: false },
        ],
      },
      {
        // Same family as Google's fixture → the dedupe matrix.
        name: 'Lora', slug: 'lora', category: 'Serif', license_type: 'ofl',
        styles: [
          { file: '//cdn.fontshare.com/wf/LORA-REG', weight: { number: 400 }, is_italic: false, is_variable: false },
        ],
      },
    ],
  }),
  fontsourceMeta: JSON.stringify([
    {
      id: 'geist', family: 'Geist', subsets: ['latin'], weights: [400, 700], styles: ['italic', 'normal'],
      defSubset: 'latin', variable: true, license: 'OFL-1.1', type: 'google',
    },
    {
      id: 'lora', family: 'Lora', subsets: ['latin'], weights: [400, 700], styles: ['normal'],
      defSubset: 'latin', variable: false, license: 'OFL-1.1', type: 'google',
    },
  ]),
  failOn: null as string | null,
  failWriteOn: null as string | null,
  fontsJson: null as string | null,
}));

vi.mock('@tauri-apps/api/core', () => {
  const encoder = new TextEncoder();
  return {
    invoke: vi.fn(async (cmd: string, args: { url?: string }) => {
      if (cmd !== 'fetch_url') throw new Error(`unexpected invoke: ${cmd}`);
      const url = args.url ?? '';
      if (fixtures.failOn && url.includes(fixtures.failOn)) throw new Error('network boom');
      if (url.includes('fonts.google.com/metadata')) return encoder.encode(fixtures.googleMeta);
      if (url.includes('css2?family=')) {
        const fam = decodeURIComponent(new URL(url).searchParams.get('family') ?? '').split(':')[0];
        if (fam === 'Rubik 80s Fade') return encoder.encode(fixtures.googleCss2Rubik);
        if (fam === 'Only Medium') return encoder.encode(fixtures.googleCss2Medium);
        return encoder.encode(fixtures.googleCss2); // Roboto (and default)
      }
      if (url.includes('api.fontshare.com')) {
        // The real API filters server-side on q — mirror that.
        const q = new URL(url).searchParams.get('q')?.toLowerCase() ?? '';
        const parsed = JSON.parse(fixtures.fontshare) as { fonts: { name: string }[] };
        const fonts = parsed.fonts.filter((f) => f.name.toLowerCase().includes(q));
        return encoder.encode(JSON.stringify({ fonts }));
      }
      if (url.includes('api.fontsource.org')) return encoder.encode(fixtures.fontsourceMeta);
      if (url.includes('www.fontshare.com/favicon.ico')) {
        return encoder.encode('<!doctype html><title>shell</title>'); // HTML — NOT a mark
      }
      if (url.includes('favicon.ico')) {
        // Real ICO magic + junk — google + fontsource pass the sniff.
        return new Uint8Array([0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x20, 0x20]);
      }
      return encoder.encode('FAKEFONTBYTES'); // any gstatic/cdn.fontshare/jsdelivr file
    }),
  };
});

vi.mock('@tauri-apps/plugin-fs', () => ({
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
  readTextFile: vi.fn(async () => fixtures.fontsJson ?? '{}'),
  writeTextFile: vi.fn(async () => {}),
  writeFile: vi.fn(async (path: string) => {
    if (fixtures.failWriteOn && path.includes(fixtures.failWriteOn)) {
      throw new Error('disk full');
    }
  }),
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
  copyFile: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appConfigDir: vi.fn(async () => '/appconfig'),
  appDataDir: vi.fn(async () => '/appdata'),
  homeDir: vi.fn(async () => '/home/u'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { invoke } from '@tauri-apps/api/core';
import { writeFile, writeTextFile, remove } from '@tauri-apps/plugin-fs';

beforeAll(() => {
  Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

/** fetch_url calls — the no-silent-network spy. */
const invokeMock = invoke as unknown as ReturnType<typeof vi.fn>;
const fetchCalls = () => invokeMock.mock.calls.filter((c) => c[0] === 'fetch_url');

/** Wait out the 300ms search debounce. */
const waitDebounce = () => act(async () => { await new Promise((r) => setTimeout(r, 380)); });

beforeEach(() => {
  resetGoogle();
  resetFontsource();
  resetPreviewQueue();
  resetBrandMarksForTests();
  releasePreviewFace();
  fixtures.failOn = null;
  fixtures.failWriteOn = null;
  vi.clearAllMocks();
  useFontRegistryStore.setState({ entries: [...BUNDLED_FONTS], epoch: 0, status: 'idle' });
  useFontBrowserStore.setState({ isOpen: false, selectedId: null });
  useSettingsDialogStore.setState({ isOpen: false, activePanelId: 'general' });
  useConfigStore.setState((state) => ({
    config: {
      ...state.config,
      editor: { ...state.config.editor, defaultFontFamily: 'system-ui' },
      privacy: { ...state.config.privacy, allowFontCatalogs: false },
    },
  }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── 1. Normalization + dedupe (pure) ─────────────────────────────────────

describe("normalizeFamilyKey (A's ruling + the variable-suffix strip)", () => {
  it('variable packages collapse onto the static family', () => {
    expect(normalizeFamilyKey('Lora Variable')).toBe('lora');
    expect(normalizeFamilyKey('Lora Variable Italic')).toBe('lora');
    expect(normalizeFamilyKey('Lora')).toBe('lora'); // one entry, chips per source
  });

  it('case/whitespace/punctuation collapse', () => {
    expect(normalizeFamilyKey('ABeeZee')).toBe('abeezee');
    expect(normalizeFamilyKey('IBM Plex Sans')).toBe('ibm plex sans');
    expect(normalizeFamilyKey(' Some   Font! ')).toBe('some font');
  });

  it('the strip does not eat real names ("Variable"-prefixed families)', () => {
    expect(normalizeFamilyKey('Variety Sans')).toBe('variety sans');
  });
});

// ─── 2. Adapter parsing vs fixtures ───────────────────────────────────────

describe('catalog adapters vs receipt fixtures', () => {
  it('google: metadata search + css2 latin parsing (the Roboto receipt)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    const google = createGoogleSource();
    const results = await google.search('robo');
    expect(results.map((f) => f.family)).toEqual(['Roboto']);
    expect(results[0]!.variants).toEqual([
      { weight: 400, style: 'normal' },
      { weight: 400, style: 'italic' },
      { weight: 700, style: 'normal' },
      { weight: 700, style: 'italic' },
    ]);
    // The css2 parser: LATIN block urls only — latin-ext excluded.
    const urls = parseCss2LatinUrls(fixtures.googleCss2);
    expect(urls).toHaveLength(4); // 400/700 × normal/italic, latin only
    expect(urls.every((u) => u.url.includes('LATIN-') && !u.url.includes('EXT'))).toBe(true);
    // The css2 request asked with the browser UA (woff2 vs ttf) and
    // the A-shaped axis spec.
    const download = await google.download(results[0]!);
    expect(download.files.regular).toBeDefined();
    expect(download.files.bold).toBeDefined();
    expect(download.files.italic).toBeDefined();
    const css2Call = fetchCalls().find(([, args]) => (args as { url: string }).url.includes('css2?family='));
    expect(css2Call).toBeDefined();
  });

  it('fontshare: search + direct woff2 URLs (protocol-relative → https)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    const fs = createFontShareSource();
    const results = await fs.search('clash');
    expect(results.map((f) => f.family)).toEqual(['Clash Grotesk']);
    expect(results[0]!.license).toBe('itf_ffl');
    expect(results[0]!.variants).toEqual([
      { weight: 400, style: 'normal' },
      { weight: 700, style: 'normal' },
    ]);
    const download = await fs.download(results[0]!);
    expect(new TextDecoder().decode(download.files.regular!)).toBe('FAKEFONTBYTES');
    const regCall = fetchCalls().find(([, args]) => (args as { url: string }).url === 'https://cdn.fontshare.com/wf/REG400');
    expect(regCall).toBeDefined();
  });

  it('fontsource: metadata search + jsDelivr URL patterns (variable + static)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    const src = createFontsourceSource();
    const results = await src.search('geist');
    expect(results.map((f) => f.family)).toEqual(['Geist']);
    expect(results[0]!.variable).toBe(true); // → A's FontEntry.variable
    // The existence proof: Geist — Tensor's own bundled font — is IN
    // the browsed catalog.
    const geist = results[0]!;
    const download = await src.download(geist);
    expect(new TextDecoder().decode(download.files.regular!)).toBe('FAKEFONTBYTES');
    expect(download.variable).toBe(true);
    // The receipt-verified URL pattern (variable scope, wght axis):
    const varCall = fetchCalls().find(
      ([, args]) => (args as { url: string }).url === 'https://cdn.jsdelivr.net/npm/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
    );
    expect(varCall).toBeDefined();
    // Static families: the plain @fontscope file pattern.
    const lora = (await src.search('lora')).find((f) => f.family === 'Lora')!;
    await src.download(lora);
    expect(
      fetchCalls().some(
        ([, args]) => (args as { url: string }).url === 'https://cdn.jsdelivr.net/npm/@fontsource/lora/files/lora-latin-400-normal.woff2',
      ),
    ).toBe(true);
  });

  it('dedupe across sources: one entry, chips in preference order', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    const sources = getCatalogSources();
    const { fonts } = await searchCatalogs(sources, 'lora');
    const lora = fonts.find((f) => f.family === 'Lora')!;
    // Google + Font Share + Fontsource all carry it:
    expect(lora.sources).toEqual(['google', 'fontshare', 'fontsource']);
    expect(Object.keys(lora.perSource)).toEqual(['google', 'fontshare', 'fontsource']);
    // Multi-source entries rank first.
    expect(fonts[0]!.sources.length).toBeGreaterThanOrEqual(3);
  });

  it('isolation: a dead source degrades to unavailable and never blocks others', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    fixtures.failOn = 'fontshare';
    const sources = getCatalogSources();
    const { fonts, unavailable } = await searchCatalogs(sources, 'o');
    expect(unavailable).toEqual(['fontshare']);
    // Google's families still arrived:
    expect(fonts.some((f) => f.family === 'Roboto')).toBe(true);
    expect(fonts.some((f) => f.sources.includes('fontshare'))).toBe(false);
  });
});

// ─── M-FONTS-B.1: sparse + multi-word families (the hotfix) ───────────────

describe('M-FONTS-B.1: the axis-syntax fix (Rubik 80s Fade vs Lora receipts)', () => {
  it('single-axis families request PLAIN values — the tuple form was the 400', () => {
    // The OLD code emitted "wght@0,400" for 400-only families → HTTP
    // 400 (the Rubik 80s Fade receipt); plain values return 200.
    expect(css2FamilyQuery(pickSlots([{ weight: 400, style: 'normal' }]))).toBe('wght@400');
    // Multi-weight, still no italics (the Abhaya Libre receipt):
    expect(css2FamilyQuery(pickSlots([{ weight: 400, style: 'normal' }, { weight: 700, style: 'normal' }]))).toBe('wght@400;700');
    // A 500-only family requests ITS weight (declared slots only):
    expect(css2FamilyQuery(pickSlots([{ weight: 500, style: 'normal' }]))).toBe('wght@500');
    // Two axes keep the tuple form (the Lora receipt — HTTP 200):
    expect(
      css2FamilyQuery(
        pickSlots([
          { weight: 400, style: 'normal' },
          { weight: 700, style: 'normal' },
          { weight: 400, style: 'italic' },
          { weight: 700, style: 'italic' },
        ]),
      ),
    ).toBe('ital,wght@0,400;0,700;1,400;1,700');
  });

  it('sparse 400-only multi-word family: preview + install clean, bold undefined (no-synthetic)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'rubik' } });
    });
    await waitDebounce();
    const row = document.querySelector('[data-testid="catalog-row-rubik 80s fade"]')!;
    expect(row).not.toBeNull(); // spaces in the key — the multi-word path
    act(() => {
      fireEvent.click(row);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    // PREVIEW: the real 400 face fetched (latin, not latin-ext):
    expect(
      fetchCalls().some(([, args]) => (args as { url: string }).url === 'https://fonts.gstatic.com/s/rubik80sfade/RUBIK-LATIN-400.woff2'),
    ).toBe(true);
    // The css2 request: PLAIN single-axis syntax, spaces %20-encoded,
    // and NOTHING the family does not declare (no ital, no 700):
    const css2Url = fetchCalls()
      .map(([, args]) => (args as { url: string }).url)
      .find((u) => u.includes('Rubik%2080s%20Fade'));
    expect(css2Url).toContain('wght@400');
    expect(css2Url).not.toContain('0,400'); // the old broken tuple
    // INSTALL: clean, regular only — files.bold stays undefined (the
    // A no-synthetic rule; FontGroup's bold button follows it).
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-install"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    const entry = useFontRegistryStore
      .getState()
      .entries.find((e) => e.family === 'Rubik 80s Fade' && e.source === 'catalog');
    expect(entry).toBeDefined();
    expect(entry!.files?.regular).toBeDefined();
    expect(entry!.files?.bold).toBeUndefined();
  });

  it('a 500-only family installs its REAL 500 as regular (declared slots, never 400)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    const google = createGoogleSource();
    const results = await google.search('only medium');
    expect(results.map((f) => f.family)).toEqual(['Only Medium']);
    expect(results[0]!.slots).toEqual({ regular: 500, bold: undefined, italic: undefined, boldItalic: undefined });
    const download = await google.download(results[0]!);
    expect(new TextDecoder().decode(download.files.regular!)).toBe('FAKEFONTBYTES');
    // The css2 request asked for wght@500 — the family's own weight:
    const css2Url = fetchCalls()
      .map(([, args]) => (args as { url: string }).url)
      .find((u) => u.includes('Only%20Medium'));
    expect(css2Url).toContain('wght@500');
    expect(download.files.bold).toBeUndefined();
  });
});

// ─── 3. Privacy gate ─────────────────────────────────────────────────────

describe('privacy gate (no network module even constructed while OFF)', () => {
  it('OFF: getCatalogSources() is empty and prefetch does nothing', async () => {
    expect(getCatalogSources()).toEqual([]);
    await prefetchCatalogs();
    expect(fetchCalls()).toHaveLength(0);
  });

  it('OFF: slim banner, the Online tab shows the CloudOff Empty + deep-link, ZERO fetches on use', async () => {
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    // The slim assurance line (icon + title, no link — guidance moved
    // to the Online tab):
    const banner = document.querySelector('[data-testid="catalogs-off-banner"]')!;
    expect(banner.textContent).toBe('Online catalogs are off');
    // The Online tab is ALWAYS visible — even with catalogs off:
    const onlineTab = document.querySelector('[data-testid="font-filter-catalog"]')!;
    expect(onlineTab).not.toBeNull();
    // Installed search + filters still work — offline:
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'open' } });
    });
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="font-filter-bundled"]')!);
    });
    // The Online tab's Empty: CloudOff + the turn-on deep-link:
    act(() => {
      fireEvent.click(onlineTab);
    });
    expect(document.querySelector('[data-testid="catalogs-off-link"]')).not.toBeNull();
    expect(fetchCalls()).toHaveLength(0); // the no-silent-network law
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalogs-off-link"]')!);
    });
    expect(useSettingsDialogStore.getState().isOpen).toBe(true);
    expect(useSettingsDialogStore.getState().activePanelId).toBe('privacy');
  });

  it('ON: the boot prefetch warms both list-all catalogs + brand favicons (the consent ruling)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    await prefetchCatalogs();
    const urls = fetchCalls().map(([, args]) => (args as { url: string }).url);
    expect(urls).toContain('https://fonts.google.com/metadata/fonts');
    expect(urls).toContain('https://api.fontsource.org/v1/fonts');
    // The favicon round rides the same boot consent:
    expect(urls).toContain('https://www.fontshare.com/favicon.ico');
    expect(urls).toContain('https://fontsource.org/favicon.ico');
    expect(urls).toContain('https://www.google.com/favicon.ico'); // fonts.google.com 404s — parent domain serves the G
    // Google + Fontsource favicons are REAL ICOs (sniffed: image/x-icon)
    // → brand marks; Font Share's serves HTML in the fixture world → no
    // mark, the lucide fallback (the isolation rule).
    expect(brandMarkUrl('fontsource')).toMatch(/^data:image\/x-icon;base64,/);
    expect(brandMarkUrl('google')).toMatch(/^data:image\/x-icon;base64,/);
    expect(brandMarkUrl('fontshare')).toBeNull();
  });

  it('ON: the dialog search is wired (debounced, results render)', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    expect(document.querySelector('[data-testid="catalogs-off-banner"]')).toBeNull();
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'robo' } });
    });
    // Debounce: at ~120ms only the dialog-open brand-mark ensure has
    // fired (3 favicons — an explicit user action); the SEARCH itself
    // has not (it lands at 300ms).
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(fetchCalls().length).toBeLessThanOrEqual(4);
    await waitDebounce();
    expect(document.querySelector('[data-testid="catalog-row-roboto"]')).not.toBeNull();
    // Roboto arrived deduped from Google only (fixture fontshare has
    // no Roboto): a single G chip.
    const row = document.querySelector('[data-testid="catalog-row-roboto"]')!;
    expect(row.querySelector('[data-testid="catalog-chip-google"]')).not.toBeNull();
    expect(row.querySelector('[data-testid="catalog-chip-fontshare"]')).toBeNull();
  });
});

// ─── 4. Preview lifecycle ─────────────────────────────────────────────────

describe('preview: lazy single-slot temp face', () => {
  it('the queue serializes — the second task starts only after the first settles', async () => {
    const order: string[] = [];
    const t1 = enqueuePreview(async () => {
      order.push('1-start');
      await new Promise((r) => setTimeout(r, 50));
      order.push('1-end');
      return 'a';
    });
    const t2 = enqueuePreview(async () => {
      order.push('2-start');
      order.push('2-end');
      return 'b';
    });
    await Promise.all([t1, t2]);
    expect(order).toEqual(['1-start', '1-end', '2-start', '2-end']);
    expect(queueStats.started).toBe(2);
  });

  it('selecting a result registers the temp face; deselect deletes it', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'robo' } });
    });
    await waitDebounce();
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-row-roboto"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    const alias = previewAlias();
    expect(alias).toBe('TensorPreview-roboto');
    expect(
      [...(document.fonts as unknown as Iterable<{ family: string }>)].some((f) => f.family === alias),
    ).toBe(true);
    // The preview paragraph renders with the REAL font (the alias).
    const preview = document.querySelector('[data-testid="font-detail-preview"]') as HTMLElement;
    expect(preview.style.fontFamily).toBe(alias);
    // Deselect (the Back button is gone): any query change releases
    // the stale preview — the temp face is deleted (A's pattern).
    act(() => {
      fireEvent.change(document.querySelector('[data-testid="font-search"]')!, {
        target: { value: '' },
      });
    });
    expect(previewAlias()).toBeNull();
    expect(
      [...(document.fonts as unknown as Iterable<{ family: string }>)].some((f) => f.family === 'TensorPreview-roboto'),
    ).toBe(false);
  });

  it('closing the dialog releases the face', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'clash' } });
    });
    await waitDebounce();
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-row-clash grotesk"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(previewAlias()).not.toBeNull();
    act(() => {
      useFontBrowserStore.getState().close();
    });
    expect(previewAlias()).toBeNull();
  });
});

// ─── 5. Catalog install (all files, registry entry, epoch) ───────────────

describe('catalog install', () => {
  async function selectAndInstall() {
    useConfigStore.getState().setAllowFontCatalogs(true);
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'robo' } });
    });
    await waitDebounce();
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-row-roboto"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-install"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
  }

  it('bytes → appDataDir files + registry entry (source catalog, catalog google) + epoch bump', async () => {
    const epochBefore = useFontRegistryStore.getState().epoch;
    await selectAndInstall();
    const entry = useFontRegistryStore
      .getState()
      .entries.find((e) => e.source === 'catalog' && e.family === 'Roboto');
    expect(entry).toBeDefined();
    expect(entry!.catalog).toBe('google');
    expect(entry!.files?.regular).toMatch(/^[\w-]+-regular\.woff2$/);
    expect(useFontRegistryStore.getState().epoch).toBeGreaterThan(epochBefore);
    // After install the dialog selects the INSTALLED entry with the
    // catalog badge + a FontFace registered under the real family:
    expect(document.querySelector('[data-testid="font-use"]')).not.toBeNull();
    expect(
      [...(document.fonts as unknown as Iterable<{ family: string }>)].some((f) => f.family === 'Roboto'),
    ).toBe(true);

    // GENUINE INSTALL (1): appData faces…
    const appWrites = (writeFile as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([path]) => (path as string).startsWith('/appdata/fonts/'),
    );
    expect(appWrites.length).toBeGreaterThanOrEqual(2);
    // GENUINE INSTALL (2): …AND the OS user fonts dir — system-wide:
    const osWrites = (writeFile as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([path]) => (path as string).startsWith('/home/u/.local/share/fonts/tensor/'),
    );
    expect(osWrites.map(([p]) => (p as string).split('/').pop())).toContain('roboto-regular.woff2');

    // PERSISTENCE: fonts.json carries the CATALOG entry (the
    // restart-wipe fix — closing Tensor must not lose downloads):
    const persistCall = (writeTextFile as ReturnType<typeof vi.fn>).mock.calls.find(
      ([path]) => (path as string).endsWith('fonts.json'),
    );
    const savedFile = JSON.parse((persistCall as unknown as [string, string])[1]);
    const saved = savedFile.entries.find((e: { family: string }) => e.family === 'Roboto');
    expect(saved.source).toBe('catalog');
    expect(saved.catalog).toBe('google');

    // RELAUNCH: fresh store, fonts.json on disk → the catalog font
    // re-registers (bytes read back from appDataDir()/fonts/).
    useFontRegistryStore.setState({ entries: [...BUNDLED_FONTS], epoch: 0, status: 'idle' });
    fixtures.fontsJson = (persistCall as unknown as [string, string])[1];
    await act(async () => {
      await useFontRegistryStore.getState().loadFromDisk();
    });
    const restored = useFontRegistryStore
      .getState()
      .entries.find((e) => e.family === 'Roboto' && e.source === 'catalog');
    expect(restored).toBeDefined();
    expect(
      [...(document.fonts as unknown as Iterable<{ family: string }>)].some((f) => f.family === 'Roboto'),
    ).toBe(true);
  });
});

// ─── 6. Failure: all-or-nothing cleanup ───────────────────────────────────

describe('download failure → no registry entry, no orphaned files, retryable', () => {
  it('a mid-install failure cleans up every written file', async () => {
    // The bold file's WRITE fails midway — after regular was written
    // (the registry's all-or-nothing cleanup path, exercised on disk).
    fixtures.failWriteOn = '-bold.woff2';
    useConfigStore.getState().setAllowFontCatalogs(true);
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'robo' } });
    });
    await waitDebounce();
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-row-roboto"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    expect(document.querySelector('[data-testid="catalog-row-roboto"]')).not.toBeNull();
    act(() => {
      fireEvent.click(document.querySelector('[data-testid="catalog-install"]')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    // No registry entry was created:
    expect(
      useFontRegistryStore.getState().entries.some((e) => e.family === 'Roboto' && e.source === 'catalog'),
    ).toBe(false);
    // The error state is retryable:
    expect(document.querySelector('[data-testid="catalog-install-error"]')).not.toBeNull();
    // No orphaned files: writeFile happened but remove cleaned them —
    // assert remove ran on the fonts dir (the cleanup path).
    const removes = (remove as ReturnType<typeof vi.fn>).mock.calls.filter(
      ([path]) => (path as string).startsWith('/appdata/fonts/'),
    );
    expect(removes.length).toBeGreaterThan(0);
    // Recovery: the failure cleared, retry succeeds.
    fixtures.failWriteOn = null;
    vi.clearAllMocks();
    act(() => {
      fireEvent.click([...document.querySelectorAll('button')].find((b) => b.textContent === 'Retry')!);
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(
      useFontRegistryStore.getState().entries.some((e) => e.family === 'Roboto' && e.source === 'catalog'),
    ).toBe(true);
  });
});

// ─── 7. No-silent-network ─────────────────────────────────────────────────

describe('no-silent-network', () => {
  it('OFF + the full OFF dialog surface: ZERO fetch_url invocations', async () => {
    const fetchSpy = invokeMock;
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    // Touch everything the OFF dialog exposes:
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    for (const q of ['rob', 'clash', 'geist', '']) {
      act(() => {
        fireEvent.change(search, { target: { value: q } });
      });
    }
    for (const id of ['all', 'bundled', 'system', 'uploaded', 'catalog']) {
      const chip = document.querySelector(`[data-testid="font-filter-${id}"]`);
      if (chip) {
        act(() => {
          fireEvent.click(chip);
        });
      }
    }
    await waitDebounce();
    expect(fetchSpy.mock.calls.filter(([cmd]) => cmd === 'fetch_url')).toHaveLength(0);
  });

  it('ON + boot prefetch: metadata idempotent, succeeded favicons never re-fetched, missing ones retried', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    await prefetchCatalogs();
    expect(fetchCalls()).toHaveLength(5); // 2 metadata + 3 favicons
    await prefetchCatalogs();
    // 6, not 10: metadata caches are idempotent and the two REAL
    // favicons (google, fontsource) are not re-fetched — only the
    // still-missing fontshare mark retried (HTML shell in the
    // fixture world — the retry-when-missing staleness fix).
    expect(fetchCalls()).toHaveLength(6);
    const byUrl = fetchCalls().map(([, args]) => (args as { url: string }).url);
    expect(byUrl.filter((u) => u.includes('fonts.google.com/metadata'))).toHaveLength(1);
    expect(byUrl.filter((u) => u.includes('www.google.com/favicon.ico'))).toHaveLength(1);
    expect(byUrl.filter((u) => u.includes('fontsource.org/favicon.ico'))).toHaveLength(1);
  });

  it('every fetched favicon renders in the badge/chip <img> — one mark source for all', async () => {
    useConfigStore.getState().setAllowFontCatalogs(true);
    await prefetchCatalogs();
    render(<FontBrowserDialog />);
    act(() => {
      useFontBrowserStore.getState().open();
    });
    const search = document.querySelector('[data-testid="font-search"]') as HTMLInputElement;
    act(() => {
      fireEvent.change(search, { target: { value: 'geist' } });
    });
    await waitDebounce();
    // The geist row's fontsource chip renders the fetched favicon
    // <img> (a REAL ICO in this fixture world):
    const geistRow = document.querySelector('[data-testid="catalog-row-geist"]')!;
    expect(geistRow.querySelector('[data-testid="catalog-chip-fontsource"]')?.querySelector('img[data-testid="brand-mark"]')).not.toBeNull();
    // Second search: Lora (all three sources in the fixtures).
    act(() => {
      fireEvent.change(search, { target: { value: 'lora' } });
    });
    await waitDebounce();
    const loraRow = document.querySelector('[data-testid="catalog-row-lora"]')!;
    expect(loraRow).not.toBeNull();
    // Google's chip is its favicon <img> too — one mark source for
    // ALL catalogs now (the user's favicon ruling):
    const gChip = loraRow.querySelector('[data-testid="catalog-chip-google"]')!;
    expect(gChip.querySelector('img[data-testid="brand-mark"]')).not.toBeNull();
    // Font Share served HTML → sniff rejected → no mark <img>, the
    // lucide fallback icon instead:
    const fsChip = loraRow.querySelector('[data-testid="catalog-chip-fontshare"]')!;
    expect(fsChip.querySelector('img')).toBeNull();
    expect(fsChip.querySelector('svg')).not.toBeNull();
  });
});
