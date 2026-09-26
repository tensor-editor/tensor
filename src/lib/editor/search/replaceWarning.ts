/** Highest `$N` backreference number referenced in a replacement template
 *  (ignores `$$` and `$&`, which are always valid). Used to warn when a
 *  replacement references a capture group the pattern doesn't have — the
 *  "$1 with no parentheses in the pattern" trap, which otherwise silently
 *  replaces matches with an empty string. */
export function getMaxReferencedGroup(template: string): number {
  let max = 0;
  const re = /\$(\$|&|\d{1,2})/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(template)) !== null) {
    if (m[1] === '$' || m[1] === '&') continue;
    max = Math.max(max, parseInt(m[1], 10));
  }
  return max;
}

export function getGroupMismatchWarning(
  useRegex: boolean,
  replaceTerm: string,
  groupCount: number,
): string | null {
  if (!useRegex) return null;
  const maxRef = getMaxReferencedGroup(replaceTerm);
  if (maxRef === 0 || maxRef <= groupCount) return null;
  return `Pattern has ${groupCount} capture group${groupCount === 1 ? '' : 's'} — $${maxRef} will insert nothing`;
}
