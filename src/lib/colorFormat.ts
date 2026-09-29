export type ColorDisplayFormat = 'hex' | 'rgb' | 'hsl';

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const r = parseInt(clean.substring(0, 2), 16);
  const g = parseInt(clean.substring(2, 4), 16);
  const b = parseInt(clean.substring(4, 6), 16);
  return [r, g, b];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }

  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function formatColor(hex: string, format: ColorDisplayFormat): string {
  if (format === 'hex') return hex;

  const [r, g, b] = hexToRgb(hex);
  if (format === 'rgb') return `rgb(${r}, ${g}, ${b})`;

  const [h, s, l] = rgbToHsl(r, g, b);
  return `hsl(${h}, ${s}%, ${l}%)`;
}

/** Hex -> rgba() with an explicit alpha. Returns the input unchanged
 * for anything the hex parser can't read (already-rgba strings pass
 * through). Used by the painted selection overlay so a picked color
 * never paints as an opaque block over the text. */
export function withAlpha(color: string, alpha: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(color.trim());
  if (!m) return color;
  const [r, g, b] = hexToRgb(m[1]!);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
