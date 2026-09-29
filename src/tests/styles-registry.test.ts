import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useStyleRegistryStore, lookupStyle } from '@/lib/styles/registry';
import { BUILTIN_DEFINITIONS, LEGACY_HEADING_FALLBACK } from '@/lib/styles/builtins';
import { isBuiltinId, type StyleDefinition } from '@/lib/styles/types';

/**
 * M-STYLES STEP 5: registry semantics — merge precedence, the missing
 * loud fallback, built-in immutability of id, epoch bumps.
 */

function resetRegistry() {
  useStyleRegistryStore.getState().setLayers({ global: [], doc: [] });
  // The warned-missing set is module state — clear via a fresh id
  // vocabulary per test instead (no reset seam; ids here are unique
  // per test).
}

describe('registry merge', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('builtins ← global ← doc (doc overrides global by id)', () => {
    const globalQuote: StyleDefinition = { id: 'quote', name: 'Quote', kind: 'paragraph', properties: { italic: true, color: '#123456' } };
    const docQuote: StyleDefinition = { id: 'quote', name: 'Quote', kind: 'paragraph', properties: { italic: false } };
    useStyleRegistryStore.getState().setLayers({ global: [globalQuote], doc: [] });
    let merged = useStyleRegistryStore.getState().merged;
    expect(merged.quote.properties.color).toBe('#123456');

    useStyleRegistryStore.getState().applyDocLayer([docQuote]);
    merged = useStyleRegistryStore.getState().merged;
    expect(merged.quote.properties).toEqual({ italic: false }); // doc wins, wholesale
  });

  it('custom ids merge beside builtins', () => {
    const legal: StyleDefinition = { id: 'legal-body', name: 'Legal Body', kind: 'paragraph', properties: { fontSize: 14 } };
    useStyleRegistryStore.getState().setLayers({ global: [legal], doc: [] });
    const merged = useStyleRegistryStore.getState().merged;
    expect(merged['legal-body'].properties.fontSize).toBe(14);
    expect(Object.keys(merged).length).toBe(BUILTIN_DEFINITIONS.length + 1);
  });

  it('docLayerForSave round-trips what the file carried', () => {
    const docDef: StyleDefinition = { id: 'quote', name: 'Quote', kind: 'paragraph', properties: { italic: false } };
    useStyleRegistryStore.getState().applyDocLayer([docDef]);
    expect(useStyleRegistryStore.getState().docLayerForSave()).toEqual([docDef]);
  });
});

describe('missing definition fallback (loud, once)', () => {
  it('lookupStyle: unknown id → null + ONE dev warning per id, never silent', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const defs = useStyleRegistryStore.getState().merged;
      expect(lookupStyle('ghost-style', defs)).toBeNull();
      expect(lookupStyle('ghost-style', defs)).toBeNull();
      expect(lookupStyle('ghost-style', defs)).toBeNull();
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn.mock.calls[0][0]).toContain('ghost-style');
    } finally {
      warn.mockRestore();
    }
  });

  it('reserved keyboard-heading ids (heading-4..6) fall back SILENTLY to the legacy defaults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const defs = useStyleRegistryStore.getState().merged;
      const h5 = lookupStyle('heading-5', defs);
      expect(h5?.properties).toEqual(LEGACY_HEADING_FALLBACK['heading-5']);
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('built-in immutability', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('fixed built-ins CANNOT be deleted — delete throws loudly', () => {
    expect(() => useStyleRegistryStore.getState().deleteDefinition('normal')).toThrow(/cannot be deleted/);
    expect(() => useStyleRegistryStore.getState().deleteDefinition('heading-2')).toThrow(/cannot be deleted/);
    expect(() => useStyleRegistryStore.getState().deleteDefinition('strong')).toThrow(/cannot be deleted/);
    // and they survive:
    expect(useStyleRegistryStore.getState().merged.normal).toBeDefined();
  });

  it('built-ins CAN be edited (name + properties), id never changes', () => {
    useStyleRegistryStore.getState().updateDefinition('heading-1', {
      name: 'Titre 1',
      properties: { fontSize: 40, bold: true },
    });
    const merged = useStyleRegistryStore.getState().merged;
    expect(merged['heading-1'].name).toBe('Titre 1');
    expect(merged['heading-1'].id).toBe('heading-1');
    expect(merged['heading-1'].properties.fontSize).toBe(40);
    // The edit lives in the global layer (styles.json's payload):
    const globalIds = useStyleRegistryStore.getState().globalLayerForFile().map((d) => d.id);
    expect(globalIds).toContain('heading-1');
  });

  it('rename changes name ONLY, never id (customs)', () => {
    const created = useStyleRegistryStore.getState().createDefinition({
      name: 'Legal Body',
      kind: 'paragraph',
      properties: { fontSize: 14 },
    });
    useStyleRegistryStore.getState().updateDefinition(created.id, {
      name: 'Legal Body Renamed',
    });
    const merged = useStyleRegistryStore.getState().merged;
    expect(merged[created.id].name).toBe('Legal Body Renamed');
    expect(merged[created.id].properties.fontSize).toBe(14);
  });

  it('customs CAN be deleted; a doc-layer copy dies with the style', () => {
    const created = useStyleRegistryStore.getState().createDefinition({
      name: 'Temporary',
      kind: 'paragraph',
      properties: {},
    });
    useStyleRegistryStore.getState().applyDocLayer([
      { id: created.id, name: 'Temporary', kind: 'paragraph', properties: { fontSize: 18 } },
    ]);
    useStyleRegistryStore.getState().deleteDefinition(created.id);
    const { merged, doc } = useStyleRegistryStore.getState();
    expect(merged[created.id]).toBeUndefined();
    expect(doc[created.id]).toBeUndefined();
  });

  it('isBuiltinId separates fixed from custom ids', () => {
    expect(isBuiltinId('normal')).toBe(true);
    expect(isBuiltinId('heading-3')).toBe(true);
    expect(isBuiltinId('emphasis')).toBe(true);
    expect(isBuiltinId('legal-body')).toBe(false);
    expect(isBuiltinId('hyperlink')).toBe(false);
  });
});

describe('registry epoch', () => {
  beforeEach(() => resetRegistry());
  afterEach(() => resetRegistry());

  it('ANY definition mutation bumps the epoch (the adapter-cache mirror of baseStyleHash)', () => {
    const e0 = useStyleRegistryStore.getState().epoch;
    useStyleRegistryStore.getState().updateDefinition('quote', { properties: { italic: true, color: '#111111' } });
    const e1 = useStyleRegistryStore.getState().epoch;
    expect(e1).toBe(e0 + 1);

    const created = useStyleRegistryStore.getState().createDefinition({
      name: 'Another One',
      kind: 'paragraph',
      properties: {},
    });
    expect(useStyleRegistryStore.getState().epoch).toBe(e1 + 1);

    useStyleRegistryStore.getState().deleteDefinition(created.id);
    expect(useStyleRegistryStore.getState().epoch).toBe(e1 + 2);

    useStyleRegistryStore.getState().applyDocLayer([]);
    expect(useStyleRegistryStore.getState().epoch).toBe(e1 + 3);
  });

  it('createDefinition slugs the name and uniquifies', () => {
    const a = useStyleRegistryStore.getState().createDefinition({ name: 'Legal Body', kind: 'paragraph', properties: {} });
    const b = useStyleRegistryStore.getState().createDefinition({ name: 'Legal Body', kind: 'paragraph', properties: {} });
    expect(a.id).toBe('legal-body');
    expect(b.id).toBe('legal-body-2');
  });
});
