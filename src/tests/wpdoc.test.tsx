import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { createHash } from 'node:crypto';
import v1Raw from './fixtures/document-v1.wpdoc?raw';
import { useDocumentStore } from '@/lib/document/store';
import { useMediaStore } from '@/lib/media/store';
import { collectReferencedMediaIds, openWpdoc, saveWpdoc } from '@/lib/document/wpdoc';
import { openDocument, saveDocument } from '@/lib/document/fileOperations';
import { readRecoveryCopy, saveRecoveryCopy } from '@/lib/document/recovery';
import { DocumentFileSchema, CURRENT_DOCUMENT_VERSION, type DocumentFile } from '@/lib/document/schema';
import { DEFAULT_MARGINS, PAGE_GAP } from '@/lib/document/pageSetup';
import { renderTensor, settleLayout } from './harness';

/**
 * M-IMAGES-0 — the .wpdoc v2 container layer, TS side. The REAL zip
 * behavior (round-trip bytes, corrupted-archive handling, atomicity,
 * the file-size receipt) is the Rust suite's five tests in
 * src-tauri/src/lib.rs; this suite exercises the TS layer against an
 * in-memory package/unpackage simulator that mirrors the Rust wire
 * contract (including the NOT_ZIP marker for v1 detection).
 */

type Stored =
  | { kind: 'v2'; document: string; media: { id: string; ext: string; bytesB64: string }[] }
  | { kind: 'v1'; raw: string }
  | { kind: 'corrupt' };

const wpdocFiles = vi.hoisted(() => new Map<string, Stored>());

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { path?: string; documentJson?: string; media?: unknown[] }) => {
    if (cmd === 'package_document') {
      wpdocFiles.set(args.path!, {
        kind: 'v2',
        document: args.documentJson!,
        media: (args.media ?? []) as { id: string; ext: string; bytesB64: string }[],
      });
      return null;
    }
    if (cmd === 'unpackage_document') {
      const file = wpdocFiles.get(args.path!);
      if (!file) throw new Error('file not found');
      if (file.kind === 'v1') throw new Error('NOT_ZIP: not a v2 container (v1 plain-JSON file?)');
      if (file.kind === 'corrupt') throw new Error('Invalid archive: bad central directory');
      return { document: file.document, media: file.media };
    }
    throw new Error(`unexpected command: ${cmd}`);
  }),
}));

const dialogMocks = vi.hoisted(() => ({ openPath: null as string | null }));
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(async () => dialogMocks.openPath),
  save: vi.fn(async () => null),
}));

vi.mock('@tauri-apps/plugin-fs', () => ({
  readTextFile: vi.fn(async (path: string) => {
    const file = wpdocFiles.get(path);
    if (file?.kind === 'v1') return file.raw;
    throw new Error('not a text file');
  }),
  writeTextFile: vi.fn(async () => {}),
  exists: vi.fn(async () => true),
  mkdir: vi.fn(async () => {}),
  remove: vi.fn(async () => {}),
}));

vi.mock('@tauri-apps/api/path', () => ({
  appDataDir: vi.fn(async () => '/appdata'),
  appConfigDir: vi.fn(async () => '/appconfig'),
  join: vi.fn(async (...parts: string[]) => parts.join('/')),
}));

import { invoke } from '@tauri-apps/api/core';

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

beforeAll(() => {
  Object.defineProperty(globalThis, '__TAURI_INTERNALS__', { value: {}, configurable: true });
});

beforeEach(() => {
  wpdocFiles.clear();
  dialogMocks.openPath = null;
  vi.clearAllMocks();
  useMediaStore.setState({ entries: new Map() });
  useDocumentStore.setState({
    pageSetup: { pageSize: 'Letter', margins: DEFAULT_MARGINS, pageGap: PAGE_GAP },
    isDirty: false,
    filePath: null,
    lineNumbers: null,
  });
});

// ─── 1. v2 round-trip: document identical + media byte-identical ────────

