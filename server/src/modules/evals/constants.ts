/**
 * Domain constants for the eval module (SPEC-03). No imports beyond types —
 * this file must stay import-free of I/O/db/adapters so it can be shared by
 * both the pure scoring domain (`scorer.ts`/`expectations.ts`, step 2) and the
 * runner/dashboard-service (step 4) without creating a layering violation.
 */

/** Performance NFR: a single case's provider call is bounded so one hung
 * provider call cannot stall the whole batch. */
export const EVAL_CASE_TIMEOUT_MS = 120_000;

/** Bounded trend series — dashboard reads must not scan full run history. */
export const TREND_WINDOW_BATCHES = 20;

/** Cap on case-level rows returned for a single owner's run history. */
export const MAX_RECENT_RUNS = 50;

/** Cap on distinct batches returned for a single owner's batch history. */
export const MAX_RECENT_BATCHES = 20;

/**
 * D6 — `taskPrefix` is concatenated into the prompt's TRUSTED task framing
 * (`agent-runner.ts`), unlike `prDescription`, which is delimiter-wrapped as
 * untrusted. A case's `input_meta.pr_title`/`pr_body` are author-controlled,
 * so they must never be interpolated into this string — this is a fixed
 * English constant, never built from case data.
 */
export const EVAL_TASK_PREFIX =
  'Review the following changes. This is a stored regression case; review it exactly as you would a pull request diff.';

/** Deterministic session id for an eval case run, passed as `runAgentReview`'s `sessionId`. */
export function evalSessionId(caseId: string): string {
  return `eval:${caseId}`;
}
