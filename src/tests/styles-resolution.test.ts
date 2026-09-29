import { describe, expect, it } from 'vitest';
import {
  baselineRunStyle,
  captureFromResolved,
  cssDeclarations,
  inlineStyle,
  resolveBlockTier,
  resolveRun,
  transformText,
} from '@/lib/styles/resolve';
import type { StyleDefinition } from '@/lib/styles/types';

/**
 * M-STYLES STEP 5 + addendum 4: the cascade precedence matrix, per
 * property, including the new ones (fontVariant, textTransform), for
 * THE one resolution function. Weak → strong:
 *   baseStyle < paragraph style < paragraph attrs < charStyle < direct marks
 */

const BASE = baselineRunStyle({ fontFamily: 'system-ui', fontSize: 16 });

function def(properties: StyleDefinition['properties'], kind: StyleDefinition['kind'] = 'paragraph'): StyleDefinition {
  return { id: 'test', name: 'Test', kind, properties };
}

describe('resolveRun cascade (per property)', () => {
  it('base alone: complete values, never undefined', () => {
    const r = resolveRun({ base: BASE });
    expect(r).toEqual(BASE);
    // The invariant: every property concrete.
    expect(r.fontFamily).toBe('system-ui');
    expect(r.fontSize).toBe(16);
    expect(r.bold).toBe(false);
    expect(r.color).toBe('#000000');
    expect(r.lineHeight).toBe(1);
    expect(r.fontVariant).toBe('normal');
    expect(r.textTransform).toBe('none');
  });

  it('paragraph style overrides base, per property', () => {
    const r = resolveRun({
      base: BASE,
      para: def({ fontSize: 24, bold: true, lineHeight: 1.5, fontVariant: 'small-caps', textTransform: 'uppercase' }),
    });
    expect(r.fontSize).toBe(24);
    expect(r.bold).toBe(true);
    expect(r.lineHeight).toBe(1.5);
    expect(r.fontVariant).toBe('small-caps');
    expect(r.textTransform).toBe('uppercase');
    // Untouched properties stay at the baseline.
    expect(r.fontFamily).toBe('system-ui');
    expect(r.italic).toBe(false);
    expect(r.color).toBe('#000000');
  });

  it('char style overrides paragraph style (per property)', () => {
    const r = resolveRun({
      base: BASE,
      para: def({ fontSize: 24, bold: true, color: '#111111' }),
      char: def({ fontSize: 20, bold: false, color: '#222222' }, 'character'),
    });
    expect(r.fontSize).toBe(20);
    // Direct bold beats a char-style non-bold — pinned separately
    // below; here the char style beats the paragraph style.
    expect(r.bold).toBe(false);
    expect(r.color).toBe('#222222');
  });

  it('DIRECT MARKS beat everything (the flagship precedence): direct bold beats a char-style non-bold', () => {
    const r = resolveRun({
      base: BASE,
      para: def({ bold: true, fontSize: 24 }),
      char: def({ bold: false, fontSize: 20 }, 'character'),
      direct: { bold: true, fontSize: 18 },
    });
    expect(r.bold).toBe(true); // direct wins over char's explicit false
    expect(r.fontSize).toBe(18); // direct wins over char and para
  });

  it('paragraph attrs (paraDirect) sit between paragraph style and char style', () => {
    const r = resolveRun({
      base: BASE,
      para: def({ lineHeight: 1.5 }),
      paraDirect: { lineHeight: 2 },
      char: def({ lineHeight: 3 }, 'character'),
    });
    expect(r.lineHeight).toBe(3); // char beats direct block attrs
    const r2 = resolveRun({
      base: BASE,
      para: def({ lineHeight: 1.5 }),
      paraDirect: { lineHeight: 2 },
    });
    expect(r2.lineHeight).toBe(2); // attrs beat the style
  });

  it('new properties in the matrix: fontVariant and textTransform cascade independently', () => {
    const r = resolveRun({
      base: BASE,
      para: def({ fontVariant: 'small-caps', textTransform: 'uppercase' }),
      char: def({ textTransform: 'lowercase' }, 'character'),
      direct: { fontVariant: 'normal' },
    });
    // Per property: char beats para (textTransform), direct beats all
    // (fontVariant), untouched para value survives (nothing else set it).
    expect(r.fontVariant).toBe('normal');
    expect(r.textTransform).toBe('lowercase');
  });
});

