import { CaseSensitive } from 'lucide-react';
import { RibbonIconInput } from '../RibbonIconInput';
import type { Editor } from '@tiptap/core';
import { FONT_STEP_PT, fontPxToDisplayPt, fontPtToPx } from '@/lib/editor/fontSize';

interface FontSizeInputProps {
  editor: Editor;
  /** Core value as a px string/number ('16px' | '16'), or the config
   * default as a string. DISPLAY-FACING INPUT: everything converts
   * pt ↔ px here; the core never sees pt. */
  currentSize: string;
}

/** The Font Size box speaks POINTS (chrome law); commits px (core
 * law). Bounds are pt: 1–300pt ≙ the old 1–400px core range. The
 * tickers (and ↑/↓ keys) step by 2pt — the same increment the
 * Ctrl+Shift+> / Ctrl+Shift+< shortcuts use. */
export function FontSizeInput({ editor, currentSize }: FontSizeInputProps) {
  const px = Number(currentSize) || 16;
  return (
    <RibbonIconInput
      label="Font Size"
      icon={<CaseSensitive size={14} />}
      value={fontPxToDisplayPt(px)}
      min={1}
      max={300}
      width="w-16"
      showSteppers
      stepAmount={FONT_STEP_PT}
      onCommit={(pt) => editor.chain().focus().setFontSize(`${fontPtToPx(pt)}px`).run()}
    />
  );
}
