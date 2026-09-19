import type { MaterialManifest } from './materials';
export function sendSummary(input: Record<string, string>, materials: MaterialManifest | null) {
  return {
    inputCharacters: Object.values(input).reduce((n, text) => n + text.length, 0),
    materials: materials?.items.length ?? 0,
    images: materials?.imageCount ?? 0,
    materialCharacters: materials?.textCount ?? 0,
  };
}
export function localRecordTime(createdAt: string | undefined): { label: string; iso?: string } {
  if (!createdAt) return { label: '未记录' };
  const date = new Date(createdAt);
  if (!Number.isFinite(date.getTime())) return { label: '时间不可用' };
  return {
    iso: date.toISOString(),
    label: new Intl.DateTimeFormat('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
      timeZoneName: 'shortOffset',
    }).format(date),
  };
}
