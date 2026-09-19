/** Literal template slots inside a quoted phrase, not JSON arrays/objects.
 * No quotes, comma, colon, nesting, escapes or line breaks; require actual words.
 */
function placeholderEnd(input: string, start: number): number | undefined {
  if (input[start] !== '[') return;
  const end = input.indexOf(']', start + 1);
  if (end < 0 || end - start > 160) return;
  const text = input.slice(start + 1, end).trim();
  if (
    !/^[\p{L}\p{M}][\p{L}\p{M}\p{N} \t_/%+().-]*$/u.test(text) ||
    /^(?:true|false|null|NaN|Infinity|undefined)$/.test(text)
  )
    return;
  return end;
}
/** Bounded fallback for score prose, not a general JSON repairer.
 * Called only at an allowlisted string value after the regular grammar failed.
 * Stop at the FIRST possible structural boundary; never swallow separators,
 * fields or array entries to find a later convenient closing quote.
 * Returned positions are existing paired prose quotes, not invented content.
 */
export function scoreProseQuotes(
  input: string,
  start: number,
  container: 'array' | 'object',
): ReadonlySet<number> | undefined {
  const inner: number[] = [];
  let escapedQuotes = 0;
  const limit = Math.min(input.length, start + 16_000);
  for (let at = start + 1; at < limit; at++) {
    const ch = input[at];
    if (ch === '\\') {
      if (input[at + 1] === '"') escapedQuotes++;
      at++; // The decoder still validates every escape, including unicode.
      continue;
    }
    // Do not infer multiline/structural text. JSON-escaped newlines remain allowed.
    if (ch === '[' && (inner.length + escapedQuotes) % 2 === 1) {
      const end = placeholderEnd(input, at);
      if (end === undefined || end >= limit) return;
      at = end;
      continue;
    }
    if (/[\r\n{}\[\]\x60]/.test(ch)) return;
    if (ch !== '"') continue;
    let after = at + 1;
    while (after < input.length && /[ \t\r\n]/.test(input[after])) after++;
    const next = input[after];
    if (next === ',' || next === ']' || next === '}' || after === input.length) {
      if (next !== ',' && next !== (container === 'array' ? ']' : '}')) return;
      if (!inner.length || inner.length % 2 !== 0) return;
      for (let i = 0; i < inner.length; i += 2) {
        const text = input.slice(inner[i] + 1, inner[i + 1]).trim();
        if (!text || /^(?:null|true|false)$/.test(text)) return;
        if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(text)) {
          // A numeric literal between separated strings may be a missing comma.
          // Only accept numbers embedded directly in letter-delimited prose.
          if (
            input.slice(inner[i] + 1, inner[i + 1]) !== text ||
            !/\p{L}/u.test(input[inner[i] - 1] ?? '') ||
            !/\p{L}/u.test(input[inner[i + 1] + 1] ?? '')
          )
            return;
        }
      }
      return new Set(inner);
    }
    // A key, comment or separated string is not safely interpretable as prose.
    if (
      next === ':' ||
      next === '{' ||
      (next === '[' &&
        ((inner.length + escapedQuotes) % 2 !== 0 || placeholderEnd(input, after) === undefined)) ||
      input.startsWith('//', after) ||
      input.startsWith('/*', after) ||
      (after > at + 1 && next === '"')
    )
      return;
    inner.push(at);
    if (inner.length > 64) return;
  }
}
