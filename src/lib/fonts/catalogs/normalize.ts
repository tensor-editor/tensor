/**
 * The cross-source dedupe key (A's normalization ruling + B's
 * variable-suffix strip). One family arriving from Google, Font Share
 * AND Fontsource = ONE CatalogFont with three source chips.
 *
 * The variable strip: display-facing names spell variable packages
 * "Lora Variable" / "Lora Variable Italic" — they normalize to the
 * static family ("lora"), one entry, chips per source. Fontsource's
 * API carries `variable: true` instead (no suffix), but any source
 * that spells it out lands on the same key.
 */

export function normalizeFamilyKey(family: string): string {
  return family
    .toLowerCase()
    .replace(/\s+variable(\s+italic)?$/i, '') // "Lora Variable" → "lora"
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}
