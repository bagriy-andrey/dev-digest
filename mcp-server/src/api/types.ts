/**
 * Hand-copied response DTOs — a minimal SUBSET of `@devdigest/shared` fields
 * this client actually reads. This package does NOT import `@devdigest/shared`
 * (it is vendored into `server/`/`client/` via a tsconfig path alias, never
 * published — a standalone package like this one has no access to it).
 *
 * Source of truth for each shape (update the matching type here if the server
 * contract changes):
 *  - `RepoDto`            ← `Repo`            in server/src/vendor/shared/contracts/platform.ts
 *  - `PrMetaDto`           ← `PrMeta`          in .../contracts/platform.ts
 *  - `ReviewFinding`       ← `PrFindingSummary` in .../contracts/platform.ts
 *  - `AgentDto`            ← `Agent`           in .../contracts/knowledge.ts
 *  - `ConventionDto`       ← `ConventionCandidate` in .../contracts/knowledge.ts
 *  - `RunSummaryDto`       ← `RunSummary`      in .../contracts/trace.ts
 *  - `ReviewDto`           ← `ReviewDto`       in server/src/modules/reviews/helpers.ts
 *  - `RunTriggerResponse`  ← `POST /pulls/:id/review` response, `reviews/routes.ts` + `reviews/service.ts`
 *  - `ReviewDiffFinding`   ← `Finding`         in server/src/vendor/shared/contracts/findings.ts
 *  - `AgentReviewResult`   ← `AgentReviewResult` in server/src/vendor/shared/contracts/review-diff.ts
 */

/** Subset of `Repo` — just enough to resolve "owner/name" → id and display it. */
export interface RepoDto {
  id: string;
  owner: string;
  name: string;
  full_name: string;
}

/** Subset of `PrMeta` — just enough to resolve a PR number → id. */
export interface PrMetaDto {
  id: string | null;
  number: number;
  title: string;
  author: string;
  branch: string;
  base: string;
  status: string;
}

/** Subset of `Agent` — just enough to resolve a name/id → agent and list summaries. */
export interface AgentDto {
  id: string;
  name: string;
  description: string;
  provider: string;
  model: string;
  enabled: boolean;
}

/**
 * Subset of `RunSummary`. NOTE: on the real contract `status` is `string |
 * null` (not a strict enum) — treat any value outside the four expected
 * states defensively (poll.ts should not assume exhaustiveness).
 */
export interface RunSummaryDto {
  run_id: string;
  agent_id: string | null;
  agent_name: string | null;
  status: 'running' | 'done' | 'failed' | 'cancelled' | null;
  error: string | null;
  findings_count: number | null;
  score: number | null;
}

/**
 * Slim finding — mirrors `PrFindingSummary`, NOT the full `Finding` contract.
 * Drops `suggestion`, `evidence`, `trifecta_components`, action timestamps.
 */
export interface ReviewFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  confidence: number;
  rationale: string;
}

/** Subset of `reviews/helpers.ts`'s `ReviewDto`. */
export interface ReviewDto {
  id: string;
  pr_id: string;
  run_id: string | null;
  agent_id: string | null;
  verdict: 'request_changes' | 'approve' | 'comment' | null;
  summary: string | null;
  score: number | null;
  findings: ReviewFinding[];
}

/** Subset of `ConventionCandidate`. */
export interface ConventionDto {
  id: string;
  rule: string;
  evidence_path: string;
  evidence_line?: number;
  evidence_snippet: string;
  confidence: number;
  accepted: boolean;
}

/**
 * Shape of `POST /pulls/:id/review`'s immediate response. Fire-and-forget:
 * `reviews` is always `[]` here — `ReviewService.runReview` returns before the
 * background LLM run finishes (see `reviews/service.ts`). Findings must be
 * fetched later via `listRuns`/`listReviews` (poll.ts / get-findings tool).
 */
export interface RunTriggerResponse {
  pr_id: string;
  runs: { run_id: string; agent_id: string; agent_name: string }[];
  reviews: [];
}

/**
 * Subset of `Finding` (full contract, unlike the slimmer `ReviewFinding` above)
 * — the pre-push endpoint response carries the complete grounded finding, not a
 * PR-persisted summary.
 */
export interface ReviewDiffFinding {
  id: string;
  severity: string;
  category: string;
  title: string;
  file: string;
  start_line: number;
  end_line: number;
  rationale: string;
  suggestion?: string | null;
  confidence: number;
}

/**
 * Shape of one entry in `POST /repos/:id/review-diff`'s response array — one
 * per enabled agent, SYNCHRONOUS (findings are directly present, no polling).
 */
export interface AgentReviewResult {
  agent: { id: string; name: string };
  verdict: 'request_changes' | 'approve' | 'comment';
  score: number;
  blockers: number;
  findings: ReviewDiffFinding[];
}
