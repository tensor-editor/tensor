import { beforeEach, describe, expect, it } from 'vitest';
import { act } from '@testing-library/react';
import { renderTensor, settleLayout } from './harness';
import { DocumentFileSchema, CURRENT_DOCUMENT_VERSION, type DocumentFile } from '@/lib/document/schema';
import { useStyleRegistryStore } from '@/lib/styles/registry';
import { useStyleRegistryStore as registry } from '@/lib/styles/registry';
import { useDocumentStore } from '@/lib/document/store';
import type { StyleDefinition } from '@/lib/styles/types';

/**
 * M-STYLES STEP 5: persistence round-trips — the global file payload,
 * the per-document metadata merge, and the .wpdoc save/open shape
 * keeping styleIds. The Tauri fs layer itself is behind the plugin;
 * these tests pin the SCHEMA + the store flow around it (the exact
 * bytes writeDocumentAtomic writes are JSON of these objects).
 */

function resetRegistry() {
  registry.getState().setLayers({ global: [], doc: [] });
}

beforeEach(() => resetRegistry());

describe('.wpdoc metadata.styles (schema)', () => {
  it('parses a styles-bearing file; styles stay OPTIONAL for old files', () => {
    const withStyles = DocumentFileSchema.safeParse({
      version: 1,
      docJSON: { type: 'doc', content: [] },
      metadata: {
        styles: {
          definitions: [
            { id: 'legal-body', name: 'Legal Body', kind: 'paragraph', properties: { fontSize: 14 } },
          ],
        },
      },
    });
    expect(withStyles.success).toBe(true);
    expect(withStyles.data?.metadata.styles?.definitions[0]!.properties.fontSize).toBe(14);

    const oldFile = DocumentFileSchema.safeParse({
      version: 1,
      docJSON: { type: 'doc', content: [] },
      metadata: {},
    });
    expect(oldFile.success).toBe(true);
    expect(oldFile.data?.metadata.styles).toBeUndefined();
  });

  it('rejects malformed definitions loudly (schema is the gate)', () => {
    const bad = DocumentFileSchema.safeParse({
      version: 1,
      docJSON: {},
      metadata: { styles: { definitions: [{ id: 'x', name: 'X', kind: 'nonsense' }] } },
    });
    expect(bad.success).toBe(false);
  });
});

describe('.wpdoc round-trip (the saveDocument shape → open flow)', () => {
  it('save/open keeps styleIds AND the doc-layer definitions; doc overrides global by id', async () => {
    // Global layer: an edited quote.
    registry.getState().updateDefinition('quote', { properties: { italic: true, color: '#111111' } });
    // Doc layer: a custom definition the document depends on.
    const docDef: StyleDefinition = {
      id: 'legal-body',
      name: 'Legal Body',
      kind: 'paragraph',
      properties: { fontSize: 14, lineHeight: 1.5, firstLineIndent: 24 },
    };

    const { editor } = renderTensor('<p>Body one</p><h2>A head</h2>');
    await settleLayout();
    act(() => {
      editor.commands.setTextSelection(2);
      editor.commands.applyParagraphStyle('legal-body');
    });

    // SAVE (fileOperations.saveDocument's exact shape — the fs layer
    // writes JSON.stringify(file, null, 2) of this object):
    registry.getState().applyDocLayer([docDef]);
    const file: DocumentFile = {
      version: CURRENT_DOCUMENT_VERSION,
      docJSON: editor.getJSON(),
      metadata: {
        modifiedAt: new Date().toISOString(),
        styles: { definitions: registry.getState().docLayerForSave() },
      },
    };

    // Wire round-trip: JSON → schema parse (the openDocument gate).
    const parsed = DocumentFileSchema.parse(JSON.parse(JSON.stringify(file)));
    expect(parsed.metadata.styles?.definitions).toEqual([docDef]);
    // The docJSON kept the styleIds (they are ordinary PM attrs).
    const body = parsed.docJSON.content[0];
    expect(body.attrs.styleId).toBe('legal-body');
    expect(body.attrs.blockId).toBeTruthy();
    const head = parsed.docJSON.content[1];
    expect(head.attrs.styleId).toBe('heading-2');

    // OPEN: setContent + applyDocLayer — exactly what openDocument and
    // the document store do.
    registry.getState().setLayers({ global: [], doc: [] }); // simulate a fresh boot's empty doc layer
    act(() => {
      editor.commands.setContent(parsed.docJSON);
    });
    registry.getState().applyDocLayer(parsed.metadata.styles?.definitions ?? []);
    await settleLayout();

    const doc = useDocumentStore.getState().editor!.state.doc;
    expect(doc.firstChild!.attrs.styleId).toBe('legal-body');
    expect(doc.child(1).attrs.styleId).toBe('heading-2');

    // And the DOC layer's definition WINS over the global one by id
    // (the merge ruling): give global a legal-body edit, re-apply the
    // doc layer, the doc's version resolves.
    registry.getState().setLayers({
      global: [{ ...docDef, properties: { fontSize: 99 } }],
      doc: [docDef],
    });
    const merged = registry.getState().merged;
    expect(merged['legal-body'].properties.fontSize).toBe(14); // doc wins
    void useStyleRegistryStore;
  });
});