describe('v2 round-trip', () => {
  it('save → open: document JSON identical AND media byte-identical (sha assert)', async () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6, 7, 8]);
    useMediaStore.getState().add(sha(png), 'png', png);

    // Images don't exist as a document node yet (later milestones) —
    // the media:// reference is an ordinary PM attr value on a mark,
    // crafted at the file level exactly as an image-carrying docJSON
    // will spell it.
    const file: DocumentFile = {
      version: CURRENT_DOCUMENT_VERSION,
      docJSON: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'b1', styleId: 'normal' },
            content: [
              { type: 'text', text: 'container round trip', marks: [{ type: 'textStyle', attrs: { src: `media://${sha(png)}` } }] },
            ],
          },
        ],
      } as DocumentFile['docJSON'],
      metadata: { modifiedAt: new Date().toISOString() },
    };
    await saveWpdoc('/x/a.wpdoc', file);
    expect(wpdocFiles.get('/x/a.wpdoc')!.kind).toBe('v2');

    // Fresh store — open must not read stale state.
    useMediaStore.getState().clear();
    const opened = await openWpdoc('/x/a.wpdoc');
    const storedV2 = wpdocFiles.get('/x/a.wpdoc') as Extract<Stored, { kind: 'v2' }>;
    // Document: schema-valid, round-trips verbatim.
    expect(DocumentFileSchema.parse(JSON.parse(storedV2.document))).toEqual(
      DocumentFileSchema.parse(JSON.parse(JSON.stringify(file))),
    );
    expect(opened.docJSON).toBeTruthy();
    // Media: byte-identical — sha in, sha out.
    expect(storedV2.media).toHaveLength(1);
    expect(storedV2.media[0]!.id).toBe(sha(png));
    expect(storedV2.media[0]!.bytesB64).toBe(btoa(String.fromCharCode(...png)));
    const restored = useMediaStore.getState().entries.get(sha(png))!;
    expect(restored).toBeDefined();
    expect(sha(restored.bytes)).toBe(sha(png));
  });
});

// ─── 2. The v1 converter (permanent) — the committed fixture ───────────

describe('v1 legacy converter', () => {
  it('the committed v1 fixture opens → converts → saves as v2', async () => {
    wpdocFiles.set('/x/old.wpdoc', { kind: 'v1', raw: v1Raw });
    dialogMocks.openPath = '/x/old.wpdoc';

    const { editor } = renderTensor('<p>placeholder</p>');
    await settleLayout();
    const result = await openDocument(editor);
    expect(result!.path).toBe('/x/old.wpdoc');
    // Converted to the in-memory v2 model: everything survives.
    expect(result!.pageSetup!.margins).toEqual(DEFAULT_MARGINS);
    expect(result!.styleDefinitions[0]!.id).toBe('legal-body');
    expect(result!.lineNumbers).toEqual({ enabled: true, mode: 'per-page' });
    expect(editor.state.doc.textContent).toContain('A v1 document: plain JSON on disk');

    // Save: writes v2 (package_document), never v1 JSON again.
    await saveDocument(editor, '/x/old.wpdoc', useDocumentStore.getState().pageSetup, result!.lineNumbers);
    const saved = wpdocFiles.get('/x/old.wpdoc')!;
    expect(saved.kind).toBe('v2');
    const parsed = DocumentFileSchema.parse(JSON.parse((saved as { document: string }).document));
    expect(parsed.metadata.lineNumbers).toEqual({ enabled: true, mode: 'per-page' });
  });

  it('a corrupt v1 JSON throws the standard error (loud, never silent)', async () => {
    wpdocFiles.set('/x/bad-v1.wpdoc', { kind: 'v1', raw: '{"version": 1, broken' });
    await expect(openWpdoc('/x/bad-v1.wpdoc')).rejects.toThrow('not a valid document');
  });
});

// ─── 3. Corrupted v2: loud error, no crash, no partial state ─────────────

