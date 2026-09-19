import { scoreDimensions } from '../shared/scoring';
const keys = scoreDimensions.map((d) => d.key);
const record = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
/** Only structural counts and fixed local vocabulary; never echo provider keys or prose. */
export function dimensionShape(value: unknown): string {
  if (!Array.isArray(value))
    return (
      'shape=' +
      (value === undefined
        ? 'MISSING'
        : value === null
          ? 'NULL'
          : typeof value === 'object'
            ? 'OBJECT'
            : typeof value === 'string'
              ? 'STRING'
              : 'OTHER')
    );
  const counts = keys.map((key) => value.filter((d) => record(d) && d.key === key).length);
  const missing = keys.filter((_, i) => counts[i] === 0);
  const duplicate = keys.filter((_, i) => counts[i] > 1);
  const invalid = value.filter((d) => !record(d) || !keys.some((key) => d.key === key)).length;
  return `shape=ARRAY; count=${value.length}; missing=${missing.join(',') || 'none'}; duplicate=${duplicate.join(',') || 'none'}; unknownOrInvalid=${invalid}`;
}
/** Recognize the observed misplaced empty example only, never repair missing/extra scores. */
export function scoreDimensionList(
  value: unknown,
): { dimensions: Record<string, unknown>[]; normalized: boolean } | undefined {
  if (!Array.isArray(value)) return;
  let dimensions = value;
  let normalized = false;
  if (value.length === 5) {
    const markers = value.filter(
      (d) =>
        record(d) &&
        Object.keys(d).length === 2 &&
        Object.hasOwn(d, 'key') &&
        d.key === 'example' &&
        ((Object.hasOwn(d, 'value') && d.value === null) ||
          (Object.hasOwn(d, 'example') && d.example === null)),
    );
    if (markers.length !== 1) return;
    dimensions = value.filter((d) => d !== markers[0]);
    normalized = true;
  }
  if (
    dimensions.length !== 4 ||
    !dimensions.every(record) ||
    keys.some((key) => dimensions.filter((d) => d.key === key).length !== 1)
  )
    return;
  return { dimensions, normalized };
}
