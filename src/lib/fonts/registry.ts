import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { useDocumentStore } from '@/lib/document/store';
import { readFile, readTextFile, writeTextFile, writeFile, exists, mkdir, remove, copyFile } from '@tauri-apps/plugin-fs';
import { appConfigDir, appDataDir, homeDir, join } from '@tauri-apps/api/path';
import { BUNDLED_FONTS } from './bundled';
import type { CatalogId, CatalogDownload } from './catalogs/types';
import { parseFontFamilyName } from './fontName';

/**
 * M-FONTS-A — the installed-fonts registry. SHELL ONLY: fontFamily
 * already flows engine-side; this registry is what the shell's
 * measurement/paint one ruler (fontString) CONSUMES.
 *
 * Persistence (both halves of the styles/config precedents):
 *  - registry entries: appConfigDir()/fonts.json (uploaded only —
 *    bundled re-seed from code every launch)
 *  - font FILES: appDataDir()/fonts/ — uploads are COPIED there,
 *    never referenced in place (the recovery-dir precedent).
 *
 * registerFont(entry) is THE one registration primitive: FontFace per
 * file → document.fonts.add → await load → epoch bump. The epoch is
 * what PaginatedView re-gates on (fonts re-load before any measure)
 * and then recreates the engine for — the shell's stale-cache remedy
 * (see PaginatedView's font-epoch effect for the cache law).
 */

export interface FontFiles {
  regular: string;
  bold?: string;
  italic?: string;
  boldItalic?: string;
}

export type FontSource = 'bundled' | 'system' | 'uploaded' | 'catalog';

export type CatalogIdRef = import('./catalogs/types').CatalogId;

export interface FontEntry {
  id: string;
  family: string;
  displayName: string;
  /** 'bundled' = ships with Tensor (Fontsource curated + Geist);
   *  'system' = the OS's fallback families (no files);
   *  'uploaded' = the user's uploads (files in appDataDir()/fonts/);
   *  'catalog' = downloaded from an online catalog (M-FONTS-B). */
  source: FontSource;
  /** For source 'catalog': WHICH catalog it came from (badge + chip). */
  catalog?: CatalogIdRef;
  /** Script direction for the LTR/RTL badge — derived at install time
   *  from the source's subsets (arabic/hebrew → rtl); default ltr. */
  direction?: 'ltr' | 'rtl';
  /** Uploaded: file names inside appDataDir()/fonts/. Bundled
   *  Fontsource: per-face CSS specifiers (bundled.ts). System
   *  fallbacks: undefined — the OS resolves them. */
  files?: FontFiles;
  /** Variable fonts (the Geist Variable precedent): 700 weights the
   *  axis — there is no static bold file; see fontString's
   *  two-worlds comment (metrics.ts). */
  variable?: boolean;
  status: 'ready' | 'error';
}

interface FontsFile {
  version: 1;
  entries: FontEntry[];
}

interface FontRegistryState {
  /** Bundled (always re-seeded) + uploaded (from fonts.json). */
  entries: FontEntry[];
  /** Bumped on every successful register/unregister — the live
   *  relayout signal PaginatedView consumes. */
  epoch: number;
  /** The ribbon picker's "recently used" section — most recent
   *  first, capped at 5, session-scoped (app preference, not
   *  persisted). Recorded on every font applied to a selection. */
  recentFamilies: string[];
  noteRecentFont: (family: string) => void;
  /** Whether loadFromDisk ran (app bootstrap). */
  status: 'idle' | 'ready' | 'error';
  loadFromDisk: () => Promise<void>;
  /** THE registration primitive: bytes → FontFace(s) →
   *  document.fonts.add → await load. Returns false (and marks the
   *  entry 'error') when a face fails to load. Idempotent per entry
   *  id — re-registering replaces the faces. */
  registerFont: (entry: FontEntry) => Promise<boolean>;
  /** Upload flow (see upload.ts): copy the file into appDataDir()/
   *  fonts/, register, persist. */
  addUploaded: (input: { family: string; displayName: string; sourcePath: string }) => Promise<FontEntry | null>;
  /** M-FONTS-B catalog install — ALL-OR-NOTHING: every face's bytes
   *  are written into appDataDir()/fonts/ before anything registers;
   *  any failure removes the partial files and returns null (no
   *  orphaned files, no partial registry entries per family). */
  addCatalogFont: (input: {
    family: string;
    displayName: string;
    catalog: CatalogId;
    download: CatalogDownload;
    direction?: 'ltr' | 'rtl';
  }) => Promise<FontEntry | null>;
  uninstall: (id: string) => Promise<void>;
}