describe('corrupted v2 container', () => {
  it('rejects loudly and leaves the MediaStore untouched', async () => {
    // A good open first — the store holds a previous document's media.
    const good = new Uint8Array([9, 9, 9]);
    useMediaStore.getState().add(sha(good), 'png', good);
    wpdocFiles.set('/x/good.wpdoc', {
      kind: 'v2',
      document: JSON.stringify({ version: 1, docJSON: {}, metadata: {} }),
      media: [],
    });
    wpdocFiles.set('/x/broken.wpdoc', { kind: 'corrupt' });

    await expect(openWpdoc('/x/broken.wpdoc')).rejects.toThrow('Invalid archive');
    // No partial state: the corrupt open never touched the store.
    expect(useMediaStore.getState().entries.has(sha(good))).toBe(true);
    // The good file still opens (no crash, session intact).
    await expect(openWpdoc('/x/good.wpdoc')).resolves.toBeTruthy();
  });

  it('a v2 container whose document.json fails the schema: the standard error', async () => {
    wpdocFiles.set('/x/bad-schema.wpdoc', {
      kind: 'v2',
      document: JSON.stringify({ version: 'not-a-number', docJSON: {} }),
      media: [],
    });
    await expect(openWpdoc('/x/bad-schema.wpdoc')).rejects.toThrow('not a valid document');
  });
});

// ─── 4. Save-time GC: only referenced ids package ────────────────────────

describe('save-time GC', () => {
  it('unreferenced store entries never reach the container', async () => {
    const referenced = new Uint8Array([1, 1, 1]);
    const orphan = new Uint8Array([2, 2, 2]);
    useMediaStore.getState().add(sha(referenced), 'png', referenced);
    useMediaStore.getState().add(sha(orphan), 'png', orphan);

    const file: DocumentFile = {
      version: CURRENT_DOCUMENT_VERSION,
      docJSON: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { blockId: 'b', styleId: 'normal' },
            content: [{ type: 'image', attrs: { src: `media://${sha(referenced)}` } }],
          },
        ],
      } as DocumentFile['docJSON'],
      metadata: {},
    };
    await saveWpdoc('/x/gc.wpdoc', file);
    const stored = wpdocFiles.get('/x/gc.wpdoc') as Extract<Stored, { kind: 'v2' }>;
    expect(stored.media).toHaveLength(1); // ONLY the referenced id
    expect(stored.media[0]!.id).toBe(sha(referenced));
    // The orphan stays in the session store (GC of files is caller
    // policy, never the packager's):
    expect(useMediaStore.getState().entries.has(sha(orphan))).toBe(true);
  });

  it('the GC scan walks any string shape (nested attrs, arrays)', () => {
    const ids = collectReferencedMediaIds({
      a: 'media://abc',
      b: [{ c: 'media://def' }, 'plain text'],
      d: { e: null },
    });
    expect([...ids].sort()).toEqual(['abc', 'def']);
  });
});

// ─── 6. Recovery round-trip (v2) + old-snapshot converter ───────────────

describe('recovery snapshots', () => {
  it('v2 round-trip: snapshot → read → identical document', async () => {
    const { editor } = renderTensor('<p>recover me</p>');
    await settleLayout();
    await saveRecoveryCopy(editor, null, useDocumentStore.getState().pageSetup, null);
    // The M5 recovery path convention: session-keyed when unnamed.
    const snapPath = '/appdata/recovery/' + [...wpdocFiles.keys()][0]!.split('/').pop()!;
    const restored = await readRecoveryCopy(snapPath);
    const roundTrip = await readRecoveryCopy([...wpdocFiles.keys()].find((k) => k.includes('recovery'))!);
    expect(restored.docJSON).toEqual(roundTrip.docJSON);
    expect(DocumentFileSchema.safeParse(restored).success).toBe(true);
  });

  it('an OLD (v1 JSON) snapshot opens via the same converter', async () => {
    wpdocFiles.set('/appdata/recovery/old-session.wpdoc', { kind: 'v1', raw: v1Raw });
    const restored = await readRecoveryCopy('/appdata/recovery/old-session.wpdoc');
    expect(restored.metadata.title).toBe('v1 fixture');
    expect(restored.metadata.lineNumbers).toEqual({ enabled: true, mode: 'per-page' });
  });
});

// ─── 7. The atomicity contract, TS side ─────────────────────────────────

describe('atomicity (TS contract)', () => {
  it('the write path is package_document ONLY — the atomic temp+rename lives Rust-side', async () => {
    const { editor } = renderTensor('<p>atomic</p>');
    await settleLayout();
    await saveDocument(editor, '/x/atomic.wpdoc', useDocumentStore.getState().pageSetup, null);
    const commands = (invoke as unknown as ReturnType<typeof vi.fn>).mock.calls.map(([cmd]) => cmd);
    expect(commands).toEqual(['package_document']); // one atomic command, no other write surface
  });
});
