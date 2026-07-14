/**
 * Pure mappers — no I/O. Project the hand-copied `api/types.ts` DTOs down to
 * the concise shapes tool handlers return (`schemas.ts`'s output schemas).
 */

import type { AgentDto, ConventionDto, ReviewDto } from './api/types.js';
import type { AgentSummary, ConventionSummary, ReviewResult } from './schemas.js';

/**
 * Slim projection of a `ReviewDto` → the tool-facing `ReviewResult`. Verdict
 * passes through unchanged (including `null`); each finding drops `id` (and
 * anything else the full `Finding` contract carries but this DTO already
 * omits — `suggestion`, `evidence`, `trifecta_components`, timestamps).
 */
export function toReviewResult(review: ReviewDto): ReviewResult {
  return {
    verdict: review.verdict,
    findings: review.findings.map((f) => ({
      severity: f.severity as ReviewResult['findings'][number]['severity'],
      category: f.category as ReviewResult['findings'][number]['category'],
      title: f.title,
      file: f.file,
      start_line: f.start_line,
      end_line: f.end_line,
      confidence: f.confidence,
      rationale: f.rationale,
    })),
  };
}

/**
 * Find the review matching a triggered run's `run_id`. Assumes `reviews` is
 * already sorted newest-first, as `GET /pulls/:id/reviews` returns it
 * (`reviews/helpers.ts`) — falls back to the newest review overall (index 0)
 * if no row carries a matching `run_id` (rare correlation-miss guard, spec §5).
 */
export function pickReviewForRun(reviews: ReviewDto[], runId: string): ReviewDto | undefined {
  return reviews.find((r) => r.run_id === runId) ?? reviews[0];
}

/** Slim `list_agents` projection. */
export function toAgentSummary(agent: AgentDto): AgentSummary {
  return {
    id: agent.id,
    name: agent.name,
    description: agent.description,
    provider: agent.provider,
    model: agent.model,
    enabled: agent.enabled,
  };
}

/** Slim `get_conventions` projection. */
export function toConventionSummary(convention: ConventionDto): ConventionSummary {
  return {
    rule: convention.rule,
    evidence_path: convention.evidence_path,
    evidence_line: convention.evidence_line,
    confidence: convention.confidence,
  };
}
