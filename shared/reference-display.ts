/** Display-only source resolution. Never reads live material lists or rewrites saved evidence. */
const pasted = new Map<string, string>([
  ['paste', '本页简历文字'],
  ['resume', '本页简历文字'],
  ['job', '本页岗位文字'],
  ['evidence', '本页补充文字'],
]);
const uuid = '[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}';
function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function name(value: unknown): string | null {
  return typeof value === 'string' && value.trim()
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, 500)
    : null;
}
export function referenceLabels(
  snapshot?: unknown,
  sources?: unknown,
): ReadonlyMap<string, string> {
  const labels = new Map(pasted);
  const items = record(snapshot)?.items;
  if (Array.isArray(items))
    for (const value of items) {
      const item = record(value),
        title = name(item?.name);
      if (
        !item ||
        item.selected === false ||
        typeof item.id !== 'string' ||
        !title ||
        !Array.isArray(item.pages)
      )
        continue;
      for (const value of item.pages) {
        const page = record(value);
        if (page && Number.isInteger(page.number) && Number(page.number) > 0)
          labels.set(`${item.id}:p${page.number}`, `${title} · 第 ${page.number} 页`);
      }
    }
  if (Array.isArray(sources))
    for (const value of sources) {
      const source = record(value),
        title = name(source?.name);
      if (
        source &&
        source.selected !== false &&
        typeof source.id === 'string' &&
        title &&
        !labels.has(source.id)
      )
        labels.set(source.id, title);
    }
  return labels;
}
export function referenceLabel(sourceId: string, labels: ReadonlyMap<string, string>): string {
  const known = labels.get(sourceId);
  if (known) return known;
  const page = /:p([1-9]\d{0,5})$/.exec(sourceId);
  return page ? `参考资料 · 第 ${Number(page[1])} 页` : '参考资料';
}
function literalMarkdown(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/[\\`*_{}\[\]()#+.!|~-]/g, '\\$&');
}
/** Replaces only technical citation-shaped tokens, not words like job/resume or ordinary numbers. */
export function readableReferences(
  text: string,
  labels: ReadonlyMap<string, string>,
  markdown = false,
): string {
  const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const known = [...labels.keys()]
    .filter((id) => /:p\d+$/.test(id))
    .sort((a, b) => b.length - a.length)
    .map(escape);
  const pattern = new RegExp(
    `(?<![\\w-])(?:${[...known, `${uuid}(?::p[1-9]\\d{0,5})?`, 's[1-9]\\d*:p[1-9]\\d{0,5}'].join('|')})(?![\\w-])`,
    'gi',
  );
  return text.replace(pattern, (id) => {
    const label = referenceLabel(id, labels);
    return markdown ? literalMarkdown(label) : label;
  });
}
