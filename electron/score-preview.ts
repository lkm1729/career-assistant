import type { ScoreFailurePreview } from '../shared/scoring';
export const SCORE_PREVIEW_TTL = 5 * 60_000;
export const SCORE_PREVIEW_LIMIT = 700_000;
/** One optional response in volatile memory, including its middle (where syntax errors can occur).
 * No persistence, network, or logging. Only the known request credential is redacted, not all PII.
 */
export class ScorePreview {
  private value: ScoreFailurePreview | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  set(runId: string, text: string, apiKey: string) {
    this.clear();
    if (apiKey)
      for (const secret of new Set([
        apiKey,
        JSON.stringify(apiKey).slice(1, -1),
        encodeURIComponent(apiKey),
      ]))
        text = text.split(secret).join('[API KEY REDACTED]');
    const truncated = text.length > SCORE_PREVIEW_LIMIT;
    this.value = {
      runId,
      text: truncated ? text.slice(0, SCORE_PREVIEW_LIMIT) : text,
      truncated,
      expiresAt: Date.now() + SCORE_PREVIEW_TTL,
    };
    this.timer = setTimeout(() => this.clear(), SCORE_PREVIEW_TTL);
    this.timer.unref();
  }
  has(runId: unknown) {
    if (this.value && Date.now() >= this.value.expiresAt) this.clear();
    return typeof runId === 'string' && this.value?.runId === runId;
  }
  take(runId: unknown): ScoreFailurePreview | null {
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