describe('resolveBlockTier', () => {
  it('attrs beat the style; the style fills unset attrs', () => {
    const t1 = resolveBlockTier(
      def({ spaceBefore: 10, indentLeft: 32, firstLineIndent: 24, textAlign: 'center' }),
      {}
    );
    expect(t1.spaceBefore).toBe(10);
    expect(t1.indentLeft).toBe(32);
    expect(t1.firstLineIndent).toBe(24);
    expect(t1.align).toBe('center');

    const t2 = resolveBlockTier(
      def({ spaceBefore: 10, indentLeft: 32, firstLineIndent: 24 }),
      { spaceBefore: 40, indentLeft: 64, textAlign: 'right' }
    );
    expect(t2.spaceBefore).toBe(40);
    expect(t2.indentLeft).toBe(64);
    expect(t2.align).toBe('right');
    // Style value survives for attrs the block did not set.
    expect(t2.firstLineIndent).toBe(24);
  });

  it('baseIndentLeft (list/blockquote gutter) is additive', () => {
    const t = resolveBlockTier(def({ indentLeft: 10 }), {}, 32);
    expect(t.indentLeft).toBe(42);
  });
});

describe('transformText', () => {
  it('uppercase/lowercase', () => {
    expect(transformText('hello WORLD', 'uppercase')).toBe('HELLO WORLD');
    expect(transformText('hello WORLD', 'lowercase')).toBe('hello world');
  });

  it('capitalize: first letter of each word uppercased, other chars UNTOUCHED (CSS semantics)', () => {
    expect(transformText('hello world', 'capitalize')).toBe('Hello World');
    // CSS: only the first letter is affected — 'hELLO' → 'HELLO'.
    expect(transformText('hELLO wORLD', 'capitalize')).toBe('HELLO WORLD');
  });

  it("'title-case' renders as capitalize in v1 (the documented divergence)", () => {
    expect(transformText('the quick brown fox', 'title-case')).toBe('The Quick Brown Fox');
  });

  it('none / undefined are pass-through', () => {
    expect(transformText('Hello', 'none')).toBe('Hello');
    expect(transformText('Hello', undefined as unknown as 'none')).toBe('Hello');
  });

  it('LENGTH-PRESERVING (the v1 ban): every allowed transform keeps source↔output 1:1', () => {
    const samples = ['hello world', 'MiXeD CaSe 123 !?', 'Ünïcödé ß-tëst', ''];
    for (const text of samples) {
      for (const transform of ['uppercase', 'lowercase', 'capitalize', 'title-case'] as const) {
        expect(transformText(text, transform).length).toBe(text.length);
      }
    }
    // DOCUMENTED DIVERGENCE: ß expands to 'SS' under CSS uppercase; v1
    // leaves length-changing characters UNCHANGED so the offset
    // identity holds for every document (true expansion is 'M-later').
    expect(transformText('ß', 'uppercase')).toBe('ß');
  });
});

describe('captureFromResolved (reverse resolution)', () => {
  it('RECEIPT: capture from a directly-bolded Normal span → definition includes bold', () => {
    const resolved = resolveRun({ base: BASE, direct: { bold: true } });
    const captured = captureFromResolved(resolved, BASE);
    expect(captured).toEqual({ bold: true });
  });

  it('capture of untouched Normal is empty properties', () => {
    expect(captureFromResolved(resolveRun({ base: BASE }), BASE)).toEqual({});
  });

  it('captures the effective cascade, not just direct marks', () => {
    const resolved = resolveRun({ base: BASE, para: def({ italic: true }), direct: { fontSize: 20 } });
    expect(captureFromResolved(resolved, BASE)).toEqual({ italic: true, fontSize: 20 });
  });
});

describe('CSS serialization (one mapper, both consumers)', () => {
  it('declares every defined property; bold false is an explicit 400', () => {
    const decls = cssDeclarations({ fontSize: 14, bold: false, textTransform: 'title-case' });
    expect(decls).toContain('font-size: 14px');
    expect(decls).toContain('font-weight: 400');
    // title-case has no CSS spelling — capitalize is the documented v1
    // divergence.
    expect(decls).toContain('text-transform: capitalize');
  });

  it('inlineStyle is the same mapping in React camelCase (the dialog preview)', () => {
    const s = inlineStyle({ fontSize: 14, lineHeight: 1.5, firstLineIndent: 24, fontVariant: 'small-caps' });
    expect(s.fontSize).toBe('14px');
    expect(s.lineHeight).toBe('1.5');
    expect(s.textIndent).toBe('24px');
    expect(s.fontVariant).toBe('small-caps');
  });

  it('underline + strike combine into one text-decoration', () => {
    expect(cssDeclarations({ underline: true, strike: true })).toContain(
      'text-decoration: underline line-through'
    );
  });
});
