// Long native reasoning is bounded independently of output-token limits.
// Shared by the request path and its confirmation UI; probes keep their short deadline.
export const anthropicAssessmentWait = Object.freeze({
  timeoutMs: 30 * 60_000,
  idleTimeoutMs: 10 * 60_000,
});

// Twenty bilingual interview pairs can be longer than an ordinary document request.
// Compatible protocols have a finite 10-minute total bound; native Anthropic
// retains the separately enforced 10-minute inactivity and 30-minute total bounds.
export const interviewCompatibleWait = Object.freeze({ timeoutMs: 10 * 60_000 });
