// Long native reasoning is bounded independently of output-token limits.
// Shared by the request path and its confirmation UI; probes keep their short deadline.
export const anthropicAssessmentWait = Object.freeze({
  timeoutMs: 30 * 60_000,
  idleTimeoutMs: 10 * 60_000,
});
