import type { MatchFailurePreview } from '../shared/matching';
export const MATCH_PREVIEW_TTL = 5 * 60_000;
export const MATCH_PREVIEW_LIMIT = 32_000;
/** Optional one-shot memory only. No database, files, logging, or network dependencies. */
export class MatchPreview {
  private value: MatchFailurePreview | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  set(runId: string, text: string, apiKey: string) {
    this.clear();
    // Redact before slicing, including escaped forms of the actual credential.
    if (apiKey)
      for (const secret of new Set([
        apiKey,
        JSON.stringify(apiKey).slice(1, -1),
        encodeURIComponent(apiKey),
      ]))
        text = text.split(secret).join('[API KEY REDACTED]');
    const truncated = text.length > MATCH_PREVIEW_LIMIT;
    this.value = {
      runId,
      text: truncated
        ? text.slice(0, 24_000) + '\n[中间内容已省略；仅用于本机定位]\n' + text.slice(-8_000)
        : text,
      truncated,
      expiresAt: Date.now() + MATCH_PREVIEW_TTL,
    };
    this.timer = setTimeout(() => this.clear(), MATCH_PREVIEW_TTL);
    this.timer.unref();
  }
  has(runId: unknown) {
    if (this.value && Date.now() >= this.value.expiresAt) this.clear();
    return typeof runId === 'string' && this.value?.runId === runId;
  }
  take(runId: unknown): MatchFailurePreview | null {
    if (!this.has(runId)) return null;
    const value = this.value;
    this.clear();
    return value;
  }
  clear(runId?: unknown) {
    if (runId !== undefined && this.value?.runId !== runId) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.value = null;
  }
}
