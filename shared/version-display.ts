import type { ResumeVersion } from './ai';
/** Never use a recycled visible ordinal to address persisted records. */
export function versionLabel(
  versions: readonly ResumeVersion[],
  number: number | null | undefined,
): string {
  if (!number) return '本地草稿';
  const version = versions.find((item) => item.number === number);
  return version?.displayNumber ? `V${version.displayNumber}` : `已移除版本（记录 #${number}）`;
}