async function fontsFilePath(): Promise<string> {
  const dir = await appConfigDir();
  return join(dir, 'fonts.json');
}

async function fontsDirPath(): Promise<string> {
  const dir = await appDataDir();
  return join(dir, 'fonts');
}

/**
 * M-FONTS-B: a genuine install also lands in the OS user fonts
 * directory (~/.local/share/fonts/tensor/ — fontconfig scans XDG
 * fonts recursively, so the family becomes available system-wide).
 * Tensor's OWN registration stays sourced from appDataDir()/fonts/
 * (never depends on fontconfig cache state); this copy is for the
 * rest of the PC. Uninstall removes both. Failures here degrade to
 * app-local-only — never fail the install.
 */
async function osFontsDirPath(): Promise<string> {
  return join(await homeDir(), '.local', 'share', 'fonts', 'tensor');
}

/** OS copy naming — deterministic per family + face key. */
function osFontFileName(family: string, key: string): string {
  const safe = family.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return `${safe || 'font'}-${key}.woff2`;
}

async function installToOs(family: string, faces: [string, Uint8Array][]): Promise<void> {
  try {
    const dir = await osFontsDirPath();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    for (const [key, bytes] of faces) {
      await writeFile(await join(dir, osFontFileName(family, key)), bytes);
    }
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[fonts] OS-level install skipped (app-local install stands):', err);
    }
  }
}

async function removeFromOs(family: string, keys: string[]): Promise<void> {
  try {
    const dir = await osFontsDirPath();
    for (const key of keys) {
      const path = await join(dir, osFontFileName(family, key));
      if (await exists(path)) await remove(path);
    }
  } catch {
    // best-effort — the app-local uninstall is the canonical one
  }
}

function faceSpecs(entry: FontEntry): { file: string; weight: string; style: string }[] {
  if (!entry.files) return [];
  const specs: { file: string; weight: string; style: string }[] = [
    { file: entry.files.regular, weight: '400', style: 'normal' },
  ];
  if (entry.files.bold) specs.push({ file: entry.files.bold, weight: '700', style: 'normal' });
  if (entry.files.italic) specs.push({ file: entry.files.italic, weight: '400', style: 'italic' });
  if (entry.files.boldItalic) specs.push({ file: entry.files.boldItalic, weight: '700', style: 'italic' });
  return specs;
}

/** Faces registered this session (family → FontFace[]), so uninstall
 *  can delete them and re-registration replaces cleanly. jsdom note:
 *  the test setup provides FontFace/document.fonts stubs — this code
 *  path is the REAL one, unmocked. */
const registeredFaces = new Map<string, FontFace[]>();

async function buildFaces(entry: FontEntry): Promise<FontFace[]> {
  const FontFaceCtor = (globalThis as { FontFace?: new (family: string, source: ArrayBuffer, descriptors: { weight?: string; style?: string }) => FontFace }).FontFace;
  if (typeof FontFaceCtor !== 'function' || typeof document === 'undefined' || !document.fonts) {
    return [];
  }
  const dir = await fontsDirPath();
  const faces: FontFace[] = [];
  for (const spec of faceSpecs(entry)) {
    const bytes = await readFile(await join(dir, spec.file));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const face = new FontFaceCtor(entry.family, buffer, {
      weight: spec.weight,
      style: spec.style,
    });
    document.fonts.add(face);
    faces.push(face);
  }
  return faces;
}

/** The styles-registry warned-set precedent: one dev warning per
 *  family per session — never silent, never spammy. */
const warnedUnavailableFamilies = new Set<string>();

export function warnFontUnavailable(family: string): void {
  if (warnedUnavailableFamilies.has(family)) return;
  warnedUnavailableFamilies.add(family);
  if (import.meta.env.DEV) {
    console.warn(
      `[fonts] family '${family}' is not registered — text renders with the system substitute.`,
    );
  }
}

