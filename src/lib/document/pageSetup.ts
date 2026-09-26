// Package-root import only — deep '@tensor-editor/engine/src/*' imports are
// banned by the ESLint no-restricted-imports rule (they bypass the package
// contract and break the moment the engine ships compiled artifacts).
import type { LayoutOptions } from '@tensor-editor/engine';

export interface PageDimensions {
  width: number;
  height: number;
}

export interface Margins {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export interface PageSetup {
  pageSize: string;
  margins: Margins;
  pageGap: number;
  /** 'landscape' swaps the page size's width/height for layout. */
  orientation?: 'portrait' | 'landscape';
  /** Per-document page background; '' = white. Persisted in .wpdoc metadata. */
  pageColor?: string;
  /** When pageSize === 'custom': the user-defined dimensions in POINTS. */
  customWidth?: number;
  customHeight?: number;
}

// ─── Unit system ─────────────────────────────────────────────────────────────
// All persisted measurements (PAGE_SIZES, DEFAULT_MARGINS, customWidth/
// customHeight) are stored in POINTS (1 pt = 1/72 inch). The engine
// consumes CSS px; toLayoutOptions converts pt → px at the boundary.

export const PX_PER_PT = 96 / 72;

export function ptToPx(pt: number): number {
  return Math.round(pt * PX_PER_PT);
}

export function pxToPt(px: number): number {
  return Math.round(px / PX_PER_PT);
}

export type MeasurementUnit = 'inches' | 'centimeters' | 'millimeters' | 'points' | 'picas';

export interface MeasurementUnitMeta {
  label: string;
  /** Input suffix, e.g. "in", "cm". */
  suffix: string;
  /** Points per 1 unit. */
  ptPer: number;
}

export const MEASUREMENT_UNITS: Record<MeasurementUnit, MeasurementUnitMeta> = {
  inches:       { label: 'Inches',       suffix: 'in', ptPer: 72 },
  centimeters: { label: 'Centimeters', suffix: 'cm', ptPer: 72 / 2.54 },
  millimeters: { label: 'Millimeters',  suffix: 'mm', ptPer: 72 / 25.4 },
  points:      { label: 'Points',       suffix: 'pt', ptPer: 1 },
  picas:       { label: 'Picas',        suffix: 'pc', ptPer: 12 },
};

export function formatPt(pt: number, unit: MeasurementUnit): string {
  const meta = MEASUREMENT_UNITS[unit];
  return String(Math.round((pt / meta.ptPer) * 100) / 100);
}

export function parseUnitToPt(raw: string, unit: MeasurementUnit): number | null {
  const v = parseFloat(raw);
  if (!Number.isFinite(v) || v <= 0) return null;
  return Math.round(v * MEASUREMENT_UNITS[unit].ptPer);
}

/** If the pt dims match a preset (portrait), return its key; else null. */
export function findMatchingPreset(widthPt: number, heightPt: number): string | null {
  for (const [key, preset] of Object.entries(PAGE_SIZES)) {
    if (preset.width === widthPt && preset.height === heightPt) return key;
  }
  return null;
}

// ─── Presets (width/height in POINTS; engine converts to px) ─────────────

export interface PageSizePreset extends PageDimensions {
  /** Display label for the dropdown, e.g. '8.5" × 11"' */
  inches: string;
}

export const PAGE_SIZES: Record<string, PageSizePreset> = {
  Letter:    { width: 612, height: 792,  inches: '8.5" × 11"' },
  Tabloid:   { width: 792, height: 1224, inches: '11" × 17"' },
  Legal:     { width: 612, height: 1008, inches: '8.5" × 14"' },
  Statement: { width: 396, height: 612,  inches: '5.5" × 8.5"' },
  Executive: { width: 522, height: 756,  inches: '7.25" × 10.5"' },
  Folio:     { width: 612, height: 936,  inches: '8.5" × 13"' },
  A3:        { width: 842, height: 1191, inches: '11.7" × 16.5"' },
  A4:        { width: 595, height: 842,  inches: '8.3" × 11.7"' },
  A5:        { width: 420, height: 595,  inches: '5.8" × 8.3"' },
  B4:        { width: 709, height: 1002, inches: '9.8" × 13.9"' },
  B5:        { width: 498, height: 709,  inches: '6.9" × 9.8"' },
};

export const PAGE_GAP = 32;
export const FALLBACK_PAGE_SIZE = 'Letter';

export const DEFAULT_MARGINS: Margins = {
  top: 72,
  bottom: 72,
  left: 72,
  right: 72,
};

export function toLayoutOptions(pageSetup: PageSetup): LayoutOptions {
  let widthPt: number;
  let heightPt: number;
  if (
    pageSetup.pageSize === 'custom' &&
    pageSetup.customWidth != null &&
    pageSetup.customHeight != null
  ) {
    widthPt = pageSetup.customWidth;
    heightPt = pageSetup.customHeight;
  } else {
    const base = PAGE_SIZES[pageSetup.pageSize] ?? PAGE_SIZES[FALLBACK_PAGE_SIZE];
    widthPt = base.width;
    heightPt = base.height;
  }
  if (pageSetup.orientation === 'landscape') {
    [widthPt, heightPt] = [heightPt, widthPt];
  }
  return {
    page: { width: ptToPx(widthPt), height: ptToPx(heightPt) },
    margins: {
      top: ptToPx(pageSetup.margins.top),
      right: ptToPx(pageSetup.margins.right),
      bottom: ptToPx(pageSetup.margins.bottom),
      left: ptToPx(pageSetup.margins.left),
    },
  };
}