async function persistRegistry(entries: FontEntry[]): Promise<void> {
  // Outside the Tauri webview (vitest/jsdom, plain browser) there is
  // no appConfigDir — skip silently there (writeGlobalFile precedent).
  if (!('__TAURI_INTERNALS__' in globalThis)) return;
  try {
    // EVERYTHING the user installed persists — uploads AND catalog
    // downloads (the M-FONTS-B fix: closing Tensor must not wipe
    // downloaded fonts). Bundled/system re-seed from code.
    const file: FontsFile = {
      version: 1,
      entries: entries.filter((e) => e.source === 'uploaded' || e.source === 'catalog'),
    };
    const path = await fontsFilePath();
    const dir = await appConfigDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await writeTextFile(path, JSON.stringify(file, null, 2));
  } catch (err) {
    if (import.meta.env.DEV) {
      console.warn('[fonts] failed to persist fonts.json (entries stay in-session):', err);
    }
  }
}

export const useFontRegistryStore = create<FontRegistryState>((set, get) => ({
  entries: [...BUNDLED_FONTS],
  epoch: 0,
  status: 'idle',
  recentFamilies: [],

  noteRecentFont: (family) =>
    set((s) => ({
      recentFamilies: [family, ...s.recentFamilies.filter((f) => f !== family)].slice(0, 5),
    })),

  loadFromDisk: async () => {
    try {
      const path = await fontsFilePath();
      let uploaded: FontEntry[] = [];
      if (await exists(path)) {
        const raw = await readTextFile(path);
        uploaded = (JSON.parse(raw) as FontsFile).entries ?? [];
      }
      // Re-register every uploaded face from disk BEFORE the view's
      // font gate settles — the relaunch flow must never measure with
      // substitutes for a font that is installed.
      for (const entry of uploaded) {
        await get().registerFont(entry);
      }
      set((s) => ({
        entries: [
          ...BUNDLED_FONTS,
          ...s.entries.filter((e) => e.source === 'uploaded' || e.source === 'catalog'),
        ],
        status: 'ready',
      }));
    } catch {
      set({ status: 'error' });
    }
  },

  registerFont: async (entry) => {
    let ok = true;
    try {
      // Replace: uninstall old faces for the same family first
      // (re-registration must not leak face duplicates).
      for (const face of registeredFaces.get(entry.family) ?? []) {
        document.fonts?.delete(face);
      }
      const faces = await buildFaces(entry);
      registeredFaces.set(entry.family, faces);
      for (const face of faces) {
        try {
          await face.load();
        } catch {
          ok = false;
        }
      }
    } catch {
      ok = false;
    }
    set((s) => ({
      entries: [
        ...s.entries.filter((e) => e.id !== entry.id),
        { ...entry, status: ok ? 'ready' : 'error' },
      ],
      epoch: s.epoch + 1,
    }));
    return ok;
  },

  addUploaded: async ({ family, displayName, sourcePath }) => {
    try {
      const dir = await fontsDirPath();
      if (!(await exists(dir))) await mkdir(dir, { recursive: true });
      // COPIED into appDataDir()/fonts/ — never referenced in place.
      const id = nanoid(8);
      const base = sourcePath.split(/[\\/]/).pop() ?? 'font.ttf';
      const fileName = `${id}-${base.replace(/[^\w.-]/g, '_')}`;
      await copyFile(sourcePath, await join(dir, fileName));
      const entry: FontEntry = {
        id: `uploaded:${id}`,
        family,
        displayName,
        source: 'uploaded',
        files: { regular: fileName },
        status: 'ready',
      };
      const ok = await get().registerFont(entry);
      if (!ok) return null;
      // Genuine install: the OS copy rides the same bytes (read back
      // from the app-local file, never the possibly-out-of-scope
      // source path).
      await installToOs(family, [['regular', await readFile(await join(dir, fileName))]]);
      await persistRegistry(get().entries);
      return entry;
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[fonts] upload failed:', err);
      return null;
    }
  },

  addCatalogFont: async ({ family, displayName, catalog, download, direction }) => {
    const dir = await fontsDirPath();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    const id = nanoid(8);
    const written: string[] = [];
    const names: FontFiles = { regular: `${id}-regular.woff2` };
    try {
      const faces: [keyof FontFiles, Uint8Array | undefined, string][] = [
        ['regular', download.files.regular, `${id}-regular.woff2`],
        ['bold', download.files.bold, `${id}-bold.woff2`],
        ['italic', download.files.italic, `${id}-italic.woff2`],
        ['boldItalic', download.files.boldItalic, `${id}-bold-italic.woff2`],
      ];
      for (const [key, bytes, fileName] of faces) {
        if (!bytes) continue;
        await writeFile(await join(dir, fileName), bytes);
        written.push(fileName);
        names[key] = fileName;
      }
      const entry: FontEntry = {
        id: `catalog:${catalog}:${id}`,
        family,
        displayName,
        source: 'catalog',
        catalog,
        files: names,
        variable: download.variable,
        ...(direction ? { direction } : {}),
        status: 'ready',
      };
      const ok = await get().registerFont(entry);
      if (!ok) throw new Error('face registration failed');
      // Genuine install: the same faces land in the OS user fonts dir
      // (system-wide availability); failures degrade to app-local.
      await installToOs(
        family,
        faces
          .filter(([, bytes]) => bytes != null)
          .map(([key, bytes]) => [key as string, bytes!] as [string, Uint8Array]),
      );
      await persistRegistry(get().entries);
      return entry;
    } catch (err) {
      // All-or-nothing cleanup: remove every file written this call.
      for (const fileName of written) {
        try {
          const path = await join(dir, fileName);
          if (await exists(path)) await remove(path);
        } catch {
          // best-effort cleanup; the entry was never persisted
        }
      }
      if (import.meta.env.DEV) console.warn('[fonts] catalog install failed (cleaned up):', err);
      return null;
    }
  },

  uninstall: async (id) => {
    const entry = get().entries.find((e) => e.id === id);
    if (!entry || (entry.source !== 'uploaded' && entry.source !== 'catalog')) return;
    // The warned-set site (styles precedent): if the current document
    // references the family, its text now renders with the system
    // substitute — warn ONCE per family per session, never silent.
    // Here in the STORE (not the dialog) so every uninstall surface
    // warns identically.
    const docJSON = useDocumentStore.getState().editor?.getJSON();
    if (docJSON && JSON.stringify(docJSON).includes(entry.family)) {
      warnFontUnavailable(entry.family);
    }
    for (const face of registeredFaces.get(entry.family) ?? []) {
      document.fonts?.delete(face);
    }
    registeredFaces.delete(entry.family);
    try {
      const dir = await fontsDirPath();
      for (const spec of faceSpecs(entry)) {
        const path = await join(dir, spec.file);
        if (await exists(path)) await remove(path);
      }
    } catch (err) {
      if (import.meta.env.DEV) console.warn('[fonts] failed to remove font files:', err);
    }
    await removeFromOs(entry.family, Object.keys(entry.files ?? {}));
    set((s) => ({ entries: s.entries.filter((e) => e.id !== id), epoch: s.epoch + 1 }));
    await persistRegistry(get().entries);
  },
}));

// ─── Upload staging (dialog-facing) ─────────────────────────────────────

export interface StagedUpload {
  sourcePath: string;
  /** Parsed from the sfnt name table (.ttf/.otf); null for .woff2 —
   *  the filename convention takes over (brotli decompression is not
   *  free — the receipt that ruled the parser's scope). */
  detectedFamily: string | null;
  /** Filename-derived fallback ('my-font.ttf' → 'My Font'). */
  fallbackName: string;
}

/** 'my-font.ttf' / 'MyFont.otf' → 'My Font'. Title-cases each word —
 *  the convention only names .woff2 (unparseable) uploads; the sfnt
 *  parser names real TTF/OTFs. */
export function filenameToFamily(fileName: string): string {
  const stem = fileName.replace(/[\\/]/g, '/').split('/').pop() ?? '';
  const noExt = stem.replace(/\.(ttf|otf|woff2)$/i, '');
  const spaced = noExt.replace(/[-_]+/g, ' ').trim();
  if (!spaced) return 'Custom Font';
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Read the picked file's metadata for the confirm dialog (bytes are
 *  re-read at copy time — the file is never referenced in place). */
export async function detectUploadFamily(sourcePath: string): Promise<StagedUpload> {
  const fallbackName = filenameToFamily(sourcePath);
  try {
    const bytes = await readFile(sourcePath);
    const detected = parseFontFamilyName(bytes);
    return { sourcePath, detectedFamily: detected, fallbackName };
  } catch {
    return { sourcePath, detectedFamily: null, fallbackName };
  }
}
